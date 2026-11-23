/**
 * 一局对局的全部状态（G2 第二块：把规则引擎接到工坊界面上）。
 *
 * ★ 为什么单开一个 store（不塞进 StudioPage 的 useState、也不塞进 studioStore）：
 *   · 工坊里切到画布浮层、去挂卡页再回来，这一页会整个重挂 —— 局部 state 归零，一局的钱与卡就没了；
 *   · G3 的回合循环 / G4 的出片翻译层 / G5 的房间同步要认同一份 GameState，放在页面里它们够不着。
 * ★★ 这一层**不写一条规则**（铁律六）：每个动作只做三件事 —— 把当前 state 递给 rules 里的同名函数、
 *   把成功结果写回、把失败原因（RuleFailure）原样留下来交给界面说人话（铁律八：不静默失败）。
 *   金币 / 利息 / 背包上限 / 类型上限 / 装备闸 / 风格锁死 / 商店刷新与锁定的语义全部在 rules，
 *   这里连一个 `if (gold >= price)` 都不许出现。
 * ★ 单机版（G3 之前）：本地玩家叫 "me"，另外 3 个是 AI 陪玩。AI 现在只有一种行为 ——
 *   「轮到自己选风格时挑抽到的第一张」。这是**编排**不是规则：规则只管"一人一次、只能选自己那三张、
 *   选定锁死"，AI 选哪张规则不表态（G3 才给它正经的出片与投票）。
 * ★ 随机源住模块作用域（不进 state）：一局的 rng 是一个**有位置的序列**，放进 zustand 状态里会被
 *   devtools / 持久化那类东西当成普通字段；而它必须与 seed 一一对应才能复盘（rules.createRng 的 ★）。
 */
import { create } from "zustand";
import {
  beginRound,
  buyShopCard,
  cardSellValue,
  createGame,
  createRng,
  equipItem,
  equippedItemOf,
  pickStyleCard,
  refreshShop,
  sellCard,
  toggleShopLock,
  unequipItem,
  type RuleFailure,
  type StateResult,
} from "./rules";
import type { GameState, Rng } from "./types";

/** 本地玩家的座位 id（单机版的"我"；G5 联机时换成服务端下发的 playerId） */
export const LOCAL_PLAYER_ID = "me";
/** 三个 AI 陪玩。排列顺序固定，方便复盘（同 seed 同一局） */
const AI_PLAYER_IDS = ["ai-1", "ai-2", "ai-3"] as const;

/** 动作成功后那条轻提示的**种类**（不带文案：文案在界面里按语言拼，见 ui/GameLayer） */
export type GameNoticeKind =
  | "bought"
  | "sold"
  | "equipped"
  | "unequipped"
  | "refreshed"
  | "locked"
  | "unlocked"
  | "pick-item-first";

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
}

/** 这一局的随机源（模块作用域，见文件头 ★） */
let rng: Rng = createRng(1);

/** 新开一局的种子：时间 + 一点随机，够散；复盘时把 seed 记下来即可重放 */
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
}

/**
 * 本地玩家选完之后，替 AI 把风格选完，再开第一回合。
 * ★ AI 的选择也走 rules.pickStyleCard（不直接改 styleChoices）：规则里"一人一次 / 只能选自己那三张 /
 *   全员选完才 ready"这三条与真人共用一处，AI 不该有后门。
 * ★ 全员选完时 rules 把 phase 推到 ready；第一回合商店由 beginRound 开（ready 那支不发钱，见 rules）。
 */
function aiFinishStyle(state: GameState): StateResult {
  let next = state;
  for (const id of AI_PLAYER_IDS) {
    if (next.phase !== "style") break;
    const ai = next.players.find((p) => p.id === id);
    if (!ai || ai.styleCardId !== null) continue;
    const choice = ai.styleChoices[0];
    // 落到这里说明 createGame 给的 3 张风格没了（坏状态）：宁可响一声让界面报出来，也别让这局卡死。
    if (choice === undefined) return { ok: false, reason: "style-not-offered" };
    const picked = pickStyleCard(next, id, choice);
    if (!picked.ok) return picked;
    next = picked.state;
  }
  if (next.phase !== "ready") return { ok: true, state: next };
  return beginRound(next, rng);
}

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

    startGame: (seed) => {
      const nextSeed = typeof seed === "number" && Number.isFinite(seed) ? seed >>> 0 : freshSeed();
      // createGame 用**同一个** rng 抽三张风格卡，之后的商店 / 事件 / 随机卡都接着这条序列走
      // （两处各 createRng(seed) 会抽出一模一样的序列，复盘就对不上了）。
      const r = createRng(nextSeed);
      const next = createGame([LOCAL_PLAYER_ID, ...AI_PLAYER_IDS], r);
      rng = r;
      set({
        state: next,
        seed: nextSeed,
        pickedItemId: null,
        pendingBuySlot: null,
        shopOpen: false,
        rejection: null,
        notice: null,
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
      // 先把"我选好了"写回去：后面替 AI 选的那几步万一失败，玩家这一下不该白点（界面会显示重试）。
      set({ state: picked.state, rejection: null });
      get().finishStyle();
    },

    finishStyle: () => {
      const { state } = get();
      if (!state) return;
      if (state.phase !== "style" && state.phase !== "ready") return; // 不在选风格阶段：按钮不该出现
      const advanced = aiFinishStyle(state);
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
  };
});

// DEV 调试挂钩（与 __cut / __studio / __flow 同款）：自动化脚本要直接驱动对局，不必去点 2D 面板。
// 正式包里 import.meta.env.DEV 为假，字面量写在原地才保证被剥掉。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = useGame;
}
