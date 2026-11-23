// 开场运镜（G1 施工单 docs/g1-scene-plan.md §4）：进工坊时，镜头从高处俯视平滑移到落点机位。
//
// ★ 为什么单开一个模块，而不是把这段写进 TableScene 的 CameraRig：
//   · 演出的事实（起点 / 时长 / 缓动 / 跳过 / 只播一次）和"这一帧相机听谁的"分开写，
//     CameraRig 每帧只问一次位姿，轨道、卡组滑梯、默认机位那几条分支照旧；
//   · 「本会话已经演过」必须是**模块级单例**：放 React state 一重渲就丢、切路由就归零，
//     会变成"每进一次工坊都俯冲一次"；也不能落盘（主人点名"同一会话内不重播"，下次开 App 照常播）；
//   · 「点一下跳过」要监听 window（手指落在顶栏/卡组条/投影窗上也得算"点了一下屏幕"），
//     监听挂在 CameraRig 的 effect 里，这里只提供"跳"这个动作。
//
// ★★ 「起点也要按 aspect 分」不是对称强迫症：两台终点机位看的方向就不一样 ——
//   横屏的 LAND_CAM 在**玩家这一侧**（pos z=7.4，回头看桌子），竖屏的 DEFAULT_CAM 在
//   桌子正上方偏玩家侧（pos z=3.0 俯视）。起点若共用横屏那组（NPC 背后 z=-6 的高点），
//   竖屏这一趟就要横跨整张桌子再拐下来，而竖屏的构图本来就窄：终点时卡组堆已经贴在
//   画面左缘（x 12.6%，它是 openDeckView 的唯一入口，见 layout.defaultCamFor 的注释），
//   中途再横摆就把"入场"变成"甩镜头"。竖屏起点因此取**沿兜底机位自己的视线后退**：
//   同一个构图、只拉远，终点框得住的东西在起点只会更靠中间。
//
// 量法：fov 50（垂直）投影到屏幕百分比，横屏 canvas **945×785（aspect 1.204，两条 15vw 常驻条之内
// 的画布）**——这一组是 **G1 当时**的舞台，G4 删掉常驻条后舞台变成整窗（1.748 / 真机 2.245）、
// 终点机位也在 G4 收尾换成了新的 layout.LAND_CAM（俯角 30.7°、近边 93.2%）；下面的横屏起点数因此
// 只在**比例关系**上仍然成立（起点是过顶点、远在桌子背后，不受终点机位微调影响，所以起点没重算）。
// 竖屏 375×812（aspect 0.462）：
//  · 横屏起点 [0,18,-6]/[0,0.4,-2]：卡组堆 x 58.3% / y 23.2%、摊开排 40.5~56.7%、
//    节点链两端 37.1~62.9%、市场排 y 44.9%、铸卡师头顶 y 62.9% —— 整张桌子与四把椅子都在画面里
//    （只有桌子**远端两角**落到 ±105%：那个距离上桌毡已经在雾里，露不露角看不出来）；
//  · 竖屏起点 [0,17.6,5.2]/[0,0,0.25]（兜底机位 [0,9.8,3.0] 沿 [0,0,0.25] 视线后退 ≈1.8 倍）：
//    卡组堆 x 30.0%、摊开排 40.6~71.5%、节点链 24.3~75.7%、市场 y 42.4%、铸卡师头顶 y 21.0%
//    —— 比终点（卡组堆 x 12.6%、节点链最右 97.4%）宽松得多，一上来不会把任何一堆甩出框。
import { defaultCamFor } from "./layout";

/** 运镜时长（毫秒）。施工单 §4 写的是 3 秒，主人点名 2.6 秒 —— 以点名为准。
 *  ★ 缓动也按点名的 easeOutCubic（起步快、末段收住 = "从高处冲下来"）。施工单里那句
 *    "前 30% 慢、中段快、末尾稳"是 easeInOutCubic 的形状，两者不是一回事：这里没有把
 *    两条曲线揉在一起（揉出来的东西既不像俯冲也不像推进，而且没人量过它）。 */
export const INTRO_CAM_MS = 2600;

/** 加载层一直不让开时的兜底（毫秒）。StudioLoader 自己的硬上限是 15 秒（loading→fading→gone），
 *  它只要在，信号一定来；这个 20 秒只兜"那个信号被后人改没了"—— 没有它，镜头会永远停在
 *  18 米高空，桌面小得像一张邮票，而且零报错（铁律八）。到点会打一条 warn，不静默。 */
const HOLD_MAX_MS = 20000;

export interface IntroPose {
  pos: [number, number, number];
  look: [number, number, number];
}

/** 一帧的结果：pose = 相机这一帧该在哪；ended = 这是运镜的最后一帧（调用方 syncOrbit 一次）。 */
export interface IntroFrame {
  pose: IntroPose;
  ended: boolean;
}

/** 横屏起点：施工单 §4 那一组（NPC 背后 18 米高的过顶点，俯视整张桌子）。 */
const LAND_INTRO_FROM: IntroPose = { pos: [0, 18, -6], look: [0, 0.4, -2] };

/** 竖屏起点：兜底机位沿自己的视线后退 ≈1.8 倍（数值与量出来的屏幕占比见文件头）。 */
const PORTRAIT_INTRO_FROM: IntroPose = { pos: [0, 17.6, 5.2], look: [0, 0, 0.25] };

/** 起点按 aspect 分：与 `defaultCamFor` 同一条判据（1.0 起算横屏），两处别各写一遍。 */
function introFromFor(aspect: number): IntroPose {
  return aspect >= 1 ? LAND_INTRO_FROM : PORTRAIT_INTRO_FROM;
}

/** easeOutCubic：1-(1-t)³。t=0.5 时已经走完 87.5%，末段几乎不动 —— 落定那一下才稳。 */
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** `prefers-reduced-motion: reduce` 就读一眼。读不到（老 WebView / 测试环境没有 matchMedia）
 *  当作"要动画"：一次读不到不该把整段运镜删掉，最多是没尊重这个偏好。 */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** idle = 还没开演（CameraRig 第一帧才 arm）；holding = 停在起点等加载层让开；
 *  running = 正在走；done = 演过了（本会话不再播，或者被跳过了）。 */
type Phase = "idle" | "holding" | "running" | "done";

let phase: Phase = "idle";
/** ★ 本会话已经播过。**内存单例，不落盘**（见文件头）。 */
let played = false;
/** 起点：arm 那一刻按当时的 aspect 定死。播放途中转屏不换起点（半路换起点会当场跳一下），
 *  终点每帧现算（见 stepIntroCam），所以最后一定落在"现在这个 aspect"的落点机位上。 */
let from: IntroPose = LAND_INTRO_FROM;
/** 线性进度 0..1（缓动在出位姿时算） */
let t = 0;
/** 加载层让开了没有（StudioPage 的 StudioLoader 在它撤掉的那一拍调 revealIntroCam） */
let revealed = false;
/** 等了加载层多久（秒），只给 HOLD_MAX_MS 的兜底用 */
let waited = 0;
/** 最近一次的 aspect（DEV 的 replay 后门要用） */
let lastAspect = 1.5;

/** 复用的位姿对象：这套代码每帧都跑，别在 rAF 里造垃圾。 */
const POSE: IntroPose = { pos: [0, 0, 0], look: [0, 0, 0] };

/**
 * 推进一帧开场运镜。返回 null = 这一帧不归运镜管（没开始 / 已经演完），调用方照旧走自己那套。
 *
 * @param dt     上一帧到这一帧的秒数（场景时钟）
 * @param aspect **画布**宽高比（camera.aspect），与 defaultCamFor 同一个判据
 */
export function stepIntroCam(dt: number, aspect: number): IntroFrame | null {
  lastAspect = aspect;
  if (phase === "idle") {
    if (played) {
      phase = "done";
      return null;
    }
    // ★ "演过了"这条记忆在这里落，不放 useEffect：StrictMode 下挂载是"挂-卸-挂"两次 effect，
    //   在第一帧里落记忆才只有真正活着的那次挂载算数（否则 dev 下开场运镜永远不播）。
    played = true;
    if (prefersReducedMotion()) {
      // 直接跳过：镜头本来就停在落点机位（Canvas 的 initCam 就是 defaultCamFor），
      // 不必再摆一次位姿 —— 少一次跳变，也少一条"动画结束后才落对"的路径。
      phase = "done";
      return null;
    }
    from = introFromFor(aspect);
    phase = "holding";
    waited = 0;
  }
  if (phase === "done") return null;
  if (phase === "holding") {
    // 加载层还盖着的时候镜头**先停在起点**：真正亮起来的第一帧就是高空俯视。
    // ★ 为什么不挂载即开走：StudioLoader 最短亮 0.9 秒、再淡出 0.5 秒，开走的话用户看见
    //   桌面时俯冲已经走完一半，像"进来就已经落好了"，那一段运镜等于白做。
    waited += dt;
    if (!revealed && waited * 1000 < HOLD_MAX_MS) return { pose: from, ended: false };
    if (!revealed) {
      console.warn("[introCam] 加载层一直没有让开，开场运镜自己走了 —— 检查 StudioLoader 里的 revealIntroCam 调用");
    }
    phase = "running";
  }
  // dt 夹到 0.1 秒：切后台/一次长卡顿回来时 dt 可能是好几秒，不夹会"啪"地瞬移到终点（与卡组
  // 滑梯那条 Math.min(dt, 0.05) 同一个理由，只是运镜更长、夹到 0.1 才不至于在 10fps 下变慢）。
  t = Math.min(1, t + Math.min(dt, 0.1) * 1000 / INTRO_CAM_MS);
  const e = easeOutCubic(t);
  // 终点每帧现算：转屏、两条常驻条改宽度都会换 aspect，最后必须落在**现在这一台**上。
  const to = defaultCamFor(aspect);
  for (let i = 0; i < 3; i++) {
    POSE.pos[i] = from.pos[i] + (to.pos[i] - from.pos[i]) * e;
    POSE.look[i] = from.look[i] + (to.look[i] - from.look[i]) * e;
  }
  if (t >= 1) {
    phase = "done";
    return { pose: POSE, ended: true };
  }
  return { pose: POSE, ended: false };
}

/** 加载层撤掉了：下一帧开始走（见 StudioPage 的 StudioLoader）。 */
export function revealIntroCam(): void {
  revealed = true;
}

/**
 * 立刻落到终点：运镜期间点一下屏幕 / 触摸拖动（施工单 §4 的"可跳过"）。
 * 没在演的时候是空操作 —— CameraRig 的监听因此可以常驻，不必随运镜挂/摘。
 * ★ 只跳运镜，**不吞这一下点击**：手指底下的卡/按钮照旧收到它。跳过是"别再演了"，
 *   不是"这一下作废"；要吞就得在 window 捕获阶段 stopPropagation，那会把 r3f 的一整套
 *   指针记账（拖动后的 click 抑制等）也一起打乱 —— 得不偿失。
 */
export function skipIntroCam(): void {
  if (phase === "done") return;
  if (phase === "idle") {
    // 第一帧之前就被点了（理论上只有几毫秒的窗口）：当作"这次也不演了"
    played = true;
    phase = "done";
    return;
  }
  revealed = true;
  t = 1;
  phase = "running";
}

/** 运镜没走完就被卸了（切路由 / 退出工坊）：收成"演过了"。
 *  ★ 不这么做的话，在加载层还盖着时退出、再进工坊时 phase 还停在 holding —— 镜头会一直
 *    停在高处，而且本会话"已经播过"又不该重播，等于永远停错。 */
export function abandonIntroCam(): void {
  if (phase === "holding" || phase === "running") phase = "done";
}

// DEV 后门：调参 / 验收时不用刷新整页就能再看一遍（正式包里没有这一段）。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__introCam = {
    /** 立刻从起点再走一遍（加载层早已撤掉，直接开走） */
    replay() {
      from = introFromFor(lastAspect);
      t = 0;
      revealed = true;
      played = true;
      phase = "running";
    },
    skip: skipIntroCam,
    get phase() {
      return phase;
    },
  };
}
