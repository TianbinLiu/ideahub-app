/**
 * 对局界面读的那一份视图模型（G2 第二块：把规则引擎接到工坊界面上）。
 *
 * ★ 这里**一条规则都不算**：利息、档位、背包占用、类型上限、连胜口径全部问 ./rules
 *   （铁律六：同一件事只有一处实现）。这个文件存在的理由是"三个面板要读同一份数" ——
 *   HUD、商店、背包各自在组件里 find player + incomeFor 一遍，就是三份会各自漂的派生逻辑。
 * ★ 纯函数、不碰 store / React：G3 的回合循环、G4 的出片翻译层也要读同一份视图时直接复用。
 * ★ 规则层只回事实、不回"L1 草稿"这类中文（见 rules.CARD_LIBRARY 的 ★），名字与档位说法在
 *   labels.ts，失败原因的人话在 reasons.ts —— 三个文件各管一段，别混。
 */
import {
  bagUsage,
  entryById,
  entryOfPlayer,
  eventOptionsFor,
  gameEventById,
  incomeFor,
  ownedCards,
  screeningOrderOf,
  styleCardById,
  styleCardOf,
  tableSlotsOf,
  votesPendingOf,
} from "./rules";
import type {
  GameCard,
  GameEvent,
  GameEventOption,
  GamePhase,
  GamePlayer,
  GameState,
  RoundEntry,
  RoundSettlement,
  RoundTally,
  ShopState,
  StyleCard,
  TableSlots,
} from "./types";

/** rules.bagUsage 的返回形状（total 含已装备道具，见那里头顶的 ★） */
export type BagUsage = ReturnType<typeof bagUsage>;

/** HUD 一条里要显示的全部数（每一项都能在 rules 里找到出处，见各字段注释） */
export interface HudModel {
  round: number;
  gold: number;
  hp: number;
  /** 下一次 beginRound 会发的钱。interest 按**现在的金币**算（rules.incomeFor 一处） */
  income: ReturnType<typeof incomeFor>;
  /** rules.bagUsage：9 格总数 + 每类上限（角色 4 / 场景 1 / 道具 4，事件可加成） */
  bag: BagUsage;
}

export interface GameView {
  player: GamePlayer;
  hud: HudModel;
  /** 现在在哪个阶段（HUD 的「第 N 回合 · 阶段名」读它；阶段名的中文在 labels.phaseName） */
  phase: GamePhase;
  /** 开局抽到的三张风格卡（已解析成 StyleCard）。一局只抽这一次，选定锁死 */
  styleChoices: StyleCard[];
  /** 已锁定的风格；null = 还没选 */
  style: StyleCard | null;
  /** 本回合商店（不在商店阶段 / 这个人的商店还没开出来时是 null） */
  shop: ShopState | null;
  /**
   * 背包：未装备的卡 + 已装备的道具。**9 格按"拥有的全部卡"算**，与 rules.bagUsage 同一口径
   * （装备只是把道具从背包挪到角色身上，不是第二份卡）。
   */
  bag: { cards: GameCard[]; equipped: { item: GameCard; roleId: string }[] };
  /** roleCardId → 挂在它身上的道具（角色卡角标） */
  equippedOnRole: Record<string, GameCard>;
  /** G4：3D 桌面 5 个卡位的占位状态（4 角色 + 1 场景；来自 rules.tableSlotsOf） */
  table: TableSlots;
}

/**
 * 把一份 GameState 折成界面要的视图。找不到这个玩家 → null（上层照 null 判，不猜）。
 * ★ 每个数一次问清：incomeFor / generationTierOf / bagUsage 都只在这里被调用，面板不再各算一遍。
 */
export function gameViewOf(state: GameState, playerId: string): GameView | null {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return null;

  const equippedOnRole: Record<string, GameCard> = {};
  for (const entry of player.equipment) equippedOnRole[entry.roleCardId] = entry.item;

  const styleChoices: StyleCard[] = [];
  for (const id of player.styleChoices) {
    const card = styleCardById(id);
    if (card) styleChoices.push(card);
  }

  return {
    player,
    hud: {
      round: state.round,
      gold: player.gold,
      hp: player.hp,
      income: incomeFor(player),
      bag: bagUsage(player),
    },
    phase: state.phase,
    styleChoices,
    style: styleCardOf(player),
    shop: state.shops[playerId] ?? null,
    bag: {
      cards: player.bag,
      equipped: player.equipment.map((entry) => ({ item: entry.item, roleId: entry.roleCardId })),
    },
    equippedOnRole,
    table: tableSlotsOf(player),
  };
}

// ────────────────────────────── 一期作品：展映 / 投票 / 结算（§2.4 / §2.5，G3） ──────────────────────────────

/** 展映 / 投票屏里的一条片子：作品本身 + 这一期读出来的点赞 / 投票状态。 */
export interface EntryView {
  entry: RoundEntry;
  /** 作者（界面用 labels.playerName 念名字） */
  playerId: string;
  likes: number;
  likedByMe: boolean;
  votes: number;
  /** 我这一票投给了它没有 */
  votedByMe: boolean;
  /** 是不是我自己的片子（投票屏不列自己那条：§2.5「不能投自己」） */
  mine: boolean;
}

/**
 * 一期作品的界面读数（展映排片 / 投票候选 / 结算榜都用这一份）。
 * ★ 顺序问 rules.screeningOrderOf（上一期名次倒序），界面不自己排。
 */
export interface RoundView {
  /** 展映排片（§2.5 上一期综合名次倒序；第 1 回合按座位表） */
  playlist: EntryView[];
  /** 我这一期的片子（还没交是 null） */
  mine: EntryView | null;
  /** 我能点赞的那几条：展映阶段 = 全部（每条一次，点过的由 likedByMe 标出来） */
  canLike: boolean;
  /** 我能投的：投票阶段里除自己外的所有片子（§2.5「不能投自己」） */
  votable: EntryView[];
  /** 我这一期表过态没有（投过 / 弃权过算表过态） */
  spoken: boolean;
  /** 全员还差几个没表态（§2.5 全员看完才结算） */
  pending: number;
}

function entryViewOf(entry: RoundEntry, viewerId: string): EntryView {
  return {
    entry,
    playerId: entry.playerId,
    likes: entry.likedBy.length,
    likedByMe: entry.likedBy.includes(viewerId),
    votes: entry.votedBy.length,
    votedByMe: entry.votedBy.includes(viewerId),
    mine: entry.playerId === viewerId,
  };
}

export function roundViewOf(state: GameState, playerId: string): RoundView | null {
  if (!state.players.some((player) => player.id === playerId)) return null;
  const playlist = screeningOrderOf(state).map((entry) => entryViewOf(entry, playerId));
  const mineEntry = entryOfPlayer(state, playerId);
  const spoken =
    state.abstained.includes(playerId) ||
    state.entries.some((entry) => entry.round === state.round && entry.votedBy.includes(playerId));
  return {
    playlist,
    mine: mineEntry ? entryViewOf(mineEntry, playerId) : null,
    canLike: state.phase === "screening",
    votable: playlist.filter((view) => !view.mine),
    spoken,
    pending: votesPendingOf(state).length,
  };
}

/** 一条作品按 entryId 取出来（结算屏要把榜单上的 entryId 换回卡名 / 提示词）。 */
export function entryViewById(state: GameState, entryId: string, viewerId: string): EntryView | null {
  const entry = entryById(state, entryId);
  return entry ? entryViewOf(entry, viewerId) : null;
}

/** 结算屏的一行扣血（数字全部来自 rules.settleRound 的摘要，界面只负责念）。 */
export interface DamageView {
  playerId: string;
  rank: number;
  damage: number;
  hpAfter: number;
  eliminated: boolean;
}

export function damagesViewOf(summary: RoundSettlement): DamageView[] {
  return summary.damages.map((damage) => ({
    playerId: damage.playerId,
    rank: damage.rank,
    damage: damage.damage,
    hpAfter: damage.hpAfter,
    eliminated: damage.eliminated,
  }));
}

/** 结算屏的两个榜（entryId 顺序来自 rules.tallyRound，界面按 id 去查那一条作品）。 */
export function boardsOf(tally: RoundTally): { likeBoard: string[]; voteBoard: string[] } {
  return { likeBoard: tally.likeBoard, voteBoard: tally.voteBoard };
}

// ────────────────────────────── 对手与事件（HUD / 事件屏） ──────────────────────────────

/** 一个对手（AI 陪玩）的读数：对手条按它画。 */
export interface OpponentView {
  id: string;
  hp: number;
  gold: number;
  cards: number;
  eliminated: boolean;
}

export function opponentsOf(state: GameState, playerId: string): OpponentView[] {
  return state.players
    .filter((player) => player.id !== playerId)
    .map((player) => ({
      id: player.id,
      hp: player.hp,
      gold: player.gold,
      cards: ownedCards(player).length,
      eliminated: player.eliminated,
    }));
}

/** §2.3b 事件屏要的全部数：事件本身 + 这个玩家现在能看到的选项 + 他选过没有。 */
export interface EventView {
  event: GameEvent;
  options: GameEventOption[];
  gold: number;
  /** 我这一期已经选过的选项 id（"skip" = 跳过） */
  picked: string | null;
}

export function eventViewOf(state: GameState, playerId: string): EventView | null {
  if (state.currentEventId === null) return null;
  const event = gameEventById(state.currentEventId);
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!event || !player) return null;
  // eventOptionsFor 会在"已经选过"时拒 —— 这时选项就是空的，界面照样能把事件摆出来（只是不能再点）
  const options = eventOptionsFor(state, playerId);
  return {
    event,
    options: options.ok ? options.options : [],
    gold: player.gold,
    picked: state.eventPicks[playerId] ?? null,
  };
}
