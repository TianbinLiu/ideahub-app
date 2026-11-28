// ★★ 穿窗转场的**同一条时间轴**（2026-11-27，`feat/gs-flythrough-dissolve`）—— 唯一出处。
//
// 主人这一轮要的演出（按秒，常量见下）：
//   0.0 ~ 0.6 s  「画面化点」：先看见**那张平贴图**（窗 / 月亮 / 云 / 夜空），然后它按**随机 stagger**
//                逐块退场；窗景 splat 同时按每点自己的随机延迟出现（尺寸 0.2 → 1.0）。
//                读起来是"图像自己散成点"，不是硬切。
//   0.6 ~ 2.0 s  「在点中穿行」：相机沿 +z 继续飞，四周全是高斯点（点云廊 = 同一份窗景 splat 复制
//                6 层沿 z 铺开，见 `flyCloud.ts`）；沿途轻微横滚 / 抖动。
//   2.0 ~ 2.4 s  「渐黑」：点云廊淡出 + 全屏黑幕 0→1（黑幕是页面层的 CSS 0.4 s 过渡）。
//   2.4 s 之后  = 匹配中那一屏（现有逻辑不变）。
//
// ★ 为什么时间轴单独一个零依赖模块（而不是塞进 matchCam）：
//   · 相机（`matchCam`）与画面（`WindowLook` 的贴图 / 夜空 / 月盘、`WindowSplat` 的每点 stagger、
//     `flyCloud` 的点云廊 / 光尘）必须由**同一拍**驱动 —— 各算各的必然对不齐；
//   · 但画面那一半在懒加载的 3D chunk 里，不能反过来让 matchCam 认识它们。所以这里只有
//     **常量 + 纯函数 + 几个共享 uniform 对象**（`FLY_U`），两边都只读它。
//
// ★ 时长集中成常量：主人点名以后还要调。改这里一处即可（贴图退场、splat 出现、相机、黑幕全跟着）。
//
// ★ `prefers-reduced-motion`：0.3 s 淡入点子 + 直接淡黑（跳过穿行与点云廊）。判据在
//   `flyReducedMotion()` 一处（真机验收另留 `?rm=1` / localStorage 的强制口，见下）。
export const FLY_TIMELINE = {
  /** 贴图 → 高斯点（贴图按 stagger 退、splat 按 stagger 进） */
  dissolve: 0.6,
  /** 在点云廊里穿行（相机从窗前 1.6 m 一直飞出去） */
  travel: 1.4,
  /** 点云廊淡出 + 黑幕 0→1（与页面层黑幕的 CSS 0.4 s 过渡同拍） */
  fade: 0.4,
} as const;

/** 减少动态时：只保留"化点"（压到 0.3 s）与淡黑，跳过穿行 */
export const FLY_REDUCED = { dissolve: 0.3, fade: FLY_TIMELINE.fade } as const;

/** 整条转场的时长（秒）。正常 2.4 s，减少动态 0.7 s。 */
export function flyTotalSec(reduced = false): number {
  return reduced ? FLY_REDUCED.dissolve + FLY_REDUCED.fade : FLY_TIMELINE.dissolve + FLY_TIMELINE.travel + FLY_TIMELINE.fade;
}

export type FlyPhase = "idle" | "dissolve" | "travel" | "fade" | "end";

/** 某一时刻的完整演出状态（相机与画面都从这里取） */
export interface FlySample {
  phase: FlyPhase;
  /** 从点「匹配」算起的毫秒（减少动态时也在同一条轴上，只是总长更短） */
  elapsedMs: number;
  totalMs: number;
  reduced: boolean;
  /** 贴图 → 点左右轴：0 = 全是贴图，1 = 全是点 */
  dissolve: number;
  /** 穿行进度（0..1；减少动态时恒 0） */
  travel: number;
  /** 渐黑进度（黑幕 CSS 过渡自己走 0.4 s；这一位只给画面层做"点飞过镜头"的收尾） */
  fade: number;
  /** 点云廊不透明度（0..1） */
  corridor: number;
  /** 光尘不透明度（0..1） */
  dust: number;
  /** 穿行尽头那张背景（窗外贴图：夜=月亮 / 昼=云海）的不透明度（0..1）。
   *  ★ 2026-11-27（`feat/gs-tunnel-depth`）：它在**穿行中段**才淡进来（0.45~0.85 的 travel），
   *    于是"走廊最后几层把背景透出来"是随时间连续发生的，不是硬切。 */
  backdrop: number;
  /** 「那张画」还剩多少（平贴图 / 夜空 / 月盘 / 墙上的亮晕都乘它） */
  image: number;
  /** 抖动强度 0..1（相机横滚 / 漂移的幅度乘它） */
  shake: number;
}

/**
 * 共享 uniform（**故意是裸 `{ value }`**，不是 three 的 IUniform）：
 *   · 主包的 matchCam 也能 import 它（不拖 three / spark）；
 *   · ShaderMaterial 的 uniforms 直接引用这些对象，`flyTick` 每帧写 `.value` 就让所有材质一起动
 *     —— 不需要每帧 React 重渲（转场只有 2.4 s，重渲一次都不该有）。
 *   · 不飞的时候值是"贴着原样"的：dissolve=0 / image=1 / corridor=0 —— 所以 shader 里那段
 *     逻辑对普通画面**逐像素不变**（见 WindowLook / WindowSplat 的注释）。
 */
/** 共享 uniform 的单个字段（**不是 as const**：每帧要写 .value） */
export interface FlyUniform {
  value: number;
}
export const FLY_U: {
  /** 1 = 转场在演（WindowSplat 的每点 stagger 只在这一位为 1 时生效） */
  active: FlyUniform;
  /** 0..1 贴图 → 点 */
  dissolve: FlyUniform;
  /** 1 = 那张画原样，0 = 已经散尽（夜空 / 月盘 / 亮晕 / 贴图都乘它） */
  image: FlyUniform;
  /** 0..1 点云廊整体不透明度（SplatMesh.opacity） */
  corridor: FlyUniform;
  /** 0..1 光尘不透明度 */
  dust: FlyUniform;
  /** 0..1 穿行尽头那张背景贴图（夜=月亮 / 昼=云海）的不透明度 */
  backdrop: FlyUniform;
  /** 抖动强度（相机用；画面层不用） */
  shake: FlyUniform;
  /** 穿行进度（相机过窗之后窗口 splat 可以退场，省 26 万点的 overdraw） */
  travel: FlyUniform;
} = {
  active: { value: 0 },
  dissolve: { value: 0 },
  image: { value: 1 },
  corridor: { value: 0 },
  dust: { value: 0 },
  backdrop: { value: 0 },
  shake: { value: 0 },
  travel: { value: 0 },
};

/** 柔和的 0..1 过渡（时间轴内用；不进 shader） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * 纯函数：给定"从点匹配算起的毫秒"与是否减少动态，算出这一拍的全部状态。
 * ★ 相机与画面都只走这一个函数 —— 想调演出就调这里与 FLY_TIMELINE，别在调用点各算一遍。
 */
export function flySampleAt(elapsedMs: number, reduced = false): FlySample {
  const d = reduced ? FLY_REDUCED.dissolve : FLY_TIMELINE.dissolve;
  const tr = reduced ? 0 : FLY_TIMELINE.travel;
  const fd = FLY_TIMELINE.fade;
  const total = d + tr + fd;
  const e = Math.max(0, Math.min(total, elapsedMs / 1000));
  const dissolve = clamp01(e / d);
  const travel = tr > 0 ? clamp01((e - d) / tr) : 0;
  const fade = clamp01((e - d - tr) / fd);
  const phase: FlyPhase =
    e >= total ? "end" : e < d ? "dissolve" : tr > 0 && e < d + tr ? "travel" : "fade";
  // 点云廊：化点后段就有一点点（让"图像散成点"接到"点云廊"），穿行中全开，渐黑那 0.35 s 退掉。
  // 减少动态不挂点云廊（主人要求跳过穿行）—— 画面只剩那张贴图化成的点，然后直接黑。
  const corridorIn = reduced ? 0 : smoothstep(0.42, 0.78, e);
  const corridorOut = reduced ? 0 : 1 - smoothstep(d + tr, d + tr + 0.35, e);
  const corridor = corridorIn * corridorOut;
  const dust = reduced
    ? 0
    : smoothstep(Math.max(0, d * 0.95), d * 1.5, e) * (1 - smoothstep(d + tr + 0.05, d + tr + 0.35, e));
  // 穿行尽头那张背景（窗外贴图）：穿行中段起淡进来（travel 0.45~0.85），之后一直亮着，
  // 由黑幕收尾。放得比走廊远（见 flyBackdrop.BACKDROP.dist），所以走廊越飞越稀 ⇒ 背景自然透出来。
  const backdrop = reduced ? 0 : smoothstep(0.45, 0.85, travel);
  // 「那张画」：化点一开始就同步退（到 0.6 s 归零）。减少动态时它 0.3 s 就退完 —— 点因此成为唯一的东西。
  const image = reduced ? 1 - smoothstep(0, d * 0.9, e) : 1 - dissolve;
  // 抖动：穿行中逐渐加大，渐黑时保持最大（"点飞过镜头"那一下的加速感）
  const shake = reduced ? 0 : e < d ? 0 : phase === "travel" ? 0.35 + 0.65 * travel : 1;
  return {
    phase,
    elapsedMs: e * 1000,
    totalMs: total * 1000,
    reduced,
    dissolve,
    travel,
    fade,
    corridor,
    dust,
    backdrop,
    image,
    shake,
  };
}

/** `prefers-reduced-motion` 的判据（一处）。真机验收可以用 `?rm=1` 或 localStorage 强制，
 *  免得为了测这条去改系统设置。 */
export function flyReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("rm") === "1") return true;
    if (window.localStorage?.getItem("gsFlyReduced") === "1") return true;
  } catch {
    /* 存不下 / 隐私模式：按系统设置走 */
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// ── 运行时（模块级单例；每帧由 matchCam 的 stepMatchCam 推进）────────────────
let elapsedMs = 0;
let running = false;
let reduced = false;
/** DEV 验收：冻结在某个毫秒（null = 正常走） */
let frozenMs: number | null = null;

/** 转场开始（点「匹配」）。 */
export function flyBegin(atReduced = false): void {
  reduced = atReduced;
  elapsedMs = 0;
  running = true;
  frozenMs = null;
  applyUniforms(flySampleAt(0, reduced));
}

/** 取消 / 退出大厅 / 复位：时间轴与共享 uniform 一起回到"贴着原样"。 */
export function flyCancel(): void {
  running = false;
  elapsedMs = 0;
  frozenMs = null;
  applyUniforms(flySampleAt(0, false));
  FLY_U.active.value = 0;
}

/** 推进一帧（dt 毫秒；matchCam 把 dt 夹在 0.1 s 内，与它的相机推进同一个口径）。 */
export function flyTick(dtMs: number): FlySample {
  if (running && frozenMs === null) elapsedMs += Math.max(0, dtMs);
  const sample = flySampleAt(frozenMs ?? elapsedMs, reduced);
  applyUniforms(sample);
  return sample;
}

/** 转场结束（黑幕全黑那一刻）：把字面值钉到终态。 */
export function flyFinish(): void {
  const sample = flySampleAt(flyTotalSec(reduced) * 1000, reduced);
  running = false;
  elapsedMs = sample.elapsedMs;
  applyUniforms(sample);
  FLY_U.active.value = 0;
}

/** 当前时间轴读数（验收 / DEV 钩子用） */
export function flyClock(): { elapsedMs: number; reduced: boolean; running: boolean; frozenMs: number | null } {
  return { elapsedMs: frozenMs ?? elapsedMs, reduced, running, frozenMs };
}

/** DEV 验收：冻结在指定毫秒（null = 解冻接着走）。返回这一拍的采样。 */
export function flyFreeze(ms: number | null): FlySample {
  frozenMs = ms === null ? null : Math.max(0, ms);
  const sample = flySampleAt(frozenMs ?? elapsedMs, reduced);
  applyUniforms(sample);
  return sample;
}

/** 共享 uniform 的总入口（只在这里写 —— 别在组件里各写各的） */
function applyUniforms(s: FlySample): void {
  FLY_U.active.value = s.phase === "dissolve" || s.phase === "travel" || s.phase === "fade" ? 1 : 0;
  FLY_U.dissolve.value = s.dissolve;
  FLY_U.image.value = s.image;
  FLY_U.corridor.value = s.corridor;
  FLY_U.dust.value = s.dust;
  FLY_U.backdrop.value = s.backdrop;
  FLY_U.shake.value = s.shake;
  FLY_U.travel.value = s.travel;
}
