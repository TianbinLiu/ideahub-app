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
import { overDecidedOf } from "../onlineHost";
import { useGame } from "../store";
import type { OnlineEventStart } from "../store";
import { useRounds } from "../roundsStore";
import { ROUND_POLL_MS } from "../roundsStore";

/**
 * 结算这一拍**事件从哪来**（界面是唯一同时认识两个 store 的地方，见 roundsStore 文件头）。
 * ★ 判据只有三格：
 *   · 服务端给了一份属于这一回合的事件 → server（同一房间同一回合，所有人 eventId 一样）；
 *   · 事件读取结局是 local（能力位为假 / 接口不可用）→ local（退回本机事件，界面要写明只在本机生效）；
 *   · 其余（这一回合本来没事件 / 我已被淘汰 / 能力位还没探到）→ none（结算屏收尾）。
 * ★ 结算与事件是**同一拍读回来**的（roundsStore.pullSettlement），所以正常路径下这里一定已经定局；
 *   "还没探到"那一格落到 none，等事件读回来之后下面那个 effect 再把屏切到 event。
 */
function eventStartOf(round: number): OnlineEventStart {
  const rounds = useRounds.getState();
  if (rounds.eventState === "server" && rounds.event && rounds.event.round === round) {
    return { kind: "server", round, eventId: rounds.event.eventId };
  }
  if (rounds.eventState === "local") return { kind: "local" };
  return { kind: "none" };
}

export function useOnlineRounds(): void {
  const session = useRounds((s) => s.session);
  const snapshot = useRounds((s) => s.snapshot);
  const settlement = useRounds((s) => s.settlement);
  const winners = useRounds((s) => s.winners);
  const note = useRounds((s) => s.note);
  const event = useRounds((s) => s.event);
  const eventState = useRounds((s) => s.eventState);
  const memberHp = useRounds((s) => s.memberHp);
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
    useGame.getState().applyOnlineSettlement(settlement, winners, eventStartOf(round));
  }, [online, settlement, winners, roomCode]);

  // ── 服务端出题的事件读回来了（比结算晚一拍 / 手动结算那一条路）：本机切到事件屏 ──
  // ★ 只在这一回合**还停在结算屏（或已在事件屏）**时动：已经进下一回合 / 已经结束都不重放。
  // ★ 服务端已经记过我这一选（myChoice 非空，例如中途刷新回来）：补一个本机表态收屏，不重放效果。
  const appliedEvent = useRef<string | null>(null);
  useEffect(() => {
    if (!online || !event || !roomCode) return;
    const key = `${roomCode}:${event.round}:${event.eventId}`;
    if (appliedEvent.current === key) return;
    const phase = useGame.getState().state?.phase;
    if (phase !== "round-end" && phase !== "event") return;
    appliedEvent.current = key;
    useGame.getState().applyOnlineEvent({ round: event.round, eventId: event.eventId });
    if (event.myChoice !== null) useGame.getState().markOnlineEventChosen(event.myChoice);
  }, [online, event, roomCode]);

  // ── 事件那一发不可用 / 能力位为假：退回现在这套**本机事件**（界面写明「事件只在本机生效」）──
  // ★ 结算那一拍已经按 local 落过地时这里是 no-op（阶段已经不是 round-end）。
  useEffect(() => {
    if (!online || eventState !== "local") return;
    useGame.getState().fallbackToLocalEvents();
  }, [online, eventState]);

  // ── 我的 hp 每拍对齐服务端房间快照（`members[].hp` 是唯一真相）──
  // ★ 服务端事件回血是**服务端落库**的，App 不再应用一次；这里只是把新血量读回来（HUD / 事件屏那个 ❤）。
  const myHp = session ? memberHp[session.myUserId] : undefined;
  useEffect(() => {
    if (!online || myHp === undefined) return;
    useGame.getState().syncOnlineHp(myHp);
  }, [online, myHp]);

  // ── 这局已经结束（GAME_OVER / 结算里带了胜者 / 房间快照 state:"over"）：本机进 over ──
  // ★ 平局（`winners === []`）也是结束：判据走 overDecidedOf（**不是** `!winners.length`），
  //   写成"有人赢了才算结束"的话，同归于尽那一局会永远停在结算屏（见 onlineHost 那个 ★）。
  useEffect(() => {
    if (!online || !overDecidedOf(winners)) return;
    useGame.getState().markOnlineOver(winners ?? []);
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
