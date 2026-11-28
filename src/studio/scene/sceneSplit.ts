// ★★ 两套场景的拆分（2026-11-27，`feat/gs-scene-split`）—— 主人这一轮的核心：
//
//   · **匹配页 / 大厅（未开局）** = 只挂 `lobby` 这一套：窗景 splat（`window-*.spz`，12 万点）
//     + 窗框 / 窗棂 mesh + 窗内点光。**不挂房间那份 1.6M spz（24.8 MB）**，也不挂桌子 / NPC / 火。
//   · **匹配成功 → 进入房间**（或者正常的工坊：没有大厅）= 只挂 `room` 这一套：房间 1.6M spz
//     + 灯组 / 火 / 窗框；**窗洞改用平贴图（webp）**，窗景 splat 卸载。
//
// 为什么要有这个模块（而不是在 `GsStep0Environment` 里写两句 if）：
//   ① **释放要能数出来**。交接时两套的 SplatMesh / SparkRenderer 必须真的 dispose，
//      不能"眼不见为净"（内存里两份 1.6M 级的都在就白拆了）。计数器在这里，验收探针读它。
//   ② **房间加载期间的黑幕**要知道"房间到哪一步了"：`ui/MatchCurtain` 订阅这里的 `roomPhase`，
//      房间没就绪就不许把黑幕撤掉（宁可多黑 1 秒，也不能让人看见空洞）。
//   ③ 验收读数（大厅/房间 fps、`renderer.info.memory`、加载耗时）只有一处出口，别散在组件里。
//
// ★ 判据只有一处（`effectiveSceneKind`）：
//   · `inGame` = 有一局 → room（不管大厅开没开：大厅在对局里自己隐身）；
//   · `lobbyStore.open` → lobby；
//   · 冷启动带 `?lobby=1`（`markBootLobbyIntent`，main.tsx 开机时标）→ **第一帧就按 lobby 挂**，
//     否则 openLobby 那个 effect 跑之前房间的 lazy chunk 可能已经把 24.8 MB 的下载发出去
//     （chunk 在缓存里时尤其快）——那正是这一轮要消掉的等待。
//
// ★ 依赖方向：scene 不 import 任何 store 来做判断（`lobbyOpen` / `inGame` 由调用方传进来）。
//   3D 那一层只画，不数（与 TableScene 的纪律一致）。
import { useSyncExternalStore } from "react";
import type { WebGLRenderer } from "three";

export type GsSceneKind = "lobby" | "room";
/** 房间那份 1.6M spz 在本轮挂载里的状态（idle = 没挂 / 已经卸掉） */
export type RoomPhase = "idle" | "loading" | "ready" | "failed";

export interface SceneSplitSnapshot {
  kind: GsSceneKind;
  roomPhase: RoomPhase;
  /** 大厅这一档挂上来的时刻（performance.now；0 = 还没挂过） */
  lobbyAt: number;
  /** 窗景 splat 就绪的时刻（大厅里第一个就绪的那一张） */
  lobbyWindowAt: number;
  /** 窗景就绪之后的第一帧（真的画到屏幕上） */
  lobbyFrameAt: number;
  /** 大厅这一档挂上来 → 窗景真正出画面（ms；没量到 = 0） */
  lobbyWindowMs: number;
  /** 房间这一轮挂载的起点 / 就绪 / 第一帧 */
  roomMountAt: number;
  roomReadyAt: number;
  roomFrameAt: number;
  /** 房间 spz 从建 SplatMesh 到就绪（ms） */
  roomLoadMs: number;
  /** 房间 spz 就绪之后的第一帧（黑幕要等它） */
  roomFrameMs: number;
  /** 累计：挂过几次房间 / 成功几次 / 失败几次 */
  roomMounts: number;
  roomLoads: number;
  roomFails: number;
  /** 释放计数（建与放要能对上：`disposed === created` 才算真的放干净） */
  roomSplatsCreated: number;
  roomSplatsDisposed: number;
  sparkCreated: number;
  sparkDisposed: number;
  windowSplatsCreated: number;
  windowSplatsDisposed: number;
  /** 最近一秒的读数（`SceneSplitProbe` 每秒刷） */
  fps: number;
  drawCalls: number;
  tris: number;
  /** `renderer.info.memory` 的最近一次读数 */
  mem: { geometries: number; textures: number } | null;
  /** `renderer.info.programs.length`（splat 的 program 有没有跟着释放，一起看） */
  programs: number;
  /** 场景里此刻还挂着几个 SplatMesh / SparkRenderer（**两份都在吗**的硬证据） */
  splatMeshes: number;
  sparkRenderers: number;
  /** SparkRenderer.lodInstances 里还留着几条（LOD 纹理；卸掉 SplatMesh 后它可能还挂着） */
  lodInstances: number;
}

const EMPTY: SceneSplitSnapshot = {
  kind: "room",
  roomPhase: "idle",
  lobbyAt: 0,
  lobbyWindowAt: 0,
  lobbyFrameAt: 0,
  lobbyWindowMs: 0,
  roomMountAt: 0,
  roomReadyAt: 0,
  roomFrameAt: 0,
  roomLoadMs: 0,
  roomFrameMs: 0,
  roomMounts: 0,
  roomLoads: 0,
  roomFails: 0,
  roomSplatsCreated: 0,
  roomSplatsDisposed: 0,
  sparkCreated: 0,
  sparkDisposed: 0,
  windowSplatsCreated: 0,
  windowSplatsDisposed: 0,
  fps: 0,
  drawCalls: 0,
  tris: 0,
  mem: null,
  programs: 0,
  splatMeshes: 0,
  sparkRenderers: 0,
  lodInstances: 0,
};

let S: SceneSplitSnapshot = EMPTY;
const listeners = new Set<() => void>();
/** 场景渲染器（探针从 Canvas 里注册；snapshot 要读 `renderer.info.memory`） */
let glRef: WebGLRenderer | null = null;
/** 场景根（snapshot 里数 "现在挂了几个 SplatMesh" —— 两份都在吗的硬证据） */
let sceneRef: { traverse: (fn: (o: unknown) => void) => void } | null = null;
/** fps 累加器（每秒结算一次） */
let frames = 0;
let fpsT0 = 0;

function patch(p: Partial<SceneSplitSnapshot>): void {
  S = { ...S, ...p };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 大厅这一档（订阅：只在切换的那一下重渲） */
export function useSceneKind(): GsSceneKind {
  return useSyncExternalStore(subscribe, () => S.kind);
}

/** 房间 spz 的状态（`MatchCurtain` 靠它决定黑幕撤不撤） */
export function useRoomPhase(): RoomPhase {
  return useSyncExternalStore(subscribe, () => S.roomPhase);
}

// ── 冷启动直接进大厅（`/studio?lobby=1`）────────────────────────────────────
let bootLobby = false;
/** main.tsx 开机时调一次：地址里带 `?lobby=1` 就标上（HashRouter 的 query 在 hash 里） */
export function markBootLobbyIntent(): void {
  bootLobby = true;
}
/** 大厅真的打开了（`ui/Lobby` 那个 effect）：从这以后只认 `lobbyStore.open` */
export function markLobbyOpened(): void {
  bootLobby = false;
}
/** 这一帧该挂哪一套。判据只在这里（见文件头 ★） */
export function effectiveSceneKind(lobbyOpen: boolean, inGame: boolean): GsSceneKind {
  if (inGame) return "room";
  if (lobbyOpen) return "lobby";
  return bootLobby ? "lobby" : "room";
}

// ── 场景切换 / 房间加载状态 ────────────────────────────────────────────────
/** `GsStep0Environment` 在 effect 里报一次（渲染期不写模块状态） */
export function markSceneKind(kind: GsSceneKind): void {
  if (S.kind === kind) return;
  const now = performance.now();
  if (kind === "lobby") {
    // 每次从房间切回大厅都是新的一轮：清掉上一轮大厅的读数（vis 验收要的是"这一次"）
    patch({ kind, lobbyAt: now, lobbyWindowAt: 0, lobbyFrameAt: 0, lobbyWindowMs: 0 });
    console.info("[split] 场景 → lobby（只挂窗景 splat + 窗框，房间 spz 不加载）");
  } else {
    patch({ kind, roomFrameAt: 0 });
    console.info("[split] 场景 → room（房间 spz + 平贴图窗洞，窗景 splat 已卸载）");
  }
}

/** `GsStep0Room` 建好 SplatMesh 的那一拍 */
export function markRoomMounted(): void {
  patch({
    roomPhase: "loading",
    roomMountAt: performance.now(),
    roomReadyAt: 0,
    roomFrameAt: 0,
    roomLoadMs: 0,
    roomFrameMs: 0,
    roomMounts: S.roomMounts + 1,
  });
}

/** 房间 spz 就绪（`initialized` resolve） */
export function markRoomReady(): void {
  const now = performance.now();
  patch({
    roomPhase: "ready",
    roomReadyAt: now,
    roomLoadMs: S.roomMountAt > 0 ? Math.round(now - S.roomMountAt) : 0,
    roomLoads: S.roomLoads + 1,
  });
  console.info(`[split] 房间 spz 就绪：${S.roomLoadMs} ms（本轮第 ${S.roomLoads} 次成功挂载）`);
}

/** 房间 spz 失败（超时 / 解析错 / WebGL 能力不够） */
export function markRoomFailed(): void {
  patch({ roomPhase: "failed", roomFails: S.roomFails + 1 });
  console.warn("[split] 房间 spz 失败 → 这一轮回退程序化书房");
}

/** 房间那一套卸载（释放完再调）：phase 回 idle —— 下一次挂载重新计时 */
export function markRoomDisposed(): void {
  const phase = S.roomPhase;
  if (phase === "loading" || phase === "ready") patch({ roomPhase: "idle" });
  console.info(
    `[split] 房间卸载：SplatMesh ${S.roomSplatsDisposed}/${S.roomSplatsCreated} 已释放，` +
      `SparkRenderer ${S.sparkDisposed}/${S.sparkCreated} 已释放`,
  );
}

/** 建/放计数（`GsStep0Room` / `LobbyScene` / `WindowSplat` 各报各的） */
export function noteRoomSplatCreated(): void {
  patch({ roomSplatsCreated: S.roomSplatsCreated + 1 });
}
export function noteRoomSplatDisposed(): void {
  patch({ roomSplatsDisposed: S.roomSplatsDisposed + 1 });
}
export function noteSparkCreated(): void {
  patch({ sparkCreated: S.sparkCreated + 1 });
}
export function noteSparkDisposed(): void {
  patch({ sparkDisposed: S.sparkDisposed + 1 });
}
export function noteWindowSplatCreated(): void {
  patch({ windowSplatsCreated: S.windowSplatsCreated + 1 });
}
export function noteWindowSplatDisposed(): void {
  patch({ windowSplatsDisposed: S.windowSplatsDisposed + 1 });
}

/** 窗景 splat 就绪（大厅里那一张）：大厅的"可交互"读数就是它 */
export function markLobbyWindowReady(): void {
  if (S.kind !== "lobby" || S.lobbyWindowAt > 0) return;
  const now = performance.now();
  patch({
    lobbyWindowAt: now,
    lobbyWindowMs: S.lobbyAt > 0 ? Math.round(now - S.lobbyAt) : 0,
  });
  console.info(`[split] 大厅窗景 splat 就绪：${S.lobbyWindowMs} ms（从进大厅算）`);
}

// ── 每帧探针 ───────────────────────────────────────────────────────────────
export function registerSceneRenderer(
  gl: WebGLRenderer | null,
  scene?: { traverse: (fn: (o: unknown) => void) => void } | null,
): void {
  glRef = gl;
  sceneRef = scene ?? null;
}

/** `SceneSplitProbe` 每帧调：结算 fps / 记"第一帧"（黑幕与验收都要它） */
export function sceneSplitTick(now: number): void {
  if (S.kind === "lobby" && S.lobbyWindowAt > 0 && S.lobbyFrameAt === 0) {
    patch({ lobbyFrameAt: now });
    console.info(`[split] 大厅窗景出画面：${Math.round(now - S.lobbyAt)} ms（从进大厅算）`);
  }
  if (S.kind === "room" && S.roomReadyAt > 0 && S.roomFrameAt === 0) {
    patch({
      roomFrameAt: now,
      roomFrameMs: S.roomMountAt > 0 ? Math.round(now - S.roomMountAt) : 0,
    });
    console.info(`[split] 房间第一帧：${S.roomFrameMs} ms（从挂载算）`);
  }
  frames += 1;
  if (fpsT0 === 0) fpsT0 = now;
  const dt = now - fpsT0;
  if (dt < 1000) return;
  const gl = glRef;
  patch({
    fps: Math.round((frames * 1000) / dt),
    drawCalls: gl?.info.render.calls ?? 0,
    tris: gl?.info.render.triangles ?? 0,
    mem: gl ? { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures } : null,
    programs: gl?.info.programs?.length ?? 0,
  });
  frames = 0;
  fpsT0 = now;
}

/** 验收快照（真机读数走它；`__gsSplit.snapshot()`） */
export function sceneSplitSnapshot(): SceneSplitSnapshot {
  const gl = glRef;
  let splatMeshes = 0;
  let sparkRenderers = 0;
  let lodInstances = 0;
  if (sceneRef) {
    sceneRef.traverse((o) => {
      const any = o as {
        name?: string;
        userData?: { gsSplat?: string };
        lodInstances?: Map<unknown, unknown>;
      };
      // ★ 不能按类名数：Vite 预打包会把 Spark 的类名压成 `_a12`（2026-11-27 踩过）。
      //   建的时候打了标记（`gs-spark-*` / `userData.gsSplat`），这里只认标记。
      if (typeof any.name === "string" && any.name.startsWith("gs-spark")) {
        sparkRenderers += 1;
        lodInstances += any.lodInstances?.size ?? 0;
      }
      if (any.userData?.gsSplat) splatMeshes += 1;
    });
  }
  return {
    ...S,
    fps: S.fps,
    drawCalls: gl?.info.render.calls ?? S.drawCalls,
    tris: gl?.info.render.triangles ?? S.tris,
    mem: gl ? { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures } : S.mem,
    programs: gl?.info.programs?.length ?? S.programs,
    splatMeshes,
    sparkRenderers,
    lodInstances,
  };
}

/** 场景里现在有几个 SplatMesh（DOM 之外的那条"两份都在吗"的硬证据） */
export function countSplatMeshes(scene: { traverse: (fn: (o: unknown) => void) => void }): number {
  let n = 0;
  scene.traverse((o) => {
    const any = o as { isSplatMesh?: boolean };
    if (any.isSplatMesh) n += 1;
  });
  return n;
}

/** DEV 抓图页的强制档（`design/gs-window-shot.tsx` 用；生产构建里没人写它） */
let forced: GsSceneKind | null = null;
export function setSceneKindForced(kind: GsSceneKind | null): void {
  forced = kind;
}
/** 渲染时读到的那一档：强制档（DEV 抓图页）> 页面层传进来的 > 上一帧的模块状态 */
export function resolveSceneKind(sceneKind?: GsSceneKind | null): GsSceneKind {
  return forced ?? sceneKind ?? S.kind;
}

// ── 验收口子（与 `__gsAccept` 同一条约定：DEV 或 localStorage 显式开）────────
const acceptHooksOn =
  import.meta.env.DEV ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptHooksOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gsSplit = {
    snapshot: sceneSplitSnapshot,
    get kind() {
      return S.kind;
    },
    get roomPhase() {
      return S.roomPhase;
    },
    /** DEV：把场景钉在某一档（`design/gs-window-shot` 这类离线抓图页要窗景 splat 时用） */
    force(kind: GsSceneKind | null) {
      forced = kind;
    },
  };
}
