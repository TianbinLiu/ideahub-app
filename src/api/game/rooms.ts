/**
 * 联机房间 / 匹配的**接口桩**（2026-11-23，工坊对局大厅）。
 *
 * ★★ 这个文件里**一条网络请求都没有**，所有函数都回 `{ ok: false, reason: "unavailable" }`：
 *   服务端房间与状态同步由另一个人做（`ideahub-server` 的 game 模块）。在那之前**不许**在 App 侧
 *   自己发明一个协议 —— 一旦这里先写一版 fetch，服务端落地时就得兼容两份形状，
 *   而客户端这版从来没跟人验过（连房间号是不是服务端发的都不确定）。
 *   所以这里只留**函数签名 + 输入输出形状**，接通的 PR 把函数体填上，调用方一行都不用改。
 * ★ 调用方（`studio/game/lobbyStore.ts` 与 `ui/Lobby.tsx`）现在的走法是：
 *   拿 unavailable → 界面说"联机还没接通，先用 AI 补齐" → 这一局按本机房间 / 本机匹配开
 *   （AI 填满空位，规则在 `studio/game/lobby.ts`）。所以「联机没接通」不是一句摆设：
 *   每次开局都会真的问到这一层，而这一层只会回 unavailable，直到有人把它接上。
 * ★ `roomsAvailable()` 是给界面"摆不摆这颗键 / 说哪句话"的唯一判据（同 `data/serverCaps` 那种能力位）。
 */

/** 服务端房间里的一个成员（形状照 App 这边需要的字段先定，接通时以服务端为准再对齐）。 */
export interface RemoteRoomMember {
  /** 服务端下发的 playerId（联机后 App 的座位 id 换成它） */
  playerId: string;
  displayName: string;
  isHost: boolean;
  /** 非房主的准备状态（房主恒 true） */
  ready: boolean;
}

/** 服务端的一间房（`code` 由服务端生成，6 位；App 本地那份只是联机接通前的预览）。 */
export interface RemoteRoom {
  code: string;
  size: number;
  hostId: string;
  members: RemoteRoomMember[];
  /** 房间现在是不是已经开局了（开局之后加入一律被服务端拒） */
  started: boolean;
}

/** 匹配票据：服务端排队之后给的门票（App 现在拿不到，只留形状）。 */
export interface MatchTicket {
  ticketId: string;
  size: 4 | 8;
}

/** 这一层能回的结果：`unavailable` = 服务端还没有这个能力（现在恒是它）。 */
export type RoomsResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      /** unavailable = 这台服务器没有/还没接通；其余是接通之后服务端会回的业务失败 */
      reason: "unavailable" | "not-found" | "forbidden" | "full" | "started" | "bad-request";
    };

/** 桩唯一会回的失败值（一个常量，别在十个函数里各写一份对象） */
export const ROOMS_UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

/**
 * 这台服务器有没有联机能力。
 * ★ 现在恒 false：`api/game/rooms.ts` 的一切都还没接通。
 *   接通的 PR 改成"健康端点报了 gameRooms 能力位"（照 `data/serverCaps` 那条口径：
 *   能力位是唯一判据，不按版本号猜，也不拿一次 404 当"没有"）。
 * ★ 界面只用它决定**说哪句话**（"联机还没接通，先用 AI 补齐" vs "等匹配"），不拿它做门禁 ——
 *   开局本身在联机没接通时照样成立（AI 补位）。
 */
export function roomsAvailable(): boolean {
  return false;
}

/**
 * 开一间服务端房间（房主）。
 * TODO(联机): `POST /api/game/rooms`，body `{ size }` → `RemoteRoom`。服务端生成房间码。
 */
export async function createRoom(input: { size: number }): Promise<RoomsResult<RemoteRoom>> {
  void input;
  return ROOMS_UNAVAILABLE;
}

/**
 * 按房间码加入（客人）。
 * TODO(联机): `POST /api/game/rooms/:code/join` → `RemoteRoom`（满了 / 已开局由服务端回 409）。
 */
export async function joinRoom(code: string): Promise<RoomsResult<RemoteRoom>> {
  void code;
  return ROOMS_UNAVAILABLE;
}

/**
 * 读一眼房间（房间列表 / 成员变动都靠它；接通后大概换成推送或轮询，形状不变）。
 * TODO(联机): `GET /api/game/rooms/:code` → `RemoteRoom`。
 */
export async function readRoom(code: string): Promise<RoomsResult<RemoteRoom>> {
  void code;
  return ROOMS_UNAVAILABLE;
}

/**
 * 房主改人数（2~8）。
 * TODO(联机): `PATCH /api/game/rooms/:code` body `{ size }` → `RemoteRoom`。
 */
export async function setRoomSize(code: string, size: number): Promise<RoomsResult<RemoteRoom>> {
  void code;
  void size;
  return ROOMS_UNAVAILABLE;
}

/**
 * 房主踢人。
 * TODO(联机): `POST /api/game/rooms/:code/kick` body `{ playerId }` → `RemoteRoom`。
 */
export async function kickMember(code: string, playerId: string): Promise<RoomsResult<RemoteRoom>> {
  void code;
  void playerId;
  return ROOMS_UNAVAILABLE;
}

/**
 * 客人准备 / 取消准备。
 * TODO(联机): `POST /api/game/rooms/:code/ready` body `{ ready }` → `RemoteRoom`。
 */
export async function setReady(code: string, ready: boolean): Promise<RoomsResult<RemoteRoom>> {
  void code;
  void ready;
  return ROOMS_UNAVAILABLE;
}

/**
 * 房主开局。
 * TODO(联机): `POST /api/game/rooms/:code/start` → `{ matchId }`（对局状态由服务端广播，App 只订阅）。
 */
export async function startRoom(code: string): Promise<RoomsResult<{ matchId: string }>> {
  void code;
  return ROOMS_UNAVAILABLE;
}

/**
 * 离开房间（房主离开 = 服务端散房）。
 * TODO(联机): `POST /api/game/rooms/:code/leave` → `{ closed }`。
 */
export async function leaveRoom(code: string): Promise<RoomsResult<{ closed: boolean }>> {
  void code;
  return ROOMS_UNAVAILABLE;
}

/**
 * 4 人 / 8 人匹配排队。
 * TODO(联机): `POST /api/game/match` body `{ size }` → `MatchTicket`；成局之后服务端推 `matchId`。
 */
export async function findMatch(size: 4 | 8): Promise<RoomsResult<MatchTicket>> {
  void size;
  return ROOMS_UNAVAILABLE;
}

/**
 * 取消排队。
 * TODO(联机): `DELETE /api/game/match/:ticketId` → `{ cancelled }`。
 */
export async function cancelMatch(ticketId: string): Promise<RoomsResult<{ cancelled: boolean }>> {
  void ticketId;
  return ROOMS_UNAVAILABLE;
}
