// AI 管线统一出口：.env.local 配了 ARK_API_KEY（真实 AI）走火山方舟，
// 否则走 mock——store/UI 只 import 这里，实现可整体切换。
import { AI_REAL } from "./arkClient";
import * as mock from "../mock/ai";
import * as real from "./real";

export type { MaterialFile, ProposalContext } from "../mock/ai";

export const searchMarket = mock.searchMarket; // 市场是社区数据，暂留种子实现
export const generateCards = AI_REAL ? real.generateCards : mock.generateCards;
export const generateProposals = AI_REAL ? real.generateProposals : mock.generateProposals;
export const composeVideo = mock.composeVideo; // Seedance 视频合成：阶段 B 接入
export { AI_REAL };
