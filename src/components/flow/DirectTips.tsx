// 「参考图直出」（跟着做 A）的两句提示 —— 画布「🖼 直出」页签与工坊铸段窗的直出车道共用这一份。
//
// ★ 出处：2026-10-04 A 的付费验证（docs/guided-modes-design.md 第七节）：两段高清直出、第二段承接第一段的真实尾帧，
//   人物与接缝都好，但第二段在模型自己切镜之后，从「雨夜、暖灯的旧书店」漂成了「白天、哥特高窗的大图书馆」——
//   第二段的提示词只写了取书递书，没写地点和时间；「接着上一帧往下演」那句只管住了承接的那一个镜头。
//   主人同日「做 1 和 2」：① 承接时提示把地点 / 时间 / 光线再写一遍；② 推荐挂一张场景卡。
// ★ 两句互补，不是重复：场景卡在直出时当「定场参考图」发（real.BIND_HINT.scene），锁的是空间结构与建筑轮廓，
//   **光线、天气与时间按那句话的约定跟着剧情走** —— 所以挂了场景卡，时间和光线仍得写进文字里。
// ★ 只收 props、不认识 store（与 CustomFrameSlots 同一条约束）：说不说的判断只在这里，两个宿主只给事实。
import { Trans } from "@lingui/react/macro";
import { tierOf } from "../../data/economy";
import type { Card } from "../../types";

/**
 * 推荐挂一张场景卡。只在这一档**真的会把卡面发给视频模型**时说（收参考图的两档）——
 * 1.0 两档上直出段会先画帧（卡面喂给的是出图模型）、真人档只拿真人卡的照片起拍，在那几档上这么说是假话。
 * 已经挂了场景卡就不说。
 */
export function SceneCardTip({ cards, tierId, className = "" }: { cards: readonly Card[]; tierId: string; className?: string }) {
  if (!tierOf(tierId).refImg || cards.some((c) => c.type === "scene")) return null;
  return (
    <p className={`text-[10px] leading-relaxed text-slate-500 ${className}`}>
      <Trans>要拍好几段的话，再挂一张场景卡：卡面会当定场参考图发给视频模型，切镜头之后地点也有图可依。</Trans>
    </p>
  );
}

/**
 * 接在上一段后面时（宿主传这一段承不承接）：提示把地点、时间和光线再写一遍。
 * 不分档位 —— 每一发请求都是独立的，模型只看得到这一段的句子和图；真人档同样拿上一段的尾帧起拍（segmentGen 的真人档那一支）。
 */
export function RestatePlaceTip({ chained, className = "" }: { chained: boolean; className?: string }) {
  if (!chained) return null;
  return (
    <p className={`text-[10px] leading-relaxed text-slate-500 ${className}`}>
      <Trans>模型不记得上一段在哪：把地点、时间和光线再写一遍（例：「还是雨夜的旧书店，暖黄的灯光」），不然切镜头之后可能换个地方。</Trans>
    </p>
  );
}
