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
import { alivePlayers, bagUsage, generationTierOf, incomeFor, styleCardById, styleCardOf } from "./rules";
import type {
  GameCard,
  GameGenerationTier,
  GamePlayer,
  GameState,
  ModelLevel,
  ShopState,
  StyleCard,
} from "./types";

/** rules.bagUsage 的返回形状（total 含已装备道具，见那里头顶的 ★） */
export type BagUsage = ReturnType<typeof bagUsage>;

/** HUD 一条里要显示的全部数（每一项都能在 rules 里找到出处，见各字段注释） */
export interface HudModel {
  round: number;
  gold: number;
  hp: number;
  winStreak: number;
  loseStreak: number;
  /** 下一次 beginRound 会发的钱。interest 按**现在的金币**算（rules.incomeFor 一处） */
  income: ReturnType<typeof incomeFor>;
  modelLevel: ModelLevel;
  /** rules.generationTierOf：等级 → 草稿 480p / 高清 720p / 电影级 1080p */
  tier: GameGenerationTier;
  /** rules.bagUsage：9 格总数 + 每类上限（角色 4 / 场景 1 / 道具 4，事件可加成） */
  bag: BagUsage;
  alive: number;
}

export interface GameView {
  player: GamePlayer;
  hud: HudModel;
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
      winStreak: player.winStreak,
      loseStreak: player.loseStreak,
      income: incomeFor(player),
      modelLevel: player.modelLevel,
      tier: generationTierOf(player),
      bag: bagUsage(player),
      alive: alivePlayers(state).length,
    },
    styleChoices,
    style: styleCardOf(player),
    shop: state.shops[playerId] ?? null,
    bag: {
      cards: player.bag,
      equipped: player.equipment.map((entry) => ({ item: entry.item, roleId: entry.roleCardId })),
    },
    equippedOnRole,
  };
}
