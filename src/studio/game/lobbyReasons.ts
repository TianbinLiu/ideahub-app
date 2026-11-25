/**
 * 大厅 / 房间被拒的那句话（唯一一处）。
 *
 * ★ 与 reasons.ts 同一条分工：纯状态机（lobby.ts）与服务端只回**原因码**，说人话在界面这一层，
 *   而且只有这一份实现 —— 大厅首屏、房间成员表、邀请卡三处都会显示失败原因，
 *   各写一句就会出现"同一件事两种说法"（玩家会以为是两个问题）。
 * ★ 服务端的错误码是**英文大写常量**，只认 `code` 不认 `message`（后者是给老 App 兜底的英中并排句子，
 *   服务端改措辞我们不该跟着改）。所以这里是一张 code → 人话的表，认不出的码原样印出来。
 * ★ 函数体里的 t 是"调用那一刻才翻"（不要在模块顶层拼成常量：会冻结在开机语言，见 labels.ts 的 ★）。
 */
import { t } from "@lingui/core/macro";
import { ROOM_MAX_SIZE, ROOM_MIN_SIZE, type LobbyFailure } from "./lobby";
import type { LobbyNote } from "./lobbyStore";
import type { RemoteRoomMode, RemoteRoomState } from "../../api/game/rooms";

/**
 * 房间模式的三个名字（公开房列表 / 观战屏顶栏共用）。
 * ★ 放这里而不是 labels.ts：mode 是**联机房间**的概念（labels 那一份认的是本机玩家 / 卡名），
 *   而这三句只在「公开房」这条路上出现一次。
 */
export function roomModeText(mode: RemoteRoomMode): string {
  switch (mode) {
    case "match4":
      return t`4 人匹配`;
    case "match8":
      return t`8 人匹配`;
    case "custom":
      return t`自定义房间`;
  }
}

/** 房间状态的三个名字（公开房列表那一列「状态」）。 */
export function roomStateText(state: RemoteRoomState): string {
  switch (state) {
    case "waiting":
      return t`等真人`;
    case "playing":
      return t`进行中`;
    case "over":
      return t`已结束`;
  }
}

export function lobbyFailureText(failure: LobbyFailure): string {
  switch (failure.reason) {
    case "no-room":
      return t`还没有开房间——先在大厅里选「自定义房间」`;
    case "not-host":
      return t`这个动作只有房主能做`;
    case "not-member":
      return t`你不在这个房间里`;
    case "host-always-ready":
      return t`房主不用准备：点「开始对局」就是表态`;
    case "seat-out-of-range":
      return t`没有这个座位`;
    case "seat-empty":
      return t`这一格本来就是空的`;
    case "seat-host":
      return t`房主不能踢自己——想走就点「离开房间」`;
    case "size-out-of-range":
      return t`人数只能是 ${ROOM_MIN_SIZE}~${ROOM_MAX_SIZE} 人`;
    case "seat-occupied":
      return t`这一格上还坐着人，不能把房间缩到这么小`;
  }
}

/** 服务端业务错误码 → 一句人话（大厅底栏 / 房间屏共用这一份）。 */
export function roomCodeText(code: string): string {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return t`没有这间房：房间码不对，或者它已经过期解散了`;
    case "ROOM_FULL":
      return t`这间房已经坐满了`;
    case "ROOM_ALREADY_STARTED":
      return t`这间房已经开局了`;
    case "ALREADY_IN_ROOM":
      return t`你已经在另一间房里：先退出那间再来`;
    case "NOT_IN_ROOM":
      return t`你不在那间房里`;
    case "NOT_HOST":
      return t`只有房主能做这个动作`;
    case "NOT_ENOUGH_PLAYERS":
      return t`真人还不够开局（服务端至少算 2 个真人）`;
    case "NOT_ALL_READY":
      return t`还有队友没点准备`;
    case "CANNOT_KICK_SELF":
      return t`房主不能踢自己——想走就点「离开房间」`;
    case "MEMBER_NOT_FOUND":
      return t`那个人已经不在房里了`;
    case "QUEUE_MODE_CONFLICT":
      return t`你已经在另一个匹配池里：先取消再换人数`;
    case "GAME_ROOMS_OFF":
      return t`这台服务器把房间服务关掉了`;
    case "GAME_PUBLIC_ROOMS_OFF":
      return t`这台服务器把公开房列表关掉了`;
    case "GAME_SPECTATORS_OFF":
      return t`这台服务器把观战关掉了`;
    case "SPECTATOR_NOT_ALLOWED":
      return t`观战不能操作这个`;
    case "TOO_MANY_SPECTATORS":
      return t`观战席位满了`;
    case "NO_CHANGE_SIZE_ENDPOINT":
      // 服务端暂时没有改人数端点；正常路径下这颗键在联机房间里根本不摆，这里是防线
      return t`联机房间暂时不能改人数`;
    case "BAD_MODE":
    case "BAD_SEATS":
    case "SEATS_LOCKED":
    case "BAD_READY":
    case "BAD_USER":
    case "BAD_VISIBILITY":
    case "BAD_STATE":
    case "BAD_PAGE":
    case "BAD_LIMIT":
      // 这几条是"客户端把参数发错了"，玩家做不了什么 —— 照实说一句，别装作是房间的问题
      return t`房间请求的参数不对，退回大厅再试一次`;
    default:
      return t`房间服务回了没见过的错误：${code}`;
  }
}

/**
 * 底栏那一句：退回本机的原因 / 服务端的码。
 * ★ "没连上房间服务，先用 AI 开局"是任务点名的那一句：它只在**真的没连上**时说，
 *   服务端明确拒了（房间满 / 已开局）就照服务端的原因说 —— 两件事不能混成一句。
 * ★ `in-room`（ALREADY_IN_ROOM）单独两句话：**服务端说我还在某间房里**不是"没连上"，
 *   界面还要在旁边摆一颗「退出那间房」的键（判据在 ui/Lobby 的底栏）。房号不知道时
 *   说"别的房间"——别把一句编出来的房号印在屏上。
 */
export function lobbyNoteText(note: LobbyNote): string {
  switch (note.kind) {
    case "offline":
      return t`没连上房间服务，先用 AI 开局`;
    case "queue-timeout":
      return t`没匹配到真人，先用 AI 开局`;
    case "not-enough-players":
      return t`服务端只算真人座位（至少 2 人），已切回本机 AI 补位`;
    case "leave-failed":
      return t`没连上房间服务：这间房可能还挂在服务端`;
    case "bad-code":
      return t`房间码是 6 位字母或数字`;
    case "kicked":
      return t`你被房主移出房间了，先用 AI 开局`;
    case "resume-gone":
      // 轻量重连（§7.7）：房间在服务端已经结束 / 过期，或我已经不在成员表里 —— 人已经回大厅
      return t`这一局的房间已经结束`;
    case "resume-offline":
      return t`没连上回合服务，暂时回不到那一局（下次打开再试）`;
    case "in-room":
      return note.code ? t`你还在房间 ${note.code}，退出后重试` : t`你还在别的房间里，退出后重试`;
    case "syncing":
      return t`正在同步房间状态…`;
    case "sync-failed":
      // 房主开局前强制刷新失败、最近一次数据也不够：宁可不开，也不拿旧数据开成一局 AI 单机
      return t`没读到最新的房间状态：先别开，等连上再试`;
    case "code":
      return roomCodeText(note.code);
    // ── 公开房 / 观战（2026-11-24）：三条拒绝各有各的话，别压成"没连上" ──
    case "spectator-not-allowed":
      return t`观战不能操作这个`;
    case "spectators-full":
      return t`观战席位满了`;
    case "already-player":
      // 409：两张名单互斥 —— 该做的是直接进房看自己那一局，不是再点一次观战
      return t`你已经是这间房的玩家，直接进房`;
    case "gone":
      return t`这间房已经不在了（可能刚解散或过期）`;
    case "spectate-off":
      return t`这台服务器把观战关掉了`;
    case "public-rooms-off":
      return t`这台服务器把公开房列表关掉了`;
  }
}
