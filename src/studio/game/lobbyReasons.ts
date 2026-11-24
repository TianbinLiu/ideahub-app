/**
 * 大厅 / 房间被拒的那句话（唯一一处）。
 *
 * ★ 与 reasons.ts 同一条分工：纯状态机（lobby.ts）只回**原因码**，说人话在界面这一层，
 *   而且只有这一份实现 —— 大厅首屏、房间成员表、邀请卡三处都会显示失败原因，
 *   各写一句就会出现"同一件事两种说法"（玩家会以为是两个问题）。
 * ★ 函数体里的 t 是"调用那一刻才翻"（不要在模块顶层拼成常量：会冻结在开机语言，见 labels.ts 的 ★）。
 */
import { t } from "@lingui/core/macro";
import { ROOM_MAX_SIZE, ROOM_MIN_SIZE, type LobbyFailure } from "./lobby";

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
