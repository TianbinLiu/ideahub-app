// 轻量弹簧骨（VRM SpringBone 式）：给购入模型的辅助骨链（双马尾/牛耳/缎带）
// 提供惯性摆动物理。每关节维护"当前尾端世界位置"，逐帧：惯性外推 + 刚度回弹
// 向 rest 方向 + 重力下垂，再把尾端方向差转成骨骼局部旋转。
import * as THREE from "three";

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

const _bonePos = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();
const _restDirWorld = new THREE.Vector3();
const _next = new THREE.Vector3();
const _inertia = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _rot = new THREE.Quaternion();

export class SpringBoneSim {
  private joints: Joint[] = [];
  stiffness: number;
  drag: number;
  gravity: number;

  /**
   * @param root 骨架所在场景
   * @param prefixes 链根名匹配（大小写不敏感、忽略非字母数字，如 "twintail"）
   */
  constructor(
    root: THREE.Object3D,
    prefixes: string[],
    opts?: { stiffness?: number; drag?: number; gravity?: number },
  ) {
    this.stiffness = opts?.stiffness ?? 14;
    this.drag = opts?.drag ?? 0.32;
    this.gravity = opts?.gravity ?? 1.6;
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

  update(dt: number) {
    const d = Math.min(dt, 0.05);
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
      _inertia.copy(j.currTail).sub(j.prevTail).multiplyScalar(1 - this.drag);
      _next
        .copy(j.currTail)
        .add(_inertia)
        .addScaledVector(_restDirWorld, this.stiffness * d)
        .add(_from.set(0, -this.gravity * d * 0.1, 0));
      // 归一化到骨长
      _next.sub(_bonePos).normalize().multiplyScalar(j.boneLen).add(_bonePos);
      j.prevTail.copy(j.currTail);
      j.currTail.copy(_next);
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
