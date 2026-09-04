/**
 * 数字人（App 的 AI 客服 = 官网首页那位看板娘）的三项选择：人格、Live2D 形象、声音，以及选它们要逛的两个市场。
 * 契约：ideahub-server companion.routes.js（/api/companion/settings）、live2dModel.routes.js（/api/live2d-models）、
 * persona.routes.js（/api/personas，这里只用列表 + 收藏）、tts.routes.js（/api/tts/voices）；
 * 本仓 docs/api-contract.md「客服」一节，字段语义与官网 client 一致。
 *
 * ★ 设置存在服务端、官网与 App 共用一份：在 App 里换了人格/形象/声音，官网首页那位也跟着变。
 * ★ 「使用」一个模型 = PUT settings { modelId }；「下载」= POST /:id/install（收藏 + 计下载数）。两件事分开，
 *   App 的「下载并使用」把它们连同预取模型文件（live2d/prefetch.ts）串成一步（SupportModelsPage）。
 * ★ 官方内置看板娘的 id 固定 "official-mascot"、modelJsonUrl 为空串：空串就用 APK 里打包的那份
 *   （public/live2d/mascot/），服务端不知道也不该知道客户端把模型放在哪。
 * ★ 声音是三层合并（用户覆盖 > 人格自带 > 模型推荐 > 服务端默认），合并结果由服务端算好放在
 *   /api/support/config 的 voiceSettings 里；这里 settings.voice 只是「用户覆盖」那一层，null = 跟随。
 * ★ 与 support.ts 同一条铁律：所有请求走 API_BASE（client.ts）。市场模型的 modelJsonUrl 服务端给的是绝对地址；
 *   万一是相对路径也拼到 API_BASE 上，绝不让它落到 WebView 的同源（SPA 回退 200 + HTML，CLAUDE.md 坑表）。
 */
import { API_BASE, ApiError, apiDelete, apiGet, apiPost, apiPut } from "./client";

/** 豆包 TTS 参数。三处共用（人格自带 / 模型推荐 / 用户覆盖），字段与 /api/tts 的 body 一一对应 */
export interface VoiceSettings {
  /** 音色 id；"" = 跟随下一层 / 服务端默认。只允许 /^[a-zA-Z0-9_.-]{1,64}$/ */
  voiceId: string;
  /** speech_rate [-50,100]，倍速 = 1 + r/100；null = 跟随 */
  rate: number | null;
  /** post_process.pitch [-12,12]；null = 跟随 */
  pitch: number | null;
  /** ≤200 字语调指令（只对 2.0 音色生效） */
  instruct: string;
  /** 走 seed-tts-2.0-expressive（默认 true） */
  expressive: boolean;
}

/** 作者字段：列表接口 populate 成对象，个别老数据只剩 id 串 */
export type PersonaAuthor = { _id: string; username: string } | string | null;

/** 人格摘要（数字人设置 / config 里带的那份，不是市场列表那个 MarketPersona） */
export interface PersonaSummary {
  _id: string;
  name: string;
  description: string;
  coverEmoji: string;
  coverImageUrl: string;
  tags: string[];
  styleDescriptor: string;
  /** 人格自带的嗓子；null = 没带 */
  voice: VoiceSettings | null;
  price: number;
  shared: boolean;
  author: PersonaAuthor;
}

/** Live2D 模型市场里的一条（含官方内置条目） */
export interface Live2dModelItem {
  /** "official-mascot" = 官方内置 */
  _id: string;
  official: boolean;
  author: PersonaAuthor;
  name: string;
  description: string;
  coverImageUrl: string;
  tags: string[];
  /** model3.json 的地址；官方内置为 ""（用本地打包的那份） */
  modelJsonUrl: string;
  bundleName: string;
  bundleBytes: number;
  fileCount: number;
  /** 作者推荐的人格（看的人能用时才带） */
  persona: PersonaSummary | null;
  /** 作者推荐的嗓子 */
  voice: VoiceSettings | null;
  shared: boolean;
  stats: { viewCount: number; downloadCount: number; likeCount: number };
  installed: boolean;
  liked: boolean;
  isOwner: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** 当前生效的人格是谁给的：用户自己选的 / 形象作者推荐的 / 没有（默认人设） */
export type PersonaSource = "user" | "model" | "";

/** GET / PUT /api/companion/settings 的回包 */
export interface CompanionSettings {
  ok: true;
  /** 用户存的三项原始选择（voice = 用户覆盖那一层，null = 跟随） */
  settings: { personaId: string | null; modelId: string | null; voice: VoiceSettings | null };
  /** 解析后的人格：用户选的 → 模型作者推荐的 → null（默认人设） */
  persona: PersonaSummary | null;
  personaSource: PersonaSource;
  /** null = 官方内置 */
  model: Live2dModelItem | null;
  /** 三层合并后的声音，可直接展开进 /api/tts 的 body */
  voice: VoiceSettings;
}

/** PUT 的 body：缺省 = 不动，null = 清掉（modelId "official-mascot" 等价 null） */
export interface CompanionSettingsPatch {
  personaId?: string | null;
  modelId?: string | null;
  voice?: Partial<VoiceSettings> | null;
}

export const OFFICIAL_MODEL_ID = "official-mascot";

export function getCompanionSettings(): Promise<CompanionSettings> {
  return apiGet("/api/companion/settings");
}

/**
 * 人格不可选用 → 403 `{ code: "FORBIDDEN", details: { reason: "private" | "unpaid" } }`（ApiError.details）；
 * 不存在 → 404。付费人格要先在官网购买，App 里只提示去官网。
 */
export function updateCompanionSettings(patch: CompanionSettingsPatch): Promise<CompanionSettings> {
  return apiPut("/api/companion/settings", patch);
}

export type MarketScope = "all" | "installed" | "mine";
export type MarketSort = "new" | "hot";
export interface MarketQuery {
  scope?: MarketScope;
  page?: number;
  /** ≤40 */
  limit?: number;
  sort?: MarketSort;
  q?: string;
  tag?: string;
}

export interface Live2dModelPage {
  ok: true;
  models: Live2dModelItem[];
  /** 不含官方条目 */
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** scope=all 第一页最前是官方条目（不计 total）；installed/mine 未登录 401 */
export function listLive2dModels(opts: MarketQuery = {}): Promise<Live2dModelPage> {
  return apiGet("/api/live2d-models", {
    query: { scope: opts.scope, page: opts.page, limit: opts.limit, sort: opts.sort, q: opts.q, tag: opts.tag },
  });
}

export interface InstallResult {
  ok: true;
  installed: boolean;
  downloadCount: number;
}

/** 收藏下载（计下载数）。官方条目 400 —— 调用方对 official 直接跳过 */
export function installLive2dModel(id: string): Promise<InstallResult> {
  return apiPost(`/api/live2d-models/${encodeURIComponent(id)}/install`);
}

export function uninstallLive2dModel(id: string): Promise<InstallResult> {
  return apiDelete(`/api/live2d-models/${encodeURIComponent(id)}/install`);
}

/** 人格市场列表里的一条（比 PersonaSummary 多了统计与「我」的关系） */
export interface MarketPersona extends PersonaSummary {
  stats: { viewCount: number; downloadCount: number; likeCount: number };
  installed: boolean;
  liked: boolean;
  equipped: boolean;
  isOwner: boolean;
  /** 已购买（永久解锁）；作者本人恒 false —— 先看 isOwner */
  purchased: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonaPage {
  ok: true;
  personas: MarketPersona[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** installed 未登录时服务端当 all 处理（不 401） */
export function listPersonas(opts: MarketQuery = {}): Promise<PersonaPage> {
  return apiGet("/api/personas", {
    query: { scope: opts.scope, page: opts.page, limit: opts.limit, sort: opts.sort, q: opts.q, tag: opts.tag },
  });
}

/** 收藏（书签，幂等）。「给数字人装人格」不是它，是 updateCompanionSettings({ personaId }) */
export function installPersona(id: string): Promise<InstallResult> {
  return apiPost(`/api/personas/${encodeURIComponent(id)}/install`);
}

export function uninstallPersona(id: string): Promise<InstallResult> {
  return apiDelete(`/api/personas/${encodeURIComponent(id)}/install`);
}

export interface TtsVoice {
  id: string;
  name: string;
  why: string;
  expressive?: boolean;
  rate?: number;
}

/** 豆包音色目录（公开）。目录之外的 id 也允许 */
export function getTtsVoices(): Promise<{ ok: true; voices: TtsVoice[]; defaultVoiceId: string }> {
  return apiGet("/api/tts/voices", { auth: false });
}

/** 市场模型的 model3.json 地址 → 绝对地址（服务端给的通常已经是绝对的；相对路径拼到 API_BASE） */
export function resolveModelJsonUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return `${API_BASE}${u.startsWith("/") ? u : `/${u}`}`;
}

/** 作者的展示名（列表里 author 可能只是个 id 串，那就当没有名字） */
export function authorName(author: PersonaAuthor): string {
  return author && typeof author === "object" ? String(author.username || "") : "";
}

/**
 * 形象市场 / 人格市场 / 声音面板共用的报错文案（一处实现）：把 client.ts 的 ApiError 翻成整句人话。
 * 404 单独说：老服务端没有这些路由，用户看到「Not found」只会以为是自己的操作错了。
 */
export function companionErrorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) {
      if (e.code === "OFFLINE") return "当前是离线模式（没配服务器地址），这个功能需要联网。";
      if (e.code === "TIMEOUT") return "请求超时了，检查网络后再试一次。";
      return "网络不可用，检查网络后再试一次。";
    }
    if (e.status === 404) return "服务端还没有这个功能，等后端更新后再来。";
    if (e.status === 429) return "操作太频繁了，稍等几秒再试。";
    return e.message || fallback;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
