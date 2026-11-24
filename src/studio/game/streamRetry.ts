/**
 * 推送断线后的**重连节奏**（2026-11-24 SSE）：1s、2s、4s、8s、15s（上限 15 秒），最多 5 次。
 *
 * ★★ 为什么单开一个零依赖模块（而不是写在 `ui/useOnlineRounds` 里）：
 *   这三个数就是这一轮任务点名的那条规则（"1s、2s、4s，上限 15s，最多 5 次"），
 *   而重连那条路**在构建门禁里跑不起来**（要一条真的断掉的网络）。放在纯函数里，
 *   `scripts/check-game-stream.mjs` 能在 Node 里直接把整张表跑一遍钉住；
 *   混在 hook 里就只能靠读代码。
 * ★ 为什么要退避而不是立刻重连：服务端每用户最多 2 条并发连接（`STREAM_MAX_PER_USER`），
 *   断开的那一刻服务端才刚释放名额；连着撞上去就是 429，而 429 按契约**不再重试** ——
 *   一次抖动会直接吃掉整局推送。1 秒起步足够错开。
 * ★ 为什么 5 次就收手：轮询兜底一直在跑（`roundsStore.ROUND_POLL_LIVE_MS` 的 ★★），
 *   界面也已经说了「实时连接断了，正在用轮询」。再试下去只是每 15 秒一条新连接 + 一行失败日志。
 */

/** 最多重连几次（第 6 次失败就停流，彻底用轮询） */
export const STREAM_RETRY_MAX = 5;
/** 第一次重连前等多久 */
export const STREAM_RETRY_BASE_MS = 1_000;
/** 退避的上限（再往上等，玩家已经打完这一回合了） */
export const STREAM_RETRY_MAX_MS = 15_000;

/**
 * 第 `attempt` 次重连之前等多久（`attempt` 从 1 数：1 → 1s，2 → 2s，3 → 4s，4 → 8s，5 → 15s）。
 * ★ 到上限之后不再翻倍（15s、15s…），而不是"继续翻倍但被截断到 15s"——
 *   两者结果一样，但这里写 `Math.min` 是让"上限"这件事一眼看得见。
 */
export function retryDelayOf(attempt: number): number {
  return Math.min(STREAM_RETRY_BASE_MS * 2 ** (attempt - 1), STREAM_RETRY_MAX_MS);
}

/** 已经连着失败 `attempts` 次之后，还值得再试一次吗（= false 时停流，界面那一行小字仍是「正在用轮询」）。 */
export function canRetryStream(attempts: number): boolean {
  return attempts <= STREAM_RETRY_MAX;
}
