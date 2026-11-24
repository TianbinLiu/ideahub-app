/**
 * 大厅 → 对局的那一下（App 里**唯一**同时认识两个 store 的地方）。
 *
 * ★ 为什么不写进 lobbyStore：那一层的纪律是纯状态（文件头 ★）；也不写进 game store：
 *   对局 store 已经在扛回合循环，再让它 import 大厅就变成两个 store 互相认识。
 *   页面是唯一该做"把手势接上"的地方，而这里是它的唯一实现 —— 两个面板
 *   （匹配那一屏、房间那一屏）都调它，不然"开始"就有两条路（一条把大厅留着、一条收掉）。
 * ★ 大厅**收掉**只在真的开起来之后（startGame 回 true）：开不起来时留着大厅，
 *   失败原因看得见（对局 store 的 rejection 由 Lobby 摆出来），玩家不用对着没开局的桌面猜。
 */
import { useGame } from "../store";
import { useLobby } from "../lobbyStore";

export function startFromLobby(playerCount: number): boolean {
  const started = useGame.getState().startGame(undefined, { playerCount });
  if (started) useLobby.getState().closeLobby();
  return started;
}
