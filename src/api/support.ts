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
import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { API_BASE, ApiError, apiGet, apiPatch, apiPost, withAppVersion } from "./client";
import type { Live2dModelItem, PersonaSource, PersonaSummary, VoiceMixEntry, VoiceSettings } from "./companion";
import { authHeaders, streamSseRequest, throwHttp } from "./stream";
import type { CompanionSentence } from "../companion/protocol";
import { aiChatSafetyUrl } from "../utils/shareLink";

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

const TICKET_STATUS_LABEL: Record<TicketStatus, MessageDescriptor> = {
  open: msg`待处理`,
  in_progress: msg`处理中`,
  resolved: msg`已解决`,
  closed: msg`已关闭`,
};

const CATEGORY_LABEL: Record<SupportCategory, MessageDescriptor> = {
  billing: msg`费用与退款`,
  account: msg`账号`,
  content: msg`内容处置`,
  bug: msg`程序问题`,
  other: msg`其他`,
};

/**
 * 工单状态 / 分类 → 界面语言的名字（客服页「我的工单」、转人工提示、管理后台工单队列共用）。
 * ★ 认不出的值（服务端先加了一档）原样显示，不退成空白。
 */
export function ticketStatusLabel(s: TicketStatus): string {
  const d = TICKET_STATUS_LABEL[s];
  return d ? i18n._(d) : s;
}

export function categoryLabel(c: SupportCategory): string {
  const d = CATEGORY_LABEL[c];
  return d ? i18n._(d) : c;
}

/**
 * 有 token 就带上：服务端按登录用户解析人格 / 形象 / 声音（voiceSettings 等四个字段），游客只有服务端默认。
 * ★ 以前写死 `auth: false`——那时 config 是纯公共配置，不带 token 顺便避开"token 过期被 401 踢登出"；
 *   现在这一页本来就在 RequireAuth 后面，过期就该登出，与其它带 token 的请求一致。
 */
export function getSupportConfig(): Promise<SupportConfig> {
  return apiGet<SupportConfig>("/api/support/config");
}

/**
 * 求助卡（`safety` 事件）里的一条求助渠道。热线、标签都由服务端按**访问者所在地区**与 lang 给（chatSafety.crisisResources），
 * App 一个号码都不自己写（人在大陆却给 988 是打不通的）。
 */
export interface SupportSafetyResource {
  label: string;
  tel?: string;
  sms?: string;
  /** 只收 https */
  url?: string;
}

/**
 * 危机求助卡：服务端检测到用户这句（trigger=input）或模型要说的那句（trigger=output）涉及自伤时推下来。
 * 形状见 docs/api-contract.md「客服」★ 自伤危机协议（服务端 chatSafety.crisisCard）。
 * ★ 它**不是数字人说的话**：不进演出队列、不调 /api/tts、不进字幕（SupportPage 收到它先 stopAll）。
 */
export interface SupportSafetyCard {
  kind: "crisis";
  trigger: "input" | "output";
  /** "US" | "CN" | "OTHER"（服务端读 CF-IPCountry）；只是记一下，App 不按它分支 */
  region: string;
  title: string;
  body: string;
  resources: SupportSafetyResource[];
  /** 已经拼成官网的完整地址（utils/shareLink.aiChatSafetyUrl），可以直接交给 openExternal */
  policyUrl: string;
  version: string;
}

/** `notice` 事件：AI 身份告知。只有一种 kind；认不出的 kind 不显示（服务端以后加了别的告知，老 App 不乱画） */
export interface SupportNotice {
  kind: "ai_disclosure";
  text: string;
}

/**
 * 客服请求里声明「我认识哪些新事件」（契约：不声明的老客户端收到退化形式 —— 求助卡变成一句普通 sentence，会被当台词念出来、按字扣费）。
 * ★ 两个都声明：safety 是这一版的正事；notice 客服路由今天不发（服务端只在陪聊 / 人格试聊发），声明了也只是收不到，
 *   而契约写的是「带 caps: ["safety","notice"] 才发」—— 服务端哪天给客服也加上告知，App 不用再发一版才看得见。
 */
export const SUPPORT_CAPS = ["safety", "notice"] as const;
export type SupportCap = (typeof SUPPORT_CAPS)[number];

const PHONE_RE = /^[0-9+-]{2,20}$/;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function httpsUrl(v: unknown): string | undefined {
  const s = str(v, 500);
  if (!s) return undefined;
  try {
    return new URL(s).protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `safety` 事件的载荷 → 求助卡。★ 当不可信输入读（与模型输出同一个态度）：文字只收字符串、号码只收数字 / + / -、
 *   网址只收 https，不合格的那一格丢掉；一条渠道连标签带号码都没剩就整条丢。
 * ★ 认不出也照样回一张卡（哪怕是空的）：收到这个事件本身就是「这一轮停下、别念」的信号，不能因为形状不对就退回去念台词。
 */
export function safetyCardOf(payload: Record<string, unknown>): SupportSafetyCard {
  const resources: SupportSafetyResource[] = [];
  for (const r of Array.isArray(payload.resources) ? payload.resources.slice(0, 8) : []) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const tel = str(o.tel, 20);
    const sms = str(o.sms, 20);
    const item: SupportSafetyResource = { label: str(o.label, 200) };
    if (PHONE_RE.test(tel)) item.tel = tel;
    if (PHONE_RE.test(sms)) item.sms = sms;
    const url = httpsUrl(o.url);
    if (url) item.url = url;
    if (item.label || item.tel || item.sms || item.url) resources.push(item);
  }
  return {
    kind: "crisis",
    trigger: payload.trigger === "output" ? "output" : "input",
    region: str(payload.region, 16),
    title: str(payload.title, 200),
    body: str(payload.body, 1000),
    resources,
    policyUrl: aiChatSafetyUrl(str(payload.policyUrl, 500)),
    version: str(payload.version, 40),
  };
}

/**
 * 求助卡的纯文本：写进对话记录、作为一条 assistant 消息回传给服务端（下一轮的 messages[] 与转人工的 transcript）。
 * ★ 拼法与服务端 chatSafety.crisisPlainText **同形**（标题、正文、「· 标签 号码 网址」逐行）：不声明 caps 的老 App 收到的
 *   退化 sentence 就是这一串，回传给服务端的历史两种 App 一模一样。
 * ★★ 别因为「卡不是她说的」就不进 messages（2026-10-25 审核纠正）：那样下一轮的历史会是连着两条 user（危机原话 + 新问题），
 *   而服务端旧写法不做脱敏，会把这两条原样交给模型。
 */
export function safetyPlainText(card: SupportSafetyCard): string {
  const lines = [card.title, card.body, ...card.resources.map((r) => `· ${r.label}${r.tel ? ` ${r.tel}` : ""}${r.url ? ` ${r.url}` : ""}`)];
  return lines.filter((l) => l.trim()).join("\n");
}

/** `notice` 事件 → 告知；不是 ai_disclosure、或没有字，回 null（不显示） */
function noticeOf(payload: Record<string, unknown>): SupportNotice | null {
  const text = str(payload.text, 300);
  return payload.kind === "ai_disclosure" && text ? { kind: "ai_disclosure", text } : null;
}

export interface SupportChatHandlers {
  onSentence?: (sentence: CompanionSentence) => void;
  onToken?: (token: string) => void;
  /** 模型判定该转人工（一次对话最多一次） */
  onHandoff?: (info: { category: SupportCategory; reason: string }) => void;
  /** 危机求助卡（只有请求里声明了 caps: ["safety"] 才会来）；之后不会再有这一轮的句子 */
  onSafety?: (card: SupportSafetyCard) => void;
  /** AI 身份告知（只有声明了 caps: ["notice"] 才会来；今天的客服路由不发） */
  onNotice?: (notice: SupportNotice) => void;
  /** safety = 输入侧命中那一轮（服务端没调模型，text 为空） */
  onDone?: (result: { text: string; handoff: boolean; category: SupportCategory | ""; safety: boolean }) => void;
}

/**
 * 流式问答。resolve = 流正常结束；服务端 `error` 事件或非 2xx 都 reject。
 * ★ 传输那一半（鉴权头 / Content-Type 判能力 / 分块解析 / error 事件转 throw）在 `api/stream.ts` 一处实现，
 *   人格向导的试聊（streamPersonaPreviewChat）走的是同一份 —— 两条路的事件形状本来就一样，
 *   各写一份的话「Content-Type 不是事件流就当没有这个功能」这类判定漏抄了零报错（CLAUDE.md 坑表）。
 *   这里只留「事件名 → handler」这一层语义（handoff 是客服独有的；safety / notice 要请求里声明 caps 才会来，见 SUPPORT_CAPS）。
 */
export async function streamSupportChat(
  body: { messages: Array<{ role: "user" | "assistant"; content: string }>; lang?: "zh" | "en"; caps?: ReadonlyArray<SupportCap> },
  handlers: SupportChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await streamSseRequest(
    "/api/support/chat",
    body,
    ({ event, data }) => {
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
      else if (event === "safety") handlers.onSafety?.(safetyCardOf(payload));
      else if (event === "notice") {
        const n = noticeOf(payload);
        if (n) handlers.onNotice?.(n);
      } else if (event === "done")
        handlers.onDone?.({
          text: String(payload.text ?? ""),
          handoff: Boolean(payload.handoff),
          category: (payload.category as SupportCategory) || "",
          safety: payload.safety === true,
        });
    },
    { signal, unsupported: t`服务端还没有 AI 客服（返回的不是事件流）` },
    ({ event, data }) => {
      if (event !== "error") return "";
      try {
        return String((JSON.parse(data) as { message?: string }).message || "support upstream failed");
      } catch {
        return "support upstream failed";
      }
    },
  );
}

/**
 * /api/tts 的请求体。voice 与 mix 二选一：有 mix（1.0 混音）时 voice / instruct / expressive 服务端都不看（直接丢弃），
 * 所以调用方（SupportPage.ttsBodyFor、面板的试听）混音时只发 text + mix + rate + pitch。
 */
export interface TtsRequest {
  text: string;
  voice?: string;
  /** 1～3 味 1.0 音色（须在 /api/tts/voices 的 mixable 里）；权重服务端归一，speaker 固定 custom_mix_bigtts */
  mix?: VoiceMixEntry[];
  emotion?: string;
  instruct?: string;
  expressive?: boolean;
  rate?: number;
  pitch?: number;
  /**
   * 这一句是哪种用途。只有一个值：剪辑页旁白（studio/cutNarration.synthLine），服务端据此走每天限量的免费额度、不扣钱；
   * 不带 = 按字计费（客服、看板娘、试听）。★ 服务端对认不出的值整句 400，别往这里塞别的。
   */
  purpose?: "cut-narration";
}

/**
 * 一句台词的 /api/tts 请求体（一处实现；2026-09-29 M4 从 SupportPage 搬到这里 —— 老师上课那一页念句子也用它）。
 * voiceSettings 是服务端算好的三层合并结果（用户覆盖 > 人格自带 > 模型推荐 > 默认）；情绪与语调指令来自这一句 ——
 * 服务端已把「人设语调；情绪语调」合并进 sentence.tts.instruct。老服务端没有 voiceSettings → 退回旧写法（只有 voice + expressive:true）。
 * ★ 混音（voiceSettings.mix，1.0 音色）只发 mix + rate + pitch：voice 不传（服务端 speaker 固定 custom_mix_bigtts）、
 *   instruct / expressive 不传（context_texts 与表现力增强都是 2.0 专属，服务端对混音也直接丢弃）、emotion 也不传 ——
 *   混音 speaker 吃不吃 emotion 上游没写明，而 TTS 失败在客服页是**静默**退成合成口型（整段对话哑掉、没有一句报错），
 *   为一点情绪起伏赌整条声音不值。面板里的试听（VoiceMixer / VoiceMarket）发的也是这三个字段：听到的就是之后念台词的。
 */
export function ttsBodyFor(config: SupportConfig | null, sentence: CompanionSentence): TtsRequest {
  const vs = config?.voiceSettings;
  if (!vs) return { text: sentence.text, voice: config?.voice || undefined, emotion: sentence.tts?.emotion, instruct: sentence.tts?.instruct, expressive: true };
  if (vs.mix?.length) return { text: sentence.text, mix: vs.mix, rate: vs.rate ?? undefined, pitch: vs.pitch ?? undefined };
  return {
    text: sentence.text,
    voice: vs.voiceId || undefined,
    rate: vs.rate ?? undefined,
    pitch: vs.pitch ?? undefined,
    expressive: vs.expressive,
    emotion: sentence.tts?.emotion,
    instruct: sentence.tts?.instruct,
  };
}

/**
 * 豆包 TTS → audio/mpeg Blob。登录 + 30 次/分钟限流（服务端）。
 * rate = speech_rate [-50,100]（倍速 1 + r/100），pitch = post_process.pitch [-12,12]；缺省 = 不传（原速原调）。
 */
export async function synthesizeSpeech(body: TtsRequest, signal?: AbortSignal): Promise<Blob> {
  const url = `${API_BASE}/api/tts`;
  const res = await fetch(url, {
    method: "POST",
    headers: withAppVersion(url, authHeaders({ "Content-Type": "application/json" })),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await throwHttp(res);
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.startsWith("audio/")) throw new ApiError(t`服务端没有返回音频`, 501, "UNSUPPORTED");
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
  const url = `${API_BASE}/api/asr?format=${format}`;
  const res = await fetch(url, {
    method: "POST",
    headers: withAppVersion(url, authHeaders({ "Content-Type": mime })),
    body: blob,
    signal,
  });
  const ctype = res.headers.get("content-type") || "";
  // ★ 先看状态码（2026-09-18 发版复核抓到）：网关的错误页（Cloudflare 502/504/524、nginx 413）同样是 HTML，
  //   原来一律判成「服务端还没有语音识别」—— 功能好好的，只是这一次上游挂了 / 录得太长。
  //   只有 **2xx 却回了 HTML**（Capacitor 的 SPA 回退、老服务端）才是真的没有这个功能。
  if (!res.ok) await throwHttp(res);
  if (!ctype.includes("application/json")) throw new ApiError(t`服务端还没有语音识别（返回的不是 JSON）`, 501, "UNSUPPORTED");
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
