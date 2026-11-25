/**
 * 观战屏的状态（2026-11-24）：一间公开房的**只读**对局视图。
 *
 * ★★ 为什么单开一份 store、而不是复用 `roundsStore`：
 *   · `roundsStore` 是「我是这一局的玩家」那一套（会话 / 我的交片 / 我的票 / 推进 / 结算 / 事件，
 *     外加一堆写动作）。观众只有读的四样（房间快照 / 当前回合 / 历史 / 结束位），
 *     把观众塞进那一份里，第一次改"全员已交片"之类的闸就会出现"观众也被算进人数"的错。
 *   · 这一份**没有任何写动作**：`enter` / `poll` / `refreshHistory` / `exit`。
 *     观战屏一个写键都不摆（任务点名），服务端那十来个写端点对观众一律 403 `SPECTATOR_NOT_ALLOWED`
 *     （映射兜底在 `spectate.spectateNoteOf`）。
 * ★ 轮询挂在这一层外面（`ui/SpectateScreen` 的 effect）：与 `useOnlineRounds` / `useLobbyOnline`
 *   同一条理由 —— 组件卸载的那一刻定时器跟着停，写在 store 里就得自己记 timer id、自己判"现在还在不在看"。
 * ★ 失败要响且局部（铁律八）：
 *   · 一拍读失败（弱网）**不**清掉已经看到的画面，只留一句原因、下一拍继续（`note` 会被成功那拍收掉）；
 *   · 房间没了 / 我不在观众席了（404 / 403 NOT_IN_ROOM）才停拍（`lost`）—— 继续每 2 秒请求同一发
 *     只会把同一句错再要一遍。
 */
import { create } from "zustand";
import { leaveSpectate, readRoom, type RemoteRoom, type SpectateEntry } from "../../api/game/rooms";
import { readHistory, readRound, type RemoteGameHistory, type RemoteRound } from "../../api/game/rounds";
import { currentUser } from "../../data/account";
import { cacheHistoryLocally } from "./historyCache";
import type { LobbyNote } from "./lobbyStore";
import { spectateNoteOf } from "./spectate";

/**
 * 观战屏的轮询间隔（毫秒）。
 * ★ 2 秒 = 服务端契约里给界面的节奏（「每 2 秒或 SSE 跟服务端回合走」）。观战**不开 SSE**：
 *   观众要的是"跟得上"，不是"零延迟"；一条长连接比 2 秒一发贵得多，而这里没有"点赞要抢"这种
 *   必须实时的动作（观众一个写操作都没有）。服务端允许观众连 SSE，以后要上再换。
 */
export const SPECTATE_POLL_MS = 2_000;

export interface SpectateStore {
  /** 观战屏开着没有 */
  open: boolean;
  /** 正在看哪一间（null = 没在观战） */
  code: string | null;
  /** 房间快照（成员 / 血量 / 观战人数；轮询每 2 秒刷一次） */
  room: RemoteRoom | null;
  /** 当前回合（还没开打时是 null —— 服务端 404 ROUND_NOT_FOUND 不是错误） */
  round: RemoteRound | null;
  /** 这一局的历史回合 + 战绩（结算 / 历史回放读它；进屏拉一次、每次结算再拉一次） */
  history: RemoteGameHistory | null;
  /** 房主昵称（快照里现拼；认不出时 null，界面写「房主」） */
  hostName: string | null;
  /** 顶栏那一句原因（读不到 / 房间没了 / 服务端拒了）；成功那拍收掉 */
  note: LobbyNote | null;
  /** 历史回放那一层开着没有 */
  historyOpen: boolean;
  /** 历史回放里选中的回合（null = 最新那一回合） */
  historyRound: number | null;
  /** 已经为哪个回合拉过历史（避免 settled 之后每 2 秒重复拉同一份） */
  historyFetchedRound: number | null;
  /**
   * 这一场观战已经没法继续（房间过期 / 被移出观众席）：停拍，只留「退出观战」。
   * ★ 与"这一拍没读回来"分开：那个下一拍还会自己好，不该停。
   */
  lost: boolean;

  /** 进席成功之后把那份快照装上，并拉第一份回合 / 历史 */
  enter: (entry: SpectateEntry) => Promise<void>;
  /** 一拍：房间快照 + 当前回合（结算那一拍顺带拉历史） */
  poll: () => Promise<void>;
  /** 拉一次历史（结算 / 手动打开历史屏） */
  refreshHistory: () => Promise<void>;
  /** 出席（先停 UI 再通知服务端：点「退出观战」是玩家的决定，不该卡在"正在退出"上） */
  exit: () => Promise<void>;
  /** 历史回放那一层 */
  openHistory: (round?: number | null) => void;
  closeHistory: () => void;
  pickHistoryRound: (round: number) => void;
  clearNote: () => void;
  /** 只清本地状态（离开工坊 / 收屏时由页面那一层兜底调；不发请求） */
  reset: () => void;
}

/** 快照里的房主昵称（认不出时 null：界面写「房主」，别把一个 userId 印在标题上）。 */
function hostNameOf(room: RemoteRoom | null): string | null {
  if (!room) return null;
  const host = room.members.find((member) => member.isHost || member.userId === room.hostId);
  return host?.displayName ?? null;
}

/** 空状态（`reset` 与 create 的初值共用一份，别在十处各写一遍）。 */
const IDLE = {
  open: false,
  code: null,
  room: null,
  round: null,
  history: null,
  hostName: null,
  note: null,
  historyOpen: false,
  historyRound: null,
  historyFetchedRound: null,
  lost: false as boolean,
};

export const useSpectate = create<SpectateStore>((set, get) => {
  return {
    ...IDLE,

    enter: async (entry) => {
      set({
        ...IDLE,
        open: true,
        code: entry.room.code,
        room: entry.room,
        hostName: hostNameOf(entry.room),
      });
      // 进屏就拉两份：当前回合（还没开打时是 404 → 正常）与历史（结算 / 历史回放读它）。
      // ★ 不 await：进屏要立刻有画面；这两发回来各自写自己的那一格。
      void get().poll();
      void get().refreshHistory();
    },

    poll: async () => {
      const { open, code, lost } = get();
      if (!open || !code || lost) return;
      const [roomRes, roundRes] = await Promise.all([readRoom(code), readRound(code)]);
      // 回来时可能已经退出 / 换了一间（同一份异步回来不能写进别人的屏）
      if (!get().open || get().code !== code) return;

      if (roomRes.ok) {
        set({
          room: roomRes.value,
          hostName: hostNameOf(roomRes.value),
          // 读回来就把"这一拍没连上"收掉；业务拒绝（房间没了）不在这里收
          ...(get().note?.kind === "offline" ? { note: null } : {}),
        });
      } else if (roomRes.reason === "unavailable") {
        // 弱网：画面留着（上一份快照仍然能看），只留一句原因；下一拍自己会好
        set({ note: { kind: "offline" } });
      } else if (roomRes.code === "ROOM_NOT_FOUND") {
        // 房间过期 / 解散：停拍，别每 2 秒再问一次同一发
        set({ lost: true, note: spectateNoteOf(roomRes) });
        return;
      }

      if (roundRes.ok) {
        const round = roundRes.value;
        set({ round });
        // 结算了（或整局结束）：把历史拉一次 —— 结算榜只在 history 里（`rounds/current` 不带 settlement）
        if ((round.phase === "settled" || get().room?.state === "over") && get().historyFetchedRound !== round.round) {
          set({ historyFetchedRound: round.round });
          void get().refreshHistory();
        }
      } else if (roundRes.reason === "unavailable") {
        // 这一拍没读到：保留上一份回合（画面不闪），下一拍继续
        if (!get().note) set({ note: { kind: "offline" } });
      } else if (roundRes.code === "ROUND_NOT_FOUND") {
        // 还没开打（房主还没点 start）/ 这一回合被清掉：正常状态，不是错误
        if (get().round !== null) set({ round: null });
      } else if (roundRes.code === "NOT_IN_ROOM" || roundRes.code === "SPECTATOR_NOT_ALLOWED" || roundRes.code === "ROOM_NOT_FOUND") {
        // 读端点对观众是开放的：撞上这两个只说明"我已经不在观众席上了"（房间被清 / 名单被拉掉）
        set({ lost: true, note: spectateNoteOf(roundRes) });
      } else {
        set({ note: spectateNoteOf(roundRes) });
      }
    },

    refreshHistory: async () => {
      const code = get().code;
      if (!code) return;
      const res = await readHistory(code);
      if (!get().open || get().code !== code) return;
      if (!res.ok) {
        // 历史读不到不挡观战：当前回合照旧每 2 秒刷（历史屏打开时会显示这句话）
        set({ note: spectateNoteOf(res) });
        return;
      }
      set({ history: res.value, ...(get().note?.kind === "offline" ? { note: null } : {}) });
      // ★★ 2026-11-24 Bug B：观战屏拉到的这一份**顺手留一份到本机**。出观众席之后账号就不在
      //   （观众席）名单里了，服务端历史读接口回 403 —— 大厅「最近一局回放」那时只能看本机这份。
      //   `meId` = 看的人（观众不是玩家，summary 表里没有他这一行；回放条仍能列出每一回合与整榜）。
      cacheHistoryLocally(res.value, currentUser()?.id ?? null);
    },

    exit: async () => {
      const code = get().code;
      // 先把界面收掉：退出是"我决定了"，不该卡在"正在离开"上（与大厅离开房间同一条）
      get().reset();
      if (!code) return;
      const res = await leaveSpectate(code);
      if (!res.ok) console.warn("[spectate] 出观众席失败（服务端可能还挂着，房间过期会一并清掉）", code);
    },

    openHistory: (round) => set({ historyOpen: true, historyRound: round ?? null }),
    closeHistory: () => set({ historyOpen: false }),
    pickHistoryRound: (round) => set({ historyRound: round }),
    clearNote: () => set({ note: null }),
    reset: () => set({ ...IDLE }),
  };
});
