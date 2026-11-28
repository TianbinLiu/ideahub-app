// 对局相机（2026-11-28，主人点名的三机位）—— **一套机位、两个阶段、三种读数**。
//
// 规格（主人原话拆成可验收的几条）：
//   ① 匹配完成进室内：相机在 NPC 对面、桌子对侧，**固定俯视桌子**；不能自由转视角 → `tableTop`。
//   ② 点「商店」：相机移到 NPC 正前方（正对铸卡师、能看到她）→ `npcFront`；**只有这一格**允许自由环视
//      （滑屏 ±6°/±3°，双指捏合 / 滚轮改距离 0.8~1.6 m），点 NPC 拉近到 0.8 m。
//   ③ 离开商店：相机复位到 `tableTop`，滑屏立即失效（`freeLookEnabled()` 为假）。
//   两个方向都是**平滑过渡 ≤0.6 s**（`GAME_CAM.transitionMs = 600`），不瞬移。
//
// ★ 参数与位姿数学在 `./gameCamSpec.ts`（零 three、Node 可 import，构建里 check-game-matchflow.mjs 实跑）；
//   这一份只放**运行时状态**：当前阶段 / 距离跟随 / 过渡缓动 / 照相机赋值。
// ★ 为什么单独开一个模块、而不是继续用 studioStore.enterShopCam 那套 orbit：
//   工坊的 orbit 是**无限期**的球面轨道（商店 ±90°、对话不限、半径 1.2~7 m），它解决的问题是
//   "逛工坊时绕模型看"。对局要的是**演出机位**：两个固定位 + 一点点自由环视，离开商店必须复位。
//   两套语义硬塞进一个 OrbitState 会让工坊那台跟着变窄（±6° 的工坊不能转 = 坏了），
//   所以对局这一套独立成模块，`tableTop` 的终点直接借工坊的 `defaultCamFor`（同一个设计机位）。
// ★ 为什么状态放模块级单例而不是 React state：CameraRig 每帧读一次位姿、手势层每次移动写一次，
//   进 React 就是每帧重渲整棵 3D 树（与 cameraOrbit / gsLook 同一条理由）。
//   阶段（stage）本身仍然是 game/store 里那一份，这里只**跟**它，不另存一份。
// ★ 零规则：这里不判"第几轮 / 商店能不能开"，只跟 matchFlow.cameraModeOf / freeLookOf 给的结论。
import * as THREE from "three";
import { defaultCamFor, gsSceneMetric } from "./layout";
import { NPC_HEAD } from "./cameraOrbit";
import {
  FREE_LOOK_PITCH_MAX,
  FREE_LOOK_YAW_MAX,
  GAME_CAM,
  clampFreeLook,
  clampNpcDistance,
  npcFrontPose,
  type GameCamPos,
} from "./gameCamSpec";
import { cameraModeOf, freeLookOf, type MatchStage } from "../game/matchFlow";

export { GAME_CAM } from "./gameCamSpec";

type CamMode = "off" | "tableTop" | "npcFront";

interface CamState {
  active: boolean;
  mode: CamMode;
  /** 当前阶段是不是开商店（自由环视的唯一开关；由 setGameCamStage 写） */
  free: boolean;
  /** 目标距离 / 正在跟过去的距离（m） */
  distance: number;
  distanceTarget: number;
  /** 自由环视偏移（弧度，正 = 视线左 / 上，与 gsLook 同向） */
  yaw: number;
  pitch: number;
  /** 平滑过渡：起点是切换那一帧的相机位姿；pending = 还没抓到起点（下一帧抓） */
  transition: { fromPos: THREE.Vector3; fromLook: THREE.Vector3; t: number } | null;
  pending: boolean;
  /** 上一次 step 时画布的宽高比（snapshot 读它算 tableTop 的设计机位） */
  aspect: number;
}

const state: CamState = {
  active: false,
  mode: "off",
  free: false,
  distance: GAME_CAM.npcFrontDistance,
  distanceTarget: GAME_CAM.npcFrontDistance,
  yaw: 0,
  pitch: 0,
  transition: null,
  pending: false,
  aspect: 1.8,
};

const _dir = new THREE.Vector3();

/** 铸卡师面朝哪：米制房（她 yaw=π/2）面朝 +x；老书房（yaw=0）面朝 +z。判据与 layout 两套场景同一处。 */
function npcForward(out: THREE.Vector3): THREE.Vector3 {
  return gsSceneMetric() ? out.set(1, 0, 0) : out.set(0, 0, 1);
}

/** `tableTop` 的设计机位（工坊默认机位：横屏 LAND_CAM / 米制 GS_CAM / 竖屏 DEFAULT_CAM）。 */
function tableTopPose(aspect: number, outPos: THREE.Vector3, outLook: THREE.Vector3): void {
  const c = defaultCamFor(aspect);
  outPos.set(c.pos[0], c.pos[1], c.pos[2]);
  outLook.set(c.look[0], c.look[1], c.look[2]);
}

/** 三机位里 NPC 正前 / 拉近那两台的读数（纯函数在 gameCamSpec，这里把头骨 / 面朝喂进去）。 */
function npcPose(distance: number, yaw: number, pitch: number): {
  pos: [number, number, number];
  look: [number, number, number];
} {
  const forward = npcForward(_dir);
  return npcFrontPose(
    [NPC_HEAD.x, NPC_HEAD.y, NPC_HEAD.z],
    [forward.x, forward.y, forward.z],
    distance,
    yaw,
    pitch,
  );
}

/** 平滑过渡的缓动（smoothstep：两端速度为 0，切换 / 落定都不"顿"一下）。 */
function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 阶段变了（GameLayer 的 effect 唯一调用点）。
 * ★ 同一阶段重复调是**幂等**的（连点商店键 / StrictMode 双跑）：mode 没变就只同步 free 标志，
 *   不重新起过渡 —— 否则每点一次都会从半路重新缓动，画面看着像在抖。
 */
export function setGameCamStage(stage: MatchStage): void {
  const mode = cameraModeOf(stage);
  const free = freeLookOf(stage);
  if (mode === "off") {
    resetGameCam();
    return;
  }
  if (state.active && state.mode === mode) {
    state.free = free;
    return;
  }
  state.active = true;
  state.mode = mode;
  state.free = free;
  // 从**当前相机位**起过渡：下一帧 stepGameCam 抓到起点才真正开始（不瞬移、也不从上一个机位的旧值飞）。
  state.pending = true;
  state.transition = null;
  if (mode === "npcFront") {
    state.distance = GAME_CAM.npcFrontDistance;
    state.distanceTarget = GAME_CAM.npcFrontDistance;
    state.yaw = 0;
    state.pitch = 0;
  }
}

/** 离开对局（结束对局 / 离开工坊 / 阶段回 matching）：立即交还相机控制权。 */
export function resetGameCam(): void {
  state.active = false;
  state.mode = "off";
  state.free = false;
  state.transition = null;
  state.pending = false;
  state.yaw = 0;
  state.pitch = 0;
  state.distance = GAME_CAM.npcFrontDistance;
  state.distanceTarget = GAME_CAM.npcFrontDistance;
}

/** 相机归这一套管着没有（TableScene 的手势层靠它把工坊原有的轨道 / 环视整段让位）。 */
export function gameCamActive(): boolean {
  return state.active;
}

/** 当前是哪一台（off / tableTop / npcFront）。取景右移（GS_FRAME_SHIFT）只给 tableTop 那一台。 */
export function gameCamMode(): CamMode {
  return state.active ? state.mode : "off";
}

/** 自由环视允许没有（**只有商店开着**；离开商店立即为假 —— 主人点名的"禁用滑屏移动"）。 */
export function freeLookEnabled(): boolean {
  return state.active && state.free;
}

/** 单指滑屏：小幅转视线（±6°/±3° 硬停；松手**不回中** —— 商店这一档是个临时的自由环视窗口，
 *  离开商店时由 exit 那一拍复位；工坊那套 gsLook 的回中行为不变）。 */
export function gameCamLookDrag(dx: number, dy: number): void {
  if (!freeLookEnabled()) return;
  const next = clampFreeLook(
    state.yaw + dx * GAME_CAM.freeLookYawPerPx,
    state.pitch + dy * GAME_CAM.freeLookPitchPerPx,
  );
  state.yaw = next.yaw;
  state.pitch = next.pitch;
}

/** 捏合 / 滚轮：改到 NPC 的距离（0.8~1.6 m；正 = 拉远）。 */
export function gameCamZoomBy(deltaMeters: number): void {
  if (!freeLookEnabled()) return;
  state.distanceTarget = clampNpcDistance(state.distanceTarget + deltaMeters);
}

/** 点 NPC：拉近到 0.8 m（距离平滑贴过去，不是瞬移；再次点保持 0.8，不来回跳）。 */
export function gameCamClickNpc(): void {
  if (!freeLookEnabled()) return;
  state.distanceTarget = GAME_CAM.npcCloseDistance;
}

/** 当前环视偏移（度，带符号；验收读数 / DEV 角标用） */
export function gameCamLookDeg(): { yaw: number; pitch: number } {
  return { yaw: (state.yaw * 180) / Math.PI, pitch: (state.pitch * 180) / Math.PI };
}

/**
 * 每帧推一次（CameraRig 调；返回 false = 相机不归这一套，调用方继续走原来那条分支）。
 * 过渡 / 距离跟随 / 自由环视都在这里收成一个位姿，CameraRig 只负责赋给相机。
 */
export function stepGameCam(
  dt: number,
  aspect: number,
  currentPos: THREE.Vector3,
  currentLook: THREE.Vector3,
  outPos: THREE.Vector3,
  outLook: THREE.Vector3,
): boolean {
  if (!state.active) return false;
  state.aspect = aspect;
  // 距离跟随（点 NPC / 捏合都是改目标值，here 做低通；dt 夹一下防止后台切回来瞬移）
  const k = 1 - Math.exp(-GAME_CAM.distanceEasePerSec * Math.min(dt, 0.1));
  state.distance += (state.distanceTarget - state.distance) * k;
  if (Math.abs(state.distanceTarget - state.distance) < 1e-4) state.distance = state.distanceTarget;

  // 目标位姿
  if (state.mode === "tableTop") {
    tableTopPose(aspect, outPos, outLook);
  } else {
    const pose = npcPose(state.distance, state.yaw, state.pitch);
    outPos.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    outLook.set(pose.look[0], pose.look[1], pose.look[2]);
  }

  // 过渡：起点是切换那一帧的真实相机位姿
  if (state.pending) {
    state.pending = false;
    state.transition = { fromPos: currentPos.clone(), fromLook: currentLook.clone(), t: 0 };
  }
  const tr = state.transition;
  if (tr) {
    tr.t += (Math.min(dt, 0.1) * 1000) / GAME_CAM.transitionMs;
    const e = ease(tr.t);
    outPos.set(
      tr.fromPos.x + (outPos.x - tr.fromPos.x) * e,
      tr.fromPos.y + (outPos.y - tr.fromPos.y) * e,
      tr.fromPos.z + (outPos.z - tr.fromPos.z) * e,
    );
    outLook.set(
      tr.fromLook.x + (outLook.x - tr.fromLook.x) * e,
      tr.fromLook.y + (outLook.y - tr.fromLook.y) * e,
      tr.fromLook.z + (outLook.z - tr.fromLook.z) * e,
    );
    if (tr.t >= 1) state.transition = null;
  }
  return true;
}

/**
 * 验收读数（`window.__gameCam.snapshot()`，写 `gsAcceptDebug=1` 或 DEV 才有）。
 * 三机位的 pos/look 都**现算**：tableTop 的设计机位随当前画幅（横/竖屏）不同，
 * 直接印一份写死的数会在真机竖屏 / 浏览器窗口里对不上。
 */
export interface GameCamSnapshot {
  active: boolean;
  mode: CamMode;
  free: boolean;
  transitionMs: number;
  tableTop: { pos: [number, number, number]; look: [number, number, number] };
  npcFront: { pos: [number, number, number]; look: [number, number, number] };
  npcClose: { pos: [number, number, number]; look: [number, number, number] };
  freeLook: { yawDeg: number; pitchDeg: number; maxYawDeg: number; maxPitchDeg: number };
  distance: { shown: number; target: number; min: number; max: number; click: number };
  npcHead: GameCamPos;
  aspect: number;
}

export function gameCamSnapshot(): GameCamSnapshot {
  const tp = new THREE.Vector3();
  const tl = new THREE.Vector3();
  tableTopPose(state.aspect, tp, tl);
  const np = npcPose(GAME_CAM.npcFrontDistance, 0, 0);
  const cp = npcPose(GAME_CAM.npcCloseDistance, 0, 0);
  const deg = gameCamLookDeg();
  return {
    active: state.active,
    mode: state.mode,
    free: state.free,
    transitionMs: GAME_CAM.transitionMs,
    tableTop: { pos: tp.toArray() as [number, number, number], look: tl.toArray() as [number, number, number] },
    npcFront: { pos: np.pos, look: np.look },
    npcClose: { pos: cp.pos, look: cp.look },
    freeLook: {
      yawDeg: deg.yaw,
      pitchDeg: deg.pitch,
      maxYawDeg: GAME_CAM.freeLookMaxYawDeg,
      maxPitchDeg: GAME_CAM.freeLookMaxPitchDeg,
    },
    distance: {
      shown: state.distance,
      target: state.distanceTarget,
      min: GAME_CAM.distanceMin,
      max: GAME_CAM.distanceMax,
      click: GAME_CAM.npcCloseDistance,
    },
    npcHead: [NPC_HEAD.x, NPC_HEAD.y, NPC_HEAD.z],
    aspect: state.aspect,
  };
}

// ── 验收口子 ────────────────────────────────────────────────────────────────
// ★ 与 `__gsAccept` 同一条约定：DEV，或者显式写了 localStorage `gsAcceptDebug=1` 才有。
//   真机验收要"点 NPC 拉近 / 滑屏 6°"这种读数，命令走 CDP 写键 + 刷新（见 docs/game-camera-phases.md）。
//   生产里没人写这个键 = 完全不存在。
// ★ `?.` 让这一份也能被 Node 的检查脚本 import（Node 没有 Vite 的 import.meta.env）
const acceptHooksOn =
  import.meta.env?.DEV === true ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptHooksOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gameCam = {
    snapshot: gameCamSnapshot,
    /** 验收用：不改阶段、只把视线推到极限（量 ±6°/±3° 的边界） */
    look(yawDeg: number, pitchDeg: number) {
      const next = clampFreeLook((yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
      state.yaw = next.yaw;
      state.pitch = next.pitch;
      return gameCamLookDeg();
    },
    zoom(distance: number) {
      state.distanceTarget = clampNpcDistance(Number(distance));
      return state.distanceTarget;
    },
    clickNpc: gameCamClickNpc,
    GAME_CAM,
    FREE_LOOK_YAW_MAX,
    FREE_LOOK_PITCH_MAX,
  };
}
