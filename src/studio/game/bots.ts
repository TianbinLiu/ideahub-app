/**
 * 单机版的 AI 陪玩（G3 回合循环）：纯函数、随机源从参数注入、**不写一条规则**。
 *
 * ★ 为什么单开一个文件（而不写在 store 里）：
 *   · 规则（rules.ts）只表态"这张卡买不买得起 / 装不装得下"，**不表态"这张值不值得买"** ——
 *     那是陪玩的性格，不是规则；两件事混在一起，以后调 AI 就要动规则文件。
 *   · 它必须能被整局跑：scripts/check-game-bots.mjs 用 Node 直接 import 它和 phases.ts，
 *     一局 8 回合在脚本里跑完（不点一次界面），AI 买错卡 / 投错票这类事才在构建里就红。
 *     所以这里既不能碰 React，也不能碰 store。
 * ★ 现在的启发式是"够用的笨"（G3 的目标是把一局跑通，不是把 AI 调强）：
 *   买卡 = 买得起就买最贵的（G4 §3 起背包不再有上限，所以不用再"顶掉旧卡"）；
 *   摆卡 = 品质最高的角色卡摆进 4 个角色位、最好的场景卡摆场景位，剩下的道具挂到品质最高的角色上；
 *   交片 = 用桌面这套（submitRoundEntry 自己从桌面派生）+ 一句随机提示词；投票 = 按卡品质加权随机。
 *   它**不会**存钱吃利息、不会刷新、不会为了凑类型卖卡 —— 这些留给"AI 变强"那一步。
 */
import {
  cardPrice,
  eventOptionsFor,
  tableCardsOf,
  itemLimitOf,
  screeningOrderOf,
} from "./rules.ts";
import type { GameCard, GameEventOption, GamePlayer, GameState, Rng } from "./types";

// ────────────────────────────── 商店（§2.3） ──────────────────────────────

/**
 * AI 在商店阶段的一步棋；"done" = 这一回合不再花钱。
 * ★ G4 第 3 步删掉了 "replace" 那一步：背包不再有上限（施工单 §3），"装不下才换卡"这条路
 *   在这局里根本走不到 —— 留着它就是一个永远为假的 AI 分支。
 */
export type AiShopMove = { kind: "buy"; slot: number } | { kind: "done" };

/**
 * AI 在商店阶段的**下一步**（一次一步，由编排层 loop 到 done）。
 * ★ 为什么一次只回一步而不是一整串：每一步之后 state 都变了（钱少了 / 那格空了 / 背包满没满），
 *   一次算一串就得在调用方里重放中间态 —— 那等于在这里偷一份 state 副本，两处很快就对不上。
 * ★ 挑最贵的：品质 = 买价（rules.cardPrice），贵的就是强的（G3 的卡只有品质一个维度）。
 *   钱不够的整张跳过；同价按 id 定序（同一份 state 永远出同一手，脚本能断言）。
 */
export function aiShopMove(state: GameState, playerId: string): AiShopMove {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.eliminated) return { kind: "done" };
  const shop = state.shops[playerId];
  if (!shop) return { kind: "done" };

  const offers = shop.cards
    .map((card, slot) => ({ card, slot }))
    .filter((offer): offer is { card: GameCard; slot: number } => offer.card !== null)
    .filter((offer) => cardPrice(offer.card) <= player.gold)
    .sort((a, b) => cardPrice(b.card) - cardPrice(a.card) || (a.card.id < b.card.id ? -1 : 1));

  const best = offers[0];
  if (best) return { kind: "buy", slot: best.slot };
  return { kind: "done" };
}

// ────────────────────────────── 摆卡（G4 第 3 步） ──────────────────────────────

/**
 * AI 这一回合的摆卡计划：把手上品质最高的角色卡摆进角色位、最好的场景卡摆进场景位，
 * 再把剩下的道具挂到**品质最高的那张角色**上（每角色最多 rules.itemLimitOf 张）。
 * ★ 只回"要做什么"，不碰 state：落地走 rules.placeOnTable / rules.equipItem（单一实现）。
 *   失败（比如道具挂到一张还没摆到桌上的角色上）不在这里吞 —— 编排层照 rules 的回执处理。
 */
export interface AiTablePlan {
  /** 要摆上桌的卡（按顺序：先角色后场景） */
  place: string[];
  /** 要装备的（角色 id + 道具 id） */
  equip: { roleCardId: string; itemCardId: string }[];
}

export function aiTablePlan(state: GameState, playerId: string): AiTablePlan {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return { place: [], equip: [] };
  const byQuality = (a: GameCard, b: GameCard) => b.quality - a.quality || (a.id < b.id ? -1 : 1);
  // 已经在桌上的算"已经摆好"（不重复摆），手上剩下的才补空位
  const onTable = new Set(tableCardsOf(player).map((card) => card.id));
  const roles = player.bag.filter((card) => card.type === "role" && !onTable.has(card.id)).sort(byQuality);
  const scenes = player.bag.filter((card) => card.type === "scene" && !onTable.has(card.id)).sort(byQuality);
  const items = player.bag.filter((card) => card.type === "item").sort(byQuality);

  const place = [...roles.map((card) => card.id), ...scenes.slice(0, 1).map((card) => card.id)];
  // 挂道具：按桌上的角色品质从高到低轮流挂，每张到各自的限为止
  const tableRoles = [...tableCardsOf(player).filter((card) => card.type === "role"), ...roles].sort(byQuality);
  const equippedHas = new Map<string, number>();
  for (const entry of player.equipment) {
    equippedHas.set(entry.roleCardId, (equippedHas.get(entry.roleCardId) ?? 0) + 1);
  }
  const cap = itemLimitOf(player);
  const equip: { roleCardId: string; itemCardId: string }[] = [];
  let cursor = 0;
  for (const item of items) {
    // 找下一张还挂得下的角色（一轮里依次摊开，别把 3 张都堆给同一个人）
    let target: GameCard | null = null;
    for (let probe = 0; probe < tableRoles.length; probe += 1) {
      const role = tableRoles[(cursor + probe) % tableRoles.length];
      if ((equippedHas.get(role.id) ?? 0) >= cap) continue;
      // 还没摆到桌面的角色：等 place 那一批落地之后才存在，这里只按"会摆上去"的算
      target = role;
      cursor = (cursor + probe + 1) % tableRoles.length;
      break;
    }
    if (!target) break;
    equippedHas.set(target.id, (equippedHas.get(target.id) ?? 0) + 1);
    equip.push({ roleCardId: target.id, itemCardId: item.id });
  }
  return { place, equip };
}

// ────────────────────────────── 创作（§2.4） ──────────────────────────────

/** AI 这一期交什么片：桌面那套（摆好的角色 / 场景 / 道具）+ 一句随机提示词。 */
export interface AiEntryPlan {
  prompt: string;
}

/**
 * AI 的交片计划。提示词从调用方递进来的池子里随机抽一条（★ 文案不进规则 / 决策层：
 * 这个文件里一个中文都不该有，界面用 Lingui 管理多语言，池子由 store 传进来 —— 与 Rng 同一种注入法）。
 * ★ G4 第 3 步起**卡不在这个计划里**：一期作品的卡 = 桌面上的卡 + 装备的道具（rules.castCardsOf），
 *   那是状态不是决定。AI 要"用哪几张卡"改走 aiTablePlan（摆卡）。
 * ★ 一张卡都没有 = 空镜：照样交（不然它会把展映卡死），代价是没人投它（aiVote 的权重）。
 */
export function aiEntryPlan(_state: GameState, _playerId: string, rng: Rng, prompts: readonly string[]): AiEntryPlan {
  const pool = prompts.length > 0 ? prompts : [""];
  const prompt = pool[Math.min(pool.length - 1, Math.floor(unit(rng) * pool.length))];
  return { prompt };
}

/** 把注入的 rng 夹进 [0, 1)：坏 rng 不许让 AI 决策拿到 undefined 的下标（与 rules.unit 同一条理由）。 */
function unit(rng: Rng): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.999999999, Math.max(0, value));
}

// ────────────────────────────── 展映：点赞（§2.5） ──────────────────────────────

/** 每人对一条片子点赞的概率：一半偏少 —— 四条全点等于没点（榜上没有区分度）。 */
const AI_LIKE_CHANCE = 0.55;

/**
 * AI 在展映里给哪些片子点赞（返回 entryId 列表，调用方逐条走 rules.likeEntry）。
 * ★ 随机、不看品质：点赞是"讨喜"，本来就该和"专业"（投票）分开 —— §2.5 要的就是两个榜。
 * ★ 也点自己那条（规则允许，见 rules.likeEntry 的 ★）。
 */
export function aiLikes(state: GameState, playerId: string, rng: Rng): string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.eliminated) return [];
  const picks: string[] = [];
  for (const entry of screeningOrderOf(state)) {
    if (entry.likedBy.includes(playerId)) continue;
    if (unit(rng) < AI_LIKE_CHANCE) picks.push(entry.id);
  }
  return picks;
}

// ────────────────────────────── 投票（§2.5） ──────────────────────────────

/**
 * 一条片子的"专业分"权重：卡越好越可能被投（空镜只有 1 分 —— 几乎没人投，但不是不可能）。
 * ★ 为什么权重看卡品质而不是随机：§2.4 的卡就是"画面加成"，玩家花钱买贵的卡应该换来看得见的结果；
 *   完全随机的话这一局的经济系统在结算上没有任何反馈。
 */
export function entryWeightOf(entry: { cards: readonly GameCard[] }): number {
  return 1 + entry.cards.reduce((sum, card) => sum + card.quality, 0);
}

/**
 * AI 投给谁：在"除自己外"的片子里按 entryWeightOf 加权随机；没有可投的（只剩自己）回 null。
 * ★ 不能投自己这一条**不在**这里判 —— 它由 rules.voteEntry 兜（这里只是不去挑自己，规则才是闸）。
 */
export function aiVote(state: GameState, playerId: string, rng: Rng): string | null {
  const candidates = screeningOrderOf(state).filter((entry) => entry.playerId !== playerId);
  if (candidates.length === 0) return null;
  const weights = candidates.map((entry) => entryWeightOf(entry));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = unit(rng) * total;
  for (let index = 0; index < candidates.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return candidates[index].id;
  }
  // 浮点收尾：落到最后一条（绝不回 undefined —— 回 null 会让这一局永远差一个人表态）
  return candidates[candidates.length - 1].id;
}

// ────────────────────────────── 事件（§2.3b） ──────────────────────────────

/**
 * AI 会选的事件选项，**按随机的偏好顺序**排出候选（调用方依次试着 applyEventChoice，
 * 被拒就换下一个 —— 比如"随机一张蓝卡"把背包撑破时，rules 会整项拒）。
 * ★ 只挑买得起的：AI 不为了一个事件把金币花到 0 以下（规则也会拒）。
 * ★ 没有可选项时回空数组：调用方据此说"这一局的事件没人选"（不该发生，三个事件都有一个免费项）。
 */
export function aiEventOptions(state: GameState, playerId: string, rng: Rng): string[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || player.eliminated) return [];
  const options = eventOptionsFor(state, playerId);
  if (!options.ok) return [];
  const affordable = options.options.filter((option) => option.cost <= player.gold);
  // 先按随机顺序打散，再把"花大钱的"往前提一点（AI 想变强）：
  // 排序用一次 rng 扰动，不是 Math.random —— 同一个 seed 的 AI 必须永远做同一批选择（可复盘）。
  const shuffled = affordable
    .map((option) => ({ option, key: unit(rng) + (option.cost > 0 ? 0 : 0.15) }))
    .sort((a, b) => a.key - b.key)
    .map((row) => row.option.id);
  return shuffled;
}

/** 事件选项的"选不选得起"读数（AI 的候选已经筛过一遍，这里是给界面 / 复盘读的同一份判据）。 */
export function canAffordOption(player: GamePlayer, option: GameEventOption): boolean {
  return option.cost <= player.gold;
}
