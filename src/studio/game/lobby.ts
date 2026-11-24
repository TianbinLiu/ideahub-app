/**
 * 大厅与「自定义房间」的**纯状态机**（2026-11-23，本轮只做 App 侧）。
 *
 * ★★ 为什么单开一份纯函数（而不是全写进 lobbyStore）：
 *   · 房间的规矩（谁能改人数、谁能踢人、谁能开始、空位怎么补 AI、房主走了这间房算什么）
 *     与"界面上摆几个按钮"是两件事；写在 store 里就没法在 Node 里直接跑正反例 ——
 *     而这一层的错全是**零报错**的：房主被当成客人（点开始没反应）、踢人踢掉房主自己、
 *     人数改成 9 之后座位表越界。`scripts/check-game-lobby.mjs` 直接 import 本文件跑正反例。
 *   · 这一层**不碰网络**：房间码在本地生成，成员全部是本机 AI 补位；真正的联机
 *     （服务端房间 / 匹配 / 同步）由另一个人做，接口桩在 `api/game/rooms.ts`（全部回 unavailable）。
 *     所以这里每个成员都带 `kind`，联机接通之后远端成员照样进同一个形状，界面不用改。
 * ★ 零运行时依赖（除另一份零依赖模块 rules.ts 的座位数上下界）：`import type` 只来自 types.ts，
 *   值引用只来自 rules.ts（见 scripts/check-import-direction.mjs 的零依赖表）。
 */

import { MAX_PLAYERS, MIN_PLAYERS } from "./rules.ts";
import type { Rng } from "./types";

// ────────────────────────────── 座位 id 与人数 ──────────────────────────────

/**
 * 本地玩家的座位 id（单机版的"我"）。
 * ★ 大厅、对局 store、房间成员表用同一个值：三处各写一个 "me" 就是三份会漂的字面量。
 *   联机接通之后这里换成服务端下发的 playerId，界面不认字面量只认它。
 */
export const LOCAL_SEAT_ID = "me";

/** 联机匹配的两种规模（§5-1 的 4 人 + 8 人桌）。 */
export const MATCH_SIZES = [4, 8] as const;
export type MatchSize = (typeof MATCH_SIZES)[number];

/**
 * 自定义房间的人数上下界（§3「改人数 2~8」）：与规则层的座位数上下界**同一个值**。
 * ★ 界面读这两个而不是直接去拿 rules.MIN_PLAYERS：房间的错界由 lobby 说（size-out-of-range 的
 *   min/max），界面照同一份数念，两边不会一格一格地漂。
 */
export const ROOM_MIN_SIZE = MIN_PLAYERS;
export const ROOM_MAX_SIZE = MAX_PLAYERS;

/**
 * 这一局有几个座位时，AI 补位的 id 列表（ai-1 … ai-7）。
 * ★ 按下标生成而不是写死三个：4 人桌 3 个 AI、8 人桌 7 个，`labels.playerName` 认 ai-1~ai-7。
 * ★ 顺序固定（ai-1 在最前）：同一 seed 复盘时座位表必须一模一样（与对局 rng 同一条理由）。
 */
export function aiSeatIds(count: number): string[] {
  const n = Math.max(0, Math.min(MAX_PLAYERS - 1, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => `ai-${i + 1}`);
}

/** 一局的座位表（"我" + N-1 个 AI）：store.startGame 与检查脚本共用这一处。 */
export function seatIdsFor(playerCount: number): string[] {
  const n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(playerCount)));
  return [LOCAL_SEAT_ID, ...aiSeatIds(n - 1)];
}

// ────────────────────────────── 房间的形状 ──────────────────────────────

/** 大厅的三条入口（也是三种开局方式）。 */
export type LobbyMode = "match4" | "match8" | "room";
/** 大厅现在停在那一屏：入口 / 等匹配 / 房间里。 */
export type LobbyScreen = "home" | "matching" | "room";

/**
 * 一个座位是谁：
 *   host  = 房主（本地玩家；联机后可能是别人）
 *   guest = 别的真人（联机接通前不会出现，形状先留着 —— 界面按它摆「准备」）
 *   ai    = AI 补位（§4：未满的位置用 AI 填）
 *   empty = 空位（房主踢掉了 AI / 等真人；**开局时照样由 AI 补上**）
 * ★ 座位类型是"这一格现在是什么"，不是"这一局谁是 AI"：开局那一刻所有 empty 都会变成 ai。
 */
export type SeatKind = "host" | "guest" | "ai" | "empty";

export interface LobbySeat {
  /** 从 0 起的座位号（房主固定 0 号；AI 的 id 就是 `ai-<index>`） */
  index: number;
  /** 坐在这格的人（房主是 LOCAL_SEAT_ID，AI 是 ai-1…）；空位 null */
  playerId: string | null;
  kind: SeatKind;
  /** 非房主表过态没有（房主不用准备：他开始就是表态，见 canStartRoom） */
  ready: boolean;
  /**
   * 展示名（联机接通之后才有的东西：服务端快照里的昵称）。
   * ★ 本机座位不填（`playerName` 按 id 给「我 / 对手 A」）；真人填服务端昵称 ——
   *   不填的话界面会把一串账号 `_id` 印在座位上（服务端 username 可能为空，它那边已经退回 id）。
   * ★ 不是规则字段：lobby.ts 的纯函数一个都不读它。
   */
  name?: string;
}

export interface LobbyRoom {
  /** 6 位数字房间码（本地生成，见 roomCodeOf） */
  code: string;
  hostId: string;
  /** 座位数 = 开局人数（2~8） */
  size: number;
  seats: LobbySeat[];
  /**
   * 这间房是不是**联机**的房间。
   * ★ 现在恒为 false：服务端房间还没接通（api/game/rooms.ts 全部回 unavailable），
   *   本机开出来的房间只有"我 + AI 补位"。界面据此说"别人暂时进不来，先用 AI 补"。
   */
  online: boolean;
}

/** 房间操作被拒的原因（说人话在界面层，见 ui/Lobby 的 lobbyReasonText）。 */
export type LobbyRejectReason =
  | "no-room"
  | "not-host"
  | "not-member"
  | "host-always-ready"
  | "seat-out-of-range"
  | "seat-empty"
  | "seat-host"
  | "size-out-of-range"
  | "seat-occupied";

export interface LobbyFailure {
  ok: false;
  reason: LobbyRejectReason;
  /** 这一条规矩的上下界（人数用；界面说"只能 2~8 人"） */
  min?: number;
  max?: number;
  /** 涉及第几号座位（踢人 / 换人用） */
  index?: number;
}

export type LobbyResult = { ok: true; room: LobbyRoom } | LobbyFailure;
/** 离开房间：房主离开 = 这间房散掉（room 回 null） */
export type LeaveResult = { ok: true; room: LobbyRoom | null } | LobbyFailure;

function reject(reason: LobbyRejectReason, extra: Omit<LobbyFailure, "ok" | "reason"> = {}): LobbyFailure {
  return { ok: false, reason, ...extra };
}

function clampSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_PLAYERS;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(size)));
}

function seatOf(room: LobbyRoom, playerId: string): LobbySeat | null {
  return room.seats.find((seat) => seat.playerId === playerId) ?? null;
}

export function isHostOf(room: LobbyRoom | null, playerId: string): boolean {
  return !!room && room.hostId === playerId;
}

/** 这一格现在是谁的（界面按它画「房主 / 我 / AI 补位 / 空位」）。 */
export function memberSeatOf(room: LobbyRoom, playerId: string): LobbySeat | null {
  return seatOf(room, playerId);
}

// ────────────────────────────── 房间码 ──────────────────────────────

/** 房间码位数（§3：6 位）。 */
export const ROOM_CODE_LENGTH = 6;

/**
 * 本地生成 6 位房间码（100000~999999，**首位不是 0**）。
 * ★ 首位不许是 0：界面上这个码是当"口令"念给人听的，`012345` 会被自己补成 `12345`。
 * ★ 用注入的 rng（规则层同一个 mulberry32）而不是 Math.random：检查脚本能把"同一个 seed 同一个码"
 *   写成确定性用例；联机接通之后这个码改由服务端下发（那时本函数只做本地预览）。
 */
export function roomCodeOf(rng: Rng): string {
  const value = rng();
  const unit = Number.isFinite(value) ? Math.min(0.999999999, Math.max(0, value)) : 0;
  return String(100000 + Math.floor(unit * 900000));
}

export function isRoomCode(code: string): boolean {
  return new RegExp(`^[1-9]\\d{${ROOM_CODE_LENGTH - 1}}$`).test(code);
}

/**
 * 服务端房号的规范化 —— 大厅「加入房间」那一个输入框用。
 *
 * ★ 服务端的房号是 **6 位大写字母数字**（`config/gameRoom.CODE_ALPHABET`，去掉了 I/O/0/1），
 *   与本机那份纯数字码不是同一个规则；所以不复用 `isRoomCode`（那个只认本机码，检查脚本
 *   还钉着"不认字母"）。
 * ★ 去空格 + 转大写：手抄 / 口述 / 小写输入都要认（服务端自己也 normalize，这里只是
 *   让界面能先拦掉明显不对的串、按钮能灰掉）。
 * ★ 不强拒 I/O/0/1：服务端不会用它们发码，但"用户抄错一个字符"应该由服务端回
 *   `ROOM_NOT_FOUND`（与"这间房过期了"同一句话），而不是在客户端编一条"房号不合法"。
 */
export function normalizeServerCode(raw: string): string | null {
  const code = String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return new RegExp(`^[A-Z0-9]{${ROOM_CODE_LENGTH}}$`).test(code) ? code : null;
}

// ────────────────────────────── 开一间房 ──────────────────────────────

function seatFor(index: number, hostId: string): LobbySeat {
  if (index === 0) return { index, playerId: hostId, kind: "host", ready: true };
  return { index, playerId: `ai-${index}`, kind: "ai", ready: false };
}

/**
 * 开一间本机房间：房主坐 0 号，其余座位**默认全用 AI 补位**（§4）。
 * ★ 为什么默认就把 AI 摆上：空房间看起来像"没人陪你玩"，而这一版本来就只有 AI；
 *   房主可以逐格踢掉（踢掉的空位**在开局时照样由 AI 补**，见 roomStartPlan）。
 * ★ 人数超界是程序员的错（大厅只给 2~8 的按钮）：回 size-out-of-range，不静默夹成合法值 ——
 *   夹了之后界面上"8 人房间"里坐着 8 个人而规则按 2 人算，两边各说各的。
 */
export function createRoom(input: { code: string; hostId: string; size: number; online?: boolean }): LobbyResult {
  const size = Math.floor(input.size);
  if (!Number.isFinite(size) || size < MIN_PLAYERS || size > MAX_PLAYERS) {
    return reject("size-out-of-range", { min: MIN_PLAYERS, max: MAX_PLAYERS });
  }
  return {
    ok: true,
    room: {
      code: input.code,
      hostId: input.hostId,
      size,
      seats: Array.from({ length: size }, (_, index) => seatFor(index, input.hostId)),
      online: input.online ?? false,
    },
  };
}

/**
 * 改人数（房主）：2~8。长大的那几格补 AI、缩掉的尾部座位**只能缩 AI / 空位**。
 * ★ 为什么缩小时要检查尾部：缩到 3 人却把坐在 5 号位的真人挤出去 = 那个人被静默踢了，
 *   而他那边只表现为"掉线"。联机接通后这条就是"不许把别人挤出房间"。
 */
export function setRoomSize(room: LobbyRoom, actorId: string, size: number): LobbyResult {
  if (room.hostId !== actorId) return reject("not-host");
  const next = Math.floor(size);
  if (!Number.isFinite(next) || next < MIN_PLAYERS || next > MAX_PLAYERS) {
    return reject("size-out-of-range", { min: MIN_PLAYERS, max: MAX_PLAYERS });
  }
  if (next < room.size) {
    const dropped = room.seats.slice(next);
    const occupied = dropped.find((seat) => seat.kind === "host" || seat.kind === "guest");
    if (occupied) return reject("seat-occupied", { index: occupied.index });
  }
  const seats: LobbySeat[] = [];
  for (let index = 0; index < next; index += 1) {
    seats.push(room.seats[index] ?? seatFor(index, room.hostId));
  }
  return { ok: true, room: { ...room, size: next, seats } };
}

/** 踢掉某一格的 AI（房主，§3「房主可踢人」）：那一格变成空位，开局时再由 AI 补上。 */
export function kickSeat(room: LobbyRoom, actorId: string, index: number): LobbyResult {
  if (room.hostId !== actorId) return reject("not-host");
  const seat = room.seats[Math.floor(index)];
  if (!seat) return reject("seat-out-of-range", { index, min: 0, max: room.size - 1 });
  if (seat.kind === "host") return reject("seat-host", { index: seat.index });
  if (seat.kind === "empty") return reject("seat-empty", { index: seat.index });
  return {
    ok: true,
    room: {
      ...room,
      seats: room.seats.map((row) => (row.index === seat.index ? { ...row, playerId: null, kind: "empty", ready: false } : row)),
    },
  };
}

/**
 * 非房主的「准备」开关（§3「非房主只能准备/离开」）。
 * ★ 房主没有准备这回事（他的"准备"就是点开始），所以对房主回 host-always-ready ——
 *   静默什么都不做会让界面上的按钮看起来点了没反应（铁律八）。
 */
export function toggleReady(room: LobbyRoom, actorId: string): LobbyResult {
  const seat = seatOf(room, actorId);
  if (!seat) return reject("not-member");
  if (seat.kind === "host") return reject("host-always-ready");
  return {
    ok: true,
    room: { ...room, seats: room.seats.map((row) => (row.index === seat.index ? { ...row, ready: !row.ready } : row)) },
  };
}

/** 离开房间：房主离开 = 这间房散掉（回 null），客人离开 = 那一格空出来。 */
export function leaveRoom(room: LobbyRoom, actorId: string): LeaveResult {
  const seat = seatOf(room, actorId);
  if (!seat) return reject("not-member");
  if (seat.kind === "host") return { ok: true, room: null };
  return {
    ok: true,
    room: {
      ...room,
      seats: room.seats.map((row) => (row.index === seat.index ? { ...row, playerId: null, kind: "empty", ready: false } : row)),
    },
  };
}

// ────────────────────────────── 开局：空位补 AI（§4） ──────────────────────────────

/** 开局时这一局怎么坐（界面在「开始对局」旁边念"还能有几个 AI 补位"）。 */
export interface RoomStartPlan {
  /** 这一局一共几个座位（= 房间人数） */
  playerCount: number;
  /** 真人（房主 + 联机接通后的客人） */
  humanIds: string[];
  /** 开局时由 AI 补上的座位数（把踢掉的也算回来） */
  aiCount: number;
}

/**
 * 从房间推出一局的座位：**有几个座位就开几人的局，空位全由 AI 补**（§4）。
 * ★ 空位照样补：房主把 AI 全踢了（想等真人）之后仍能开局 —— 不补的话这一局开不起来，
 *   而"等真人"在这版里永远等不到（联机没接通）。
 * ★ 这里只回"怎么坐"，不改房间：房间的成员表是界面上的事实，开局那一步由 store 用
 *   playerCount 建局（rules.createGame），不回写房间。
 */
export function roomStartPlan(room: LobbyRoom): RoomStartPlan {
  const humanIds = room.seats.filter((seat) => seat.kind === "host" || seat.kind === "guest").map((seat) => seat.playerId).filter((id): id is string => !!id);
  return { playerCount: room.size, humanIds, aiCount: room.size - humanIds.length };
}

/**
 * 谁能点「开始对局」：**只有房主**（§3）。
 * ★ 非房主连"全员准备"也不能开始：开始是房主的权力，客人只有准备 / 离开两个动作。
 * ★ 不要求客人全准备：这一版没有别人；联机接通后"开始"要不要等全员准备是服务端的规则，
 *   不在这里编（现在编了就是一条没人验过的闸）。
 */
export function canStartRoom(room: LobbyRoom, actorId: string): { ok: true; plan: RoomStartPlan } | LobbyFailure {
  if (room.hostId !== actorId) return reject("not-host");
  if (room.size < MIN_PLAYERS) return reject("size-out-of-range", { min: MIN_PLAYERS, max: MAX_PLAYERS });
  return { ok: true, plan: roomStartPlan(room) };
}

/** 把大厅的入口换算成人数（4 人匹配 / 8 人匹配）；自定义房间按房间自己的 size。 */
export function playerCountOf(mode: LobbyMode | null, room: LobbyRoom | null): number {
  if (mode === "match4") return 4;
  if (mode === "match8") return 8;
  return room ? room.size : clampSize(4);
}
