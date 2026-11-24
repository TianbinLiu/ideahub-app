/**
 * 联机回合的推送订阅 + 轮询兜底与对账（2026-11-24；同日晚接 SSE 推送）。
 *
 * ★★ 为什么挂在这一层（而不是 store 里 setTimeout）：与 useLobbyOnline 同一条理由 ——
 *   组件卸载的那一刻 React 会跑 cleanup，定时器 / 长连接跟着停；写在 module 级 store 里就得自己记
 *   timer id / 连接句柄、自己判"现在还在不在这一局"，漏一处就是"退出对局之后还在后台每 2 秒请求一次 /
 *   那条流永远挂着"。服务端每用户只许 2 条流，泄漏一条就是下一次重连 429。
 * ★ 这一层只做"把两边对账"（服务端 = 真相，本机 = 那份界面状态）：
 *   · 服务端 round + 1 → 本机开下一回合（商店重开）；
 *   · 服务端 screening / voting → 本机阶段跟着走（联机的"全员"是房间成员，本机的全员闸不适用）；
 *   · 服务端结算 → 写回我的 hp / 淘汰位，并交给结算屏**原样渲染**（一个数都不重算）；
 *   · 轮询失败 → roundsStore 已把会话收掉并留了 fallback 原因，这里把本机 loop 接回来（补齐 AI 动作），
 *     玩家看到的是一句「回合服务没响应，这一局改成单机继续」。
 * ★★ 2026-11-24 的推送（`api/game/roomStream`）：这里是**唯一**开流 / 重连 / 关流的地方。
 *   · 优先开流：收到 `snapshot` / `update` 就交给 `useRounds.applyStream`（与轮询**同一个应用函数**，
 *     不是第二套解析 / 应用）；
 *   · 轮询**不撤**、降级为兜底：流正常时 2 秒 → 15 秒（服务端推送是单实例的，见 roundsStore 的 ★★）；
 *     流断了 / 重连期间立刻回到 2 秒 —— 所以"实时断了"也照样能打完这一局；
 *   · 能力位为假（老服务端 / 离线包）时**一条流都不开**，就是改版前那套 2 秒轮询；
 *   · 清理点：这个 effect 的 cleanup（离房 → roomCode 变 null / 转竖屏 / 离开工坊 → 组件卸载 /
 *     对局结束 → 下面那条 early return）一律 `close()`。
 * ★ 用递归 setTimeout 而不是 setInterval：一拍没回来（弱网 10 秒超时）时不会叠出两三个并发请求。
 */
import { useEffect, useRef, useState } from "react";
import {
  roomStreamCapability,
  subscribeRoomStream,
  type RoomStreamSnapshot,
  type RoomStreamSubscription,
} from "../../../api/game/roomStream";
import { subscribeServerCaps } from "../../../data/serverCaps";
import { overDecidedOf } from "../onlineHost";
import { useGame } from "../store";
import type { OnlineEventStart } from "../store";
import { useRounds } from "../roundsStore";
import type { RoundStreamState } from "../roundsStore";
import { ROUND_POLL_LIVE_MS, ROUND_POLL_MS } from "../roundsStore";
import { canRetryStream, retryDelayOf } from "../streamRetry";

/**
 * 能力位还是"不知道"（null）时隔多久再问一次（毫秒）。
 * ★ serverCaps 的探测失败要 30 秒后才允许重探（那是给 render 里高频读它的调用方节流的），
 *   而对局这一层等不了 30 秒：一局才几分钟 —— 冷启动那一发探测撞上网络抖动时，整局就没了推送。
 *   这里每 5 秒拨一次（serverCaps 自己会把"不许重探"挡回去，不会真的每 5 秒发一发）。
 */
const STREAM_CAP_RETRY_MS = 5_000;

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
  const stream = useRounds((s) => s.stream);
  /** 这一局已经判出胜负（`[]` = 平局也算）：推送没有意义了，关掉别占服务端的连接名额 */
  const over = useRounds((s) => s.winners !== null);
  const roomCode = session?.roomCode ?? null;
  /**
   * 能力位探测完毕的"滴答"：`gameRoomStream` 是**异步探到**的（健康端点），冷启动直接回到一局对局时
   * 这个 effect 第一跑可能读到 null（= 不知道）。探到了要让它重跑一次、把流开起来，
   * 否则这一整局都会悄悄停在 2 秒轮询上（功能没坏，但"实时"永远不生效，最难发现的那种）。
   */
  const [capsEpoch, setCapsEpoch] = useState(0);
  useEffect(() => {
    if (!roomCode) return;
    return subscribeServerCaps(() => setCapsEpoch((n) => n + 1));
  }, [roomCode]);

  // ── 推送：优先开流（能力位为假时一条都不开），断了指数退避重连 ──
  useEffect(() => {
    if (!roomCode) return;
    // ★ 抄一份**已经窄过的**房号给下面那个 `function open()` 用：TS 不会把外层 `const` 的窄化带进
    //   hoisted function（它可能在这个判断之前被调到），不抄就得在每处重新 `roomCode!`。
    const code = roomCode;
    // ★ 对局已经结束：榜与结算已经在本机了，再推也没有东西可推 —— 关掉（cleanup 走同一条路）。
    if (over) {
      useRounds.getState().setStream("off");
      return;
    }
    // ★ 能力位为假（老服务端 / 离线包）→ 一条流都不开，完全退回改版前那套 2 秒轮询。
    // ★ 能力位**还不知道**（null：冷启动那一发健康探测正飞着 / 刚失败、要 30 秒后才允许重探）：
    //   不能当成"没有"把这一局关死 —— 隔 5 秒再问一次，探到了这一条 effect 会重跑、把流开起来。
    //   （2026-11-24 追延迟时发现：原来的写法在这个窗口里会整局停在 2 秒轮询上，且底栏什么都不摆。）
    const capability = roomStreamCapability();
    if (capability !== true) {
      useRounds.getState().setStream("off");
      if (capability === null) {
        const timer = setTimeout(() => setCapsEpoch((n) => n + 1), STREAM_CAP_RETRY_MS);
        return () => clearTimeout(timer);
      }
      return;
    }
    let disposed = false;
    let sub: RoomStreamSubscription | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** 连续失败了几次（**收到任何一帧就清零** —— 半个小时的流中间抖一次不该把重试预算用掉） */
    let attempts = 0;

    const setStream = (next: RoundStreamState) => {
      if (!disposed) useRounds.getState().setStream(next);
    };
    const closeSub = () => {
      sub?.close();
      sub = null;
    };

    /** 收到一帧快照：流是活的（清空重试预算）→ 交给 store 的**同一个应用函数** */
    const onSnapshot = (snapshot: RoomStreamSnapshot) => {
      if (disposed) return;
      attempts = 0;
      setStream("live");
      // applyStream 内部会补齐结算 / 事件（推送帧只带 {room, round}）；它自己把失败都留在 note 里，
      // 能 reject 到这里的只有我们自己的 bug —— 别让它变成未处理的 Promise。
      void useRounds
        .getState()
        .applyStream(snapshot.room, snapshot.round)
        .catch((err) => console.error("[rounds] 应用推送快照意外失败", err));
    };

    /**
     * 重连（`end` 帧 / 网络断 / 服务端 5xx / 半截帧）。
     * ★ 一进来就把状态写成 `retrying`：轮询那一拍跟着回到 2 秒（见下面轮询 effect 的判据），
     *   重连期间不能靠 15 秒一拍的兜底 —— 那段时间正是界面最可能停在旧画面上的时候。
     */
    const retryLater = () => {
      if (disposed) return;
      closeSub();
      attempts += 1;
      if (!canRetryStream(attempts)) {
        // 5 次都没成：停流，彻底用轮询（界面那一行小字是同一句「实时连接断了，正在用轮询」）
        console.warn("[rounds] 实时连接重连 5 次都没成，这一局改用轮询", code);
        setStream("polling");
        return;
      }
      setStream("retrying");
      retryTimer = setTimeout(open, retryDelayOf(attempts));
    };

    /**
     * 开一条流（第一次连接与每次重连都走这里）。
     * ★ 用 `function` 声明而不是 `const`：下面的 `retryLater` 要在定时器里回调它（先定义后引用更省心）。
     */
    function open(): void {
      if (disposed) return;
      retryTimer = null;
      closeSub();
      sub = subscribeRoomStream(code, {
        onSnapshot,
        onUpdate: onSnapshot,
        // 心跳 = "这条流还活着"的唯一证据（服务端 20 秒一次，客户端 45 秒没有字节就当断了）
        onPing: () => {
          if (disposed) return;
          attempts = 0;
          setStream("live");
        },
        onError: (failure) => {
          if (disposed) return;
          // ★ 服务端明说"别再试了"（房没了 / 不在房里 / 服务关了 / 名额满 / 401 / 没这条路）：
          //   重连只是把同一句话再要一遍；轮询那一发会给出真正的原因。
          if (!failure.retryable) {
            console.warn("[rounds] 实时连接不可用，改用轮询", failure.code);
            setStream("polling");
            return;
          }
          retryLater();
        },
        // 服务端 30 分钟寿命到：不是错误，客户端重连（预算清零，直接从 1 秒起）
        onEnd: () => {
          if (disposed) return;
          attempts = 0;
          retryLater();
        },
      });
    }

    open();
    return () => {
      // ── 清理点（离房 / 卸载 / 转竖屏 / 对局结束）：关掉底层连接，别让服务端那边多挂一条 ──
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      closeSub();
      useRounds.getState().setStream("off");
    };
  }, [roomCode, over, capsEpoch]);

  // ── 2 秒一拍（有推送时降到 15 秒）的兜底轮询：读服务端当前回合（结算那一拍顺带把 settlement 取回来） ──
  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // ★ 推送正常 → 15 秒兜底；没开流 / 断了 / 重连中 / 已退回轮询 → 2 秒（改版前那套节奏）。
    //   判据只有 `stream` 这一个值（别在这里再问一次能力位）。
    const interval = stream === "live" ? ROUND_POLL_LIVE_MS : ROUND_POLL_MS;
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
      timer = setTimeout(tick, interval);
    };
    timer = setTimeout(tick, interval);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomCode, stream]);

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
