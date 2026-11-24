/**
 * 联机房间 / 匹配的 HTTP 层（2026-11-23 工坊对局大厅的桩；2026-11-24 接上服务端）。
 *
 * ★★ 服务端契约只认 `ideahub-server` 的 `routes/gameRoom.routes.js` + `services/gameRoom.service.js`
 *   （`docs/api-contract.md`「工坊对局：房间与匹配」）：**成功**回 `{ ok:true, room }` /
 *   `{ ok:true, status, … }`，**失败**回 `{ ok:false, code, message, …结构化字段 }`。
 *   App 只认 `code`，不认 `message` —— 那个字段是英文、可能半中半英（服务端给老 App 兜底用的），
 *   服务端改了措辞界面就跟着改，等于把两边的嘴绑在一起。人话在 `studio/game/lobbyReasons` 一处。
 * ★ `RoomsResult` 只有两种失败：`unavailable`（这条服务不可用：网络 / 超时 / 401 / 老服务端 /
 *   正文不是我们认识的那一版）与 `code`（服务端明确说了业务原因）。调用方据此决定
 *   "退回本机 AI" 还是 "把那句话摆出来" —— **别把两者压成一种**（铁律八：失败要响且局部）。
 * ★ `roomsAvailable()` 是给界面"发不发房间请求 / 底栏说哪句话"的唯一判据，读的是
 *   `data/serverCaps` 的 `gameRooms` 能力位（与 gameTickets 同一套机制，不自己另写一个探测）。
 *   null（还没探到 / 探测失败）按「没有」算：大厅退回本机 AI 补位，一次请求都不发。
 * ★ 这个文件里的每个请求都带 10 秒上限：大厅是"点一下就要有反应"的地方，HTTP 客户端缺省 20 秒
 *   会让「正在开房…」僵在那里，而且轮询拍撞上长超时会叠住下一拍。
 */
import { ApiError, apiDelete, apiGet, apiPost } from "../client";
import { serverGameRooms } from "../../data/serverCaps";

/** 服务端的三种房间模式（`match4` / `match8` 走队列；`custom` 建房 + 房间码邀请）。 */
export type RemoteRoomMode = "match4" | "match8" | "custom";

/** 房间状态机（服务端 `GameRoom.status`）：waiting → playing → over；最后一个人离开 = 硬删。 */
export type RemoteRoomState = "waiting" | "playing" | "over";

/**
 * 服务端快照里的 `status`（**老字段**：给老包用的，含历史遗留的 `closed`）。
 * ★ 新代码判阶段 / 判结束只看 `state`（服务端 2026-11-23 起两个都给；契约原文：「判结束只看 state」）。
 *   这里仍然留着 status，是因为大厅 / 重连那几处读的是"房间还能不能接着玩"，老服务端上只有它。
 */
export type RemoteRoomStatus = RemoteRoomState | "closed";

/** 开局卡在哪儿（服务端 `startBlockedBy`；客观原因，不是「看的人能不能点」）。 */
export type RemoteStartBlock = "not-enough-players" | "not-all-ready" | "already-started" | "closed" | "expired";

/** 服务端房间里的一个成员（只留界面要用的字段；用户名 / 头像是服务端读快照时现拼的）。 */
export interface RemoteRoomMember {
  /** 服务端的账号 id（房主 / 踢人 / 找"我是谁"都认它） */
  userId: string;
  /** 服务端昵称（读快照时现拼；账号没昵称时回 userId） */
  displayName: string;
  /** 座位号 = `members` 数组下标（服务端派生量，不落库） */
  seat: number;
  ready: boolean;
  isHost: boolean;
  avatarUrl: string | null;
  /**
   * 血量（回合引擎 2026-11-23）：服务端按 `members[].hp` 记，**它是联机对局里 hp 的唯一真相**。
   * 老房间 / 这一版之前的快照没有这一位，服务端自己按 100 兜底；这里也按同一个口径兜底。
   */
  hp: number;
}

/** 服务端的一间房（`GET /api/game/rooms/:code` 的快照）。 */
export interface RemoteRoom {
  code: string;
  roomId: string;
  mode: RemoteRoomMode;
  /** 座位数（服务端字段叫 `seats`，App 这边一直叫 size） */
  size: number;
  hostId: string | null;
  members: RemoteRoomMember[];
  status: RemoteRoomStatus;
  /**
   * 服务端认的三态（`waiting` / `playing` / `over`）—— **判结束只看这一位**。
   * ★ null = 老服务端没有这一位（**不知道**，不是"没结束"）：结束判定改由
   *   `studio/game/onlineHost.roomOverOf` 的过渡分支按 hp 推（服务端补字段之前的兼容，见 §7.7）。
   */
  state: RemoteRoomState | null;
  /** `status === "playing"` 的别名（界面只问"开局了没有"）；`over` / `closed` 都是 false */
  started: boolean;
  /**
   * 这一局结束了没有。
   * ★ 服务端 2026-11-23 起在快照里给了 `state:"over"` + `winners` + `finishedAt`：**有 state 就照它读**。
   *   老服务端（没有 state）→ null（不知道），交给 `onlineHost.roomOverOf` 的过渡分支推。
   */
  over: boolean | null;
  /** 服务端给的胜者 userId（空数组 = 平局 / 同归于尽）；没带这一位 = null（不知道） */
  winners: string[] | null;
  /** 服务端给的结束时刻（`over` 时才有；今天只用来显示 / 排查） */
  finishedAt: string | null;
  /** 服务端说至少几个**真人**才能开局（custom = 2，不看选了几座） */
  requiredPlayers: number;
  memberCount: number;
  /** 看的人（我）现在能不能点开局：只有房主、且 `startBlockedBy === null` */
  canStart: boolean;
  startBlockedBy: RemoteStartBlock | null;
}

/** 匹配 / 队列的一拍（`POST` 与 `GET /api/game/queue` 同形）。 */
export interface MatchTicket {
  /** `idle` 只会在 GET 时出现（没在排队）；POST 进队之后是 waiting / matched */
  status: "idle" | "waiting" | "matched";
  mode: RemoteRoomMode | null;
  /** 这一池现在几个人 */
  queued: number;
  /** 这一池要凑几个人（4 / 8） */
  need: number;
  /** 还差几个人 × 30 秒（服务端只是**估算**，不是承诺） */
  etaSec: number | null;
  position: number | null;
  /** matched 时的房间码（**房间码就是从这一格给出去的**） */
  code: string | null;
  /** matched 时的房间快照（没有就再 GET 一次快照） */
  room: RemoteRoom | null;
}

/**
 * 这一层能回的结果。
 * - `unavailable`：这条服务不可用（断网 / 超时 / 401 / 老服务端 / 正文形状不对）。
 * - `code`：服务端明确回了业务错误码（`ROOM_FULL` / `NOT_HOST` / …）。
 */
export type RoomsFailure =
  | { ok: false; reason: "unavailable" }
  | { ok: false; reason: "code"; code: string };

export type RoomsResult<T> = { ok: true; value: T } | RoomsFailure;

/** 服务不可用时的唯一失败值（一个常量，别在十个函数里各写一份对象） */
export const ROOMS_UNAVAILABLE: RoomsFailure = { ok: false, reason: "unavailable" };

/** 大厅是"点一下就要有反应"的地方：10 秒还没答上来就当成没连上，退回本机 AI。 */
const ROOMS_TIMEOUT_MS = 10_000;

/**
 * 服务端会回的**业务**错误码。
 * ★ 只列这个模块的码：别的模块的 401 / 403 / 404 不该被当成"房间业务失败"说出来
 *   （例如老服务端的 404 是"没有这条路"，不是"房间不存在"）。
 * ★ `GAME_ROOMS_OFF` 也算业务码：服务端明确说"房间服务被关了"，界面照实说一句，
 *   然后按本机 AI 开局（能力位是会话级缓存，运维中途关掉时这里还能兜住）。
 */
const GAME_CODES = new Set([
  "BAD_MODE",
  "BAD_SEATS",
  "SEATS_LOCKED",
  "BAD_READY",
  "BAD_USER",
  "ROOM_NOT_FOUND",
  "MEMBER_NOT_FOUND",
  "NOT_HOST",
  "ROOM_FULL",
  "ROOM_ALREADY_STARTED",
  "ALREADY_IN_ROOM",
  "NOT_IN_ROOM",
  "NOT_ENOUGH_PLAYERS",
  "NOT_ALL_READY",
  "CANNOT_KICK_SELF",
  "QUEUE_MODE_CONFLICT",
  "GAME_ROOMS_OFF",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function modeOf(v: unknown): RemoteRoomMode {
  return v === "match4" || v === "match8" ? v : "custom";
}

/**
 * 失败回包的统一翻译：**只认 code**。
 * ★ 404 且没有业务码 = 这条路不存在（老服务端 / 部署没带这个模块）→ unavailable；
 *   真机上不存在的路径会回 200 + index.html，那会在 `roomOf` / `ticketOf` 的形状检查里落空，
 *   同样归 unavailable。别拿状态码判"有没有这个功能"。
 * ★ 401 已经在 client 里广播了 auth:expired（登录态过期），这里只回 unavailable：
 *   大厅退本机 AI，登录页由 App 的登录态那一层去处理。
 */
function failureOf(err: unknown): RoomsFailure {
  if (err instanceof ApiError && err.code && GAME_CODES.has(err.code)) {
    return { ok: false, reason: "code", code: err.code };
  }
  return ROOMS_UNAVAILABLE;
}

/**
 * 服务端房间快照 → `RemoteRoom`。
 * ★ 形状不认识就回 null（调用方归 unavailable）：老服务端回 200 + index.html、SPA 回退、
 *   或者服务端换了字段名，都不能靠"看起来像"硬读 —— 读出一个空房间比说"没连上"更坏。
 * ★ 兼容 `state` / `started` 两种写法：本轮契约草稿写的是 `state`，服务端实际字段是 `status`。
 *   这两种读法只在这一处，界面不认字段名。
 */
function roomOf(raw: unknown): RemoteRoom | null {
  const r = asRecord(raw);
  if (!r) return null;
  const code = strOf(r.code);
  if (!code) return null;
  const membersRaw = Array.isArray(r.members) ? r.members : null;
  if (!membersRaw) return null;
  const members: RemoteRoomMember[] = [];
  for (const one of membersRaw) {
    const m = asRecord(one);
    const userId = m ? strOf(m.userId) : null;
    if (!m || !userId) return null;
    members.push({
      userId,
      // 服务端 username 可能是 null（账号没设置昵称）：退回 userId，界面永远有字（铁律八）
      displayName: strOf(m.username) ?? userId,
      seat: numOf(m.seat) ?? members.length,
      ready: m.ready === true,
      isHost: m.isHost === true,
      avatarUrl: strOf(m.avatarUrl),
      // 与服务端 services/gameRound.hpOf 同一个兜底：没这一位（老房间）就是满血
      hp: numOf(m.hp) ?? 100,
    });
  }
  const statusRaw = strOf(r.status) ?? strOf(r.state) ?? "waiting";
  const status: RemoteRoomStatus =
    statusRaw === "playing" || statusRaw === "over" || statusRaw === "closed" ? statusRaw : "waiting";
  const size = numOf(r.seats) ?? numOf(r.size) ?? members.length;
  // ── 结束位（服务端 2026-11-23 起给了 state / winners / finishedAt）────────────────────
  // ★ 有 `state` 时它就是唯一判据：`over` 才是结束，`waiting` / `playing` 都是没结束。
  //   老服务端没有这一位 → state 为 null、over 为 null（**不知道**），交给 onlineHost.roomOverOf 的
  //   过渡分支按 hp 推（那段是服务端补字段之前的兼容，攒下证据就能删）。
  const stateRaw = strOf(r.state);
  const state: RemoteRoomState | null =
    stateRaw === "waiting" || stateRaw === "playing" || stateRaw === "over" ? stateRaw : null;
  const finishedAt = strOf(r.finishedAt);
  const over: boolean | null =
    state !== null
      ? state === "over"
      : r.over === true || statusRaw === "over" || finishedAt !== null
        ? true
        : r.over === false
          ? false
          : null;
  const winners = Array.isArray(r.winners)
    ? r.winners
        .map((one) => (typeof one === "string" ? one : strOf(asRecord(one)?.userId)))
        .filter((id): id is string => Boolean(id))
    : null;
  return {
    code,
    roomId: strOf(r.roomId) ?? "",
    mode: modeOf(r.mode),
    size,
    hostId: strOf(r.hostId),
    members: members.sort((a, b) => a.seat - b.seat),
    status,
    state,
    // `started` 仍然只回答"开局了没有"（大厅等的是它）：结束后房间不能再开局，所以 over 也是 false
    started: state === "playing" || status === "playing" || r.started === true,
    over,
    winners,
    finishedAt,
    requiredPlayers: numOf(r.requiredPlayers) ?? size,
    memberCount: numOf(r.memberCount) ?? members.length,
    canStart: r.canStart === true,
    startBlockedBy: strOf(r.startBlockedBy) as RemoteStartBlock | null,
  };
}

/** 队列回包 → `MatchTicket`（`POST` 与 `GET` 同形；任务契约里的 `queued` 就是服务端的 `waiting`）。 */
function ticketOf(raw: unknown): MatchTicket | null {
  const r = asRecord(raw);
  if (!r) return null;
  const statusRaw = strOf(r.status);
  const status: MatchTicket["status"] = statusRaw === "matched" ? "matched" : statusRaw === "idle" ? "idle" : "waiting";
  const roomRaw = asRecord(r.room);
  const room = roomRaw ? roomOf(roomRaw) : null;
  const code = strOf(r.code) ?? room?.code ?? null;
  // 说"匹配上了"却没有房号 / 快照 = 这一版服务端的回包我们不认识；别让界面拿着 null 进房间
  if (status === "matched" && !room && !code) return null;
  return {
    status,
    mode: strOf(r.mode) ? modeOf(r.mode) : null,
    queued: numOf(r.queued) ?? 0,
    need: numOf(r.need) ?? 0,
    etaSec: numOf(r.etaSec),
    position: numOf(r.position),
    code,
    room,
  };
}

/**
 * 房间类端点的回包信封：`{ ok:true, room:{…} }` → `RemoteRoom`。
 * ★ 别把信封锁直接塞给 `roomOf`：顶层没有 `code`，会被判成"形状不对"→ unavailable，
 *   而服务端其实已经成功建房 / 进房 / 开局了（症状是"每次都退回本机 AI，服务端却留下了房间"）。
 *   建房 / 进房 / 快照 / 准备 / 开局 / 踢人六个端点共用这一个解包处。
 */
function roomEnvelopeOf(raw: unknown): RemoteRoom | null {
  return roomOf(asRecord(raw)?.room);
}

/** 统一包一层：网络 / 超时 / 形状不对 → unavailable；业务码 → code。 */
async function call<T>(run: () => Promise<unknown>, shape: (raw: unknown) => T | null): Promise<RoomsResult<T>> {
  try {
    const raw = await run();
    const value = shape(raw);
    return value === null ? ROOMS_UNAVAILABLE : { ok: true, value };
  } catch (err) {
    return failureOf(err);
  }
}

const opts = { timeoutMs: ROOMS_TIMEOUT_MS } as const;

/**
 * 这台服务器有没有联机能力。
 * ★ 唯一判据是 `data/serverCaps` 的 `gameRooms` 能力位（健康端点报的那一位），不按版本号猜、
 *   也不拿一次 404 当"没有"（真机上不存在的路径回 200 + index.html）。
 * ★ 界面只用它决定**发不发请求 / 说哪句话**，不拿它当开局门禁：没有联机时大厅照样开，
 *   AI 补齐空位走 `studio/game/lobby.ts` 那一套。
 */
export function roomsAvailable(): boolean {
  return serverGameRooms() === true;
}

/**
 * 开一间服务端房间（房主）。`POST /api/game/rooms` body `{ mode, seats? }` → 201 `{ room }`。
 * ★ custom 必须给 2~8 的 `seats`；match4 / match8 的座位数由模式锁死（带了别的数服务端回
 *   `SEATS_LOCKED`，不静默忽略）。App 今天只用 custom（匹配走队列）。
 */
export async function createRoom(input: { mode: RemoteRoomMode; size?: number }): Promise<RoomsResult<RemoteRoom>> {
  const body = input.mode === "custom" ? { mode: input.mode, seats: input.size } : { mode: input.mode };
  return call(() => apiPost<unknown>("/api/game/rooms", body, opts), roomEnvelopeOf);
}

/**
 * 按房间码加入（客人）。`POST /api/game/rooms/join` body `{ code }`。
 * ★ 房号大小写不敏感（服务端自己 normalize），这里原样递；界面只负责去掉空格。
 */
export async function joinRoom(code: string): Promise<RoomsResult<RemoteRoom>> {
  return call(() => apiPost<unknown>("/api/game/rooms/join", { code }, opts), roomEnvelopeOf);
}

/** 读一眼房间快照（房间里每 2 秒轮询的那一发）。`GET /api/game/rooms/:code` → `{ room }`。 */
export async function readRoom(code: string): Promise<RoomsResult<RemoteRoom>> {
  return call(() => apiGet<unknown>(`/api/game/rooms/${encodeURIComponent(code)}`, opts), roomEnvelopeOf);
}

/**
 * 房主踢人。`POST /api/game/rooms/:code/kick` body `{ userId }` → `{ room }`。
 * ★ `playerId` 是**服务端账号 id**（`RemoteRoomMember.userId`），不是 App 本机座位 id。
 */
export async function kickMember(code: string, playerId: string): Promise<RoomsResult<RemoteRoom>> {
  return call(() => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/kick`, { userId: playerId }, opts), roomEnvelopeOf);
}

/** 客人准备 / 取消准备。`POST /api/game/rooms/:code/ready` body `{ ready }` → `{ room }`。 */
export async function setReady(code: string, ready: boolean): Promise<RoomsResult<RemoteRoom>> {
  return call(() => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/ready`, { ready }, opts), roomEnvelopeOf);
}

/**
 * 房主开局。`POST /api/game/rooms/:code/start` → `{ room }`（`room.status` 变 playing）。
 * ★ 服务端**不返回 matchId**：开局就是把房间状态推到 playing，对局本身在本机（回合引擎还没接）。
 *   App 拿到 playing 之后按房间座位数建本机局（空位 AI 补），然后把联机房间退掉。
 */
export async function startRoom(code: string): Promise<RoomsResult<RemoteRoom>> {
  return call(() => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/start`, {}, opts), roomEnvelopeOf);
}

/**
 * 离开房间。`POST /api/game/rooms/:code/leave` → `{ closed, hostId, room }`。
 * ★ 房主离开 = 房主自动转移；最后一个人离开 = 房间当场删掉（`closed:true`）。
 * ★ 只回 `closed`：离开之后界面不留房间，成员快照没用（而且 `room` 可能为 null）。
 */
export async function leaveRoom(code: string): Promise<RoomsResult<{ closed: boolean }>> {
  return call(
    () => apiPost<unknown>(`/api/game/rooms/${encodeURIComponent(code)}/leave`, {}, opts),
    (raw) => {
      const r = asRecord(raw);
      if (!r) return null;
      return { closed: r.closed === true };
    },
  );
}

/**
 * 4 人 / 8 人匹配：进队 / **续队 + 撮合**。`POST /api/game/queue` body `{ mode }`。
 * ★★ 服务端的撮合**就在这一发里**（`services/gameRoom.service.tryMatch`）：`GET /api/game/queue`
 *   只读，不会推进撮合、也不刷排队心跳（90 秒没心跳那一行就被当成"人走了"清掉）。
 *   但**光靠 POST 轮询也不行**：匹配成功之后本人已经是房间成员，`enqueue` 会先查"你在不在房里"，
 *   于是下一发 POST 回 409 `ALREADY_IN_ROOM` 而不是 matched —— 全 POST 会在拿到房号之前把自己
 *   判成失败（2026-11-24 dev 实测，房间建出来了、客户端却退回了本机 AI）。
 *   所以大厅那一屏是 **POST / GET 两拍一换**（见 lobbyStore.pollQueue）：POST 每 4 秒一次
 *   （服务端契约的 2~5 秒心跳 / 撮合节奏），GET 补齐中间的状态读取、并负责把 409 之后的
 *   matched + 房号读回来。
 * ★ 回包 `status: "waiting"` / `"matched"`（matched 带 `code` + `room`）。任务契约里的
 *   `"queued"` 是同一件事，`ticketOf` 统一折成 waiting。
 */
export async function findMatch(size: 4 | 8): Promise<RoomsResult<MatchTicket>> {
  const mode: RemoteRoomMode = size === 8 ? "match8" : "match4";
  return call(() => apiPost<unknown>("/api/game/queue", { mode }, opts), ticketOf);
}

/**
 * 只读排队状态（等匹配的 GET 那一拍；**撮合 / 心跳仍要 POST**，见 findMatch 的 ★★）。
 * `GET /api/game/queue` → `status: "idle" | "waiting" | "matched"`。
 */
export async function readQueue(): Promise<RoomsResult<MatchTicket>> {
  return call(() => apiGet<unknown>("/api/game/queue", opts), ticketOf);
}

/**
 * 取消排队。`DELETE /api/game/queue` → `{ left }`（幂等：本来没排也回 200）。
 * ★ 匹配成功之后这一行还在（服务端留给本人读房号）：进房间 / 开局之后要顺手删掉，
 *   不然它会挂到 10 分钟撮合寿命，下一次排队前还得先清。
 */
export async function cancelMatch(): Promise<RoomsResult<{ left: boolean }>> {
  return call(
    () => apiDelete<unknown>("/api/game/queue", undefined, opts),
    (raw) => {
      const r = asRecord(raw);
      if (!r) return null;
      return { left: r.left === true };
    },
  );
}

// ────────────────────────────── 备注：没有「改人数」这一路 ──────────────────────────────
// 服务端到今天（2026-11-24）**没有**改人数端点：房间的 `seats` 只在建房时定，
// custom 的 2~8 由 `POST /api/game/rooms` 的 `seats` 给定，之后不能改。
// 旧桩里那个 `setRoomSize(code, size)`（当时 TODO 写的是 PATCH /api/game/rooms/:code）已删掉：
// 留着它就会有人顺手接上，然后界面上"人数 −/+"点了没反应，或者服务端 404 被说成"房间服务没接通"。
// 界面因此**只在联机房间里隐藏改人数**（RoomScreen 认 room.online）；本机房间照旧能改
// （`studio/game/lobby.setRoomSize` 是纯函数，不经过这一层）。
