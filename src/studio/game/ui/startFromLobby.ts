/**
 * 大厅 → 对局的那一下（App 里**唯一**同时认识大厅 / 对局 / 联机回合三个 store 的地方）。
 *
 * ★ 为什么不写进 lobbyStore：那一层的纪律是纯状态（文件头 ★）；也不写进 game store：
 *   对局 store 已经在扛回合循环，再让它 import 大厅就变成两个 store 互相认识。
 *   页面是唯一该做"把手势接上"的地方，而这里是它的唯一实现 —— 匹配那一屏 / 房间那一屏都调它，
 *   不然"开始"就有两条路（一条把大厅留着、一条收掉）。
 * ★ 大厅**收掉**只在真的开起来之后（startGame 回 true）：开不起来时留着大厅，
 *   失败原因看得见（对局 store 的 rejection 由 Lobby 摆出来），玩家不用对着没开局的桌面猜。
 * ★ 联机那一支（startOnlineFromLobby）：本机局照样要建（买卡 / 摆卡 / 出片都靠它），
 *   只是把"这一局从哪来"一起交过去；服务端房间**不退**（回合引擎还要它）。
 */
import { currentUser } from "../../../data/account";
import type { RemoteRoom } from "../../../api/game/rooms";
import type { RemoteRound } from "../../../api/game/rounds";
import { useGame } from "../store";
import { useLobby } from "../lobbyStore";
import { useRounds } from "../roundsStore";
import { LOCAL_SEAT_ID } from "../lobby";
import { START_HP } from "../rules";

export function startFromLobby(playerCount: number): boolean {
  const started = useGame.getState().startGame(undefined, { playerCount });
  if (started) useLobby.getState().closeLobby();
  return started;
}

/**
 * 联机房间开局：本机建局（座位数 = 房间座位数）+ 接上服务端第 1 回合。
 *
 * ★ 大厅的联机状态（房间码 / 成员 / 谁是房主）在这一刻交给两个 store：
 *   game store 只留 handoff（我是谁 / 房主 / 开局血），回合事实全部在 roundsStore。
 * ★ `closeLobby({ keepRoom: true })`：**不能退房** —— 服务端的 rounds/start 刚把回合挂在房间上，
 *   一退房（尤其最后一人）服务端会当场删房，两个客户端下一页就 404。
 * ★ 建局失败回 false：调用方（useLobbyOnline）把大厅留着并说原因，别让人对着空桌面猜。
 */
export function startOnlineFromLobby(remote: RemoteRoom, round: RemoteRound): boolean {
  const me = currentUser();
  const myUserId = me?.id ?? LOCAL_SEAT_ID;
  const myMember = remote.members.find((member) => member.userId === myUserId) ?? null;
  // 服务端房间快照的 hp 是真相；老快照没有这一位时按满血（与服务端 hpOf 同一个兜底）
  const hp = myMember?.hp ?? START_HP;
  const members = remote.members.map((member) => ({
    userId: member.userId,
    name: member.displayName,
    hp: member.hp ?? START_HP,
  }));
  const session = {
    roomCode: remote.code,
    myUserId,
    myName: me?.name ?? myUserId,
    isHost: remote.hostId === myUserId,
    members,
  };
  const started = useGame.getState().startGame(undefined, {
    playerCount: remote.size,
    online: {
      roomCode: remote.code,
      myUserId,
      myName: session.myName,
      isHost: session.isHost,
      hp,
      eliminated: hp <= 0,
    },
  });
  if (!started) return false;
  useLobby.getState().closeLobby({ keepRoom: true });
  useRounds.getState().begin(session, round);
  return true;
}
