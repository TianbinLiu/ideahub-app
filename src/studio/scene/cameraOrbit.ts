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
/** NPC 头顶的屏幕投影（TableScene 的锚点组件每帧写入；0~1 归一化坐标）。
 *  DOM 侧的对话气泡用 rAF 直读此对象定位——不走 React 状态，60fps 跟随零重渲。 */
export const NPC_SCREEN = { x: 0.5, y: 0.3, visible: false };

/** 第一人称的"升空俯瞰"程度：0=眼位，1=头顶正上方俯瞰全桌。
 *  双指捏合（缩小视角）/滚轮下滚驱动升高；反向操作最多回到眼位（0 下限）。 */
export const eyeRise = { v: 0 };

export function addEyeRise(d: number) {
  eyeRise.v = Math.min(1, Math.max(0, eyeRise.v + d));
}

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
/** 颈部活动范围：偏航 ±75°。俯仰不对称——低头要能看到自己的身体。
 *  实测（f 档 rig、scale 4.85 / y −2.4）：头骨世界高 1.475、上胸 0.980，眼点在头骨
 *  上方 0.04、前方 0.12，从眼到胸前表面的方位是水平线下 ~83°。视野 50°（半角 25°），
 *  低头 1.20rad(68.8°) 时可看到 93.8° 以下——胸和手都进画。抬头维持原来的 42°。 */
export const EYE_YAW_LIMIT = 1.31;
export const EYE_PITCH_DOWN = 1.2;
export const EYE_PITCH_UP = 0.73;

/** 低头下限按角色换算：**这个值不能全局共用**。第一人称隐藏头部靠把头骨缩到 0.001，
 *  而这只对"头是独立网格"的模型干净（Tripo 档就是）；头颈皮肤与躯干同属一个网格时
 *  （Tsumire 的 body002），头权重顶点被塌到头骨原点、也就是相机所在处，留下一根尖刺，
 *  低头到一定角度就把近裁剪面(0.1)捅穿——实测 −1.2 时画面下缘 body002 距相机仅
 *  0.06~0.07，看到的全是衣物/皮肤内表面。另外描边反壳是世界尺度的，贴太近时会糊成
 *  大片黑。所以每套 rig 按自己的体型标一个安全下限（见 PlayerArms 的 eyePitchDown）。 */
export const eyeLimits = { pitchDown: EYE_PITCH_DOWN };

/** 第一人称眼点相对**头骨**的偏移（世界单位），由 PlayerArms 按当前 rig 写入。
 *  见 TableScene.eyeCam 的注释：头骨不在眼睛处，前移量必须按角色体型标定。 */
export const playerEye = { forward: 0.12, up: 0.04 };

export function addEyeLook(dYaw: number, dPitch: number) {
  eyeLook.yaw = Math.min(EYE_YAW_LIMIT, Math.max(-EYE_YAW_LIMIT, eyeLook.yaw + dYaw));
  eyeLook.pitch = Math.min(EYE_PITCH_UP, Math.max(-eyeLimits.pitchDown, eyeLook.pitch + dPitch));
}

// DEV 调参/验收后门：控制台可直接读写轨道参数与头部锚点
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__camOrbit = {
    orbit,
    eyeLook,
    eyeLimits,
    playerEye,
    eyeRise,
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
    // 角色一律不挡镜头。这不只是手感问题——three 对 SkinnedMesh 做 raycast 会在 CPU 上
    // 逐三角形重算蒙皮，一个角色两万顶点、场景里好几个，每帧算一遍会让转镜头时的帧时间
    // 从 1ms 飙到几十 ms。而弹簧骨/胸部物理是按帧长积分的，于是"一转镜头模型就抖、就
    // 扭曲"（用户实测）。轨道半径下限本来就不让镜头贴到角色身上，不需要它们参与遮挡。
    if ((m as THREE.SkinnedMesh).isSkinnedMesh || m.morphTargetInfluences) return;
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
