// Live2D 上传向导第 ⑤ 步「试跑」里那一列 ✓ / ⚠ 的判定 —— **唯一实现**（2026-10-26，upload-verify-honest 第一期）。
//
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-live2d-motion-check.mjs 直接 import 它跑正反例。
//
// ★★ 为什么要有它：试跑原来每一项「等够时间就打勾」—— 动作到底有没有让模型动起来全靠人眼看。而映射里一个动作组
//   完全可以指向一段「曲线全写给模型里不存在的参数」的 motion3（别的模型导出来的、改过参数名没重导的），
//   运行时照样 FORCE 播它、照样占掉待机动作 —— 模型就那样站住，零报错，作者看着一列 ✓ 把它发布出去。
// ★ 量在 live2d/companionModel.probeParams（挂 beforeModelUpdate、只按真实下标读、按每个参数自己的量程归一化到 0~1、
//   逐帧扣掉框架的呼吸）；这里只判，判据只有下面两条：
//   - judgeMotion（动作 / 表情 / 触摸播的动作）：拿**演之前单独量的那一份待机基线**比，任何一个没被跳过的参数 / Part，
//     在演的那个窗口里的起伏（max − min）超过 max(MOVE_ABS, MOVE_K × 它在基线里的起伏)，就算「动了」。
//     比「起伏」不比「落在哪」：上一项演完留在某个值上不动的参数（待机动作不管它，它就一直停在那儿）是平的，
//     比落点会把这一项量成「动了」；起伏不受它影响。
//   - judgeOwn（说话的嘴、眨眼）：这两组参数是我们自己每帧写的，基线里它们也在动（会眨眼），所以不跟基线比，
//     只看这一窗口里对应的真实参数起伏够不够；模型里压根没有这个参数（下标 -1）= 看不出变化。
// ★ 判错的方向：⚠ 只提醒、不拦发布，界面上写着「自动量的，可能误判」；所以宁可把一个动得很轻的动作标 ⚠（人再看一眼），
//   也别把一个哑动作标 ✓（那正是要抓的东西）。
// ★★ 比得了的前提：基线与每一项的窗口落在**同一段待机、同一个相位**上（2026-10-26 审核指出）。框架的待机是随机挑段的，
//   待机组有好几段、幅度不同时，基线落在安静的那段、哑动作的窗口落在活跃的那段，比值就超了。所以试跑期间待机钉在同一段
//   （companionModel.pinIdleForProbe）、每一项都从「停掉动作」那一刻起算、呼吸也一起从头起（stopMotions），基线从停下那一刻起量、
//   盖住任何一项的窗口，并量两遍合起来（mergeProbes，采样加密）—— 页面那一侧的排法见 SupportModelNewPage 的 VERIFY_* 那几条。
//   哪一份采样里待机没钉住（idleFixed 不为真）就不比：这一项回「没量到」、基线回 noBase，不猜。
// ★ 阈值怎么量的（2026-10-26，浏览器里走向导页面的「开始试跑」，一个包一轮 90~110 秒）：
//   第一次只量了官方看板娘（待机组只有一段，碰不到上面那种情况）。按审核把待机钉住之后重量，四个包：官方看板娘（待机 1 段）、
//   Cubism 官方样例 Hiyori（9 段，1.6~8.6 秒）、Mao（2 段）、Natori（3 段）。每个包埋 5 个哑项 —— 拿包里最长的一段真动作、
//   曲线 id 全改成模型里没有的，原长 / 压成 2 秒 / 压成 1.2 秒各一段挂到动作槽，1.2 秒那段再挂一个触摸区，外加一个哑 exp3 ——
//   与真动作、真 exp3、通用参数表情穿插着跑，每个包 2~5 轮：
//   - 哑项每一轮都标「看不出变化」（4 个包 × 5 个，一个都没漏）。「本窗起伏 ÷ 基线起伏」最大 1.20（Hiyori 那个 1.2 秒的哑触摸动作：
//     基线那几秒帧率掉到 24 帧、它自己的窗口 67 帧，漏采的峰；同一条轨迹按 66 帧密采，基线与它都是 0.226，比值 1.00），其余 ≤ 1.07；
//     待机里不动的参数，哑项一格都没超过 MOVE_ABS。
//   - 真动作：官方看板娘最低 2.46 倍（think 的 ParamAngleX）、其次 3.33 倍（acknowledge）；另外三个包的真动作都碰了待机不碰的参数
//     （起伏 0.5~1，分数 ≥ 10）。真 exp3 同样 ≥ 10。
//   - 对照：同样的包把钉住拿掉（框架照常随机挑段），Hiyori 的 5 个哑项两轮都有 4 个被量成「动了」—— 这就是要钉住的原因；
//     钉住那一层装不上时（拿空操作顶替 pinIdleForProbe 试的），动作 / 表情全部回「没量到」，不出 ✓。
//   - 真包里量出来的 ⚠ 不全是误判：Mao 的口型参数是 ParamA（不是标准名），说话标 ⚠；Natori 的待机动作自己带眼睛曲线、
//     每帧盖掉我们写的眨眼，眨眼标 ⚠；Mao 的待机曲线盖住了通用参数表情要叠的那几个参数，6 个通用参数表情标 ⚠ —— 客服页上也一样看不见。
import type { ParamProbe } from "../live2d/companionModel";

/**
 * moved = 动了；still = 看不出变化（⚠）；unknown = 这一项没量到（帧太少 / 待机没钉住）；
 * noBase = 这一项量到了，可演之前那段基线没量成，没东西可比（与 unknown 分开，是因为界面上要说的原因不一样）
 */
export type MotionVerdict = "moved" | "still" | "unknown" | "noBase";

/**
 * 采到的帧少于它就不下结论（「没量到」）。页面在后台时 rAF 不跑，一两秒里一帧都没有或只有零星几帧
 * （CLAUDE.md「在看不见的窗口里测」）；前台 60fps 的话一个 2.6 秒的窗口是一百五十帧上下（实测无头浏览器 140fps 时 370 帧），
 * 10 帧离它很远、离 0 也够远。
 */
export const PROBE_MIN_FRAMES = 10;

/**
 * 起伏的绝对下限（归一化后，占这个参数量程的比例）：基线里完全不动的参数（眉毛、脸红这类待机动作不碰的），
 * 起伏要超过它才算「动了」—— 挡掉浮点抖动与残余。实测（见文件头）哑项在这类参数上都没超过它（第一次量是 0.000），
 * 真动作碰到这类参数时最小 0.09（comfort 的 ParamBodyAngleY），官方看板娘的真表情最小 0.5；第三方包上通用参数表情会弱得多
 * （待机曲线把叠上去的量盖掉了大半：Natori 的「哭」0.07 刚过线、「坏笑」0.034 没过，标 ⚠ —— 客服页上也几乎看不出来）。
 */
export const MOVE_ABS = 0.05;

/**
 * 起伏要比基线大几倍。待机钉住、相位对齐之后，哑项的起伏照理不超过基线（窗口落在基线量过的那一截里），超出来的只有采样的误差
 * （帧率不一样时漏采的峰）。实测（见文件头）哑项最大 1.20 倍、真动作最小 2.46 倍 —— 取两者之间的 1.5，偏哑项一侧：
 * 宁可多标几个「看不出变化」让人再看一眼。
 * ⚠ 归位没做够时这个数会被冲掉：先试的 0.8 秒归位（不够待机动作 2 秒的淡入）下，哑动作的比值到过 7 倍以上，6 次里 3 次被量成「动了」；
 *   待机不钉住时（随机挑段），Hiyori 的哑动作在基线里不动的参数上起伏到 0.6 以上（MOVE_ABS 的十几倍），根本不是阈值能挡的。
 */
export const MOVE_K = 1.5;

/**
 * 嘴 / 眼自己那一组的起伏下限（归一化后）。实测（见文件头）合成口型说一句起伏 0.45（ParamMouthOpenY 量程 0~1）、
 * 叫她眨一次眼起伏 1.0，不说话 / 不眨时都是 0；这里只防「参数在、可是被动作曲线每帧盖掉了」那种几乎不动的情形，取它们的三分之一上下。
 */
export const OWN_MIN = { mouth: 0.15, eye: 0.3 } as const;

/** 两份采样能不能放在一起比（同一个模型、同一张参数表） */
function sameShape(a: ParamProbe, b: ParamProbe): boolean {
  return a.min.length === b.min.length && a.max.length === b.max.length && a.min.length === a.max.length;
}

/** 这一对采样里不该看的下标：两边各自的 skip，加上任何一边窗口里有人碰过视线时的头部角度 */
export function skippedIndices(base: ParamProbe, run: ParamProbe): Set<number> {
  const out = new Set<number>([...base.skip, ...run.skip]);
  if (base.gazed || run.gazed) for (const i of run.gaze) out.add(i);
  return out;
}

/**
 * 一份采样能不能拿来比：帧够数，而且整个窗口里待机都钉在同一段（companionModel.pinIdleForProbe 的 ★★）。
 * ★ idleFixed 判肯定（`=== true`）：没钉住的窗口里待机可能换成了另一段幅度大得多的，拿它和基线比会把哑动作量成「动了」——
 *   不确定的时候说「没量到」，不说 ✓。
 */
export function probeUsable(p: ParamProbe | null): p is ParamProbe {
  return !!p && p.frames >= PROBE_MIN_FRAMES && p.idleFixed === true;
}

/**
 * 把同一段的两次采样合成一份（基线量两遍用，见 SupportModelNewPage 的 VERIFY_BASELINE_ROUNDS）：每个下标取两边更低的 min、更高的 max，
 * 帧数相加，skip 取并集，视线动过 / 待机没钉住任一边算。任一边缺了、或者两份不是同一个模型（参数个数对不上）→ null（基线没量成）。
 */
export function mergeProbes(a: ParamProbe | null, b: ParamProbe | null): ParamProbe | null {
  if (!a || !b || !sameShape(a, b)) return null;
  return {
    frames: a.frames + b.frames,
    min: a.min.map((v, i) => Math.min(v, b.min[i])),
    max: a.max.map((v, i) => Math.max(v, b.max[i])),
    skip: [...new Set([...a.skip, ...b.skip])],
    gaze: [...new Set([...a.gaze, ...b.gaze])],
    gazed: a.gazed || b.gazed,
    mouth: a.mouth,
    eye: a.eye,
    idleFixed: a.idleFixed === true && b.idleFixed === true,
  };
}

/** 动作 / 表情 / 触摸播的动作：比待机基线，动没动 */
export function judgeMotion(base: ParamProbe | null, run: ParamProbe | null): MotionVerdict {
  if (!probeUsable(base)) return "noBase";
  if (!probeUsable(run)) return "unknown";
  if (!sameShape(base, run)) return "unknown"; // 中途换了模型：两份没法比，别下结论（试跑那一侧会整轮作废）
  const skip = skippedIndices(base, run);
  for (let i = 0; i < run.min.length; i++) {
    if (skip.has(i)) continue;
    const swing = run.max[i] - run.min[i];
    const idle = Math.max(0, base.max[i] - base.min[i]);
    if (swing > Math.max(MOVE_ABS, MOVE_K * idle)) return "moved";
  }
  return "still";
}

/** 说话的嘴 / 眨眼：只看这一窗口里对应的真实参数起伏够不够（见文件头 ★） */
export function judgeOwn(run: ParamProbe | null, which: keyof typeof OWN_MIN): MotionVerdict {
  if (!run || run.frames < PROBE_MIN_FRAMES) return "unknown";
  const i = which === "mouth" ? run.mouth : run.eye;
  if (i < 0 || i >= run.min.length) return "still"; // 模型里没有这个参数（参数名不标准、又没有 cdi3 的那一类）
  return run.max[i] - run.min[i] >= OWN_MIN[which] ? "moved" : "still";
}
