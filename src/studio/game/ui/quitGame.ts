/**
 * 对局 → 大厅的那一下（「结束对局」「退出游戏」「🏁 返回大厅」共用）。
 *
 * ★ 与 startFromLobby 正好一对，也是 App 里**唯二**同时认识对局 / 联机回合 / 大厅三个 store 的地方
 *   （理由同那一份：store 之间互相 import 会拿到半初始化的模块，页面这一层才是"把手势接上"的地方）。
 * ★ 为什么不是各写三行：这三处原来各写 `endGame(); openLobby();`，但**退房**只靠
 *   ui/useOnlineRounds 的一个 effect 兜着（state 变 null 那一拍）。设置页的「退出游戏」要在
 *   **同一次点击**里把房间也退掉 —— 玩家点了"认输并退出"，账号不该还挂在服务端那间房里等 30 分钟房寿命。
 *   调的是同一个 roundsStore.leaveNow，先调先退；effect 那一拍再跑一次就是空操作（会话已经清了）。
 * ★ 顺序不能反：先退房、再收局、最后开大厅。反过来的话 leaveNow 里的 leaveRoom 会晚到，
 *   而大厅那边已经按"房间不用管了"在跑。
 */
import { useGame } from "../store";
import { useLobby } from "../lobbyStore";
import { useRounds } from "../roundsStore";

export function quitGameToLobby(): void {
  // ① 联机局：退房 + 清掉"这一局可恢复"的记录（单机局里 session 为 null，这一步只清记录）
  useRounds.getState().leaveNow();
  // ② 收掉对局：state = null，对局 UI（GameLayer）随之卸载
  useGame.getState().endGame();
  // ③ 回**大厅**，不是工坊桌面：刚打完 / 刚认输，下一个动作通常是换张桌再来
  useLobby.getState().openLobby();
}
