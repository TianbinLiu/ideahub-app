/**
 * 战绩 / 回放宽屏的界面状态（2026-11-24；服务端 `GET /api/game/rooms/:code/rounds/history`）。
 *
 * ★★ 这一层只做三件事：**判该不该发**（`historyPlanOf`）/ **发一次**（`readHistory`）/ **把失败原因
 *   原样留着**（`HistoryFailure`）。名次、点赞、票数、summary 一个都不在这里算 —— 那是
 *   `studio/game/history.ts` 的纯函数从服务端回包里读出来的（界面只渲染）。
 * ★ 为什么不塞进 roundsStore：那一层是"这一局还在打"的轮询状态（session / room / snapshot 跟着
 *   房间活）；战绩屏是**一局打完之后**的只读快照，生命周期与它无关（大厅里也能开，那时没有任何
 *   回合会话）。混在一起会让 roundsStore 多出一份"结束时要记得清"的数据。
 * ★ 定时器一个都没有：只在打开 / 手动重试时拉一发；失败可重试一次（`historyRetryAllowed`）。
 *   页面自己拉，断线/切后台回来不会自己刷（也不该 —— 局已经打完了，这份历史不会变）。
 * ★ 能力位为假 / 本机单机局：**一个请求都不发**（`plan.request === false`），直接进 blocked 那一屏；
 *   503 `GAME_HISTORY_OFF` 走同一种退路（分类在 historyFailureOf）。
 */
import { create } from "zustand";
import { readHistory, type RemoteGameHistory } from "../../api/game/rounds";
import { serverGameHistory } from "../../data/serverCaps";
import { historyFailureOf, historyPlanOf, historyRetryAllowed, type HistoryFailure } from "./history";
import { saveLastHistoryRoom } from "./historyLastRoom";

/** blocked 的两种来由：本机对局（没有房号）/ 这台服务器没有回放（能力位为假）。 */
export type HistoryBlock = "local" | "off";

export type HistoryStatus = "idle" | "loading" | "ready" | "blocked" | "failed";

export interface HistoryStore {
  /** 这一屏开着没有（StudioPage 那一层据此挂不挂浮层） */
  open: boolean;
  /** 正在读 / 刚读过的那间房（blocked 时是本机局 = null） */
  code: string | null;
  /** 我是谁（summary 高亮 / "你第 x 名"要用；拿不到时传 null，界面不高亮、不猜） */
  myUserId: string | null;
  status: HistoryStatus;
  history: RemoteGameHistory | null;
  block: HistoryBlock | null;
  failure: HistoryFailure | null;
  /** **已经发出去的次数**（首次 = 1；失败后只有 1 次时还允许重试一次） */
  attempts: number;

  /**
   * 打开这一屏并读一次（唯一入口）。
   * `code` 为 null = 本机单机局（不发请求，直接说"这一局没有回放"）。
   * ★ 能力位在这里判，而不是在界面里：能力位为假时连 `readHistory` 都不许被调用
   *   （构建门禁 `check-game-history.mjs` 钉住这一条）。
   */
  openFor: (opts: { code: string | null; myUserId?: string | null }) => void;
  /** 失败后重试**一次**（`attempts` 已经是 2 时什么都不做） */
  retry: () => void;
  close: () => void;
}

export const useHistory = create<HistoryStore>((set, get) => {
  /**
   * 请求序号：关掉 / 换一局 / 重试之后，晚到的回包一律作废。
   * ★ 与 roundsStore 的 pushSeq 同一个理由：HTTP 响应可能比"用户已经走开"更晚到，
   *   写回去的是一屏已经不属于它的历史（并且会把新打开那一屏的状态盖掉）。
   */
  let seq = 0;

  const load = async (code: string, myUserId: string | null, attempts: number, token: number): Promise<void> => {
    set({
      open: true,
      code,
      myUserId,
      status: "loading",
      history: null,
      block: null,
      failure: null,
      attempts,
    });
    const res = await readHistory(code);
    if (seq !== token) return;
    if (!res.ok) {
      set({ status: "failed", failure: historyFailureOf(res) });
      return;
    }
    set({ status: "ready", history: res.value, failure: null });
    // 刷新"最近一局"：能读到历史说明这间房还没过期，下一轮大厅入口正好用它
    if (myUserId) saveLastHistoryRoom({ code, userId: myUserId });
  };

  /** 能力位为假 / 本机局：不发请求，摆 blocked（`block` 决定说哪一句） */
  const blockWith = (block: HistoryBlock, code: string | null, myUserId: string | null): void => {
    seq += 1;
    set({ open: true, code, myUserId, status: "blocked", block, history: null, failure: null, attempts: 0 });
  };

  return {
    open: false,
    code: null,
    myUserId: null,
    status: "idle",
    history: null,
    block: null,
    failure: null,
    attempts: 0,

    openFor: ({ code, myUserId = null }) => {
      const plan = historyPlanOf(code, serverGameHistory());
      if (!plan.request) {
        blockWith(plan.kind, code?.trim() || null, myUserId);
        return;
      }
      const token = ++seq;
      void load(plan.code, myUserId, 1, token);
    },

    retry: () => {
      const { code, myUserId, status, attempts } = get();
      if (!code || status !== "failed" || !historyRetryAllowed(attempts)) return;
      // 重试前再问一次能力位：探测可能在这几秒里回来了（之前不知道 → 现在明确没有）
      const plan = historyPlanOf(code, serverGameHistory());
      if (!plan.request) {
        blockWith(plan.kind, code, myUserId);
        return;
      }
      const token = ++seq;
      void load(plan.code, myUserId, attempts + 1, token);
    },

    close: () => {
      seq += 1;
      set({ open: false, code: null, myUserId: null, status: "idle", history: null, block: null, failure: null, attempts: 0 });
    },
  };
});

// DEV 调试挂钩（与 __game / __lobby / __rounds 同款）：自动化脚本可以 setState 摆一份假历史
// 验 800×363 的回放条 / summary / 播放器，不必真连服务端造一局。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__history = useHistory;
}
