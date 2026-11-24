/**
 * 一局对局的全部状态（G2 第二块起的门面；G3 把回合循环接上；G4 第 3 步接摆卡与出片）。
 *
 * ★ 为什么单开一个 store（不塞进 StudioPage 的 useState、也不塞进 studioStore）：
 *   · 工坊里切到画布浮层、去挂卡页再回来，这一页会整个重挂 —— 局部 state 归零，一局的钱与卡就没了；
 *   · G3 的回合循环 / G4 的出片翻译层 / G5 的房间同步要认同一份 GameState，放在页面里它们够不着。
 * ★★ 这一层**不写一条规则**（铁律六）：每个动作只做三件事 —— 把当前 state 递给 rules 里的同名函数、
 *   把成功结果写回、把失败原因（RuleFailure）原样留下来交给界面说人话（铁律八：不静默失败）。
 *   金币 / 利息 / 桌面卡位 / 每角色 3 张道具 / 风格锁死 / 商店刷新与锁定的语义全部在 rules；
 *   交片 / 点赞 / 投票 / 榜单 / 扣血也在 rules；"一局怎么走"（AI 陪玩的那几步）在 phases。
 *   这里连一个 `if (gold >= price)` 都不许出现。
 * ★ G4 第 3 步起这一层还多扛一件事：**拖拽手势的状态**（`drag`）。它必须住在 store 而不是组件里 ——
 *   拖动的起点在 2D 背包条 / 右侧道具栏（DOM），落点可能是 3D 桌面上的五个卡位（canvas 里的投影），
 *   而 3D 那一侧要按同一个"现在正拖着什么、悬在哪一格"高亮（scene/TableScene 的 SlotPlate）。
 *   两处各自 useState 就会一边亮一边不亮（屏幕上最像"拖坏了"的那种症状）。
 * ★ 单机版：本地玩家叫 "me"，另外 3 个是 AI 陪玩。AI 的行为在 game/bots.ts（纯函数），
 *   编排在 game/phases.ts（纯函数），两边都能在脚本里整局跑（scripts/check-game-bots.mjs）。
 * ★ 随机源住模块作用域（不进 state）：一局的 rng 是一个**有位置的序列**，放进 zustand 状态里会被
 *   devtools / 持久化那类东西当成普通字段；而它必须与 seed 一一对应才能复盘（rules.createRng 的 ★）。
 */
import { create } from "zustand";
import {
  buyShopCard,
  cardSellValue,
  createRng,
  equipItem,
  likeEntry,
  pickStyleCard,
  placeOnTable,
  refreshShop,
  returnToBag,
  sellCard,
  skipEventChoice,
  START_HP,
  submitRoundEntry,
  toggleShopLock,
  unequipAll,
  voteEntry,
  abstainVote,
  applyEventChoice,
  applyOnlineEventChoice,
  settleRoundFromVotes,
  winnersOf,
  type OnlineEventChoice,
  type RuleFailure,
  type StateResult,
} from "./rules";
import {
  aiEventChoices,
  beginOnlineRound as beginOnlineRoundPhases,
  fillLocalOpponents,
  onlineEventPhase,
  onlinePhaseTo,
  openRound,
  playOutAiOnly,
  resumeOnlineRound as resumeOnlineRoundPhases,
  startMatch,
  toCreation,
  toScreening,
  toVoting,
} from "./phases";
import { aiPromptPool } from "./labels";
import { modelUpgradeGate } from "./genTier";
// 座位 id 与人数换算在 lobby.ts（大厅和这一层认同一份：大厅给几个座位、这里就开几个人的局）
import { LOCAL_SEAT_ID, seatIdsFor } from "./lobby";
import type { RemoteSettlement, RemoteWinner } from "../../api/game/rounds";
import type { GameCard, GameState, RoundSettlement, RoundTally, Rng, TableSlot } from "./types";

/**
 * 本地玩家的座位 id（单机版的"我"；G5 联机时换成服务端下发的 playerId）。
 * ★ 值本身在 lobby.LOCAL_SEAT_ID：大厅、房间成员表、这一层是同一个"我" —— 三处各写一个字面量
 *   就是三个会漂的值（联机换成服务端 id 时更是一改三处漏两处）。这里留个名字是为了 README / 旧代码可读。
 */
export const LOCAL_PLAYER_ID = LOCAL_SEAT_ID;

/**
 * 这一局对手的 id（= 除我之外的全部座位）。4 人桌 3 个、8 人桌 7 个、2 人桌 1 个。
 * ★ 从 state 里**现算**而不是存一份常量：人数由大厅决定（4 人匹配 / 8 人匹配 / 自定义房间 2~8），
 *   存常量就得再维护一份"当前这一局几个 AI"，两处一对不上就是"少了两个对手在买卡"。
 * ★ 顺序 = 座位表的顺序（建局时给的，见 lobby.seatIdsFor）：AI 的每一步都按这个顺序走，
 *   同一 seed 才能复盘。
 */
function aiIdsOf(state: GameState): string[] {
  return state.players.filter((player) => player.id !== LOCAL_PLAYER_ID).map((player) => player.id);
}

/** 动作成功后那条轻提示的**种类**（不带文案：文案在界面里按语言拼，见 ui/GameLayer） */
export type GameNoticeKind =
  | "bought"
  | "sold"
  | "placed"
  | "returned"
  | "equipped"
  | "unequipped"
  | "refreshed"
  | "locked"
  | "unlocked"
  // G3：创作 / 展映 / 投票那几下
  | "entry-saved"
  | "generated"
  | "liked"
  | "voted"
  | "abstained"
  // 联机回合：交片已经交给服务端（任务点名要显式说"已交片，等其他人"）
  | "online-submitted";

export interface GameNotice {
  kind: GameNoticeKind;
  /** 同一个动作连按两次也要重新播一遍动画（组件拿它当 key） */
  at: number;
  /** 卖卡回的钱（rules.cardSellValue —— 界面不自己算） */
  gold?: number;
}

/** 规则拒绝的那一下：原因原样留着，界面用 reasons.ruleFailureText 说成人话 */
export interface GameRejection {
  failure: RuleFailure;
  at: number;
}

/**
 * 正在拖的东西（G4 第 3 步）。
 *   place  = 从背包条拖一张角色 / 场景卡 → 桌面卡位
 *   equip  = 从右侧道具栏拖一张道具 → 某张角色卡
 *   remove = 右侧道具栏的拆除工具 → 某张角色卡（一次卸下它身上的全部道具）
 *   return = 从桌面卡位拖一张已经摆好的卡 → 拖回背包（或拖到别的卡位上换位）
 * ★ `hover` 是"现在悬在哪一格"：3D 卡位靠它高亮，落点判定也只认它（松手那一刻不再重算，
 *   屏幕上亮着哪一格就落在哪一格 —— 否则手指抬起前的一两像素抖动会落到旁边的位子上）。
 */
export interface GameDragState {
  kind: "place" | "equip" | "remove" | "return";
  /** 拖的是哪张卡（remove 没有卡：拆除工具不是卡） */
  cardId: string | null;
  /** 桌面上的悬停卡位；null = 没悬在任何一格上 */
  hover: TableSlot | null;
}

/** 上一期的结算摘要 + 两个榜（结算 / 事件 / 对局结束那几屏读它）。 */
export interface RoundReport {
  summary: RoundSettlement;
  tally: RoundTally;
}

/**
 * 这一局是不是"从服务端房间开出来的"（联机回合）。
 * ★ 只记**开局那一刻**从大厅/DOM 接过的事实：房间码、我是哪个服务端账号、我是不是房主、开局时我的血。
 *   之后的回合事实（entries / 点赞 / 投票 / 结算）全在 `roundsStore`，这一层不重复存 ——
 *   两边各存一份，"榜显示了新 hp、HUD 还是旧 hp"这种漂就是必然的。
 * ★ 单机版这一格恒为 null（协议与流程一个字都没变）。
 */
export interface OnlineGameHandoff {
  roomCode: string;
  /** 服务端账号 id（快照 entries 里的 userId）；不是本机座位的 "me" */
  myUserId: string;
  myName: string;
  isHost: boolean;
  /** 开局时服务端记的血（房间快照 members[].hp；老房间按满血兜底） */
  hp: number;
  eliminated: boolean;
}

export interface GameStore {
  /** null = 没在对局里（工坊照旧，一个新按钮都不多） */
  state: GameState | null;
  meId: string;
  /** 这一局的种子（复盘：startGame(seed) 能重放同一局） */
  seed: number;
  /** 商店面板收起来没有（收起后仍能从背包条那颗键打开） */
  shopOpen: boolean;
  rejection: GameRejection | null;
  notice: GameNotice | null;
  /** 最近一次结算（§2.5）：结算屏 / 事件屏 / 结束屏读它 */
  report: RoundReport | null;
  /** 我在第几回合被淘汰的（结束屏要说"你在第 N 回合出局"）；null = 还活着 */
  eliminatedAtRound: number | null;
  /** 正在拖的东西；null = 没在拖（见 GameDragState 的 ★） */
  drag: GameDragState | null;
  /**
   * 这一期要交的那句提示词（创作面板输入、生成小窗读同一份）。
   * ★ 放 store 而不是组件 state：提示词会被**两处**读（面板上的输入框、生成那一发拼进
   *   node.requirement / plot），生成小窗一开一关就丢一半字符的话，发出去的句子和屏幕上不是同一句。
   */
  createPrompt: string;
  /** 工作流面板（纯预览）开着没有 */
  previewOpen: boolean;
  /**
   * 这一局几个座位（2~8，由大厅定：4 人匹配 / 8 人匹配 / 自定义房间 2~8）。
   * ★ 存着是为了「🔁 再来一局」：restart 要接着开**同样人数**的一局，
   *   不然玩家在 8 人局点再来一次会掉回默认桌（他自己不会知道人数变了）。
   */
  playerCount: number;

  // ── 联机回合（2026-11-24；null = 单机那一套） ──
  /** 这一局从服务端房间开出来的凭据（null = 单机；单机流程一个字段都不读它） */
  online: OnlineGameHandoff | null;
  /** 服务端给的结算（联机时结算屏**只渲染它**，不在本机重算榜 / 扣血） */
  onlineSettlement: RemoteSettlement | null;
  /** 服务端给的胜者；null = 还没结束，[] = 结束但平局 */
  onlineWinners: RemoteWinner[] | null;
  /**
   * 联机局里**事件只在本机生效**（服务端事件能力位为假 / 那一发不可用 → 退回本机事件）。
   * ★ 只有这一条路会置真：界面据此写明「事件只在本机生效」（不假装跨端一致）。
   */
  onlineLocalEvents: boolean;

  /**
   * 开一局。`playerCount` = 大厅给的座位数（缺省沿用上一局，首次是 4）。
   * `online` = 这一局从服务端房间开出来（联机回合）；缺省就是原来那份单机循环。
   * ★ 回 boolean：大厅那一屏要知道"这一局开没开起来"（开不起来就把失败原因留在界面上，
   *   别先把大厅收掉、让玩家对着没开局的桌面猜）。
   */
  startGame: (seed?: number, opts?: { playerCount?: number; online?: OnlineGameHandoff }) => boolean;
  /** 轮询读到服务端新回合（round + 1）→ 本机也开下一回合（收入 + 商店；AI 不在联机里行动） */
  beginOnlineRound: (serverRound: number) => void;
  /**
   * 重连：把本机直接放到服务端**当前回合**的商店（App 被杀 / 刷新之后恢复那一局）。
   * 回 false = 跳不过去（原因已经进 rejection）；调用方（ui/startFromLobby）据此决定要不要继续接。
   */
  resumeOnlineRound: (serverRound: number) => boolean;
  /** 服务端推进到展映 / 投票 → 本机阶段跟着走（本机的全员闸不适用，见 phases.onlinePhaseTo） */
  syncOnlinePhase: (phase: "screening" | "voting") => void;
  /** 服务端结算：写回我的 hp / 淘汰，渲染那一屏；事件按 `eventStart` 走服务端那条还是退回本机 */
  applyOnlineSettlement: (
    settlement: RemoteSettlement,
    winners: RemoteWinner[] | null,
    eventStart?: OnlineEventStart,
  ) => void;
  /** 服务端出题的事件读回来了（比结算晚到一拍）：本机进事件屏（题面在 roundsStore.event） */
  applyOnlineEvent: (start: { round: number; eventId: string }) => void;
  /**
   * 服务端**已经**记下我这一选（`myChoice` 非空，例如中途刷新回来）：本机只补这个表态并收屏。
   * ★ 不重放 `effects.client`：本机那份效果随刷新 / 杀进程一起丢了（金币 / 卡组都是本机事实），
   *   再补一次会与重开后的资源对不上（回血那一半是服务端落库的，不会丢）。
   */
  markOnlineEventChosen: (optionId: string) => void;
  /** 服务端那一发事件不可用：退回本机事件（抽一张 + AI 选掉），并记号「只在本机生效」 */
  fallbackToLocalEvents: () => void;
  /**
   * 落一次联机事件选择：扣 `cost` + 只应用 `effects.client`。
   * ★ hp 不在这里：服务端已经落库，新血量由 `syncOnlineHp` 从房间快照读回来。
   */
  chooseOnlineEvent: (choice: OnlineEventChoice) => void;
  /** 把本机 hp 对齐服务端房间快照里那一份（事件回血由服务端落库） */
  syncOnlineHp: (hp: number) => void;
  /** 这局已经结束（GAME_OVER，含平局）：本机进 over 并把胜者摆出来 */
  markOnlineOver: (winners: RemoteWinner[]) => void;
  /** 回合服务不可用 / 掉线：把这一局接回**现有本机循环**（补齐 AI 这一期的动作，不留半局） */
  fallbackToLocal: () => void;
  /** 交片已经交给服务端（轻提示「已交片，等其他人」） */
  markOnlineSubmitted: () => void;
  endGame: () => void;
  /** 选风格卡：选定后（连同 3 个 AI 的选择）进第一回合商店 */
  pickStyle: (styleCardId: string) => void;
  /** 本地玩家已选、但有人的选择没落完时补一刀（正常路径用不到，见 aiFinishStyle） */
  finishStyle: () => void;
  toggleShop: (open?: boolean) => void;
  buy: (slot: number) => void;
  refresh: () => void;
  toggleLock: () => void;
  sell: (cardId: string) => void;

  // ── 摆卡与装备（G4 第 3 步）──
  beginDrag: (drag: GameDragState) => void;
  hoverSlot: (slot: TableSlot | null) => void;
  /** 松手：按悬停的那一格落地（null = 没悬在任何卡位上，交给各动作自己决定去背包 / 自动占位） */
  endDrag: () => void;
  /** 直接摆一张（不经过拖拽：自动化脚本 / 键盘可达的退路） */
  placeCard: (cardId: string, slot?: TableSlot | null) => void;
  /** 把一个卡位上的卡拖回背包 */
  returnCard: (slot: TableSlot) => void;
  /** 道具装到角色身上（右侧栏拖到角色卡） */
  equipOn: (roleCardId: string, itemCardId: string) => void;
  /** 拆除工具：一次卸下这张角色身上的所有道具 */
  unequipFrom: (roleCardId: string) => void;
  setCreatePrompt: (text: string) => void;
  setPreviewOpen: (open: boolean) => void;
  clearRejection: () => void;

  // ── G3 回合循环 ──
  /** 商店 → 创作（AI 在这一拍把片子交了） */
  enterCreate: () => void;
  /**
   * 交片：用**桌面上的卡**（+ 挂在角色身上的道具）+ 一句提示词。
   * ★ 卡不再由调用方递进来（G4 第 3 步）：一期作品的卡 = rules.castCardsOf(我)，桌面就是"这一期拍什么"。
   * ★ `videoUrl` / `seconds` = 真出片那一发的结果（game/gen 传进来）；没出片就是空镜占位片。
   */
  saveEntry: (patch?: { videoUrl?: string; seconds?: number }) => void;
  /** 创作 → 展映（AI 在这一拍点完赞） */
  enterScreening: () => void;
  /** 展映里给一条点赞（每条一次） */
  like: (entryId: string) => void;
  /** 展映 → 投票（AI 在这一拍投完票） */
  enterVoting: () => void;
  /** 投票（不能投自己，一人一票） */
  vote: (entryId: string) => void;
  /** 弃权（也算表过态） */
  abstain: () => void;
  /** 结算：榜单由 rules 算、扣血由 rules 扣 */
  settle: () => void;
  /** 事件三选一 */
  chooseEvent: (optionId: string) => void;
  /** 这次事件不要了（三选一全落不了账时的出口，见 rules.skipEventChoice） */
  skipEvent: () => void;
  /** 下一回合（发收入 + 刷商店 + AI 买卡） */
  nextRound: () => void;
  /** 再来一局（= 用新种子开一局） */
  restart: () => void;
}

/**
 * 联机结算之后**事件从哪来**（由 ui/useOnlineRounds 现算好递进 store）：
 *   · `server` = 服务端出题（同一房间同一回合同一道题；题面在 roundsStore.event）；
 *   · `local`  = **退回本机事件**（能力位为假 / 接口不可用）—— 界面写明「事件只在本机生效」；
 *   · `none`   = 这一回合没有事件（第 1/3/5… 回合 / 我已被淘汰 / 能力位还没探到）。
 * ★ 为什么是界面算：`roundsStore` 与 `game/store` 互不认识（见 roundsStore 文件头），
 *   而"事件读取的结局"只有界面那一层同时看得见两边。
 */
export type OnlineEventStart =
  | { kind: "server"; round: number; eventId: string }
  | { kind: "local" }
  | { kind: "none" };

/** 这一局的随机源（模块作用域，见文件头 ★） */
let rng: Rng = createRng(1);

/** 新开一局的种子：时间 + 一点随机，够散；复盘时把 seed 记下来即可重放 */
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
}

/**
 * 本地玩家选完之后，替 AI 把风格选完，再开第一回合。
 * ★ AI 的风格与买卡都走 phases / rules（不直接改 styleChoices）：规则里"一人一次 / 只能选自己那三张 /
 *   全员选完才 ready"这三条与真人共用一处，AI 不该有后门。
 * ★ AI 是谁从 state 现算（aiIdsOf）：4 人桌 3 个、8 人桌 7 个 —— 这里不再有一份固定的 AI 名单。
 */
function beginFirstRound(state: GameState): StateResult {
  if (state.phase !== "ready") return { ok: true, state };
  return openRound(state, aiIdsOf(state), rng);
}

export const useGame = create<GameStore>((set, get) => {
  /** 失败统一从这里落地：原因原样留着，界面说人话；轻提示让位给失败 */
  const fail = (failure: RuleFailure) => {
    set({ rejection: { failure, at: Date.now() }, notice: null });
  };
  const done = (patch: Partial<GameStore>) => {
    set({ rejection: null, ...patch });
  };

  /** 卡位比较（角色位按下标、场景位只有一个）：拖拽高亮与落点都认它，别各处自己比字段 */
  const sameSlot = (a: TableSlot | null, b: TableSlot | null): boolean => {
    if (!a || !b) return a === b;
    if (a.kind !== b.kind) return false;
    return a.kind === "scene" || (b.kind === "role" && a.index === b.index);
  };

  /** 这一格上是哪张卡（给"拖回背包 / 拆除工具"认人；空位回 null） */
  const cardAt = (slot: TableSlot): GameCard | null => {
    const state = get().state;
    if (!state) return null;
    const player = state.players.find((p) => p.id === get().meId);
    if (!player) return null;
    const table = player.table;
    if (slot.kind === "scene") return table.scene;
    return table.roles[slot.index] ?? null;
  };

  return {
    state: null,
    meId: LOCAL_PLAYER_ID,
    seed: 0,
    shopOpen: false,
    rejection: null,
    notice: null,
    report: null,
    eliminatedAtRound: null,
    drag: null,
    createPrompt: "",
    previewOpen: false,
    // 还没开过局时的默认桌 = 4 人（§5-1 的默认值；大厅一进来就是 4 人匹配那张卡）
    playerCount: 4,
    online: null,
    onlineSettlement: null,
    onlineWinners: null,
    onlineLocalEvents: false,

    startGame: (seed, opts) => {
      const nextSeed = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : freshSeed();
      // 人数由大厅给（2~8，rules.MIN_PLAYERS~MAX_PLAYERS 里夹一道）：座位表与 AI 名单同一处算
      //（lobby.seatIdsFor），这里不另拼一份 id 数组。
      const playerCount = typeof opts?.playerCount === "number" && Number.isFinite(opts.playerCount) ? opts.playerCount : get().playerCount;
      const seats = seatIdsFor(playerCount);
      // 开局用**同一个** rng：抽风格卡、AI 选风格、之后的商店 / 事件 / 随机卡都接着这条序列走
      // （两处各 createRng(seed) 会抽出一模一样的序列，复盘就对不上了）。
      const r = createRng(nextSeed);
      const started = startMatch(seats, seats.slice(1), r);
      rng = r;
      if (!started.ok) {
        fail(started);
        return false;
      }
      let state = started.state;
      const online = opts?.online ?? null;
      if (online) {
        // 开局血用**服务端快照里的那一份**（房间可能已经打过几回合？今天不会，但接进同一份口径最省事）。
        // 夹 0~START_HP：服务端记的血不会超出这个范围，本地 HUD 按 100 归一画条。
        const hp = Math.max(0, Math.min(START_HP, Math.floor(online.hp)));
        state = {
          ...state,
          players: state.players.map((player) =>
            player.id === LOCAL_PLAYER_ID ? { ...player, hp, eliminated: online.eliminated || hp <= 0 } : player,
          ),
        };
      }
      set({
        state,
        seed: nextSeed,
        playerCount: seats.length,
        shopOpen: false,
        rejection: null,
        notice: null,
        report: null,
        eliminatedAtRound: online?.eliminated ? 1 : null,
        drag: null,
        createPrompt: "",
        previewOpen: false,
        online,
        onlineSettlement: null,
        onlineWinners: null,
        onlineLocalEvents: false,
      });
      return true;
    },

    endGame: () => {
      rng = createRng(1);
      set({
        state: null,
        seed: 0,
        shopOpen: false,
        rejection: null,
        notice: null,
        report: null,
        eliminatedAtRound: null,
        drag: null,
        createPrompt: "",
        previewOpen: false,
        online: null,
        onlineSettlement: null,
        onlineWinners: null,
        onlineLocalEvents: false,
      });
    },

    // ─────────────────────────── 联机回合（服务端是真相） ───────────────────────────
    // ★ 这一节只做两件事：把服务端推来的阶段 / 回合写进本机状态（单机 rules 的闸不在这里重跑），
    //   以及把服务端的 hp / 结算原样摆给界面。**一个名次、一滴血都不重算**（任务：榜与扣血只渲染服务端回包）。

    beginOnlineRound: (serverRound) => {
      const { state, online } = get();
      if (!state || !online) return;
      const opened = beginOnlineRoundPhases(state, serverRound, rng);
      if (!opened.ok) {
        fail(opened);
        return;
      }
      if (opened.state === state) return;
      done({ state: opened.state, shopOpen: true, onlineSettlement: null, onlineWinners: null, drag: null });
    },

    resumeOnlineRound: (serverRound) => {
      const { state, online } = get();
      if (!state || !online) return false;
      const jumped = resumeOnlineRoundPhases(state, serverRound, rng);
      if (!jumped.ok) {
        fail(jumped);
        return false;
      }
      if (jumped.state === state) return true;
      done({ state: jumped.state, shopOpen: true, drag: null });
      return true;
    },

    syncOnlinePhase: (phase) => {
      const { state, online } = get();
      if (!state || !online) return;
      const next = onlinePhaseTo(state, phase);
      if (next === state) return;
      // 阶段是服务端推的：本机的 entries / spoken 闸不适用（联机版的全员 = 服务端房间成员）
      set({ state: next, shopOpen: false, drag: null });
    },

    applyOnlineSettlement: (settlement, winners, eventStart) => {
      const { state, online } = get();
      if (!state || !online) return;
      const myRow = settlement.ranking.find((row) => row.userId === online.myUserId);
      const meBefore = state.players.find((player) => player.id === LOCAL_PLAYER_ID);
      const players = myRow
        ? state.players.map((player) =>
            player.id === LOCAL_PLAYER_ID
              ? { ...player, hp: Math.max(0, Math.min(START_HP, Math.floor(myRow.hp))), eliminated: myRow.eliminated }
              : player,
          )
        : state.players;
      const over = winners !== null;
      // ★ 事件从哪来由界面算好递进来（OnlineEventStart，判据在 roundsStore 的事件读取结局）：
      //   server = 服务端出题（同一房间同一回合同一道题）、local = 退回本机事件、none = 这回合没有事件。
      const start: OnlineEventStart = eventStart ?? { kind: "none" };
      let next: GameState = {
        ...state,
        players,
        phase: over ? "over" : "round-end",
        // 上一期的事件已经消费掉（单机那一路在 settleRound 里清；联机这一路从来不经它）
        ...(over ? {} : { currentEventId: null, eventPicks: {} }),
      };
      let localEvents = false;
      if (!over) {
        // 我这一期被淘汰就不弹事件了 —— 后面的回合已经跟我无关。
        const eliminatedNow = myRow ? myRow.eliminated : (meBefore?.eliminated ?? false);
        if (!eliminatedNow && start.kind === "server") {
          // ★ 服务端出题：**不在本机抽**（各抽各的就会两端不是同一道题）。本机只把这一屏切到事件，
          //   题面（title / options / myChoice / allChosen）在 roundsStore.event，由 ui/OnlineEventPanel 渲染。
          next = { ...next, phase: "event", currentEventId: start.eventId, eventPicks: {} };
        } else if (!eliminatedNow && start.kind === "local") {
          // 退回本机事件（能力位为假 / 接口不可用）：抽一张 + AI 选掉，剩下真人那一屏。
          // ★ 界面必须写明「事件只在本机生效」（onlineLocalEvents）—— 它影响不到别人，hp 也不回写服务端。
          const evented = onlineEventPhase(next, aiIdsOf(next), rng);
          if (!evented.ok) {
            fail(evented);
            return;
          }
          next = evented.state;
          localEvents = true;
        }
      }
      done({
        state: next,
        onlineSettlement: settlement,
        onlineWinners: winners,
        onlineLocalEvents: localEvents,
        eliminatedAtRound: myRow?.eliminated ? state.round : get().eliminatedAtRound,
        shopOpen: false,
        drag: null,
        report: null,
      });
    },

    applyOnlineEvent: ({ round, eventId }) => {
      const { state, online } = get();
      if (!state || !online) return;
      // 只认这一回合、且还停在结算屏：读事件回来时回合可能已经翻篇（房主点了下一回合）
      if (state.phase !== "round-end" || state.round !== round) return;
      const me = state.players.find((player) => player.id === get().meId);
      if (me?.eliminated) return;
      set({
        state: { ...state, phase: "event", currentEventId: eventId, eventPicks: {} },
        onlineLocalEvents: false,
        shopOpen: false,
        drag: null,
      });
    },

    fallbackToLocalEvents: () => {
      const { state, online } = get();
      if (!state || !online) return;
      // 只在"结算屏还停着、我还在打"时补：已经进了下一回合 / 已结束 / 已淘汰都不该再弹
      if (state.phase !== "round-end") return;
      const me = state.players.find((player) => player.id === get().meId);
      if (me?.eliminated) return;
      const evented = onlineEventPhase(state, aiIdsOf(state), rng);
      if (!evented.ok) {
        fail(evented);
        return;
      }
      done({ state: evented.state, onlineLocalEvents: evented.state.phase === "event" });
    },

    chooseOnlineEvent: (choice) => {
      const { state, meId } = get();
      if (!state) return;
      // gate 与"摆哪些选项"那一次同一个（免费账号升不了档；服务端不知道套餐，筛与判都在本机）
      const chosen = applyOnlineEventChoice(state, meId, choice, rng, modelUpgradeGate());
      if (!chosen.ok) {
        fail(chosen);
        return;
      }
      done({ state: chosen.state, onlineLocalEvents: false });
      // 选择已经记下（服务端那一份也是），但某条 client 效果没落上（罕见：随机卡把背包撑破）：
      // 状态照常前进，原因说出来 —— 不整项回滚（回滚会跟服务端各说各话）。
      if (chosen.effectFailure) fail(chosen.effectFailure);
    },

    markOnlineEventChosen: (optionId) => {
      const { state, online, meId } = get();
      if (!state || !online) return;
      if (state.phase !== "event") return;
      if (state.eventPicks[meId] !== undefined) return;
      const me = state.players.find((player) => player.id === meId);
      if (!me || me.eliminated) return;
      // ★ 服务端已经记下这一选（幂等、第一选作数）：本机只补这个表态并收屏（回结算屏/阶段条），
      //   **不重放 client 效果**（理由见接口注释）；hp 那一半服务端早就落了，下一拍从房间快照对齐。
      set({
        state: { ...state, eventPicks: { ...state.eventPicks, [meId]: optionId }, phase: "round-end" },
        drag: null,
      });
    },

    syncOnlineHp: (hp) => {
      const { state, online, onlineLocalEvents, meId } = get();
      if (!state || !online) return;
      // 本机事件那条路（onlineLocalEvents）下 hp 是本地事实（事件能回血），下一回合结算再被服务端盖回；
      // 服务端出题时 hp 只有服务端那一份 —— 这里把它对齐（事件回血由服务端落库，本机不应用）。
      if (onlineLocalEvents) return;
      const next = Math.max(0, Math.min(START_HP, Math.floor(hp)));
      const me = state.players.find((player) => player.id === meId);
      if (!me || me.hp === next) return;
      set({ state: { ...state, players: state.players.map((player) => (player.id === meId ? { ...player, hp: next } : player)) } });
    },

    markOnlineOver: (winners) => {
      const { state, online } = get();
      if (!state || !online) return;
      if (state.phase === "over" && get().onlineWinners !== null) {
        // 结算那一拍已经判定结束了；这里只把 GAME_OVER / 房间快照的胜者补上（同一份名单，顺序也一样）
        set({ onlineWinners: winners });
        return;
      }
      set({ state: { ...state, phase: "over" }, onlineWinners: winners, shopOpen: false, drag: null });
    },

    fallbackToLocal: () => {
      const { state } = get();
      if (!state) {
        set({ online: null, onlineSettlement: null, onlineWinners: null, onlineLocalEvents: false });
        return;
      }
      const filled = fillLocalOpponents(state, aiIdsOf(state), aiPromptPool(), rng);
      if (!filled.ok) {
        // 补不齐也要退：把原因留着、状态原样切回单机（别再停在一个走不下去的联机阶段上）
        fail(filled);
        set({ online: null, onlineSettlement: null, onlineWinners: null, onlineLocalEvents: false, drag: null });
        return;
      }
      set({
        state: filled.state,
        online: null,
        onlineSettlement: null,
        onlineWinners: null,
        onlineLocalEvents: false,
        drag: null,
        // 单机事件 / 商店的提示照旧；这里只把"联机"这一层摘掉，不重置这一局的任何进度
        rejection: null,
      });
    },

    markOnlineSubmitted: () => set({ notice: { kind: "online-submitted", at: Date.now() } }),

    pickStyle: (styleCardId) => {
      const { state, meId } = get();
      if (!state) return;
      const picked = pickStyleCard(state, meId, styleCardId);
      if (!picked.ok) {
        fail(picked);
        return;
      }
      // 先把"我选好了"写回去：后面替 AI 开第一回合的那几步万一失败，玩家这一下不该白点（界面会显示原因）。
      set({ state: picked.state, rejection: null });
      get().finishStyle();
    },

    finishStyle: () => {
      const { state } = get();
      if (!state) return;
      if (state.phase !== "style" && state.phase !== "ready") return; // 不在选风格阶段：按钮不该出现
      const advanced = beginFirstRound(state);
      if (!advanced.ok) {
        fail(advanced);
        return;
      }
      // 第一回合的商店默认打开：这是"进对局先把这一套跑通"的第一眼
      done({ state: advanced.state, shopOpen: true });
    },

    toggleShop: (open) => {
      set((s) => ({ shopOpen: open ?? !s.shopOpen }));
    },

    buy: (slot) => {
      const { state, meId } = get();
      if (!state) return;
      const bought = buyShopCard(state, meId, slot);
      if (!bought.ok) {
        fail(bought);
        return;
      }
      done({ state: bought.state, notice: { kind: "bought", at: Date.now() } });
    },

    refresh: () => {
      const { state, meId } = get();
      if (!state) return;
      // 有免费刷新券时 rules 自己先用券（界面只在提示里显示券数，不判）
      const refreshed = refreshShop(state, meId, rng);
      if (!refreshed.ok) {
        fail(refreshed);
        return;
      }
      done({ state: refreshed.state, notice: { kind: "refreshed", at: Date.now() } });
    },

    toggleLock: () => {
      const { state, meId } = get();
      if (!state) return;
      const toggled = toggleShopLock(state, meId);
      if (!toggled.ok) {
        fail(toggled);
        return;
      }
      const locked = toggled.state.shops[meId]?.locked ?? false;
      done({ state: toggled.state, notice: { kind: locked ? "locked" : "unlocked", at: Date.now() } });
    },

    sell: (cardId) => {
      const { state, meId } = get();
      if (!state) return;
      const card = state.players.find((p) => p.id === meId)?.bag.find((c) => c.id === cardId);
      if (!card) {
        // 走到这里说明界面画了一张背包里已经没有的卡（卖掉 / 摆到桌上之后没重渲）：说清楚，别当没点。
        fail({ ok: false, reason: "card-not-in-bag" });
        return;
      }
      const sold = sellCard(state, meId, cardId);
      if (!sold.ok) {
        fail(sold);
        return;
      }
      done({
        state: sold.state,
        notice: { kind: "sold", at: Date.now(), gold: cardSellValue(card) },
      });
    },

    // ─────────────────────── 摆卡与装备（G4 第 3 步） ───────────────────────
    // ★ 这些动作全是"递给 rules → 写回 → 失败原因原样留着"，一条规则都不在这里。

    beginDrag: (drag) => set({ drag, rejection: null }),

    hoverSlot: (slot) => {
      const { drag } = get();
      // 没在拖的时候不改 hover：3D 那一层每帧都会按悬停值高亮，一个残留的 hover 会一直亮着
      if (!drag) return;
      if (sameSlot(drag.hover, slot)) return;
      set({ drag: { ...drag, hover: slot } });
    },

    endDrag: () => {
      const { drag, meId, state } = get();
      set({ drag: null });
      if (!drag || !state) return;
      const hover = drag.hover;
      if (drag.kind === "place") {
        if (!drag.cardId) return;
        // 悬在某一格上就落那一格；否则（拖到桌面空处）让 rules 自己找这一类的第一个空位
        get().placeCard(drag.cardId, hover);
        return;
      }
      if (drag.kind === "return") {
        // 落到另一格 = 换位；落到桌面空处 = 回背包（施工单：已占的位可以拖回背包）
        if (hover && drag.cardId) {
          const target = cardAt(hover);
          if (!target || target.id !== drag.cardId) {
            get().placeCard(drag.cardId, hover);
            return;
          }
        }
        const from = state.players.find((p) => p.id === meId)?.table;
        if (!from || !drag.cardId) return;
        const slot = findSlotOfCard(from.roles, from.scene, drag.cardId);
        if (slot) get().returnCard(slot);
        return;
      }
      // equip / remove：落点必须是角色卡（悬在空的角色位上 = 没对准人，说清楚）
      if (!hover || hover.kind !== "role") {
        fail({ ok: false, reason: "not-a-role" });
        return;
      }
      const roleId = cardAt(hover)?.id ?? null;
      if (!roleId) {
        fail({ ok: false, reason: "table-slot-empty", cardType: "role" });
        return;
      }
      if (drag.kind === "remove") {
        get().unequipFrom(roleId);
        return;
      }
      if (drag.cardId) get().equipOn(roleId, drag.cardId);
    },

    placeCard: (cardId, slot = null) => {
      const { state, meId } = get();
      if (!state) return;
      const placed = placeOnTable(state, meId, cardId, slot);
      if (!placed.ok) {
        fail(placed);
        return;
      }
      done({ state: placed.state, notice: { kind: "placed", at: Date.now() } });
    },

    returnCard: (slot) => {
      const { state, meId } = get();
      if (!state) return;
      const returned = returnToBag(state, meId, slot);
      if (!returned.ok) {
        fail(returned);
        return;
      }
      done({ state: returned.state, notice: { kind: "returned", at: Date.now() } });
    },

    equipOn: (roleCardId, itemCardId) => {
      const { state, meId } = get();
      if (!state) return;
      const equipped = equipItem(state, meId, roleCardId, itemCardId);
      if (!equipped.ok) {
        fail(equipped);
        return;
      }
      done({ state: equipped.state, notice: { kind: "equipped", at: Date.now() } });
    },

    unequipFrom: (roleCardId) => {
      const { state, meId } = get();
      if (!state) return;
      const unequipped = unequipAll(state, meId, roleCardId);
      if (!unequipped.ok) {
        fail(unequipped);
        return;
      }
      done({ state: unequipped.state, notice: { kind: "unequipped", at: Date.now() } });
    },

    setCreatePrompt: (text) => set({ createPrompt: text }),

    setPreviewOpen: (open) => set({ previewOpen: open }),

    clearRejection: () => {
      set({ rejection: null });
    },

    // ─────────────────────────── G3 回合循环 ───────────────────────────
    // 每一步都是"递给 phases / rules → 写回 → 失败原因原样留着"，没有一条规则住在这里。

    enterCreate: () => {
      const { state } = get();
      if (!state) return;
      // AI 的片子在这一拍就交好（先摆好它自己的桌面，再用它的卡 + 一句随机提示词）
      const created = toCreation(state, aiIdsOf(state), aiPromptPool(), rng);
      if (!created.ok) {
        fail(created);
        return;
      }
      done({ state: created.state, shopOpen: false, drag: null });
    },

    saveEntry: (patch) => {
      const { state, meId, createPrompt } = get();
      if (!state) return;
      const saved = submitRoundEntry(state, meId, {
        prompt: createPrompt,
        videoUrl: patch?.videoUrl,
        seconds: patch?.seconds,
      });
      if (!saved.ok) {
        fail(saved);
        return;
      }
      done({
        state: saved.state,
        notice: { kind: patch?.videoUrl ? "generated" : "entry-saved", at: Date.now() },
      });
    },

    enterScreening: () => {
      const { state } = get();
      if (!state) return;
      const screened = toScreening(state, aiIdsOf(state), rng);
      if (!screened.ok) {
        fail(screened);
        return;
      }
      done({ state: screened.state });
    },

    like: (entryId) => {
      const { state, meId } = get();
      if (!state) return;
      const liked = likeEntry(state, meId, entryId);
      if (!liked.ok) {
        fail(liked);
        return;
      }
      done({ state: liked.state, notice: { kind: "liked", at: Date.now() } });
    },

    enterVoting: () => {
      const { state } = get();
      if (!state) return;
      const voting = toVoting(state, aiIdsOf(state), rng);
      if (!voting.ok) {
        fail(voting);
        return;
      }
      done({ state: voting.state });
    },

    vote: (entryId) => {
      const { state, meId } = get();
      if (!state) return;
      const voted = voteEntry(state, meId, entryId);
      if (!voted.ok) {
        fail(voted);
        return;
      }
      done({ state: voted.state, notice: { kind: "voted", at: Date.now() } });
    },

    abstain: () => {
      const { state, meId } = get();
      if (!state) return;
      const abstained = abstainVote(state, meId);
      if (!abstained.ok) {
        fail(abstained);
        return;
      }
      done({ state: abstained.state, notice: { kind: "abstained", at: Date.now() } });
    },

    settle: () => {
      const { state, meId } = get();
      if (!state) return;
      const settled = settleRoundFromVotes(state, rng);
      if (!settled.ok) {
        fail(settled);
        return;
      }
      let next = settled.state;
      const report: RoundReport = { summary: settled.summary, tally: settled.tally };
      // 事件（§2.3b）：AI 先把三选一选掉，真人的选项由事件屏摆出来
      const evented = aiEventChoices(next, aiIdsOf(next), rng);
      if (!evented.ok) {
        fail(evented);
        return;
      }
      next = evented.state;
      const me = next.players.find((player) => player.id === meId);
      let eliminatedAtRound = get().eliminatedAtRound;
      // ★ 淘汰发生在**这一期**：先记下回合数再跑后台回合 —— playOutAiOnly 会把 round 推到最后一回合，
      //   晚一步记就会把"你在第 8 回合被淘汰"说成错的回合（实机验过：第 6 回合出局被念成第 8 回合）。
      if (me?.eliminated) eliminatedAtRound = eliminatedAtRound ?? next.round;
      // ★ 真人被淘汰：这一局对他已经结束，但胜者要等"剩 ≤2 人 / 打满 8 回合"才出 ——
      //   所以让剩下的回合在后台按 AI 自动跑完（phases.playOutAiOnly），玩家直接看到最终胜者。
      if (me?.eliminated && next.phase !== "over") {
        const played = playOutAiOnly(next, aiIdsOf(next), aiPromptPool(), rng);
        if (!played.ok) {
          fail(played);
          return;
        }
        next = played.state;
      }
      done({ state: next, report, eliminatedAtRound, shopOpen: false });
    },

    chooseEvent: (optionId) => {
      const { state, meId } = get();
      if (!state) return;
      // gate 与 view.eventViewOf（摆哪些选项）/ genTier.genTierIdOf（发哪一档）同一个：
      // 免费账号的 L2 / L3 升级项既摆不出来、也扣不动钱（见 rules.ModelGate）
      const chosen = applyEventChoice(state, meId, optionId, rng, modelUpgradeGate());
      if (!chosen.ok) {
        fail(chosen);
        return;
      }
      done({ state: chosen.state });
    },

    skipEvent: () => {
      const { state, meId } = get();
      if (!state) return;
      const skipped = skipEventChoice(state, meId);
      if (!skipped.ok) {
        fail(skipped);
        return;
      }
      done({ state: skipped.state });
    },

    nextRound: () => {
      const { state } = get();
      if (!state) return;
      const opened = openRound(state, aiIdsOf(state), rng);
      if (!opened.ok) {
        fail(opened);
        return;
      }
      // 新的回合商店默认打开（与第一回合一致）；上一期的报告留着也没人读（那一屏已经卸载了）
      done({ state: opened.state, shopOpen: true });
    },

    restart: () => {
      // 联机局不在这里重开：服务端那间房还挂着，重开本机局会把对局和房间拆成两份（界面在联机局结束
      // 时走的是「返回大厅」，由 ui/PhaseBar 决定；这里留一道防线，真被调到时什么也不做）。
      if (get().online) return;
      // 同一张桌（人数沿用）：8 人局点「再来一局」还是 8 人，不掉回默认 4 人
      get().startGame(undefined, { playerCount: get().playerCount });
    },
  };
});

/** 一张卡在桌面上的位置（拖回背包时认它；不在桌上回 null）。 */
function findSlotOfCard(
  roles: (GameCard | null)[],
  scene: GameCard | null,
  cardId: string,
): TableSlot | null {
  const index = roles.findIndex((card) => card?.id === cardId);
  if (index >= 0) return { kind: "role", index };
  if (scene?.id === cardId) return { kind: "scene" };
  return null;
}

// 给界面读的派生：胜者（结算屏 / 结束屏"谁赢了"只有 rules 一份实现，界面不自己比血量）
export function winnersOfState(state: GameState | null): string[] {
  return state ? winnersOf(state) : [];
}

// DEV 调试挂钩（与 __cut / __studio / __flow 同款）：自动化脚本要直接驱动对局，不必去点 2D 面板。
// 正式包里 import.meta.env.DEV 为假，字面量写在原地才保证被剥掉。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}
