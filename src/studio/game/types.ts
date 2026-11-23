/**
 * 工坊「一局」的数据形状（G2 第一块：游戏规则引擎与数据模型）。
 *
 * ★ 这里只有形状、没有行为：所有改法在 ./rules.ts。分开放是因为 G3 的回合循环、G4 的出片翻译层、
 *   G5 的服务端房间都要认同一份状态形状，而它们不该被拖进规则实现里。
 * ★ 零运行时依赖：rules.ts 只 `import type` 这里的类型 —— Node 直接剥类型就能 import 它跑
 *   scripts/check-game-rules.mjs 的正反例（与 data/cutProject.ts 同一条理由：规则只有一份实现，
 *   检查脚本 import 的就是线上那一份，不在脚本里重写）。
 * ★ 出处：docs/workshop-game-design.md §2.1（卡牌与背包）/ §2.2（风格卡）/ §2.3（商店与经济）/
 *   §2.3b（事件）/ §2.5（展映投票与扣血）；§5 的待拍板项取默认值（4 人、8 回合、
 *   第 2/4/6 回合后各一次事件、模型最高 L3）。
 * ★ 规则层不接 UI、不接生成：没有 React / three / store，也没有一句界面文案。展示名先给英文占位，
 *   中文文案等 G2 界面那一步走 Lingui（check-i18n 的棘轮拦新增中文字面量，纯规则模块不引 @lingui）。
 */

/** 卡牌种类：§2.1 角色 / 场景 / 道具。 */
export type CardType = "role" | "scene" | "item";

/** 品质：§2.1 白/绿/蓝/紫/金 = 1/2/3/4/5 金币。★ 同时是买价（rules.cardPrice）与权重表的列。 */
export type CardQuality = 1 | 2 | 3 | 4 | 5;

export interface GameCard {
  /**
   * 卡**实例** id。同一张目录卡在同一局里可以被刷出来两次、买两次：背包里两张同名卡靠这个 id 区分，
   * 装备 / 卖出 / 替换也都按它认（rules 里 `#序号` 由 GameState.cardSerial 递增，见 drawCard）。
   */
  id: string;
  type: CardType;
  quality: CardQuality;
  /** 展示名：G2 占位英文名，界面接上时用 id / 卡面素材替换（不在这层写中文文案）。 */
  name: string;
}

/**
 * G4：3D 桌面上的 5 个卡位 —— 4 个角色位一排 + 1 个场景位（docs/g4-ui-revamp-spec.md §2）。
 * ★ G4 第 3 步起它是**真的状态**（不再是"按背包顺序派生"）：拖上桌的卡从 `bag` 里拿出来放进这里，
 *   拖回背包就是反过来。两处不重复存同一张卡 —— 否则"卖掉一张"与"桌上摆着的一张"会各说各的，
 *   而出片提示词读的是桌上那一份（零报错、画面里少一个人）。
 * ★ 读一律走 rules.tableSlotsOf（补空位）——别在界面里自己 `player.table.roles[3]` 然后踩到 undefined。
 */
export interface TableSlots {
  /** 4 个角色位，从左到右；null = 空位 */
  roles: (GameCard | null)[];
  /** 1 个场景位（角色排左上方、桌面中线玩家这一侧）；null = 空位 */
  scene: GameCard | null;
}

/** 桌上的一个卡位（拖拽落点 / 回背包 / 道具拖上去的认法）。规则层 `placeCardOnTable` 认它 */
export type TableSlot = { kind: "role"; index: number } | { kind: "scene" };

/**
 * 游戏内生成档位（§2.3 ★ / §2.3b 模型升级线）。
 * ★ 只回答「游戏内这一发按什么档位出」，**不动玩家自己的 token 钱包**（§2.3b 最后一条），
 *   也不认识 data/videoTierTable —— 两边用 id 对齐是 G4 翻译层的事，规则层不引 data。
 */
export type ModelLevel = 1 | 2 | 3;

export interface GameGenerationTier {
  level: ModelLevel;
  tier: "draft" | "hd" | "cinema";
  resolution: "480p" | "720p" | "1080p";
}

/**
 * 一期作品（§2.4 创作 / §2.5 展映投票）—— G3 是一条**占位视频**：三张卡 + 一句提示词 + 固定 5 秒。
 * ★ 存卡的**本身**而不是 id：展映排片要读卡名与品质（AI 投票按品质加权），而回合内这些卡是锁住的
 *   （rules 只在 shop 阶段允许卖 / 换），所以快照就是当时的真相；G4 接真出片时这一份正好是生成契约的输入。
 * ★ 点赞 / 投票落在作品上（`likedBy` / `votedBy` 里是 playerId）：§2.5「一回合给同一条只能点一次」、
 *   「不能投自己」都由 rules.likeEntry / voteEntry 判，界面不自己数。
 */
export interface RoundEntry {
  /** 稳定 id：`r<回合>-<playerId>`（rules.roundEntryId）。点赞 / 投票 / 报告都认它，不靠数组下标。 */
  id: string;
  round: number;
  playerId: string;
  /** 三个虚框里放进去的卡：角色 / 场景 / 道具各最多一张；一张都没放 = 空镜（照样能交片，见 rules）。 */
  cards: GameCard[];
  prompt: string;
  /** 出片时锁死的风格（§2.2）；null = 这个玩家没选（坏状态，界面照 null 判）。 */
  styleCardId: string | null;
  /** 占位视频时长（秒）：G3 固定 rules.VIDEO_SECONDS；G4 由生成契约给（真出片那一发实测的时长）。 */
  seconds: number;
  /**
   * G4 第 3 步：这一期**真的出片了**的那一刻的成片地址（http(s) / blob）。
   * ★ 没有它 = 没出片（空镜、或者玩家没花这笔钱）：展映屏照旧按占位色块播 seconds 秒，
   *   而不是塞一个空地址给 <video>（那会是一块黑，见 flowStore.isRealVideoUrl 的 ★）。
   */
  videoUrl?: string;
  /** 点过赞的人（每人对同一条只能一次；**自己也可以点** —— 见 rules.likeEntry 的 ★）。 */
  likedBy: string[];
  /** 投给它的人（一人一票、不能投自己；弃权的人不在这里，见 GameState.abstained）。 */
  votedBy: string[];
}

/** 一期的单条作品在榜单上的位置（rules.tallyRound 产出；规则层只给数，话在界面）。 */
export interface EntryTally {
  entryId: string;
  playerId: string;
  likes: number;
  votes: number;
  /**
   * 点赞榜名次：**并列同名次**（2,2,1 → 1,1,3）。§2.5 的胜负口径是「两个榜的名次相加」，
   * 并列就该拿同一个名次 —— 拿不并列的序位，"并列看投票"这条就永远轮不到投票说话了。
   */
  likeRank: number;
  voteRank: number;
  /** 胜负口径 = likeRank + voteRank（越小越好）。 */
  score: number;
  /** 综合名次（1 = 第一，**不并列**）：扣血需要一个确定的顺序，见 rules.tallyRound 的并列规则。 */
  rank: number;
}

/** 一期的两个榜 + 综合名次（§2.5）；rules.settleRoundFromVotes 会把它连同结算摘要一起交出来。 */
export interface RoundTally {
  round: number;
  /** 综合名次：从好到差。 */
  entries: EntryTally[];
  /** 结算要的名次（playerId 从好到差）—— 与 entries 同序。 */
  ranking: string[];
  /** 点赞榜 / 投票榜（entryId，从多到少；同分看另一个榜，再同按 playerId 定序）。 */
  likeBoard: string[];
  voteBoard: string[];
}

/**
 * 一局的阶段（§2.0 的形状）。
 *   style   → 开局选风格卡（3 选 1）
 *   ready   → 全员选完，等 beginRound 开第一回合商店
 *   shop    → 买卡 / 卖卡 / 装备 / 刷新（§2.0 ①）
 *   create  → 创作阶段（G4）
 *   screening → 展映（§2.5）
 *   voting  → 投票（§2.5）
 *   event   → 事件三选一（§2.3b；只在第 2/4/6 回合结算后出现）
 *   round-end → 本期收尾，等 beginRound 进下一回合
 *   over    → 本局结束（剩下 ≤2 人或打满 §5 默认的 8 回合）
 * ★ phase 是**唯一的开关**：卖卡 / 装备只准在 shop 阶段（创作阶段背包锁住，否则正在出片的那一段
 *   会引用一张被卖掉 / 被换掉的卡），查 phase 的地方一律回 "wrong-phase"、不静默放过。
 */
export type GamePhase = "style" | "ready" | "shop" | "create" | "screening" | "voting" | "event" | "round-end" | "over";

/**
 * 注入的随机源：返回 [0, 1) 的数。
 * ★ 规则层**不碰 Math.random**：同一 seed 能复盘一局（对局出 bug 时把 seed 和操作回放一遍就能重现），
 *   check 脚本也能把「抽 5 张 / 抽 3 张风格卡 / 事件不重样」写成确定性用例。
 */
export type Rng = () => number;

/** 装备关系：一件道具挂在一个角色上（§2.1「道具卡只能在右边栏拖到角色卡上」）。 */
export interface EquippedItem {
  roleCardId: string;
  item: GameCard;
}

/**
 * 事件 / 卡挂出来的增益（§2.3b 三个示例事件里那几种「下一回合 / 本回合」的效果）。
 * ★ 每一格都由 rules.applyEventEffects 写、rules 里的 getter 读；界面不自己解释这些字段。
 */
export interface GameBuffs {
  /** 下一回合出片费减半（模型军备 5 金那一项）。用完即清。 */
  nextRoundCostHalf: boolean;
  /** 下一回合能出几段（灵感爆发 6 金给 2；缺省 1）。用完即清。 */
  nextRoundSegments: number;
  /** 本回合提示词上限加成（%，灵感爆发 3 金给 50）。用完即清。 */
  promptLimitPct: number;
  /** 免费刷新券张数（补给站免费项 ×2）。★ 不过期：买了就是你的。 */
  freeRefreshes: number;
}

export interface GamePlayer {
  id: string;
  /** §2.1：100 血起跑。0 = 淘汰（结算里夹到 0，不出现负数）。 */
  hp: number;
  gold: number;
  /** §2.3 连胜 / 连败，两个计数互斥（rules.updateStreak 一处维护），收入按两者里高的那档给。 */
  winStreak: number;
  loseStreak: number;
  /**
   * 背包：**没摆到桌上的**卡（角色卡 / 场景卡 / 道具卡都在这儿）。
   * ★ G4 第 3 步起背包**不再有 9 格总量、也不再按种类数上限**（施工单 §3：那套以桌面卡位为准）——
   *   角色卡与场景卡的上限落在桌面 5 个卡位上，道具的上限落在"每个角色最多 3 张"上。
   *   所以这里是一份"手上的卡"，界面按用途分两处显示：底部条 = 角色 / 场景，右侧栏 = 道具。
   */
  bag: GameCard[];
  /** 装备关系：一张角色卡可以挂多张道具（上限 rules.itemLimitOf，缺省 3 张）。 */
  equipment: EquippedItem[];
  /** 桌面 5 个卡位（4 角色 + 1 场景）：摆上去的卡**不在 bag 里**，见 TableSlots 的 ★。 */
  table: TableSlots;
  /** 事件给的道具上限加成（补给站 5 金：每角色 3→4 张）。基数在 rules.ITEMS_PER_ROLE，别存绝对上限。 */
  itemLimitBonus: number;
  /** 开局三选一定下来之后锁死（§2.2「选定后整局所有出片都带这套风格」）；null = 还没选。 */
  styleCardId: string | null;
  /** 开局抽到的那 3 张风格卡 id：抽到即固定，不许重抽（§2.2 只给 3 张）。 */
  styleChoices: string[];
  /** §2.3 ★ 开局全员 L1（草稿 480p）；升级只改这一格（整局保留）。 */
  modelLevel: ModelLevel;
  /** hp 归零标记（§2.5）。淘汰的人不再进收入 / 商店 / 事件，也不会回到存活名单。 */
  eliminated: boolean;
  buffs: GameBuffs;
}

export interface ShopState {
  /** 固定 5 格（§2.3）。买走的那一格是 null —— 保持 5 格，界面要显示空位、别把数组压短。 */
  cards: (GameCard | null)[];
  /** §2.3：锁定 = 本回合不自动刷新，免费；手动刷新照样可以。 */
  locked: boolean;
}

/** 风格卡（§2.2）：技法名词 × 题材 + 一张离线样张。 */
export interface StyleCard {
  id: string;
  /** 技法的专业名词（§2.2 表格第一列）。 */
  technique: string;
  /** 题材（§2.2 表格第二列）。 */
  topic: string;
  /** ★ 样张文件名（§2.2「每张风格卡必须带预览图」）：public/styles/<id>.webp，离线打进包、不实时生成。 */
  sample: string;
}

/**
 * 事件选项的收益。**结构化、不带文案**：界面按这些字段自己拼「花 8 金升到 720p」这类句子，
 * 规则层只负责改数（§2.3b「事件卡面也带小图与一句话收益说明」—— 那句话是 UI 的事）。
 */
export type EventEffect =
  | { kind: "gold"; delta: number }
  | { kind: "hp"; delta: number }
  | { kind: "model-level"; to: ModelLevel }
  | { kind: "next-round-cost-half" }
  | { kind: "next-round-segments"; value: number }
  | { kind: "prompt-limit-pct"; pct: number }
  /**
   * 每张角色卡能挂的道具上限 +N（补给站 5 金）。
   * ★ G4 第 3 步之前这里是「背包某一类卡上限 +1」（角色 4→5）：那套按种类计数的上限已随施工单 §3
   *   撤掉（上限落在桌面卡位上，桌面只有 4 个角色位），再留一个"角色上限 +1"就是一条改不动的数。
   *   改挂在**仍然有上限**的那一格上（道具 / 每角色），事件仍然给得出一份有用的加成。
   */
  | { kind: "item-limit"; delta: number }
  | { kind: "free-refresh"; count: number }
  /** 随机一张指定品质的卡（灵感爆发免费项：随机一张蓝卡），进背包（满了会整项失败，不静默丢卡）。 */
  | { kind: "random-card"; quality: CardQuality };

export interface GameEventOption {
  /** 事件内唯一（"upgrade-draft" / "free-gold" …），存档与回执认它。 */
  id: string;
  /** 金币花费，0 = 免费（§2.3b：三选一里永远有一个免费兜底）。 */
  cost: number;
  effects: readonly EventEffect[];
}

export interface GameEvent {
  id: string;
  /** 事件卡面小图（§2.3b ★）：public/events/<id>.webp，离线打进包。 */
  art: string;
  /** 3 个选项（§2.3b 表格；模型军备的 L2/L3 两条升级线按档位与连胜只出一条，见 rules.optionsForPlayer）。 */
  options: readonly GameEventOption[];
}

/** 连胜 / 连败的判定结果；none = 本期被淘汰的人（不再算连胜也不再算连败）。 */
export type StreakOutcome = "win" | "lose" | "none";

/** 结算摘要里一个人的掉血（§2.5）。 */
export interface DamageEntry {
  playerId: string;
  /** 1 = 本期第一名（名次从好到差；扣血按倒数位置算）。 */
  rank: number;
  damage: number;
  hpBefore: number;
  hpAfter: number;
  /** 这一期被打到 0、当场淘汰。 */
  eliminated: boolean;
}

export interface StreakEntry {
  playerId: string;
  outcome: StreakOutcome;
  winStreak: number;
  loseStreak: number;
}

/**
 * 本期结算摘要（§2.5）：谁扣了几滴、谁被淘汰、剩谁、有没有胜者。
 * ★ 规则层只回事实，不拼「他只剩 5 滴血了」这种话（界面拼；check 脚本按这些字段断言）。
 */
export interface RoundSettlement {
  round: number;
  /** 本期名次，从好到差（调用方传进来的那份，已校验过与存活名单一致）。 */
  ranking: string[];
  /** 按名次排好序（rank 1 在前）。 */
  damages: DamageEntry[];
  /** 本期新淘汰的人（按名次）。 */
  eliminated: string[];
  /** 本期结束还活着的人（按名次）。 */
  alive: string[];
  /** 本期结束时的胜者：剩下 ≤2 人时给；打满 8 回合给血最多的两名；否则空数组。 */
  winners: string[];
  streaks: StreakEntry[];
}

export interface GameState {
  /** 1 起。第 2/4/6 回合结算后出事件（§2.3b / §5-7 默认值）。 */
  round: number;
  phase: GamePhase;
  players: GamePlayer[];
  /**
   * 本局的**开局**档位（§2.3 ★ 所有人开局都是最低档 480p）。
   * ★ 真正会升的是 `GamePlayer.modelLevel`（事件按人升）；这里只记大厅默认值，
   *   给「新玩家入座 / 回放标注」用。不做双向同步 —— 两处互相推导就是第二处实现（CLAUDE.md 铁律六）。
   */
  modelLevel: ModelLevel;
  /** 每人的商店（TFT 同款各自一份，不是共享卡池 —— 我们这个游戏暂时不需要抢卡）。 */
  shops: Record<string, ShopState>;
  /**
   * 本期的作品（§2.0 ③④）：每个存活玩家一条，创作阶段交片、展映 / 投票阶段被点赞与投票。
   * ★ beginRound 换回合时清空（那时结算摘要已经交到界面那一层，作品只在"本期"有意义）。
   */
  entries: RoundEntry[];
  /**
   * 本期投票阶段弃权的人（§2.5「可弃权」）。一人一票：投过的人不在这个名单里，
   * 「全员表态完毕」= 每个人要么在某个 entry.votedBy 里、要么在这里（rules.votesPendingOf）。
   */
  abstained: string[];
  /**
   * 上一期的综合名次（从好到差，结算那一刻由 settleRound 记下）。
   * ★ §2.5「展映按上一回合综合排名倒序播放（落后先放）」读的就是它 —— 排序规则在
   *   rules.screeningOrderOf 一处，界面不自己排。
   */
  lastRanking: string[];
  /** 已经抽过的事件 id（§2.3b「一局里的 3~4 次事件从池子里不重样地抽」）。 */
  drawnEventIds: string[];
  /** 本期抽到的事件（phase === "event" 时非空；beginRound 会清掉）。 */
  currentEventId: string | null;
  /** phase === "event" 时谁已经选过（playerId → optionId）；全员选完才进 round-end。 */
  eventPicks: Record<string, string>;
  /**
   * 商店卡实例的流水号（见 GameCard.id 的注释）：同一张目录卡买两次要有两个 id。
   * ★ 放在 state 里而不是模块级计数器：模块级的计数器活过「新开一局」，回放 / 测试就对不上了。
   */
  cardSerial: number;
}
