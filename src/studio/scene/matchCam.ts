// ★★ 匹配页 / 穿窗转场（2026-11-27，`feat/gs-moon-window`）——镜头状态的唯一出处。
//
// ★ 2026-11-27（`feat/gs-flythrough-dissolve`）：**演出时间线整段重写**（主人点名"窗景碎成黑白麻点，
//   效果不对"）。现在的时间轴在 `flyTimeline.ts`（常量 + 共享 uniform + 采样函数），这里只做三件事：
//   ① 把"点匹配 → 黑幕全黑"的**相机**按时间轴推进（`stepMatchCam`）；
//   ② 把黑幕的 0/1 交给页面层（CSS 0.4 s 过渡，正好是时间轴的 fade 段）；
//   ③ 中途取消 / 复位 / 超时的收口。
//   画面那一半（贴图化点、每点 stagger、点云廊、光尘）全读 `flyTimeline.FLY_U`，与相机同一拍。
//
// 状态机（stage）：
//   idle    —— 默认机位（设计机位，NPC 对面那张长桌）。相机归 CameraRig 原来那套。
//   page    —— **匹配页**：站在窗正前方（`moonGeometry.pagePose`，离窗 1.6 m、平视月亮）。
//   fly     —— 点「匹配」之后，按 `FLY_TIMELINE` 演：
//              0~0.6 s 化点（相机**不动**，贴图散成点）；
//              0.6~2.0 s 在点云廊里穿行（相机沿飞行方向前进 6.4 m，轻微横滚/抖动）；
//              2.0~2.4 s 渐黑（黑幕 CSS 0→1 的同时再往前 0.9 m）；黑幕全黑 → outside。
//   outside —— 人在窗外、黑幕全黑（"加载 / 匹配中"那一屏就盖在这上面）。
//   covered —— 超时/退回之后：相机已经复位到设计机位，但**黑幕还留着**（匹配中那一屏还在）。
//              用户点了「用 AI 开局」或取消，再走 leaveMatchPage() 把黑幕淡出。
//
// ★ 为什么状态放模块级 zustand、而**时间轴**放模块变量：CameraRig 每帧只读位姿（不能每帧
//   触发 React 重渲），黑幕与 UI 要订阅；两层各取所需。状态变化只有几次，不是每帧。
// ★ 转场必须能**中途取消**：`cancelMatchCine()` 立刻把相机按回设计机位（`snap` 一位，
//   CameraRig 下一帧直接赋值、不走缓动）、黑幕淡出、并把时间轴与所有共享 uniform 复位 ——
//   `beginFlyThrough()` 的 promise 回 "cancelled"，大厅那边就不会再去调 chooseMatch。
// ★ 与大厅/匹配流程的接线只在 `ui/Lobby`：它 await 这里的 promise 之后才调
//   `lobbyStore.chooseMatch`，匹配逻辑本身一行没改（findMatch / 队列 / AI 补位都照旧）。
import { create } from "zustand";
import { defaultCamFor, gsSceneMetric } from "./layout";
import { WINDOW, flyEndPose, flyTravelPose, moonDisc, pagePose, type CamPose } from "./moonGeometry";
import { skipIntroCam } from "./introCam";
import { gsLookReset } from "./gsLook";
import {
  FLY_TIMELINE,
  flyBegin,
  flyCancel,
  flyClock,
  flyFinish,
  flyFreeze,
  flyReducedMotion,
  flySampleAt,
  flyTick,
  flyTotalSec,
  type FlySample,
} from "./flyTimeline";

export type MatchCamStage = "idle" | "page" | "fly" | "outside" | "covered";
/** `beginFlyThrough()` 的两种结局：done = 飞完了（可以去走匹配流程）；cancelled = 被取消了 */
export type FlyResult = "done" | "cancelled";

interface MatchCamState {
  stage: MatchCamStage;
  /** 全屏黑幕（0/1；CSS 过渡负责 0.4 s 淡入淡出）。DOM 在 ui/MatchCurtain 与 ui/Lobby 里 */
  veil: 0 | 1;
  /** 黑幕瞬间切换（只有 DEV 的截图钩子用；正常转场一律走 CSS 过渡） */
  instant: boolean;
  /** 这一次转场是不是"减少动态"那一档（0.3 s 化点 + 直接淡黑，跳过穿行）。
   *  ★ 给页面层订阅用的：验收要读、`Lobby` 也可能据此少画点东西。 */
  reduced: boolean;
}

export const useMatchCam = create<MatchCamState>(() => ({ stage: "idle", veil: 0, instant: false, reduced: false }));

/** 正常档整条转场的毫秒数（2.4 s）——保留这个名字给页面层 / 老验收脚本。 */
export const FLY_MS = Math.round(flyTotalSec(false) * 1000);

/** DEV 截图钩子：非 null 时时间轴冻结在这个毫秒（见文件尾的 `__matchCam`） */
let frozen: number | null = null;
/** 下一帧让相机**直接**落在设计机位（取消 / 复位用）——CameraRig 用一次就清掉 */
let snap = false;
/** 当前这一发飞行的票据：取消/重开时作废旧 promise 的回包 */
let token = 0;
let waiters: Array<(r: FlyResult) => void> = [];
let fallback: number | null = null;
/** 黑幕是否已经拉到 1（一次飞行里只写一次 React 状态） */
let veilDone = false;
/** 当前这一拍的时间轴采样（DEV 读取 / stepMatchCam 内部复用） */
let lastSample: FlySample = flySampleAt(0, false);

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

/** 验收冻结中（DEV 的 `__matchCam.freeze`）：`ui/MatchCurtain` 的收口逻辑不许把镜头抢回去。
 *  真机验收要拍"房间那一档的窗洞"——那台相机只在匹配页机位看得见窗，冻结之后才拍得到。 */
export function matchCamFrozen(): boolean {
  return frozen !== null;
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
  flyCancel();
  frozen = null;
  veilDone = false;
  lastSample = flySampleAt(0, false);
  useMatchCam.setState({ stage: "page", veil: 0, instant: false, reduced: false });
}

/**
 * 点「匹配」那一下：从匹配页机位开始演 `FLY_TIMELINE`（化点 → 点云廊 → 渐黑）。
 * 返回的 promise 在**黑幕全黑之后** resolve（正常档约 2.4 s）；被取消时回 "cancelled"。
 * ★ 老场景（matchCamAvailable 为假）直接回 "done"：调用方照原流程进匹配，不演戏。
 */
export function beginFlyThrough(): Promise<FlyResult> {
  if (!matchCamAvailable()) return Promise.resolve("done");
  if (useMatchCam.getState().stage !== "page") enterMatchPage();
  const mine = ++token;
  frozen = null;
  veilDone = false;
  const reduced = flyReducedMotion();
  flyBegin(reduced);
  lastSample = flySampleAt(0, reduced);
  useMatchCam.setState({ stage: "fly", veil: 0, instant: false, reduced });
  stopFallback();
  // ★ 兜底：rAF 被切后台/长卡顿掐住时，时间轴不会走到终点，而大厅在 await ——
  //   到点照"演完了"结案，黑幕已经是 1，画面没有差别；宁可多走一步也不要把大厅卡死（铁律八）。
  fallback = window.setTimeout(
    () => {
      if (mine !== token) return;
      landOutside();
    },
    Math.round(flyTotalSec(reduced) * 1000) + 600,
  );
  return new Promise<FlyResult>((resolve) => {
    waiters.push(resolve);
  });
}

/** 演到头：黑幕全黑、时间轴钉在终态，大厅可以去进匹配队列了。 */
function landOutside(): void {
  stopFallback();
  frozen = null;
  flyFinish();
  lastSample = flySampleAt(flyTotalSec(useMatchCam.getState().reduced) * 1000, useMatchCam.getState().reduced);
  useMatchCam.setState({ stage: "outside", veil: 1 });
  settle("done");
}

/** 取消这一发（用户按返回 / 点取消 / 关大厅）：立刻复位到设计机位，黑幕淡出，画面回到原样。 */
export function cancelMatchCine(): void {
  token++;
  stopFallback();
  frozen = null;
  veilDone = false;
  snap = true;
  gsLookReset();
  flyCancel();
  lastSample = flySampleAt(0, false);
  useMatchCam.setState({ stage: "idle", veil: 0, instant: false, reduced: false });
  settle("cancelled");
}

/** 从匹配中/窗外回到工坊（匹配成功、取消、超时、关大厅）：相机复位到设计机位、黑幕淡出。 */
export function leaveMatchPage(): void {
  const st = useMatchCam.getState().stage;
  if (st === "idle") return; // 已经是设计机位：别在无关的重渲里再 snap 一次（会打断用户环视）
  token++;
  stopFallback();
  frozen = null;
  veilDone = false;
  snap = true;
  gsLookReset();
  flyCancel();
  lastSample = flySampleAt(0, false);
  useMatchCam.setState({ stage: "idle", veil: 0, instant: false, reduced: false });
  settle("cancelled");
}

/** 超时：相机复位到设计机位，但**匹配中那一屏还开着** —— 黑幕留着（否则会看见桌子）。 */
export function coverDesign(): void {
  if (!matchCamAvailable()) return;
  token++;
  stopFallback();
  frozen = null;
  veilDone = false;
  snap = true;
  flyCancel();
  lastSample = flySampleAt(0, false);
  useMatchCam.setState({ stage: "covered", veil: 1, instant: false, reduced: false });
  settle("cancelled");
}

/** 复用对象：每帧都算，别在渲染循环里造垃圾 */
const POSE: CamPose = { pos: [0, 0, 0], look: [0, 0, 0] };

/** 时间轴采样 → 相机位姿（相机与画面同一个采样，别在两处各算一遍）。 */
function poseOf(s: FlySample): CamPose {
  // 减少动态：整条转场镜头**一动不动**（主人要求"0.3 s 淡入点子 + 直接淡黑，跳过穿行"）
  if (s.reduced) return pagePose();
  // 化点阶段相机**不动**：要让人看清"图像自己散成点"，镜头一动就抢戏
  if (s.phase === "dissolve") return pagePose();
  return flyTravelPose(s.travel, s.fade, s.shake, POSE);
}

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
      flyCancel();
      lastSample = flySampleAt(0, false);
      useMatchCam.setState({ stage: "idle", veil: 0, instant: false, reduced: false });
      settle("cancelled");
    }
    return null;
  }
  const { stage } = useMatchCam.getState();
  if (stage === "page") return pagePose();
  if (stage === "outside") return useMatchCam.getState().reduced ? pagePose() : flyEndPose(POSE);
  if (stage !== "fly") return null;
  const dtMs = Math.max(0, Math.min(dt, 0.1)) * 1000;
  // 冻结（DEV 验收）时每帧按冻结点重算 + 重写共享 uniform，画面与相机都停在同一拍
  const sample = frozen !== null ? flyFreeze(frozen) : flyTick(dtMs);
  lastSample = sample;
  // 黑幕在**渐黑段开始**那一拍拉到 1：CSS 过渡 0.4 s，与时间轴的 fade 同长，
  // 到 2.4 s 全黑时大厅刚好可以去进匹配队列（旧版是"穿窗那一拍"就开始黑，太早）。
  if (!veilDone && (sample.phase === "fade" || sample.phase === "end")) {
    veilDone = true;
    useMatchCam.setState({ veil: 1 });
  }
  if (sample.phase === "end") {
    landOutside();
    return flyEndPose(POSE);
  }
  return poseOf(sample);
}

/** 黑幕当前这一帧的透明度在页面层负责；时间轴的读数给验收 / DEV 用。 */
export function matchCamClock(): { stage: MatchCamStage; veil: 0 | 1; sample: FlySample } {
  return { stage: useMatchCam.getState().stage, veil: useMatchCam.getState().veil, sample: lastSample };
}

// ── DEV 验收钩子（正式包默认没有）──────────────────────────────────────────
// 穿窗只有 2.4 s，模拟器截图（adb screencap）追不上那一刻 —— 用 freeze(ms) 把时间轴
// 定在指定毫秒（黑幕同步瞬间切换），拍完 resume()。与 __introCam / __gsFire 同一种做法。
// ★ 写 localStorage `gsAcceptDebug=1`（与 __gsAccept 探针同一把开关）时正式包也挂出来：
//   production APK 的模拟器验收要冻帧截"化点那一拍"，不必为验收单独编一个 DEV 包。
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
    /** 时间轴进度（0..1；老验收脚本用） */
    get t() {
      const c = flyClock();
      return c.elapsedMs / Math.max(1, Math.round(flyTotalSec(c.reduced) * 1000));
    },
    /** 当前这一拍的采样（阶段 / 化点 / 穿行 / 渐黑） */
    get sample() {
      return lastSample;
    },
    /** 时间轴常量（验收脚本读它算冻结时刻，别手抄秒数） */
    timeline: FLY_TIMELINE,
    get reduced() {
      return useMatchCam.getState().reduced;
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
    /** 把时间轴冻结在**毫秒**（0 ~ 2400）；黑幕按"是否已进渐黑段"瞬间给到位。
     *  veilForce 传 0 = 渐黑段也**不要黑幕**（验收要拍"点云廊"那一张）。 */
    freezeMs: freezeAtMs,
    /** 老口径（0..1 的总进度）——留着给旧验收脚本；新脚本用 freezeMs 更直白。 */
    freeze(v: number, veilForce?: 0 | 1) {
      const total = flyTotalSec(useMatchCam.getState().reduced);
      freezeAtMs(Math.max(0, Math.min(1, v)) * total * 1000, veilForce);
    },
    resume() {
      frozen = null;
    },
  };
}

/** DEV 冻结：把时间轴钉在 `ms`，黑幕按阶段瞬间给到位（veilForce 可强盖）。 */
function freezeAtMs(ms: number, veilForce?: 0 | 1): void {
  const reduced = useMatchCam.getState().reduced;
  const total = flyTotalSec(reduced);
  const clamped = Math.max(0, Math.min(total, ms / 1000)) * 1000;
  token++;
  stopFallback();
  frozen = clamped;
  const s = flySampleAt(clamped, reduced);
  useMatchCam.setState({
    stage: "fly",
    veil: veilForce ?? (s.phase === "fade" || s.phase === "end" ? 1 : 0),
    instant: true,
    reduced,
  });
  lastSample = s;
  // 冻结时把共享 uniform 也钉在同一拍（flyFreeze 不吸 dt，只是写一遍）
  flyFreeze(Math.round(clamped));
  settle("cancelled");
}
