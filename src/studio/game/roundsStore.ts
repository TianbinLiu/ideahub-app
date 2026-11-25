/**
 * 联机回合的界面状态（2026-11-24 接上服务端回合引擎；同日晚加 SSE 推送）。
 *
 * ★★ 这一层只做三件事：**发一拍 / 写回服务端给的事实 / 把失败原因原样留着**。
 *   · 规则一条都不在这里：谁能开回合、全员交片才能展映、谁扣多少血、胜者是谁 —— 全在服务端
 *     `services/gameRound.service.js`（唯一实现），App 不重算（任务要求：榜与扣血一律渲染服务端回包）。
 *   · 定时器不在这里：轮询只有 `ui/useOnlineRounds` 一处（离房 / 组件卸载就清）。
 *   · 人话不在这里：底栏那一句由 `roundsReasons` 按 `RoundNote` 说（与 lobbyReasons 同一条分工）。
 * ★ 为什么单开一个 store（不塞进 game/store）：对局 store 的纪律是"只转发 rules"，而这一层是**网络 + 服务端事实**；
 *   混进去之后单机那份 loop 会开始读服务端的字段。界面（ui/useOnlineRounds）是唯一同时认识两边的地方。
 * ★ 依赖方向：game/store 不认识这个文件（只在类型上认 `api/game/rounds` 的 RemoteWinner），
 *   这个文件也不认识 game/store —— 两边由 ui/useOnlineRounds 对账。
 * ★★ 2026-11-24 的推送（SSE）**不在这层另开一份"应用服务端快照"**：推送来的 `{room, round}` 与轮询
 *   读回来的那两份**走同一个 `applyRemote`**（本文件里唯一一处写 session/room/snapshot/memberHp 的地方）。
 *   推送只是"更快地拿到同一份东西"：它比轮询先到就先用，慢 / 断了就由轮询兜着（见 ROUND_POLL_LIVE_MS）。
 */

import { create } from "zustand";
import { leaveRoom, readRoom, type RemoteRoom } from "../../api/game/rooms";
import {
  chooseRoundEvent,
  likeRoundEntry,
  nextRound,
  readRound,
  readRoundEvent,
  settleRound as settleRemoteRound,
  setRoundPhase,
  submitRoundEntry,
  voteRoundEntry,
  type RemoteRound,
  type RemoteRoundEntryInput,
  type RemoteRoundEvent,
  type RemoteSettlement,
  type RemoteWinner,
  type RoundsFailure,
} from "../../api/game/rounds";
import { serverGameEvents } from "../../data/serverCaps";
import { captureOnlineHistory } from "./historyCache";
import { hostIdOfRoom, onlineEventSourceOf, roomOverOf, withRoomHost } from "./onlineHost";
import { clearOnlineResume } from "./onlineResume";
import { roundWaitOf } from "./roundWait";

/** 回合屏的轮询间隔（服务端契约：轮询路径按 2 秒一次算，240 次/分钟够两台设备同时开着）。 */
export const ROUND_POLL_MS = 2_000;

/**
 * 推送**正常**时轮询放慢到 15 秒（2026-11-24 SSE）。
 * ★★ 为什么轮询一拍都不停（而不是"有流就关掉轮询"）：服务端的推送是**单实例**的 ——
 *   线上是 pm2 cluster（2 实例）+ nginx，一次写只推给**同一进程**上的订阅者（服务端
 *   `services/gameRoomStream.service.js` 头上那段 ★★）。另一实例上的这一端收不到那一帧，
 *   而它以为自己"实时" —— 轮询是唯一能把那一帧补回来的东西，拆了就是"某些局每回合慢一拍、
 *   偶尔完全不刷新"，且只在线上两台机器上才复现。
 * ★ 15 秒：兜底够快（比一整屏发呆短得多），又不至于让两台设备各自多打一轮请求
 *   （服务端 `game-room-poll` 限流 240/分钟；15 秒 = 4 次/分钟）。
 * ★ 流断了 / 重连期间**立刻回到 ROUND_POLL_MS** —— 见 ui/useOnlineRounds。
 */
export const ROUND_POLL_LIVE_MS = 15_000;

/**
 * 推送那条长连接现在的状态（底栏那一行小字，唯一来源）。
 *   `off`      = 没开流（能力位为假 / 单机局 / 已经收起）—— 界面上不摆那一行
 *   `live`     = 流正常收帧 —— 「实时连接中」
 *   `retrying` = 断了、正在退避重连 —— 轮询已回到 2 秒，界面说「实时连接断了，正在用轮询」
 *   `polling`  = 重连 5 次都没成（或服务端明说别重连），彻底退回 2 秒轮询 —— 同一句话
 * ★ 界面只读这一个值说那一行字（判据不在 GameLayer 里自己拼）。
 */
export type RoundStreamState = "off" | "live" | "retrying" | "polling";

/** 房间里的一个真人（hp 是服务端的真相；对局里每回合结算会把它写回本地视图）。 */
export interface RoundMember {
  userId: string;
  name: string;
  hp: number;
}

/** 开局时从大厅手里接过的那一份联机上下文（房间码 / 我是谁 / 谁是房主 / 同桌几个人）。 */
export interface OnlineRoundSession {
  roomCode: string;
  /** 服务端账号 id（快照里的 userId）；不是本机座位的 "me" */
  myUserId: string;
  myName: string;
  isHost: boolean;
  members: RoundMember[];
}

/**
 * 底栏那一句的结构化原因（文案在 roundsReasons，唯一一处）。
 *   fallback = 这一局已经退回单机（真连不上时的一句「连不上回合服务（网络/服务异常），这一局改成单机继续」）
 *   unavailable = 这一拍没成功，还能重试（不切单机）
 *   waiting / waiting-long = 房间已开局、房主还没建这一回合（**正常时序**，继续轮询，不切单机）
 *   code = 服务端明确拒了这一步（认码，不认 message）
 */
export type RoundNote =
  /**
   * ★ `code`（2026-11-24 对局内 P0-2 补）：退回单机时**服务端到底说了什么**。
   *   被房主移出 / 房间过期 / 回合服务被关掉（`NOT_IN_ROOM` / `ROOM_NOT_FOUND` /
   *   `GAME_ROUNDS_OFF`）与"这一拍没连上"是两件事：前者要弹红条 + 回大厅，
   *   后者只该留一句"这一局改成单机继续"。原来 abandon 把码吞掉了，界面上只能看到同一句，
   *   于是"我被踢了"和"网络抖了一下"长得一模一样（铁律八：别把两种结局压成一句）。
   *   null / 缺省 = 传输层失败（超时 / 断网）或那条路本来就没有码。
   */
  | { kind: "fallback"; code?: string | null }
  | { kind: "unavailable" }
  /**
   * ★★ 2026-11-24 Bug A：房间 `playing`、`GET rounds/current` 回业务码 `ROUND_NOT_FOUND`
   *   （服务端还没建回合）是**正常时序**，不是错误 —— 客人继续轮询、底栏说一句「房主还没开始这一回合」。
   *   `waiting-long` = 已经等过 `roundWait.ROUND_WAIT_MAX_MS`（3 分钟）：仍然**不降级**，只把话说明。
   *   ★ 这两种绝不能与 `fallback` 共用界面：原来共用一句「回合服务没响应，这一局改成单机继续」，
   *     玩家在房主慢 5 秒时就被告知这一局没了，然后对手变成本机 AI（验收抓到的现场）。
   */
  | { kind: "waiting" }
  | { kind: "waiting-long" }
  | { kind: "code"; code: string };

/**
 * 这一回合的事件读到哪一步了（服务端出题那一条路）。
 *   `idle`   = 还没问（不是结算阶段 / 能力位还没探到 → 下一拍再问）
 *   `server` = 服务端给了一份事件（见 `event`）—— 同一房间同一回合，所有人是同一道题
 *   `none`   = 这一回合我不该弹事件（第 1/3/5… 回合、这局已经结束、我已被淘汰、已经翻篇）
 *   `local`  = **退回本机事件**（能力位为假 / 接口不可用）：界面要写明「事件只在本机生效」
 */
export type RoundEventState = "idle" | "server" | "none" | "local";

export interface RoundsStore {
  /** null = 这一局不是联机回合（单机 / 已经退回单机） */
  session: OnlineRoundSession | null;
  /**
   * 服务端房间快照（**每拍和回合一起读**，见 poll）。
   * ★ 房主转移 / 成员血量 / 结束判定都读它：回合快照（rounds/current）里**没有 hostId**，
   *   服务端也只在房间快照里说"谁是房主"（hostId + members[].isHost 同一事实）。
   */
  room: RemoteRoom | null;
  /** 服务端当前回合快照（entries 的顺序就是展映顺序：服务端给什么顺序就播什么） */
  snapshot: RemoteRound | null;
  /** 服务端结算（榜与扣血只认它） */
  settlement: RemoteSettlement | null;
  /** 胜者；null = 还没结束（缺省） / [] = 结束但平局 */
  winners: RemoteWinner[] | null;
  /**
   * 服务端出的这一回合事件（`gameEvents` 能力位为真、这一回合已 `settled` 时才读）。
   * ★ 同一房间同一回合，每个人的 `eventId` 一样 —— 这是"跨端同一道题"的唯一来源。
   * ★ null + eventState=local 时，事件走本机那一套（各抽各的，界面写明只在本机生效）。
   */
  event: RemoteRoundEvent | null;
  eventState: RoundEventState;
  note: RoundNote | null;
  /** 推送那条长连接的状态（底栏一行小字的**唯一来源**；`off` = 没开流） */
  stream: RoundStreamState;
  /** 一个动作在飞（按钮灰掉用） */
  busy: boolean;
  /** 结算请求在飞（自动结算与手点不要撞在一起） */
  settling: boolean;
  /** 自动结算这一回合试过没有（投票全表完只自动试一次，失败等刷新） */
  autoSettleTriedRound: number | null;
  /** 我弃权的是哪一回合（服务端快照不暴露"我弃权了"，只有我这一端的这一格能说出来） */
  abstainedRound: number | null;
  /**
   * 同桌每个真人当前的 hp（userId → 血）。
   * ★ 服务端的回合快照**不带 hp**（hp 在房间快照 / 结算回包里），而对局中要一直显示对手血量：
   *   开局时从房间快照灌一份，之后每次结算的 ranking 行覆盖一次 —— 被淘汰的人下一回合不在 ranking 里，
   *   所以这份记录是**跨回合**留着的（否则出局的人会一直显示满血）。
   */
  memberHp: Record<string, number>;

  begin: (session: OnlineRoundSession, snapshot: RemoteRound) => void;
  /** 收掉整个会话（不主动退房；退出对局时用 leaveNow） */
  reset: () => void;
  /** 退出对局：先清状态，再尽力退掉服务端房间（失败只在控制台留一行） */
  leaveNow: () => void;
  /** 大厅开局失败时把「这一局改成单机」这句话摆出来（此时还没有会话） */
  raiseFallback: () => void;
  /**
   * 轮询/对账自己出了意外（我们的 bug，不是网络）：也说一句、收掉会话，别让界面永远停在最后一帧。
   * ★ 与 poll 里的失败分开：那条路会顺带尽力退房（abandon 内部做），这里复用同一份。
   */
  failNow: () => void;
  clearNote: () => void;
  /** 写推送状态（**只由 ui/useOnlineRounds 写**；界面只读，别在别处改它） */
  setStream: (state: RoundStreamState) => void;
  /**
   * 推送来的一帧（`{room, round}`）：与轮询读回来的那两份走**同一个 `applyRemote`**，
   * 之后照旧补齐结算 / 事件（这两样不在推送帧里，服务端只推 `{room, round}`）。
   * ★ 幂等：同一份快照重复来一次只是把同样的值再写一遍（服务端每次变化推整份）。
   */
  applyStream: (room: RemoteRoom | null, round: RemoteRound | null) => Promise<void>;
  /** 轮询一拍：读 current；到结算阶段就把 settlement 取回来。 */
  poll: () => Promise<"ok" | "stop" | "fallback">;
  submit: (input: RemoteRoundEntryInput) => Promise<boolean>;
  advance: (phase: "screening" | "voting") => Promise<boolean>;
  like: (targetUserId: string) => Promise<boolean>;
  vote: (targetUserId: string | null) => Promise<boolean>;
  settle: () => Promise<boolean>;
  next: () => Promise<"round" | "over" | "waiting">;
  /**
   * 记下我的事件选择（`"skip"` = 跳过；服务端幂等、第一选作数）。
   * ★ 这里**只写服务端那一份**：本地效果（扣金币 + `effects.client`）由 game store 落
   *   （见 ui/OnlineEventPanel → store.chooseOnlineEvent）—— 两个 store 互不认识，界面那一层对账。
   */
  chooseEvent: (optionId: string) => Promise<boolean>;
  /** 只刷新房间快照（事件回血之后立刻读回服务端那份 hp，别等 2 秒那一拍） */
  refreshRoom: () => Promise<void>;
}

function noteOfFailure(failure: RoundsFailure): RoundNote {
  return failure.reason === "code" ? { kind: "code", code: failure.code } : { kind: "unavailable" };
}

/** 结算回包里的 winners（userId）→ 界面要的名字：名字从榜单行里现拼，拼不到就 null（界面回 userId）。 */
function winnersOf(settlement: RemoteSettlement): RemoteWinner[] | null {
  if (settlement.winners === undefined) return null;
  return settlement.winners.map((userId) => ({
    userId,
    name: settlement.ranking.find((row) => row.userId === userId)?.name ?? null,
  }));
}

/** 结算回包里每一行的 hp → 跨回合的 memberHp 记录（被淘汰的人也写进去，下一回合不在 ranking 里也还留着 0）。 */
function hpOfSettlement(settlement: RemoteSettlement): Record<string, number> {
  const hp: Record<string, number> = {};
  for (const row of settlement.ranking) hp[row.userId] = row.hp;
  return hp;
}

/**
 * 房间快照的 `members[].hp` → memberHp 那一份。
 * ★ 这是联机局里 hp 的**服务端真相**（结算回包只是它在结算那一刻的同一份）：事件回血由服务端落库，
 *   本机不应用 —— 新血量就从这里读回来（docs/game-lobby.md §7.5）。
 */
function hpOfRoom(room: RemoteRoom): Record<string, number> {
  const hp: Record<string, number> = {};
  for (const member of room.members) hp[member.userId] = member.hp;
  return hp;
}

/**
 * 事件 GET 的哪些业务码算"这一回合我不该有事件"（**不是失败**，收手即可）。
 * ★ `ROUND_NOT_SETTLED` 也在这里：读到它说明房主已经点了下一回合（或者这一拍晚了一步）——
 *   这一回合的事件作废，等新回合。真正的失败只有 `unavailable`（超时 / 5xx / 形状不认识）。
 */
function isEventAbsent(code: string): boolean {
  return (
    code === "NO_EVENT" ||
    code === "GAME_OVER" ||
    code === "ROUND_NOT_SETTLED" ||
    code === "PLAYER_ELIMINATED" ||
    code === "NOT_IN_ROOM" ||
    code === "ROOM_NOT_FOUND" ||
    code === "ROUND_NOT_FOUND"
  );
}

export const useRounds = create<RoundsStore>((set, get) => {
  /**
   * 推送应用过几份快照（**只给"这一拍轮询是不是比推送旧"用**，不进 state：界面不该读它）。
   * ★★ 为什么需要：推送与轮询是两个来源，而 HTTP 响应可能**比它代表的那一刻更晚到** ——
   *   一拍 `GET rounds/current` 在提交交片之前发出、在推送之后才回来，就会把刚推来的 `allSubmitted:true`
   *   又盖回 `false`。真机上表现为"所有人都交了片，房主那颗开始展映键又灰了 2 秒"（2026-11-24 本机实测
   *   撞到过一次：推送 36ms 就到了，随后一拍旧响应把它盖回去）。判据：轮询**在飞的这段时间里**推送应用过
   *   快照 → 丢掉这一拍（推送一定不比它旧，下一拍 2~15 秒后再读）。
   */
  let pushSeq = 0;

  /**
   * 「房间已 playing、回合还没建」这一段是从哪一拍开始的（毫秒；null = 没在等 / 已经读到回合）。
   * ★ 只给 `roundWait.ROUND_WAIT_MAX_MS` 那个上限用：正常开局 2~4 秒，超过 3 分钟才把话说明
   *   （见 roundWait.ts 文件头）。**不进 state**：界面读的是 note（waiting / waiting-long），
   *   这个时刻每 2 秒变一次，进 state 会让整棵树白重渲。
   * ★ 重置点只有三处：读到回合（成功那拍）、开新会话（begin）、收掉会话（reset / abandon）。
   */
  let roundWaitSince: number | null = null;

  /**
   * 走之前**趁还是房间成员**把这一局的历史留一份到本机（2026-11-24 Bug B）。
   * ★★ 为什么在退房这一拍做：战绩屏的 403 `NOT_IN_ROOM` 说明读接口要成员身份 ——
   *   退出房间之后再点大厅「最近一局回放」就只剩一句"你不在这一局里了"。
   *   开着战绩屏时读到的那一份已经由 historyStore 落盘；这里补的是"没开过战绩屏、
   *   打完 / 认输直接从结束屏回大厅"的那条路（验收现场就是这条）。
   * ★ 先发历史那一发、再发退房：捕获的 promise 先同步发出请求（fetch 那一刻），退房紧随其后。
   *   即使退房先到，最坏也只是这一份没留下 —— 不挡玩家离开，也不改任何界面状态。
   * ★ 失败不叠话（与退房失败同一条）：这一局对玩家已经结束了，控制台留一行就够。
   */
  const leaveAfterSnapshot = (session: OnlineRoundSession): void => {
    void captureOnlineHistory(session.roomCode, session.myUserId).catch((err) =>
      console.warn("[history] 离开房间前留一份历史时意外失败（不影响离开）", err),
    );
    void leaveRoom(session.roomCode).then((res) => {
      if (!res.ok) console.warn("[rounds] 退出时退房失败（服务端可能还挂着，房寿命会收掉）", session.roomCode);
    });
  };

  /**
   * 放弃这一局联机：**先把话说出来**（note 留着），再把状态收掉，最后尽力退房。
   * ★ 退房失败不再叠一句话：服务端 30 分钟房寿命 / playing 2 小时会收掉它；
   *   对玩家来说这一局已经改成单机了，再报一句退房失败只会让底栏更乱。
   */
  const abandon = (note: RoundNote) => {
    const session = get().session;
    set({
      session: null,
      room: null,
      snapshot: null,
      settlement: null,
      winners: null,
      event: null,
      eventState: "idle",
      memberHp: {},
      note,
      // 退回单机 = 不再有推送（会话没了，ui/useOnlineRounds 的那个 effect 也会跟着关掉连接）
      stream: "off",
      busy: false,
      settling: false,
      abstainedRound: null,
      autoSettleTriedRound: null,
    });
    // 这一局已经改成单机了：下次冷启动不该再尝试恢复它（否则会把人拉回一张已经打完的联机桌）
    clearOnlineResume();
    // 等待的计时器跟着会话一起清（下一个会话从 0 开始算）
    roundWaitSince = null;
    if (session) leaveAfterSnapshot(session);
  };

  /** 当前会话还在不在（await 之后必须重新问一次：可能已经退回单机 / 换了一局）。 */
  const sessionNow = (roomCode: string): OnlineRoundSession | null => {
    const session = get().session;
    return session && session.roomCode === roomCode ? session : null;
  };

  /** userId → 界面上的名字（服务端只存 id；名字从结算榜 / 房间快照现拼，拼不到就 null）。 */
  const namesOfIds = (ids: readonly string[]): RemoteWinner[] => {
    const settlement = get().settlement;
    const room = get().room;
    return ids.map((userId) => ({
      userId,
      name:
        settlement?.ranking.find((row) => row.userId === userId)?.name ??
        room?.members.find((member) => member.userId === userId)?.displayName ??
        null,
    }));
  };

  /**
   * 判定这一局结束（winners 空数组 = 平局）。
   * ★ 同时收掉本机那条"恢复这一局"的记录：下次冷启动再把人拉回一张已经打完的牌桌没有意义。
   * ★ 只写一次：服务端快照每 2 秒一张，胜者名单不会变；反复写会让界面每拍重渲（且覆盖掉结算回包补上的名字）。
   */
  const markOver = (ids: readonly string[]): void => {
    if (get().winners !== null) return;
    set({ winners: namesOfIds(ids) });
    clearOnlineResume();
  };

  /**
   * 读这一回合的**服务端事件**（2026-11-23 服务端出题）。
   * ★ 只问一次：读回来就把 `eventState` 定下来，2 秒一拍不会再问同一道题（服务端限流够，但没必要）。
   * ★ 三分支（**这三分支决定界面上"是不是同一道题"**）：
   *   · 能力位为假（老服务端）→ `local`：退回本机事件，界面写明「事件只在本机生效」；
   *   · 能力位还没探到（null）→ `idle`：下一拍再问，别急着把这一回合判成"本机"；
   *   · 接口这一发失败（超时 / 5xx / 形状不认识）→ 也是 `local`（退回本机，并明说）；
   *     业务码说这一回合我没有事件（非事件回合 / 已结束 / 已淘汰 / 已翻篇）→ `none`（照常 round-end）。
   */
  const pullEvent = async (
    roomCode: string,
    round: number,
  ): Promise<{ event: RemoteRoundEvent | null; eventState: RoundEventState }> => {
    const capability = serverGameEvents();
    const source = onlineEventSourceOf(capability);
    // 能力位还没探到（健康端点慢半拍）：这一拍什么都不定，下一拍再问 —— 别急着判成本机
    if (source === "unknown") return { event: null, eventState: "idle" };
    if (source === "local") return { event: null, eventState: "local" };
    const res = await readRoundEvent(roomCode);
    if (!res.ok) {
      const absent = res.reason === "code" && isEventAbsent(res.code);
      return { event: null, eventState: absent ? "none" : "local" };
    }
    // 读回来的时候回合可能已经翻篇（房主恰好在读的那一拍点了下一回合）：这一份事件作废
    if (get().snapshot?.round !== round) return { event: null, eventState: "none" };
    return { event: res.value, eventState: "server" };
  };

  /**
   * 结算已经拿到、事件还没问（手动结算那条路 / 能力位第一次还是 null）：补问一次。
   * ★ 幂等：`eventState !== "idle"` 直接返回 —— 轮询每 2 秒都会叫它一次。
   */
  const ensureEvent = async (): Promise<void> => {
    const session = get().session;
    const snapshot = get().snapshot;
    if (!session || !snapshot) return;
    if (snapshot.phase !== "settled" || !get().settlement) return;
    if (get().eventState !== "idle" || get().winners !== null) return;
    const part = await pullEvent(session.roomCode, snapshot.round);
    if (!sessionNow(session.roomCode)) return;
    // await 之间可能已经翻篇 / 已经有人把这一回合问过了：这一份作废
    if (get().snapshot?.round !== snapshot.round || get().eventState !== "idle") return;
    set(part);
  };

  /**
   * 动作被服务端按"你不再是房主 / 这一步已经晚了一步"拒了：拉一拍快照再回来，**不把这句话留在底栏**。
   * ★ 房主转移之后的竞态：旧房主的键还亮着的那一拍点下去，服务端先判房主 → 回 NOT_HOST；
   *   界面若照实写"这一步只有房主能做"，玩家会以为自己被踢了；其实下一拍新房的键就出来了。
   * ★ 不在这里吞掉真正的业务原因：只有 NOT_HOST / WRONG_PHASE / ROUND_NOT_SETTLED 这三种"竞态码"走这条路。
   */
  const resyncOnRace = async (roomCode: string): Promise<void> => {
    if (!sessionNow(roomCode)) return;
    try {
      await get().poll();
    } catch (err) {
      // poll 自己会把网络失败翻译成 fallback；能抛到这里的是我们自己的 bug —— 别让按钮卡在 busy
      console.error("[rounds] 竞态之后重拉快照意外失败", err);
    }
  };

  /**
   * 服务端的一对快照（房间 + 回合）→ 本机状态。**轮询与推送共用的唯一一处**。
   *
   * ★★ 为什么必须是同一个函数：推送与轮询拿到的是**同一份东西**（服务端 `buildSnapshot` 与
   *   `GET /rooms/:code` + `GET rounds/current` 同形）。两处各写一份的后果是"推送先到的那一刻
   *   房主身份不刷新 / 新回合不清上一回合的结算"——而这类偏差只在有流的机器上出现，
   *   时快时慢，最难复现。
   * ★ `round` 为 null 是**正常状态**（房间还没开第一回合）：此时只应用房间，别把已有的回合清掉。
   */
  const applyRemote = (room: RemoteRoom | null, round: RemoteRound | null): void => {
    const session = get().session;
    if (!session) return;
    const prev = get().snapshot;
    const nextSnapshot = round ?? prev;
    // 房间那一发失败（超时 / 老服务端）时调用方传 null：沿用上一份房主 / 血量，别把它清掉
    const nextRoom = room ?? get().room;
    // 房主身份每一份快照都对一次：服务端把 hostId 转给别人之后，新晋房主**不必退出重进**
    // （开局那一份只带座位 / 血，房主是房间快照的真相）。
    const hostId = hostIdOfRoom(nextRoom);
    const nextSession = hostId === null ? session : withRoomHost(session, hostId);
    const roundChanged = prev?.round !== nextSnapshot?.round;
    const note = get().note;
    // ★ 2026-11-24 Bug A：`waiting` / `waiting-long` 是「回合还没建」的临时状态 —— 回合一旦读到
    //   （轮询成功 / 推送送来了第一个回合）就要收掉，否则"房主还没开始这一回合"会一直挂在底栏，
    //   而玩家其实已经在打了。与 `unavailable` 同一处理：**只收临时原因**，业务拒绝照旧留着。
    //   ★ 只有**这一拍真的拿到了回合**才收 waiting：等待期间推送帧也只带 `{room, round:null}`，
    //     按"只要 applyRemote 就清"写会让那一句每来一帧闪一下就回来。
    const noteIsTransient =
      note?.kind === "unavailable" ||
      ((note?.kind === "waiting" || note?.kind === "waiting-long") && round !== null);
    set({
      session: nextSession,
      room: nextRoom,
      snapshot: nextSnapshot,
      // 同桌血量每拍都对一遍房间快照（`members[].hp` 是服务端的真相）：事件回血由服务端落库，
      // 本机不应用 —— 对手条 / 存活人数从这里读到它（结算那一份仍是结算时刻的同一份数）。
      memberHp: room ? { ...get().memberHp, ...hpOfRoom(room) } : get().memberHp,
      // 只清"这一拍没连上 / 回合还没建"那种临时原因：服务端的业务拒绝（NOT_HOST / CANNOT_LIKE_SELF …）
      // 要留在屏上让人看清，下一次动作成功 / 玩家点 ✕ 才收 —— 别让一秒一次的推送把它一闪就擦掉。
      note: noteIsTransient ? null : note,
      // 新回合：上一回合的结算 / 弃权 / 事件全部作废（服务端每一回合都是新的一份）
      ...(roundChanged
        ? {
            settlement: null,
            winners: null,
            abstainedRound: null,
            autoSettleTriedRound: null,
            event: null,
            eventState: "idle" as const,
          }
        : {}),
    });
    // ── 这局结束了吗（房主 / 非房主都在这一份快照里知道）──────────────────────────
    // 服务端 2026-11-23 起在房间快照里给了 state / winners（结束那一刻由 rounds/next 落库），
    // 读不到才走 onlineHost 的过渡分支（老服务端按 hp 推）。判据只有一处。
    if (nextSnapshot) {
      const over = roomOverOf(nextRoom, nextSnapshot.phase);
      if (over) markOver(over.winners);
    }
  };

  /**
   * 结算：把服务端落库的那一份取回来（幂等；重复调用不会重复扣血）。
   * ★ winners 用"服务端这次给了才覆盖"：平局时服务端的结算回包**不带 winners**（空数组被
   *   gameRound.settlementOf 省掉），照旧写 null 会把轮询已经判出来的"平局"清掉 —— 结算屏一刷新又变回"还没结束"。
   */
  const pullSettlement = async (): Promise<void> => {
    const session = get().session;
    const snapshot = get().snapshot;
    if (!session || !snapshot || get().settlement || get().settling) return;
    const autoRound = snapshot.phase === "voting" && snapshot.votesPending === 0;
    if (autoRound && get().autoSettleTriedRound === snapshot.round) return;
    set({ settling: true, ...(autoRound ? { autoSettleTriedRound: snapshot.round } : {}) });
    try {
      const res = await settleRemoteRound(session.roomCode);
      if (!sessionNow(session.roomCode)) return;
      if (!res.ok) {
        // 这一拍失败不切单机：轮询下一拍会再读 current；真的连不上时轮询自己会先退
        set({ note: noteOfFailure(res) });
        return;
      }
      const remoteWinners = winnersOf(res.value.settlement);
      // ★ 事件与结算**同一拍读回来**：界面拿到结算的那一刻就有题（不必先停一屏 round-end，
      //   也就没有"房主在这一拍抢先点了下一回合、事件还没弹过"的窗口）。
      const eventPart = await pullEvent(session.roomCode, snapshot.round);
      if (!sessionNow(session.roomCode)) return;
      set({
        ...(remoteWinners !== null ? { winners: remoteWinners } : {}),
        settlement: res.value.settlement,
        // 结算行的 hp 是服务端的真相：覆盖进跨回合记录（对手条 / 交片的 x/y 都读它）
        memberHp: { ...get().memberHp, ...hpOfSettlement(res.value.settlement) },
        note: null,
        // 结算回包确认了阶段：把快照的 phase 对齐（entries 还是上一份的 entries）
        snapshot: get().snapshot ? { ...(get().snapshot as RemoteRound), phase: "settled" } : null,
        event: eventPart.event,
        eventState: eventPart.eventState,
      });
      if (remoteWinners !== null) clearOnlineResume();
    } finally {
      set({ settling: false });
    }
  };

  /**
   * 这一份快照到"该取结算 / 该补事件"的那一步了吗（轮询与推送共用的**唯一一处**）。
   * ★ 推送帧只带 `{room, round}`：`phase` 变成 `settled` 那一刻结算榜不在帧里，得自己 `POST settle`
   *   取回来。放在这一处而不是各写一遍 —— 推送那条路漏了它，症状是"流一切正常、结算屏永远不出现"。
   * ★ 全员表态（`voting` + `votesPending === 0`）也算：服务端允许任何成员触发自动结算（§7.5）。
   */
  const settleIfDue = async (): Promise<void> => {
    const snapshot = get().snapshot;
    if (!snapshot) return;
    if (snapshot.phase !== "settled" && !(snapshot.phase === "voting" && snapshot.votesPending === 0)) return;
    await pullSettlement();
    // 结算已经拿到、事件还没问（手动结算那条路 / 能力位刚探到）：补问一次
    await ensureEvent();
  };

  return {
    session: null,
    room: null,
    snapshot: null,
    settlement: null,
    winners: null,
    event: null,
    eventState: "idle",
    note: null,
    // 开不开流由 ui/useOnlineRounds 判能力位；单机局里永远停在 off（界面那一行小字也不摆）
    stream: "off",
    busy: false,
    settling: false,
    autoSettleTriedRound: null,
    abstainedRound: null,
    memberHp: {},

    begin: (session, snapshot) => {
      // 新会话：等待计时从 0 算（上一局"房主还没开"的那一段不该带进来）
      roundWaitSince = null;
      set({
        session,
        // room 由轮询的第一拍（≤ 2 秒）从 GET /rooms/:code 灌进来；开局这一份只带座位 / 血，
        // 不逼调用方多传一个参数（host 身份在 poll 里也会再对一次，房间快照是真相）。
        snapshot,
        // 开局时房间快照里的 hp 就是起点；之后每次结算 / 每拍房间快照再覆盖（见 memberHp 的 ★）
        memberHp: Object.fromEntries(session.members.map((member) => [member.userId, member.hp])),
        settlement: null,
        winners: null,
        event: null,
        eventState: "idle",
        note: null,
        // 新一局从"没开流"开始：`useOnlineRounds` 的那个 effect 会按能力位重新开一条
        stream: "off",
        busy: false,
        settling: false,
        autoSettleTriedRound: null,
        abstainedRound: null,
      });
    },

    reset: () => {
      // 退出对局 = 这一局不再"可恢复"（leaveNow 走这一条；下次冷启动别把人拉回一张已经离席的牌桌）
      clearOnlineResume();
      roundWaitSince = null;
      set({
        session: null,
        room: null,
        snapshot: null,
        settlement: null,
        winners: null,
        event: null,
        eventState: "idle",
        note: null,
        stream: "off",
        busy: false,
        settling: false,
        autoSettleTriedRound: null,
        abstainedRound: null,
        memberHp: {},
      });
    },

    leaveNow: () => {
      const session = get().session;
      get().reset();
      // 先清界面再退房：退出对局是玩家决定了的事，不该卡在"正在离开"；
      // 退房前顺手把这一局的历史留一份（见 leaveAfterSnapshot 的 ★★）。
      if (session) leaveAfterSnapshot(session);
    },

    raiseFallback: () => set({ note: { kind: "fallback" } }),

    failNow: () => abandon({ kind: "fallback" }),

    clearNote: () => set({ note: null }),

    setStream: (stream) => set({ stream }),

    applyStream: async (room, round) => {
      const session = get().session;
      if (!session) return;
      const code = session.roomCode;
      // ★ 与轮询**同一套应用逻辑**（见 applyRemote 的 ★★）：房里 / 房主 / 血量 / 结束判定一个都不重写
      pushSeq += 1;
      applyRemote(room, round);
      if (!sessionNow(code)) return;
      // 推送帧只带 {room, round}：结算与事件要自己补（见 settleIfDue 的 ★）
      await settleIfDue();
    },

    poll: async () => {
      const session = get().session;
      if (!session) return "stop";
      const code = session.roomCode;
      // ★ 这一拍开始时的推送序号：回来时若已经变了，说明推送应用过更新的快照（见 pushSeq 的 ★★）
      const pushSeqAtStart = pushSeq;
      // ★★ 两发一起读：回合（打什么）+ 房间（谁在推进 / 谁还活着 / 这局结束没有）。
      //   ★ 房间快照**每拍都读**（正常 2 秒一次；有推送时放宽到 15 秒，见 ROUND_POLL_LIVE_MS）：
      //     房主转移是服务端自己改的、回合快照里没有 hostId —— 不读房间就永远不知道新主人是谁。
      //   ★ 两发并发：弱网时 10 秒超时叠住下一拍的问题与原来一样，但总时长是 max(两发) 不是两倍。
      const [roundRes, roomRes] = await Promise.all([readRound(code), readRoom(code)]);
      if (!sessionNow(code)) return "stop";
      if (!roundRes.ok) {
        // ★★ 2026-11-24 Bug A：先把「房主还没开这一回合」这种**正常时序**从真错误里分出来。
        //   判据只在 roundWait.roundWaitOf 一处（零依赖，check-game-online.mjs 跑正反例）：
        //   · 业务码 ROUND_NOT_FOUND / NO_ACTIVE_ROUND → 继续等（不降级、不收会话）；
        //   · 网络 / 5xx / 认不出的码 → 下面那套现有 fallback。
        //   ★ 这一支原来是 `if (!roundRes.ok) → abandon(fallback)`：房主慢 5 秒，客人就把整局
        //     降级成单机、对手变成 AI，而服务端那间房还在（验收抓到的现场）。
        const waited = roundWaitSince === null ? 0 : Date.now() - roundWaitSince;
        const waitOutcome = roundWaitOf(roundRes, waited);
        if (waitOutcome !== "fallback") {
          if (roundWaitSince === null) roundWaitSince = Date.now();
          // 等待期间房间快照照旧应用：房主转移 / 谁还活着 / 这局结束没有，都要跟服务端对齐
          // （回合那一格传 null = 沿用上一份，不把已有回合清掉）。
          if (roomRes.ok) applyRemote(roomRes.value, null);
          if (!sessionNow(code)) return "stop";
          // 只在**变化**时写 note：这一段每 2 秒一拍，每拍 set 一次会让整棵树白重渲。
          // ★ 也不覆盖服务端的业务拒绝（code）：那一句要留在屏上让人看清，等回合建好也不会自己回来。
          const kind = waitOutcome === "waiting-long" ? "waiting-long" : "waiting";
          const current = get().note;
          const replaceable =
            current === null ||
            current.kind === "unavailable" ||
            current.kind === "waiting" ||
            current.kind === "waiting-long";
          if (replaceable && current?.kind !== kind) set({ note: { kind } });
          // 返回 "ok" 而不是 "fallback"：ui/useOnlineRounds 的轮询循环据此继续排下一拍。
          return "ok";
        }
        // ★★ 推送到位 / 正在重连时轮询只是**兜底**：弱网下这一拍超时不该把整局判死 —— 主通道还在推
        //   （`live`）或正在退避重连（`retrying`：最多 5 次、~30 秒），真断了由推送那边的看门狗认
        //   （api/game/roomStream 的 STREAM_STALL_MS）。★ 这**不会无限期拖着**：重连预算用完就变
        //   `polling`，从那一刻起轮询失败照旧收场。
        //   ★ 但服务端**明确回了业务码**（NOT_IN_ROOM / ROOM_NOT_FOUND …）是事实，照旧收场：
        //     被移出房间这种结局，轮询那一发比推送的下一帧先知道（推送只在有人动的时候才来一帧）。
        if ((get().stream === "live" || get().stream === "retrying") && roundRes.reason === "unavailable") {
          console.warn("[rounds] 兜底轮询这一拍没连上（推送还在 / 正在重连），下一拍再试", code);
          return "ok";
        }
        // ★ 这一拍在飞的时候推送应用过更新的一帧 → 这一份失败可能已经过时（HTTP 响应晚到），不判死。
        if (pushSeq !== pushSeqAtStart) return "ok";
        // ★ 轮询是这一局的"心跳"：它失败就是真的断了（一两发的业务错误不会走到这儿）。
        //   按任务要求**不静默**：留一句 fallback，界面（ui/useOnlineRounds）据此把本地 loop 接回来。
        // ★ 业务码**原样带上**（2026-11-24 对局内 P0-2）：被移出房间 / 房间过期 / 回合服务被关，
        //   与"这一拍没连上"是两种结局 —— 顶部红条只认前一种（connection.isRoomGone 一处判）。
        console.warn("[rounds] 回合快照轮询失败，这一局退回单机", roundRes.reason === "code" ? roundRes.code : "unavailable");
        abandon(roundRes.reason === "code" ? { kind: "fallback", code: roundRes.code } : { kind: "fallback" });
        return "fallback";
      }
      // 回合读到了：等待计时清零（下一段"房主还没开"重新从 0 算）
      roundWaitSince = null;
      // 房间这一发失败（超时 / 老服务端）**不切单机**：沿用上一份房主 / 血量，下一拍再问；
      // 真正的"房间没了"回合那发也会失败，走上面那条 fallback。
      // ★ 这一拍在飞的时候推送应用过更新的快照 → 这一份可能更旧（HTTP 响应晚到），整拍丢掉（见 pushSeq 的 ★★）
      if (pushSeq !== pushSeqAtStart) return "ok";
      applyRemote(roomRes.ok ? roomRes.value : null, roundRes.value);
      await settleIfDue();
      return "ok";
    },

    submit: async (input) => {
      const session = get().session;
      if (!session) return false;
      set({ busy: true });
      const res = await submitRoundEntry(session.roomCode, input);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return false;
      }
      set({ busy: false });
      if (!res.ok) {
        set({ note: noteOfFailure(res) });
        return false;
      }
      set({ snapshot: res.value, note: null });
      return true;
    },

    advance: async (phase) => {
      const session = get().session;
      if (!session) return false;
      set({ busy: true });
      const res = await setRoundPhase(session.roomCode, phase);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return false;
      }
      set({ busy: false });
      if (!res.ok) {
        // 房主刚换人 / 阶段刚被另一端推走：以服务端下一拍为准。这三种码都是"这一下晚了一步"，
        // 不是"你做错了"——照实写成红字会让玩家以为键坏了（提示条只在❌真正需要人处理时才留）。
        if (res.reason === "code" && (res.code === "NOT_HOST" || res.code === "WRONG_PHASE")) {
          await resyncOnRace(session.roomCode);
          return false;
        }
        set({ note: noteOfFailure(res) });
        return false;
      }
      set({ snapshot: res.value, note: null });
      return true;
    },

    like: async (targetUserId) => {
      const session = get().session;
      if (!session) return false;
      set({ busy: true });
      const res = await likeRoundEntry(session.roomCode, targetUserId);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return false;
      }
      set({ busy: false });
      if (!res.ok) {
        set({ note: noteOfFailure(res) });
        return false;
      }
      set({ snapshot: res.value, note: null });
      return true;
    },

    vote: async (targetUserId) => {
      const session = get().session;
      if (!session) return false;
      set({ busy: true });
      const res = await voteRoundEntry(session.roomCode, targetUserId);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return false;
      }
      set({ busy: false });
      if (!res.ok) {
        set({ note: noteOfFailure(res) });
        return false;
      }
      set({
        snapshot: res.value,
        note: null,
        // 服务端快照没有"我弃权了"这一位：弃权只在我这一端记一下，说"你弃权了"用
        ...(targetUserId === null ? { abstainedRound: res.value.round } : {}),
      });
      return true;
    },

    settle: async () => {
      const session = get().session;
      if (!session) return false;
      if (get().settling) return false;
      set({ settling: true });
      try {
        const res = await settleRemoteRound(session.roomCode);
        if (!sessionNow(session.roomCode)) return false;
        if (!res.ok) {
          // 别人已经结算过（WRONG_PHASE）/ 房主刚换人（NOT_HOST）：拉一拍快照，别把竞态留成红字
          if (res.reason === "code" && (res.code === "NOT_HOST" || res.code === "WRONG_PHASE")) {
            await resyncOnRace(session.roomCode);
            return false;
          }
          set({ note: noteOfFailure(res) });
          return false;
        }
        const remoteWinners = winnersOf(res.value.settlement);
        // 事件与结算同一拍读回（理由见 pullSettlement 的同名注释）
        const snapshot = get().snapshot;
        const eventPart = snapshot ? await pullEvent(session.roomCode, snapshot.round) : { event: null, eventState: "idle" as const };
        if (!sessionNow(session.roomCode)) return false;
        set({
          ...(remoteWinners !== null ? { winners: remoteWinners } : {}),
          settlement: res.value.settlement,
          memberHp: { ...get().memberHp, ...hpOfSettlement(res.value.settlement) },
          note: null,
          event: eventPart.event,
          eventState: eventPart.eventState,
        });
        if (remoteWinners !== null) clearOnlineResume();
        return true;
      } finally {
        set({ settling: false });
      }
    },

    next: async () => {
      const session = get().session;
      if (!session) return "waiting";
      set({ busy: true });
      const res = await nextRound(session.roomCode);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return "waiting";
      }
      set({ busy: false });
      if (!res.ok) {
        if (res.reason === "code") {
          // ① ROUND_NOT_SETTLED：另一端还没把这一回合结算完（换房主 / 并发点下一回合都会这样）——
          //    拉一拍，等结算落地；别把"再等 2 秒"说成失败。
          // ② NOT_HOST：点下去的那一拍房主已经换人（服务端先判房主）；拉一拍，新房主接手。
          if (res.code === "ROUND_NOT_SETTLED" || res.code === "NOT_HOST") {
            await resyncOnRace(session.roomCode);
            return "waiting";
          }
          set({ note: { kind: "code", code: res.code } });
          return "waiting";
        }
        abandon({ kind: "fallback" });
        return "waiting";
      }
      if (res.value.kind === "over") {
        const winnerIds = res.value.winners;
        // 服务端 GAME_OVER 是权威名单（平局 = 空数组）：名字从结算榜 / 交片 / 房间成员里现拼
        const settlement = get().settlement;
        const snapshot = get().snapshot;
        set({
          winners: winnerIds.map((userId) => ({
            userId,
            name:
              settlement?.ranking.find((row) => row.userId === userId)?.name ??
              snapshot?.entries.find((entry) => entry.userId === userId)?.name ??
              session.members.find((member) => member.userId === userId)?.name ??
              null,
          })),
          note: null,
        });
        clearOnlineResume();
        return "over";
      }
      set({
        snapshot: res.value.round,
        settlement: null,
        winners: null,
        event: null,
        eventState: "idle",
        note: null,
        abstainedRound: null,
        autoSettleTriedRound: null,
      });
      return "round";
    },

    chooseEvent: async (optionId) => {
      const session = get().session;
      const event = get().event;
      if (!session || !event) return false;
      set({ busy: true });
      const res = await chooseRoundEvent(session.roomCode, optionId);
      if (!sessionNow(session.roomCode)) {
        set({ busy: false });
        return false;
      }
      set({ busy: false });
      if (!res.ok) {
        set({ note: noteOfFailure(res) });
        return false;
      }
      // ★ 只更新服务端那一份表态（幂等：重复点回来的是第一次那一份）：
      //   本地效果由 game store 落（`effects.client` + 金币），两边谁都不替谁改数。
      const current = get().event;
      set({
        ...(current ? { event: { ...current, myChoice: res.value.myChoice, allChosen: res.value.allChosen } } : {}),
        note: null,
      });
      return true;
    },

    refreshRoom: async () => {
      const session = get().session;
      if (!session) return;
      const res = await readRoom(session.roomCode);
      if (!sessionNow(session.roomCode)) return;
      // 只刷新：失败的下一拍轮询会再问（那一拍会说），这里不叠一句话
      if (!res.ok) return;
      set({ room: res.value, memberHp: { ...get().memberHp, ...hpOfRoom(res.value) } });
    },
  };
});

// DEV 调试挂钩（与 __game / __lobby 同款）：自动化脚本要直接驱动回合，不必去点界面。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__rounds = useRounds;
}
