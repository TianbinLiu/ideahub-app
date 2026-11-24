/**
 * 大厅 store（2026-11-23）：三种开局方式（4 人匹配 / 8 人匹配 / 自定义房间）的界面状态。
 *
 * ★★ 这一层是**纯状态**：房间的规矩一条都不在这里（谁能改人数 / 谁能踢人 / 谁能开始 /
 *   空位怎么补 AI 全在 lobby.ts 的纯函数里，node scripts/check-game-lobby.mjs 直接跑正反例）；
 *   开局那一步也不在这里 —— 大厅只交出"这一局几个座位"，由界面调 `useGame.startGame` 建局。
 *   ★ 为什么不在这里直接调 game store：对局 store 已经够大一摊（G2~G4 的回合循环都挂在它身上），
 *     再让两个 store 互相 import 就回到 CLAUDE.md 点名的那种"Vite 下拿到半初始化模块"的形状。
 *     界面是**唯一**同时认识两边的地方（ui/Lobby 的 startMatch）。
 * ★ 与对局 store 同一条纪律：每个动作只做"递给人纯函数 → 写回成功结果 → 把失败原因原样留着"，
 *   失败原因由界面说人话（铁律八：不静默失败）。
 * ★ 联机（服务端房间 / 匹配 / 同步）由另一个人做：`api/game/rooms.ts` 是接口桩、全部回 unavailable，
 *   这一层**一次网络都不碰** —— 大厅上那些「邀请 / 输入房间码加入」走的都是同一个桩，
 *   拿到 unavailable 就由界面说"联机还没接通，先用 AI 补齐"。
 */
import { create } from "zustand";
import { createRng } from "./rules";
import {
  canStartRoom,
  createRoom,
  kickSeat,
  leaveRoom,
  LOCAL_SEAT_ID,
  playerCountOf,
  roomCodeOf,
  setRoomSize,
  toggleReady,
  type LobbyFailure,
  type LobbyMode,
  type LobbyRoom,
  type LobbyScreen,
  type MatchSize,
  type RoomStartPlan,
} from "./lobby";

/** 自定义房间的默认人数：4（§5-1 的默认桌，也是 4 人匹配的桌）。 */
export const DEFAULT_ROOM_SIZE = 4;

export interface LobbyStore {
  /** 大厅开着没有（开的一刻还没建局：StudioPage 的「▶ 开局」先开它） */
  open: boolean;
  screen: LobbyScreen;
  mode: LobbyMode | null;
  /** 4 人 / 8 人匹配时的那一桌（自定义房间看 room.size） */
  matchSize: MatchSize | null;
  /** 本机开出来的房间（screen === "room" 时非空；房主离开 = 散房） */
  room: LobbyRoom | null;
  /** 最近一次被拒的原因（界面用 lobbyReasonText 说成人话） */
  rejection: LobbyFailure | null;
  /** 「邀请」那张小卡开着没有（里面是可复制的房间码） */
  inviteOpen: boolean;

  openLobby: () => void;
  closeLobby: () => void;
  /** 4 人 / 8 人匹配：直接进"等匹配"那一屏（联机没接通，那里明说这一局用 AI 补齐） */
  chooseMatch: (size: MatchSize) => void;
  /** 自定义房间：在本机开一间（房间码本地生成、其余座位 AI 补位） */
  chooseRoom: () => void;
  /** 回到大厅首屏（房间还开着的话按"离开房间"处理：房主离开 = 散房） */
  backHome: () => void;

  /** 改人数（房主，2~8） */
  resizeRoom: (size: number) => void;
  /** 踢掉某一格的 AI（房主；踢掉的位置空着，开局时再由 AI 补上） */
  kickSeat: (index: number) => void;
  /** 准备 / 取消准备（非房主；现在恒为本机房主，联机接通后才是客人用） */
  toggleReady: () => void;
  /** 离开房间（房主离开 = 这间房散掉） */
  leaveCurrentRoom: () => void;
  /** 开局前问一句"这一局怎么坐"：几个座位、几个人、几个 AI 补位（不许开就回失败原因） */
  startPlanOf: () => { ok: true; plan: RoomStartPlan } | LobbyFailure;
  toggleInvite: (open?: boolean) => void;
  clearRejection: () => void;
}

/** 新房间码的种子（与本机对局同一个做法：时间 + 一点随机，够散即可） */
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
}

export const useLobby = create<LobbyStore>((set, get) => {
  const fail = (failure: LobbyFailure) => set({ rejection: failure });
  const done = (patch: Partial<LobbyStore>) => set({ rejection: null, ...patch });

  return {
    open: false,
    screen: "home",
    mode: null,
    matchSize: null,
    room: null,
    rejection: null,
    inviteOpen: false,

    openLobby: () =>
      set({
        open: true,
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        rejection: null,
        inviteOpen: false,
      }),

    closeLobby: () =>
      set({
        open: false,
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        rejection: null,
        inviteOpen: false,
      }),

    chooseMatch: (size) =>
      done({
        open: true,
        screen: "matching",
        mode: size === 8 ? "match8" : "match4",
        matchSize: size,
        room: null,
        inviteOpen: false,
      }),

    chooseRoom: () => {
      const created = createRoom({
        code: roomCodeOf(createRng(freshSeed())),
        hostId: LOCAL_SEAT_ID,
        size: DEFAULT_ROOM_SIZE,
        // 联机没接通：这是本机房间，别的用户进不来（见 api/game/rooms.ts 的桩）
        online: false,
      });
      if (!created.ok) {
        fail(created);
        return;
      }
      done({ open: true, screen: "room", mode: "room", matchSize: null, room: created.room, inviteOpen: false });
    },

    backHome: () => {
      // 房主离开 = 这间房散掉（lobby.leaveRoom）：回首屏时房间里不能还挂着一份没人管的成员表
      set({
        screen: "home",
        mode: null,
        matchSize: null,
        room: null,
        rejection: null,
        inviteOpen: false,
      });
    },

    resizeRoom: (size) => {
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
      const room = get().room;
      if (!room) {
        fail({ ok: false, reason: "no-room" });
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
      const room = get().room;
      if (!room) {
        fail({ ok: false, reason: "no-room" });
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
      const room = get().room;
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
      });
    },

    /**
     * 「开始对局」前的那一问：这一局几个座位、几个 AI 补位。
     * ★ 判据只有一处（lobby.canStartRoom）：只有房主能开、人数在 2~8 之内。
     *   界面拿到 ok 就把 plan.playerCount 交给 game store 建局 —— 数字不在这里算第二遍。
     */
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
