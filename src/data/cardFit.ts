// 「这张卡在各出片模型上用得上哪一部分」—— 判据的**唯一实现**（2026-10-02 从 components/CardModelFit 抽出来）。
//
// ★ 为什么抽：卡片页那一格（CardModelFit 的三行说明）与卡组页的适配摘要说的是同一件事。判据留在组件里的话，
//   卡组页只能再抄一遍 —— 而这几条事实（哪一代模型收不收参考图、真人照片过不过得去）改过好几轮，
//   抄出来的那份迟早停在上一版（铁律六）。
// ★ 这里只有**状态**，没有一句文案：卡片页逐张说整句，卡组页按状态数张数，两处措辞本来就不同。
// ★ 与出片管线同一套事实（细节见 CardModelFit 文件头与 studio/segmentGen）：
//   · 高清 / 电影级（Seedance 2.x）收参考图：形象图直接进模型；真人照片只有认证素材（asset://）过得去；
//   · 标准 / 极速（Seedance 1.0）不收参考图：形象只能经由设定帧起作用，或者靠文字版形象描述；不收真人照片；
//   · 真人档（海螺）只认一张起拍画面：真人卡以照片起拍，其余卡看有没有专门画好的起拍画面。
// ⚠ 档位换代时（哪一代开始收参考图、真人档换供应商）改的是这里与 segmentGen 两处，别只改文案。
import { assetOf } from "./cardAsset";
import { startFramesAllowed, type Card } from "../types";

/** 收参考图的 2.x 档（草稿 / 高清 / 电影级）：image = 形象图直接进模型；asset = 真人卡以火山引擎认证素材进模型；needAsset = 真人卡还没认证，进不了 */
export type FitRef = "image" | "asset" | "needAsset";
/** 标准 / 极速：text = 有文字版形象描述；frameOnly = 只经由设定帧起作用；noRealFace = 真人卡（这两档不收真人照片） */
export type FitFrames = "text" | "frameOnly" | "noRealFace";
/**
 * 真人档：photo = 以真人照片起拍；startFrames = 有专门画好的起拍画面；ownImage = 人物卡拿卡上的图起拍（白底立绘开场就是白底）；
 * onlyAsStart = 场景 / 道具卡，只有它当起拍画面时形象图才用得上；textOnly = 只以文字参与（风格卡）
 */
export type FitStart = "photo" | "startFrames" | "ownImage" | "onlyAsStart" | "textOnly";

export interface CardFit {
  ref: FitRef;
  frames: FitFrames;
  start: FitStart;
}

/**
 * 一张卡在三类出片模型上的状态。**null = 背景卡**：它在所有档位本来就只以文字参与（故事背景），没有"适配"这回事。
 * ★ 真人卡的认证读 cardAsset.assetOf（按「主人 + 卡 id」存，只查得到现在这个人的那一条）—— 所以这是"**我**用这张卡"的答案，
 *   别拿去判别人的卡（广场上的卡没有我的认证，一律会答 needAsset）。
 */
export function cardFitOf(card: Card): CardFit | null {
  if (card.type === "background") return null;
  const real = card.type === "character" && card.realPerson === true;
  const textOn = !!card.textDesc?.trim();
  const framesOn = !!(card.startFrames?.portrait || card.startFrames?.landscape);
  return {
    ref: real ? (assetOf(card.id) ? "asset" : "needAsset") : "image",
    frames: real ? "noRealFace" : textOn ? "text" : "frameOnly",
    start: real
      ? "photo"
      : framesOn
        ? "startFrames"
        : card.type === "character"
          ? "ownImage"
          : startFramesAllowed(card)
            ? "onlyAsStart"
            : "textOnly",
  };
}

/** 一组卡在三类出片模型上各有几张处于哪种状态（卡组页的适配摘要）。total 不含背景卡 */
export interface DeckFit {
  total: number;
  ref: Record<FitRef, number>;
  frames: Record<FitFrames, number>;
  start: Record<FitStart, number>;
}

export function deckFitOf(cards: Card[]): DeckFit {
  const out: DeckFit = {
    total: 0,
    ref: { image: 0, asset: 0, needAsset: 0 },
    frames: { text: 0, frameOnly: 0, noRealFace: 0 },
    start: { photo: 0, startFrames: 0, ownImage: 0, onlyAsStart: 0, textOnly: 0 },
  };
  for (const c of cards) {
    const fit = cardFitOf(c);
    if (!fit) continue;
    out.total += 1;
    out.ref[fit.ref] += 1;
    out.frames[fit.frames] += 1;
    out.start[fit.start] += 1;
  }
  return out;
}
