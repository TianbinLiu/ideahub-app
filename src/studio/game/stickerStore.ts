/**
 * 局内贴纸的**本机状态**（2026-11-24，P1「贴卡 / 表情」）。
 *
 * ★★ 为什么单开一个 store（既不是 game/store，也不是 roundsStore）：
 *   · `game/store` 的纪律是"只转发 rules"（见那份文件头 ★★），而贴纸不是规则、也不进 `GameState`：
 *     它是"这一局里谁贴了什么"，重开一局就该整份清掉 —— 塞进 GameState 会让 rules 的每一种
 *     改法（beginRound / settle / restart）都得记着清它，迟早漏一处（漏了就是上一局的贴纸飘到这一局）。
 *   · `roundsStore` 是**联机回合**（网络 + 服务端事实）；贴纸这一版**一个请求都不发**（服务端没有
 *     这个端点，见 studio/game/stickers.ts 文件头 ★★），混进去之后"这一层只讲服务端事实"就破了。
 * ★ 定时器不在这里：气泡那个 200ms 的时钟只有 `ui/StickerBubbles` 一处（与 roundsStore 里
 *   "轮询只有 ui/useOnlineRounds 一处"同一条分工）；store 只做纯状态迁移。
 * ★ 判据（节流 / 5 条上限 / 4 秒 / AI 每回合 1~2 条）一条都不在这里写第二遍：全部来自
 *   studio/game/stickers.ts，构建门禁 import 的是那一份。
 */
import { create } from "zustand";
import {
  aiStickerPlanOf,
  pruneStickers,
  pushStickerBubbles,
  stickerFaceOf,
  stickerWaitMs,
  type StickerBubble,
} from "./stickers";
import type { GameCard } from "./types";

/** 贴一条的结果：`ok:false` 时 `waitMs` > 0 = 这个人还在节流里（界面把键灰掉并说还差多久）。 */
export interface StickerSendResult {
  ok: boolean;
  waitMs: number;
}

/** 发一条时调用方要给的三样：谁、什么名字、现在几点（`now` 由界面递进来，store 不读时钟）。 */
interface StickerSendInput {
  senderId: string;
  senderName: string | null;
  now: number;
}

export interface StickerStore {
  /** 左下角那一摞（最近的在后；长度上限 STICKER_MAX 由 pushStickerBubbles 一处管） */
  bubbles: StickerBubble[];
  /** 每个发送者的最后一条时刻（节流按人记；键 = 座位 id） */
  lastAt: Record<string, number>;
  /** AI 已经给**哪个回合**播过（每回合只播一次；null = 还没播过） */
  aiRound: number | null;
  /** 这一摞贴纸属于哪一局（game/store 的 seed）：换局就整份清掉 */
  gameSeed: number | null;
  /** 气泡 id 的流水号（同一座位连贴两条也要有各自的 key） */
  serial: number;

  /** 贴一个表情（`faceId` 认不出 → 不发，不编一个空贴纸） */
  sendFace: (input: StickerSendInput & { faceId: string }) => StickerSendResult;
  /** 贴我的一张卡（卡面 + 卡名，卡在这里拍快照） */
  sendCard: (input: StickerSendInput & { card: GameCard }) => StickerSendResult;
  /**
   * 这一回合的 AI 贴纸（每回合只播一次；返回这一拍真的排进去了几条）。
   * ★ 调用方每个 state 变化都会调它 —— 幂等（`aiRound === round` 就直接回 0），别在调用方判。
   */
  seedRound: (input: { round: number; seed: number; seats: readonly string[]; now: number }) => number;
  /** 丢掉彻底过期的（界面那个 200ms 的时钟调它） */
  prune: (now: number) => void;
  /** 这一局结束 / 换人：整份清掉（下一局从干净的一摞开始） */
  reset: () => void;
}

const EMPTY: Pick<StickerStore, "bubbles" | "lastAt" | "aiRound" | "gameSeed" | "serial"> = {
  bubbles: [],
  lastAt: {},
  aiRound: null,
  gameSeed: null,
  serial: 0,
};

export const useStickers = create<StickerStore>((set, get) => {
  /**
   * 往列表里放一条（节流在**这一处**判，两个发送口共用）。
   * ★ 节流判在 store 而不是面板：面板可以灰掉键，但"能不能发"的真相必须在这里 ——
   *   面板重开、AI 那一侧路、将来接服务端的回声，都走同一道闸（铁律六）。
   */
  const deliver = (
    input: StickerSendInput & { face: StickerBubble["face"]; card: GameCard | null },
  ): StickerSendResult => {
    const waitMs = stickerWaitMs(input.now, get().lastAt[input.senderId]);
    if (waitMs > 0) return { ok: false, waitMs };
    const serial = get().serial + 1;
    const bubble: StickerBubble = {
      id: `${input.senderId}#${serial}`,
      senderId: input.senderId,
      senderName: input.senderName,
      face: input.face,
      card: input.card,
      at: input.now,
    };
    set((s) => ({
      serial,
      lastAt: { ...s.lastAt, [input.senderId]: input.now },
      bubbles: pushStickerBubbles(s.bubbles, [bubble]),
    }));
    return { ok: true, waitMs: 0 };
  };

  return {
    ...EMPTY,

    sendFace: ({ faceId, senderId, senderName, now }) => {
      const face = stickerFaceOf(faceId);
      // 认不出的 id（目录删了一条、旧版本点了新贴纸）：整条不发。发一条空壳出去，
      // 屏幕上就是一个只有名字的气泡 —— 比"点了没反应"更难解释。
      if (!face) return { ok: false, waitMs: 0 };
      return deliver({ senderId, senderName, now, face, card: null });
    },

    sendCard: ({ card, senderId, senderName, now }) =>
      deliver({ senderId, senderName, now, face: null, card }),

    seedRound: ({ round, seed, seats, now }) => {
      const s = get();
      // ★ 换了一局（seed 变了）：气泡 / 节流 / AI 记的回合全是上一局的，整份清掉再播。
      //   判据是 seed 而不是"state 变 null"：restart（再来一局）不会经过 null。
      const fresh = s.gameSeed === seed ? s : { ...s, ...EMPTY, gameSeed: seed };
      if (fresh.aiRound === round) {
        if (fresh !== s) set(fresh);
        return 0;
      }
      const plan = aiStickerPlanOf({ round, seed, seats });
      let serial = fresh.serial;
      const lastAt = { ...fresh.lastAt };
      const incoming: StickerBubble[] = [];
      for (const pick of plan) {
        const face = stickerFaceOf(pick.faceId);
        if (!face) continue;
        serial += 1;
        const at = now + pick.delayMs;
        incoming.push({
          id: `${pick.seatId}#${serial}`,
          senderId: pick.seatId,
          // 本机局的 AI 没有服务端昵称：气泡按 labels.playerName 念（与玩家面板同一份）
          senderName: null,
          face,
          card: null,
          at,
        });
        // AI 也记一笔"它最后一次贴是什么时候"：节流是对**所有人**成立的规则，
        // 将来 AI 真在一回合里连贴两条（比如新增了事件台词）时，这一行就是那道闸。
        lastAt[pick.seatId] = at;
      }
      set({
        bubbles: pushStickerBubbles(fresh.bubbles, incoming),
        lastAt,
        aiRound: round,
        gameSeed: seed,
        serial,
      });
      return incoming.length;
    },

    prune: (now) => {
      const s = get();
      const next = pruneStickers(s.bubbles, now);
      // 引用没变就一个字节都不写：这个函数每 200ms 被调一次，无条件 set 会让整层重渲
      if (next !== s.bubbles) set({ bubbles: next });
    },

    reset: () => set({ ...EMPTY }),
  };
});

// DEV 调试挂钩（与 __game / __lobby / __rounds / __history 同款）：自动化脚本要直接摆贴纸、量气泡，
// 不必去点那颗键（800×363 上的验收脚本就是这么做的）。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__stickers = useStickers;
}
