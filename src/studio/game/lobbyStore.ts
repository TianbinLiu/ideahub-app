/**
 * 大厅 store（2026-11-23）：三种开局方式（4 人匹配 / 8 人匹配 / 自定义房间）的界面状态。
 *
 * ★★ 这一层是**纯状态 + 一个门**：房间的规矩一条都不在这里（谁能改人数 / 谁能踢人 / 谁能开始 /
 *   空位怎么补 AI 全在 lobby.ts 的纯函数里，node scripts/check-game-lobby.mjs 直接跑正反例）；
 *   开局那一步也不在这里 —— 大厅只交出"这一局几个座位"，由界面调 `useGame.startGame` 建局。
 *   ★ 为什么不在这里直接调 game store：对局 store 已经够大一摊（G2~G4 的回合循环都挂在它身上），
 *     再让两个 store 互相 import 就回到 CLAUDE.md 点名的那种"Vite 下拿到半初始化模块"的形状。
 *     界面是**唯一**同时认识两边的地方（ui/Lobby 的 startMatch）。
 * ★ 2026-11-24 联机接通：这一层多了网络（真实房间 / 匹配队列）。两条纪律没变：
 *   ① 每个动作只做"递出去 → 写回成功结果 → 把失败原因原样留着"，说人话在 lobbyReasons 一处；
 *   ② **任何接口不可用 / 超时 / 服务端没这一位**，一律自动退回本机房间（AI 补位）并在底栏说一句，
 *      绝不让玩家对着一屏"正在开房…"干等（铁律八）。
 * ★ 轮询不在这里：定时器全在 ui/useLobbyOnline（组件卸载 / 换屏就清掉）。
 *   这一层只提供"发一拍"的 pollQueue / pollRoom —— 谁在跑、什么时候停，读的是界面那一层的挂载。
 */
import { create } from "zustand";
import { createRng } from "./rules";
import {
  canStartRoom,
  createRoom,
  kickSeat,
  leaveRoom,
  LOCAL_SEAT_ID,
  normalizeServerCode,
  playerCountOf,
  roomCodeOf,
  setRoomSize,
  toggleReady,
  type LobbyFailure,
  type LobbyMode,
  type LobbyRoom,
  type LobbyScreen,
  type LobbySeat,
  type MatchSize,
  type RoomStartPlan,
} from "./lobby";
import {
  cancelMatch,
  createRoom as createRemoteRoom,
  findMatch,
  joinRoom,
  kickMember,
  leaveRoom as leaveRemoteRoom,
  readRoom,
  readQueue,
  roomsAvailable,
  setReady as setRemoteReady,
  startRoom,
  type MatchTicket,
  type RemoteRoom,
  type RoomsFailure,
} from "../../api/game/rooms";
import { currentUser } from "../../data/account";
import { probeServerCaps } from "../../data/serverCaps";

/** 自定义房间的默认人数：4（§5-1 的默认桌，也是 4 人匹配的桌）。 */
export const DEFAULT_ROOM_SIZE = 4;

/** 等匹配的轮询间隔（服务端契约：客户端每 2~5 秒一拍）。 */
export const QUEUE_POLL_MS = 2_000;
/**
 * 等匹配的上限（任务点名 60 秒）：到点就**主动停掉轮询**、取消排队、退回本机 AI 开局。
 * ★ 停掉这件事要说出来（铁律八）：`note.kind === "queue-timeout"` 会让底栏写
 *   「没匹配到真人，先用 AI 开局」，而不是继续转圈让人以为还在等。
 */
export const QUEUE_TIMEOUT_MS = 60_000;
/** 房间快照的轮询间隔（服务端契约：2~5 秒）。 */
export const ROOM_POLL_MS = 2_000;

/**
 * 底栏那一句话的**结构化原因**（文案在 lobbyReasons，唯一一处）。
 * ★ 不在这里拼中文：store 是纯状态，语言随界面切（同 lobbyFailureText 的分工）。
 */
export type LobbyNote =
  | { kind: "offline" }
  | { kind: "queue-timeout" }
  | { kind: "not-enough-players" }
  | { kind: "leave-failed" }
  | { kind: "bad-code" }
  | { kind: "kicked" }
  | { kind: "code"; code: string };

export interface LobbyStore {
  /** 大厅开着没有（开的一刻还没建局：StudioPage 的「▶ 开局」先开它） */
  open: boolean;
  screen: LobbyScreen;
  mode: LobbyMode | null;
  /** 4 人 / 8 人匹配时的那一桌（自定义房间看 room.size） */
  matchSize: MatchSize | null;
  /** 当前这一屏的房间（联机时由远端快照换算，联机断开后换成本机房间） */
  room: LobbyRoom | null;
  /** 最近一次被拒的原因（界面用 lobbyReasonText 说成人话） */
  rejection: LobbyFailure | null;
  /** 「邀请」那张小卡开着没有（里面是可复制的房间码） */
  inviteOpen: boolean;

  /** 这台服务器有没有房间服务（null = 还在问；false = 用本机 AI 补位，别发请求） */
  serverOnline: boolean | null;
  /** 当前匹配 / 房间是不是服务端的（false = 本机 AI 补位） */
  online: boolean;
  /** 联机房间的服务端快照（轮询写它；房间屏据此显示真人/准备/房主） */
  remoteRoom: RemoteRoom | null;
  /** 等匹配的队列现状（排队人数 / 还差几个） */
  queue: MatchTicket | null;
  /** 等匹配开始的时刻（60 秒上限按它算）；0 = 没在等 */
  matchStartedAt: number;
  /** 底栏那一句（退回本机 / 服务端给的原因），null = 没有 */
  note: LobbyNote | null;
  /** 正在发请求（开房 / 进房 / 进队）：按钮灰掉、底栏说明，别让人连点 */
  busy: boolean;
  /** 加入房间的输入框（6 位字母数字，服务端大小写不敏感） */
  joinCode: string;

  openLobby: () => void;
  closeLobby: () => void;
  /** 问一次服务端有没有房间服务（能力位）；返回能不能发房间请求 */
  refreshOnline: () => Promise<boolean>;
  /** 4 人 / 8 人匹配：先进"等匹配"那一屏，联机可用就进队轮询；不可用就本机 AI 补位 */
  chooseMatch: (size: MatchSize) => void;
  /** 自定义房间：联机可用就开服务端房间；不可用就开本机房间（AI 补位） */
  chooseRoom: () => void;
  /** 凭房间码加入别人的房间（联机不可用 / 码不对都在底栏说一句，不离屏） */
  joinByCode: (code?: string) => void;
  setJoinCode: (code: string) => void;
  /** 回到大厅首屏（房间还开着的话按"离开房间"处理：房主离开 = 散房） */
  backHome: () => void;

  /** 改人数（房主，2~8）；**联机房间不摆这一组键**（服务端没有改人数端点，见 api/game/rooms 底部） */
  resizeRoom: (size: number) => void;
  /** 踢掉某一格（房主；联机踢服务端成员，本机踢 AI。踢掉的位置空着，开局时再由 AI 补上） */
  kickSeat: (index: number) => void;
  /** 准备 / 取消准备（非房主） */
  toggleReady: () => void;
  /** 离开房间（房主离开 = 这间房散掉；联机房尽力通知服务端，失败要说出来） */
  leaveCurrentRoom: () => void;
  /** 开局前问一句"这一局怎么坐"：几个座位、几个人、几个 AI 补位（不许开就回失败原因） */
  startPlanOf: () => { ok: true; plan: RoomStartPlan } | LobbyFailure;
  /**
   * 房主点「开始对局」的那一发：联机房间调服务端 start；本机房间直接回 ok。
   * 成功后 `remoteRoom.status` 变 playing，由 useLobbyOnline 统一建本机局（两个入口同一条路）。
   */
  beginStart: () => Promise<{ ok: true; size: number; code: string | null } | { ok: false }>;

  /**
   * 等匹配的一拍。
   * ★ `refresh = true` 那一拍发 POST /queue（续队 + 撮合）；false 发 GET /queue（只读状态）。
   *   为什么不是"全 POST"：服务端 enqueue 会**先查"你在不在房里"**，匹配成功之后
   *   本人已经在房间里了，下一发 POST 会回 409 `ALREADY_IN_ROOM`（而不是 matched）——
   *   全 POST 的轮询会在拿到房号之前把自己判成失败。GET 没有这一层，拿到 matched + code 就进房。
   *   也不能"全 GET"：撮合与 90 秒排队心跳都只挂在 POST 上（只 GET 的话四个人齐了也没人建房）。
   *   所以两拍一换：POST 每 4 秒一次（在服务端 2~5 秒的节奏内），GET 补齐中间的状态读取。
   */
  pollQueue: (refresh: boolean) => Promise<"waiting" | "matched" | "stop">;
  /** 房间快照的一拍；room 变 playing 时回 "playing"（useLobbyOnline 收手去建局） */
  pollRoom: () => Promise<"waiting" | "playing" | "stop">;
  /** 60 秒没等到人：主动停轮询、取消排队、退回本机 AI 那一屏 */
  matchTimedOut: () => void;
  /** 停止等匹配并退回本机 AI（接口不可用 / 轮询意外失败都走这一处，界面留原因） */
  fallbackMatch: (note: LobbyNote) => void;
  /** 退回本机房间（AI 补位）并留下原因；联机房间能退就退掉，别把账号挂在服务端 */
  toLocalRoom: (note: LobbyNote, size?: number) => void;
  toggleInvite: (open?: boolean) => void;
  clearRejection: () => void;
}

/** 新房间码的种子（与本机对局同一个做法：时间 + 一点随机，够散即可） */
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
}

/** 当前账号在服务端的 id（联机快照里的 userId）；没登录 / 离线账号退回本机座位 id。 */
function myUserId(): string {
  return currentUser()?.id ?? LOCAL_SEAT_ID;
}

/**
 * 服务端房间快照 → 大厅界面认的那份形状（`LobbyRoom`）。
 *
 * ★ 两个 id 世界在这一处对齐：服务端用账号 id，大厅界面一直用 `LOCAL_SEAT_ID`（"me"）。
 *   把**我**换成本机 id、房主换成本机 id（如果是我），其余玩家保留服务端 id ——
 *   这样 `isHostOf(room, LOCAL_SEAT_ID)` / `roomStartPlan` / 本地那几个纯函数一行都不用改，
 *   而踢人 / 准备时还能拿 `remoteRoom.members` 里的真 userId 去调服务端。
 * ★ 没坐人的座位留 `kind:"empty"`（不是 ai）：服务端只放真人，人数是房主选的。
 *   界面在联机房间里把 empty 显示成「AI 补位」——因为开局那一刻它确实由 AI 补
 *   （本机建局只认座位数，人手不够的座位全给 AI，见 lobby.roomStartPlan）。
 * ★ `name` 只给真人：服务端昵称现拼，认不出（username 为空）时服务端已经退回 userId。
 */
function viewOfRemote(remote: RemoteRoom): LobbyRoom {
  const me = myUserId();
  const iAmHost = remote.hostId === me || remote.members.some((m) => m.userId === me && m.isHost);
  const seats: LobbySeat[] = Array.from({ length: remote.size }, (_, index) => ({
    index,
    playerId: null,
    kind: "empty" as const,
    ready: false,
  }));
  for (const member of remote.members) {
    if (member.seat < 0 || member.seat >= seats.length) continue;
    const mine = member.userId === me;
    seats[member.seat] = {
      index: member.seat,
      playerId: mine ? LOCAL_SEAT_ID : member.userId,
      kind: member.isHost || member.userId === remote.hostId ? "host" : "guest",
      ready: member.ready,
      // 我那一格不写名字（playerName("me") 给「我」），真人写服务端昵称
      name: mine ? undefined : member.displayName,
    };
  }
  return {
    code: remote.code,
    hostId: iAmHost ? LOCAL_SEAT_ID : (remote.hostId ?? ""),
    size: remote.size,
    seats,
    online: true,
  };
}

/** 失败结果 → 底栏的原因。★ 只认 code（GAME_ROOMS_OFF 也照实说），不认 message。 */
function noteOfFailure(res: RoomsFailure): LobbyNote {
  return res.reason === "code" ? { kind: "code", code: res.code } : { kind: "offline" };
}

/** 开一间本机房间（AI 补位；联机不可用 / 中途掉线时退回它）。 */
function localRoomOf(size: number, codeSeed = freshSeed()): LobbyRoom | null {
  const created = createRoom({ code: roomCodeOf(createRng(codeSeed)), hostId: LOCAL_SEAT_ID, size, online: false });
  return created.ok ? created.room : null;
}

export const useLobby = create<LobbyStore>((set, get) => {
  const fail = (failure: LobbyFailure) => set({ rejection: failure });
  const done = (patch: Partial<LobbyStore>) => set({ rejection: null, ...patch });

  /**
   * 把当前匹配 / 房间在服务端留下的东西收掉。
   * ★ 只在本机主动离开时调用（关大厅 / 回首屏 / 退房 / 开局），不挂在组件卸载上：
   *   React StrictMode 的假卸载会先跑一次 cleanup —— 在那里退房会让 dev 里刚建好的房当场散掉。
   *   真卸载由服务端的 30 分钟房寿命 / 90 秒排队心跳兜底（文档里写着）。
   */
  const release = () => {
    const { online, remoteRoom } = get();
    if (!online) return;
    if (remoteRoom) {
      void leaveRemoteRoom(remoteRoom.code).then((res) => {
        if (!res.ok) console.warn("[lobby] 关大厅时退房失败（服务端可能还挂着）", remoteRoom.code);
      });
    }
    // 队列行（含撮合成功的那一行）也收掉：它会在服务端留 10 分钟，清掉下一次排队才不会读到旧房号
    void cancelMatch();
  };

  /** 房间屏：把快照换上去（联机 / 非联机共用一处，别在各动作里各拼一遍）。 */
  const adoptRemote = (remote: RemoteRoom): boolean => {
    // ★ 请求回来时大厅可能已经被关掉 / 已经退出了：这时把 open 重新置回 true 就会"自己弹回来"。
    //   所有 await 之后的落地都要先问一句"还在不在这一屏"。
    if (!get().open) return false;
    set({
      open: true,
      screen: "room",
      mode: "room",
      matchSize: null,
      online: true,
      remoteRoom: remote,
      room: viewOfRemote(remote),
      queue: null,
      matchStartedAt: 0,
      note: null,
      rejection: null,
      busy: false,
      inviteOpen: false,
      joinCode: "",
    });
    return true;
  };

  /**
   * 匹配成功 → 进房间。
   * ★ 服务端的 matched 回包一般带快照；万一没带（老一点的版本只给 code），再读一次快照。
   *   两条都失败才退回本机 AI —— 别拿一个 null 房间进房间屏。
   */
  const enterMatched = async (ticket: MatchTicket) => {
    if (!get().open || get().screen !== "matching") return;
    let remote = ticket.room;
    if (!remote && ticket.code) {
      const res = await readRoom(ticket.code);
      if (!get().open || get().screen !== "matching") return;
      if (!res.ok) {
        get().fallbackMatch(noteOfFailure(res));
        return;
      }
      remote = res.value;
    }
    if (!remote) {
      get().fallbackMatch({ kind: "offline" });
      return;
    }
    adoptRemote(remote);
  };

  return {
    open: false,
    screen: "home",
    mode: null,
    matchSize: null,
    room: null,
    rejection: null,
    inviteOpen: false,
    serverOnline: null,
    online: false,
    remoteRoom: null,
    queue: null,
    matchStartedAt: 0,
    note: null,
    busy: false,
    joinCode: "",

    openLobby: () => {
      // 上一间联机房 / 队列还挂着的话先收掉（结束对局回来的那条路）；收不掉也照样开大厅
      release();
      set({
        open: true,
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        rejection: null,
        inviteOpen: false,
        online: false,
        remoteRoom: null,
        queue: null,
        matchStartedAt: 0,
        note: null,
        busy: false,
        joinCode: "",
      });
      // 底栏那句「联机通没通」要现问一次（能力位整场会话缓存，问的是同一个结论）
      void get().refreshOnline();
    },

    closeLobby: () => {
      release();
      set({
        open: false,
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        rejection: null,
        inviteOpen: false,
        online: false,
        remoteRoom: null,
        queue: null,
        matchStartedAt: 0,
        note: null,
        busy: false,
        joinCode: "",
      });
    },

    refreshOnline: async () => {
      // force：dev 配了 VITE_API_BASE 时也要照问（见 data/serverCaps.probeServerCaps 的 ★）
      const caps = await probeServerCaps(true);
      const online = !!caps && roomsAvailable();
      set({ serverOnline: online });
      return online;
    },

    chooseMatch: (size) => {
      if (get().busy) return;
      set({
        open: true,
        screen: "matching",
        mode: size === 8 ? "match8" : "match4",
        matchSize: size,
        room: null,
        online: false,
        remoteRoom: null,
        queue: null,
        matchStartedAt: 0,
        note: null,
        rejection: null,
        inviteOpen: false,
        busy: true,
      });
      void (async () => {
        const online = await get().refreshOnline();
        if (!get().open || get().screen !== "matching") {
          set({ busy: false });
          return;
        }
        if (!online) {
          // 没接通：留在"等匹配"这一屏，座位照旧摆 AI（与接联机之前逐字节一样）
          set({ busy: false, note: { kind: "offline" } });
          return;
        }
        const res = await findMatch(size);
        if (!get().open || get().screen !== "matching") {
          set({ busy: false });
          return;
        }
        if (!res.ok) {
          set({ busy: false, online: false, note: noteOfFailure(res) });
          return;
        }
        if (res.value.status === "matched") {
          await enterMatched(res.value);
          return;
        }
        set({ busy: false, online: true, queue: res.value, matchStartedAt: Date.now(), note: null });
      })();
    },

    chooseRoom: () => {
      if (get().busy) return;
      set({
        open: true,
        screen: "home",
        mode: "room",
        matchSize: null,
        room: null,
        online: false,
        remoteRoom: null,
        queue: null,
        matchStartedAt: 0,
        note: null,
        rejection: null,
        inviteOpen: false,
        busy: true,
      });
      void (async () => {
        const online = await get().refreshOnline();
        if (!get().open) {
          set({ busy: false });
          return;
        }
        if (!online) {
          get().toLocalRoom({ kind: "offline" });
          return;
        }
        const res = await createRemoteRoom({ mode: "custom", size: DEFAULT_ROOM_SIZE });
        if (!get().open) {
          set({ busy: false });
          return;
        }
        if (!res.ok) {
          get().toLocalRoom(noteOfFailure(res));
          return;
        }
        adoptRemote(res.value);
      })();
    },

    setJoinCode: (code) => set({ joinCode: code }),

    joinByCode: (code) => {
      if (get().busy) return;
      const normalized = normalizeServerCode(code ?? get().joinCode);
      if (!normalized) {
        set({ note: { kind: "bad-code" } });
        return;
      }
      set({ busy: true, note: null, rejection: null, joinCode: normalized });
      void (async () => {
        const online = await get().refreshOnline();
        if (!get().open) {
          set({ busy: false });
          return;
        }
        if (!online) {
          set({ busy: false, note: { kind: "offline" } });
          return;
        }
        const res = await joinRoom(normalized);
        if (!get().open) {
          set({ busy: false });
          return;
        }
        if (!res.ok) {
          set({ busy: false, note: noteOfFailure(res) });
          return;
        }
        adoptRemote(res.value);
      })();
    },

    backHome: () => {
      const { online, screen, remoteRoom } = get();
      set({
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        online: false,
        remoteRoom: null,
        queue: null,
        matchStartedAt: 0,
        rejection: null,
        inviteOpen: false,
        busy: false,
        note: null,
      });
      // 「取消」/「回大厅」= 主动收手：服务端那一步在状态清掉之后再发（失败时底栏补一句，
      // 而不是把人留在"正在离开"里；房间寿命 / 排队心跳是服务端那边的兜底）
      if (!online) return;
      if (remoteRoom) {
        const code = remoteRoom.code;
        void leaveRemoteRoom(code).then((res) => {
          if (!res.ok) set({ note: { kind: "leave-failed" } });
        });
      }
      if (screen === "matching" || screen === "room") void cancelMatch();
    },

    resizeRoom: (size) => {
      if (get().online) {
        // 服务端没有改人数端点：联机房间里这一组键不摆（RoomScreen 认 room.online），这里只留一道防线
        // —— 真被调到时说出来，别做成"点了没反应"（铁律八）
        set({ note: { kind: "code", code: "NO_CHANGE_SIZE_ENDPOINT" } });
        return;
      }
      const room = get().room;
      if (!room) {
        fail({ ok: false, reason: "no-room" });
        return;
      }
      const resized = setRoomSize(room, LOCAL_SEAT_ID, size);
      if (!resized.ok) {
        fail(resized);
        return;
      }
      done({ room: resized.room });
    },

    kickSeat: (index) => {
      const { room, online, remoteRoom } = get();
      if (!room) {
        fail({ ok: false, reason: "no-room" });
        return;
      }
      if (online && remoteRoom) {
        const member = remoteRoom.members.find((m) => m.seat === index);
        if (!member) {
          fail({ ok: false, reason: "seat-empty", index });
          return;
        }
        if (member.userId === myUserId()) {
          fail({ ok: false, reason: "seat-host", index });
          return;
        }
        void (async () => {
          const res = await kickMember(remoteRoom.code, member.userId);
          // 请求回来时可能已经离开了这间房：别把旧快照写回去
          if (get().remoteRoom?.code !== remoteRoom.code) return;
          if (!res.ok) {
            set({ note: noteOfFailure(res) });
            return;
          }
          set({ remoteRoom: res.value, room: viewOfRemote(res.value), rejection: null });
        })();
        return;
      }
      const kicked = kickSeat(room, LOCAL_SEAT_ID, index);
      if (!kicked.ok) {
        fail(kicked);
        return;
      }
      done({ room: kicked.room });
    },

    toggleReady: () => {
      const { room, online, remoteRoom } = get();
      if (!room) {
        fail({ ok: false, reason: "no-room" });
        return;
      }
      if (online && remoteRoom) {
        const me = remoteRoom.members.find((m) => m.userId === myUserId());
        if (!me) {
          fail({ ok: false, reason: "not-member" });
          return;
        }
        if (me.isHost) {
          fail({ ok: false, reason: "host-always-ready" });
          return;
        }
        void (async () => {
          const res = await setRemoteReady(remoteRoom.code, !me.ready);
          if (get().remoteRoom?.code !== remoteRoom.code) return;
          if (!res.ok) {
            set({ note: noteOfFailure(res) });
            return;
          }
          set({ remoteRoom: res.value, room: viewOfRemote(res.value), rejection: null });
        })();
        return;
      }
      const toggled = toggleReady(room, LOCAL_SEAT_ID);
      if (!toggled.ok) {
        fail(toggled);
        return;
      }
      done({ room: toggled.room });
    },

    leaveCurrentRoom: () => {
      const { room, online, remoteRoom } = get();
      if (online && remoteRoom) {
        const code = remoteRoom.code;
        // 先把界面收掉：离开是"我决定了"，不该卡在"正在离开"上；服务端那一发失败时在底栏说
        set({
          screen: "home",
          mode: null,
          matchSize: null,
          room: null,
          online: false,
          remoteRoom: null,
          queue: null,
          matchStartedAt: 0,
          rejection: null,
          inviteOpen: false,
          busy: false,
          note: null,
        });
        void leaveRemoteRoom(code).then((res) => {
          if (!res.ok) set({ note: { kind: "leave-failed" } });
          else void cancelMatch();
        });
        return;
      }
      if (!room) {
        // 没房间时"离开"就是回大厅首屏（这一步不是失败：界面上那颗键一直在）
        get().backHome();
        return;
      }
      const left = leaveRoom(room, LOCAL_SEAT_ID);
      if (!left.ok) {
        fail(left);
        return;
      }
      // left.room === null（房主离开 = 散房）与"客人离开"走同一条回程：房间没了就回首屏
      set({
        screen: left.room ? "room" : "home",
        mode: left.room ? "room" : null,
        room: left.room,
        rejection: null,
        inviteOpen: false,
        note: null,
      });
    },

    startPlanOf: () => {
      const { room, mode } = get();
      if (!room) {
        // 4 人 / 8 人匹配那一屏没有房间：人数由 mode 定（AI 把剩下的座位补满）
        const size = matchSizeOf(mode);
        if (size === null) return { ok: false, reason: "no-room" };
        return { ok: true, plan: { playerCount: size, humanIds: [LOCAL_SEAT_ID], aiCount: size - 1 } };
      }
      const can = canStartRoom(room, LOCAL_SEAT_ID);
      if (!can.ok) return can;
      return { ok: true, plan: can.plan };
    },

    beginStart: async () => {
      const { online, remoteRoom, room } = get();
      if (!online || !remoteRoom) {
        return { ok: true, size: room?.size ?? DEFAULT_ROOM_SIZE, code: null };
      }
      const res = await startRoom(remoteRoom.code);
      // 回来时可能已经离开这间房（或大厅被关了）：别把"已开局"写回一个过期的房间
      if (!get().open || get().remoteRoom?.code !== remoteRoom.code) return { ok: false };
      if (!res.ok) {
        if (res.reason === "code" && res.code === "NOT_ENOUGH_PLAYERS") {
          // 服务端只算真人（custom 至少 2 个）：把这间联机房换成本机 AI 房，
          // 再点一次「开始对局」就按 AI 补位开。房间码 / 队友那边就此散掉 —— 底栏那句话要说清。
          get().toLocalRoom({ kind: "not-enough-players" }, remoteRoom.size);
          return { ok: false };
        }
        set({ note: noteOfFailure(res) });
        return { ok: false };
      }
      set({ remoteRoom: res.value, room: viewOfRemote(res.value), note: null, rejection: null });
      return { ok: true, size: res.value.size, code: remoteRoom.code };
    },

    pollQueue: async (refresh) => {
      const { online, matchSize, screen } = get();
      if (!online || !matchSize || screen !== "matching") return "stop";
      const res = refresh ? await findMatch(matchSize) : await readQueue();
      if (!get().open || get().screen !== "matching") return "stop";
      if (!res.ok) {
        // ★ 匹配成功之后本人已经在房里了：服务端的 POST 会先回 409 ALREADY_IN_ROOM，而不是 matched。
        //   那不是失败 —— 用 GET 把房号读回来；读不到才是真的异常（在别的房里 / 队列已空）。
        if (refresh && res.reason === "code" && res.code === "ALREADY_IN_ROOM") {
          const q = await readQueue();
          if (!get().open || get().screen !== "matching") return "stop";
          if (q.ok && q.value.status === "matched") {
            await enterMatched(q.value);
            return "matched";
          }
          get().fallbackMatch(noteOfFailure(res));
          return "stop";
        }
        // 接口不可用 / 服务端拒了：停拍、退回本机 AI，并顺手把队列行收掉（收不掉也有 90 秒心跳兜底）
        console.warn("[lobby] 等匹配失败，退回本机 AI", res.reason === "code" ? res.code : "unavailable");
        void cancelMatch();
        get().fallbackMatch(noteOfFailure(res));
        return "stop";
      }
      if (res.value.status === "matched") {
        await enterMatched(res.value);
        return "matched";
      }
      // idle（GET）：排队行被心跳清掉了，下一拍 POST 会重新进队；这一屏先照实写 0 人
      set({ queue: res.value });
      return "waiting";
    },

    pollRoom: async () => {
      const { online, remoteRoom } = get();
      if (!online || !remoteRoom) return "stop";
      const code = remoteRoom.code;
      const res = await readRoom(code);
      // 回来时可能已经离开 / 换房 / 关掉大厅：这一拍作废，别把旧快照写回去
      if (!get().open || get().screen !== "room" || get().remoteRoom?.code !== code) return "stop";
      if (!res.ok) {
        // 不静默：界面退回本机，控制台留一行（真机上出问题时这是唯一能对上服务端日志的线索）
        console.warn("[lobby] 房间快照读取失败，退回本机房间", res.reason === "code" ? res.code : "unavailable");
        if (res.reason === "code" && (res.code === "ROOM_NOT_FOUND" || res.code === "NOT_IN_ROOM")) {
          get().toLocalRoom({ kind: "code", code: res.code });
        } else {
          get().toLocalRoom({ kind: "offline" });
        }
        return "stop";
      }
      const remote = res.value;
      // ★ 被房主踢掉时：房间还在、快照也能读（任何登录用户都能看），但成员表里已经没有我。
      //   不认这一条的话，被踢的人会停在一间"自己不在了"的房间里，点准备才吃一个 NOT_IN_ROOM。
      if (!remote.members.some((m) => m.userId === myUserId())) {
        get().toLocalRoom({ kind: "kicked" });
        return "stop";
      }
      set({ remoteRoom: remote, room: viewOfRemote(remote) });
      if (remote.status === "closed") {
        get().toLocalRoom({ kind: "code", code: "ROOM_NOT_FOUND" });
        return "stop";
      }
      if (remote.started) return "playing";
      return "waiting";
    },

    matchTimedOut: () => {
      if (get().screen !== "matching" || !get().online) return;
      // 60 秒到点：取消排队（服务端 90 秒心跳过期也会清，但别把自己的位置继续占着）
      void cancelMatch();
      set({ online: false, queue: null, matchStartedAt: 0, busy: false, note: { kind: "queue-timeout" } });
    },

    fallbackMatch: (note) => {
      // 停拍之后由本函数统一收拾"等匹配"那一屏：online=false 会让 useLobbyOnline 的 effect cleanup
      set({ online: false, queue: null, matchStartedAt: 0, busy: false, note });
    },

    toLocalRoom: (note, size) => {
      // 大厅已经被关掉时不要再把它"弹回来"（与 adoptRemote 同一条）
      if (!get().open) return;
      const { room, remoteRoom } = get();
      const seats = size ?? remoteRoom?.size ?? room?.size ?? DEFAULT_ROOM_SIZE;
      if (remoteRoom) {
        // 房间还在服务端时就顺手退掉（掉线那一支会失败 —— 失败就别再叠一句，底栏已经有原因了）
        void leaveRemoteRoom(remoteRoom.code);
      }
      set({
        open: true,
        screen: "room",
        mode: "room",
        matchSize: null,
        online: false,
        remoteRoom: null,
        room: localRoomOf(seats),
        queue: null,
        matchStartedAt: 0,
        note,
        rejection: null,
        busy: false,
        inviteOpen: false,
      });
    },

    toggleInvite: (open) => set((s) => ({ inviteOpen: open ?? !s.inviteOpen })),

    clearRejection: () => set({ rejection: null }),
  };
});

/** 匹配那一屏的人数（没在匹配时 null）。★ 与 playerCountOf 同一个真相，别在界面里再判一次 4/8。 */
function matchSizeOf(mode: LobbyMode | null): MatchSize | null {
  if (mode === "match4") return 4;
  if (mode === "match8") return 8;
  return null;
}

/** 大厅这一屏该开几个座位（界面与 startPlanOf 读同一份：4/8 人匹配看 mode，房间看 room）。 */
export function lobbyPlayerCountOf(store: Pick<LobbyStore, "mode" | "room">): number {
  return playerCountOf(store.mode, store.room);
}

// DEV 调试挂钩（与 __game / __studio / __flow 同款）：自动化脚本要直接驱动大厅，不必去点按钮。
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__lobby = useLobby;
}
