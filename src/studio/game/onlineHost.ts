/**
 * 联机对局里"谁在推进阶段 / 这局结束没有 / 事件算服务端还是本机"的**唯一**判据
 * （2026-11-24 房主转移 + 平局收口；2026-11-23 服务端补了 `state` / `winners` / `finishedAt`，
 *   结束判定改读字段，见 roomOverOf）。
 *
 * ★★ 为什么单开一个零依赖模块（不是塞进 roundsStore / PhaseBar）：
 *   · 这几件事在**好几个地方**各要一半：轮询每一拍要拿房间快照刷新房主（roundsStore）、
 *     阶段条要按"我是不是房主"决定摆哪颗键（PhaseBar）、构建门禁要直接 import 跑断言
 *     （scripts/check-game-online.mjs）；塞进 store 就只能靠人点。
 *   · rules.ts 里已经有 `winnerTargetOf`（胜者名额的唯一实现，服务端 config/gameRound.js 同式）：
 *     过渡分支的"名额"不再抄一份，值 import 只来自那一个零依赖模块（check-import-direction ③ 允许）。
 * ★ 服务端事实（2026-11-23 核过 ideahub-server 的 gameRoom.service / gameRound.service）：
 *   · `GET /rooms/:code` 带 `state`（waiting / playing / over）+ `winners`（空数组 = 平局）+
 *     `finishedAt` + `members[].hp` + `hostId` —— **结束判定就照 state 读**（契约原文：判结束只看 state）。
 *     落库时机是 `rounds/next` 遇 `GAME_OVER` 那一发，所以房主 / 非房主在**同一拍**从快照里读到它。
 *   · 老服务端没有 state：`roomOverOf` 的过渡分支按 `gameOverOf` 同口径从 hp 推（见那里的 ★）。
 *   · 回合间事件由服务端出题（`rounds/events*`，同一房间同一回合同一道题）：来源判据是
 *     onlineEventSourceOf（能力位 + 那一发的结果），只有"真的一条服务端事件"才在本地只落 client 那一半。
 */
// ★ 带 .ts：构建门禁（scripts/check-game-online.mjs）用 Node 直接 import 本文件跑断言，
//   Node 的 ESM 不做无扩展解析（与 lobby.ts 引 rules.ts 同一条写法）。
import { optionAvailable, winnerTargetOf, type ModelGate } from "./rules.ts";
// 纯类型 import（Node 的类型擦除会整条丢掉）：这里不 import api / store，保持零依赖、Node 能直接跑。
import type { OnlineEventChoice } from "./rules.ts";
import type { EventEffect, GamePlayer } from "./types.ts";

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
   * 服务端认的三态：`waiting` / `playing` / `over`（**判结束只看它**，2026-11-23 起服务端给了这一位）。
   * ★ `null` / 缺省 = 老服务端没有这一位（**不知道**，不是"没结束"）→ roomOverOf 走过渡分支。
   */
  state?: string | null;
  /** 更老的一版兼容位（今天服务端的快照里是 `state`，没有这一位） */
  over?: boolean | null;
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
  /** server = 服务端快照直接给了；derived = 过渡分支按服务端 gameOverOf 的同一口径从 hp 推出来的 */
  source: "server" | "derived";
}

/** 房间快照里的 winners → 干净的 userId 数组（服务端只给字符串；脏的一项丢掉而不是整份不认）。 */
function winnersOfRoom(room: OnlineRoomLike): string[] {
  return Array.isArray(room.winners) ? room.winners.filter((id): id is string => typeof id === "string") : [];
}

/**
 * 房间快照 → 这一局结束没有。**判结束只看服务端给的 `state`**。
 *
 * ① 服务端有 `state`（2026-11-23 起）：
 *    · `"over"` → 结束，`winners` 照读（**空数组 = 平局 / 同归于尽**，服务端契约：没结束才是 null）；
 *    · `"waiting"` / `"playing"` → **没结束**（服务端明说了，就不再按 hp 去猜 —— 这条从"客户端推"改成
 *      "读协议字段"正是本轮要收的口径）。
 *    · 与 `phase` 无关：结束那一刻服务端已经落库，房主 / 非房主 / 任何阶段读到的都是同一份。
 * ② 过渡分支（**老服务端没有 `state`**，docs/game-lobby.md §7.7 的缺口）：按服务端 `gameOverOf` 的
 *    同一口径从 `members[].hp` 推 —— 存活人数 ≤ `winnerTargetOf(当前成员数)`。只在 `phase === "settled"`
 *    时才认（中途有人退房也会让存活数提前达标，而那时下一回合还没结算，服务端 next 也不会回 GAME_OVER）。
 *    ★ 这是**过渡兼容**，不是第二份规则：服务端补上 `state` 之后这条分支永远走不到
 *      （快照里 state 一定有值），攒到下线老服务端就可以整段删掉。
 *    ★ 为什么成员数取**当前**成员数：服务端 `gameOverOf` 用的就是 `room.members.length`（不是开局座位数），
 *      中途有人退出会让名额跟着收紧；用开局座位数会在"4 人局走掉 2 人"时永远等不到结束。
 */
export function roomOverOf(
  room: OnlineRoomLike | null | undefined,
  phase: OnlinePhaseLike,
): OnlineRoomOver | null {
  if (!room) return null;
  // ── ① 服务端给的 state（today）─────────────────────────────────────────────
  const state = typeof room.state === "string" ? room.state : null;
  if (state === "over") return { winners: winnersOfRoom(room), source: "server" };
  if (state !== null) return null; // waiting / playing：服务端说了没结束
  // 更老的一版兼容位（`over:true` / `over:false`；服务端今天的快照里是 `state`，没有这一位）
  if (room.over === true) return { winners: winnersOfRoom(room), source: "server" };
  if (room.over === false) return null;
  // ── ② 过渡分支：老服务端没有 state，按 gameOverOf 同口径推（只在已结算时认）──────
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
 * 这一局**已经判定结束**了吗（界面据此进 `/over/` 那一屏）。
 * ★ 形参收的是"胜者名单或 null"（`roundsStore.winners` / `roomOverOf().winners`）：
 *   `null` = 还没结束；**`[]` = 结束了但平局**——两者在 JS 里 `.length` 都是 0，差在**是不是 null**。
 *   所以千万别写成 `if (!winners?.length) return;`：平局那一局会永远停在结算屏（这正是本轮
 *   要收的那条"平局也要所有端进 over"）。判据**只有这一处**，界面与构建门禁都问它。
 */
export function overDecidedOf(winners: readonly unknown[] | null | undefined): boolean {
  return winners !== null && winners !== undefined;
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

// ────────────────────────────── 回合间事件（2026-11-23 服务端出题） ──────────────────────────────

/**
 * 这一局的事件算**服务端**的还是**本机**的（唯一判据）。
 *
 * ★ 只有能力位为真 **且** 事件那一发没失败才走服务端：
 *   · 能力位为假 / 读不到（老服务端）→ `local`：本机事件（各抽各的，界面写明「事件只在本机生效」）；
 *   · 能力位为真但接口失败（超时 / 5xx / 形状不认识，调用点传 `fetchFailed`）→ 同样 `local`，
 *     并且同样写明那句话 —— "看起来像服务端的、其实是本机的"是最坏的一种；
 *   · 能力位**还不知道**（健康端点还没答上来）→ `unknown`：调用点接着等（下一拍再问），
 *     既不能当服务端（老服务端会吃 SPA 的 200 + HTML），也不该急着把这一回合判成本机。
 * ★ 必须两边看到同一道题：退回本机就不再假装跨端一致（这正是本轮要收口的那件事）。
 */
export type OnlineEventSource = "server" | "local" | "unknown";

export function onlineEventSourceOf(capability: boolean | null, fetchFailed = false): OnlineEventSource {
  if (fetchFailed) return "local";
  if (capability === true) return "server";
  if (capability === false) return "local";
  return "unknown";
}

/**
 * 服务端下发的事件选项里这个模块要用的那几格（结构类型：不 import api，保持零依赖、Node 能直接跑）。
 * ★ 形状由 `api/game/rounds.RemoteEventOption` 满足（那边多一个 `label`，TS 在调用点逐字段核对）。
 */
export interface OnlineEventOptionLike {
  id: string;
  cost: number;
  effects: {
    /** 服务端**已经落库**的那一半（今天只有 hp）—— 只许念，不许应用 */
    server?: { hp?: number | null } | null;
    /** 交给 App 本地应用的那一半（与 rules.EventEffect 同形） */
    client?: readonly EventEffect[] | null;
  };
}

/** 服务端选项里**只在本地落**的效果（hp 永远不在这里：那是服务端落库的那一份）。 */
export function onlineClientEffectsOf(option: OnlineEventOptionLike): EventEffect[] {
  return [...(option.effects.client ?? [])];
}

/** 服务端已经替玩家落库的回血量（界面念一句「服务端已回 X 血」；**不进**本地效果数组）。 */
export function onlineServerHpOf(option: OnlineEventOptionLike): number {
  const hp = option.effects.server?.hp;
  return typeof hp === "number" && Number.isFinite(hp) ? hp : 0;
}

/**
 * 服务端下发的一个选项 → 规则层只该落的那一份（**只有 client 效果**，见 rules.applyOnlineEventChoice）。
 * ★ 只在这一个函数里做"协议 → 规则输入"的翻译：界面与 store 都不各自拆一次 effects，
 *   拆两次就会出现"界面上按 A 算、本地按 B 落"。
 */
export function onlineChoiceOf(option: OnlineEventOptionLike): OnlineEventChoice {
  return {
    optionId: option.id,
    cost: option.cost,
    clientEffects: onlineClientEffectsOf(option),
    serverHp: onlineServerHpOf(option),
  };
}

/**
 * 服务端这份事件里，我**摆得出来**的选项（模型军备的 L2 / L3 两条升级线按档位 / 连胜筛）。
 *
 * ★ 判据仍然是 `rules.optionAvailable`（唯一实现：界面摆哪些、真扣钱都问它）——
 *   服务端不知道本机的金币与档位，所以它给**全量**选项，筛这一步在 App。
 *   不筛的后果：免费账号看到一条点下去会被本地规则拒（option-unavailable）的升级项，
 *   而服务端那边已经把这次选择记下了 —— 屏幕上"能点"和"能落"分成两件事。
 * ★ 只拿 `client` 效果去判：`server.hp` 不参与"能不能摆"（血量从来不是选项的准入条件）。
 */
export function onlineOptionsFor<T extends OnlineEventOptionLike>(
  player: GamePlayer,
  options: readonly T[],
  gate: ModelGate,
): T[] {
  return options.filter((option) =>
    optionAvailable(
      player,
      { id: option.id, cost: option.cost, effects: onlineClientEffectsOf(option), art: "" },
      gate,
    ),
  );
}
