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
  EntryTally,
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
  RoundEntry,
  RoundSettlement,
  RoundTally,
  ShopState,
  StreakEntry,
  StreakOutcome,
  StyleCard,
  TableSlot,
  TableSlots,
} from "./types";

// ────────────────────────────── 常量（设计稿里写死的数都在这里，别在函数里现编） ──────────────────────────────

/**
 * §2.1 背包**不再有总量、不再按种类计数**（G4 施工单 §3，2026-11-23）。
 *
 * ★ 原来的 9 格 + 角色≤4 / 场景≤1 / 道具≤4 三档被整组撤掉：背包只是"手上的卡"，真正的上限在
 *   桌面卡位上（4 角色 + 1 场景），道具的上限挂在"每个角色最多 3 张"上。留着 9 格的话
 *   4 角色 + 1 场景 + 3×4 张道具（=17）根本摆不下，「每角色 3 张」这条规则永远够不着。
 * ★ 想按种类数上限就去数桌面（`tableSlotsOf`），别再长回一份计数 —— 两处数同一件事必然漂。
 */
export const TABLE_ROLE_SLOTS = 4;
export const TABLE_SCENE_SLOTS = 1;

/**
 * §3：每个角色卡最多挂 3 张道具（对齐参照游戏「货币战争」）。
 * ★ G2 时是 1 张（出片时"角色带道具"占一张参考图位）；G4 改 3 张是主人点名的规则，
 *   出片那边不进参考图位（游戏内的卡没有图，只报卡名，见 game/gen.ts），所以不会撑爆图位。
 * ★ 上限只在这里算（`itemLimitOf`）：事件可以把它 +1，界面不许自己做加法。
 */
export const ITEMS_PER_ROLE = 3;

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

/**
 * 「这个账号能不能升档」——**免费账号在游戏内只能停在 L1**（主人 2026-11-23 拍板 A）。
 *
 * ★ 为什么规则层只收一个布尔、不自己判：付没付过钱的判据在 `data/account.payingNow`
 *   （套餐价 > 0 或钱包回包顶层的 `paid`），而这个文件**零运行时依赖**——`scripts/check-game-rules.mjs`
 *   用 Node 直接 import 它跑（见文件头的 import 纪律），引不了 data/ 那一层。
 * ★ 为什么必须是**显式入参**而不是"在界面里藏起来"：L2 / L3 在档位表里都是会员档，
 *   免费账号升上去之后第一发真出片就是 403 `PLAN_REQUIRED`（出片前补画的设定帧还各自结算过了）。
 *   界面藏、规则放 = 玩家花了 15 金买到一个点了必失败的档位；所以选项**根本不出现**，
 *   而真发出去的那一档也由同一个 gate 夹回 L1（genTier.genTierIdOf）。
 * ★ 缺省 `MODEL_GATE_OPEN` = 能升：规则层既有的用例、**AI 陪玩**（bots/phases 拿不到人类账号）、
 *   单机演练都不必改。App 那条路**必须显式传**（`genTier.modelUpgradeGate()`），
 *   `scripts/check-game-rules.mjs` 里有一条源码棘轮钉着这件事（漏传就红）。
 */
export interface ModelGate {
  /** 这个账号能升到 L2 / L3 吗（免费账号 = false，只能停在 L1 `draft-mm`） */
  readonly upgrade: boolean;
}
/** 能升（规则层缺省 / AI 陪玩 / 单机演练）：不给 gate 时用它的唯一理由见上面那段 ★。 */
export const MODEL_GATE_OPEN: ModelGate = { upgrade: true };

/** §2.2：开局从池子里抽 3 张风格卡。 */
export const STYLE_PICK_COUNT = 3;

/**
 * §2.4：一期作品的占位视频固定 5 秒（G3 不接生成）。展映播放器的进度条按这一格走。
 * ★ 放在规则层而不是界面：一条片子的时长是"作品"的属性，G4 接真出片后由生成契约填进来，
 *   播放器那时不用改（它一直读 entry.seconds）。
 */
export const VIDEO_SECONDS = 5;

/**
 * §2.4：一句提示词的字符上限（按 Unicode 码点数，一个汉字算 1）。
 * ★ 80 字：横屏真机那一栏只有一行半的宽度（800×363 的视口，见 docs/g2-game-ui.md），
 *   再长就要滚动输入框，而这句话只是"这一期拍什么"的一句话。
 * ★ 事件「灵感爆发」的 +50% 走 promptLimitOf 一处加成，别在界面里另乘一遍。
 */
export const PROMPT_BASE_MAX = 80;

/**
 * §2.4 创作阶段**没有虚框了**（G4 第 3 步）：摆卡就是桌面那 5 个卡位（4 角色 + 1 场景），
 * 手里那几张（背包）与桌上的、装备在角色身上的合起来就是这一期出片的素材。
 * ★ 原来这里有一张 `SLOT_TYPES = ["role","scene","item"]`（三个虚框各放一张）—— 随虚框一起删掉：
 *   留着它就是第二份"这一期有哪几种卡"的真相（真上限在 TABLE_ROLE_SLOTS / TABLE_SCENE_SLOTS）。
 */

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
 * 风格卡池（§2.2）：8 套，一局抽 3 张。技法名词 × 题材 + 离线样张文件名。
 *
 * ★★ `id` 同时是**文件名**：`public/styles/<id>.webp`。三处必须一致 —— `id`、这一行的 `sample`、
 *    仓库里的那张图（`art.stylePreviewUrl` 直接读 `sample`，不另抄一份映射）。改了 id 不同时
 *    重命名图片，界面就是一张碎图，而 build 不会报错；`scripts/check-game-rules.mjs` 因此逐个核文件。
 * ★ 样张按 §2.2 离线批量生成、打进包，选风格那一步**绝不实时生成**（真人真机上要等 30 秒以上，
 *   还会被审核拦）。生成脚本 `design/gen-style-samples.mjs`（同一句话、只换风格，幂等可重跑）。
 * ★ 为什么是这 8 套：§2.2 点名的六套（赛璐璐+赛博朋克、胶片颗粒+九十年代香港霓虹、湿壁画+文艺复兴奇幻、
 *   3D 动画+末日废土、水墨+武侠、绘本+童话森林）一套不少，另加两套调子差异明显的（硬派黑白、水粉柔粉）——
 *   一局抽 3 张，池子越窄越容易三张看起来像同一套。
 * ★ 中文的技法名词 / 题材名在界面那一步（labels.ts，随 Lingui 目录走），规则层只留英文占位。
 */
export const STYLE_POOL: readonly StyleCard[] = [
  { id: "cel-cyberpunk", technique: "Cel-shading + 3D-to-2D", topic: "Cyberpunk", sample: "public/styles/cel-cyberpunk.webp" },
  { id: "film-hk-neon", technique: "Film grain + 50mm shallow DOF", topic: "90s Hong Kong neon", sample: "public/styles/film-hk-neon.webp" },
  { id: "fresco-renaissance", technique: "Fresco texture + Rembrandt light", topic: "Renaissance fantasy", sample: "public/styles/fresco-renaissance.webp" },
  { id: "toon-wasteland", technique: "3D animated feature + volumetric light", topic: "Post-apocalyptic wasteland", sample: "public/styles/toon-wasteland.webp" },
  { id: "ink-wuxia", technique: "Ink wash + negative space", topic: "Wuxia mountains", sample: "public/styles/ink-wuxia.webp" },
  { id: "picturebook-forest", technique: "Picture-book watercolor + soft linework", topic: "Fairytale forest", sample: "public/styles/picturebook-forest.webp" },
  { id: "noir-alley", technique: "Hard-boiled chiaroscuro", topic: "Neon noir alley", sample: "public/styles/noir-alley.webp" },
  { id: "gouache-seaside", technique: "Gouache + soft pastel palette", topic: "Seaside summer", sample: "public/styles/gouache-seaside.webp" },
];

/**
 * 事件池（§2.3b 的三个示例）+ 每个事件的选项与花费/收益。
 * ★ 「模型军备」在数据里有 4 条：L2 升级、L3 升级（15 金 + 3 连胜）各一条，再加上原来的
 *   「5 金下一回合半价」「免费 +4 金」。任何时刻**只有一条升级线出现**（见 optionsForPlayer /
 *   modelUpgradeOffer），所以玩家看到的仍是三选一；升到顶或连胜不够时只剩后两条。
 * ★ L2 / L3 两条升级线的价格直接引用 MODEL_LEVEL_UP_COST，不在数据里再抄一份 8 / 15。
 * ★★ 插画挂在**选项**上（`option.art`，10 张，G4 §5 之后）：面板上那三张卡是三个不同的东西，
 *   共用一张图三张卡就长得一样了。图离线生成、打进包（design/gen-event-art.mjs），
 *   选事件那一屏绝不实时出图；`<id>` 就是文件名，check-event-art.mjs 逐个核存在与体积。
 *   原来事件上那份 `art`（"一个事件一张"）没有任何调用方，随这次一起删掉。
 */
export const GAME_EVENTS: readonly GameEvent[] = [
  {
    id: "model-arms-race", // 模型军备
    options: [
      { id: "upgrade-draft", cost: MODEL_LEVEL_UP_COST[2], effects: [{ kind: "model-level", to: 2 }], art: "public/events/upgrade-draft.webp" },
      { id: "upgrade-cinema", cost: MODEL_LEVEL_UP_COST[3], effects: [{ kind: "model-level", to: 3 }], art: "public/events/upgrade-cinema.webp" },
      { id: "half-next", cost: 5, effects: [{ kind: "next-round-cost-half" }], art: "public/events/half-next.webp" },
      { id: "free-gold", cost: 0, effects: [{ kind: "gold", delta: 4 }], art: "public/events/free-gold.webp" },
    ],
  },
  {
    id: "inspiration-burst", // 灵感爆发
    options: [
      { id: "double-shoot", cost: 6, effects: [{ kind: "next-round-segments", value: 2 }], art: "public/events/double-shoot.webp" },
      { id: "long-prompt", cost: 3, effects: [{ kind: "prompt-limit-pct", pct: 50 }], art: "public/events/long-prompt.webp" },
      { id: "free-blue-card", cost: 0, effects: [{ kind: "random-card", quality: 3 }], art: "public/events/free-blue-card.webp" },
    ],
  },
  {
    id: "supply-drop", // 补给站
    options: [
      { id: "bag-expand", cost: 5, effects: [{ kind: "item-limit", delta: 1 }], art: "public/events/bag-expand.webp" },
      { id: "heal", cost: 3, effects: [{ kind: "hp", delta: 15 }], art: "public/events/heal.webp" },
      { id: "free-refresh", cost: 0, effects: [{ kind: "free-refresh", count: 2 }], art: "public/events/free-refresh.webp" },
    ],
  },
];

// ────────────────────────────── 结果形状（失败一定带 reason，调用不许看图猜） ──────────────────────────────

export type RuleRejectReason =
  /**
   * 某一类**卡位**满了（G4 §3 起它只剩这一层意思：桌面 4 个角色位 / 1 个场景位）。
   * ★ 背包不再按种类计数（`bag-full` 整条随之撤掉），所以这个码现在只由 placeCardOnTable 抛。
   */
  | "type-cap"
  /** 拖错了位子：角色卡丢进场景位 / 场景卡丢进角色位 / 道具卡丢进卡位（道具是挂到角色身上的） */
  | "wrong-slot-type"
  /** 这个卡位不存在（下标越界；界面与规则各传各的号时当场响，别静默把卡吞了） */
  | "bad-table-slot"
  /** 这个卡位是空的（拖回去 / 拆除工具拖上去时那一格没有人） */
  | "table-slot-empty"
  /** 这张卡已经摆在桌面上了（卖卡 / 再摆一次时要先拖回背包） */
  | "card-on-table"
  /** 这张角色卡还没摆到桌面上（道具只能挂到桌上的角色身上，见 equipItemOnRole） */
  | "role-not-on-table"
  | "card-not-in-bag"
  | "item-equipped"
  | "role-equipped"
  | "not-an-item"
  | "not-a-role"
  /** 这张角色身上的道具已经到上限了（rules.itemLimitOf，缺省 3 张） */
  | "item-limit"
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
  | "no-cards-left"
  // ── G3 回合循环（§2.4 创作 / §2.5 展映投票）新增的原因码 ──
  | "prompt-empty"
  | "prompt-too-long"
  | "entries-pending"
  | "entry-not-found"
  | "entry-already-liked"
  | "already-voted"
  | "self-vote"
  | "votes-pending";

export interface RuleFailure {
  ok: false;
  reason: RuleRejectReason;
  /** 补充数字：哪个卡种 / 要多少 / 有多少 / 上限多少（界面拿去说人话，不许只回一个 false）。 */
  cardType?: CardType;
  /** 这个位子该放哪种卡（wrong-slot-type 用：拖进去的那种在 cardType，位子要的在 expected）。 */
  expected?: CardType;
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
/** 交片：回执里带上刚写进去的那条作品（界面要立刻显示"拍好了"）。 */
export type EntryResult = { ok: true; state: GameState; entry: RoundEntry } | RuleFailure;
/** 结算（从本期实际投出来的名次）：摘要 + 两个榜一起交出来（界面在结算屏上同屏显示）。 */
export type RoundResult = { ok: true; state: GameState; summary: RoundSettlement; tally: RoundTally } | RuleFailure;

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
    table: emptyTable(),
    itemLimitBonus: 0,
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
    // 第 1 回合还没有作品 / 弃权 / 上一期名次：展映顺序按座位表（rules.screeningOrderOf）
    entries: [],
    abstained: [],
    lastRanking: [],
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

/** 拥有的全部卡 = 背包 + 桌面卡位 + 已装备的道具。★ 卖卡 / 取卡 / 出片认人都按这一份。 */
export function ownedCards(player: GamePlayer): GameCard[] {
  return [...player.bag, ...tableCardsOf(player), ...player.equipment.map((e) => e.item)];
}

export function typeCountsOf(player: GamePlayer): Record<CardType, number> {
  const counts: Record<CardType, number> = { role: 0, scene: 0, item: 0 };
  for (const card of ownedCards(player)) counts[card.type] += 1;
  return counts;
}

/**
 * 每张角色卡能挂几张道具 = 基础 `ITEMS_PER_ROLE` + 事件「补给站」的加成。
 * ★ 只有这一处算：界面显示"x/3"、equipItemOnRole 的闸、出片时往提示词里点名道具，都问它。
 */
export function itemLimitOf(player: GamePlayer): number {
  return Math.max(0, ITEMS_PER_ROLE + (player.itemLimitBonus ?? 0));
}

/** 空桌面（4 个角色位 + 1 个场景位）。 */
export function emptyTable(): TableSlots {
  return { roles: Array.from({ length: TABLE_ROLE_SLOTS }, () => null), scene: null };
}

/**
 * 桌面 5 个卡位的规范化读数：补满 4 个角色位（老状态里没有 table 这一格时也回空桌）。
 * ★ 调用方一律走它，别直接 `player.table.roles[3]` —— 补长度的写法一漏就是"少一个卡位"的静默空洞。
 */
export function tableSlotsOf(player: GamePlayer): TableSlots {
  const table = player.table ?? emptyTable();
  return {
    roles: Array.from({ length: TABLE_ROLE_SLOTS }, (_, i) => table.roles?.[i] ?? null),
    scene: table.scene ?? null,
  };
}

/** 桌上摆着的卡（角色 + 场景，去掉空位）。 */
export function tableCardsOf(player: GamePlayer): GameCard[] {
  const table = tableSlotsOf(player);
  return [...table.roles.filter((card): card is GameCard => !!card), ...(table.scene ? [table.scene] : [])];
}

/**
 * 背包占用（界面读数用）。
 * ★ 没有上限：G4 §3 把 9 格与"按种类计数"整组撤掉，上限落在桌面卡位与「每角色 3 张道具」上。
 *   这个函数只剩"给界面报个数"，**不参与任何门禁** —— 想判能不能收卡，问桌面的空位。
 */
export function bagUsage(player: GamePlayer): { total: number; byType: Record<CardType, number> } {
  const byType: Record<CardType, number> = { role: 0, scene: 0, item: 0 };
  for (const card of player.bag) byType[card.type] += 1;
  return { total: player.bag.length, byType };
}

/**
 * 还能不能收一张卡进背包。
 * ★ 恒为 null（收得下）：背包不再有总量与种类上限。函数留着是因为 buyShopCard / 事件随机卡 /
 *   出片取卡都走同一条"先问再收"的形状，删了就要在三个地方各写一遍"直接塞进去"
 *   （而那些地方正是"以后想加个上限"时该改的一处）。
 */
export function canAddCard(_player: GamePlayer, _card: GameCard): RuleFailure | null {
  return null;
}

/** 收一张卡进背包。★ 背包不再有上限（见 canAddCard），失败只可能是坏状态 —— 这里没有失败分支。 */
export function addCardToBag(player: GamePlayer, card: GameCard): PlayerResult {
  return { ok: true, player: { ...player, bag: [...player.bag, card] } };
}

// ── 桌面卡位的一小套内部工具（摆卡 / 回背包 / 换人共用，别在 UI 里各写一遍） ──

function slotOf(table: TableSlots, slot: TableSlot): { card: GameCard | null; ok: boolean } {
  if (slot.kind === "scene") return { card: table.scene, ok: true };
  if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= TABLE_ROLE_SLOTS) return { card: null, ok: false };
  return { card: table.roles[slot.index] ?? null, ok: true };
}

function withSlot(table: TableSlots, slot: TableSlot, card: GameCard | null): TableSlots {
  if (slot.kind === "scene") return { ...table, scene: card };
  const roles = [...table.roles];
  roles[slot.index] = card;
  return { ...table, roles };
}

/** 这一类卡的第一个空位；一个空位都没有 → null（调用方回 type-cap，这就是"桌面卡位才是上限"那一层）。 */
function firstFreeSlot(table: TableSlots, type: CardType): TableSlot | null {
  if (type === "scene") return table.scene === null ? { kind: "scene" } : null;
  const index = table.roles.findIndex((card) => card === null);
  return index < 0 ? null : { kind: "role", index };
}

/** 这一类卡位一共几个（type-cap 的 cap；界面说"角色位 4/4 满了"用的也是它）。 */
export function slotCountOf(type: CardType): number {
  return type === "scene" ? TABLE_SCENE_SLOTS : TABLE_ROLE_SLOTS;
}

/**
 * §2（G4 施工单）：把一张卡**从背包摆到桌面卡位**上。
 *
 * ★ `slot === null` = 拖到桌面上但没对准某一格 → 自己找这一类的第一个空位（真机上拖到格子边缘
 *   很常见，落点差一格就判失败会让人以为拖不动）；一个空位都没有才回 `type-cap`
 *   —— 这就是施工单说的"type-cap 那套只保留桌面卡位这一层"。
 * ★ 目标位上有卡 = **替换**：旧卡回背包（同一张卡拖回原位是空操作，不算失败）。
 * ★ 旧的那张是**带道具的角色**时整句拒（role-equipped）：道具的回背包 / 交给新卡都不对，
 *   硬换就会让几张已装备的道具指向一张不在桌上的卡（零报错、出片时少人少东西）。
 */
export function placeCardOnTable(player: GamePlayer, cardId: string, slot: TableSlot | null = null): PlayerResult {
  const table = tableSlotsOf(player);
  // ★ 目标位子上**就是这张卡** = 空操作（成功）：从桌上拖起来又松手在同一格、
  //   或者"同一张卡再摆一次"都不该报错（拖拽时最容易被当成"拖坏了"的就是这一下）。
  if (slot) {
    const probe = slotOf(table, slot);
    if (!probe.ok) return reject("bad-table-slot", { count: slot.kind === "role" ? slot.index : 0, cap: TABLE_ROLE_SLOTS });
    if (probe.card?.id === cardId) return { ok: true, player };
  } else if (tableCardsOf(player).some((card) => card.id === cardId)) {
    // 没指定目标位子、而这张卡已经在桌上了：它本来就摆着，什么都不用做
    return { ok: true, player };
  }

  const card = player.bag.find((candidate) => candidate.id === cardId);
  if (!card) {
    // 已经摆在桌上 / 装备在角色身上：说清楚"它已经在那儿了"，别报成"不在背包里"
    if (tableCardsOf(player).some((candidate) => candidate.id === cardId)) return reject("card-on-table");
    if (player.equipment.some((entry) => entry.item.id === cardId)) return reject("item-equipped");
    return reject("card-not-in-bag");
  }
  if (card.type === "item") return reject("wrong-slot-type", { cardType: card.type, expected: "role" });

  let target: TableSlot | null = slot;
  if (target) {
    const probe = slotOf(table, target);
    if (!probe.ok) return reject("bad-table-slot", { count: target.kind === "role" ? target.index : 0, cap: TABLE_ROLE_SLOTS });
  } else {
    target = firstFreeSlot(table, card.type);
    if (!target) return reject("type-cap", { cardType: card.type, count: slotCountOf(card.type), cap: slotCountOf(card.type) });
  }

  const want: CardType = target.kind === "scene" ? "scene" : "role";
  if (card.type !== want) return reject("wrong-slot-type", { cardType: card.type, expected: want });

  const outgoing = slotOf(table, target).card;
  if (outgoing?.id === card.id) return { ok: true, player };
  if (outgoing?.type === "role" && equippedCountOf(player, outgoing.id) > 0) return reject("role-equipped");

  const bag = player.bag.filter((candidate) => candidate.id !== cardId);
  return {
    ok: true,
    player: {
      ...player,
      bag: outgoing ? [...bag, outgoing] : bag,
      table: withSlot(table, target, card),
    },
  };
}

/**
 * 把桌面卡位上的一张卡**拖回背包**（施工单：已占的位可以拖回背包）。
 * ★ 带道具的角色整句拒（role-equipped）：道具得先卸下来 —— 一张角色回背包、几张道具还挂在它身上，
 *   下次再摆回来之前它们谁都拿不到（界面也没有地方列出"挂在背包里那张角色上的道具"）。
 */
export function returnTableCardToBag(player: GamePlayer, slot: TableSlot): PlayerResult {
  const table = tableSlotsOf(player);
  const probe = slotOf(table, slot);
  if (!probe.ok) return reject("bad-table-slot", { count: slot.kind === "role" ? slot.index : 0, cap: TABLE_ROLE_SLOTS });
  const card = probe.card;
  if (!card) return reject("table-slot-empty", { cardType: slot.kind === "scene" ? "scene" : "role" });
  if (card.type === "role" && equippedCountOf(player, card.id) > 0) return reject("role-equipped");
  return {
    ok: true,
    player: { ...player, bag: [...player.bag, card], table: withSlot(table, slot, null) },
  };
}

/**
 * §2.1 / 施工单 §3 装备：道具只能挂到**桌上**的角色卡上（右侧道具栏拖到角色卡那一下）。
 * ★ 一个角色最多 `itemLimitOf(player)` 张（缺省 3）：到上限回 item-limit，界面拿 count/cap 说人话。
 * ★ 角色必须已经摆到桌面上：道具要挂在一张**正在出片**的角色身上才有意义，挂在背包里的卡上
 *   屏幕上没有地方显示它（右侧栏只列道具，勾不回去），下一个人也看不出它属于谁。
 */
export function equipItemOnRole(player: GamePlayer, roleCardId: string, itemCardId: string): PlayerResult {
  const role = tableSlotsOf(player).roles.find((card) => card?.id === roleCardId) ?? null;
  if (!role) {
    if (player.bag.some((card) => card.id === roleCardId)) return reject("role-not-on-table");
    return reject("not-a-role");
  }
  const item = player.bag.find((card) => card.id === itemCardId);
  if (!item) {
    if (player.equipment.some((entry) => entry.item.id === itemCardId)) return reject("item-equipped");
    return reject("card-not-in-bag");
  }
  if (item.type !== "item") return reject("not-an-item");
  const cap = itemLimitOf(player);
  const count = equippedCountOf(player, roleCardId);
  if (count >= cap) return reject("item-limit", { count, cap });
  return {
    ok: true,
    player: {
      ...player,
      bag: player.bag.filter((card) => card.id !== itemCardId),
      equipment: [...player.equipment, { roleCardId, item }],
    },
  };
}

/**
 * 拆除工具：把一张角色身上的**所有**道具一次卸回背包（施工单 §3「右侧栏的拆除工具」）。
 * ★ 一次全卸而不是卸一张：参照游戏里那颗工具就是"清空这个人的装备"，逐张卸要一双手点三次。
 */
export function unequipAllFromRole(player: GamePlayer, roleCardId: string): PlayerResult {
  const mine = player.equipment.filter((entry) => entry.roleCardId === roleCardId);
  if (mine.length === 0) return reject("no-equipped-item");
  return {
    ok: true,
    player: {
      ...player,
      bag: [...player.bag, ...mine.map((entry) => entry.item)],
      equipment: player.equipment.filter((entry) => entry.roleCardId !== roleCardId),
    },
  };
}

/** 一张角色身上的道具（按装备顺序，右侧栏 / 卡面角标按它画"3 张里的哪几张"）。 */
export function equippedItemsOf(player: GamePlayer, roleCardId: string): GameCard[] {
  return player.equipment.filter((entry) => entry.roleCardId === roleCardId).map((entry) => entry.item);
}

export function equippedCountOf(player: GamePlayer, roleCardId: string): number {
  return player.equipment.reduce((count, entry) => (entry.roleCardId === roleCardId ? count + 1 : count), 0);
}

/**
 * §2.1 卖卡：回收 1 金。
 * ★ 只有**背包里**的卡能卖：桌上的卡（角色 / 场景）要卖先拖回背包 —— 否则桌上会留一个空位、
 *   而出片提示词那一份刚读过它（同"创作阶段背包锁住"那条 ★ 的同一个理由）。
 */
export function sellCardFromBag(player: GamePlayer, cardId: string): SellResult {
  const index = player.bag.findIndex((card) => card.id === cardId);
  if (index < 0) {
    if (player.equipment.some((entry) => entry.item.id === cardId)) return reject("item-equipped");
    if (tableCardsOf(player).some((card) => card.id === cardId)) return reject("card-on-table");
    return reject("card-not-in-bag");
  }
  return {
    ok: true,
    player: { ...player, bag: player.bag.filter((_, i) => i !== index), gold: player.gold + CARD_SELL_GOLD },
    refund: CARD_SELL_GOLD,
  };
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
      // 上一期的作品 / 弃权在这个回合开张时作废（结算摘要那时已经交给界面了）；
      // lastRanking **留着** —— 本期展映的播放顺序读的正是它（§2.5「按上一回合综合排名倒序」）。
      entries: [],
      abstained: [],
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
 * ★ 原子：钱不够 / 那一格空了都**不扣钱、不动商店**（否则就是「付了钱没拿到卡」）。
 * ★ G4 §3 起没有"装不下"这回事（背包不限量），所以也没有"替换掉旧卡"那条路了 ——
 *   买不到卡的唯一原因是**钱不够**。旧卡想换成金币走 sellCard（卖 +1 金）。
 */
export function buyShopCard(state: GameState, playerId: string, slotIndex: number): StateResult {
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

  const bagResult = addCardToBag(found.player, card);
  if (!bagResult.ok) return bagResult;
  const player: GamePlayer = { ...bagResult.player, gold: bagResult.player.gold - price };
  const cards = shop.cards.map((c, i) => (i === slotIndex ? null : c));
  return {
    ok: true,
    state: replacePlayerInState({ ...state, shops: { ...state.shops, [playerId]: { ...shop, cards } } }, player),
  };
}

/**
 * 卖卡只在**商店阶段**允许（§2.0 ①）；**摆卡 / 装备道具两阶段都允许**（G4 第 3 步）。
 * ★ 卖卡为什么锁在商店阶段：钱是商店阶段的事，而创作阶段卖掉的卡可能刚被这一期的出片引用
 *   （零报错、成片里少一个人）。
 * ★ 摆卡 / 装备为什么也放创作阶段：出片是拿**桌面上的卡 + 提示词**发出去的，而"视频生成"按钮就在
 *   创作阶段 —— 只在商店阶段能摆卡的话，玩家进创作阶段才发现没摆，那一步就永远补不上
 *   （改动会在发出去的提示词里少一张卡）。这两样都不动钱、也不删卡，不违反上面那条。
 */
export const PLACE_PHASES: readonly GamePhase[] = ["shop", "create"];

export function sellCard(state: GameState, playerId: string, cardId: string): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const sold = sellCardFromBag(found.player, cardId);
  if (!sold.ok) return sold;
  return { ok: true, state: replacePlayerInState(state, sold.player) };
}

export function placeOnTable(state: GameState, playerId: string, cardId: string, slot: TableSlot | null = null): StateResult {
  const gate = placeGate(state, playerId);
  if (gate) return gate;
  const placed = placeCardOnTable(findPlayer(state, playerId)!.player, cardId, slot);
  if (!placed.ok) return placed;
  return { ok: true, state: replacePlayerInState(state, placed.player) };
}

export function returnToBag(state: GameState, playerId: string, slot: TableSlot): StateResult {
  const gate = placeGate(state, playerId);
  if (gate) return gate;
  const returned = returnTableCardToBag(findPlayer(state, playerId)!.player, slot);
  if (!returned.ok) return returned;
  return { ok: true, state: replacePlayerInState(state, returned.player) };
}

/** 摆卡 / 回背包 / 装备 / 卸道具共用的阶段闸（判据只有 PLACE_PHASES 一处）。 */
function placeGate(state: GameState, playerId: string): RuleFailure | null {
  if (!PLACE_PHASES.includes(state.phase)) return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  return null;
}

export function equipItem(state: GameState, playerId: string, roleCardId: string, itemCardId: string): StateResult {
  const gate = placeGate(state, playerId);
  if (gate) return gate;
  const equipped = equipItemOnRole(findPlayer(state, playerId)!.player, roleCardId, itemCardId);
  if (!equipped.ok) return equipped;
  return { ok: true, state: replacePlayerInState(state, equipped.player) };
}

export function unequipAll(state: GameState, playerId: string, roleCardId: string): StateResult {
  const gate = placeGate(state, playerId);
  if (gate) return gate;
  const unequipped = unequipAllFromRole(findPlayer(state, playerId)!.player, roleCardId);
  if (!unequipped.ok) return unequipped;
  return { ok: true, state: replacePlayerInState(state, unequipped.player) };
}

// ────────────────────────────── 模型等级（§2.3 / §2.3b） ──────────────────────────────

/** §2.3b：等级只影响「游戏内生成档位」的返回值（草稿 480p / 高清 720p / 电影级 1080p）。
 *  ★ `gate` 不是摆设（任务 A，2026-11-23 主人拍板）：免费账号的等级**在规则层就夹回 L1** ——
 *    "界面上写 L2、发出去是 L1" 与 "界面上写 L3、发出去 403" 都不可接受，而 store 里那份
 *    `player.modelLevel` 不归这里管（它可能是一个付费时升过、后来套餐过期的人留下来的）。
 *    三处读同一个 gate：选项（modelUpgradeOffer）、真扣钱（applyEventChoice）、出片档位（这里）。 */
export function generationTierOf(player: GamePlayer, gate: ModelGate = MODEL_GATE_OPEN): GameGenerationTier {
  if (!gate.upgrade) return MODEL_LEVEL_TIERS[1];
  return MODEL_LEVEL_TIERS[player.modelLevel];
}

/**
 * 现在这条升级线开不开、多少钱。**L3 的 3 连胜门槛只有这一处判断**：
 *   L1 → L2（8 金）随时；L2 → L3（15 金）要 winStreak ≥ 3；L3 封顶（§5-8 默认不放开）。
 * ★ 事件选项「出不出现在屏幕上」由 optionsForPlayer 调这里决定（不满足就整条不摆，见 §2.3b）。
 * ★ 免费账号整条线都不开（`gate.upgrade === false`，见 ModelGate 那段 ★）：模型军备那一屏只剩
 *   后两条（半价 / 免费 +4 金），玩家不会看到一个"点了必失败、还会白花 8 金"的升级项。
 */
export function modelUpgradeOffer(player: GamePlayer, gate: ModelGate = MODEL_GATE_OPEN): { level: 2 | 3; cost: number } | null {
  if (!gate.upgrade) return null;
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
export function optionAvailable(player: GamePlayer, option: GameEventOption, gate: ModelGate = MODEL_GATE_OPEN): boolean {
  for (const effect of option.effects) {
    if (effect.kind === "model-level") {
      const offer = modelUpgradeOffer(player, gate);
      if (!offer || offer.level !== effect.to) return false;
    }
  }
  return true;
}

/** 这个玩家在这个事件里能看到的选项（顺序按事件数据；模型军备最多 3 条）。 */
export function optionsForPlayer(player: GamePlayer, event: GameEvent, gate: ModelGate = MODEL_GATE_OPEN): GameEventOption[] {
  return event.options.filter((option) => optionAvailable(player, option, gate));
}

/** 本期事件 + 该玩家可选的选项；没抽事件 / 阶段不对都回原因（界面据此说「本期没有事件」）。 */
export function eventOptionsFor(state: GameState, playerId: string, gate: ModelGate = MODEL_GATE_OPEN): EventOptionsResult {
  if (state.phase !== "event") return reject("wrong-phase");
  if (state.currentEventId === null) return reject("event-not-drawn");
  const event = gameEventById(state.currentEventId);
  if (!event) return reject("event-not-drawn");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (state.eventPicks[playerId] !== undefined) return reject("event-already-picked");
  return { ok: true, options: optionsForPlayer(found.player, event, gate) };
}

/**
 * 选一个事件选项：扣钱 → 结算收益 → 记下谁选过。
 * ★ 全体存活玩家各选一次（同一事件、各自选自己的），全员选完 phase 才进 round-end。
 * ★ 原子：钱不够 / 选项不可用 / 随机卡把背包撑破，都整项失败、state 原样（不许「先扣钱再发现装不下」）。
 * ★ `gate` 必须和摆选项的那一次是同一个（`view.eventViewOf` / `store.chooseEvent` 两处都传
 *   `genTier.modelUpgradeGate()`）：只在摆的时候挡住、在这里放行的话，一个手快（或旧版界面）就能把
 *   免费账号升上去，而钱扣的是"8 金"，失败的是后面那一发出片（403）。
 */
export function applyEventChoice(
  state: GameState,
  playerId: string,
  optionId: string,
  rng: Rng,
  gate: ModelGate = MODEL_GATE_OPEN,
): EventApplyResult {
  if (state.phase !== "event") return reject("wrong-phase");
  if (state.currentEventId === null) return reject("event-not-drawn");
  const event = gameEventById(state.currentEventId);
  if (!event) return reject("event-not-drawn");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (state.eventPicks[playerId] !== undefined) return reject("event-already-picked");

  const option = event.options.find((o) => o.id === optionId);
  if (!option || !optionAvailable(found.player, option, gate)) return reject("option-unavailable");
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
): { ok: true; player: GamePlayer; serial: number } | RuleFailure {  let next: GamePlayer = { ...player, buffs: { ...player.buffs } };
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
      case "item-limit":
        // G4 §3：道具上限不再按卡种类记，只剩"每张角色最多挂几张"这一格（itemLimitOf 读它）
        next.itemLimitBonus = Math.max(0, (next.itemLimitBonus ?? 0) + effect.delta);
        break;
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

/**
 * 事件里"跳过"的表态（§2.3b 的兜底出口）。
 * ★★ 为什么需要它：三选一里那个**免费项**在某些局面下也会落不了账 ——
 *   「灵感爆发」的免费项是"随机一张蓝卡"，而背包满了 / 该类型到上限时 applyEventEffects 会整项拒
 *   （铁律八：不静默丢卡）。同一时刻另外两项要 3 / 6 金；一个满背包、身上没钱的人就**一个选项都选不了**，
 *   而事件要求全员各选一次才进下一回合 ⇒ 这一局永远停在事件阶段，只能结束对局（零报错）。
 * ★ 跳过 = 记一笔表态、**什么都不改**（不是白拿收益）：设计稿 §2.3b 本来就说免费项"相当于跳过"，
 *   这里只是给这句话一个永远走得通的实现。界面照常摆三选一，跳过是第四个从属出口。
 */
export function skipEventChoice(state: GameState, playerId: string): StateResult {
  if (state.phase !== "event") return reject("wrong-phase");
  if (state.currentEventId === null) return reject("event-not-drawn");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (state.eventPicks[playerId] !== undefined) return reject("event-already-picked");
  const eventPicks: Record<string, string> = { ...state.eventPicks, [playerId]: EVENT_SKIP_PICK };
  const alive = state.players.filter((player) => !player.eliminated);
  const allPicked = alive.every((player) => eventPicks[player.id] !== undefined);
  return { ok: true, state: { ...state, eventPicks, phase: allPicked ? "round-end" : "event" } };
}

/** 跳过在 eventPicks 里记的 optionId（与事件数据里的选项 id 不可能撞：事件 id 里没有 "skip" 这种短词）。 */
export const EVENT_SKIP_PICK = "skip";

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
    // lastRanking = 本期名次：下一期展映按它**倒序**播（§2.5「落后先放」），排序在 screeningOrderOf 一处。
    state: { ...candidate, phase, drawnEventIds, currentEventId, eventPicks: {}, lastRanking: rankingIds },
    summary,
  };
}

/** 只清「只保一回合」的增益；免费刷新券不过期（买了就是你的）。 */
function clearTimedBuffs(buffs: GameBuffs): GameBuffs {
  return { nextRoundCostHalf: false, nextRoundSegments: 1, promptLimitPct: 0, freeRefreshes: buffs.freeRefreshes };
}

// ────────────────────────────── 阶段推进（§2.0 的 ①②③④⑤） ──────────────────────────────

export function enterCreation(state: GameState): StateResult {
  if (state.phase !== "shop") return reject("wrong-phase");
  return { ok: true, state: { ...state, phase: "create" } };
}

/**
 * 创作 → 展映：**全员都交了片**才放行（§2.0 ③ 播的是"全员本回合的视频"）。
 * ★ 为什么不让人先开始展映、播到一半再补：展映的播放顺序是上一期名次定的，少一条片子那条片子
 *   就永远没人点赞；而投票要求"全员看完"—— 顺序里缺一格，这一期的榜就不完整。
 * ★ 单机版的 AI 由编排层（game/phases.ts）在进创作阶段时就交片，所以卡在这里的只可能是真人的片子。
 */
export function enterScreening(state: GameState): StateResult {
  if (state.phase !== "create") return reject("wrong-phase");
  const alive = alivePlayers(state);
  const missing = alive.filter((player) => entryOfPlayer(state, player.id) === null);
  if (missing.length > 0) return reject("entries-pending", { count: missing.length, cap: alive.length });
  return { ok: true, state: { ...state, phase: "screening" } };
}

export function enterVoting(state: GameState): StateResult {
  if (state.phase !== "screening") return reject("wrong-phase");
  return { ok: true, state: { ...state, phase: "voting" } };
}

// ────────────────────────────── 创作：一期作品（§2.4） ──────────────────────────────

/** 一期作品的 id：`r<回合>-<playerId>`。★ 稳定 —— 点赞 / 投票 / 结算回执都认它，不靠数组下标。 */
export function roundEntryId(round: number, playerId: string): string {
  return `r${round}-${playerId}`;
}

/**
 * §2.4 提示词上限：基础 80 字 + 事件「灵感爆发」的 +50%（rules.promptLimitBonusPct 一处读 buffs）。
 * ★ 只在这里算：界面拿它显示"还能写几个字"、submitRoundEntry 拿它判拒 —— 两处各乘一遍就会漂。
 */
export function promptLimitOf(player: GamePlayer): number {
  return Math.floor((PROMPT_BASE_MAX * (100 + promptLimitBonusPct(player))) / 100);
}

/** 这一期某个人的作品；没交回 null。按 id 认（不按数组顺序）。 */
export function entryOfPlayer(state: GameState, playerId: string): RoundEntry | null {
  const id = roundEntryId(state.round, playerId);
  return state.entries.find((entry) => entry.id === id) ?? null;
}

/** 按 id 找一条作品（点赞 / 投票 / 界面点开那一条都走它）。 */
export function entryById(state: GameState, entryId: string): RoundEntry | null {
  return state.entries.find((entry) => entry.id === entryId) ?? null;
}

/**
 * 一期作品取哪几张卡 = **桌面上的卡 + 挂在角色身上的道具**（G4 第 3 步）。
 * ★ 只有这一处算：交片（submitRoundEntry）、生成那一发（game/gen 把卡名拼进提示词）、
 *   展映的卡面都读它 —— 三处各列一遍，迟早一处漏掉道具，"提示词里有、卡面没有"。
 */
export function castCardsOf(player: GamePlayer): GameCard[] {
  return [...tableCardsOf(player), ...player.equipment.map((entry) => entry.item)];
}

/**
 * §2.4 交片：把**桌面上的卡** + 一句提示词变成这一期的作品。
 * ★ 卡**从自己的拥有清单里派生**（castCardsOf），不再由调用方递进来：G4 第 3 步起"摆哪几张"
 *   就是桌面那 5 个卡位 + 装备关系，调用方再递一份就是第二份真相（递错一张就是投票时少一个人）。
 * ★ 一条卡都没有也算交片（空镜）：开局 0 张、又把钱花光时是可能的，而展映要全员都有片子才开得下去 ——
 *   不然玩家会卡在创作阶段出不去。空镜的代价落在 AI 的投票权重上（bots.entryWeightOf）。
 * ★ 同一回合可以重交（改提示词 / 重摆卡）：重交不花钱（钱花在生成那一发，由界面自己说清楚）。
 * ★ `videoUrl` = 这一期真出片的结果（game/gen 传进来）：展映屏放它；没出片（空镜 / 没花钱）就没有，
 *   屏上仍按占位色块播，时长落回 VIDEO_SECONDS。
 */
export function submitRoundEntry(
  state: GameState,
  playerId: string,
  input: { prompt: string; videoUrl?: string; seconds?: number },
): EntryResult {
  if (state.phase !== "create") return reject("wrong-phase");
  const found = findPlayer(state, playerId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");

  const prompt = input.prompt.trim();
  if (prompt.length === 0) return reject("prompt-empty");
  // 按码点数（不是 .length）：表情 / 生僻字不该因为 UTF-16 记两个字就提前顶到上限
  const promptLength = Array.from(prompt).length;
  const promptLimit = promptLimitOf(found.player);
  if (promptLength > promptLimit) return reject("prompt-too-long", { cap: promptLimit, have: promptLength });

  const seconds = Number.isFinite(input.seconds) && (input.seconds as number) > 0 ? (input.seconds as number) : VIDEO_SECONDS;
  const entry: RoundEntry = {
    id: roundEntryId(state.round, playerId),
    round: state.round,
    playerId,
    cards: castCardsOf(found.player),
    prompt,
    styleCardId: found.player.styleCardId,
    seconds,
    ...(input.videoUrl ? { videoUrl: input.videoUrl } : {}),
    likedBy: [],
    votedBy: [],
  };
  const exists = state.entries.some((existing) => existing.id === entry.id);
  const entries = exists
    ? state.entries.map((existing) => (existing.id === entry.id ? entry : existing))
    : [...state.entries, entry];
  return { ok: true, state: { ...state, entries }, entry };
}

/**
 * §2.5 展映顺序：**上一期综合名次倒序**（落后先放，避免"看完强的就不敢做"）。
 * ★ 第 1 回合没有上一期名次 → 按座位表（state.players 的顺序，与建局时给的一致，回放稳定）。
 * ★ 名次里没有的人（理论上不该有）排在最后，按座位定序 —— 宁可按一个确定的顺序播，也别乱序。
 */
export function screeningOrderOf(state: GameState): RoundEntry[] {
  const entries = state.entries.filter((entry) => entry.round === state.round);
  const seat = new Map(state.players.map((player, index) => [player.id, index]));
  const seatOf = (playerId: string) => seat.get(playerId) ?? Number.MAX_SAFE_INTEGER;
  if (state.lastRanking.length === 0) {
    return [...entries].sort((a, b) => seatOf(a.playerId) - seatOf(b.playerId));
  }
  const rankOf = (playerId: string) => {
    const index = state.lastRanking.indexOf(playerId);
    return index < 0 ? state.lastRanking.length : index;
  };
  return [...entries].sort((a, b) => rankOf(b.playerId) - rankOf(a.playerId) || seatOf(a.playerId) - seatOf(b.playerId));
}

// ────────────────────────────── 展映：点赞（§2.5） ──────────────────────────────

/**
 * §2.5 点赞：展映播放中可以给**任意一条**点一次（含自己那条 —— §2.5 只写"任何人可点赞"，
 * 而投票那一句才明说"不能投自己"；平台上给自己点个赞也不稀奇，且四条各 +1 在名次上没有影响）。
 * ★ 每个玩家对同一条只能点一次（entry-already-liked）；不设"取消点赞"：一回合就一次机会。
 */
export function likeEntry(state: GameState, voterId: string, entryId: string): StateResult {
  if (state.phase !== "screening") return reject("wrong-phase");
  const found = findPlayer(state, voterId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  const entry = entryById(state, entryId);
  if (!entry || entry.round !== state.round) return reject("entry-not-found");
  if (entry.likedBy.includes(voterId)) return reject("entry-already-liked");
  return {
    ok: true,
    state: {
      ...state,
      entries: state.entries.map((existing) =>
        existing.id === entryId ? { ...existing, likedBy: [...existing.likedBy, voterId] } : existing,
      ),
    },
  };
}

/**
 * §2.5 投票：**不能投自己**、每人一票、可弃权（abstainVote）。
 * ★ 投过 / 弃过都算表态，再投会回 already-voted —— 「全员表态完毕」是 settleRoundFromVotes 的闸。
 */
export function voteEntry(state: GameState, voterId: string, entryId: string): StateResult {
  if (state.phase !== "voting") return reject("wrong-phase");
  const found = findPlayer(state, voterId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (hasSpoken(state, voterId)) return reject("already-voted");
  const entry = entryById(state, entryId);
  if (!entry || entry.round !== state.round) return reject("entry-not-found");
  if (entry.playerId === voterId) return reject("self-vote");
  return {
    ok: true,
    state: {
      ...state,
      entries: state.entries.map((existing) =>
        existing.id === entryId ? { ...existing, votedBy: [...existing.votedBy, voterId] } : existing,
      ),
    },
  };
}

/** §2.5「可弃权」：记一笔表态，这一票就不投了（不能投完再弃 —— 一次机会只有一种用法）。 */
export function abstainVote(state: GameState, voterId: string): StateResult {
  if (state.phase !== "voting") return reject("wrong-phase");
  const found = findPlayer(state, voterId);
  if (!found) return reject("unknown-player");
  if (found.player.eliminated) return reject("player-eliminated");
  if (hasSpoken(state, voterId)) return reject("already-voted");
  return { ok: true, state: { ...state, abstained: [...state.abstained, voterId] } };
}

/** 这个人这一期表过态没有（投过或弃权过）。 */
function hasSpoken(state: GameState, playerId: string): boolean {
  if (state.abstained.includes(playerId)) return true;
  return state.entries.some((entry) => entry.round === state.round && entry.votedBy.includes(playerId));
}

/** 还没表态的存活玩家（按座位表）：投票屏用它说"还差谁"，settleRoundFromVotes 用它拒。 */
export function votesPendingOf(state: GameState): string[] {
  return alivePlayers(state)
    .filter((player) => !hasSpoken(state, player.id))
    .map((player) => player.id);
}

// ────────────────────────────── 结算：两个榜 + 综合名次（§2.5） ──────────────────────────────

/**
 * §2.5 的两个榜与综合名次。
 *   · 点赞榜 / 投票榜：按条数排；**并列同名次**（竞赛排名：2,2,1 → 1,1,3）。
 *   · 综合名次 = 点赞榜名次 + 投票榜名次（越小越好）——「讨喜」和「专业」都能赢；
 *     并列时**看投票榜**（§2.5 明说），再并列看票数、再看点赞数，最后按 playerId 定序
 *     （扣血需要一个确定的顺序，而回放 / 检查脚本要求同一份输入永远得同一个名次）。
 * ★ 综合名次**不并列**：并列会让 settleRound 的「最后一名 -20」没有唯一解。
 */
export function tallyRound(state: GameState): RoundTally {
  const entries = state.entries.filter((entry) => entry.round === state.round);
  const likeCounts = entries.map((entry) => entry.likedBy.length);
  const voteCounts = entries.map((entry) => entry.votedBy.length);
  /** 竞赛排名：比自己严格更好的有几条，名次就是几 + 1。 */
  const competitionRank = (counts: readonly number[], index: number) =>
    1 + counts.filter((count) => count > counts[index]).length;

  const rows = entries.map((entry, index) => ({
    entry,
    likes: likeCounts[index],
    votes: voteCounts[index],
    likeRank: competitionRank(likeCounts, index),
    voteRank: competitionRank(voteCounts, index),
  }));
  const byPlayerId = (a: { entry: RoundEntry }, b: { entry: RoundEntry }) =>
    a.entry.playerId < b.entry.playerId ? -1 : a.entry.playerId > b.entry.playerId ? 1 : 0;

  const ranked = [...rows].sort(
    (a, b) =>
      a.likeRank + a.voteRank - (b.likeRank + b.voteRank) ||
      a.voteRank - b.voteRank ||
      b.votes - a.votes ||
      b.likes - a.likes ||
      byPlayerId(a, b),
  );
  const tallies: EntryTally[] = ranked.map((row, index) => ({
    entryId: row.entry.id,
    playerId: row.entry.playerId,
    likes: row.likes,
    votes: row.votes,
    likeRank: row.likeRank,
    voteRank: row.voteRank,
    score: row.likeRank + row.voteRank,
    rank: index + 1,
  }));

  const likeBoard = [...rows].sort((a, b) => b.likes - a.likes || b.votes - a.votes || byPlayerId(a, b));
  const voteBoard = [...rows].sort((a, b) => b.votes - a.votes || b.likes - a.likes || byPlayerId(a, b));

  return {
    round: state.round,
    entries: tallies,
    ranking: tallies.map((entry) => entry.playerId),
    likeBoard: likeBoard.map((row) => row.entry.id),
    voteBoard: voteBoard.map((row) => row.entry.id),
  };
}

/**
 * §2.0 ⑤：**从本期真的投出来的名次**结算 —— 榜单在 rules 里算、扣血也在 rules 里扣，
 * 界面 / store 不需要（也不许）自己拼一个名次递给 settleRound。
 * ★ 闸：全员表过态（投过或弃权）才准结算；否则回 votes-pending（少一个人这一期的榜就不完整）。
 */
export function settleRoundFromVotes(state: GameState, rng: Rng): RoundResult {
  if (state.phase !== "voting") return reject("wrong-phase");
  const pending = votesPendingOf(state);
  if (pending.length > 0) {
    return reject("votes-pending", { count: pending.length, cap: alivePlayers(state).length });
  }
  const tally = tallyRound(state);
  const settled = settleRound(state, tally.ranking, rng);
  if (!settled.ok) return settled;
  return { ok: true, state: settled.state, summary: settled.summary, tally };
}
