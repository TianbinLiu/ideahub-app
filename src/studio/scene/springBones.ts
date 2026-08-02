// 轻量弹簧骨（VRM SpringBone 式）：给购入模型的辅助骨链（双马尾/牛耳/缎带）
// 提供惯性摆动物理。每关节维护"当前尾端世界位置"，逐帧：惯性外推 + 刚度回弹
// 向 rest 方向 + 重力下垂，再把尾端方向差转成骨骼局部旋转。
import * as THREE from "three";
import { FixedStepper } from "./fixedStep";

interface Joint {
  bone: THREE.Object3D;
  child: THREE.Object3D;
  restQuat: THREE.Quaternion;
  restChildPos: THREE.Vector3; // 骨局部系下子骨 rest 位置
  boneLen: number; // 尾端球面半径=世界 rest 长度（首次 update 时量定，见下）
  currTail: THREE.Vector3;
  prevTail: THREE.Vector3;
  inited: boolean; // 尾端状态延迟到首次 update 初始化（那时世界矩阵才可靠）
}

/** 球形碰撞体：挂在骨骼上随动（世界半径；offset 为骨局部偏移，随骨旋转） */
export interface SphereCollider {
  bone: THREE.Object3D;
  radius: number;
  offset?: THREE.Vector3;
}

const _bonePos = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();
const _restDirWorld = new THREE.Vector3();
const _next = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rot = new THREE.Quaternion();
const _collCenter = new THREE.Vector3();
const _collOff = new THREE.Vector3();
const _collQuat = new THREE.Quaternion();

export class SpringBoneSim {
  private joints: Joint[] = [];
  stiffness: number;
  drag: number;
  gravity: number;
  colliders: SphereCollider[];

  /**
   * @param root 骨架所在场景
   * @param prefixes 链根名匹配（大小写不敏感、忽略非字母数字，如 "twintail"）
   */
  /** 可选平面碰撞：按尾端位置返回允许的最低 y（桌面/地板），长发垂落时贴面不穿透 */
  clampY?: (pos: THREE.Vector3) => number;

  constructor(
    root: THREE.Object3D,
    prefixes: string[],
    opts?: {
      stiffness?: number;
      drag?: number;
      gravity?: number;
      colliders?: SphereCollider[];
      clampY?: (pos: THREE.Vector3) => number;
    },
  ) {
    this.stiffness = opts?.stiffness ?? 14;
    this.drag = opts?.drag ?? 0.32;
    this.gravity = opts?.gravity ?? 1.6;
    this.clampY = opts?.clampY;
    this.colliders = opts?.colliders ?? [];
    // 保留 Unicode 字母数字（MMD 移植模型的骨名是中日文：馬尾/後髪/劉海），只剥符号
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const pats = prefixes.map(norm);
    root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = norm(o.name);
      if (!pats.some((p) => n.includes(p))) return;
      // 每根骨与其第一个骨骼子节点构成一个关节（叶骨无子，跳过）
      const child = o.children.find((c) => (c as THREE.Bone).isBone);
      if (!child) return;
      this.joints.push({
        bone: o,
        child,
        restQuat: o.quaternion.clone(),
        restChildPos: child.position.clone(),
        // 占位=局部 rest 长度。构造发生在 r3f commit 前（场景缩放/摆位未生效），
        // 此刻量世界长度不可靠且随挂载时序漂移（StrictMode 二次挂载时已带 3.35×缩放）
        // ——真正的半径在首次 update 时量定（那时世界矩阵已就绪）。
        boneLen: child.position.length() || 1e-4,
        currTail: new THREE.Vector3(),
        prevTail: new THREE.Vector3(),
        inited: false,
      });
    });
  }

  get jointCount() {
    return this.joints.length;
  }

  private stepper = new FixedStepper();

  update(dt: number) {
    // 固定步长：操作镜头时 dt 剧烈波动，变 dt 直接喂显式积分会让头发/缎带抖动、拉扯
    //（用户实测"移动摄像头会让模型扭曲抖动"）。步数为 0 也要跑一次零位移的写回，
    // 否则骨骼旋转这一帧不被写，动画混合器的 rest 会直接暴露出来。
    const n = this.stepper.take(dt);
    for (let i = 0; i < n; i++) this.step(this.stepper.step, true);
    // 不足一步时只做"把已有尾端重新投影到当前骨骼变换"，绝不推进物理：
    // 高刷屏上大半帧都凑不满 1/60，若照跑一遍就等于每隔一帧凭空施加一次惯性
    if (n === 0) this.step(0, false);
  }

  private step(d: number, integrate: boolean) {
    for (const j of this.joints) {
      const bone = j.bone;
      bone.getWorldPosition(_bonePos);
      // rest 方向（父骨当前朝向 × rest 局部子位）
      bone.parent!.getWorldQuaternion(_parentQuat);
      _restDirWorld.copy(j.restChildPos).applyQuaternion(j.restQuat).applyQuaternion(_parentQuat).normalize();
      // 首帧：量定世界 rest 长度（缩放已生效；此时骨还未被本 sim 转过，子骨在 rest 位），
      // 尾端从 rest 位静止起步——无启动跳变。手感参数按世界量纲调定（模型 scale 3.35）。
      if (!j.inited) {
        j.inited = true;
        j.boneLen = j.child.getWorldPosition(_next).distanceTo(_bonePos) || j.boneLen;
        j.currTail.copy(_bonePos).addScaledVector(_restDirWorld, j.boneLen);
        j.prevTail.copy(j.currTail);
      }
      // 惯性 + 刚度 + 重力
      if (integrate) {
        _inertia.copy(j.currTail).sub(j.prevTail).multiplyScalar(1 - this.drag);
        _next
          .copy(j.currTail)
          .add(_inertia)
          .addScaledVector(_restDirWorld, this.stiffness * d)
          .add(_from.set(0, -this.gravity * d * 0.1, 0));
      } else {
        _next.copy(j.currTail);
      }
      // 球形碰撞体：把尾端推出碰撞球面（先碰撞后归长，与 VRM SpringBone 次序一致）
      for (const c of this.colliders) {
        c.bone.getWorldPosition(_collCenter);
        if (c.offset) {
          c.bone.getWorldQuaternion(_collQuat);
          _collCenter.add(_collOff.copy(c.offset).applyQuaternion(_collQuat));
        }
        const dist = _next.distanceTo(_collCenter);
        if (dist < c.radius && dist > 1e-6) {
          _next.sub(_collCenter).multiplyScalar(c.radius / dist).add(_collCenter);
        }
      }
      // 归一化到骨长
      _next.sub(_bonePos).normalize().multiplyScalar(j.boneLen).add(_bonePos);
      // 平面碰撞：垂落的长发贴住桌面/地板（简单 y-clamp，穿模远比长度微差刺眼）
      if (this.clampY) {
        const minY = this.clampY(_next);
        if (_next.y < minY) _next.y = minY;
      }
      if (integrate) {
        j.prevTail.copy(j.currTail);
        j.currTail.copy(_next);
      }
      // 方向差 → 骨局部旋转：local' = restQuat × rotate(restDir_local → targetDir_local)
      _from.copy(j.restChildPos).normalize();
      // 世界方向转到"父世界系+restQuat"局部：先去父旋转，再去 restQuat
      _to.copy(_next).sub(_bonePos).applyQuaternion(_parentQuat.invert());
      _to.applyQuaternion(_rot.copy(j.restQuat).invert()).normalize();
      bone.quaternion.copy(j.restQuat).multiply(_rot.setFromUnitVectors(_from, _to));
      bone.updateMatrixWorld(false);
    }
  }
}
