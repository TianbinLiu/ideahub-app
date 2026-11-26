// GS 米制档的**小幅环视**（2026-11-26，`feat/gs-framing-orbit-panel`，主人第 2 条）。
//
// 为什么独立成模块：手势在 `TableScene.TableCatcher`（DOM 指针层）、应用在 `TableScene.CameraRig`
// （每帧改相机朝向）、读数在 `TableScene.AcceptProbe`（验收探针）—— 三处隔着几百行，放模块级单例
// 比穿三层 props 干净；也让"极限角 / 回中时长 / 灵敏度"只有一处定义（改只改这一份）。
//
// 语义（与第一人称 eyeLook 那一套同一读法：**画面跟手**）：
//   · 指尖往右拖 ⇒ 人物/桌子往右走 ⇒ 相机**向左**看（yaw 正）；
//   · 指尖往下拖 ⇒ 画面往下走 ⇒ 相机**向上**看（pitch 正）；
//   · 松手后**缓慢回中**（默认 750 ms、ease-out 三次曲线），回到设计机位 —— 玩家不能把镜头
//     永久转走：这一档只有 ±6°/±3° 的行程，超出就硬停在边上（撞住的手感，不是弹回去）。
//
// ★ 为什么是 ±6°/±3°：splat 是 11 个伪多视角重建的，±10~15° 才出现窗圈双影/边缘拉伸
//   （docs/gs-step2-splat-log.md §5）。留一半余量取 6°，竖直到 3°（画面顶上有 HUD、底下是桌子，
//   垂直方向本来就没多少可看的行程）。
// ★ 回中做在 `CameraRig` 的每帧里（`gsLookTick`），不另起 rAF：这一档本来就有渲染循环，
//   再开一条只会多一份"面板盖着时也在跑"的空转。面板盖着时渲染循环停（frameloop=never），
//   回中自然也停 —— 松手后立刻开面板的话，关掉面板时会从停下的角度接着回中，不会卡住。
//
// ⚠ 别把这里的角接到 `cameraOrbit.eyeLook` 上：那一位是"第一人称转头"（还要驱动角色头骨），
//   而这一档没有玩家身体（SHOW_PLAYER_BODY=false），两者共用会把状态搅在一起。
import type { Camera } from "three";

/** 环视的三个数与两个灵敏度（灵敏度按"一指拖满 6° 约 75 px"定的：852 CSS 宽的画幅上约 9% 屏宽） */
export const GS_LOOK = {
  /** 水平硬停（度） */
  yawMaxDeg: 6,
  /** 垂直硬停（度） */
  pitchMaxDeg: 3,
  /** 松手回中时长（ms，实测 0.75 s 落在主人要的 0.6~0.9 s 中段） */
  returnMs: 750,
  /** 横向灵敏度（弧度/px）：75 px ≈ 6° */
  yawPerPx: 0.0014,
  /** 纵向灵敏度（弧度/px）：52 px ≈ 3°（竖屏只有 348 px 高，太灵敏会一滑到顶） */
  pitchPerPx: 0.001,
} as const;

const YAW_MAX = (GS_LOOK.yawMaxDeg * Math.PI) / 180;
const PITCH_MAX = (GS_LOOK.pitchMaxDeg * Math.PI) / 180;

let yaw = 0;
let pitch = 0;
/** 正在拖（手指按下且没抬） */
let dragging = false;
/** 回中开始时刻（performance.now；0 = 不在回中） */
let returnAt = 0;
/** 回中的起点（松手那一刻的角度） */
let fromYaw = 0;
let fromPitch = 0;

const clamp = (v: number, lim: number) => Math.min(lim, Math.max(-lim, v));

/** 按下（在空白桌面/背景上）：接管，并取消正在进行的回中 */
export function gsLookDown(): void {
  dragging = true;
  returnAt = 0;
}

/** 单指拖动（dx/dy 为本次移动的 CSS 像素）——画面跟手：右拖看左、下拖看上 */
export function gsLookDrag(dx: number, dy: number): void {
  if (!dragging) return;
  yaw = clamp(yaw + dx * GS_LOOK.yawPerPx, YAW_MAX);
  pitch = clamp(pitch + dy * GS_LOOK.pitchPerPx, PITCH_MAX);
}

/** 松手（最后一根手指抬起 / pointercancel）：开始回中 */
export function gsLookRelease(): void {
  if (!dragging) return;
  dragging = false;
  fromYaw = yaw;
  fromPitch = pitch;
  returnAt = performance.now();
}

/** 每帧推进回中（CameraRig 的 useFrame 调；ease-out 三次曲线，末段自然慢下来） */
export function gsLookTick(now: number = performance.now()): void {
  if (dragging || !returnAt) return;
  const t = (now - returnAt) / GS_LOOK.returnMs;
  if (t >= 1) {
    yaw = 0;
    pitch = 0;
    returnAt = 0;
    return;
  }
  const k = 1 - (1 - t) * (1 - t) * (1 - t);
  yaw = fromYaw * (1 - k);
  pitch = fromPitch * (1 - k);
}

/** 是不是正在环视（拖拽中 / 回中中 / 还有偏移）——验收探针与"要不要清"的判据 */
export function gsLookMoving(): boolean {
  return dragging || returnAt !== 0 || yaw !== 0 || pitch !== 0;
}

/** 当前角度（度，带符号；正 = 视线左/上） */
export function gsLookDeg(): { yaw: number; pitch: number } {
  return { yaw: (yaw * 180) / Math.PI, pitch: (pitch * 180) / Math.PI };
}

/** 归零（离开米制场景 / splat 失败回退老书房时调；不发回中动画） */
export function gsLookReset(): void {
  dragging = false;
  returnAt = 0;
  yaw = 0;
  pitch = 0;
}

/**
 * 把当前环视偏移**叠到相机朝向上**（只转朝向，不动位置）。
 * ★ 必须在 `camera.lookAt(...)` **之后**调：它改的是 lookAt 之后的四元数。
 * ★ 用局部轴 `rotateY / rotateX`（不是世界轴）：相机的上方向本来就是 lookAt 算好的，
 *   局部 Y 就是"转头"、局部 X 就是"抬头/低头"，两者顺序对调会在大角度下歪一点（这里只 ±6°/3°，
 *   两种顺序都能用，但 Y 先 X 后与人的头颈一致）。
 */
export function applyGsLook(camera: Camera): void {
  if (yaw === 0 && pitch === 0) return;
  camera.rotateY(yaw);
  camera.rotateX(pitch);
}
