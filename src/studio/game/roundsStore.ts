/**
 * 联机回合的界面状态（2026-11-24 接上服务端回合引擎）。
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
 */
import { create } from "zustand";
import { leaveRoom, readRoom, type RemoteRoom } from "../../api/game/rooms";
import {
  likeRoundEntry,
  nextRound,
  readRound,
  settleRound as settleRemoteRound,
  setRoundPhase,
  submitRoundEntry,
  voteRoundEntry,
  type RemoteRound,
  type RemoteRoundEntryInput,
  type RemoteSettlement,
  type RemoteWinner,
  type RoundsFailure,
} from "../../api/game/rounds";
import { hostIdOfRoom, roomOverOf, withRoomHost } from "./onlineHost";
import { clearOnlineResume } from "./onlineResume";

/** 回合屏的轮询间隔（服务端契约：轮询路径按 2 秒一次算，240 次/分钟够两台设备同时开着）。 */
export const ROUND_POLL_MS = 2_000;

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
 *   fallback = 这一局已经退回单机（说一次「回合服务没响应，这一局改成单机继续」）
 *   unavailable = 这一拍没成功，还能重试（不切单机）
 *   code = 服务端明确拒了这一步（认码，不认 message）
 */
export type RoundNote =
  | { kind: "fallback" }
  | { kind: "unavailable" }
  | { kind: "code"; code: string };

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
  note: RoundNote | null;
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
  /** 轮询一拍：读 current；到结算阶段就把 settlement 取回来。 */
  poll: () => Promise<"ok" | "stop" | "fallback">;
  submit: (input: RemoteRoundEntryInput) => Promise<boolean>;
  advance: (phase: "screening" | "voting") => Promise<boolean>;
  like: (targetUserId: string) => Promise<boolean>;
  vote: (targetUserId: string | null) => Promise<boolean>;
  settle: () => Promise<boolean>;
  next: () => Promise<"round" | "over" | "waiting">;
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

export const useRounds = create<RoundsStore>((set, get) => {
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
      memberHp: {},
      note,
      busy: false,
      settling: false,
      abstainedRound: null,
      autoSettleTriedRound: null,
    });
    // 这一局已经改成单机了：下次冷启动不该再尝试恢复它（否则会把人拉回一张已经打完的联机桌）
    clearOnlineResume();
    if (session) {
      void leaveRoom(session.roomCode).then((res) => {
        if (!res.ok) console.warn("[rounds] 退回单机时退房失败（服务端可能还挂着）", session.roomCode);
      });
    }
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
      if (remoteWinners !== null) {
        set({ winners: remoteWinners });
        clearOnlineResume();
      }
      set({
        settlement: res.value.settlement,
        // 结算行的 hp 是服务端的真相：覆盖进跨回合记录（对手条 / 交片的 x/y 都读它）
        memberHp: { ...get().memberHp, ...hpOfSettlement(res.value.settlement) },
        note: null,
        // 结算回包确认了阶段：把快照的 phase 对齐（entries 还是上一份的 entries）
        snapshot: get().snapshot ? { ...(get().snapshot as RemoteRound), phase: "settled" } : null,
      });
    } finally {
      set({ settling: false });
    }
  };

  return {
    session: null,
    room: null,
    snapshot: null,
    settlement: null,
    winners: null,
    note: null,
    busy: false,
    settling: false,
    autoSettleTriedRound: null,
    abstainedRound: null,
    memberHp: {},

    begin: (session, snapshot) =>
      set({
        session,
        // room 由轮询的第一拍（≤ 2 秒）从 GET /rooms/:code 灌进来；开局这一份只带座位 / 血，
        // 不逼调用方多传一个参数（host 身份在 poll 里也会再对一次，房间快照是真相）。
        snapshot,
        // 开局时房间快照里的 hp 就是起点；之后每次结算再覆盖（见 memberHp 的 ★）
        memberHp: Object.fromEntries(session.members.map((member) => [member.userId, member.hp])),
        settlement: null,
        winners: null,
        note: null,
        busy: false,
        settling: false,
        autoSettleTriedRound: null,
        abstainedRound: null,
      }),

    reset: () => {
      // 退出对局 = 这一局不再"可恢复"（leaveNow 走这一条；下次冷启动别把人拉回一张已经离席的牌桌）
      clearOnlineResume();
      set({
        session: null,
        room: null,
        snapshot: null,
        settlement: null,
        winners: null,
        note: null,
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
      if (session) {
        // 先清界面再退房：退出对局是玩家决定了的事，不该卡在"正在离开"
        void leaveRoom(session.roomCode).then((res) => {
          if (!res.ok) console.warn("[rounds] 退出对局时退房失败（服务端可能还挂着）", session.roomCode);
        });
      }
    },

    raiseFallback: () => set({ note: { kind: "fallback" } }),

    failNow: () => abandon({ kind: "fallback" }),

    clearNote: () => set({ note: null }),

    poll: async () => {
      const session = get().session;
      if (!session) return "stop";
      const code = session.roomCode;
      // ★★ 两发一起读：回合（打什么）+ 房间（谁在推进 / 谁还活着 / 这局结束没有）。
      //   ★ 房间快照**每拍都读**（2 秒一次，服务端 poll 限流 240/分钟，这一端只花 60）：
      //     房主转移是服务端自己改的、回合快照里没有 hostId —— 不读房间就永远不知道新主人是谁。
      //   ★ 两发并发：弱网时 10 秒超时叠住下一拍的问题与原来一样，但总时长是 max(两发) 不是两倍。
      const [roundRes, roomRes] = await Promise.all([readRound(code), readRoom(code)]);
      if (!sessionNow(code)) return "stop";
      if (!roundRes.ok) {
        // ★ 轮询是这一局的"心跳"：它失败就是真的断了（一两发的业务错误不会走到这儿）。
        //   按任务要求**不静默**：留一句 fallback，界面（ui/useOnlineRounds）据此把本地 loop 接回来。
        console.warn("[rounds] 回合快照轮询失败，这一局退回单机", roundRes.reason === "code" ? roundRes.code : "unavailable");
        abandon({ kind: "fallback" });
        return "fallback";
      }
      const nextSnapshot = roundRes.value;
      // 房间这一发失败（超时 / 老服务端）**不切单机**：沿用上一份房主 / 血量，下一拍再问；
      // 真正的"房间没了"回合那发也会失败，走上面那条 fallback。
      const nextRoom = roomRes.ok ? roomRes.value : get().room;
      const hostId = hostIdOfRoom(nextRoom);
      // 房主身份这一拍就刷新：服务端把 hostId 转给别人之后，新晋房主**不必退出重进**。
      const nextSession = hostId === null ? session : withRoomHost(session, hostId);
      const roundChanged = get().snapshot?.round !== nextSnapshot.round;
      const note = get().note;
      set({
        session: nextSession,
        room: nextRoom,
        snapshot: nextSnapshot,
        // 只清"这一拍没连上"那种临时原因：服务端的业务拒绝（NOT_HOST / CANNOT_LIKE_SELF …）要留在屏上
        // 让人看清，下一次动作成功 / 玩家点 ✕ 才收 —— 别让 2 秒一次的轮询把它一闪就擦掉。
        note: note?.kind === "unavailable" ? null : note,
        // 新回合：上一回合的结算 / 弃权全部作废（服务端每一回合都是新的一份）
        ...(roundChanged
          ? { settlement: null, winners: null, abstainedRound: null, autoSettleTriedRound: null }
          : {}),
      });
      // ── 这局结束了吗（房主 / 非房主都在这一拍知道）──────────────────────────
      // 服务端今天没有把"over"放进房间快照（§7.7 缺口）：onlineHost 按服务端 gameOverOf 的同一口径、
      // 只在**这一回合已结算**时从 members[].hp 推。推出来的名单与 next 的 GAME_OVER 同序同名。
      const over = roomOverOf(nextRoom, nextSnapshot.phase);
      if (over) markOver(over.winners);
      if (nextSnapshot.phase === "settled" || (nextSnapshot.phase === "voting" && nextSnapshot.votesPending === 0)) {
        await pullSettlement();
      }
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
        if (remoteWinners !== null) {
          set({ winners: remoteWinners });
          clearOnlineResume();
        }
        set({
          settlement: res.value.settlement,
          memberHp: { ...get().memberHp, ...hpOfSettlement(res.value.settlement) },
          note: null,
        });
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
        note: null,
        abstainedRound: null,
        autoSettleTriedRound: null,
      });
      return "round";
    },
  };
});

// DEV 调试挂钩（与 __game / __lobby 同款）：自动化脚本要直接驱动回合，不必去点界面。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__rounds = useRounds;
}
