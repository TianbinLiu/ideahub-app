// 轻量弹簧骨（VRM SpringBone 式）：给购入模型的辅助骨链（双马尾/牛耳/缎带）
// 提供惯性摆动物理。每关节维护"当前尾端世界位置"，逐帧：惯性外推 + 刚度回弹
// 向 rest 方向 + 重力下垂，再把尾端方向差转成骨骼局部旋转。
import * as THREE from "three";

interface Joint {
  bone: THREE.Object3D;
  child: THREE.Object3D;
  restQuat: THREE.Quaternion;
  restChildPos: THREE.Vector3; // 骨局部系下子骨 rest 位置
  boneLen: number; // 世界长度
  currTail: THREE.Vector3;
  prevTail: THREE.Vector3;
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
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const pats = prefixes.map(norm);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      const n = norm(o.name);
      if (!pats.some((p) => n.includes(p))) return;
      // 每根骨与其第一个骨骼子节点构成一个关节（叶骨无子，跳过）
      const child = o.children.find((c) => (c as THREE.Bone).isBone);
      if (!child) return;
      const childWorld = child.getWorldPosition(new THREE.Vector3());
      const boneWorld = o.getWorldPosition(new THREE.Vector3());
      this.joints.push({
        bone: o,
        child,
        restQuat: o.quaternion.clone(),
        restChildPos: child.position.clone(),
        boneLen: childWorld.distanceTo(boneWorld) || 1e-4,
        currTail: childWorld.clone(),
        prevTail: childWorld.clone(),
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
