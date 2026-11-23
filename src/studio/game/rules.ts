/**
 * 工坊对局规则引擎（G2 第一块）：纯 TypeScript、纯函数、零运行时依赖。
 *
 * ★★ 这一层只做规则，不接 UI、不接生成、不认识 store：
 *   · 零 React / three / zustand / @lingui（构建里 scripts/check-import-direction.mjs 把本文件
 *     钉进「零依赖规则模块」表；scripts/check-game-rules.mjs 用 Node 直接 import 它跑正反例）；
 *   · 唯一的外部输入是注入的 Rng —— 同一 seed 可以复盘一局，检查脚本也能写确定性用例；
 *   · 每个改法都**返回新对象**（不改入参）、失败一律回带 `reason` 的结果（铁律八：不静默失败）。
 * ★ 规则出处（设计稿 docs/workshop-game-design.md）逐条写在对应函数头上；§5 的待拍板项用默认值：
 *   4 人、8 回合、第 2/4/6 回合后各一次事件、模型最高 L3（要 3 连胜才开放）。
 * ★ 为什么所有东西都堆在一个文件：Node 剥类型后直接 import 它（检查脚本）要求运行时零依赖；
 *   拆成多个 import 值的文件就要开 allowImportingTsExtensions，而且规则会散成两处实现。
 */
import type {
  CardQuality,
  CardType,
  DamageEntry,
  GameBuffs,
  GameCard,
  GameEvent,
  GameEventOption,
  GameGenerationTier,
  GamePhase,
  GamePlayer,
  GameState,
  ModelLevel,
  Rng,
  RoundSettlement,
  ShopState,
  StreakEntry,
  StreakOutcome,
  StyleCard,
} from "./types";

// ────────────────────────────── 常量（设计稿里写死的数都在这里，别在函数里现编） ──────────────────────────────

/** §2.1：背包最多 9 张。 */
export const BAG_SIZE = 9;

/** §2.1 类型上限：角色 ≤4、场景 ≤1、道具 ≤4（正好 9 张；事件「补给站」可以给某一类 +1）。 */
export const TYPE_CAPS: Readonly<Record<CardType, number>> = { role: 4, scene: 1, item: 4 };

/** §2.1：100 血起跑（§2.5 扣到 0 淘汰）。 */
export const START_HP = 100;

/**
 * 开局金币。★ 设计稿 §2.0 只说「初始金币」没给数、§5 也没列，这里拍 4：
 *   4 金 = 第一回合买得起 1~2 张低费卡、又不够买一张 4 费卡，开局不至于空手也不会一步到位。
 *   （TFT 是 2 金起手，但那边第一回合没有「买卡 + 出片」两条线同时吃钱。）
 */
export const START_GOLD = 4;

/** §5-1 默认值：4 人（含 AI）；3 人也能跑（扣血缩放的用例），8 人封顶只是座位表的防呆。 */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** §5-2 默认值：打满 8 回合或剩下 ≤2 人结束。 */
export const MAX_ROUNDS = 8;

/** §2.3b / §5-7 默认值：第 2、4、6 回合结算之后各出一次事件（一局 3 次）。 */
export const EVENT_AFTER_ROUNDS: readonly number[] = [2, 4, 6];

/** §2.3：每回合商店刷 5 张；手动刷新 2 金；锁定免费。 */
export const SHOP_SIZE = 5;
export const SHOP_REFRESH_COST = 2;

/** §2.1：卖卡回收 1 金（同 TFT 的低品质回收规则，不分品质）。 */
export const CARD_SELL_GOLD = 1;

/** §2.3：每回合收入 = 基础 5 + 利息 min(5, floor(gold/10)) + 连胜/连败奖励。 */
export const INCOME_BASE = 5;
export const INTEREST_PER = 10;
export const INTEREST_CAP = 5;

/**
 * 连胜 / 连败奖励档（§2.3：2 连起 +1，5 连 +3）。
 * ★ 3、4 连都算 +2（照 TFT 的阶梯：2 连 +1、3~4 连 +2、5 连及以上 +3）。设计稿只钉了两端，
 *   中间这一档是照参照游戏补的；要改只改这张表。
 */
export const STREAK_BONUS_BY_LENGTH: readonly number[] = [0, 0, 1, 2, 2, 3];

/**
 * §2.5 扣血阶梯：最后一名 -20、倒数第二 -15、倒数第三 -10、其余 -5。
 * ★ 人少时按存活人数 / 4 等比缩放、向下取到 5 的整数倍、最低 5：
 *   4 人 = 20/15/10/5，3 人 = 15/10/5，2 人 = 10/5。不做 7.5 这种半滴血（界面按整数念）。
 */
export const DAMAGE_LADDER: readonly number[] = [20, 15, 10];
export const DAMAGE_OTHERS = 5;
/** 缩放的步长与地板（见 damageForRank）。 */
export const DAMAGE_GRID = 5;

/** §2.3b 模型升级线：L1 草稿 480p → L2 高清 720p（8 金）→ L3 电影级 1080p（15 金 + 3 连胜门槛）。 */
export const MODEL_LEVEL_UP_COST: Readonly<Record<2 | 3, number>> = { 2: 8, 3: 15 };
export const MODEL_LEVEL_TIERS: Readonly<Record<ModelLevel, GameGenerationTier>> = {
  1: { level: 1, tier: "draft", resolution: "480p" },
  2: { level: 2, tier: "hd", resolution: "720p" },
  3: { level: 3, tier: "cinema", resolution: "1080p" },
};

/** §2.2：开局从池子里抽 3 张风格卡。 */
export const STYLE_PICK_COUNT = 3;

/**
 * §2.3 商店品质权重（按回合，列 = 1~5 费，单位 %）。
 * ★ 为什么写死成表而不是公式：这是调平过的经验值，公式看着简洁但改一个系数整局经济都会歪；
 *   表可以直接按回合微调、也能被 check 脚本逐行核对「每行合计 100」「5 费条目的卡池非空」。
 * ★ 每行合计 100；第 1 回合 5 费是 0（开局就摸到金卡会让「卡池质量」这条成长线在第一回合就结束）；
 *   第 8 回合 4+5 费合计 45%（§2.3「越到后期高费卡概率越高」，最后一回合留翻盘窗口）。
 */
export const SHOP_QUALITY_WEIGHTS: readonly (readonly [number, number, number, number, number])[] = [
  [55, 30, 12, 3, 0], // 回合 1
  [45, 33, 16, 5, 1], // 回合 2
  [38, 32, 19, 8, 3], // 回合 3
  [32, 30, 21, 12, 5], // 回合 4
  [27, 27, 22, 16, 8], // 回合 5
  [22, 24, 23, 20, 11], // 回合 6
  [17, 21, 24, 24, 14], // 回合 7
  [13, 18, 24, 28, 17], // 回合 8
];

/**
 * 卡牌目录（G2 占位）：商店按品质权重抽、再按品质从这份目录里均匀抽一张。
 * ★ 名字先写英文：规则层不新增中文字面量（check-i18n 的棘轮），真卡面 / 中文名在 G2 界面那一步
 *   随素材一起进来；目录本身以后可能从服务端下发（G5），这里只保证形状与品质覆盖。
 */
export const CARD_LIBRARY: readonly GameCard[] = [
  { id: "role-intern", type: "role", quality: 1, name: "Intern Director" },
  { id: "role-extra", type: "role", quality: 1, name: "Street Extra" },
  { id: "role-gaffer", type: "role", quality: 2, name: "Gaffer" },
  { id: "role-stylist", type: "role", quality: 2, name: "Costume Stylist" },
  { id: "role-lead", type: "role", quality: 3, name: "Lead Actor" },
  { id: "role-scout", type: "role", quality: 3, name: "Location Scout" },
  { id: "role-star", type: "role", quality: 4, name: "Star Actress" },
  { id: "role-dp", type: "role", quality: 5, name: "Award-Winning DP" },
  { id: "scene-rooftop", type: "scene", quality: 1, name: "Rooftop at Dusk" },
  { id: "scene-alley", type: "scene", quality: 2, name: "Rainy Alley" },
  { id: "scene-arcade", type: "scene", quality: 3, name: "Neon Arcade" },
  { id: "scene-theater", type: "scene", quality: 4, name: "Abandoned Theater" },
  { id: "scene-city", type: "scene", quality: 5, name: "Floating City" },
  { id: "item-fan", type: "item", quality: 1, name: "Handheld Fan" },
  { id: "item-crown", type: "item", quality: 1, name: "Plastic Crown" },
  { id: "item-camera", type: "item", quality: 2, name: "Vintage Camera" },
  { id: "item-umbrella", type: "item", quality: 2, name: "Neon Umbrella" },
  { id: "item-smoke", type: "item", quality: 3, name: "Smoke Machine" },
  { id: "item-mirrorball", type: "item", quality: 4, name: "Mirror Ball" },
  { id: "item-mic", type: "item", quality: 5, name: "Golden Microphone" },
];

/**
 * 风格卡池（§2.2）：8 个占位条目，一局抽 3 张。技法名词 × 题材 + 离线样张文件名。
 * ★ 样张按 §2.2 的规定离线批量生成、打进包（public/styles/<id>.webp），选风格那一步**绝不实时生成**；
 *   今天仓里还没有 public/styles/（图要走「不许提交 .png」之外的素材流程），这里先把文件名占住。
 * ★ 中文的技法名词 / 题材名等界面那一步随样张一起走 Lingui，规则层只留英文占位。
 */
export const STYLE_POOL: readonly StyleCard[] = [
  { id: "cel-cyberpunk", technique: "Cel-shading + 3D-to-2D", topic: "Cyberpunk", sample: "public/styles/cel-cyberpunk.webp" },
  { id: "film-hk-neon", technique: "Film grain + 50mm shallow DOF", topic: "90s Hong Kong neon", sample: "public/styles/film-hk-neon.webp" },
  { id: "fresco-renaissance", technique: "Fresco texture + Rembrandt light", topic: "Renaissance fantasy", sample: "public/styles/fresco-renaissance.webp" },
  { id: "ink-wuxia", technique: "Ink wash + negative space", topic: "Wuxia mountains", sample: "public/styles/ink-wuxia.webp" },
  { id: "paper-stopmotion", technique: "Stop-motion paper cutout", topic: "Storybook town", sample: "public/styles/paper-stopmotion.webp" },
  { id: "noir-alley", technique: "Hard-boiled chiaroscuro", topic: "Neon noir alley", sample: "public/styles/noir-alley.webp" },
  { id: "gouache-seaside", technique: "Gouache + soft pastel palette", topic: "Seaside summer", sample: "public/styles/gouache-seaside.webp" },
  { id: "halftone-space", technique: "Halftone print + chrome highlights", topic: "Retro-future space opera", sample: "public/styles/halftone-space.webp" },
];

/**
 * 事件池（§2.3b 的三个示例）+ 每个事件的选项与花费/收益。
 * ★ 「模型军备」在数据里有 4 条：L2 升级、L3 升级（15 金 + 3 连胜）各一条，再加上原来的
 *   「5 金下一回合半价」「免费 +4 金」。任何时刻**只有一条升级线出现**（见 optionsForPlayer /
 *   modelUpgradeOffer），所以玩家看到的仍是三选一；升到顶或连胜不够时只剩后两条。
 * ★ L2 / L3 两条升级线的价格直接引用 MODEL_LEVEL_UP_COST，不在数据里再抄一份 8 / 15。
 */
export const GAME_EVENTS: readonly GameEvent[] = [
  {
    id: "model-arms-race", // 模型军备
    art: "public/events/model-arms-race.webp",
    options: [
      { id: "upgrade-draft", cost: MODEL_LEVEL_UP_COST[2], effects: [{ kind: "model-level", to: 2 }] },
      { id: "upgrade-cinema", cost: MODEL_LEVEL_UP_COST[3], effects: [{ kind: "model-level", to: 3 }] },
      { id: "half-next", cost: 5, effects: [{ kind: "next-round-cost-half" }] },
      { id: "free-gold", cost: 0, effects: [{ kind: "gold", delta: 4 }] },
    ],
  },
  {
    id: "inspiration-burst", // 灵感爆发
    art: "public/events/inspiration-burst.webp",
    options: [
      { id: "double-shoot", cost: 6, effects: [{ kind: "next-round-segments", value: 2 }] },
      { id: "long-prompt", cost: 3, effects: [{ kind: "prompt-limit-pct", pct: 50 }] },
      { id: "free-blue-card", cost: 0, effects: [{ kind: "random-card", quality: 3 }] },
    ],
  },
  {
    id: "supply-drop", // 补给站
    art: "public/events/supply-drop.webp",
    options: [
      { id: "bag-expand", cost: 5, effects: [{ kind: "bag-cap", cardType: "role", delta: 1 }] },
      { id: "heal", cost: 3, effects: [{ kind: "hp", delta: 15 }] },
      { id: "free-refresh", cost: 0, effects: [{ kind: "free-refresh", count: 2 }] },
    ],
  },
];

// ────────────────────────────── 结果形状（失败一定带 reason，调用不许看图猜） ──────────────────────────────

export type RuleRejectReason =
  | "bag-full"
  | "type-cap"
  | "card-not-in-bag"
  | "item-equipped"
  | "role-equipped"
  | "not-an-item"
  | "not-a-role"
  | "role-already-equipped"
  | "no-equipped-item"
  | "not-enough-gold"
  | "slot-empty"
  | "bad-slot"
  | "wrong-phase"
  | "unknown-player"
  | "player-eliminated"
  | "style-locked"
  | "style-not-offered"
  | "ranking-mismatch"
  | "option-unavailable"
  | "event-not-drawn"
  | "event-already-picked"
  | "round-limit"
  | "no-cards-left";

export interface RuleFailure {
  ok: false;
  reason: RuleRejectReason;
  /** 补充数字：哪个卡种 / 要多少 / 有多少 / 上限多少（界面拿去说人话，不许只回一个 false）。 */
  cardType?: CardType;
  need?: number;
  have?: number;
  cap?: number;
  count?: number;
}

export type PlayerResult = { ok: true; player: GamePlayer } | RuleFailure;
export type StateResult = { ok: true; state: GameState } | RuleFailure;
export type SellResult = { ok: true; player: GamePlayer; refund: number } | RuleFailure;
export type EventOptionsResult = { ok: true; options: GameEventOption[] } | RuleFailure;
export type EventApplyResult = { ok: true; state: GameState; option: GameEventOption } | RuleFailure;
export type SettleResult = { ok: true; state: GameState; summary: RoundSettlement } | RuleFailure;

function reject(reason: RuleRejectReason, extra: Omit<RuleFailure, "ok" | "reason"> = {}): RuleFailure {
  return { ok: false, reason, ...extra };
}

// ────────────────────────────── 随机源 ──────────────────────────────

/**
 * mulberry32：32 位种子、实现 10 行、序列够复盘一局（约 2^32 周期）。
 * ★ 不引第三方：这个文件要能被 Node 直接 import（零运行时依赖），随机数是最容易顺手多引一个包的地方。
 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把注入的 rng 夹进 [0, 1)：坏 rng 不许让抽卡静默拿到 undefined（铁律八）。 */
function unit(rng: Rng): number {
  const v = rng();
  if (!Number.isFinite(v)) return 0;
  return Math.min(0.999999999, Math.max(0, v));
}

function pickOne<T>(items: readonly T[], rng: Rng): T {
  if (items.length === 0) throw new Error("pickOne: empty list");
  return items[Math.floor(unit(rng) * items.length)];
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(unit(rng) * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ────────────────────────────── 开局与风格卡（§2.2） ──────────────────────────────

const START_MODEL_LEVEL: ModelLevel = 1;

function defaultBuffs(): GameBuffs {
  return { nextRoundCostHalf: false, nextRoundSegments: 1, promptLimitPct: 0, freeRefreshes: 0 };
}

/** §2.2：从池子里随机 3 张（同一个人不重复；不同人可以抽到同一张，风格不是稀缺资源）。 */
export function rollStyleChoices(rng: Rng): StyleCard[] {
  return shuffled(STYLE_POOL, rng).slice(0, STYLE_PICK_COUNT);
}

export function styleCardById(id: string): StyleCard | null {
  return STYLE_POOL.find((card) => card.id === id) ?? null;
}

/** 玩家已锁定的风格卡；没选 / id 不在池里回 null（调用方要能区分「没选」与「数据坏了」时看 styleCardId）。 */
export function styleCardOf(player: GamePlayer): StyleCard | null {
  return player.styleCardId === null ? null : styleCardById(player.styleCardId);
}

/**
 * 开一局：4 人（§5-1）100 血、初始金币、全员 L1（§2.3 ★ 所有人开局最低档），
 * 每人抽 3 张风格卡（§2.2），phase = "style"。
 * ★ 人数 / id 这些是**程序员的错**（不是玩家操作被拒），直接抛：静默开一局 0 人比崩掉更难查。
 */
export function createGame(playerIds: readonly string[], rng: Rng): GameState {
  if (playerIds.length < MIN_PLAYERS) throw new Error(`createGame: need at least ${MIN_PLAYERS} players`);
  if (playerIds.length > MAX_PLAYERS) throw new Error(`createGame: at most ${MAX_PLAYERS} players`);
  if (new Set(playerIds).size !== playerIds.length) throw new Error("createGame: duplicate player ids");
  if (playerIds.some((id) => id.trim().length === 0)) throw new Error("createGame: empty player id");

  const players: GamePlayer[] = playerIds.map((id) => ({
    id,
    hp: START_HP,
    gold: START_GOLD,
    winStreak: 0,
    loseStreak: 0,
    bag: [],
    equipment: [],
    capBonus: {},
    styleCardId: null,
    styleChoices: rollStyleChoices(rng).map((card) => card.id),
    modelLevel: START_MODEL_LEVEL,
    eliminated: false,
    buffs: defaultBuffs(),
  }));

  return {
    round: 1,
    phase: "style",
    players,
    modelLevel: START_MODEL_LEVEL,
    shops: {},
    drawnEventIds: [],
    currentEventId: null,
    eventPicks: {},
    cardSerial: 0,
  };
}

/**
 * §2.2 选风格卡：只能从自己抽到的那 3 张里选，选定后锁死（style-locked）。
 * 全员选完 → phase "ready"（等 beginRound 开第一回合商店）。
 */
export function pickStyleCard(state: GameState, playerId: string, styleCardId: string): StateResult {
  if (state.phase !== "style") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (found.player.styleCardId !== null) return reject("style-locked");
  if (!found.player.styleChoices.includes(styleCardId)) return reject("style-not-offered");
  const players = state.players.map((p) => (p.id === playerId ? { ...p, styleCardId } : p));
  const allPicked = players.every((p) => p.eliminated || p.styleCardId !== null);
  return { ok: true, state: { ...state, players, phase: allPicked ? "ready" : "style" } };
}

// ────────────────────────────── 背包与装备（§2.1） ──────────────────────────────

function findPlayer(state: GameState, playerId: string): { player: GamePlayer; index: number } | null {
  const index = state.players.findIndex((p) => p.id === playerId);
  return index < 0 ? null : { player: state.players[index], index };
}

function replacePlayerInState(state: GameState, player: GamePlayer): GameState {
  return { ...state, players: state.players.map((p) => (p.id === player.id ? player : p)) };
}

/** 拥有的全部卡 = 背包里的 + 已装备的道具。★ 类型上限与 9 格都按这一份数，不是只看背包。 */
export function ownedCards(player: GamePlayer): GameCard[] {
  return [...player.bag, ...player.equipment.map((e) => e.item)];
}

export function typeCountsOf(player: GamePlayer): Record<CardType, number> {
  const counts: Record<CardType, number> = { role: 0, scene: 0, item: 0 };
  for (const card of ownedCards(player)) counts[card.type] += 1;
  return counts;
}

/** 某一类的有效上限 = 基础表 + 事件加成（补给站角色 4→5）。 */
export function capOf(player: GamePlayer, cardType: CardType): number {
  return TYPE_CAPS[cardType] + (player.capBonus[cardType] ?? 0);
}

/**
 * 背包占用。★ total 是「背包 + 已装备道具」的总数：装备只是把道具从背包挪到角色身上，
 * 若不计入总数，4 角色 + 1 场景 + 4 道具 = 9 这条算术就会被「先装上再买」绕开。
 */
export function bagUsage(player: GamePlayer): {
  total: number;
  cap: number;
  free: number;
  byType: Record<CardType, number>;
  caps: Record<CardType, number>;
} {
  const byType = typeCountsOf(player);
  const caps: Record<CardType, number> = {
    role: capOf(player, "role"),
    scene: capOf(player, "scene"),
    item: capOf(player, "item"),
  };
  const total = byType.role + byType.scene + byType.item;
  return { total, cap: BAG_SIZE, free: Math.max(0, BAG_SIZE - total), byType, caps };
}

/** 装不下时先看总数、再看类型（两个都满时报 bag-full —— 它比 type-cap 更根本）。 */
export function canAddCard(player: GamePlayer, card: GameCard): RuleFailure | null {
  const usage = bagUsage(player);
  if (usage.total >= BAG_SIZE) return reject("bag-full", { count: usage.total, cap: BAG_SIZE });
  const cap = usage.caps[card.type];
  const count = usage.byType[card.type];
  if (count >= cap) return reject("type-cap", { cardType: card.type, count, cap });
  return null;
}

/** §2.1 收一张卡进背包。装不下就回原因，**不替换、不丢卡**（替换走 replaceCardInBag）。 */
export function addCardToBag(player: GamePlayer, card: GameCard): PlayerResult {
  const failure = canAddCard(player, card);
  if (failure) return failure;
  return { ok: true, player: { ...player, bag: [...player.bag, card] } };
}

/**
 * 装不上时唯一的出路：以旧换新（§2.1「装不上时只能替换」）。
 * ★ 这是**原子**操作：旧卡不在了、新卡一定在；任何一步失败都回原因、玩家原样不动。
 * ★ 带装备的角色不能直接被替换：道具退回背包可能把 9 格撑破，硬换就会静默丢一张卡；
 *   先 unequipItemFromRole 再替换（回 role-equipped，界面据此提示先卸下）。
 * ★ 不给 1 金回收：给钱就把「卖卡」与「替换」变成两条会双记的路；想要钱先 sellCardFromBag。
 */
export function replaceCardInBag(player: GamePlayer, outCardId: string, incoming: GameCard): PlayerResult {
  const index = player.bag.findIndex((card) => card.id === outCardId);
  if (index < 0) {
    if (player.equipment.some((e) => e.item.id === outCardId)) return reject("item-equipped");
    return reject("card-not-in-bag");
  }
  const outgoing = player.bag[index];
  if (outgoing.type === "role" && player.equipment.some((e) => e.roleCardId === outgoing.id)) {
    return reject("role-equipped");
  }
  const interim: GamePlayer = { ...player, bag: player.bag.filter((_, i) => i !== index) };
  return addCardToBag(interim, incoming);
}

/**
 * §2.1 卖卡：回收 1 金；已装备的道具**退回背包**（卖的是角色时）。
 * ★ 已装备的道具不能直接卖：它不在背包里，卖它就会让角色身上留一个指向空气的装备（回 item-equipped）。
 * ★ 健康状态里退回道具一定装得下（装备的道具本来就算在 9 格内），这里的 bag-full 只是防坏状态把卡吞掉。
 */
export function sellCardFromBag(player: GamePlayer, cardId: string): SellResult {
  const index = player.bag.findIndex((card) => card.id === cardId);
  if (index < 0) {
    if (player.equipment.some((e) => e.item.id === cardId)) return reject("item-equipped");
    return reject("card-not-in-bag");
  }
  const card = player.bag[index];
  const returned = player.equipment.filter((e) => e.roleCardId === card.id).map((e) => e.item);
  const bag = player.bag.filter((_, i) => i !== index);
  if (bag.length + returned.length > BAG_SIZE) {
    return reject("bag-full", { count: bag.length + returned.length, cap: BAG_SIZE });
  }
  return {
    ok: true,
    player: {
      ...player,
      bag: [...bag, ...returned],
      equipment: player.equipment.filter((e) => e.roleCardId !== card.id),
      gold: player.gold + CARD_SELL_GOLD,
    },
    refund: CARD_SELL_GOLD,
  };
}

/**
 * §2.1 装备：道具只能挂到角色卡上。
 * ★ 一个角色最多挂 1 件（设计稿没写死数量）：出片时「角色带道具」是一张参考图位，
 *   挂两件要么在提示词里挤成一团、要么得再开一个图位，G2 先按 1 件跑通。
 */
export function equipItemOnRole(player: GamePlayer, roleCardId: string, itemCardId: string): PlayerResult {
  const role = player.bag.find((card) => card.id === roleCardId);
  if (!role) return reject("card-not-in-bag");
  if (role.type !== "role") return reject("not-a-role");
  if (player.equipment.some((e) => e.roleCardId === roleCardId)) return reject("role-already-equipped");
  const item = player.bag.find((card) => card.id === itemCardId);
  if (!item) {
    if (player.equipment.some((e) => e.item.id === itemCardId)) return reject("item-equipped");
    return reject("card-not-in-bag");
  }
  if (item.type !== "item") return reject("not-an-item");
  return {
    ok: true,
    player: {
      ...player,
      bag: player.bag.filter((card) => card.id !== itemCardId),
      equipment: [...player.equipment, { roleCardId, item }],
    },
  };
}

/** 卸下：道具退回背包（§2.1「已装备道具退回背包」的另一半）。 */
export function unequipItemFromRole(player: GamePlayer, roleCardId: string): PlayerResult {
  const index = player.equipment.findIndex((e) => e.roleCardId === roleCardId);
  if (index < 0) return reject("no-equipped-item");
  if (player.bag.length >= BAG_SIZE) return reject("bag-full", { count: player.bag.length, cap: BAG_SIZE });
  const entry = player.equipment[index];
  return {
    ok: true,
    player: {
      ...player,
      bag: [...player.bag, entry.item],
      equipment: player.equipment.filter((_, i) => i !== index),
    },
  };
}

export function equippedItemOf(player: GamePlayer, roleCardId: string): GameCard | null {
  return player.equipment.find((e) => e.roleCardId === roleCardId)?.item ?? null;
}

// ────────────────────────────── 经济（§2.3） ──────────────────────────────

/** §2.1：买价就是品质（白/绿/蓝/紫/金 = 1~5 金）。 */
export function cardPrice(card: GameCard): number {
  return card.quality;
}

/** §2.1：卖价固定 1 金（不分品质）。 */
export function cardSellValue(_card: GameCard): number {
  return CARD_SELL_GOLD;
}

/** §2.3：利息 = min(5, floor(gold/10))。★ 按**本回合开始时的金币**算（回合收入发下去之前）。 */
export function interestFor(gold: number): number {
  if (!Number.isFinite(gold) || gold <= 0) return 0;
  return Math.min(INTEREST_CAP, Math.floor(gold / INTEREST_PER));
}

/** 连 N 的奖励；超过表尾按表尾（5 连及以上都是 +3）。 */
export function streakBonusFor(streak: number): number {
  if (!Number.isFinite(streak) || streak <= 0) return 0;
  const index = Math.min(STREAK_BONUS_BY_LENGTH.length - 1, Math.floor(streak));
  return STREAK_BONUS_BY_LENGTH[index];
}

/**
 * §2.3：每回合收入 = 基础 5 + 利息 + 连胜/连败奖励。
 * ★ 取 winStreak / loseStreak 里高的那档（两个计数由 settleRound 一处维护成互斥，取 max 只是防御）。
 */
export function incomeFor(player: GamePlayer): { base: number; interest: number; streak: number; total: number } {
  const interest = interestFor(player.gold);
  const streak = Math.max(streakBonusFor(player.winStreak), streakBonusFor(player.loseStreak));
  return { base: INCOME_BASE, interest, streak, total: INCOME_BASE + interest + streak };
}

/** 事件 / G4 读增益的三个口子：界面与生成层不许自己去翻 buffs（免得两处解释同一格）。 */
export function segmentsAllowed(player: GamePlayer): number {
  return Math.max(1, player.buffs.nextRoundSegments);
}

export function filmCostMultiplier(player: GamePlayer): number {
  return player.buffs.nextRoundCostHalf ? 0.5 : 1;
}

export function promptLimitBonusPct(player: GamePlayer): number {
  return player.buffs.promptLimitPct;
}

// ────────────────────────────── 商店（§2.3） ──────────────────────────────

/** 回合 → 品质权重；回合超出 1~8 时夹到两端（G3 若把回合数改长，也不会读到 undefined）。 */
export function qualityWeightsForRound(round: number): readonly [number, number, number, number, number] {
  const r = Number.isFinite(round) ? Math.floor(round) : 1;
  const index = Math.min(SHOP_QUALITY_WEIGHTS.length, Math.max(1, r)) - 1;
  return SHOP_QUALITY_WEIGHTS[index];
}

export function emptyShop(): ShopState {
  return { cards: Array.from({ length: SHOP_SIZE }, () => null), locked: false };
}

/**
 * 按回合权重抽一张：先掷品质（每行合计 100），再从该品质的目录卡里均匀抽一张。
 * 返回的卡带新的实例 id（`<目录 id>#<流水号>`），同一张目录卡买两次也不会撞 id。
 */
function drawCard(round: number, rng: Rng, serial: number): { card: GameCard; serial: number } {
  const weights = qualityWeightsForRound(round);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total !== 100) throw new Error(`shop quality weights for round ${round} must sum to 100, got ${total}`);
  const roll = unit(rng) * 100;
  let acc = 0;
  let quality: CardQuality | null = null;
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i];
    if (roll < acc) {
      quality = (i + 1) as CardQuality;
      break;
    }
  }
  // 权重表坏了 / rng 越界都会落到这里：响一声，别静默当成 1 费卡。
  if (quality === null) throw new Error("shop quality roll fell outside the weight table");
  const pool = CARD_LIBRARY.filter((card) => card.quality === quality);
  if (pool.length === 0) throw new Error(`card library has no quality-${quality} card`);
  const def = pickOne(pool, rng);
  const nextSerial = serial + 1;
  return { card: { ...def, id: `${def.id}#${nextSerial}` }, serial: nextSerial };
}

function rollShopCards(round: number, rng: Rng, serial: number): { cards: (GameCard | null)[]; serial: number } {
  const cards: (GameCard | null)[] = [];
  let nextSerial = serial;
  for (let i = 0; i < SHOP_SIZE; i += 1) {
    const drawn = drawCard(round, rng, nextSerial);
    cards.push(drawn.card);
    nextSerial = drawn.serial;
  }
  return { cards, serial: nextSerial };
}

/**
 * 开一回合：ready（第一回合，不发收入）或 round-end（下一回合，先发上回合收入）。
 * §2.3：每回合开始自动刷新 5 张；锁定的商店不自动刷（锁定免费），解锁后才刷。
 * ★ 收入按**发钱前**的金币算利息：先算后加，别写反（写反等于按新金币给利息，多 1~2 金）。
 */
export function beginRound(state: GameState, rng: Rng): StateResult {
  if (state.phase !== "ready" && state.phase !== "round-end") return reject("wrong-phase");
  if (state.phase === "round-end" && state.round >= MAX_ROUNDS) {
    return reject("round-limit", { count: state.round, cap: MAX_ROUNDS });
  }

  let round = state.round;
  let players = state.players;
  if (state.phase === "round-end") {
    round += 1;
    players = players.map((p) => (p.eliminated ? p : { ...p, gold: p.gold + incomeFor(p).total }));
  }

  let serial = state.cardSerial;
  const shops: Record<string, ShopState> = {};
  for (const player of players) {
    if (player.eliminated) {
      shops[player.id] = state.shops[player.id] ?? emptyShop();
      continue;
    }
    const previous = state.shops[player.id];
    if (previous?.locked) {
      shops[player.id] = previous;
      continue;
    }
    const rolled = rollShopCards(round, rng, serial);
    serial = rolled.serial;
    shops[player.id] = { cards: rolled.cards, locked: false };
  }

  return {
    ok: true,
    state: {
      ...state,
      round,
      players,
      shops,
      phase: "shop",
      currentEventId: null,
      eventPicks: {},
      cardSerial: serial,
    },
  };
}

/** §2.3 手动刷新：2 金；有免费刷新券先用券（补给站免费项 ×2）。锁定不影响手动刷新。 */
export function refreshShop(state: GameState, playerId: string, rng: Rng): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");

  const free = found.player.buffs.freeRefreshes > 0;
  const cost = free ? 0 : SHOP_REFRESH_COST;
  if (!free && found.player.gold < cost) return reject("not-enough-gold", { need: cost, have: found.player.gold });

  const rolled = rollShopCards(state.round, rng, state.cardSerial);
  const shop = state.shops[playerId] ?? emptyShop();
  const player: GamePlayer = {
    ...found.player,
    gold: found.player.gold - cost,
    buffs: {
      ...found.player.buffs,
      freeRefreshes: free ? found.player.buffs.freeRefreshes - 1 : found.player.buffs.freeRefreshes,
    },
  };
  return {
    ok: true,
    state: replacePlayerInState(
      { ...state, shops: { ...state.shops, [playerId]: { cards: rolled.cards, locked: shop.locked } }, cardSerial: rolled.serial },
      player,
    ),
  };
}

/** §2.3 锁定：免费。锁着的时候 beginRound 不自动刷新（手动刷新照样可以）。 */
export function toggleShopLock(state: GameState, playerId: string): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const shop = state.shops[playerId] ?? emptyShop();
  return { ok: true, state: { ...state, shops: { ...state.shops, [playerId]: { ...shop, locked: !shop.locked } } } };
}

/**
 * §2.3 买商店里的一张：价钱 = 品质。
 * ★ 原子：钱不够 / 装不下 / 替换失败都**不扣钱、不动商店**（否则就是「付了钱没拿到卡」）。
 * ★ 背包满时传 replaceCardId 走 replaceCardInBag（§2.1 装不上只能替换）。
 */
export function buyShopCard(state: GameState, playerId: string, slotIndex: number, replaceCardId: string | null = null): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= SHOP_SIZE) {
    return reject("bad-slot", { count: slotIndex, cap: SHOP_SIZE });
  }
  const shop = state.shops[playerId] ?? emptyShop();
  const card = shop.cards[slotIndex];
  if (!card) return reject("slot-empty");

  const price = cardPrice(card);
  if (found.player.gold < price) return reject("not-enough-gold", { need: price, have: found.player.gold });

  const bagResult = replaceCardId === null
    ? addCardToBag(found.player, card)
    : replaceCardInBag(found.player, replaceCardId, card);
  if (!bagResult.ok) return bagResult;

  const player: GamePlayer = { ...bagResult.player, gold: bagResult.player.gold - price };
  const cards = shop.cards.map((c, i) => (i === slotIndex ? null : c));
  return {
    ok: true,
    state: replacePlayerInState({ ...state, shops: { ...state.shops, [playerId]: { ...shop, cards } } }, player),
  };
}

/**
 * 卖卡 / 装备 / 卸下 / 换卡只在**商店阶段**允许（§2.0 ①）。
 * ★ 创作阶段开始后背包要锁住：正在出片的那一段引用了角色 / 场景 / 道具，这时候卖掉或换掉
 *   会让一段已经付费的画面指向一张不存在的卡（零报错、成片里少一个人）。
 */
export function sellCard(state: GameState, playerId: string, cardId: string): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const sold = sellCardFromBag(found.player, cardId);
  if (!sold.ok) return sold;
  return { ok: true, state: replacePlayerInState(state, sold.player) };
}

export function equipItem(state: GameState, playerId: string, roleCardId: string, itemCardId: string): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const equipped = equipItemOnRole(found.player, roleCardId, itemCardId);
  if (!equipped.ok) return equipped;
  return { ok: true, state: replacePlayerInState(state, equipped.player) };
}

export function unequipItem(state: GameState, playerId: string, roleCardId: string): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const unequipped = unequipItemFromRole(found.player, roleCardId);
  if (!unequipped.ok) return unequipped;
  return { ok: true, state: replacePlayerInState(state, unequipped.player) };
}

// ────────────────────────────── 模型等级（§2.3 / §2.3b） ──────────────────────────────

/** §2.3b：等级只影响「游戏内生成档位」的返回值（草稿 480p / 高清 720p / 电影级 1080p）。 */
export function generationTierOf(player: GamePlayer): GameGenerationTier {
  return MODEL_LEVEL_TIERS[player.modelLevel];
}

/**
 * 现在这条升级线开不开、多少钱。**L3 的 3 连胜门槛只有这一处判断**：
 *   L1 → L2（8 金）随时；L2 → L3（15 金）要 winStreak ≥ 3；L3 封顶（§5-8 默认不放开）。
 * ★ 事件选项「出不出现在屏幕上」由 optionsForPlayer 调这里决定（不满足就整条不摆，见 §2.3b）。
 */
export function modelUpgradeOffer(player: GamePlayer): { level: 2 | 3; cost: number } | null {
  if (player.modelLevel === 1) return { level: 2, cost: MODEL_LEVEL_UP_COST[2] };
  if (player.modelLevel === 2 && player.winStreak >= 3) return { level: 3, cost: MODEL_LEVEL_UP_COST[3] };
  return null;
}

// ────────────────────────────── 事件（§2.3b） ──────────────────────────────

export function gameEventById(id: string): GameEvent | null {
  return GAME_EVENTS.find((event) => event.id === id) ?? null;
}

/**
 * 一条选项现在出不出（§2.3b）：
 * ★ 只有「模型升级」类选项会按玩家状态出现 / 消失 —— 升级目标必须正好是 modelUpgradeOffer 给的那一档。
 *   L1 的玩家看不到 15 金的 L3 选项（要先升 L2），L2 没到 3 连胜也看不到，L3 顶了两条都不再出现。
 * ★ 钱够不够**不在**这里判：选项要摆出来（界面可以灰着说差多少），真正扣钱在 applyEventChoice。
 */
export function optionAvailable(player: GamePlayer, option: GameEventOption): boolean {
  for (const effect of option.effects) {
    if (effect.kind === "model-level") {
      const offer = modelUpgradeOffer(player);
      if (!offer || offer.level !== effect.to) return false;
    }
  }
  return true;
}

/** 这个玩家在这个事件里能看到的选项（顺序按事件数据；模型军备最多 3 条）。 */
export function optionsForPlayer(player: GamePlayer, event: GameEvent): GameEventOption[] {
  return event.options.filter((option) => optionAvailable(player, option));
}

/** 本期事件 + 该玩家可选的选项；没抽事件 / 阶段不对都回原因（界面据此说「本期没有事件」）。 */
export function eventOptionsFor(state: GameState, playerId: string): EventOptionsResult {
  if (state.phase !== "event") return reject("wrong-phase");
  if (state.currentEventId === null) return reject("event-not-drawn");
  const event = gameEventById(state.currentEventId);
  if (!event) return reject("event-not-drawn");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (state.eventPicks[playerId] !== undefined) return reject("event-already-picked");
  return { ok: true, options: optionsForPlayer(found.player, event) };
}

/**
 * 选一个事件选项：扣钱 → 结算收益 → 记下谁选过。
 * ★ 全体存活玩家各选一次（同一事件、各自选自己的），全员选完 phase 才进 round-end。
 * ★ 原子：钱不够 / 选项不可用 / 随机卡把背包撑破，都整项失败、state 原样（不许「先扣钱再发现装不下」）。
 */
export function applyEventChoice(state: GameState, playerId: string, optionId: string, rng: Rng): EventApplyResult {
  if (state.phase !== "event") return reject("wrong-phase");
  if (state.currentEventId === null) return reject("event-not-drawn");
  const event = gameEventById(state.currentEventId);
  if (!event) return reject("event-not-drawn");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (state.eventPicks[playerId] !== undefined) return reject("event-already-picked");

  const option = event.options.find((o) => o.id === optionId);
  if (!option || !optionAvailable(found.player, option)) return reject("option-unavailable");
  if (found.player.gold < option.cost) {
    return reject("not-enough-gold", { need: option.cost, have: found.player.gold });
  }

  const paid: GamePlayer = { ...found.player, gold: found.player.gold - option.cost };
  const applied = applyEventEffects(paid, option, rng, state.cardSerial);
  if (!applied.ok) return applied;

  const eventPicks = { ...state.eventPicks, [playerId]: option.id };
  const alive = state.players.filter((p) => !p.eliminated);
  const allPicked = alive.every((p) => eventPicks[p.id] !== undefined);
  const nextState: GameState = {
    ...replacePlayerInState(state, applied.player),
    eventPicks,
    cardSerial: applied.serial,
    phase: allPicked ? "round-end" : "event",
  };
  return { ok: true, state: nextState, option };
}

function applyEventEffects(
  player: GamePlayer,
  option: GameEventOption,
  rng: Rng,
  serial: number,
): { ok: true; player: GamePlayer; serial: number } | RuleFailure {
  let next: GamePlayer = { ...player, buffs: { ...player.buffs }, capBonus: { ...player.capBonus } };
  let nextSerial = serial;

  for (const effect of option.effects) {
    switch (effect.kind) {
      case "gold":
        next.gold = Math.max(0, next.gold + effect.delta);
        break;
      case "hp":
        // 事件里只有回血（§2.3b）；真要加扣血效果，必须同时走淘汰判定，别绕过 settleRound。
        next.hp = Math.min(START_HP, Math.max(0, next.hp + effect.delta));
        break;
      case "model-level":
        next.modelLevel = effect.to;
        break;
      case "next-round-cost-half":
        next.buffs.nextRoundCostHalf = true;
        break;
      case "next-round-segments":
        next.buffs.nextRoundSegments = Math.max(1, effect.value);
        break;
      case "prompt-limit-pct":
        next.buffs.promptLimitPct = effect.pct;
        break;
      case "bag-cap": {
        const capBonus = { ...next.capBonus };
        capBonus[effect.cardType] = Math.max(0, (capBonus[effect.cardType] ?? 0) + effect.delta);
        next.capBonus = capBonus;
        break;
      }
      case "free-refresh":
        next.buffs.freeRefreshes += effect.count;
        break;
      case "random-card": {
        const pool = CARD_LIBRARY.filter((card) => card.quality === effect.quality);
        if (pool.length === 0) return reject("no-cards-left", { count: 0 });
        const def = pickOne(pool, rng);
        nextSerial += 1;
        const card: GameCard = { ...def, id: `${def.id}#${nextSerial}` };
        const added = addCardToBag(next, card);
        if (!added.ok) return added;
        next = added.player;
        break;
      }
      default: {
        // 事件效果是数据：多出没认过的 kind 时宁可响，也不静默跳过一项收益。
        const unknown: never = effect;
        throw new Error(`unknown event effect: ${JSON.stringify(unknown)}`);
      }
    }
  }
  return { ok: true, player: next, serial: nextSerial };
}

// ────────────────────────────── 回合结算与胜负（§2.5） ──────────────────────────────

/**
 * §2.5 扣血：rankFromLast = 0 是最后一名。
 * 缩放 = 存活人数 / 4，向下取到 DAMAGE_GRID 的整数倍、最低 5（见 DAMAGE_LADDER 的注释）。
 */
export function damageForRank(playerCount: number, rankFromLast: number): number {
  const count = Math.max(0, Math.floor(playerCount));
  const rank = Math.max(0, Math.floor(rankFromLast));
  const base = rank < DAMAGE_LADDER.length ? DAMAGE_LADDER[rank] : DAMAGE_OTHERS;
  const scaled = (base * count) / 4;
  return Math.max(DAMAGE_GRID, Math.floor(scaled / DAMAGE_GRID) * DAMAGE_GRID);
}

/**
 * 连胜 / 连败按名次的前一半算（§2.3 只说要连胜/连败，没说四人局怎么算）。
 * ★ 照 TFT「前 4/8 算胜」压到 4 人：名次前 2 算胜、后 2 算负；3 人局前 2 算胜。
 *   4 人局第 2 名既赢一轮又扣 15 血 —— 这是有意的：「赢」是连胜口径，跟扣血是两回事。
 */
export function streakOutcomeOf(playerCount: number, rank: number): StreakOutcome {
  const count = Math.max(0, Math.floor(playerCount));
  if (count === 0) return "none";
  return rank < Math.ceil(count / 2) ? "win" : "lose";
}

export function alivePlayers(state: GameState): GamePlayer[] {
  return state.players.filter((p) => !p.eliminated);
}

/**
 * §2.5 胜者：剩下 ≤2 人时给出（血多的排前面；同血看金币，再同按 id 定序 —— 回放要稳定）。
 * ★ 打满 MAX_ROUNDS（§5-2 的 8 回合）还没打完时，取存活者里血最多的两名（设计稿只说「两名胜者」，
 *   没说打满怎么挑；这是规则层拍的，报告里单列）。0 人存活 = 平局，回空数组。
 */
export function winnersOf(state: GameState): string[] {
  const alive = [...alivePlayers(state)].sort((a, b) => b.hp - a.hp || b.gold - a.gold || (a.id < b.id ? -1 : 1));
  if (alive.length === 0) return [];
  if (alive.length <= 2) return alive.map((p) => p.id);
  if (state.round >= MAX_ROUNDS) return alive.slice(0, 2).map((p) => p.id);
  return [];
}

export function isGameOver(state: GameState): boolean {
  const alive = alivePlayers(state);
  if (alive.length === 0) return true; // 同归于尽：本局平局（winnersOf 回空）
  if (alive.length <= 2) return true;
  return state.round >= MAX_ROUNDS;
}

/**
 * §2.5 回合结算：传本期名次（从好到差）→ 扣血、淘汰、更新连胜/连败 →
 * 剩下 ≤2 人 / 打满 8 回合就 over；否则第 2/4/6 回合抽一个不重样的事件进 event，其余进 round-end。
 * ★ ranking 必须**恰好**是当前存活玩家、不重不漏：少一个人会让某个人的名次错位、扣错血（零报错），
 *   所以整份排名称拒并回 ranking-mismatch。
 * ★ 时效增益在**结算这一回合时清掉**（它们是在上一个事件里发的、本来只保这一个回合）；
 *   事件是结算之后才发，所以本期事件给的新增益不会被这里误清（顺序写反就白送一回合）。
 */
export function settleRound(state: GameState, ranking: readonly string[], rng: Rng): SettleResult {
  if (state.phase !== "voting") return reject("wrong-phase");
  const alive = alivePlayers(state);
  const aliveIds = alive.map((p) => p.id);
  const rankingIds = [...ranking];
  if (
    rankingIds.length !== aliveIds.length ||
    new Set(rankingIds).size !== rankingIds.length ||
    rankingIds.some((id) => !aliveIds.includes(id))
  ) {
    return reject("ranking-mismatch", { count: rankingIds.length, cap: aliveIds.length });
  }

  const playerCount = aliveIds.length;
  const damages: DamageEntry[] = [];
  const players = state.players.map((player) => {
    if (player.eliminated) return player;
    const rank = rankingIds.indexOf(player.id); // 0 = 第一名
    const rankFromLast = playerCount - 1 - rank;
    const damage = damageForRank(playerCount, rankFromLast);
    const hpAfter = Math.max(0, player.hp - damage);
    const eliminated = hpAfter === 0;
    const outcome = eliminated ? "none" : streakOutcomeOf(playerCount, rank);
    damages.push({
      playerId: player.id,
      rank: rank + 1,
      damage,
      hpBefore: player.hp,
      hpAfter,
      eliminated,
    });
    return {
      ...player,
      hp: hpAfter,
      eliminated,
      buffs: clearTimedBuffs(player.buffs),
      winStreak: outcome === "win" ? player.winStreak + 1 : 0,
      loseStreak: outcome === "lose" ? player.loseStreak + 1 : 0,
    };
  });
  damages.sort((a, b) => a.rank - b.rank);

  const eliminated = damages.filter((d) => d.eliminated).map((d) => d.playerId);
  const survivors = players.filter((p) => !p.eliminated);
  // 存活名单按**名次**排（不是 players 原顺序）：界面要按「本期名次」念，原顺序是座位表。
  const aliveAfter = rankingIds.filter((id) => survivors.some((p) => p.id === id));
  const streaks: StreakEntry[] = damages.map((entry) => {
    const player = players.find((p) => p.id === entry.playerId)!;
    const outcome: StreakOutcome = entry.eliminated ? "none" : streakOutcomeOf(playerCount, entry.rank - 1);
    return { playerId: entry.playerId, outcome, winStreak: player.winStreak, loseStreak: player.loseStreak };
  });

  const candidate: GameState = { ...state, players };
  const winners = winnersOf(candidate);
  const over = isGameOver(candidate);

  let phase: GamePhase = "round-end";
  let currentEventId: string | null = null;
  const drawnEventIds = [...state.drawnEventIds];
  if (!over && EVENT_AFTER_ROUNDS.includes(state.round)) {
    const pool = GAME_EVENTS.filter((event) => !drawnEventIds.includes(event.id));
    if (pool.length > 0) {
      const event = pickOne(pool, rng);
      drawnEventIds.push(event.id);
      currentEventId = event.id;
      phase = "event";
    }
  }
  if (over) phase = "over";

  const summary: RoundSettlement = {
    round: state.round,
    ranking: rankingIds,
    damages,
    eliminated,
    alive: aliveAfter,
    winners,
    streaks,
  };
  return {
    ok: true,
    state: { ...candidate, phase, drawnEventIds, currentEventId, eventPicks: {} },
    summary,
  };
}

/** 只清「只保一回合」的增益；免费刷新券不过期（买了就是你的）。 */
function clearTimedBuffs(buffs: GameBuffs): GameBuffs {
  return { nextRoundCostHalf: false, nextRoundSegments: 1, promptLimitPct: 0, freeRefreshes: buffs.freeRefreshes };
}

// ────────────────────────────── 阶段推进（§2.0 的 ①②③） ──────────────────────────────

export function enterCreation(state: GameState): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  return { ok: true, state: { ...state, phase: "create" } };
}

export function enterScreening(state: GameState): StateResult {
  if (state.phase !== "create") return reject("wrong-phase");
  return { ok: true, state: { ...state, phase: "screening" } };
}

export function enterVoting(state: GameState): StateResult {
  if (state.phase !== "screening") return reject("wrong-phase");
  return { ok: true, state: { ...state, phase: "voting" } };
}
