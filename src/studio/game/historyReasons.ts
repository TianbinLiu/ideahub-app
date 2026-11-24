/**
 * 战绩 / 回放这一屏的几句话（唯一一处；与 roundsReasons / lobbyReasons 同一条分工）。
 *
 * ★ 只认 `HistoryFailure.kind`（判据在 `studio/game/history.ts`），不认服务端的 message。
 * ★ 三条退路各有一句（任务点名）：
 *   · 本机单机局 / 能力位为假 → 同一句「这一局没有回放（房间已结束或本机对局）」；
 *   · 403 NOT_IN_ROOM → 你不在这一局里了；
 *   · 404 ROOM_NOT_FOUND → 房间已过期，回放也一起没了。
 *   不把三者压成一句：被踢 / 房间过期 / 这服务器没这功能，玩家能做的事不一样
 *   （回大厅再来一局 / 找房主要码 / 干脆别找）。
 * ★ 2026-11-24 晚多一句「这一局的回放没存下来」（`historyLocalMissingText`）：本机局该有记录却没有
 *   （写失败 / 读到坏数据）。它与"这一局没有回放"分开说 —— 一个是从来没存过，一个是这一次没存上；
 *   混成一句会把一次失败瞒掉（铁律八）。
 * ★ 函数体里的 t 是调用那一刻才翻（别在模块顶层拼常量：会冻结在开机语言）。
 */
import { t } from "@lingui/core/macro";
import type { HistoryFailure } from "./history";

/** 本机单机局 / 能力位为假的那一句（任务点名的原文）。 */
export function historyNoReplayText(): string {
  return t`这一局没有回放（房间已结束或本机对局）`;
}

/**
 * 本机局**该有记录却没读出来**的那一句（2026-11-24 晚，任务第二件点名的原文）：
 * 写失败（配额满 / 隐私模式）或存储里的那一份坏了。与 `historyNoReplayText` 分开说 ——
 * "从来没存过"和"这一局没存下来"是两件事，后者说成前者就是把一次失败瞒掉了。
 */
export function historyLocalMissingText(): string {
  return t`这一局的回放没存下来`;
}

/** 一种失败 → 一句人话。认不出的业务码原样印出来（照实说，不装作没事）。 */
export function historyFailureText(failure: HistoryFailure): string {
  switch (failure.kind) {
    case "expired":
      return t`这一局的房间已经过期，回放也一起没了`;
    case "not-member":
      return t`你不在这一局里了，看不到它的回放`;
    case "off":
      // 与能力位为假同一件事（服务端 503 GAME_HISTORY_OFF / GAME_ROUNDS_OFF）
      return historyNoReplayText();
    case "unavailable":
      return t`没连上回放服务`;
    case "code":
      return t`回放服务回了没见过的错误：${failure.code}`;
  }
}
