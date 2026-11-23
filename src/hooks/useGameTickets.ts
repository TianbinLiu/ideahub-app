// 工坊游戏券的订阅 hook（G4 收尾）：对局界面要"券数变了就重画"，而券是 data 层的模块级单例
// （data/gameTickets，与 videos / danmaku / jobs 同一套：版本靠快照引用变化，useSyncExternalStore 接）。
//
// ★ 为什么抽成 hook 而不是两个组件各写一遍 `useSyncExternalStore(...)`：生成小窗（GenSheet）说那三句话、
//   背包条（BagBar）摆那一格 🎟 —— 两处问的必须是**同一个**判定（data/gameTicketRules.gameTicketModeOf），
//   各自拼一遍就是"券数 0 时一处说有券、另一处说没有"那种零报错的分叉。
// ★ 那三句话不在这里：数据层只给"有券 / 用完 / 没有这张功能 / 还没读到"四种状态，
//   说人话在 studio/game/ui（界面语言随渲染走），四个错误码的人话在 studio/game/reasons。
import { useSyncExternalStore } from "react";
import { gameTickets, subscribeGameTickets, type GameTickets } from "../data/gameTickets";
import { canPayWithTicketOf, gameTicketModeOf, type GameTicketMode } from "../data/gameTicketRules";
import { serverSupports } from "../data/serverCaps";

export interface GameTicketsView {
  /** 读回来的那一份（null = 没读到 / 这台服务器没有） */
  tickets: GameTickets | null;
  mode: GameTicketMode;
  /** 这一发能不能带券（只有 mode === "ticket" 能） */
  canPay: boolean;
}

export function useGameTickets(): GameTicketsView {
  const tickets = useSyncExternalStore(
    subscribeGameTickets,
    gameTickets,
    () => null,
  );
  // 能力位与回包凑起来的那一判只在 data/gameTicketRules 一处；跟着 tickets 的快照重算
  const mode = gameTicketModeOf(serverSupports("gameTickets"), tickets);
  return { tickets, mode, canPay: canPayWithTicketOf(mode) };
}
