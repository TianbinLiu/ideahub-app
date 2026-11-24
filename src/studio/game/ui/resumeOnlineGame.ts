/**
 * 联机局的**轻量重连**（2026-11-24）：App 被杀 / 页面刷新 / 切后台回来时，找回同一局。
 *
 * ★★ 判据（任务点名，全部走服务端已有端点）：
 *   ① 本机有"那一局"的记录（onlineResume.ts；开局成功时写，退出 / 结束 / 房间没了时清）；
 *   ② `GET /rooms/:code` 回 200 **且我在成员表里**（服务端 playing 房寿命 2 小时，过期就是 404）；
 *   ③ `GET rounds/current` 读得到当前回合 —— 房间还在但回合读不到 = 这一局不在了（按结束处理）。
 *   三条都过 → 用房间快照 + 回合快照重建本机局（`startOnlineFromLobby`，它会把本机跳到服务端当前回合）。
 * ★ 房间没了（404 / 我不在成员表 / 房间已经不在 playing）→ 记 `gone`，由界面落回大厅并说一句
 *   「这一局的房间已经结束」（不静默给一张空桌面）。
 * ★ 网络失败（unavailable）→ `pending`：**不删记录**（下次冷启动还能再试），也不假装这一局还在。
 * ★ 同一个 App 里只跑一次（模块级 inflight）：StrictMode 的假挂载会把这个 effect 跑两遍，
 *   两遍都发请求 / 都建局就会开两桌（真机上表现为"一进工坊出现第二局"）。
 */
import { currentUser } from "../../../data/account";
import { readRoom, type RemoteRoom } from "../../../api/game/rooms";
import { readRound } from "../../../api/game/rounds";
import { useGame } from "../store";
import { readOnlineResume, clearOnlineResume } from "../onlineResume";
import { startOnlineFromLobby } from "./startFromLobby";

export type ResumeOutcome =
  /** 已经在局里（并发里别人先开好了）/ 这一下真的恢复了 */
  | "resumed"
  /** 房间没了 / 我不在房里 / 这一局已经不在 playing：记录已清，界面应落回大厅 */
  | "gone"
  /** 连不上 / 登录态还没水合：记录留着，下次再试 */
  | "pending"
  /** 本机没有这条记录 / 不是当前账号的那一局 */
  | "none";

/** 房间还在、但我已经不在成员表里（被踢 / 换号）——与"房间没了"同一档。 */
function membershipOf(room: RemoteRoom, myUserId: string): boolean {
  return room.members.some((member) => member.userId === myUserId);
}

let inflight: Promise<ResumeOutcome> | null = null;

/**
 * 尝试恢复那一局（幂等：同一时刻只有一发）。
 * ★ 回 "resumed" 时 game store 里已经有 state；调用方只负责把界面带到 /studio。
 */
export function resumeOnlineGame(): Promise<ResumeOutcome> {
  // 已经开着一局（这次会话里刚开 / 上一次恢复成功）：不重复建局
  if (useGame.getState().state) return Promise.resolve("resumed");
  if (inflight) return inflight;
  inflight = (async (): Promise<ResumeOutcome> => {
    const record = readOnlineResume();
    if (!record) return "none";
    const me = currentUser();
    if (!me) return "pending"; // 登录态还在水合：记录留着
    if (me.id !== record.myUserId) return "none"; // 另一个账号：不动这条记录（原账号换回来还能接着打）
    const roomRes = await readRoom(record.roomCode);
    if (!roomRes.ok) {
      if (roomRes.reason === "code" && (roomRes.code === "ROOM_NOT_FOUND" || roomRes.code === "NOT_IN_ROOM")) {
        clearOnlineResume();
        return "gone";
      }
      return "pending";
    }
    const room = roomRes.value;
    // 房间还在、但已经不在 playing（服务端收拾过 / 被重置）/ 我不在成员表：这一局不在了
    if (!room.started || !membershipOf(room, record.myUserId)) {
      clearOnlineResume();
      return "gone";
    }
    const roundRes = await readRound(record.roomCode);
    if (!roundRes.ok) {
      if (roundRes.reason === "code" && (roundRes.code === "ROUND_NOT_FOUND" || roundRes.code === "NOT_IN_ROOM")) {
        clearOnlineResume();
        return "gone";
      }
      return "pending";
    }
    // 两个 await 之间可能已经有人（另一次恢复 / 玩家自己开了新局）：再问一次，别开第二桌
    if (useGame.getState().state) return "resumed";
    if (!startOnlineFromLobby(room, roundRes.value)) return "pending";
    return "resumed";
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
