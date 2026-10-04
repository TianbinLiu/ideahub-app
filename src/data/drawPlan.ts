// 出片前要补画哪几张设定帧 —— 规则的**唯一实现**（2026-10-04，「跟着做」模式第一期；方案 docs/guided-modes-design.md）。
//
// 纯函数、零运行时依赖（只许 `import type`）：构建里 scripts/check-draw-plan.mjs 直接 import 它跑正反例。
//
// ★★ 为什么单独成一个文件：「补画几张」同时决定三件事 —— 报价（economy.segmentCost 的图钱）、真出片时画不画
//   （segmentGen.generateSegment）、参考图预留几个位（segmentGen.refSlotsOf 的 frameSlots，界面上那排参考清单也读它）。
//   此前三处各写一份条件（`!first`、`tier.flf && !last`、`tier.flf ? 2 : 1`），各自都对；而这一期要加两条新规矩，
//   三处里漏改一处就是「报了图钱没画」「画了图没报钱」或者「图位预留多了一格」—— 都是零报错。
//
// 两条新规矩（主人 10-04「开工」认的方案，依据 docs/multi-character-consistency-research.md）：
//  ① **不补画（noDraw）**：参考图直出 / 主角定妆·多镜头 / 九宫格分镜的段，以及收参考图那两档上的「自定义」段 ——
//     有承接帧 / 自己给的帧就当参考图发、缺的那张不补；一张帧都没有就走参考生视频（卡片形象图直接喂视频模型）。
//     熟练作者没人让程序自动补画、没人核对就出片（LibTV 三条作品 249 个出片节点首尾帧只用了 5 次，都是作者做好的关键画面）。
//  ② **多镜头不画结束画面（multiShot）**：一张结束画面装不下几个镜头；跨镜头的结束画面会被硬插值成叠化或多出来的动作
//     （第三次付费验证：视频为了靠上结束画面，在最后一个镜头后多拍了一小段）。段与段之间本来就用上一段的真实尾帧承接。
//     方案里已经有的 AI 结束画面（改成多镜头之前画的）也不发、不重画，见 endFrameUsed；你自己换上的照用。

/** 判定要用到的档位能力（只拿这两位，免得这个文件依赖档位表） */
export interface DrawTier {
  /** 这一档收不收结束帧（economy.VideoTier.flf） */
  flf: boolean;
  /** 按发计价的档（真人档）：首帧就是卡上的照片，一张设定帧都不画 */
  flat: boolean;
}

export interface DrawInput {
  tier: DrawTier;
  /** 已经有起拍帧（自己的设定首帧，或承接上一段的真实尾帧） */
  hasFirstFrame: boolean;
  /** 已经有结束帧 */
  hasLastFrame: boolean;
  /** 这一段走参考生视频（卡片形象图直接喂视频模型，不画帧） */
  refMode: boolean;
  /** 这一段不补画帧（规矩 ①）。**必填**：可选的话新调用点漏传就悄悄退回补画，零症状 */
  noDraw: boolean;
  /** 这一段的剧情分了两个以上镜头（规矩 ②，判据 shotScript.isMultiShot）。必填，理由同上 */
  multiShot: boolean;
}

/**
 * 出片前要补画哪几张。
 * ★ 不补画（noDraw）的段：有哪张发哪张（只给了结束帧也行 —— 只发它，开头不替你画），缺的不补。
 * ★ 不补画但一张帧都没有、又走不了参考生视频（卡上没有能进模型的形象图）时，**照常补画** ——
 *   那时没有任何东西可以当参考发，硬不画就是一段纯文字生成、挂的卡一点用都没有。出片那一侧会把这件事说出来。
 */
export function framesToDraw(o: DrawInput): { first: boolean; last: boolean } {
  if (o.refMode || o.tier.flat) return { first: false, last: false };
  if (o.noDraw && (o.hasFirstFrame || o.hasLastFrame)) return { first: false, last: false };
  return { first: !o.hasFirstFrame, last: o.tier.flf && !o.hasLastFrame && !o.multiShot };
}

/** 一共补画几张（报价按它乘出图单价） */
export function drawCount(o: DrawInput): number {
  const d = framesToDraw(o);
  return (d.first ? 1 : 0) + (d.last ? 1 : 0);
}

/**
 * 帧当参考图发时，帧会占掉几个图位（已有的 + 要补画的）。参考图预算在「准备卡片图」那一步就按它扣
 * （segmentGen.refSlotsOf 的 direct.cap），界面上的参考清单也按它排结束画面那一格。
 */
export function frameSlotsOf(o: DrawInput): number {
  const d = framesToDraw(o);
  return (o.hasFirstFrame || d.first ? 1 : 0) + (o.hasLastFrame || d.last ? 1 : 0);
}

/**
 * 方案里**已经有**的那张结束帧，出片时用不用 —— 规矩 ② 的另一半：分了镜头的段不用 AI 画的结束画面
 * （推演三套、「重画这一套」时画的那张，画的是改成多镜头之前的剧情），你自己换上的（上锁的）照用。
 * 读它的：flowStore.usableFrames（出片 / 报价 / 参考清单 / 「改这一帧」都问那一处）、方案台的显示（PlanBoard）。
 * 「重画这一套」也跟着它：用不上的那张不重画（flowStore.redrawFrames）。
 */
export function endFrameUsed(o: { multiShot: boolean; pinned: boolean }): boolean {
  return o.pinned || !o.multiShot;
}
