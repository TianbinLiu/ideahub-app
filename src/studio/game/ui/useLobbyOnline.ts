/**
 * 大厅的联机轮询（2026-11-24 接真房间）：等匹配 / 房间快照 / 服务端开局三件事的**唯一**一处定时器。
 *
 * ★★ 为什么轮询挂在界面这一层（而不是 lobbyStore 里 setTimeout）：
 *   · 组件卸载 / 换屏的那一刻，React 会跑 cleanup —— 定时器跟着停，天然不会泄漏；
 *     写在 module 级 store 里就得自己记 timer id、自己判"现在还在不在这一屏"，漏一处就是
 *     关掉大厅之后还在后台每 2 秒请求一次（真机上表现为耗电 + 401 日志，没人看得出来）。
 *   · 离开 / 关大厅时**服务端那一步**由 store 的 release 动作做（退出房间 / 取消排队），
 *     这里只负责"停拍" —— 两件事分开，StrictMode 的假卸载不会把刚建好的房退掉。
 * ★ 停拍有三种，三种都要说清是"主动停的"，不能停得让玩家以为还在等：
 *   ① 到 60 秒上限 → `matchTimedOut()` 写一条 queue-timeout 原因，底栏说"没匹配到真人，先用 AI 开局"；
 *   ② 接口不可用 / 服务端拒了 → store 退回本机 AI 并写原因，本 effect 因 online=false 自然停；
 *   ③ 玩家自己离开 / 关大厅 / 进房间 / 房间已开局 → 换屏，cleanup 清定时器（这是"主动停"，
 *      不需要再解释；房间屏已经换成对局了）。
 * ★ 用递归 setTimeout 而不是 setInterval：一拍没回来（弱网 10 秒超时）时不会叠出两三个并发请求。
 */
import { useEffect, useRef, useState } from "react";
import { useLobby, QUEUE_POLL_MS, QUEUE_TIMEOUT_MS, ROOM_POLL_MS } from "../lobbyStore";
import { startFromLobby } from "./startFromLobby";

/**
 * 挂上大厅的联机轮询。
 * 返回 `startFailed`：服务端说开局了、但本机建局失败（理论上走不到，人数由服务端座位数给）。
 * 大厅底栏把它与"手动开局失败"合并显示 —— 原因在对局 store 的 rejection 里。
 */
export function useLobbyOnline(): { startFailed: boolean } {
  const open = useLobby((s) => s.open);
  const screen = useLobby((s) => s.screen);
  const online = useLobby((s) => s.online);
  const matchSize = useLobby((s) => s.matchSize);
  const matchStartedAt = useLobby((s) => s.matchStartedAt);
  const roomCode = useLobby((s) => s.remoteRoom?.code ?? null);
  const roomStarted = useLobby((s) => s.remoteRoom?.started ?? false);
  const roomSize = useLobby((s) => s.remoteRoom?.size ?? null);
  const [startFailed, setStartFailed] = useState(false);

  // 换一屏就把上一屏的"自动开局失败"收掉（与 Lobby 里手动开局那一条同一个理由）
  useEffect(() => {
    setStartFailed(false);
  }, [open, screen]);

  // ── 等匹配：2 秒一拍，60 秒到点主动停并退回本机 AI ──
  useEffect(() => {
    if (!open || screen !== "matching" || !online || matchSize === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // ★ 两拍一换：POST（续队 + 撮合）/ GET（只读状态）。理由在 lobbyStore.pollQueue 的 ★ 里：
    //   匹配成功之后本人已经在房里，POST 会回 409 ALREADY_IN_ROOM；只 GET 又不会推进撮合。
    let tick = 0;
    const tickOnce = async () => {
      if (cancelled) return;
      if (Date.now() - matchStartedAt >= QUEUE_TIMEOUT_MS) {
        // 主动停：matchTimedOut 会把 online 置回 false（本 effect 随之 cleanup），
        // 底栏留下"没匹配到真人，先用 AI 开局"——别让界面继续转圈
        useLobby.getState().matchTimedOut();
        return;
      }
      let next: "waiting" | "matched" | "stop";
      try {
        next = await useLobby.getState().pollQueue(tick % 2 === 0);
      } catch (err) {
        // store 里的网络错误都已经翻译成结果了；能抛到这里的是**我们自己的 bug**。
        // 但一轮询就静默死掉是最坏的一种（界面永远转圈），所以照样退回本机 AI 并留下原因。
        console.error("[lobby] 匹配轮询意外失败，退回本机 AI", err);
        useLobby.getState().fallbackMatch({ kind: "offline" });
        return;
      }
      tick += 1;
      if (cancelled || next !== "waiting") return;
      timer = setTimeout(tickOnce, QUEUE_POLL_MS);
    };
    timer = setTimeout(tickOnce, QUEUE_POLL_MS);    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, screen, online, matchSize, matchStartedAt]);

  // ── 房间里：2 秒拉一次快照（成员变动 / 准备 / 房主换人 / 开局都靠它） ──
  useEffect(() => {
    if (!open || screen !== "room" || !online || !roomCode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (cancelled) return;
      let next: "waiting" | "playing" | "stop";
      try {
        next = await useLobby.getState().pollRoom();
      } catch (err) {
        // 同匹配那一处：自己的 bug 也不能让房间屏悄悄停在旧快照上
        console.error("[lobby] 房间轮询意外失败，退回本机房间", err);
        useLobby.getState().toLocalRoom({ kind: "offline" });
        return;
      }
      // "playing" = 服务端说开局了，交给下面那个 effect 建局；"stop" = 房间没了 / 接口不可用，
      // store 已经退回本机房间并留了原因 —— 两种都该停拍
      if (cancelled || next !== "waiting") return;
      timer = setTimeout(tick, ROOM_POLL_MS);
    };
    timer = setTimeout(tick, ROOM_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, screen, online, roomCode]);

  // ── 服务端说开局了（房主点的 / 别人点的）：本机建局，大厅收掉 —— 两个入口同一条路 ──
  // ★ 用 code 去重：StrictMode 的二次 mount、以及轮询多拉到一次 playing，都只建一次局。
  const autoStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!open || screen !== "room" || !online || !roomStarted || !roomCode || roomSize === null) return;
    if (autoStarted.current === roomCode) return;
    autoStarted.current = roomCode;
    // startFromLobby 会 closeLobby → closeLobby 的 release 顺手退掉联机房间 / 排队行
    //（联机房间只是一张"谁跟谁一桌"的凭据，本机对局一开就没用了；不退的话下一局会撞 ALREADY_IN_ROOM）
    if (!startFromLobby(roomSize)) {
      autoStarted.current = null;
      setStartFailed(true);
    }
  }, [open, screen, online, roomStarted, roomCode, roomSize]);

  return { startFailed };
}
