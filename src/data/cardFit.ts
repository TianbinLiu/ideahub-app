// 「这张卡在各出片模型上用得上哪一部分」—— 判据的**唯一实现**（2026-10-02 从 components/CardModelFit 抽出来；
// 2026-10-26 出片地区「卡片写具体模型」改成**按具体模型**算：原来按三类档位（2.x / 1.0 / 真人档）各算一格，行首写档位名）。
//
// ★ 为什么抽：卡片页那一格（CardModelFit）与卡组页的适配摘要说的是同一件事。判据留在组件里的话，
//   卡组页只能再抄一遍 —— 而这几条事实（哪一代模型收不收参考图、真人照片过不过得去）改过好几轮，
//   抄出来的那份迟早停在上一版（铁律六）。
// ★ 这里只有**状态**与**分组**，没有一句文案：卡片页逐张说整句，卡组页按状态数张数，两处措辞本来就不同；
//   「行首写模型名还是档位名」「组头写哪家」是 account（offeredVideoModels / videoModelsLead / providerGroupName）的事。
// ★★ 判据只读档位表的能力位（startOnly / refImg / assetRef / realFace），**不按档位名、不按供应商、不按价钱**：
//   出片管线读的就是这几位（segmentGen 的真人档那一支按 startOnly、参考图那一支按 refImg），卡片页说的才与真发出去的一致。
//   原来拿「2.x / 1.0 / 真人档」三类写死，海外 MiniMax H3（P2b）也是 MiniMax、却收参考图 —— 按供应商或 flatCost 推就会说错，而且零报错。
//   构建里 scripts/check-card-fit.mjs 实跑正反例，并核对这个文件里不出现 flatCost / provider 比较 / label。
// ★ 地区只决定**传进来的 models 里有哪几个**（account.offeredVideoModels 按 offeredTiers 并，那里已按地区筛过），不改变状态。
// ★ 零运行时依赖（只准 import type）：构建检查要能用 Node 直接 import 它（check-import-direction 的零依赖表里有它）。
//   所以「这张卡有没有火山引擎认证」「这张卡能不能有起拍画面」由调用方算好传进来（ctx，两格都必填 —— 漏传 hasAsset 的症状是
//   真人卡被误标成「要先勾」，而且不报错）。
import type { VideoTierSpec } from "./videoTierTable";
import type { Card } from "../types";

/**
 * 卡片怎么进这个模型（由能力位推出来，不另存一格 —— 另存就是第二处判据，会与出片管线读的 startOnly / refImg 漂开）：
 *   · refs   = 形象图直接当参考图进模型（今天：Seedance 2.0 mini / 2.5）；
 *   · frames = 收不到参考图，形象只经由首尾帧 / 设定帧起作用，或靠文字版形象描述（今天：Seedance 1.0 两档）；
 *   · start  = 只认一张起拍画面（今天：真人档 MiniMax Hailuo 2.3 Fast）。
 */
export type CardInput = "refs" | "frames" | "start";

/** 算适配要读的能力位。同一个模型的几行这几格相同（check-video-tiers 的同模型一致性钉着），所以按模型算一次就够 */
export type CardFitCaps = Pick<VideoTierSpec, "startOnly" | "refImg" | "assetRef" | "realFace">;

export function cardInputOf(caps: Pick<VideoTierSpec, "startOnly" | "refImg">): CardInput {
  if (caps.startOnly) return "start";
  return caps.refImg ? "refs" : "frames";
}

/**
 * 一张卡在一个模型上的状态。
 *   refs：image = 形象图直接进模型；asset = 真人卡以火山引擎认证素材进模型；needAsset = 真人卡还没认证，进不了；
 *         realPhoto = 这个模型收真人照片，照片直接进模型（今天没有这样的模型，留给以后实测收真人照片的那一类）；
 *   frames：text = 有文字版形象描述；frameOnly = 只经由设定帧起作用；
 *   start：photo = 以真人照片起拍；startFrames = 有专门画好的起拍画面；ownImage = 人物卡拿卡上的图起拍（白底立绘开场就是白底）；
 *          onlyAsStart = 场景 / 道具卡，只有它当起拍画面时形象图才用得上；textOnly = 只以文字参与（风格卡）；
 *   noRealFace = 真人卡、这个模型不收真人照片（任何一类上都可能）。
 * ★ 没实测过的能力不另开一档（「还没实测」对用户没有可以照着做的事）：档位表里写保守值（realFace false），这里就是 noRealFace。
 */
export type FitState =
  | "image"
  | "asset"
  | "needAsset"
  | "realPhoto"
  | "noRealFace"
  | "text"
  | "frameOnly"
  | "photo"
  | "startFrames"
  | "ownImage"
  | "onlyAsStart"
  | "textOnly";

/** 行首那枚图标：ok = 用得上，partial = 部分用得上，no = 用不上，textOnly = 只用文字 */
export type FitLevel = "ok" | "partial" | "no" | "textOnly";

export function fitLevelOf(state: FitState): FitLevel {
  switch (state) {
    case "image":
    case "asset":
    case "realPhoto":
    case "photo":
    case "startFrames":
      return "ok";
    case "text":
    case "frameOnly":
    case "ownImage":
    case "onlyAsStart":
      return "partial";
    case "needAsset":
    case "noRealFace":
      return "no";
    case "textOnly":
      return "textOnly";
  }
}

/** 算状态要读的那几格卡片字段 */
export type FitCard = Pick<Card, "type" | "realPerson" | "textDesc" | "startFrames">;

/**
 * 调用方算好传进来的两件事（两格都必填）：
 *   hasAsset = 这张卡有没有「我」的火山引擎认证（cardAsset.assetOf，按「主人 + 卡 id」存 —— 所以这是"**我**用这张卡"的答案，别拿去判别人的卡）；
 *   startOk  = 这张卡能不能有起拍画面（types.startFramesAllowed）。
 */
export interface FitCtx {
  hasAsset: boolean;
  startOk: boolean;
}

/**
 * 一张卡在一个模型上的状态。**null = 背景卡**：它在所有模型上本来就只以文字参与（故事背景），没有"适配"这回事。
 * 真人 = 人物卡且 realPerson === true（判肯定：缺省 = 老卡 = 非真人，types.Card.realPerson 那条 ★）。
 */
export function cardFitOn(card: FitCard, caps: CardFitCaps, ctx: FitCtx): FitState | null {
  if (card.type === "background") return null;
  const real = card.type === "character" && card.realPerson === true;
  const input = cardInputOf(caps);
  if (input === "refs") {
    if (!real) return "image";
    if (caps.assetRef) return ctx.hasAsset ? "asset" : "needAsset";
    return caps.realFace ? "realPhoto" : "noRealFace";
  }
  if (input === "frames") {
    // 收不到参考图的模型上真人照片只能画进设定帧 —— 今天这一类全不收真人照片（方舟两套探测器全拦，2026-08-24 实测）
    if (real) return "noRealFace";
    return card.textDesc?.trim() ? "text" : "frameOnly";
  }
  if (real) return caps.realFace ? "photo" : "noRealFace";
  if (card.startFrames?.portrait || card.startFrames?.landscape) return "startFrames";
  if (card.type === "character") return "ownImage";
  return ctx.startOk ? "onlyAsStart" : "textOnly";
}

// ── 按模型并档、按家分组 ───────────────────────────────────────────

/** 一个具体模型与挂在它上面的几档（「草稿」「高清」都是 Seedance 2.0 mini）。P = 供应商名 */
export interface VideoModelOf<T, P extends string = string> {
  model: string;
  provider: P;
  /** 按传进来的顺序（档位表顺序），非空 */
  tiers: T[];
}

/**
 * 几档按模型并起来，顺序 = 每个模型第一次出现的位置（档位表顺序）。供应商由调用方给（account 传 economy.providerOf：
 * 缺省即方舟那一处判否定只在那里，这里不另写一份缺省值）。
 */
export function modelsOfTiers<T extends Pick<VideoTierSpec, "model">, P extends string>(
  tiers: readonly T[],
  providerOf: (t: T) => P,
): VideoModelOf<T, P>[] {
  const out: VideoModelOf<T, P>[] = [];
  for (const t of tiers) {
    const hit = out.find((m) => m.model === t.model);
    if (hit) hit.tiers.push(t);
    else out.push({ model: t.model, provider: providerOf(t), tiers: [t] });
  }
  return out;
}

/** 一组（一家；不分家时整张表一组，provider = null）里的若干行 */
export interface FitGroup<R, P extends string> {
  provider: P | null;
  rows: R[];
}

/** 卡片页的一行：结论相同的几个模型并成一行 */
export interface CardFitRow<T, P extends string> {
  models: VideoModelOf<T, P>[];
  state: FitState;
}

/** 组里各类模型的先后：收参考图的在前、只经由帧的其次、只认起拍画面的最后（与改之前那三行的先后一样：最常用的在最上面） */
const INPUT_ORDER: Record<CardInput, number> = { refs: 0, frames: 1, start: 2 };

/**
 * 按家分组（byProvider 为假 = 不分家：地区不知道时不写供应商，整张表一组），组的顺序 = 每家第一次出现的位置；
 * 组里的模型按 INPUT_ORDER 排（同一类里保持档位表顺序）—— 于是行的顺序 = 行里第一个模型的位置，两页都不用另排。
 */
function groupBy<T extends Pick<VideoTierSpec, "startOnly" | "refImg">, P extends string>(
  models: VideoModelOf<T, P>[],
  byProvider: boolean,
): { provider: P | null; models: VideoModelOf<T, P>[] }[] {
  const out: { provider: P | null; models: VideoModelOf<T, P>[] }[] = [];
  for (const m of models) {
    const key = byProvider ? m.provider : null;
    const hit = out.find((g) => g.provider === key);
    if (hit) hit.models.push(m);
    else out.push({ provider: key, models: [m] });
  }
  const rank = (m: VideoModelOf<T, P>) => INPUT_ORDER[cardInputOf(m.tiers[0])];
  for (const g of out) g.models.sort((x, y) => rank(x) - rank(y));
  return out;
}

/**
 * 卡片页那一格：一张卡在这几个模型上，按家分组、组内结论相同的模型并成一行（行的顺序 = 行里第一个模型的位置）。
 * 背景卡回空数组（调用方本来就不摆这一格）。models 为空也回空数组（这个地区一个模型都给不出：调用方说那一句）。
 */
export function fitRowsForCard<T extends CardFitCaps, P extends string>(
  card: FitCard,
  models: VideoModelOf<T, P>[],
  ctx: FitCtx,
  byProvider: boolean,
): FitGroup<CardFitRow<T, P>, P>[] {
  if (card.type === "background") return [];
  return groupBy(models, byProvider).map((g) => {
    const rows: CardFitRow<T, P>[] = [];
    for (const m of g.models) {
      const state = cardFitOn(card, m.tiers[0], ctx);
      if (!state) continue;
      const hit = rows.find((r) => r.state === state);
      if (hit) hit.models.push(m);
      else rows.push({ models: [m], state });
    }
    return { provider: g.provider, rows };
  });
}

/** 卡组页的一行：对每张卡结论都相同的几个模型并成一行，counts 是各状态的张数（加起来 = total） */
export interface DeckFitRow<T, P extends string> {
  models: VideoModelOf<T, P>[];
  counts: Partial<Record<FitState, number>>;
}

/** 状态的固定顺序（卡组页一行里各状态的先后；与卡片页那几句的先后一致） */
const STATE_ORDER: readonly FitState[] = [
  "image",
  "asset",
  "needAsset",
  "realPhoto",
  "text",
  "frameOnly",
  "photo",
  "startFrames",
  "ownImage",
  "onlyAsStart",
  "textOnly",
  "noRealFace",
];

/** counts 的签名（并行用）：按固定顺序写出来，键的插入顺序不影响 */
function countsKey(c: Partial<Record<FitState, number>>): string {
  return STATE_ORDER.map((s) => c[s] ?? 0).join(",");
}

/**
 * 卡组页的摘要：total = 不算背景卡的张数（0 = 整块不画）；groups 同卡片页的分组，每个模型先数出各状态的张数，
 * 张数**完全相同**的模型并成一行（与卡片页「结论相同就并」同一个口径，2026-10-26 设计审核）。
 * ctxOf 必填（每张卡各问一次认证 / 能不能有起拍画面）。
 */
export function fitRowsForDeck<C extends FitCard, T extends CardFitCaps, P extends string>(
  cards: readonly C[],
  models: VideoModelOf<T, P>[],
  ctxOf: (c: C) => FitCtx,
  byProvider: boolean,
): { total: number; groups: FitGroup<DeckFitRow<T, P>, P>[] } {
  const counted = cards.filter((c) => c.type !== "background");
  const ctxs = counted.map((c) => ctxOf(c));
  const groups = groupBy(models, byProvider).map((g) => {
    const rows: (DeckFitRow<T, P> & { key: string })[] = [];
    for (const m of g.models) {
      const counts: Partial<Record<FitState, number>> = {};
      counted.forEach((c, i) => {
        const s = cardFitOn(c, m.tiers[0], ctxs[i]);
        if (s) counts[s] = (counts[s] ?? 0) + 1;
      });
      const key = countsKey(counts);
      const hit = rows.find((r) => r.key === key);
      if (hit) hit.models.push(m);
      else rows.push({ models: [m], counts, key });
    }
    return { provider: g.provider, rows: rows.map(({ models: ms, counts }) => ({ models: ms, counts })) };
  });
  return { total: counted.length, groups };
}

/** 一行里各状态按固定顺序列出来（只列张数 > 0 的） —— 卡组页拼句子用，顺序不随卡的先后变 */
export function deckRowStates(counts: Partial<Record<FitState, number>>): { state: FitState; n: number }[] {
  return STATE_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({ state: s, n: counts[s] ?? 0 }));
}
