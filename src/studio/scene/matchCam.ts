// ★★ 匹配页 / 穿窗转场（2026-11-27，`feat/gs-moon-window`）：镜头状态的唯一出处。
//
// 状态机（stage）：
//   idle    —— 默认机位（设计机位，NPC 对面那张长桌）。相机归 CameraRig 原来那套。
//   page    —— **匹配页**：站在窗正前方（`moonWindow.pagePose`，离窗 1.6 m、平视月亮）。
//   fly     —— 点「匹配」之后：沿"相机→窗心"的直线往前穿窗（1.5 s，easeInCubic 加速）。
//              穿过窗面那一拍把黑幕拉到 1（CSS 0.4 s 淡入）；到终点 → outside。
//   outside —— 人在窗外、黑幕全黑（"加载 / 匹配中"那一屏就盖在这上面）。
//   covered —— 超时/退回之后：相机已经复位到设计机位，但**黑幕还留着**（匹配中那一屏还在）。
//              用户点了「用 AI 开局」或取消，再走 leaveMatchPage() 把黑幕淡出。
//
// ★ 为什么状态放模块级 zustand、而**时间轴**放模块变量：CameraRig 每帧只读位姿（不能每帧
//   触发 React 重渲），黑幕与 UI 要订阅；两层各取所需。状态变化只有几次，不是每帧。
// ★ 转场必须能**中途取消**：`cancelMatchCine()` 立刻把相机按回设计机位（`snap` 一位，
//   CameraRig 下一帧直接赋值、不走缓动）、黑幕淡出、并让 `beginFlyThrough()` 的 promise
//   回 "cancelled" —— 大厅那边就不会再去调 chooseMatch（否则取消完还能进匹配队列）。
// ★ 与大厅/匹配流程的接线只在 `ui/Lobby`：它 await 这里的 promise 之后才调
//   `lobbyStore.chooseMatch`，匹配逻辑本身一行没改（findMatch / 队列 / AI 补位都照旧）。
import { create } from "zustand";
import { defaultCamFor, gsSceneMetric } from "./layout";
import { CROSS_T, WINDOW, flyPose, moonDisc, pagePose, type CamPose } from "./moonGeometry";
import { skipIntroCam } from "./introCam";
import { gsLookReset } from "./gsLook";

export type MatchCamStage = "idle" | "page" | "fly" | "outside" | "covered";
/** `beginFlyThrough()` 的两种结局：done = 飞完了（可以去走匹配流程）；cancelled = 被取消了 */
export type FlyResult = "done" | "cancelled";

interface MatchCamState {
  stage: MatchCamStage;
  /** 全屏黑幕（0/1；CSS 过渡负责 0.4 s 淡入淡出）。DOM 在 ui/MatchCurtain 与 ui/Lobby 里 */
  veil: 0 | 1;
  /** 黑幕瞬间切换（只有 DEV 的截图钩子用；正常转场一律走 CSS 过渡） */
  instant: boolean;
}

export const useMatchCam = create<MatchCamState>(() => ({ stage: "idle", veil: 0, instant: false }));

/** 穿窗总时长（ms）。主人给的范围 1.2~1.6 s，取 1.5：穿窗后还有约 0.5 s 继续往外飞 + 淡黑。 */
export const FLY_MS = 1500;

/** 线性进度 0..1 */
let t = 0;
/** DEV 截图钩子：非 null 时时间轴冻结在这个进度（见文件尾的 __matchCam） */
let frozen: number | null = null;
/** 下一帧让相机**直接**落在设计机位（取消 / 复位用）——CameraRig 用一次就清掉 */
let snap = false;
/** 当前这一发飞行的票据：取消/重开时作废旧 promise 的回包 */
let token = 0;
let waiters: Array<(r: FlyResult) => void> = [];
let fallback: number | null = null;
/** 黑幕是否已经拉到 1（一次飞行里只写一次 React 状态） */
let veilDone = false;

/** 匹配页这一套只在**米制 splat 场景**里有意义：老书房那扇窗的几何是另一套（layout 里没有它的世界坐标），
 *  而且老场景的开场运镜是逐字节要保住的 —— 老场景一律返回 false，大厅照旧走原来的流程。 */
export function matchCamAvailable(): boolean {
  return gsSceneMetric();
}

/** 当前是不是"这一层在管相机"（匹配页 / 飞行 / 窗外）。黑幕下（covered）不算：那时相机已复位。 */
export function matchCamMoving(): boolean {
  const s = useMatchCam.getState().stage;
  return s === "page" || s === "fly" || s === "outside";
}

/** 相机这一帧该不该直接按到设计机位（读取即清）。 */
export function consumeMatchSnap(): boolean {
  if (!snap) return false;
  snap = false;
  return true;
}

/** 设计机位（取消/复位之后回到这里）——与 TableScene 的默认机位读同一个函数。 */
export function matchDesignPose(aspect: number): CamPose {
  const c = defaultCamFor(aspect);
  return { pos: [c.pos[0], c.pos[1], c.pos[2]], look: [c.look[0], c.look[1], c.look[2]] };
}

function stopFallback(): void {
  if (fallback !== null) {
    window.clearTimeout(fallback);
    fallback = null;
  }
}

/** 把等的调用方一次性叫醒（Promise 只回一次；重复调用是空操作）。 */
function settle(result: FlyResult): void {
  const w = waiters;
  waiters = [];
  for (const fn of w) fn(result);
}

/** 进入匹配页：镜头搬到窗正前方。大厅一开就调（openLobby / 重进工坊带 ?lobby=1）。 */
export function enterMatchPage(): void {
  if (!matchCamAvailable()) return;
  // 开场运镜与匹配页抢镜头：直接收掉（米制档本来也会 skipIntroCam，这里再兜一次老路径）
  skipIntroCam();
  // 米制档的小幅环视（±6°/±3°）不能在匹配页里残留：回来时视线会歪
  gsLookReset();
  t = 0;
  frozen = null;
  veilDone = false;
  useMatchCam.setState({ stage: "page", veil: 0, instant: false });
}

/**
 * 点「匹配」那一下：从匹配页机位朝窗推进、穿窗、继续往外。
 * 返回的 promise 在**黑幕淡完之后** resolve（大约 1.5 s）；被取消时回 "cancelled"。
 * ★ 老场景（matchCamAvailable 为假）直接回 "done"：调用方照原流程进匹配，不演戏。
 */
export function beginFlyThrough(): Promise<FlyResult> {
  if (!matchCamAvailable()) return Promise.resolve("done");
  if (useMatchCam.getState().stage !== "page") enterMatchPage();
  const mine = ++token;
  t = 0;
  frozen = null;
  veilDone = false;
  useMatchCam.setState({ stage: "fly", veil: 0, instant: false });
  stopFallback();
  // ★ 兜底：rAF 被切后台/长卡顿掐住时，时间轴不会走到终点，而大厅在 await ——
  //   到点照"飞完了"结案，黑幕已经是 1，画面没有差别；宁可多走一步也不要把大厅卡死（铁律八）。
  fallback = window.setTimeout(() => {
    if (mine !== token) return;
    landOutside();
  }, FLY_MS + 600);
  return new Promise<FlyResult>((resolve) => {
    waiters.push(resolve);
  });
}

/** 飞到头：人已在窗外、黑幕全黑，大厅可以去进匹配队列了。 */
function landOutside(): void {
  stopFallback();
  t = 1;
  frozen = null;
  useMatchCam.setState({ stage: "outside", veil: 1 });
  settle("done");
}

/** 取消这一发（用户按返回 / 点取消 / 关大厅）：立刻复位到设计机位，黑幕淡出。 */
export function cancelMatchCine(): void {
  token++;
  stopFallback();
  t = 0;
  frozen = null;
  veilDone = false;
  snap = true;
  gsLookReset();
  useMatchCam.setState({ stage: "idle", veil: 0, instant: false });
  settle("cancelled");
}

/** 从匹配中/窗外回到工坊（匹配成功、取消、超时、关大厅）：相机复位到设计机位、黑幕淡出。 */
export function leaveMatchPage(): void {
  const st = useMatchCam.getState().stage;
  if (st === "idle") return; // 已经是设计机位：别在无关的重渲里再 snap 一次（会打断用户环视）
  token++;
  stopFallback();
  t = 0;
  frozen = null;
  veilDone = false;
  snap = true;
  gsLookReset();
  useMatchCam.setState({ stage: "idle", veil: 0, instant: false });
  settle("cancelled");
}

/** 超时：相机复位到设计机位，但**匹配中那一屏还开着** —— 黑幕留着（否则会看见桌子）。 */
export function coverDesign(): void {
  if (!matchCamAvailable()) return;
  token++;
  stopFallback();
  t = 0;
  frozen = null;
  veilDone = false;
  snap = true;
  useMatchCam.setState({ stage: "covered", veil: 1, instant: false });
  settle("cancelled");
}

/** 缓动：easeInCubic（起步慢、越走越快）—— "朝窗推过去"的速度感；穿窗那段最快，
 *  穿出去时黑幕正好开始淡入，末段（第 1.5 s）停在窗外。进度 t 是**线性时间**，
 *  位姿要走 `t³`（flyPose 收的是已缓动的 e）。 */
function ease(t: number): number {
  return t * t * t;
}

/** 复用对象：每帧都算，别在渲染循环里造垃圾 */
const POSE: CamPose = { pos: [0, 0, 0], look: [0, 0, 0] };

/**
 * 推进一帧。返回 null = 这一帧相机不归匹配页管（idle / covered，走 CameraRig 原来那套）。
 * ★ dt 夹到 0.1 s：切后台回来一次长卡顿不该让镜头瞬移到窗外（与 introCam 同一个理由）。
 */
export function stepMatchCam(dt: number): CamPose | null {
  if (!matchCamAvailable()) {
    // splat 加载失败 / 实验档被关掉：这一层必须自己退场，否则黑幕会永远盖着屏幕。
    if (useMatchCam.getState().stage !== "idle") {
      token++;
      stopFallback();
      frozen = null;
      useMatchCam.setState({ stage: "idle", veil: 0, instant: false });
      settle("cancelled");
    }
    return null;
  }
  const { stage } = useMatchCam.getState();
  if (stage === "page") return pagePose();
  if (stage === "outside") return flyPose(1, POSE);
  if (stage !== "fly") return null;
  if (frozen !== null) return flyPose(ease(frozen), POSE);
  t = Math.min(1, t + (Math.max(0, Math.min(dt, 0.1)) * 1000) / FLY_MS);
  // 穿窗那一拍开始淡黑（0.4 s；到飞行结束时早就全黑）
  if (!veilDone && t >= CROSS_T) {
    veilDone = true;
    useMatchCam.setState({ veil: 1 });
  }
  if (t >= 1) {
    landOutside();
    return flyPose(1, POSE);
  }
  return flyPose(ease(t), POSE);
}

// ── DEV 验收钩子（正式包默认没有）──────────────────────────────────────────
// 穿窗只有 1.5 s，模拟器截图（adb screencap）追不上那一刻 —— 用 freeze(t) 把时间轴
// 定在指定进度（黑幕同步瞬间切换），拍完 resume()。与 __introCam / __gsFire 同一种做法。
// ★ 写 localStorage `gsAcceptDebug=1`（与 __gsAccept 探针同一把开关）时正式包也挂出来：
//   production APK 的模拟器验收要冻帧截"穿窗那一拍"，不必为验收单独编一个 DEV 包。
const acceptHooksOn =
  import.meta.env.DEV ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptHooksOn) {
  (window as unknown as Record<string, unknown>).__matchCam = {
    get stage() {
      return useMatchCam.getState().stage;
    },
    get veil() {
      return useMatchCam.getState().veil;
    },
    get t() {
      return t;
    },
    page: enterMatchPage,
    fly() {
      void beginFlyThrough();
    },
    cancel: cancelMatchCine,
    restore: leaveMatchPage,
    cover: coverDesign,
    /** 窗洞 / 月亮盘的世界几何（验收脚本要拿它把窗洞投影到屏幕上量"月亮占窗"） */
    windowInfo() {
      return { center: WINDOW.center, radius: WINDOW.radius, moon: moonDisc() };
    },
    /** 把飞行进度冻结在 t（0..1）；黑幕按"是否已穿窗"瞬间给到位。
     *  veilForce 传 0 = 穿窗那一拍**不要黑幕**（验收要拍"画面已经在窗外"那一张）。 */
    freeze(v: number, veilForce?: 0 | 1) {
      const tt = Math.max(0, Math.min(1, v));
      token++;
      stopFallback();
      t = tt;
      frozen = tt;
      useMatchCam.setState({ stage: "fly", veil: veilForce ?? (tt >= CROSS_T ? 1 : 0), instant: true });
      settle("cancelled");
    },
    resume() {
      frozen = null;
    },
  };
}
