/**
 * 一局对局的全部状态（G2 第二块起的门面；G3 把回合循环接上）。
 *
 * ★ 为什么单开一个 store（不塞进 StudioPage 的 useState、也不塞进 studioStore）：
 *   · 工坊里切到画布浮层、去挂卡页再回来，这一页会整个重挂 —— 局部 state 归零，一局的钱与卡就没了；
 *   · G3 的回合循环 / G4 的出片翻译层 / G5 的房间同步要认同一份 GameState，放在页面里它们够不着。
 * ★★ 这一层**不写一条规则**（铁律六）：每个动作只做三件事 —— 把当前 state 递给 rules 里的同名函数、
 *   把成功结果写回、把失败原因（RuleFailure）原样留下来交给界面说人话（铁律八：不静默失败）。
 *   金币 / 利息 / 背包上限 / 类型上限 / 装备闸 / 风格锁死 / 商店刷新与锁定的语义全部在 rules；
 *   交片 / 点赞 / 投票 / 榜单 / 扣血也在 rules；"一局怎么走"（AI 陪玩的那几步）在 phases。
 *   这里连一个 `if (gold >= price)` 都不许出现。
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
  equippedItemOf,
  likeEntry,
  pickStyleCard,
  refreshShop,
  sellCard,
  skipEventChoice,
  submitRoundEntry,
  toggleShopLock,
  unequipItem,
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
import type { GameCard, GameState, RoundSettlement, RoundTally, Rng } from "./types";

/** 本地玩家的座位 id（单机版的"我"；G5 联机时换成服务端下发的 playerId） */
export const LOCAL_PLAYER_ID = "me";
/** 三个 AI 陪玩。排列顺序固定，方便复盘（同 seed 同一局） */
export const AI_PLAYER_IDS = ["ai-1", "ai-2", "ai-3"] as const;

/** 动作成功后那条轻提示的**种类**（不带文案：文案在界面里按语言拼，见 ui/GameLayer） */
export type GameNoticeKind =
  | "bought"
  | "sold"
  | "equipped"
  | "unequipped"
  | "refreshed"
  | "locked"
  | "unlocked"
  | "pick-item-first"
  // G3：创作 / 展映 / 投票那几下
  | "entry-saved"
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
  /** 点选式装备的第一步：选中了哪张道具；null = 没选 */
  pickedItemId: string | null;
  /** 商店里等着挑"替换掉哪一张"的那一格；null = 不在替换流程 */
  pendingBuySlot: number | null;
  /** 商店面板收起来没有（收起后仍能从背包条那颗键打开） */
  shopOpen: boolean;
  rejection: GameRejection | null;
  notice: GameNotice | null;
  /** 最近一次结算（§2.5）：结算屏 / 事件屏 / 结束屏读它 */
  report: RoundReport | null;
  /** 我在第几回合被淘汰的（结束屏要说"你在第 N 回合出局"）；null = 还活着 */
  eliminatedAtRound: number | null;

  startGame: (seed?: number) => void;
  endGame: () => void;
  /** 选风格卡：选定后（连同 3 个 AI 的选择）进第一回合商店 */
  pickStyle: (styleCardId: string) => void;
  /** 本地玩家已选、但有人的选择没落完时补一刀（正常路径用不到，见 aiFinishStyle） */
  finishStyle: () => void;
  toggleShop: (open?: boolean) => void;
  buy: (slot: number) => void;
  cancelReplace: () => void;
  replaceAndBuy: (outCardId: string) => void;
  refresh: () => void;
  toggleLock: () => void;
  sell: (cardId: string) => void;
  /** 点一张道具 = 选中 / 取消选中（点选式装备，不做 3D 拖拽） */
  pickItem: (cardId: string | null) => void;
  /** 点一张角色：选中了道具就装上；没选道具而角色身上有东西就卸下 */
  equipOn: (roleCardId: string) => void;
  unequipFrom: (roleCardId: string) => void;
  clearRejection: () => void;

  // ── G3 回合循环 ──
  /** 商店 → 创作（AI 在这一拍把片子交了） */
  enterCreate: () => void;
  /** 交片：三个虚框里的卡 + 一句提示词（可重交，改卡改词都行） */
  saveEntry: (cards: readonly GameCard[], prompt: string) => void;
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

  return {
    state: null,
    meId: LOCAL_PLAYER_ID,
    seed: 0,
    pickedItemId: null,
    pendingBuySlot: null,
    shopOpen: false,
    rejection: null,
    notice: null,
    report: null,
    eliminatedAtRound: null,

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
        pickedItemId: null,
        pendingBuySlot: null,
        shopOpen: false,
        rejection: null,
        notice: null,
        report: null,
        eliminatedAtRound: null,
      });
    },

    endGame: () => {
      rng = createRng(1);
      set({
        state: null,
        seed: 0,
        pickedItemId: null,
        pendingBuySlot: null,
        shopOpen: false,
        rejection: null,
        notice: null,
        report: null,
        eliminatedAtRound: null,
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
      if (bought.ok) {
        done({ state: bought.state, pendingBuySlot: null, pickedItemId: null, notice: { kind: "bought", at: Date.now() } });
        return;
      }
      // ★ 装不下**不是死路**：规则说"装不下只能替换"（§2.1），所以这两种失败要记住那一格，
      //   让玩家在背包里挑一张旧卡（replaceAndBuy 走同一条 rules.buyShopCard，带上 replaceCardId）。
      if (bought.reason === "bag-full" || bought.reason === "type-cap") {
        set({ rejection: { failure: bought, at: Date.now() }, pendingBuySlot: slot, notice: null });
        return;
      }
      set({ rejection: { failure: bought, at: Date.now() }, pendingBuySlot: null, notice: null });
    },

    cancelReplace: () => {
      set({ pendingBuySlot: null, rejection: null });
    },

    replaceAndBuy: (outCardId) => {
      const { state, meId, pendingBuySlot } = get();
      // 界面只在替换流程里画这颗键（点不到这条路）；真被点到就当作没发生，不硬编一个假原因。
      if (!state || pendingBuySlot === null) return;
      const bought = buyShopCard(state, meId, pendingBuySlot, outCardId);
      if (bought.ok) {
        done({ state: bought.state, pendingBuySlot: null, pickedItemId: null, notice: { kind: "bought", at: Date.now() } });
        return;
      }
      // 保留 pendingBuySlot：换一张旧卡可能就成了（比如换成同类型的卡、角色先卸下道具），
      // 失败原因（role-equipped / item-equipped）由界面说清楚，玩家可以再挑或取消。
      set({ rejection: { failure: bought, at: Date.now() }, notice: null });
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
        // 走到这里说明界面画了一张背包里已经没有的卡（卖掉 / 替换掉之后没重渲）：说清楚，别当没点。
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
        pickedItemId: null,
        notice: { kind: "sold", at: Date.now(), gold: cardSellValue(card) },
      });
    },

    pickItem: (cardId) => {
      const { pickedItemId } = get();
      const next = cardId === null || cardId === pickedItemId ? null : cardId;
      set({ pickedItemId: next, rejection: null });
    },

    equipOn: (roleCardId) => {
      const { state, meId, pickedItemId } = get();
      if (!state) return;
      const player = state.players.find((p) => p.id === meId);
      if (!player) return;
      if (pickedItemId === null) {
        // 没选道具时点角色：身上有东西就卸下（施工单「再点可卸下」）；没有就告诉玩家下一步，
        // 否则这一下在手机上就是"点了没反应"。
        if (equippedItemOf(player, roleCardId)) {
          get().unequipFrom(roleCardId);
          return;
        }
        set({ rejection: null, notice: { kind: "pick-item-first", at: Date.now() } });
        return;
      }
      const equipped = equipItem(state, meId, roleCardId, pickedItemId);
      if (!equipped.ok) {
        fail(equipped);
        return;
      }
      done({
        state: equipped.state,
        pickedItemId: null,
        notice: { kind: "equipped", at: Date.now() },
      });
    },

    unequipFrom: (roleCardId) => {
      const { state, meId } = get();
      if (!state) return;
      const unequipped = unequipItem(state, meId, roleCardId);
      if (!unequipped.ok) {
        fail(unequipped);
        return;
      }
      done({ state: unequipped.state, notice: { kind: "unequipped", at: Date.now() } });
    },

    clearRejection: () => {
      set({ rejection: null });
    },

    // ─────────────────────────── G3 回合循环 ───────────────────────────
    // 每一步都是"递给 phases / rules → 写回 → 失败原因原样留着"，没有一条规则住在这里。

    enterCreate: () => {
      const { state } = get();
      if (!state) return;
      // AI 的片子在这一拍就交好（用它的卡 + 一句随机提示词，池子在这里递进去 —— bots 不认语言）
      const created = toCreation(state, AI_IDS, aiPromptPool(), rng);
      if (!created.ok) {
        fail(created);
        return;
      }
      done({ state: created.state, shopOpen: false, pickedItemId: null, pendingBuySlot: null });
    },

    saveEntry: (cards, prompt) => {
      const { state, meId } = get();
      if (!state) return;
      const saved = submitRoundEntry(state, meId, { cards, prompt });
      if (!saved.ok) {
        fail(saved);
        return;
      }
      done({ state: saved.state, notice: { kind: "entry-saved", at: Date.now() } });
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
      const chosen = applyEventChoice(state, meId, optionId, rng);
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
      done({ state: opened.state, shopOpen: true, pickedItemId: null, pendingBuySlot: null });
    },

    restart: () => {
      get().startGame();
    },
  };
});

// 给界面读的派生：胜者（结算屏 / 结束屏"谁赢了"只有 rules 一份实现，界面不自己比血量）
export function winnersOfState(state: GameState | null): string[] {
  return state ? winnersOf(state) : [];
}

// DEV 调试挂钩（与 __cut / __studio / __flow 同款）：自动化脚本要直接驱动对局，不必去点 2D 面板。
// 正式包里 import.meta.env.DEV 为假，字面量写在原地才保证被剥掉。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}
