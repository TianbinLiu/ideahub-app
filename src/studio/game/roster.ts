/**
 * 对局内的**本桌玩家名单**（2026-11-24，对局内 P0-1 「👥 玩家」面板的那一份模型）。
 *
 * ★★ 为什么单开一个零依赖模块（而不是写进 ui/PlayerPanel 的渲染里）：
 *   · 这正是"界面上看不出来错"的那一类 —— 联机 / 单机两种来源、七八个派生字段
 *     （谁交片了 / 谁点过赞 / 谁淘汰 / 谁房主），写进 JSX 就只能靠人点着试，
 *     而构建门禁（scripts/check-game-ingame.mjs）要**直接 import 跑正反例**；
 *   · 与 onlineHost.ts 同一条纪律：只 `import type`，不 import store / api / lingui，
 *     Node 的类型擦除能整条丢掉（本文件能被 node 直接 import 跑）。
 *
 * ★★ **能拿到的状态才显示**（任务原话）：两种来源拿到的字段本来就不一样，这里不"补齐"、
 *   也不拿默认值冒充事实 —— 拿不到的一律 `null`，界面按 null 决定**不摆那一格**：
 *
 *   | 字段 | 本机单机局 | 联机局（服务端快照） |
 *   |---|---|---|
 *   | 名字 | 座位 id（`labels.playerName` 在界面翻） | `members[].displayName` |
 *   | 血量 | `players[].hp` | 结算榜 > 跨回合记录 > 房间快照（与服务端同一条优先级） |
 *   | 已交片 | `state.entries` 里有没有他 | 回合快照 `entries[].userId` |
 *   | 已点赞 | `entries[].likedBy`（本地全都知道） | **只有我**（`likedByMe`）；别人服务端不下发 |
 *   | 已投票 | `entries[].votedBy` + `abstained`（本地全都知道） | **只有我**（`votedByMe` / 弃权那一拍） |
 *   | 出局 | `players[].eliminated` | `hp <= 0` / 结算行 `eliminated` |
 *   | 房主 | **不给**（本机这一桌没有服务端房间，硬标一个房主就是把联机概念塞进单机） | `room.hostId` |
 *   | 在线 / 掉线 | **不给**（本机里"对手"是 AI，不是人） | **不给**：服务端的成员快照里没有在线位（2026-11-24 核过 `RemoteRoomMember`），不猜 |
 *
 * ★ 为什么联机版"谁给谁点过赞 / 投过票"拿不到：服务端契约写明"谁投给谁是服务端的秘密"
 *   （api/game/rounds.ts 的 ★）。按 entries 的计数去反推是**编数据** —— 那是"这条片子被谁赞过"，
 *   不是"这个人赞过谁"。所以别人那两格一律 null。
 *
 * ★ 排序：**我永远在第一行**，其余保持来源里的顺序（本机 = 座位表，联机 = 服务端 members）。
 *   不按血量 / 名字排：每 2 秒一拍都会重排的话，手指还没落到那一行，行就换了位置。
 */
// ★ 带 .ts：构建门禁用 Node 直接 import 本文件跑断言（同 onlineHost.ts 的写法）。
import type { GamePlayer, RoundEntry } from "./types.ts";

/** 一行人。`null` = 这一格**拿不到**（界面不摆），不是 false。 */
export interface RosterSeat {
  /** 行 id：本机座位 id（me / ai-N）或服务端 userId。同一桌内唯一 */
  id: string;
  /** 服务端昵称；null = 本机局（名字由界面按 labels.playerName 念） */
  name: string | null;
  /** 服务端账号 id（举报 / 拉黑只认它）；AI 与本机座位没有 → null */
  userId: string | null;
  hp: number;
  isMe: boolean;
  /** AI 补位的座位（本机局里除我以外全是；联机局恒 false —— 服务端的回合只认真人成员） */
  isAi: boolean;
  /** 房主（只有联机局知道；本机局恒 false，见文件头那张表） */
  isHost: boolean;
  eliminated: boolean;
  /** 这一期交片了没有（两种来源都拿得到，所以不是 null） */
  submitted: boolean;
  liked: boolean | null;
  voted: boolean | null;
}

// ────────────────────────────── 本机单机局 ──────────────────────────────

/** localRosterOf 收的那份状态（结构类型：不 import store，Node 能直接跑）。 */
export interface LocalRosterInput {
  players: readonly Pick<GamePlayer, "id" | "hp" | "eliminated">[];
  /** 这一期的作品（`state.entries`）：交片 / 点赞 / 投票三格全从这里读 */
  entries: readonly Pick<RoundEntry, "playerId" | "likedBy" | "votedBy">[];
  /** 这一期弃权的人（`state.abstained`）：弃权也算"表过态"（与 rules.votesPendingOf 同一条口径） */
  abstained: readonly string[];
  meId: string;
}

/**
 * 本机单机局（我 + AI 补位）的名单。
 * ★ 单机版**一个数都不重算**：交片 = entries 里有没有他，点赞 / 投票 = 那两个数组里有没有他，
 *   全部是 state 里现成的（与展映 / 投票屏读的是同一份）。
 */
export function localRosterOf(input: LocalRosterInput): RosterSeat[] {
  const seats: RosterSeat[] = input.players.map((player) => {
    const id = player.id;
    const mine = (entry: Pick<RoundEntry, "playerId" | "likedBy" | "votedBy">) => entry.playerId === id;
    return {
      id,
      name: null,
      userId: null,
      hp: player.hp,
      isMe: id === input.meId,
      isAi: id !== input.meId,
      isHost: false,
      eliminated: player.eliminated,
      submitted: input.entries.some(mine),
      liked: input.entries.some((entry) => entry.likedBy.includes(id)),
      voted:
        input.abstained.includes(id) || input.entries.some((entry) => entry.votedBy.includes(id)),
    };
  });
  return meFirst(seats);
}

// ────────────────────────────── 联机局 ──────────────────────────────

/** 房间快照里的一个成员（`RemoteRoomMember` / `RoundMember` 都满足）。 */
export interface OnlineRosterMember {
  userId: string;
  /** 服务端昵称（session.members 的 `name`；房间快照的 `displayName` 由调用方先折过来） */
  name: string | null;
  hp: number;
}

/** 结算榜的一行（只用得上这三格：血、出局位、名字）。 */
export interface OnlineRosterRankRow {
  userId: string;
  hp: number;
  eliminated: boolean;
  name?: string | null;
}

/** 回合快照的一条交片（只用得上这三格）。 */
export interface OnlineRosterEntry {
  userId: string;
  likedByMe: boolean;
  votedByMe: boolean;
}

export interface OnlineRosterInput {
  members: readonly OnlineRosterMember[];
  /** 服务端房间快照的 hostId（房主转移之后每拍都会变，界面不用退出重进） */
  hostId: string | null;
  myUserId: string;
  /** 跨回合的血量记录（开局房间快照 + 每次结算覆盖，见 roundsStore.memberHp 的 ★） */
  memberHp: Readonly<Record<string, number>>;
  /** 最近一次结算榜（结算里的血 / 淘汰是那一刻的服务端真相） */
  settlement: readonly OnlineRosterRankRow[] | null;
  /** 当前回合快照的交片；null = 还没读到回合（此时"已交片"只能按 false 说 —— 这是真的没交） */
  entries: readonly OnlineRosterEntry[] | null;
  /** 当前回合号（弃权那一格按"这一回合"对） */
  round: number | null;
  /** 我弃权的是哪一回合（服务端快照不暴露"我弃权了"，只有本机这一格） */
  abstainedRound: number | null;
}

/**
 * 联机局的名单（服务端房间成员）。
 * ★ 血量三级优先：结算行 > 跨回合记录 > 成员快照 —— 与 ui/OpponentStrip 同一条（别在这里另排一套）。
 * ★ 别人那一行"已点赞 / 已投票"是 null（服务端不下发），只有我这一行是真的。
 */
export function onlineRosterOf(input: OnlineRosterInput): RosterSeat[] {
  const entries = input.entries ?? [];
  const seats: RosterSeat[] = input.members.map((member) => {
    const userId = member.userId;
    const isMe = userId === input.myUserId;
    const row = input.settlement?.find((candidate) => candidate.userId === userId) ?? null;
    // `??` 而不是 `||`：hp 为 0 是**有效的真相**（淘汰），不能被当成"没读到"再往后找
    const hp = row?.hp ?? input.memberHp[userId] ?? member.hp;
    return {
      id: userId,
      name: row?.name ?? member.name,
      userId,
      hp,
      isMe,
      isAi: false,
      isHost: input.hostId !== null && input.hostId === userId,
      eliminated: row?.eliminated ?? hp <= 0,
      submitted: entries.some((entry) => entry.userId === userId),
      // 我点过赞 = 某条交片上 likedByMe；别人点过赞这件事服务端不暴露 → null（不摆，也不猜）
      liked: isMe ? entries.some((entry) => entry.likedByMe) : null,
      // 弃权也算表过态（与 roundsStore.abstainedRound 同一条）；同样只有我这一行知道
      voted: isMe
        ? entries.some((entry) => entry.votedByMe) ||
          (input.round !== null && input.abstainedRound === input.round)
        : null,
    };
  });
  return meFirst(seats);
}

/** 我在第一行，其余保持原顺序（见文件头 ★ 排序那一条）。 */
function meFirst(seats: RosterSeat[]): RosterSeat[] {
  const me = seats.find((seat) => seat.isMe);
  if (!me) return seats;
  return [me, ...seats.filter((seat) => seat !== me)];
}
