/**
 * 联机回合的轮询与对账（2026-11-24）：**2 秒一拍的唯一一处定时器**。
 *
 * ★★ 为什么挂在界面这一层（而不是 store 里 setTimeout）：与 useLobbyOnline 同一条理由 ——
 *   组件卸载的那一刻 React 会跑 cleanup，定时器跟着停；写在 module 级 store 里就得自己记 timer id、
 *   自己判"现在还在不在这一局"，漏一处就是"退出对局之后还在后台每 2 秒请求一次"。
 * ★ 这一层只做"把两边对账"（服务端 = 真相，本机 = 那份界面状态）：
 *   · 服务端 round + 1 → 本机开下一回合（商店重开）；
 *   · 服务端 screening / voting → 本机阶段跟着走（联机的"全员"是房间成员，本机的全员闸不适用）；
 *   · 服务端结算 → 写回我的 hp / 淘汰位，并交给结算屏**原样渲染**（一个数都不重算）；
 *   · 轮询失败 → roundsStore 已把会话收掉并留了 fallback 原因，这里把本机 loop 接回来（补齐 AI 动作），
 *     玩家看到的是一句「回合服务没响应，这一局改成单机继续」。
 * ★ 用递归 setTimeout 而不是 setInterval：一拍没回来（弱网 10 秒超时）时不会叠出两三个并发请求。
 */
import { useEffect, useRef } from "react";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import { ROUND_POLL_MS } from "../roundsStore";

export function useOnlineRounds(): void {
  const session = useRounds((s) => s.session);
  const snapshot = useRounds((s) => s.snapshot);
  const settlement = useRounds((s) => s.settlement);
  const winners = useRounds((s) => s.winners);
  const note = useRounds((s) => s.note);
  const online = useGame((s) => s.online);
  const state = useGame((s) => s.state);
  const roomCode = session?.roomCode ?? null;

  // ── 2 秒一拍：读服务端当前回合（结算那一拍顺带把 settlement 取回来） ──
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      let outcome: "ok" | "stop" | "fallback";
      try {
        outcome = await useRounds.getState().poll();
      } catch (err) {
        // store 里的网络错误都已经翻译成结果了；能抛到这里的是**我们自己的 bug** ——
        // 一轮询就静默死掉是最坏的一种（界面永远停在最后一帧），所以照样收会话 + 退回单机。
        console.error("[rounds] 回合轮询意外失败，这一局改成单机继续", err);
        useRounds.getState().failNow();
        return;
      }
      if (cancelled || outcome !== "ok") return;
      timer = setTimeout(tick, ROUND_POLL_MS);
    };
    timer = setTimeout(tick, ROUND_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomCode]);

  // ── 服务端快照 → 本机阶段 / 回合 ──
  useEffect(() => {
    if (!online || !snapshot) return;
    const game = useGame.getState();
    if (!game.state) return;
    // 新回合：本机 round-end → shop（收入 + 新商店）；联机里 AI 不行动，只开我这一份
    if (snapshot.round > game.state.round) game.beginOnlineRound(snapshot.round);
    // 展映 / 投票由服务端推：本机的 entries / spoken 闸不适用（见 phases.onlinePhaseTo）
    if (snapshot.phase === "screening" || snapshot.phase === "voting") game.syncOnlinePhase(snapshot.phase);
  }, [online, snapshot]);

  // ── 服务端结算 → 本机 hp / 结算屏（**同一局的同一回合只应用一次**） ──
  // ★ 去重键是 `房间码:回合号`，不是回合号：结束一局再开一局时 GameLayer 不会重挂，
  //   只按回合号去重会让新一局的第 1 回合结算被上一局第 1 回合的"已应用"挡掉 ——
  //   症状是投票完了界面一直停在投票屏、榜单不出来（2026-11-24 两个账号连着开第二局时撞见）。
  const appliedRound = useRef<string | null>(null);
  useEffect(() => {
    if (!online || !settlement || !roomCode) return;
    const round = useRounds.getState().snapshot?.round ?? null;
    if (round === null) return;
    const key = `${roomCode}:${round}`;
    if (appliedRound.current === key) return;
    appliedRound.current = key;
    useGame.getState().applyOnlineSettlement(settlement, winners);
  }, [online, settlement, winners, roomCode]);

  // ── 这局已经结束（GAME_OVER / 结算里带了胜者）：本机进 over ──
  useEffect(() => {
    if (!online || !winners) return;
    useGame.getState().markOnlineOver(winners);
  }, [online, winners]);

  // ── 退回单机：把本机 loop 接回来（AI 这一期缺的动作补齐），原因由 roundsReasons 说 ──
  useEffect(() => {
    if (!online || !note || note.kind !== "fallback") return;
    useGame.getState().fallbackToLocal();
  }, [online, note]);

  // ── 对局结束（结束对局 / 返回大厅 / 再来一局）：退掉服务端房间，别让账号继续挂在房里 ──
  // ★ 不在组件卸载上退房：StrictMode 的假卸载会先跑一次 cleanup，那会把刚开好的房当场退掉
  //   （与 lobbyStore.release 的 ★ 同一条）。真崩溃 / 杀进程由服务端房寿命兜底。
  useEffect(() => {
    if (!session) return;
    if (!online || !state) useRounds.getState().leaveNow();
  }, [session, online, state]);
}
