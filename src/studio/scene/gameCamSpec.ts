// 对局三机位的**纯参数 + 纯位姿数学**（2026-11-28，相机与流程机这一轮）。
//
// 为什么把这一半单独拆出来：
//   ① 三机位的数（过渡时长 / 距离上下限 / 环视角度上限 / 点 NPC 拉近距离）是主人要验收的**事实**，
//      它们必须能被 `scripts/check-game-matchflow.mjs` 在 Node 里直接读 —— 而 scene/gameCam.ts 依赖
//      three 与 layout（Vite 的 import.meta.env），Node 里 import 不动；
//   ② 位姿是从头骨 + 面朝方向算出来的（换模型 / 挪站位都自动成立），这一段是纯函数，
//      可以直接拿一组假头骨跑正反例，不必起 WebGL。
// ★ 运行时那一半（模块单例状态 / 过渡缓动 / 照相机赋值）在 scene/gameCam.ts，它 import 这一份。
// ★ 单位：米 / 弧度（位姿里的角与距离都是世界单位；度只出现在常量与验收读数里）。
import { GS_LOOK } from "./gsLook.ts";

/** 机位种类：三机位里的 NPC 正面机位按距离分"基准 / 拉近"两个读数，但走的是同一段代码。 */
export type GameCamPos = readonly [number, number, number];

/** 三机位的全部可验收参数（读数走 `__gameCam.snapshot()`；改这里就是改相机行为，别在别处写死）。 */
export const GAME_CAM = {
  /** 任何一次机位切换的过渡时长（ms）。主人要求 ≤0.6 s，这里就取上限。 */
  transitionMs: 600,
  /** NPC 正面机位的基准距离（m）：站在她正前方、看得见脸与上半身。 */
  npcFrontDistance: 1.6,
  /** 点 NPC 拉近到的距离（m）。 */
  npcCloseDistance: 0.8,
  /** 距离上下限（m）：双指捏合 / 滚轮只能在这一段里走。 */
  distanceMin: 0.8,
  distanceMax: 1.6,
  /** 自由环视上限（度）：与工坊米制档那套「小幅环视」同一个数（沿用旧 handler 的限幅）。 */
  freeLookMaxYawDeg: GS_LOOK.yawMaxDeg,
  freeLookMaxPitchDeg: GS_LOOK.pitchMaxDeg,
  /** 灵敏度（弧度/px）也与 gsLook 同一个数：一指拖满约 75 px = 6°。 */
  freeLookYawPerPx: GS_LOOK.yawPerPx,
  freeLookPitchPerPx: GS_LOOK.pitchPerPx,
  /** 捏合 / 滚轮的距离灵敏度（m/px）：手指横向挪 200 px = 0.8 m（0.8 ↔ 1.6 的整段）。 */
  zoomPerPx: 0.004,
  /** 距离跟随的平滑时间常数（1/s）：点 NPC 不是瞬移到脸上，约 0.2 s 贴过去。 */
  distanceEasePerSec: 12,
} as const;

/** 环视上限（弧度） */
export const FREE_LOOK_YAW_MAX = (GAME_CAM.freeLookMaxYawDeg * Math.PI) / 180;
/** 环视俯仰上限（弧度） */
export const FREE_LOOK_PITCH_MAX = (GAME_CAM.freeLookMaxPitchDeg * Math.PI) / 180;

/** 把环视偏移夹进 ±6°/±3°（正 = 视线左 / 上，与 gsLook 同向）。 */
export function clampFreeLook(yaw: number, pitch: number): { yaw: number; pitch: number } {
  return {
    yaw: Math.min(FREE_LOOK_YAW_MAX, Math.max(-FREE_LOOK_YAW_MAX, yaw)),
    pitch: Math.min(FREE_LOOK_PITCH_MAX, Math.max(-FREE_LOOK_PITCH_MAX, pitch)),
  };
}

/** 把到 NPC 的距离夹进 0.8~1.6 m。坏值（NaN）按基准距离算，绝不把 NaN 送进相机。 */
export function clampNpcDistance(distance: number): number {
  if (!Number.isFinite(distance)) return GAME_CAM.npcFrontDistance;
  return Math.min(GAME_CAM.distanceMax, Math.max(GAME_CAM.distanceMin, distance));
}

/** 叉积（纯数组；与 three 的 Vector3.cross 同一条右手规则） */
function cross(a: GameCamPos, b: GameCamPos): GameCamPos {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: GameCamPos): GameCamPos {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-8)) return [0, 0, -1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** 罗德里格斯：向量绕单位轴旋转 rad（与 three 的 applyAxisAngle 同一个方向）。 */
function rotate(v: GameCamPos, axis: GameCamPos, rad: number): GameCamPos {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const k = cross(axis, v);
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2];
  return [
    v[0] * c + k[0] * s + axis[0] * d * (1 - c),
    v[1] * c + k[1] * s + axis[1] * d * (1 - c),
    v[2] * c + k[2] * s + axis[2] * d * (1 - c),
  ];
}

/**
 * NPC 正面机位的位姿：站在她**正前方** distance 米、与头同高，看向她的头。
 * ★ 用头骨世界坐标 + 面朝方向现算，不写死世界坐标：换模型 / 挪站位 / 老场景与米制房两套布局都成立。
 * ★ 自由环视是**转视线**（位置不动）：右拖看左、下拖看上；只 ±6°/±3°，离她 0.8 m 时也不会把她转出画。
 */
export function npcFrontPose(
  head: GameCamPos,
  forward: GameCamPos,
  distance: number,
  yaw: number,
  pitch: number,
): { pos: [number, number, number]; look: [number, number, number] } {
  const d = clampNpcDistance(distance);
  const f = normalize(forward);
  const pos: GameCamPos = [head[0] + f[0] * d, head[1] + f[1] * d, head[2] + f[2] * d];
  let dir = normalize([head[0] - pos[0], head[1] - pos[1], head[2] - pos[2]]);
  dir = rotate(dir, [0, 1, 0], yaw);
  const right = normalize(cross(dir, [0, 1, 0]));
  dir = rotate(dir, right, pitch);
  const look: GameCamPos = [pos[0] + dir[0] * Math.max(0.2, d), pos[1] + dir[1] * Math.max(0.2, d), pos[2] + dir[2] * Math.max(0.2, d)];
  return { pos: [pos[0], pos[1], pos[2]], look: [look[0], look[1], look[2]] };
}
