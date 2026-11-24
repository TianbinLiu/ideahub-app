/**
 * 联机回合被拒 / 退回单机的那句话（唯一一处）。
 *
 * ★ 与 lobbyReasons / reasons 同一条分工：`roundsStore` 只留 `RoundNote`（结构化原因），
 *   说人话只在界面这一层、只有这一份 —— 创作屏、展映屏、投票屏、底栏都会显示同一件事，
 *   各写一句就是"同一件事两种说法"。
 * ★ 只认 `code` 不认 `message`（服务端那句是英文 / 给老 App 兜底，改措辞不该牵着界面改）。
 * ★ 函数体里的 t 是"调用那一刻才翻"（别在模块顶层拼常量：会冻结在开机语言）。
 */
import { t } from "@lingui/core/macro";
import type { RoundNote, RoundStreamState } from "./roundsStore";

/** 服务端回合端点的业务码 → 一句人话。认不出的码原样印出来（照实说，不装作没事）。 */
export function roundCodeText(code: string): string {
  switch (code) {
    case "NOT_HOST":
      return t`这一步只有房主能做`;
    case "ROUND_NOT_FOUND":
      return t`这一回合还没开（或者房间已经散了）`;
    case "ROUND_ALREADY_STARTED":
      return t`这一回合已经开始了`;
    case "ROUND_NOT_PLAYING":
      return t`房间还没开局`;
    case "ROUND_NOT_SETTLED":
      return t`上一回合还没结算`;
    case "WRONG_PHASE":
      return t`现在是另一个阶段，这一步现在做不了`;
    case "NOT_ALL_SUBMITTED":
      return t`还有人没交片——全员交片之后房主才能开始展映`;
    case "NOT_IN_ROOM":
      return t`你不在那间房里了`;
    case "PLAYER_ELIMINATED":
      return t`你已经被淘汰，这一局只能看别人打`;
    case "CANNOT_LIKE_SELF":
      return t`联机版不能给自己的片子点赞`;
    case "CANNOT_VOTE_SELF":
      return t`不能投自己那条片子`;
    case "TARGET_NOT_IN_ROOM":
      return t`那个人已经不在这一局里了`;
    case "NO_ENTRIES":
      return t`这一回合还没有人交片，结算不了`;
    case "BAD_PROMPT":
      return t`提示词不能是空的`;
    case "PROMPT_TOO_LONG":
      return t`提示词太长了（联机版最多 80 字）`;
    case "BAD_CARD_NAMES":
    case "BAD_ENTRY_FIELD":
    case "BAD_TARGET":
    case "BAD_PHASE":
      // 客户端把参数发错了，玩家做不了什么 —— 照实说一句，别装作是服务器的问题
      return t`这一步的参数不对，刷新之后再试一次`;
    case "GAME_ROUNDS_OFF":
      return t`这台服务器把回合服务关掉了`;
    case "GAME_OVER":
      return t`这一局已经结束了`;
    case "TIMEOUT":
    case "NETWORK":
      return t`回合服务没响应，这一局改成单机继续`;
    default:
      return t`回合服务回了没见过的错误：${code}`;
  }
}

/**
 * 底栏那一句。
 * ★ "回合服务没响应，这一局改成单机继续"是任务点名的那一句：它只在**真的退回单机**时出现
 *   （`fallback`），不是每一拍网络抖动都说 —— 抖动那一句是 `unavailable`，还能重试。
 * ★ ★ 2026-11-24（对局内 P0-2）：`fallback` 带着业务码时**说那条码**（被移出房间 / 房间没了 /
 *   回合服务被关），而不是笼统的"没响应" —— 那句话同时是顶部红条的文案，
 *   而红条要给的是「回大厅」，挂在一句"没响应"下面会让人以为再等等就好了。
 */
export function roundsNoteText(note: RoundNote): string {
  switch (note.kind) {
    case "fallback":
      return note.code ? roundCodeText(note.code) : t`回合服务没响应，这一局改成单机继续`;
    case "unavailable":
      return t`这一拍没连上回合服务，正在重试`;
    case "code":
      return roundCodeText(note.code);
  }
}

/**
 * 顶部黄条那一句（`null` = 不摆那条横幅）。
 * ★ 玩家只需要知道两件事：现在是实时的，还是掉回轮询了。
 *   `retrying`（正在退避重连）与 `polling`（重连 5 次都没成）对他是**同一件事** ——
 *   现在靠轮询在跑、对局照样能打完；分成两句说只会让人追问"还要等多久"（答案我们也不知道）。
 * ★ ★ 2026-11-24 起 `live` 也返回 null：原来底栏常驻一行「实时连接中」，
 *   正常的时候它只是噪音（任务点名"正常时不打扰"）。断开才摆横幅，恢复了由界面补一条
 *   2 秒的绿条（ui/ConnectionBanner）；`off`（能力位为假 / 单机局 / 对局已结束）同样不摆。
 */
export function roundStreamText(state: RoundStreamState): string | null {
  switch (state) {
    case "retrying":
    case "polling":
      return t`实时连接断了，正在用轮询`;
    default:
      return null;
  }
}

/**
 * 绿条那一句（推送从"断了 / 正在轮询"恢复成正常时，停 2 秒自己消失）。
 * ★ 与黄条同一处说：同一件事（通道状态）的几句话只在这里。
 */
export function roundStreamRecoveredText(): string {
  return t`实时连接恢复了`;
}
