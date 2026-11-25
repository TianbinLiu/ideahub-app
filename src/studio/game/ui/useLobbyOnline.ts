/**
 * 大厅的联机轮询（2026-11-24 接真房间 + 回合引擎）：等匹配 / 房间快照 / 开局后铺第 1 回合的**唯一**一处定时器。
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
 * ★ 2026-11-24 接回合引擎之后，房间轮询多了一段：服务端说 `playing` 之后**不停拍**，继续当
 *   "第 1 回合铺起来没有"的等待拍（房主 `rounds/start`、其他人 `rounds/current`）；铺好就建局。
 *   ★★ Bug A 之后（同日晚）：这段等待**只有真连不上才降级** —— 业务码 `ROUND_NOT_FOUND`
 *     只是"房主慢一步"（验收现场隔 5 秒才 rounds/start），继续等；网络 / 5xx 连 3 拍才说一句
 *     再走本机单机（见下面 ROOM_START_FAIL_TOLERANCE）。房间屏那句等待态由 ui/RoomScreen 画。
 * ★ 用递归 setTimeout 而不是 setInterval：一拍没回来（弱网 10 秒超时）时不会叠出两三个并发请求。
 */
import { useEffect, useState } from "react";
import { currentUser } from "../../../data/account";
import { readRound, startRound, type RemoteRound } from "../../../api/game/rounds";
import { roomsAvailable, type RemoteRoom } from "../../../api/game/rooms";
import { roomStreamCapability, subscribeRoomStream } from "../../../api/game/roomStream";
import { useLobby, QUEUE_POLL_MS, QUEUE_TIMEOUT_MS, ROOM_POLL_MS } from "../lobbyStore";
import { useRounds } from "../roundsStore";
import { startFromLobby, startOnlineFromLobby } from "./startFromLobby";

/**
 * 房间已经 `playing`、但回合还没铺好时，**真错误**连续几拍才退回本机（2026-11-24 Bug A 之后）。
 * ★ 判据换了两次：
 *   · 原来这里叫 ONLINE_START_TIMEOUT_MS（30 秒）：不管是"房主慢"还是"连不上"，到点一律降级成单机
 *     并说「回合服务没响应」—— 验收里房主只慢了 5 秒就被判死刑（一局联机静默变单机）。
 *   · 现在：业务码 `ROUND_NOT_FOUND` → 一直等（服务端还没建回合，房主随时会补上）；
 *     只有**真连不上**（网络 / 5xx / 房间读不到）才计失败，连续 3 拍（≈6 秒，与房间快照的
 *     ROOM_FAIL_TOLERANCE 同一条纪律）才说一句再走本机。
 */
const ROOM_START_FAIL_TOLERANCE = 3;

type OnlineStartOutcome =
  | { kind: "ready"; round: RemoteRound }
  | { kind: "waiting" }
  | { kind: "failed" };

/**
 * 房间进入 playing 之后的"把回合铺起来"那一步：
 *   房主 → `POST rounds/start`（服务端要求 only host、playing 且无回合）；
 *   其他人 → `GET rounds/current` 等房间出现回合。
 * ★ 房主 start 回 `ROUND_ALREADY_STARTED`（双击 / 超时其实打上了）时**改读 current**，
 *   不把"其实已经开了"当成失败（与大厅那套 ALREADY_IN_ROOM 同一形状的坑）。
 * ★ 只有 **unavailable** 才立刻判"连不上"；业务码（ROUND_NOT_FOUND / ROUND_ALREADY_STARTED / NOT_HOST）
 *   一律先当"再等一拍"（房主还没开 / 房主转移 / 并发建回合都会这样）—— 现在**没有总上限**：
 *   房间已 playing 时房主随时可能补上 rounds/start，把它当失败就是验收里那次静默降级。
 */
async function ensureOnlineRound(remote: RemoteRoom): Promise<OnlineStartOutcome> {
  if (!roomsAvailable()) return { kind: "failed" };
  const lobby = useLobby.getState();
  // 这一拍回来时可能已经退出房间 / 换了一间：作废
  if (!lobby.online || lobby.remoteRoom?.code !== remote.code) return { kind: "failed" };
  const myUserId = currentUser()?.id ?? null;
  const isHost = myUserId !== null && remote.hostId === myUserId;

  if (isHost) {
    const started = await startRound(remote.code);
    if (started.ok) return { kind: "ready", round: started.value };
    const current = await readRound(remote.code);
    if (current.ok) return { kind: "ready", round: current.value };
    if (current.reason === "unavailable") return { kind: "failed" };
    if (current.reason === "code" && (current.code === "ROOM_NOT_FOUND" || current.code === "NOT_IN_ROOM")) {
      return { kind: "failed" };
    }
    return { kind: "waiting" };
  }

  const current = await readRound(remote.code);
  if (current.ok) return { kind: "ready", round: current.value };
  if (current.reason === "unavailable") return { kind: "failed" };
  if (current.reason === "code" && (current.code === "ROOM_NOT_FOUND" || current.code === "NOT_IN_ROOM")) {
    return { kind: "failed" };
  }
  return { kind: "waiting" };
}

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
    timer = setTimeout(tickOnce, QUEUE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, screen, online, matchSize, matchStartedAt]);

  // ── 房间屏的推送：接上服务端这条 SSE（2026-11-24） ──
  // ★★ 为什么大厅也要一条（对局里那条是另一条）：房间屏的成员表 / 人数直接决定房主键写哪一句
  //   （「开始对局」还是「用 AI 补位开局」，见 lobby.hostStartLabelOf）。2 秒轮询本来就有，
  //   但推送先到的那一拍能让"第二个人刚坐下"立刻上屏，不必等轮询、也不会被一轮失败拖成旧数据。
  // ★ 这条流**不做重连**：断了就靠 2 秒轮询（大厅不是对局，没有"实时"这条承诺）；
  //   对局开局时大厅卸载、这条流跟着关掉 —— 服务端每用户只许 2 条连接，别和开局那条抢名额。
  // ★ 能力位读的仍是 roomStreamCapability 一处；false（老服务端）一条都不开，null（还没探到）也不开
  //   —— 大厅每 2 秒本来就有一拍，等它下一次挂载/换屏再判即可，不做 5 秒一次的追问。
  useEffect(() => {
    if (!open || screen !== "room" || !online || !roomCode) return;
    if (roomStreamCapability() !== true) return;
    const sub = subscribeRoomStream(roomCode, {
      onSnapshot: (snapshot) => useLobby.getState().applyPushedRoom(snapshot.room),
      onUpdate: (snapshot) => useLobby.getState().applyPushedRoom(snapshot.room),
      onPing: () => {},
      // 断 / 服务端收尾：不重连、不弹话（底栏已经在说"正在同步房间状态…"那一类临时原因，
      // 下一拍轮询读到就会收掉）。这里只留一行控制台线索，真机上对得上服务端日志。
      onError: (failure) => console.warn("[lobby] 房间推送断了，改用 2 秒轮询", failure.code),
      onEnd: () => console.warn("[lobby] 房间推送到了服务端寿命，改用 2 秒轮询"),
    });
    return () => sub.close();
  }, [open, screen, online, roomCode]);

  // ── 房间里：2 秒拉一次快照（成员变动 / 准备 / 房主换人 / 开局都靠它） ──
  // ★ 服务端说 playing 之后**这个 effect 不停**：它继续当"回合铺起来没有"的等待拍（房主调 rounds/start、
  //   其他人读 rounds/current），直到铺好（大厅收掉 → cleanup）或超时退回本机。多一个 effect 就是多一处定时器，
  //   而这里的约束是"联机状态的轮询定时器集中一处"。
  useEffect(() => {
    if (!open || screen !== "room" || !online || !roomCode) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 真错误（连不上 / 房间读不到）连续几拍了；业务码 waiting 不算失败，一律清零 */
    let failStreak = 0;
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
      if (cancelled) return;
      if (next === "waiting") {
        timer = setTimeout(tick, ROOM_POLL_MS);
        return;
      }
      if (next === "stop") return;
      // next === "playing"：房间已经在服务端开局了 —— 把回合铺起来（房主建 / 其他人等）
      const remote = useLobby.getState().remoteRoom;
      if (!remote) return;
      let outcome: OnlineStartOutcome;
      try {
        outcome = await ensureOnlineRound(remote);
      } catch (err) {
        console.error("[lobby] 开局后铺回合意外失败", err);
        outcome = { kind: "failed" };
      }
      if (cancelled) return;
      if (outcome.kind === "ready") {
        // 本机建局 + 接上服务端第 1 回合；大厅收掉（不退房，回合引擎还要这个房间码）
        if (!startOnlineFromLobby(remote, outcome.round)) setStartFailed(true);
        return;
      }
      if (outcome.kind === "waiting") {
        // ★★ 2026-11-24 Bug A：房间已 playing、回合还没建 = **正常时序**（房主可能正慢一步）。
        //   继续等，**不降级** —— 房间屏那句「房主还没开始这一回合」由 ui/RoomScreen 画；
        //   房主补上 rounds/start 之后下一拍就 ready、本机进对局。
        failStreak = 0;
        timer = setTimeout(tick, ROOM_POLL_MS);
        return;
      }
      // 真连不上（网络 / 5xx / 房间读不到）：一次抖动不判死，连续 3 拍（≈6 秒）才降级
      // —— 与房间快照 ROOM_FAIL_TOLERANCE 同一条纪律：弱网一下就把一桌联机换成单机是最坏的那种。
      failStreak += 1;
      if (failStreak < ROOM_START_FAIL_TOLERANCE) {
        timer = setTimeout(tick, ROOM_POLL_MS);
        return;
      }
      // 失败：**不静默**。先把话说出来（游戏层底栏读 roundsStore.note），再走原来的本机开局。
      console.warn("[lobby] 连不上回合服务，这一局改成单机继续", remote.code);
      useRounds.getState().raiseFallback();
      if (!startFromLobby(remote.size)) setStartFailed(true);
    };
    timer = setTimeout(tick, ROOM_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, screen, online, roomCode]);

  return { startFailed };
}
