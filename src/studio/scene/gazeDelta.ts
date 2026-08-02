// 注视增量：把"头当前朝向"转向"实际镜头"的世界系旋转，按偏航/俯仰分别限幅。
//
// 为什么不用 Quaternion.setFromUnitVectors(baseDir, camDir)：
// ① 两向量接近**反向**时它是退化的——three 内部按 `|x| > |z|` 挑一根任意垂直轴，
//    跨过那个阈值旋转轴整个翻掉；而限幅只卡角度不管轴，镜头绕到特定位置头就来回甩
//    （用户实测："镜头到某些位置时角色头部上下旋转抽搐"）。
// ② 它给的是任意轴旋转，会混进 roll（歪脖子），并且无法把俯仰单独限死——
//    而俯仰正是把脸往刘海里推的方向。
// atan2/asin 在全域连续可导，没有退化分支。
import * as THREE from "three";

const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qPitch = new THREE.Quaternion();

const clamp1 = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v);

export interface GazeLimits {
  /** 偏航上限（弧度，左右对称） */
  yaw: number;
  /** 抬头上限 */
  up: number;
  /** 低头上限（一般给得比抬头小：低头是把脸往刘海里推的方向） */
  down: number;
}

/**
 * @param baseDir 头当前朝向（单位向量，世界系）
 * @param camDir  头→镜头方向（单位向量，世界系）
 * @param w       整体权重 0~1（注视窗口的缓入缓出）
 * @param out     结果四元数
 */
export function gazeDelta(
  baseDir: THREE.Vector3,
  camDir: THREE.Vector3,
  lim: GazeLimits,
  w: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  let dYaw = Math.atan2(camDir.x, camDir.z) - Math.atan2(baseDir.x, baseDir.z);
  if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
  else if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
  dYaw = Math.max(-lim.yaw, Math.min(lim.yaw, dYaw));
  const dPitch = Math.max(
    -lim.down,
    Math.min(lim.up, Math.asin(clamp1(camDir.y)) - Math.asin(clamp1(baseDir.y))),
  );
  _qYaw.setFromAxisAngle(_up, dYaw * w);
  // 俯仰轴 = 水平面内垂直于基准朝向的轴（正角度=抬头）
  _axis.set(-baseDir.z, 0, baseDir.x);
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
  _axis.normalize();
  _qPitch.setFromAxisAngle(_axis, dPitch * w);
  return out.copy(_qYaw).multiply(_qPitch);
}
