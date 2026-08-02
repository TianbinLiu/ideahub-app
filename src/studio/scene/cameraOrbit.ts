// 相机轨道系统：第一人称眼位 + 绕互动点的球面运动 + 防穿模收敛。
//
// 为什么独立成模块：玩家/NPC 的头部世界坐标由各自组件每帧写入，CameraRig 每帧读取；
// 直接互相 import 会成环（TableScene→PlayerArms→TripoNpc→…），放这里所有人都只依赖它。
import * as THREE from "three";

/** 玩家头骨世界坐标（PlayerArms 每帧写入） */
export const PLAYER_HEAD = new THREE.Vector3(0, 0.7, 3.6);
/** 玩家视线朝向（头骨前方，供第一人称眼位定朝向） */
export const PLAYER_FACE = new THREE.Vector3(0, 0, -1);
/** NPC 头部世界坐标（TripoNpc 每帧写入） */
export const NPC_HEAD = new THREE.Vector3(0, 0.9, -4.3);

/** 各轨道模式的距离约束（世界单位）：min 兼作"不许钻进模型内部"的硬下限 */
export const ORBIT_LIMITS: Record<string, { min: number; max: number }> = {
  node: { min: 1.1, max: 7.0 },
  player: { min: 1.0, max: 6.0 },
  npc: { min: 1.2, max: 7.0 },
};

/** 球面轨道状态：theta=水平方位角，phi=极角（从 +Y 轴量），radius=到圆心距离 */
export interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
  /** 用户已接管：脚本运镜让位，改由球面参数驱动相机 */
  active: boolean;
}

export const orbit: OrbitState = { theta: 0, phi: Math.PI / 2, radius: 3, active: false };

/** 第一人称环视：相对"正对 NPC"基准方向的偏航/俯仰（弧度）。
 *  同时驱动相机朝向与角色头骨旋转——滑屏 = 转头看向别处 */
export const eyeLook = { yaw: 0, pitch: 0 };
/** 颈部活动范围：偏航 ±75°、俯仰 ±42°（超出就成拧脖子了） */
export const EYE_YAW_LIMIT = 1.31;
export const EYE_PITCH_LIMIT = 0.73;

export function addEyeLook(dYaw: number, dPitch: number) {
  eyeLook.yaw = Math.min(EYE_YAW_LIMIT, Math.max(-EYE_YAW_LIMIT, eyeLook.yaw + dYaw));
  eyeLook.pitch = Math.min(EYE_PITCH_LIMIT, Math.max(-EYE_PITCH_LIMIT, eyeLook.pitch + dPitch));
}

// DEV 调参/验收后门：控制台可直接读写轨道参数与头部锚点
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__camOrbit = {
    orbit,
    eyeLook,
    PLAYER_HEAD,
    NPC_HEAD,
    ORBIT_LIMITS,
  };
}

/** 从当前相机位置反解球面参数（切换轨道中心/新机位落位后调用，保证接管时无跳变） */
export function syncOrbitFromCamera(camPos: THREE.Vector3, center: THREE.Vector3) {
  const dx = camPos.x - center.x;
  const dy = camPos.y - center.y;
  const dz = camPos.z - center.z;
  const r = Math.max(1e-4, Math.hypot(dx, dy, dz));
  orbit.radius = r;
  orbit.theta = Math.atan2(dx, dz);
  orbit.phi = Math.acos(Math.min(1, Math.max(-1, dy / r)));
}

/** 球面参数 → 世界坐标 */
export function orbitToPosition(center: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const sp = Math.sin(orbit.phi);
  return out.set(
    center.x + orbit.radius * sp * Math.sin(orbit.theta),
    center.y + orbit.radius * Math.cos(orbit.phi),
    center.z + orbit.radius * sp * Math.cos(orbit.theta),
  );
}

// ── 防穿模：从圆心朝相机方向投射，撞到实体就把相机收到撞点之前 ──
const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
let colliders: THREE.Object3D[] = [];
let collidersAt = -1e9;

/** 采集可挡视线的实体网格：跳过隐形/纯透明的拾取面、贴花与标记了 noCam 的对象 */
function collectColliders(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    if (o.userData?.noCam) return;
    const mat = m.material as THREE.Material & { opacity?: number; transparent?: boolean };
    if (mat && mat.transparent && (mat.opacity ?? 1) < 0.35) return; // 拾取面/接触阴影/光束
    out.push(o);
  });
  return out;
}

/**
 * 把期望半径收敛到不穿模的安全值。
 * 从"圆心外 min 处"起射（避免从模型内部起射打到自身背面），只收不放。
 */
export function clampRadiusByScene(
  scene: THREE.Object3D,
  center: THREE.Vector3,
  desired: number,
  min: number,
  now: number,
): number {
  if (now - collidersAt > 1.0) {
    colliders = collectColliders(scene);
    collidersAt = now;
  }
  if (desired <= min) return min;
  _dir.copy(orbitToPosition(center, _from)).sub(center);
  const len = _dir.length();
  if (len < 1e-5) return desired;
  _dir.multiplyScalar(1 / len);
  _from.copy(center).addScaledVector(_dir, min);
  _ray.set(_from, _dir);
  _ray.far = desired - min;
  _ray.near = 0;
  const hits = _ray.intersectObjects(colliders, false);
  if (hits.length === 0) return desired;
  // 留 0.12 余量，避免近裁剪面切进被撞物体
  return Math.max(min, min + hits[0].distance - 0.12);
}
