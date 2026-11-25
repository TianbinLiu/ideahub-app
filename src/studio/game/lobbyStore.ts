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
  hostStartPlanOf,
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
  listPublicRooms,
  publicRoomsAvailable,
  readRoom,
  readQueue,
  roomsAvailable,
  spectate as spectateRemoteRoom,
  spectateAvailable,
  setReady as setRemoteReady,
  startRoom,
  type MatchTicket,
  type PublicRoomRow,
  type RemoteRoom,
  type RemoteRoomState,
  type RoomsFailure,
  type SpectateEntry,
} from "../../api/game/rooms";
import { PUBLIC_ROOMS_PAGE_SIZE, spectateNoteOf } from "./spectate";
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
 * 房间快照连续失败几拍才认"真的断了"（5 拍 ≈ 8~10 秒）。
 * ★★ 为什么不是一拍就退回本机（2026-11-24 真机验收）：弱网 / 切后台回来第一拍超时是常事，
 *   一拍就 `toLocalRoom` 会把一间**还在服务端**的房换成本机 AI 房：成员表停在 1/4、
 *   房主键变回「用 AI 补位开局」，一点就开成单机（而那间房里真的坐着人）。
 * ★ 为什么是 5 而不是 3：房主开局前的"数据陈旧"窗口是 `HOST_START_STALE_MS`（5 秒）。
 *   容错窗口必须比它**长**，否则"数据已经陈旧、刷新又失败"这一格永远走不到 ——
 *   而那一格正是房主按键要拦的地方（宁可先别开，也不拿旧数据开成 AI 局）。
 */
export const ROOM_FAIL_TOLERANCE = 5;

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
  /** 冷启动恢复联机局时房间已经没了（§7.7 轻量重连）：如实说一句，人在大厅 */
  | { kind: "resume-gone" }
  /** 冷启动恢复联机局时连不上回合服务：记录留着，下次再试 */
  | { kind: "resume-offline" }
  /**
   * 服务端说"你已经在一间房里了"（`ALREADY_IN_ROOM`，2026-11-24 真机死锁的出口）。
   * ★ 与 `code` 分开：这一条要**带一颗键**（退出那间房），不能只念一句；`code` 是"哪间房"
   *   —— 服务端回包里带的 `roomCode`，拿不到时是 null（界面说"不知道是哪间"，按钮照样给）。
   */
  | { kind: "in-room"; code: string | null }
  /** 房主开局前强制刷新失败，而最近一次快照也不够/太旧：先别开（别把旧数据当事实开成 AI 局） */
  | { kind: "sync-failed" }
  /** 房间快照这一拍没读回来，正在重试（`pollRoom` 的临时原因，成功就收掉） */
  | { kind: "syncing" }
  /**
   * 观众**在写端点**上被拒（403 `SPECTATOR_NOT_ALLOWED`，2026-11-24）。
   * ★ 观战屏一个写操作都不摆，这一条是兜底：真撞上时要说「观战不能操作这个」，
   *   而不是让那颗按键看起来"点了没反应"。
   */
  | { kind: "spectator-not-allowed" }
  /** 观众席满了（429 `TOO_MANY_SPECTATORS`，上限 20）：等有人离席再来 */
  | { kind: "spectators-full" }
  /**
   * 服务端说"你已经是这间房的玩家"（409 `ALREADY_IN_ROOM`，观战那一发）。
   * ★ 与 `in-room`（建房 / 进房 / 排队撞上）分开：这一条的动作是**直接进房**看自己那一局，
   *   不是"退出那间房再重试"。`code` = 那间房的房号（拿不到时 null）。
   */
  | { kind: "already-player"; code: string | null }
  /** 房间已经不在了（404 `ROOM_NOT_FOUND`）/ 还没有回合（404 `ROUND_NOT_FOUND`）：这间房现在没得看 */
  | { kind: "gone" }
  /** 这台服务器把观战关了（503 `GAME_SPECTATORS_OFF`） */
  | { kind: "spectate-off" }
  /** 这台服务器把公开房列表关了（503 `GAME_PUBLIC_ROOMS_OFF`） */
  | { kind: "public-rooms-off" }
  | { kind: "code"; code: string };

/** 被 ALREADY_IN_ROOM 挡住的那一下本来想干什么（退出那间房之后按原意重试一次） */
type LobbyIntent = { kind: "create" } | { kind: "join"; code: string } | { kind: "match"; size: MatchSize };

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
  /**
   * 建房时勾没勾「公开这间房」（2026-11-24，缺省关）。
   * ★ 只在**建房那一刻**有用：服务端的 `visibility` 建完不能改（没有改这个的端点），
   *   所以它是一个开关、不是房间上的一格状态；建完房就随大厅一起清掉。
   */
  publicRoomOn: boolean;
  /**
   * 公开房列表这一屏（2026-11-24，`screen === "public"`）。
   * ★ 数据放 store 而不是 Lobby 组件的 useState：换屏 / 下拉刷新 / 滚到底加载更多是同一个列表的
   *   三拍，放在组件里会多出一份"离开再回来要重置"的逻辑；store 里由 `openPublicRooms` 一处清。
   */
  publicRooms: PublicRoomRow[];
  publicTotal: number;
  publicHasMore: boolean;
  publicPage: number;
  /** 正在看哪一种状态的房（三个页签：等真人 / 进行中 / 已结束） */
  publicState: RemoteRoomState;
  /** 列表正在干什么（null 那几颗键据此灰掉，别让人连点） */
  publicLoading: "idle" | "refresh" | "more" | "spectate";
  /** 列表自己的那句原因（与底栏共用一份 LobbyNote；成功那拍清掉） */
  publicNote: LobbyNote | null;
  /**
   * 最近一次**成功**读到服务端房间快照的时刻（0 = 这一屏从没读到过）。
   * ★ 房主开局要用它判"这一份人数还新不新鲜"（`hostStartPlanOf`）：陈旧数据不许决定开局模式。
   */
  roomSyncedAt: number;
  /**
   * 服务端说"你已经在一间房里"时**那间房的房号**（`ALREADY_IN_ROOM` 回包顶层的 `roomCode`）。
   * null = 不知道是哪间（老服务端不报 / 从没撞到过）—— 界面照样给"退出那间房"的键。
   */
  stuckRoomCode: string | null;
  /** 房间轮询连续失败了几拍（成功就清零）：一两拍不判死，别把还在服务端的房当成"没连上" */
  roomFailStreak: number;
  /** 被 `ALREADY_IN_ROOM` 挡住的那一下本来想干什么（退出那间房之后按原意重试一次） */
  intent: LobbyIntent | null;

  openLobby: () => void;
  /** 恢复联机局时房间已经没了：大厅底栏说「这一局的房间已经结束」（openLobby 会清 note，所以放在它之后调） */
  noteResumeGone: () => void;
  /** 恢复联机局时连不上回合服务：同样在大厅说一句，但记录留着（下次冷启动再试） */
  noteResumeOffline: () => void;
  /**
   * 关大厅。
   * ★ `keepRoom` = 这一下是**开局交接**，不是离开：服务端房间要留给回合引擎用（下一拍 rounds/start /
   *   rounds/current 都认房间码），这里只清界面、顺手把队列行收掉，**不退房**。
   *   退房由对局结束时的 roundsStore.leaveNow 负责（联机局打完 / 玩家点结束对局）。
   *   不加这一位的话，`release()` 会在开局那一刻把房间退掉 —— 症状是"服务端回合刚开，成员已经不在房里"。
   */
  closeLobby: (opts?: { keepRoom?: boolean }) => void;
  /** 问一次服务端有没有房间服务（能力位）；返回能不能发房间请求 */
  refreshOnline: () => Promise<boolean>;
  /** 4 人 / 8 人匹配：先进"等匹配"那一屏，联机可用就进队轮询；不可用就本机 AI 补位 */
  chooseMatch: (size: MatchSize) => void;
  /** 自定义房间：联机可用就开服务端房间；不可用就开本机房间（AI 补位） */
  chooseRoom: () => void;
  /** 凭房间码加入别人的房间（联机不可用 / 码不对都在底栏说一句，不离屏） */
  joinByCode: (code?: string) => void;
  setJoinCode: (code: string) => void;
  /** 「公开这间房（别人能搜到）」开关（建房时用；缺省关） */
  togglePublicRoom: () => void;
  /** 打开公开房列表那一屏（清列表 → 读第一页） */
  openPublicRooms: () => void;
  /** 换一个状态页签（等真人 / 进行中 / 已结束）：清列表 → 读第一页 */
  pickPublicState: (state: RemoteRoomState) => void;
  /** 读第一页（进屏 / 下拉刷新 / 那颗「刷新」键） */
  refreshPublicRooms: () => Promise<void>;
  /** 滚到底加载下一页；没有更多 / 正在读 / 不在这一屏都直接回 */
  loadMorePublicRooms: () => Promise<void>;
  /** 列表里点「加入」：与凭码加入同一条路（服务端回包就是房间快照） */
  joinPublicRoom: (code: string) => void;
  /**
   * 列表里点「观战」：`POST /rooms/:code/spectate`。
   * ★ 失败原因写进 `publicNote`（三种拒绝各有各的话，见 spectate.spectateNoteOf）；
   *   成功把整份回包交给调用方 —— 观战屏自己那一份状态在 studio/game/spectateStore
   *   （不在这里：大厅 store 不该认识"观战屏开着没有"）。
   * ★ 已经是这间房的玩家（409）额外摆一颗「直接进房」的键（判据是 note.kind）。
   */
  enterSpectate: (code: string) => Promise<SpectateEntry | null>;
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
   * 房主点「开始对局」的**唯一入口**（2026-11-24）：先强制拉一次最新房间快照，再按服务端事实
   * 决定走服务端开局还是 AI 补位（判据 `lobby.hostStartPlanOf`，纯函数、构建里跑正反例）。
   * ★★ 为什么不能直接看界面上那份 remote：那份可能停在"1/4"（轮询慢 / 断过），而服务端已经
   *   坐上 2 个真人 —— 拿它决定就会开成一局本机 AI 单机（真机验收的事故）。
   * 返回：
   *   · `server` = 已调服务端开局（后续由 useLobbyOnline 看到 playing 后建本机局）；
   *   · `ai` = 新鲜数据说真人不够，调用方去开本机 AI 补位局（size = 房间座位数）；
   *   · `blocked` = 刷新失败且最近一次数据也不够 / 太旧：**不开**，界面提示"先别开"；
   *   · `failed` = 服务端拒了（原因已在 note 里）。
   */
  prepareStart: () => Promise<{ kind: "server" } | { kind: "ai"; size: number } | { kind: "blocked" } | { kind: "failed" }>;
  /**
   * 立刻读一次房间快照（房主开局前 / 房间屏一进来就调）。
   * 返回最新快照；失败返回 null（**不**改界面状态，不叠一句话：调用方自己决定怎么说）。
   */
  refreshRoomNow: () => Promise<RemoteRoom | null>;
  /**
   * 大厅房间屏的推送帧（`ui/useLobbyOnline` 收到 SSE 时调；与 2 秒轮询写同一份状态）。
   * ★ 只认同一间房的那一帧：换房 / 回大厅之后晚到的帧直接丢掉。
   */
  applyPushedRoom: (remote: RemoteRoom) => void;
  /**
   * 服务端说"你已经在一间房里"之后的那颗键：`POST /rooms/:code/leave` 退出那间房。
   * ★ 房号从回包顶层拿（`stuckRoomCode`）；拿不到时先 `GET /api/game/queue` / 最近一次建房记录
   *   尽力找回（**契约缺口**见 docs/game-lobby.md：老服务端可以不报 `roomCode`）。
   * 退出成功之后按原意（建房 / 进房 / 排队）**自动重试一次**，并把底栏那句话收掉。
   * 返回 false = 没退掉（原因已经在 note 里），界面别假装解开了。
   */
  leaveStuckRoom: () => Promise<boolean>;

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

/**
 * 失败结果 → 底栏的原因。★ 只认 code（GAME_ROOMS_OFF 也照实说），不认 message。
 * ★ `ALREADY_IN_ROOM` 单独成一格（`in-room`）：它要带一颗「退出那间房」的键，不能只是一句话
 *   —— 只念一句的话，玩家要么等 30 分钟房寿命，要么去另一台设备退（2026-11-24 真机死锁）。
 */
function noteOfFailure(res: RoomsFailure): LobbyNote {
  if (res.reason === "code") {
    if (res.code === "ALREADY_IN_ROOM") return { kind: "in-room", code: res.roomCode ?? null };
    return { kind: "code", code: res.code };
  }
  return { kind: "offline" };
}

/** 同一间房还在不在（异步回来时先问一句，别把旧房 / 旧屏的快照写回去）。 */
function sameRoomCode(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}

/**
 * 离开公开房列表时把那一份状态清成的样子。
 * ★ 定义在一处、三处 set（openLobby / closeLobby / backHome）共用：漏清一格就会
 *   "关掉大厅再打开，列表还是上一轮那几间房 + 上一轮的错误"。
 * ★ `publicState` 不在这里：刷新 / 加载更多要保住当前页签，换屏才归位（见 PUBLIC_STATE_RESET）。
 */
const PUBLIC_LIST_IDLE = {
  publicRooms: [] as PublicRoomRow[],
  publicTotal: 0,
  publicHasMore: false,
  publicPage: 1,
  publicLoading: "idle" as const,
  publicNote: null,
};
const PUBLIC_STATE_RESET = { ...PUBLIC_LIST_IDLE, publicState: "waiting" as RemoteRoomState };

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
      // ★ 这一份是刚读回来的服务端事实：房主开局的"新鲜度"从这一刻算（见 hostStartPlanOf）
      roomSyncedAt: Date.now(),
      roomFailStreak: 0,
      stuckRoomCode: null,
      intent: null,
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
    publicRoomOn: false,
    ...PUBLIC_STATE_RESET,
    roomSyncedAt: 0,
    stuckRoomCode: null,
    roomFailStreak: 0,
    intent: null,

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
        publicRoomOn: false,
        ...PUBLIC_STATE_RESET,
        roomSyncedAt: 0,
        roomFailStreak: 0,
      });
      // 底栏那句「联机通没通」要现问一次（能力位整场会话缓存，问的是同一个结论）
      void get().refreshOnline();
    },

    noteResumeGone: () => set({ note: { kind: "resume-gone" } }),

    noteResumeOffline: () => set({ note: { kind: "resume-offline" } }),

    closeLobby: (opts) => {
      if (opts?.keepRoom) {
        // 开局交接：房间留给对局（回合引擎认这个码）。队列行照旧收掉 —— 匹配成功那一行会在服务端
        // 留 10 分钟，不清下一次排队会读到旧房号。
        void cancelMatch();
      } else {
        release();
      }
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
        publicRoomOn: false,
        ...PUBLIC_STATE_RESET,
        roomSyncedAt: 0,
        roomFailStreak: 0,
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
          // ★ ALREADY_IN_ROOM（账号还挂在某间房里）：不是"没连上"，也不能退回本机 AI 就算完 ——
          //   底栏要带一颗「退出那间房」的键（note 的 in-room 那一格），退出后按原意重试。
          const stuck = res.reason === "code" && res.code === "ALREADY_IN_ROOM";
          set({
            busy: false,
            online: false,
            note: noteOfFailure(res),
            ...(stuck ? { stuckRoomCode: res.roomCode ?? null, intent: { kind: "match" as const, size } } : {}),
          });
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
        // ★ 「公开这间房」只在**能力位为真**时发出去（老服务端不认这一位）：缺省 private，
        //   这一格为假 / 没勾都一个字段都不多带 —— 反过来的话每个老版本用户的自定义房都会
        //   静默摆到大厅上（服务端契约「建房带 visibility」）。
        const visibility = get().publicRoomOn && publicRoomsAvailable() ? ("public" as const) : undefined;
        const res = await createRemoteRoom({ mode: "custom", size: DEFAULT_ROOM_SIZE, visibility });
        if (!get().open) {
          set({ busy: false });
          return;
        }
        if (!res.ok) {
          // ★★ 超时之后**核对一次**（2026-11-24 真机死锁的另一半）：建房这一发在服务端已经落库、
          //   回包却因为弱网没回来 —— 客户端以为失败退回本机，账号却还挂在服务端那间房里。
          //   建房对同一账号是幂等的（一人只能在一间房）：重发一次，要么真建成，要么服务端
          //   回 ALREADY_IN_ROOM + 那间房的房号 —— 后者说明第一次其实成了，正好拿它当"你还在房间 X"。
          if (res.reason === "unavailable" && res.timeout) {
            const retry = await createRemoteRoom({ mode: "custom", size: DEFAULT_ROOM_SIZE, visibility });
            if (!get().open) {
              set({ busy: false });
              return;
            }
            if (retry.ok) {
              adoptRemote(retry.value);
              return;
            }
            if (retry.reason === "code" && retry.code === "ALREADY_IN_ROOM") {
              // 第一次其实建成了：**不退回本机**，把"你还在房间 X"和那颗退出键摆出来
              set({
                open: true,
                screen: "home",
                mode: "room",
                room: null,
                online: false,
                remoteRoom: null,
                busy: false,
                note: { kind: "in-room", code: retry.roomCode ?? null },
                stuckRoomCode: retry.roomCode ?? null,
                intent: { kind: "create" },
              });
              return;
            }
          }
          if (res.reason === "code" && res.code === "ALREADY_IN_ROOM") {
            // 服务端说我还在另一间房里（上一次退房没成功 / 另台设备开的房）：留在大厅首屏 + 退出键，
            // **不能**退回本机 AI —— 那间房可能正等着我，退成本机就看不出"我还挂在里面"了。
            set({
              open: true,
              screen: "home",
              mode: "room",
              room: null,
              online: false,
              remoteRoom: null,
              busy: false,
              note: { kind: "in-room", code: res.roomCode ?? null },
              stuckRoomCode: res.roomCode ?? null,
              intent: { kind: "create" },
            });
            return;
          }
          get().toLocalRoom(noteOfFailure(res));
          return;
        }
        adoptRemote(res.value);
      })();
    },

    setJoinCode: (code) => set({ joinCode: code }),

    togglePublicRoom: () => set((s) => ({ publicRoomOn: !s.publicRoomOn })),

    openPublicRooms: () => {
      if (!get().open) return;
      set({
        screen: "public",
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
        ...PUBLIC_STATE_RESET,
      });
      void get().refreshPublicRooms();
    },

    pickPublicState: (state) => {
      if (get().publicState === state) return;
      // 换页签 = 换一份列表：旧的几百行不能留着（看着像"这一页签也有这些房"）
      set({ publicState: state, ...PUBLIC_LIST_IDLE });
      void get().refreshPublicRooms();
    },

    refreshPublicRooms: async () => {
      if (!get().open || get().screen !== "public") return;
      if (get().publicLoading !== "idle") return;
      set({ publicLoading: "refresh" });
      const state = get().publicState;
      const res = await listPublicRooms({ state, page: 1, limit: PUBLIC_ROOMS_PAGE_SIZE });
      // 拉回来时可能已经换了屏签 / 离开了这一屏：这一份作废（不把旧页签的房写进新页签）
      if (!get().open || get().screen !== "public" || get().publicState !== state) {
        set({ publicLoading: "idle" });
        return;
      }
      if (!res.ok) {
        // 失败时**不清**已经读出来的那几行：下拉刷新撞上一次网络抖动，把看了一半的列表清空
        // 是最坏的一种"没连上"——留着旧行 + 一句原因，人还能照着房号去试。
        set({ publicLoading: "idle", publicNote: spectateNoteOf(res) });
        return;
      }
      set({
        publicLoading: "idle",
        publicRooms: res.value.rooms,
        publicTotal: res.value.total,
        publicHasMore: res.value.hasMore,
        publicPage: res.value.page,
        publicNote: null,
      });
    },

    loadMorePublicRooms: async () => {
      const { open, screen, publicLoading, publicHasMore } = get();
      if (!open || screen !== "public" || publicLoading !== "idle" || !publicHasMore) return;
      set({ publicLoading: "more" });
      const state = get().publicState;
      const page = get().publicPage + 1;
      const res = await listPublicRooms({ state, page, limit: PUBLIC_ROOMS_PAGE_SIZE });
      if (!get().open || get().screen !== "public" || get().publicState !== state) {
        set({ publicLoading: "idle" });
        return;
      }
      if (!res.ok) {
        set({ publicLoading: "idle", publicNote: spectateNoteOf(res) });
        return;
      }
      // ★ 按房号去重：列表是实时现查的，翻页期间有人新建房会把整页往后挤一格 ——
      //   服务端保证的是"同一秒按 _id 兜底"，跨请求的位移它管不了；重复行会让同一间房出现两次。
      const seen = new Set(get().publicRooms.map((room) => room.code));
      const more = res.value.rooms.filter((room) => !seen.has(room.code));
      set({
        publicLoading: "idle",
        publicRooms: [...get().publicRooms, ...more],
        publicTotal: res.value.total,
        publicHasMore: res.value.hasMore,
        publicPage: page,
        publicNote: null,
      });
    },

    joinPublicRoom: (code) => get().joinByCode(code),

    enterSpectate: async (code) => {
      if (!get().open) return null;
      // 能力位是会话级缓存、问一次就有结论；为假时**一巴掌都不发**（老服务端点下去只有 404）
      if (!spectateAvailable()) {
        set({ publicNote: { kind: "spectate-off" } });
        return null;
      }
      if (get().publicLoading !== "idle") return null;
      set({ publicLoading: "spectate", publicNote: null });
      const res = await spectateRemoteRoom(code);
      if (!get().open) {
        set({ publicLoading: "idle" });
        return null;
      }
      if (!res.ok) {
        // 三种拒绝在这里分开：403 观战不能操作这个 / 429 观战席位满了 /
        // 409 你已经是这间房的玩家（界面据此给「直接进房」）—— 映射表在 spectate.spectateNoteOf
        set({ publicLoading: "idle", publicNote: spectateNoteOf(res) });
        return null;
      }
      set({ publicLoading: "idle", publicNote: null });
      // 进席的那一份快照已经够画观战屏了；观战屏自己的轮询 / 历史在 ui/SpectateScreen 那一层
      return res.value;
    },

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
          // ★ 我本来就在这间房里（重复点「加入」/ 换设备回来）：服务端这一支回 ALREADY_IN_ROOM
          //   **并带整份房间快照** —— 那不是失败，直接当进房成功（不然用户被一句"你已经在房间里"
          //   挡在自己房间外面，只能去杀进程）。
          if (res.reason === "code" && res.code === "ALREADY_IN_ROOM") {
            if (res.room && sameRoomCode(res.room.code, normalized)) {
              adoptRemote(res.room);
              return;
            }
            // 在**别的**房里：给出那间房的码 + 退出键，按原意（进这间房）重试
            set({
              busy: false,
              online: false,
              note: { kind: "in-room", code: res.roomCode ?? null },
              stuckRoomCode: res.roomCode ?? null,
              intent: { kind: "join", code: normalized },
            });
            return;
          }
          // ★ 进房超时之后核对一次：第一次其实进了的时候，重发会回 ALREADY_IN_ROOM + 快照，
          //   把它当成功；不是这间房就把"你还在房间 X"摆出来（超时那次可能进了另一间 —— 不会，
          //   一人一间，但服务端的回包里那间才是事实）。
          if (res.reason === "unavailable" && res.timeout) {
            const retry = await joinRoom(normalized);
            if (!get().open) {
              set({ busy: false });
              return;
            }
            if (retry.ok) {
              adoptRemote(retry.value);
              return;
            }
            if (retry.reason === "code" && retry.code === "ALREADY_IN_ROOM") {
              if (retry.room && sameRoomCode(retry.room.code, normalized)) {
                adoptRemote(retry.room);
                return;
              }
              set({
                busy: false,
                online: false,
                note: { kind: "in-room", code: retry.roomCode ?? null },
                stuckRoomCode: retry.roomCode ?? null,
                intent: { kind: "join", code: normalized },
              });
              return;
            }
            set({ busy: false, note: noteOfFailure(retry) });
            return;
          }
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
        publicRoomOn: false,
        ...PUBLIC_STATE_RESET,
        roomSyncedAt: 0,
        roomFailStreak: 0,
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
          roomSyncedAt: 0,
          roomFailStreak: 0,
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

    refreshRoomNow: async () => {
      const { online, remoteRoom } = get();
      if (!online || !remoteRoom) return null;
      const code = remoteRoom.code;
      const res = await readRoom(code);
      // 回来时可能已经离开 / 换房 / 关掉大厅：这一份作废
      if (!get().open || get().screen !== "room" || !sameRoomCode(get().remoteRoom?.code, code)) return null;
      if (!res.ok) {
        set({ roomFailStreak: get().roomFailStreak + 1 });
        return null;
      }
      set({
        remoteRoom: res.value,
        room: viewOfRemote(res.value),
        roomSyncedAt: Date.now(),
        roomFailStreak: 0,
        rejection: null,
        // 「没读到最新的房间状态／正在同步」都是**这一刻**的临时原因：读回来就收掉（服务端的业务拒绝留着）
        ...(get().note?.kind === "sync-failed" || get().note?.kind === "syncing" ? { note: null } : {}),
      });
      return res.value;
    },

    prepareStart: async () => {
      const before = get();
      const { online, remoteRoom } = before;
      if (!online || !remoteRoom) {
        // 本机房：数据本来就是本机的，没有"陈旧"这回事（AI 补位的口径由界面照旧走）
        return { kind: "ai", size: before.room?.size ?? DEFAULT_ROOM_SIZE };
      }
      // ★★ **点之前强制拉一次最新快照**（2026-11-24 真机验收的任务点名）：界面那份可能停在 1/4。
      const latest = await get().refreshRoomNow();
      const remote = latest ?? get().remoteRoom;
      if (!remote) return { kind: "failed" };
      const plan = hostStartPlanOf({
        memberCount: remote.memberCount,
        requiredPlayers: remote.requiredPlayers,
        syncedAt: get().roomSyncedAt,
        refreshed: latest !== null,
        now: Date.now(),
      });
      if (plan.kind === "blocked") {
        // 没读到最新状态、最近一次也说不过去：**不开**。旧数据不能当成"还是我一个人"。
        set({ note: { kind: "sync-failed" }, busy: false });
        return { kind: "blocked" };
      }
      if (plan.kind === "ai") {
        // 新鲜数据说真人不够（服务端要至少 2 个真人）：换成本机房、按座位数 AI 补位，
        // 由调用方去建本机局（人数 = 房间座位数）。话在底栏说清（not-enough-players）。
        get().toLocalRoom({ kind: "not-enough-players" }, remote.size);
        return { kind: "ai", size: remote.size };
      }
      // 走服务端开局（服务端那一拍自己会判人数 / 准备 / 房主）
      const started = await get().beginStart();
      return started.ok ? { kind: "server" } : { kind: "failed" };
    },

    applyPushedRoom: (remote) => {
      const { online, remoteRoom } = get();
      // 只认同一间房、且人还在房间屏：换房 / 回大厅之后晚到的帧直接丢掉
      if (!get().open || get().screen !== "room" || !online || !remoteRoom) return;
      if (!sameRoomCode(remote.code, remoteRoom.code)) return;
      set({
        remoteRoom: remote,
        room: viewOfRemote(remote),
        roomSyncedAt: Date.now(),
        roomFailStreak: 0,
        // 推送帧就是最新事实：把"正在同步 / 没读到最新"这两句临时原因一起收掉
        ...(get().note?.kind === "syncing" || get().note?.kind === "sync-failed" ? { note: null } : {}),
      });
    },

    leaveStuckRoom: async () => {
      const { stuckRoomCode, intent } = get();
      set({ busy: true });
      // 房号优先用服务端回包给的那个；没有就尽力找回（契约缺口见 docs/game-lobby.md）：
      //   ① `GET /api/game/queue` 里 matched 的那一行带房号；② 退而求其次**重放一次原意** ——
      //   服务端这次会回 ALREADY_IN_ROOM + `roomCode`（本版契约），第二次点就退得掉。
      let code = stuckRoomCode;
      if (!code) {
        const q = await readQueue();
        if (q.ok && q.value.status === "matched" && q.value.code) code = q.value.code;
      }
      if (!code) {
        set({ busy: false });
        if (intent?.kind === "create") get().chooseRoom();
        else if (intent?.kind === "join") get().joinByCode(intent.code);
        else if (intent?.kind === "match") get().chooseMatch(intent.size);
        else set({ note: { kind: "in-room", code: null } });
        return false;
      }
      const res = await leaveRemoteRoom(code);
      if (!res.ok) {
        const gone = res.reason === "code" && (res.code === "NOT_IN_ROOM" || res.code === "ROOM_NOT_FOUND");
        // 已经不在那间房（退过了 / 房里就我一个人被清掉）、或者房间已经过期：也算解开了
        if (!gone) {
          set({ busy: false, note: noteOfFailure(res) });
          return false;
        }
      }
      set({ busy: false, stuckRoomCode: null, note: null, rejection: null, intent: null });
      // ★ 退出之后按**原意**重试一次（建房 / 进房 / 排队）：玩家点那颗键不是想停在这一屏。
      if (intent?.kind === "create") get().chooseRoom();
      else if (intent?.kind === "join") get().joinByCode(intent.code);
      else if (intent?.kind === "match") get().chooseMatch(intent.size);
      return true;
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
          // ★ 队列里没有"我匹配上了" → 我确实还在某间房里（上一次退房没成功 / 另台设备）。
          //   给底栏那颗「退出那间房」的键留下房号与"本来想排队"的原意（见 leaveStuckRoom）。
          get().fallbackMatch(noteOfFailure(res));
          set({ stuckRoomCode: res.roomCode ?? null, intent: { kind: "match", size: matchSize } });
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
        // ★ 房间没了 / 我不在成员表里 = 服务端的事实，当场收场（下一拍也读不出来）。
        const dead = res.reason === "code" && (res.code === "ROOM_NOT_FOUND" || res.code === "NOT_IN_ROOM");
        // ★★ 一次失败**不**退回本机（2026-11-24 真机验收的教训）：弱网抖一下就把一间还在服务端
        //   的房换成本机 AI 房，界面看着还是"1/4"，房主键也变成「用 AI 补位开局」——一点就开成
        //   单机。连着失败 3 拍（≈6 秒）才认，期间只摆一句「正在同步」。
        const streak = get().roomFailStreak + 1;
        if (!dead && res.reason === "unavailable" && streak < ROOM_FAIL_TOLERANCE) {
          set({ roomFailStreak: streak, note: { kind: "syncing" } });
          return "waiting";
        }
        // 不静默：界面退回本机，控制台留一行（真机上出问题时这是唯一能对上服务端日志的线索）
        console.warn("[lobby] 房间快照读取失败，退回本机房间", res.reason === "code" ? res.code : "unavailable");
        if (res.reason === "code" && (res.code === "ROOM_NOT_FOUND" || res.code === "NOT_IN_ROOM")) {
          get().toLocalRoom({ kind: "code", code: res.code });
        } else {
          // 掉线退回本机时把那间房的码留着：下一次建房吃 ALREADY_IN_ROOM 时，「退出那间房」的键
          // 至少要退对房间（服务端还挂着的那间就是它）。
          set({ stuckRoomCode: code });
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
      set({
        remoteRoom: remote,
        room: viewOfRemote(remote),
        // 这是刚读回来的服务端事实：房主开局用它判"新不新鲜"（hostStartPlanOf）
        roomSyncedAt: Date.now(),
        roomFailStreak: 0,
        // 「正在同步 / 没读到最新」是临时原因：同步回来了就收掉；服务端的业务拒绝（NOT_HOST …）留着
        ...(get().note?.kind === "syncing" || get().note?.kind === "sync-failed" ? { note: null } : {}),
      });
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
        // ★ 本机房的"人数"不是服务端事实：新鲜度归零（`hostStartPlanOf` 只看 refreshed / 本机房，
        //   不会拿它决定联机开局）。intent 留着也没用了 —— 不要在退出本机房间之后还替玩家重试。
        roomSyncedAt: 0,
        roomFailStreak: 0,
        intent: null,
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
