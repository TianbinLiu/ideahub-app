/**
 * 「一条 SSE 响应体 → 一帧一帧的 `{event, data}`」的**唯一实现**（2026-11-24 从 api/stream.ts 抽出来）。
 *
 * ★★ 为什么要抽：本轮给联机对局加了第二条长连接（`GET /api/game/rooms/:code/stream`），
 *   它和 `api/stream.ts`（AI 客服 / 人格试聊那两条 POST 流）要做的事情逐字相同 ——
 *   `res.body.getReader()` → `TextDecoder({stream:true})` → 喂给 `companion/sse` 的解析器 → 读完了 flush。
 *   照抄一份就是"跨 chunk 半帧"这条规则两处实现（铁律六）：哪天补一个坑（例如 `done` 之前先到一块空 chunk、
 *   或者末尾没有空行的半帧）只改一处，另一处就静默地永远收不到最后一个事件。
 * ★ 这里**只管切帧**，不认识的语义（心跳 / 错误 / 结束）由各自的调用方认：
 *   对局的帧语义在 `api/game/roomStream.ts`，聊天的在 `api/stream.ts`。
 * ★ 看门狗 / 超时不在这里：两条流的耐心不是一回事（聊天是"停了 90 秒"、对局是"心跳漏了一拍"），
 *   由调用方在 `onChunk` 里自己计时 —— 把两个数值混进共用层，改一个功能就会顺手改坏另一个。
 * ★ 单独一个文件还有一个用途：它是**零依赖纯函数**（只 import 那个解析器），
 *   `scripts/check-game-stream.mjs` 能在 Node 里直接喂一条假的 ReadableStream 实跑它
 *   （真实的 fetch 路径要网络，构建门禁跑不了）。
 */
import { createSseParser, type SseEvent } from "../companion/sse.ts";

export interface SseBodyOptions {
  /**
   * 每收到一块字节就调一次（浏览器可能在 `done` 之前先发一块空 chunk，那一拍也算"还活着"）。
   * 调用方用它重置看门狗。
   */
  onChunk?: () => void;
}

/**
 * 读完一条 SSE 流。
 *
 * @param body `res.body`；为 null（老 WebView / 测试替身没有 ReadableStream）时退回 `readText()`
 *   整份读回来再切 —— 结果一样，只是没有"逐句到达"。
 * @param readText 整份读正文（只有 `body` 为 null 时才用；传 `() => res.text()`）。
 * @param onFrame 每帧一次（已按空行切好、已拼回被 TCP 分片切断的那一半）。
 * @returns 流正常读完时 resolve（**服务端主动断开也算"读完"**，是不是错误由调用方判）；
 *   读的过程中网络断了则把那个异常原样抛出去（调用方认得出自己的看门狗 abort）。
 */
export async function readSseBody(
  body: ReadableStream<Uint8Array> | null,
  readText: () => Promise<string>,
  onFrame: (event: SseEvent) => void,
  options: SseBodyOptions = {},
): Promise<void> {
  const parser = createSseParser(onFrame);
  if (!body) {
    parser.push(await readText());
    parser.flush();
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- 就是要一块一块读
    const chunk = await reader.read();
    if (chunk.done) break;
    options.onChunk?.();
    parser.push(decoder.decode(chunk.value, { stream: true }));
  }
  // 末尾那个可能被切成两半的多字节字符（`stream: true` 留着的半截）
  parser.push(decoder.decode());
  parser.flush();
}
