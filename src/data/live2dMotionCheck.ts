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
// ★ 阈值怎么量的（2026-10-26，浏览器里跑官方看板娘；只量了这一个模型，第三方包的待机动作幅度不同，先以它为准，有真实上传者再复核）：
//   给它加两段哑动作（拿 think / nod 的曲线、参数 id 全改成模型里没有的：2.6 秒、1.2 秒各一段）和一个哑 exp3 表情，
//   与 10 个真动作、8 个通用参数表情、2 个 exp3 表情、几次「什么都不演」的空跑穿插着，按向导的归位规则（SupportModelNewPage 的
//   VERIFY_SETTLE_MS 那条）跑了三轮（两轮直接调运行时、一轮走向导页面的「开始试跑」），三轮逐项结果相同：
//   - 哑动作 / 哑表情 / 空跑：「本窗起伏 ÷ 基线起伏」最大 1.00；待机里不动的参数一格都没动（0.000）；
//   - 真动作：那个比值最小的是 playful 3.00、disagree 2.94、acknowledge 3.46；真表情：待机里不动的参数起伏最小 0.5；
//   - 页面走一遍：4 个埋进去的哑项（两个动作、一个 exp3 表情、一个触摸动作）全标「看不出变化」，其余 15 项全 ✓。
import type { ParamProbe } from "../live2d/companionModel";

export type MotionVerdict = "moved" | "still" | "unknown";

/**
 * 采到的帧少于它就不下结论（「没量到」）。页面在后台时 rAF 不跑，一两秒里一帧都没有或只有零星几帧
 * （CLAUDE.md「在看不见的窗口里测」）；前台 60fps 的话一个 2.6 秒的窗口是一百五十帧上下（实测无头浏览器 140fps 时 370 帧），
 * 10 帧离它很远、离 0 也够远。
 */
export const PROBE_MIN_FRAMES = 10;

/**
 * 起伏的绝对下限（归一化后，占这个参数量程的比例）：基线里完全不动的参数（眉毛、脸红这类待机动作不碰的），
 * 起伏要超过它才算「动了」—— 挡掉浮点抖动与残余。实测（见文件头）哑项在这类参数上是 0.000，
 * 真动作碰到这类参数时最小 0.09（comfort 的 ParamBodyAngleY），真表情最小 0.5。
 */
export const MOVE_ABS = 0.05;

/**
 * 起伏要比基线大几倍。基线 3 秒、演的窗口 2.6 秒，待机动作的相位不同，同一个参数的起伏能差出一些。
 * 实测（见文件头）哑项最大 1.00 倍、真动作最小 2.94 倍 —— 取两者之间、偏哑项一侧的 1.5：第三方包的待机动作起伏忽大忽小时，
 * 宁可多标几个「看不出变化」让人再看一眼。
 * ⚠ 归位没做够时这个数会被冲掉：先试的 0.8 秒归位（不够待机动作 2 秒的淡入）下，哑动作的比值到过 7 倍以上，6 次里 3 次被量成「动了」。
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

/** 动作 / 表情 / 触摸播的动作：比待机基线，动没动 */
export function judgeMotion(base: ParamProbe | null, run: ParamProbe | null): MotionVerdict {
  if (!base || !run) return "unknown";
  if (base.frames < PROBE_MIN_FRAMES || run.frames < PROBE_MIN_FRAMES) return "unknown";
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
