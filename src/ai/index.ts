// AI 管线统一出口：.env.local 配了 ARK_API_KEY（真实 AI）走火山方舟，
// 否则走 mock——store/UI 只 import 这里，实现可整体切换。
import { AI_REAL } from "./arkClient";
import * as mock from "../mock/ai";
import { makeFrame } from "../mock/frames";
import * as real from "./real";

export type { MaterialFile, ProposalContext } from "../mock/ai";
export type { SegmentResult } from "./real";

export const searchMarket = mock.searchMarket; // 市场是社区数据，暂留种子实现
export const generateCards = AI_REAL ? real.generateCards : mock.generateCards;
/** mock 构建忽略 onProgress（本地 2 秒内出结果，无进度可报） */
export const generateProposals: typeof real.generateProposals = AI_REAL
  ? real.generateProposals
  : (ctx) => mock.generateProposals(ctx);
export const composeVideo = mock.composeVideo; // 合成动画节奏（真实生成由 composeSegments 负责）
/** 封面工坊：mock 构建出本地占位帧（带演示水标语义），真实构建走 Seedream */
export const generateCover: typeof real.generateCover = AI_REAL
  ? real.generateCover
  : async (req) => makeFrame(`cover:${req}:${Math.random()}`, `${req.slice(0, 10) || "封面"} · 演示`);

/** 本片卡组提炼：真实构建 AI 对照已有素材卡，只补剧情里缺卡的实体（每类可多张）；
 *  mock 构建退化为按段派生场景卡（首帧当卡面），同名已有卡跳过 */
export const deriveDeckCards: typeof real.deriveDeckCards = AI_REAL
  ? real.deriveDeckCards
  : async (segments, _styleHint, existing = []) => {
      const have = new Set(existing.map((c) => c.name));
      return segments
        .map((sg, i) => ({
          id: `card_drv_${Date.now().toString(36)}_${i}`,
          type: "scene" as const,
          name: sg.title.replace(/^第\d+段 · /, "").slice(0, 8) || `场景${i + 1}`,
          summary: sg.plot.slice(0, 60),
          cover: sg.firstFrame,
        }))
        .filter((c) => !have.has(c.name));
    };
/** 逐段 Seedance 生成（仅真实 AI 构建可用；mock 构建返回空结果 = 首尾帧渐变） */
export const composeSegments: typeof real.composeSegments = AI_REAL
  ? real.composeSegments
  : async (segs) => segs.map(() => ({}));
export { AI_REAL };
