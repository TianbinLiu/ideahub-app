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
 *   买卡 = 买得起就买最贵的；装不下 = 用同类型里更便宜的旧卡顶掉；
 *   交片 = 每个槽位放自己品质最高的那张；投票 = 按卡品质加权随机。
 *   它**不会**存钱吃利息、不会刷新、不会为了凑类型卖卡 —— 这些留给"AI 变强"那一步。
 */
import {
  SLOT_TYPES,
  canAddCard,
  cardPrice,
  eventOptionsFor,
  ownedCards,
  screeningOrderOf,
} from "./rules.ts";
import type { GameCard, GameEventOption, GamePlayer, GameState, Rng } from "./types";

// ────────────────────────────── 商店（§2.3） ──────────────────────────────

/** AI 在商店阶段的一步棋；"done" = 这一回合不再花钱。 */
export type AiShopMove =
  | { kind: "buy"; slot: number }
  | { kind: "replace"; slot: number; outCardId: string }
  | { kind: "done" };

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

  for (const { card, slot } of offers) {
    if (canAddCard(player, card) === null) return { kind: "buy", slot };
    // 装不下：同类型里最便宜、且比这张新卡便宜的旧卡顶掉。
    // ★ 只换更便宜的：同价换卡是把一张卡换成另一张同名品质的卡，纯亏（rules.replaceCardInBag 不返钱）。
    // ★ 带装备的角色不能顶（rules 会回 role-equipped），这里先排掉，省得编排层每次都要吞一次失败。
    const outgoing = player.bag
      .filter(
        (owned) =>
          owned.type === card.type &&
          cardPrice(owned) < cardPrice(card) &&
          !(owned.type === "role" && player.equipment.some((entry) => entry.roleCardId === owned.id)),
      )
      .sort((a, b) => cardPrice(a) - cardPrice(b) || (a.id < b.id ? -1 : 1))[0];
    if (outgoing) return { kind: "replace", slot, outCardId: outgoing.id };
  }
  return { kind: "done" };
}

// ────────────────────────────── 创作（§2.4） ──────────────────────────────

/** AI 这一期交什么片：三个槽位各放自己品质最高的那张卡 + 一句随机提示词。 */
export interface AiEntryPlan {
  cards: GameCard[];
  prompt: string;
}

/**
 * AI 的交片计划。提示词从调用方递进来的池子里随机抽一条（★ 文案不进规则 / 决策层：
 * 这个文件里一个中文都不该有，界面用 Lingui 管多语言，池子由 store 传进来 —— 与 Rng 同一种注入法）。
 * ★ 每类卡只放一张：三个虚框是"角色 / 场景 / 道具各一个"（rules.SLOT_TYPES），放两张同类型会被规则拒。
 * ★ 一张卡都没有 = 空镜：照样交（不然它会把展映卡死），代价是没人投它（aiVote 的权重）。
 */
export function aiEntryPlan(state: GameState, playerId: string, rng: Rng, prompts: readonly string[]): AiEntryPlan {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const owned = player ? ownedCards(player) : [];
  const cards: GameCard[] = [];
  for (const type of SLOT_TYPES) {
    const best = owned
      .filter((card) => card.type === type)
      .sort((a, b) => b.quality - a.quality || (a.id < b.id ? -1 : 1))[0];
    if (best) cards.push(best);
  }
  const pool = prompts.length > 0 ? prompts : [""];
  const prompt = pool[Math.min(pool.length - 1, Math.floor(unit(rng) * pool.length))];
  return { cards, prompt };
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
