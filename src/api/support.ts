/**
 * AI 客服（/api/support）与豆包 TTS（/api/tts）的请求层。
 * 契约：ideahub-server `src/routes/support.routes.js`，文档 docs/api-contract.md「客服」一节。
 *
 * ★ /chat 与 /tts 不走 apiPost/apiGet：一个是 SSE 流（要 ReadableStream 逐块读），一个回二进制（要 Blob），
 *   client.ts 那条只解 JSON。鉴权头与 client 同一来源（getToken），API_BASE 也同一来源。
 * ★ 与全 app 同一条铁律：所有请求都打 API_BASE，绝不写同源相对路径 —— Capacitor 的静态服务器对未命中
 *   路径做 SPA 回退（200 + index.html），`res.ok` 永远为真、`res.json()` 卡在 "<!doctype"（CLAUDE.md 坑表）。
 *   所以能力判断看 Content-Type，不看状态码。
 */
import { API_BASE, ApiError, apiGet, apiPatch, apiPost, getToken } from "./client";
import type { Live2dModelItem, PersonaSource, PersonaSummary, VoiceSettings } from "./companion";
import { createSseParser } from "../companion/sse";
import type { CompanionSentence } from "../companion/protocol";

export type SupportCategory = "billing" | "account" | "content" | "bug" | "other";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export interface SupportConfig {
  ok: true;
  /** 客服叫什么（服务端 SUPPORT_AGENT_NAME / COMPANION_NAME，缺省「小梦」） */
  name: string;
  /** 服务端有没有配 AI key；false = 只能转人工 */
  enabled: boolean;
  /** 服务端有没有配 TTS key；false = 只有字幕 + 合成口型 */
  tts: boolean;
  /** 语音输入（/api/asr）可用；老服务端没有这个字段 → 当 false，不画麦克风 */
  asr?: boolean;
  /** 指定的豆包音色 id；空串 = 服务端默认音色 */
  voice: string;
  loginRequired: boolean;
  quickQuestions: string[];
  categories: SupportCategory[];
  /**
   * 以下四项 2026-09-04 起登录时才带（老服务端一个都没有 → 全走旧逻辑）。
   * voiceSettings = 服务端算好的三层合并（用户覆盖 > 人格自带 > 模型推荐 > 默认），念台词直接展开进 /api/tts；
   * 老字段 voice 与 voiceSettings.voiceId 相等。
   */
  voiceSettings?: VoiceSettings;
  /** 装了的人格（用户选的 → 形象作者推荐的）；null / 缺省 = 默认人设 */
  persona?: PersonaSummary | null;
  personaSource?: PersonaSource;
  /** 在用的市场模型；null / 缺省 = 官方内置 */
  model?: Live2dModelItem | null;
}

export interface TicketReply {
  id: string;
  by: "admin" | "user";
  content: string;
  at: string;
}

export interface SupportTicket {
  id: string;
  status: TicketStatus;
  category: SupportCategory;
  subject: string;
  summary: string;
  note: string;
  transcript: Array<{ role: "user" | "assistant"; content: string; at: string }>;
  replies: TicketReply[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  /** 只有管理员接口才带 */
  contactEmail?: string;
  user?: { id: string; username: string; displayName: string; avatarUrl: string; email: string };
}

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};

export const CATEGORY_LABEL: Record<SupportCategory, string> = {
  billing: "费用与退款",
  account: "账号",
  content: "内容处置",
  bug: "程序问题",
  other: "其他",
};

/**
 * 有 token 就带上：服务端按登录用户解析人格 / 形象 / 声音（voiceSettings 等四个字段），游客只有服务端默认。
 * ★ 以前写死 `auth: false`——那时 config 是纯公共配置，不带 token 顺便避开"token 过期被 401 踢登出"；
 *   现在这一页本来就在 RequireAuth 后面，过期就该登出，与其它带 token 的请求一致。
 */
export function getSupportConfig(): Promise<SupportConfig> {
  return apiGet<SupportConfig>("/api/support/config");
}

export interface SupportChatHandlers {
  onSentence?: (sentence: CompanionSentence) => void;
  onToken?: (token: string) => void;
  /** 模型判定该转人工（一次对话最多一次） */
  onHandoff?: (info: { category: SupportCategory; reason: string }) => void;
  onDone?: (result: { text: string; handoff: boolean; category: SupportCategory | "" }) => void;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function throwHttp(res: Response): Promise<never> {
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
 * 流式问答。resolve = 流正常结束；服务端 `error` 事件或非 2xx 都 reject。
 * ★ Content-Type 不是 text/event-stream 就当"服务端没有这个功能"抛出：SPA 回退给的是 200 + HTML。
 */
export async function streamSupportChat(
  body: { messages: Array<{ role: "user" | "assistant"; content: string }>; lang?: "zh" | "en" },
  handlers: SupportChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/support/chat`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await throwHttp(res);
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/event-stream")) {
    throw new ApiError("服务端还没有 AI 客服（返回的不是事件流）", 501, "UNSUPPORTED");
  }

  const state = { failure: "" };
  const parser = createSseParser(({ event, data }) => {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === "sentence") handlers.onSentence?.(payload as unknown as CompanionSentence);
    else if (event === "token") handlers.onToken?.(String(payload.t ?? ""));
    else if (event === "handoff")
      handlers.onHandoff?.({ category: (payload.category as SupportCategory) || "other", reason: String(payload.reason ?? "") });
    else if (event === "done")
      handlers.onDone?.({
        text: String(payload.text ?? ""),
        handoff: Boolean(payload.handoff),
        category: (payload.category as SupportCategory) || "",
      });
    else if (event === "error") state.failure = String(payload.message || "support upstream failed");
  });

  if (!res.body) {
    parser.push(await res.text());
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  }
  parser.flush();
  if (state.failure) throw new ApiError(state.failure, 502, "SUPPORT_UPSTREAM");
}

/**
 * 豆包 TTS → audio/mpeg Blob。登录 + 30 次/分钟限流（服务端）。
 * rate = speech_rate [-50,100]（倍速 1 + r/100），pitch = post_process.pitch [-12,12]；缺省 = 不传（原速原调）。
 */
export async function synthesizeSpeech(
  body: { text: string; voice?: string; emotion?: string; instruct?: string; expressive?: boolean; rate?: number; pitch?: number },
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/tts`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await throwHttp(res);
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.startsWith("audio/")) throw new ApiError("服务端没有返回音频", 501, "UNSUPPORTED");
  return res.blob();
}

/** 👍 / 👎：连问题与回答原文一起交给服务端（差评是改知识库的线索）。失败不影响对话，调用方自己吞 */
export function rateSupportAnswer(body: { question: string; answer: string; rating: "up" | "down"; reason?: string }): Promise<{ ok: true; id: string }> {
  return apiPost("/api/support/feedback", body);
}

/**
 * 语音识别：把录好的音频二进制原样 POST 给 /api/asr（服务端转火山「录音文件识别·极速版」）。
 * ★ 不走 apiPost：那条只发 JSON；这里 body 是 Blob，Content-Type 就是音频类型。
 * ★ 回包 Content-Type 不是 JSON 就当服务端没有这个功能（SPA 回退 200 + HTML 的坑）。
 */
export async function transcribeAudio(blob: Blob, format: "wav" | "mp3" | "ogg" = "wav", signal?: AbortSignal): Promise<{ text: string; durationMs: number }> {
  const mime = format === "wav" ? "audio/wav" : format === "mp3" ? "audio/mpeg" : "audio/ogg";
  const res = await fetch(`${API_BASE}/api/asr?format=${format}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": mime }),
    body: blob,
    signal,
  });
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) throw new ApiError("服务端还没有语音识别（返回的不是 JSON）", 501, "UNSUPPORTED");
  if (!res.ok) await throwHttp(res);
  const j = (await res.json()) as { ok?: boolean; text?: string; durationMs?: number };
  return { text: String(j.text || "").trim(), durationMs: Number(j.durationMs || 0) };
}

export function createSupportTicket(body: {
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
  note?: string;
  contactEmail?: string;
  category?: SupportCategory;
}): Promise<{ ok: true; ticket: SupportTicket; reused: boolean }> {
  return apiPost("/api/support/tickets", body);
}

export function listMySupportTickets(): Promise<{ ok: true; items: SupportTicket[] }> {
  return apiGet("/api/support/tickets/mine");
}

export function appendTicketMessage(ticketId: string, content: string): Promise<{ ok: true; ticket: SupportTicket }> {
  return apiPost(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, { content });
}

// ── 管理员侧 ──────────────────────────────────────────────
export interface AdminTicketPage {
  ok: true;
  items: SupportTicket[];
  total: number;
  page: number;
  limit: number;
  status: string;
  openCount: number;
}

export function adminListTickets(opts: { status?: TicketStatus | ""; page?: number; limit?: number } = {}): Promise<AdminTicketPage> {
  return apiGet("/api/admin/support/tickets", {
    query: { status: opts.status || undefined, page: opts.page, limit: opts.limit },
  });
}

export function adminReplyTicket(ticketId: string, content: string): Promise<{ ok: true; ticket: SupportTicket }> {
  return apiPost(`/api/admin/support/tickets/${encodeURIComponent(ticketId)}/reply`, { content });
}

export function adminSetTicketStatus(ticketId: string, status: TicketStatus): Promise<{ ok: true; ticket: SupportTicket }> {
  return apiPatch(`/api/admin/support/tickets/${encodeURIComponent(ticketId)}/status`, { status });
}
