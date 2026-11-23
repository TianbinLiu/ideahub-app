/**
 * 对局 → 出片的**翻译层**（G4 施工单 §2「摆完卡 → 点视频生成」）。
 *
 * ★ 这里不新写一条出片实现：铺段走 `flowStore.appendNode`（与工坊铸段窗 / 跟着做 / 快速模式同一批），
 *   画首帧走 `flowStore.regenProposal`，出片走 `flowStore.genNode` —— 首帧确认 → 出片这两步就是
 *   快速模式（QuickModePage）那一条，本文只负责"把桌面上的卡 + 提示词变成 AppendSpec"。
 * ★ 提示词里为什么会有卡名：素材卡走的是现有机制 —— `Card.name`（有 idLine 时那句也一起）
 *   由 segmentGen.materialText 拼成「人物卡「名字」＝…」进视频提示词，玩家那句进 plot / requirement。
 *   **不另造一套点名句**（点名句是"这个位子上是谁"，与"这一发要画哪些卡"不是一回事）。
 * ★ 对局的卡没有形象图、也没有 idLine（rules.CARD_LIBRARY 只有 type/quality/name）——
 *   所以这些段是**纯文字出片**：靠卡名 + 提示词，不往模型塞图。等卡片库接进来（卡上有图 / 有 idLine）
 *   时这里一个字都不用改（gameMaterialOf 补两位即可）。
 * ★ 档位：rules 只回「哪一档 + 多少 p」（零依赖，不认识 data）；id 的翻译在这里，写法与快速模式
 *   同一份（tierOf + tierOfPreferred + tierOffered）：**这台机器给得出 MiniMax 就用它**
 *   （2026-11-19 真机：同一张写实人像首帧 Seedance 侧整发拒、H3 Lite 收）。
 */
import type { Card as StudioCard } from "../../types";
import { DEFAULT_ASPECT, uid } from "../../types";
import { tierOf } from "../../data/economy";
import { tierOffered, tierOfPreferred } from "../../data/account";
import {
  appendedNode,
  chosenOf,
  nodeCost,
  redrawCost,
  useFlow,
  type AppendSpec,
  type FlowNode,
} from "../flowStore";
import { castCardsOf } from "./rules";
import type { GameGenerationTier, GamePlayer } from "./types";

/**
 * rules 的档位（draft / hd / cinema）→ 档位表的**系列 id**。
 * ★ "cinema" 在档位表里没有同名的 id：1080p 只存在于 `ultra` 的「样片 → 定稿」第二步
 *   （docs/g2-game-ui.md §4 第 3 条的结论），所以 L3 落在 `ultra`。写死成表，别在调用点三元。
 */
const TIER_FAMILY: Record<GameGenerationTier["tier"], string> = {
  draft: "draft",
  hd: "hd",
  cinema: "ultra",
};

/**
 * 这一发按哪个 tierId 出片（规则层的档位名 → 这台机器摆得出来的那一档）。
 * ★ 与快速模式 `previewTierId` 逐字同源：优先这个地区给得出的 MiniMax 同档，给不出就用原名那一档。
 */
export function gameTierIdOf(tier: GameGenerationTier["tier"]): string {
  const base = tierOf(TIER_FAMILY[tier]);
  const mm = tierOfPreferred(base, "minimax");
  return tierOffered(mm) ? mm.id : base.id;
}

/** rules.generationTierOf 的等价读法（只要档位名这一格；玩家等级 → draft / hd / cinema）。 */
export function gameTierOf(player: GamePlayer): GameGenerationTier["tier"] {
  if (player.modelLevel === 3) return "cinema";
  if (player.modelLevel === 2) return "hd";
  return "draft";
}

/** 对局的卡 → 出片素材卡（只有名字：见文件头 ★；对局三种卡映射到卡片库的卡种）。 */
export function gameMaterialOf(card: { id: string; type: "role" | "scene" | "item"; name: string }): StudioCard {
  return {
    id: card.id,
    type: card.type === "role" ? "character" : card.type === "scene" ? "scene" : "prop",
    name: card.name,
    // 简介不进出片（types.idLineOf 的规矩）：留空串，卡名就是这张卡在提示词里的全部
    summary: "",
    cover: "",
  };
}

/**
 * 这一期的出片契约：桌面上的卡（+ 装备在角色身上的道具）当素材，玩家那句当剧情。
 * ★ `chain: false`：每回合那一段是独立的（摆哪几张卡由玩家自己说，不承接上一段的尾帧）——
 *   承接会让"这回合换了个场景"变成"接着上一段的画面拍"，而两张卡根本不是同一场戏。
 * ★ `gameRound` 标记这一局出的段（工作流预览只认它），不缺省。
 */
export function gameSegmentSpec(player: GamePlayer, prompt: string, round: number): AppendSpec {
  const materials = castCardsOf(player).map(gameMaterialOf);
  const proposalId = uid("game");
  return {
    proposals: [
      { id: proposalId, title: `R${round}`, plot: prompt, firstFrame: "", lastFrame: "", durationSec: 5 },
    ],
    chosenId: proposalId,
    materials,
    requirement: prompt,
    videoTier: gameTierIdOf(gameTierOf(player)),
    aspect: DEFAULT_ASPECT,
    chain: false,
    gameRound: round,
  };
}

/** 这一局已经铺过的那些段（按回合升序）：工作流预览 / "这一回合出过片没有"读它。 */
export function gameNodesOf(nodes: readonly FlowNode[]): FlowNode[] {
  return nodes
    .filter((node) => node.gameRound !== undefined)
    .sort((a, b) => (a.gameRound ?? 0) - (b.gameRound ?? 0));
}

/** 这一回合已经铺好的那一段（重开生成小窗时复用，不重复 append）。 */
export function gameNodeOfRound(nodes: readonly FlowNode[], round: number): FlowNode | null {
  return nodes.find((node) => node.gameRound === round) ?? null;
}

/**
 * 这一段出片要花多少钱（两笔，界面照实说）：先画首帧（图）+ 再出片（视频）。
 * ★ 报价只有一份实现：图钱问 `redrawCost`（regenProposal 真扣的那一份），视频钱问 `nodeCost`
 *   （genNode 真扣的那一份）。★ 远端模式下**以服务器结算为准** —— 界面只说"约"。
 */
export function gameGenQuote(node: FlowNode, index: number): { frame: number; video: number } {
  const nodes = useFlow.getState().nodes;
  const prop = chosenOf(node);
  const prev = index > 0 ? chosenOf(nodes[index - 1]) : null;
  const mode = useFlow.getState().mode;
  return {
    frame: redrawCost(node, prop, prev),
    video: nodeCost(nodes, index, mode),
  };
}

/**
 * 还没铺段时的报价（生成小窗一打开就要显示"这一发大概多少 token"）。
 * ★ 拿 `appendedNode` 造一份**真会落下的那一段**再问价 —— 与 appendNode 同一条路（flowStore 的 ★：
 *   在宿主里另拼一个"差不多的"节点去问价，哪天多一位影响价钱的字段，报价与实扣就悄悄分叉）。
 * ★ 只造节点、**不落段**：这一步不花钱、也不改流水线。
 */
export function gameGenQuoteOf(player: GamePlayer, prompt: string, round: number): { frame: number; video: number } {
  const nodes = useFlow.getState().nodes;
  const node = appendedNode(nodes, gameSegmentSpec(player, prompt, round));
  // ★ 必须把这一份虚拟节点**一起递进去**再问价：nodeCost 是按 (nodes, idx) 取那一段的，
  //   只把 idx 递成 nodes.length 会读到 undefined → 视频价恒为 0（报价说 0、实扣不是 0）。
  const next = [...nodes, node];
  const index = nodes.length;
  const prev = index > 0 ? chosenOf(nodes[index - 1]) : null;
  const mode = useFlow.getState().mode;
  return {
    frame: redrawCost(node, chosenOf(node), prev),
    video: nodeCost(next, index, mode),
  };
}

/** 铺一段（这一步不花钱，只是把契约摆上流水线）；返回节点 id，失败 null（原因在 useFlow.err）。 */
export function seedGameSegment(spec: AppendSpec): string | null {
  return useFlow.getState().appendNode(spec);
}
