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

/**
 * 「多久没有新东西就放弃」。★★ 按**停了多久**算，不按总时长算（与 uploads.ts 的 `CHUNK_STALL_MS` 同一个口径）：
 *   一次长回答可以正当地流上好几分钟，掐总时长会把正在好好说话的那一条截断。
 * ★ 90 秒 = 服务端给上游模型的 `AI_TIMEOUT_MS`（60s）+ 余量：第一个 token 之前那段等待是最长的一段，
 *   服务端自己都放弃了我们才该放弃。
 * ★★ 为什么必须有（CLAUDE.md 坑表「等媒体/加载一律带上限」的同族）：上游卡住不回时这条 Promise 永不 settle
 *   ⇒ 调用方 `finally` 里那句 `chatBusy = false` 永不执行 ⇒ 屏幕上只有一个转不完的「…」，没有一句错，
 *   而人格向导的「重新开始」也跟着永久灰掉。窗口切后台时更容易撞上。
 */
const SSE_STALL_MS = 90_000;

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
  // ★ 看门狗自己的 controller，与调用方的 signal 并联：谁先响都停。
  //   `stalled` 这面旗子在 abort() **之前**举（回调是同步的，顺序反了就永远读到 false ——
  //   uploads.ts 的 `selfAborted` 栽过同一个坑），有它才分得清"我们放弃了"和"用户点了停下"。
  const ctrl = new AbortController();
  let stalled = false;
  let timer = 0;
  const onExternalAbort = () => ctrl.abort();
  const arm = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, SSE_STALL_MS);
  };
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
    opts.signal?.removeEventListener("abort", onExternalAbort);
  };
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }
  arm();

  try {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (stalled) throw new ApiError(`等了 ${Math.round(SSE_STALL_MS / 1000)} 秒还没有回话，先停下了。稍后再试一次。`, 0, "TIMEOUT");
      throw e;
    }
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
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          // eslint-disable-next-line no-await-in-loop -- 就是要一块一块读
          chunk = await reader.read();
        } catch (e) {
          if (stalled) throw new ApiError(`回话说到一半停住了（${Math.round(SSE_STALL_MS / 1000)} 秒没有新内容），先停下了。`, 0, "TIMEOUT");
          throw e;
        }
        if (chunk.done) break;
        arm(); // 有新字节 = 还活着，重新计时（按"停了多久"算，见 SSE_STALL_MS 的 ★★）
        parser.push(decoder.decode(chunk.value, { stream: true }));
      }
      parser.push(decoder.decode());
    }
    parser.flush();
    if (failure) throw new ApiError(failure, 502, "SSE_UPSTREAM");
  } finally {
    disarm();
  }
}
