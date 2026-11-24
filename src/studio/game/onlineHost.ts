/**
 * 联机对局里"谁在推进阶段 / 这局结束没有"的**唯一**判据（2026-11-24 房主转移 + 平局收口）。
 *
 * ★★ 为什么单开一个零依赖模块（不是塞进 roundsStore / PhaseBar）：
 *   · 这两件事在**三个地方**各要一半：轮询每一拍要拿房间快照刷新房主（roundsStore）、
 *     阶段条要按"我是不是房主"决定摆哪颗键（PhaseBar）、构建门禁要直接 import 跑断言
 *     （scripts/check-game-online.mjs）；塞进 store 就只能靠人点。
 *   · rules.ts 里已经有 `winnerTargetOf`（胜者名额的唯一实现，服务端 config/gameRound.js 同式）：
 *     结束判定的"名额"不再抄一份，值 import 只来自那一个零依赖模块（check-import-direction ③ 允许）。
 * ★ 服务端事实（2026-11-24 核过 ideahub-server 的 gameRoom.service / gameRound.service）：
 *   · `GET /rooms/:code` 带 `hostId` + `members[].hp`（**房主 / 血量的真相**），
 *     但**没有** `state:"over"` / `winners` / `finishedAt`，`status` 也一直是 playing —— 见 docs/game-lobby.md §7.7。
 *   · `POST rounds/next` 只有房主能发，且先判房主再看胜负：非房主永远拿不到那个 `GAME_OVER`。
 *   所以这里的结束判定分两档：**服务端哪天补了字段就直接读**；今天没有就按服务端
 *   `gameOverOf` 的同一口径（存活 ≤ 胜者名额）从房间快照推 —— 只在"这一回合已经结算"时才认。
 */
// ★ 带 .ts：构建门禁（scripts/check-game-online.mjs）用 Node 直接 import 本文件跑断言，
//   Node 的 ESM 不做无扩展解析（与 lobby.ts 引 rules.ts 同一条写法）。
import { winnerTargetOf } from "./rules.ts";

/** 房间快照里这个模块要用的那几格（结构类型：不 import api，保持零依赖、Node 能直接跑）。 */
export interface OnlineRoomMemberLike {
  userId: string;
  hp?: number;
  /** 服务端昵称（`RemoteRoomMember.displayName` 的同一份事实；胜者名单只存 id） */
  displayName?: string;
}

export interface OnlineRoomLike {
  hostId?: string | null;
  /** 服务端成员数（`RemoteRoom.memberCount`；没有就按 members.length）。结束名额按**当前**成员数算 */
  memberCount?: number;
  members?: OnlineRoomMemberLike[];
  /**
   * 服务端未来可能放进快照的结束位（今天没有）。
   * ★ `true` = 这局结束了；`false` / `null` = **不知道**（老服务端不会说"没结束"）——
   *   别把"不知道"读成"没结束"，两条路的分叉在 roomOverOf 里。
   */
  over?: boolean | null;
  /** 服务端未来可能给 `state:"over"`（契约草稿里的写法）；与 `over` 同义 */
  state?: string | null;
  /** 服务端给的胜者 userId（空数组 = 平局）；没带这一位 = 不知道 */
  winners?: string[] | null;
}

/** 谁抽到了那个"回合结算后可推进"的角色。 */
export type OnlineRole = "host" | "guest";

/** 阶段条上那四颗由房主掌握的推进键。 */
export type OnlinePhaseKey = "screening" | "voting" | "settle" | "next";

/** 联机的回合阶段（与 `RemoteRoundPhase` / `GamePhase` 的重合部分；不 import 任何一边）。 */
export type OnlinePhaseLike = "create" | "screening" | "voting" | "round-end" | string | null;

/** 房主是谁：只认服务端快照的 `hostId`；老快照没有这一位时退到 `members[].isHost`（服务端派生量）。 */
export function hostIdOfRoom(room: OnlineRoomLike | null | undefined): string | null {
  if (!room) return null;
  if (typeof room.hostId === "string" && room.hostId) return room.hostId;
  const flagged = (room.members ?? []).find((member) => (member as { isHost?: boolean }).isHost === true);
  return flagged?.userId ?? null;
}

/**
 * 用房间快照里的 hostId 刷新"我是不是房主"。
 * ★ 返回原对象（引用不变）当身份没变：这一拍每 2 秒一次，每次都换对象会让整条阶段条白重渲；
 *   而身份**变了**必须换对象 —— 那一拍就是新晋房主拿到键的时刻（任务点名：不用退出重进）。
 */
export function withRoomHost<T extends { myUserId: string; isHost: boolean }>(session: T, hostId: string | null): T {
  const isHost = hostId !== null && hostId === session.myUserId;
  return session.isHost === isHost ? session : ({ ...session, isHost } as T);
}

/** 这一局结束了吗 + 胜者（空数组 = 平局）；null = 还没结束（或还不知道）。 */
export interface OnlineRoomOver {
  winners: string[];
  /** server = 服务端快照直接给了；derived = 按服务端 gameOverOf 的同一口径从 hp 推出来的 */
  source: "server" | "derived";
}

/**
 * 房间快照 → 这一局结束没有。
 *
 * ① 服务端**给了**结束位（`over:true` / `state:"over"`）：照读。没带 winners = 平局（服务端契约：
 *    winners 缺省就是"空数组 = 同归于尽"）。
 * ② 服务端**今天没有**这一位（§7.7 的缺口）：只在 `phase === "settled"` 时，按 `gameOverOf` 同一口径
 *    从房间快照的 `members[].hp` 推：存活人数 ≤ `winnerTargetOf(当前成员数)`。
 *    ★ 为什么必须卡 settled：中途有人退房会让"存活人数"提前达标，而那时下一回合还没结算 ——
 *      提前跳结束屏等于把还在打的一局收掉。服务端 nextRound 也是先要求 `phase === "settled"` 才看胜负。
 *    ★ 为什么成员数取**当前**成员数：服务端 `gameOverOf` 用的就是 `room.members.length`（不是开局座位数），
 *      中途有人退出会让名额跟着收紧；用开局座位数会在"4 人局走掉 2 人"时永远等不到结束。
 */
export function roomOverOf(
  room: OnlineRoomLike | null | undefined,
  phase: OnlinePhaseLike,
): OnlineRoomOver | null {
  if (!room) return null;
  const serverSaysOver = room.over === true || room.state === "over";
  if (serverSaysOver) {
    const winners = Array.isArray(room.winners) ? room.winners.filter((id): id is string => typeof id === "string") : [];
    return { winners, source: "server" };
  }
  // 服务端明确说"没结束"（未来字段 over:false）时才敢在这里收手；没有这一位就继续按 hp 推
  if (room.over === false) return null;
  if (phase !== "settled") return null;
  const members = room.members ?? [];
  if (members.length === 0) return null;
  const hpOf = (member: OnlineRoomMemberLike) => (typeof member.hp === "number" ? member.hp : 100);
  const alive = members.filter((member) => hpOf(member) > 0);
  const target = winnerTargetOf(room.memberCount ?? members.length);
  if (alive.length > target) return null;
  // 顺序与服务端 gameOverOf 一致（血多的在前，同血按 userId）：结算回包里那两个名字不能两屏不同序
  const winners = alive
    .slice()
    .sort((a, b) => hpOf(b) - hpOf(a) || a.userId.localeCompare(b.userId))
    .map((member) => member.userId);
  return { winners, source: "derived" };
}

/**
 * 这一阶段该由谁按哪颗键（host = 房主，guest = 其他成员）。
 * ★ 只回答"摆哪颗 / 摆不摆"，不回答 disabled：开始展映还差人交片时键照样在（灰着 + 服务端原因），
 *   而 disabled 的判据（allSubmitted / busy）留在 PhaseBar —— 那里读的是服务端快照的现成字段。
 * ★ 非房主不是"没有推进权"：服务端允许**全员表态之后任何成员**结算（就是自动结算那一拍），
 *   所以 voting + votesPending===0 时 guest 也有键；其余阶段等房主。
 */
export function phaseKeyOf(
  role: OnlineRole,
  phase: OnlinePhaseLike,
  ctx: { votesPending: number },
): OnlinePhaseKey | null {
  if (role === "host") {
    switch (phase) {
      case "create":
        return "screening";
      case "screening":
        return "voting";
      case "voting":
        return "settle";
      case "round-end":
        return "next";
      default:
        return null;
    }
  }
  return phase === "voting" && ctx.votesPending === 0 ? "settle" : null;
}
