/**
 * @file sse.ts - 极简 SSE（text/event-stream）分块解析器
 * @category Utility
 *
 * ★ 为什么不用 EventSource：它只能 GET、不能带 Authorization 头，而 /api/companion/chat 是
 *   POST + Bearer。用 fetch 拿 ReadableStream 自己切事件，就必须处理"一个事件被 TCP 分片切成两半"的情况，
 *   所以这里是一个带缓冲的 push/flush 解析器，而不是一次性 split。
 */

export type SseEvent = { event: string; data: string };

export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";

  function emit(block: string) {
    let event = "message";
    const data: string[] = [];
    for (const rawLine of block.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon >= 0 ? line.slice(0, colon) : line;
      let value = colon >= 0 ? line.slice(colon + 1) : "";
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) onEvent({ event, data: data.join("\n") });
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) emit(block);
        boundary = buffer.indexOf("\n\n");
      }
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = "";
    },
  };
}
