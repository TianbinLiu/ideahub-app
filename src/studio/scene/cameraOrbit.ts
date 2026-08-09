// 相机轨道系统：第一人称眼位 + 绕互动点的球面运动 + 防穿模收敛。
//
// 为什么独立成模块：玩家/NPC 的头部世界坐标由各自组件每帧写入，CameraRig 每帧读取；
// 直接互相 import 会成环（TableScene→PlayerArms→TripoNpc→…），放这里所有人都只依赖它。
import * as THREE from "three";

/** 玩家头骨世界坐标（PlayerArms 每帧写入） */
export const PLAYER_HEAD = new THREE.Vector3(0, 0.7, 3.6);
/** 玩家**上半身**中心 = spine1 与头骨的中点（PlayerArms 每帧写入）。
 *  轨道圆心用它而不是头骨：绕头顶转时身体被甩到画面下缘外，转到侧后方就只剩一颗
 *  头飘着；以上半身为心则整个胸像始终居中，正是"围着角色上半身转"的观感。 */
export const PLAYER_TORSO = new THREE.Vector3(0, 0.45, 3.6);
/** 轨道相机的最低高度（世界 Y）。桌面 TABLE 顶在 y=0，低于它相机就钻到桌板下面，
 *  画面被木头糊死；留 12cm 余量避免贴着桌面产生 z-fighting 般的擦边。 */
export const ORBIT_MIN_Y = 0.12;
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

/**
 * 升空到这个程度就**停止环视、并把已累积的偏航/俯仰衰减回正**。
 *
 * ⚠ 这是一个门限，不是两个。历史上"能不能转头"用 0.12、"要不要回正"用 0.02，
 * 中间 0.02~0.12 那条缝里两件事同时成立：拖的时候 addEyeLook 在加、松手后衰减赢，
 * 于是**每次滑动松手视角都弹回初始朝向**（用户报的"点不到视野外的卡组"就是它）。
 * 更糟的是滚轮一格 `deltaY=100 × 0.0011 = 0.11` 正好落在缝里，一下滚轮就进入死区。
 * 不变式：**能转头 ⟺ 不回正，死区必须为空。**
 *
 * 0.12 这个值的安全性依赖另外三个常量（PlayerArms 的 SELF_GATE=1.0、升空目标高 8.6、
 * quintic 混合）：反解 e2=smoothstep(0.12)=0.040 → 相机离头约 7.6×0.040=0.30 < 1.0，
 * 头此时仍藏着。改任何一个都要重算——CameraRig 里有 DEV 断言盯着。
 */
export const EYE_RISE_LOOK_OFF = 0.12;

export function addEyeRise(d: number) {
  eyeRise.v = Math.min(1, Math.max(0, eyeRise.v + d));
}

/** 复位升空量。**必须有人调**：eyeRise 是模块级单例、切路由不复位，而它在
 *  0.02~0.228 之间是一种"环视被切断、头还藏着、画面又没明显变化"的哑态——
 *  用户没有任何线索却怎么拖都不动。切回默认机位时一并清掉。 */
export function resetEyeRise() {
  eyeRise.v = 0;
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

/** 偏航与俯仰**不是两个独立的限幅**，可用范围是一个锥形而不是矩形。
 *
 *  把它们各自夹一遍，等于允许"头转到 75° 极限的同时下巴贴到胸口"这个角落——
 *  真实颈椎做不到这个组合，模型上也立刻穿帮：实测转头 75° 时眼点被推到肩膀正上方，
 *  下方最近的衣物只剩 0.16（正前方时是 0.54），自身剔除球（0.45）把近处肩布挖掉，
 *  于是看穿到衣服另一侧的**内表面**。
 *
 *  用"屏幕射线命中布料背面的条数"量化边界（0=只看到外表面，即正常）：
 *    偏航 0    俯仰 −1.2 → 背面 0 / 正面 3   ← 正前方大幅度低头完全干净，必须保留
 *    偏航 −1.3 俯仰 −1.2 → 背面 3
 *    偏航 −1.3 俯仰 −1.0 → 背面 4
 *    偏航 −1.3 俯仰 −0.85 → 背面 1
 *    偏航 −1.3 俯仰 −0.70 → 背面 0   ← 干净边界
 *  0.70/1.20 = 0.58，取 0.55 留一点余量。 */
const YAW_PITCH_COUPLING = 0.45;

/** 当前偏航下允许的低头量。偏航为 0 时是完整的 pitchDown，转到极限时收到 55% */
export function pitchDownAt(yaw: number): number {
  const t = Math.min(1, Math.abs(yaw) / EYE_YAW_LIMIT);
  return eyeLimits.pitchDown * (1 - YAW_PITCH_COUPLING * t);
}

export function addEyeLook(dYaw: number, dPitch: number) {
  eyeLook.yaw = Math.min(EYE_YAW_LIMIT, Math.max(-EYE_YAW_LIMIT, eyeLook.yaw + dYaw));
  // 先夹偏航再按新偏航算低头上限：这样"先低头到底再转头"也会被逐步抬起来，
  // 而不是留下一个只能靠转头进入、进去了就出不来的穿帮姿态
  eyeLook.pitch = Math.min(EYE_PITCH_UP, Math.max(-pitchDownAt(eyeLook.yaw), eyeLook.pitch + dPitch));
}

// DEV 调参/验收后门：控制台可直接读写轨道参数与头部锚点
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__camOrbit = {
    orbit,
    eyeLook,
    eyeLimits,
    playerEye,
    eyeRise,
    EYE_RISE_LOOK_OFF,
    resetEyeRise,
    PLAYER_HEAD,
    PLAYER_TORSO,
    NPC_HEAD,
    ORBIT_LIMITS,
    ORBIT_MIN_Y,
    pitchDownAt,
    EYE_YAW_LIMIT,
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
