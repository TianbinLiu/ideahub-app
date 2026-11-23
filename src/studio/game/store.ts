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
  submitRoundEntry,
  toggleShopLock,
  unequipAll,
  voteEntry,
  abstainVote,
  applyEventChoice,
  settleRoundFromVotes,
  winnersOf,
  type RuleFailure,
  type StateResult,
} from "./rules";
import { aiEventChoices, openRound, playOutAiOnly, startMatch, toCreation, toScreening, toVoting } from "./phases";
import { aiPromptPool } from "./labels";
import { modelUpgradeGate } from "./genTier";
import type { GameCard, GameState, RoundSettlement, RoundTally, Rng, TableSlot } from "./types";

/** 本地玩家的座位 id（单机版的"我"；G5 联机时换成服务端下发的 playerId） */
export const LOCAL_PLAYER_ID = "me";
/** 三个 AI 陪玩。排列顺序固定，方便复盘（同 seed 同一局） */
export const AI_PLAYER_IDS = ["ai-1", "ai-2", "ai-3"] as const;

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
  | "abstained";

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

  startGame: (seed?: number) => void;
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
 */
function beginFirstRound(state: GameState): StateResult {
  if (state.phase !== "ready") return { ok: true, state };
  return openRound(state, [...AI_PLAYER_IDS], rng);
}

const AI_IDS: readonly string[] = [...AI_PLAYER_IDS];

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

    startGame: (seed) => {
      const nextSeed = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : freshSeed();
      // 开局用**同一个** rng：抽风格卡、AI 选风格、之后的商店 / 事件 / 随机卡都接着这条序列走
      // （两处各 createRng(seed) 会抽出一模一样的序列，复盘就对不上了）。
      const r = createRng(nextSeed);
      const started = startMatch([LOCAL_PLAYER_ID, ...AI_PLAYER_IDS], AI_IDS, r);
      rng = r;
      if (!started.ok) {
        fail(started);
        return;
      }
      set({
        state: started.state,
        seed: nextSeed,
        shopOpen: false,
        rejection: null,
        notice: null,
        report: null,
        eliminatedAtRound: null,
        drag: null,
        createPrompt: "",
        previewOpen: false,
      });
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
      });
    },

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
      const created = toCreation(state, AI_IDS, aiPromptPool(), rng);
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
      const screened = toScreening(state, AI_IDS, rng);
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
      const voting = toVoting(state, AI_IDS, rng);
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
      const evented = aiEventChoices(next, AI_IDS, rng);
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
        const played = playOutAiOnly(next, AI_IDS, aiPromptPool(), rng);
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
      const opened = openRound(state, AI_IDS, rng);
      if (!opened.ok) {
        fail(opened);
        return;
      }
      // 新的回合商店默认打开（与第一回合一致）；上一期的报告留着也没人读（那一屏已经卸载了）
      done({ state: opened.state, shopOpen: true });
    },

    restart: () => {
      get().startGame();
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
