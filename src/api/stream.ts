/**
 * 「POST 一个 JSON、读回一条 SSE 流」的**唯一实现**，以及两条 fetch 直连路共用的鉴权头 / 报错翻译。
 *
 * ★★ 为什么单独抽一层（2026-09-07，创作中心 P3）：此前这一整套（拼 Authorization → fetch → 判非 2xx →
 *   判 Content-Type 是不是 text/event-stream → 逐块 push 进解析器 → flush → 把服务端的 `error` 事件翻成 throw）
 *   只长在 `api/support.ts` 的 streamSupportChat 里。人格向导的「试聊」（POST /api/personas/preview-chat）
 *   与它的事件完全相同（sentence / token / done / error），照抄一份就等于同一条规则有两处实现（铁律六）——
 *   而这条规则里有一件**抄漏了零报错**的事：Content-Type 判定。Capacitor 的本地静态服务器对未命中路径回
 *   200 + index.html（CLAUDE.md 坑表），不判 Content-Type 的话老服务端上表现为"流开着但一个字都不来"。
 * ★ 事件的**语义**仍归各自的调用方：这里只管把 `{event, data}` 原样交出去，不认识 sentence / handoff 这些名字。
 * ★ `error` 事件与非 2xx 都 reject；正常读完 resolve。abort 由调用方给 signal，原样抛 AbortError。
 */
import { API_BASE, ApiError, getToken } from "./client";
import { createSseParser, type SseEvent } from "../companion/sse";

/** 有 token 就带上（游客只拿服务端默认）。与 client.ts 同一个 token 来源 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

/** 非 2xx → ApiError，尽量用服务端那句中文 message（服务端约定 4xx 的 message 就是给人看的整句话） */
export async function throwHttp(res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  let code = "";
  try {
    const j = (await res.json()) as { message?: string; code?: string };
    if (j.message) message = j.message;
    if (j.code) code = j.code;
  } catch {
    /* 非 JSON 就用状态码 */
  }
  throw new ApiError(message, res.status, code || undefined);
}

export interface SseRequestOptions {
  signal?: AbortSignal;
  /**
   * 回包不是 text/event-stream 时抛的那句话（= 这台服务器没有这条路由）。**必填**：
   * 两条路的说法不一样（「服务端还没有 AI 客服」vs「服务端还没有人格试聊」），
   * 写成可选就会有人漏传、用户读到一句不知道在说哪个功能的话。
   */
  unsupported: string;
}

/**
 * @param onEvent 逐个 SSE 事件（已按空行切好、已拼回被 TCP 分片切断的那一半）。
 *   服务端的 `error` 事件由**调用方**在这里记下 message 并返回给 failure，见下。
 * @param failureOf 从事件里认出「服务端说这次失败了」的那一条 → 返回整句人话（返回空串 = 不是失败事件）。
 *   ★ 不在这里写死 `event === "error"`：两条路刚好一样，但把它钉死在共用层里，将来某条路换了事件名会静默地永不报错。
 */
export async function streamSseRequest(
  path: string,
  body: unknown,
  onEvent: (e: SseEvent) => void,
  opts: SseRequestOptions,
  failureOf: (e: SseEvent) => string,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) await throwHttp(res);
  const ctype = res.headers.get("content-type") || "";
  // ★ 看 Content-Type 不看状态码：SPA 回退给的是 200 + HTML（CLAUDE.md 坑表）
  if (!ctype.includes("text/event-stream")) throw new ApiError(opts.unsupported, 501, "UNSUPPORTED");

  let failure = "";
  const parser = createSseParser((e) => {
    const f = failureOf(e);
    if (f) {
      failure = f;
      return;
    }
    onEvent(e);
  });

  if (!res.body) {
    // 老 WebView / 测试替身没有 ReadableStream：整份读回来再切，结果一样（只是没有"逐句到达"）
    parser.push(await res.text());
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- 就是要一块一块读
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  }
  parser.flush();
  if (failure) throw new ApiError(failure, 502, "SSE_UPSTREAM");
}
