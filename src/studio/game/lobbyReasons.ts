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
    case "NO_CHANGE_SIZE_ENDPOINT":
      // 服务端暂时没有改人数端点；正常路径下这颗键在联机房间里根本不摆，这里是防线
      return t`联机房间暂时不能改人数`;
    case "BAD_MODE":
    case "BAD_SEATS":
    case "SEATS_LOCKED":
    case "BAD_READY":
    case "BAD_USER":
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
    case "code":
      return roomCodeText(note.code);
  }
}
