/**
 * 本局战绩 + 回放的**纯规则**（2026-11-24；服务端 `GET /api/game/rooms/:code/rounds/history`）。
 *
 * ★★ 这一层只回答三件事，全是"错了也零报错"的判断题：
 *   ① 这一次该不该发请求（`historyPlanOf`）—— 本机单机局 / 能力位为假**一个请求都不发**；
 *   ② 服务端那一份历史 → 回放条要显示的东西（`historyBarsOf`）—— 名次只从 `settlement.ranking`
 *      的位置取，点赞 / 票数只从服务端给的那几个计数取，**不按 entries 自己排一遍**；
 *   ③ 失败是"房间没了 / 我不在里头 / 这台服务器没开 / 没连上"里的哪一种（`historyFailureOf`）。
 *      话在 `historyReasons.ts` 一处说（与 roundsReasons / lobbyReasons 同一条分工）。
 *
 * ★ 为什么要有它、而不是把判断写进组件：这三件事在界面上的症状分别是"空白页 / 名次显示错 /
 *   退路说了句不对的话"，都只在真实残局里出现。零依赖 + 构建门禁直接 import 跑正反例
 *   （`scripts/check-game-history.mjs`）是唯一能在 CI 里看见它们的地方。
 * ★ 依赖方向：只 `import type`（`api/game/rounds` 的类型），运行时零依赖 —— Node 直接 import 得动。
 */
import type {
  RemoteGameHistory,
  RemoteHistoryPlayer,
  RemoteHistoryRound,
  RoundsFailure,
} from "../../api/game/rounds";

/**
 * 这一次该拿哪一份回放。
 * - `local`：这一局是本机对局（没有房间码）—— 服务端那边没有它的历史；
 * - `off`：能力位**明确**为假（老服务端 / `GAME_HISTORY=off`）—— 不发请求，直接走"这一局没有回放"；
 * - `remote`：有房号、能力位为真或者还不知道（null = 探测慢半拍，照发，见 serverCaps 的 ★）。
 *
 * ★ `request` 是给构建门禁与 store 的**唯一判据**：只有 remote 那一支才允许调用 `readHistory`。
 *   能力位为假还发一发，在老服务端上吃的是 SPA 回退的 200 + HTML（形状不认识），
 *   界面上表现为"没连上、再试一次"—— 把"这台服务器没有这个功能"说成了"网络不好"。
 */
export type HistoryPlan =
  | { kind: "local"; request: false }
  | { kind: "off"; request: false }
  | { kind: "remote"; request: true; code: string };

export function historyPlanOf(roomCode: string | null | undefined, cap: boolean | null): HistoryPlan {
  const code = typeof roomCode === "string" ? roomCode.trim() : "";
  if (!code) return { kind: "local", request: false };
  if (cap === false) return { kind: "off", request: false };
  return { kind: "remote", request: true, code };
}

/**
 * 失败的四类退路（话在 historyReasons 一处说）。
 * ★ `GAME_HISTORY_OFF` / `GAME_ROUNDS_OFF` 归 `off`：它们与能力位为假是同一件事（这台服务器现在
 *   没有回放），不是"没连上"—— 混进 unavailable 会让重试键永远重试一个不会开的端点。
 * ★ 认不出的业务码原样带着（`code`）：照实说，不装作没事（与 roundsReasons 的默认支一致）。
 */
export type HistoryFailure =
  | { kind: "expired" }
  | { kind: "not-member" }
  | { kind: "off" }
  | { kind: "unavailable" }
  | { kind: "code"; code: string };

export function historyFailureOf(failure: RoundsFailure): HistoryFailure {
  if (failure.reason !== "code") return { kind: "unavailable" };
  switch (failure.code) {
    case "ROOM_NOT_FOUND":
      return { kind: "expired" };
    case "NOT_IN_ROOM":
      return { kind: "not-member" };
    case "GAME_HISTORY_OFF":
    case "GAME_ROUNDS_OFF":
      return { kind: "off" };
    default:
      return { kind: "code", code: failure.code };
  }
}

/**
 * 失败之后还允许再试一次吗。
 * ★ 任务的口径是"页面自己拉一次，失败可重试一次"：`attempts` 数的是**已经发出去的次数**
 *   （首次 = 1），所以只有 1 次时还能点重试。房间过期 / 不在房里 / 能力位关着不是重试能解决的，
 *   界面也不摆重试键（那一支不走这里）。
 */
export function historyRetryAllowed(attempts: number): boolean {
  return attempts < 2;
}

/** 结算榜里"我"那一行（名次 = 它在 ranking 里的位置 + 1；服务端已按 composite 排成不并列的一列）。 */
export interface HistoryMine {
  rank: number;
  damage: number;
  hp: number;
  eliminated: boolean;
}

/** 一条回放条（一回合一条；数量恒等于 `rounds.length`，含正在打的那一回合）。 */
export interface HistoryBar {
  round: number;
  settled: boolean;
  /** 这一回合我交的那条投稿（没有 = 这一回合我没交片，淘汰后的回合就是这样） */
  hasEntry: boolean;
  name: string | null;
  /** 封面：我的投稿的 posterUrl；没有就由界面画占位色块 */
  posterUrl: string | null;
  videoUrl: string | null;
  placeholder: boolean;
  /** 我在这一回合的名次 / 扣血 / 剩血；没结算或我这一回合没进榜 = null */
  mine: HistoryMine | null;
  /** 这一回合我的投稿拿到的点赞 / 票数（服务端计数；谁投给谁不暴露） */
  likes: number;
  votes: number;
}

/**
 * 历史回包 → 每回合一条回放条。
 *
 * ★★ 名次**只认 `settlement.ranking` 的位置**：服务端 settle 时已经按
 *   composite → voteRank → votes → likes → userId 排成不并列的一列，客户端再 sort 一遍
 *   就是第二套名次口径（`summary.wins` 也按 ranking[0] 算，两边迟早对不上）。
 * ★ 点赞 / 票数优先取投稿上的计数、没有投稿时取结算行上的同一对数：两者在服务端是同一份计数
 *   （`countsOf`），客户端只做"哪一份先有就念哪一份"，不做求和。
 * ★ 一回合一条，**按服务端给的 rounds 顺序**（已按 round 升序），不在这里排序。
 */
export function historyBarsOf(history: RemoteGameHistory, myUserId: string | null): HistoryBar[] {
  return history.rounds.map((round) => barOfRound(round, myUserId));
}

function barOfRound(round: RemoteHistoryRound, myUserId: string | null): HistoryBar {
  const entry = myUserId ? round.entries.find((one) => one.userId === myUserId) : undefined;
  const rankIndex = myUserId && round.settlement ? round.settlement.ranking.findIndex((row) => row.userId === myUserId) : -1;
  const row = rankIndex >= 0 && round.settlement ? round.settlement.ranking[rankIndex] : null;
  return {
    round: round.round,
    settled: round.settled,
    hasEntry: Boolean(entry),
    name: entry?.name ?? null,
    posterUrl: entry?.posterUrl ?? null,
    videoUrl: entry?.videoUrl ?? null,
    placeholder: entry?.placeholder ?? false,
    mine: row && rankIndex >= 0 ? { rank: rankIndex + 1, damage: row.damage, hp: row.hp, eliminated: row.eliminated } : null,
    likes: entry?.likes ?? row?.likes ?? 0,
    votes: entry?.votes ?? row?.votes ?? 0,
  };
}

/**
 * 底部 summary 表的行 —— **就是服务端给的 `perPlayer`**，一行不加、一行不删、顺序不动。
 * ★ 这张表的每一格（wins / likesTotal / votesTotal / bestRound）都是服务端按自己的口径算的
 *   （`gameRound.service.getHistory` 的文件头）；客户端一重算，"我明明赢了 2 回合"就会对不上。
 *   函数只做"从哪读"的收口，界面与构建门禁都从这里拿行。
 */
export function historySummaryRowsOf(history: RemoteGameHistory): RemoteHistoryPlayer[] {
  return history.summary.perPlayer;
}

/** 这一行是不是我（高亮用；`myUserId` 拿不到时一律不高亮，别猜）。 */
export function historyRowIsMine(row: RemoteHistoryPlayer, myUserId: string | null): boolean {
  return myUserId !== null && row.userId === myUserId;
}
