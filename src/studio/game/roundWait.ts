/**
 * 「房间已经开局、房主还没开这一回合」这段时间的规则（2026-11-24，Bug A 收口）。
 *
 * ★★ 为什么单开一份零依赖纯函数：这两种失败在轮询代码里长得一模一样（都是"回合没读到"），
 *   但结局必须**相反** ——
 *   · `ROUND_NOT_FOUND`（服务端 404：房间 `playing`、回合还没建）是**正常时序**：
 *     房主可能刚点开局、那一发 `rounds/start` 还在路上（curl 验收里就隔了 5 秒）。
 *     这时客人继续轮询就好。把它当成"回合服务没响应"就会**把一局联机静默降级成单机** ——
 *     对手当场变成本机 AI，而服务端那间房还在、回合随后就建出来（2026-11-24 验收抓到的真 bug）。
 *   · 网络 / 5xx / 认不出的业务码才是真的连不上，才该走原来的 fallback（降级 + 说原因）。
 *   `scripts/check-game-online.mjs` 直接 import 本文件跑正反例 —— 所以这里只 `import type`。
 *
 * ★ 等待上限 3 分钟：正常开局 2~4 秒；超过 3 分钟基本是房主那边卡住了（或者人不在手机前）。
 *   到点**只提示**一句话（`roundsStore.note` 的 `waiting-long`），**仍然不降级** ——
 *   房间还在、回合随时可能出现；降级会把一桌人拆成几局单机，而且没有回头路（会话收掉就不再轮询）。
 *   上限那一句由 roundsReasons 说，与网络降级那一句**分开**（前者是"再等等"，后者是"这一局没了"）。
 */

// ★ 带 .ts：构建门禁用 Node 直接 import 本文件（同 connection.ts 的写法；type import 会被擦掉）。
import type { RoundsFailure } from "../../api/game/rounds.ts";

/**
 * 房间已 `playing`、回合还没建时最多等多久（毫秒）。
 * ★ 3 分钟是"提示"的门槛，不是"降级"的门槛（见文件头 ★）。
 */
export const ROUND_WAIT_MAX_MS = 180_000;

/**
 * 服务端回的这个业务码是不是「房主还没开始这一回合」（**不是失败**）。
 * ★ 只认这两个：服务端契约里 `GET rounds/current` 没有回合时回 404 `ROUND_NOT_FOUND`
 *   （`routes/gameRoom.routes.js` 那一行 + `services/gameRound.service.getCurrent`）；
 *   `NO_ACTIVE_ROUND` 是老实现 / 别家实现可能用的同义码。别的码（NOT_IN_ROOM / ROOM_NOT_FOUND /
 *   GAME_ROUNDS_OFF …）各有各的结局，绝不能混进来一起"继续等"。
 */
const ROUND_PENDING_CODES: ReadonlySet<string> = new Set(["ROUND_NOT_FOUND", "NO_ACTIVE_ROUND"]);

export function isRoundPendingCode(code: string | null | undefined): boolean {
  return typeof code === "string" && ROUND_PENDING_CODES.has(code);
}

/**
 * 轮询一拍失败之后怎么办（**唯一判据**）。
 *   `waiting`      = 业务码说回合还没建：继续轮询（不降级、不动会话）；
 *   `waiting-long` = 同上，但已经等过 `ROUND_WAIT_MAX_MS`：仍然继续轮询，只是要提示一句；
 *   `fallback`     = 真错误（网络 / 5xx / 认不出的业务码）：走现有降级。
 *
 * ★ `waitedMs` 由调用方记（本函数无状态、可被构建门禁直接跑正反例）。
 */
export type RoundWaitOutcome = "waiting" | "waiting-long" | "fallback";

export function roundWaitOf(failure: RoundsFailure, waitedMs: number): RoundWaitOutcome {
  if (failure.reason === "code" && ROUND_PENDING_CODES.has(failure.code)) {
    return waitedMs >= ROUND_WAIT_MAX_MS ? "waiting-long" : "waiting";
  }
  return "fallback";
}
