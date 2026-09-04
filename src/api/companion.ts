/**
 * 数字人（App 的 AI 客服 = 官网首页那位看板娘）的三项选择：人格、Live2D 形象、声音，以及选它们要逛的三个市场。
 * 契约：ideahub-server companion.routes.js（/api/companion/settings）、live2dModel.routes.js（/api/live2d-models）、
 * persona.routes.js（/api/personas，这里只用列表 + 收藏）、tts.routes.js（/api/tts/voices）、
 * voiceTemplate.routes.js（/api/voice-templates，声音市场 = 混音模板）；
 * 本仓 docs/api-contract.md「客服」一节，字段语义与官网 client 一致。
 *
 * ★ 设置存在服务端、官网与 App 共用一份：在 App 里换了人格/形象/声音，官网首页那位也跟着变。
 * ★ 声音市场的模板 → 用户是**快照**语义（与人格 / 模型「只存 id」相反）：PUT settings { voice: { templateId } } 由服务端
 *   把配方复制进 settings.voice，templateId 只是「使用中」的标记 —— 作者改配方 / 删模板都不会让别人的数字人变声。
 * ★ 混音只吃豆包 1.0 音色（/api/tts/voices 的 mixable 目录，≤ maxMixVoices 味）；2.0 单音色混不了（上游 55000000），
 *   服务端写入时就 400。语调指令（instruct）与表现力增强（expressive）都是 2.0 专属，混音时服务端直接丢弃。
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

/** 混音配方里的一味：1.0 音色 id + 相对权重（服务端归一到和 = 1、三位小数） */
export interface VoiceMixEntry {
  voiceId: string;
  weight: number;
}

/** 豆包 TTS 参数。三处共用（人格自带 / 模型推荐 / 用户覆盖），字段与 /api/tts 的 body 一一对应 */
export interface VoiceSettings {
  /** 音色 id；"" = 跟随下一层 / 服务端默认。只允许 /^[a-zA-Z0-9_.-]{1,64}$/。有 mix 时服务端会把它清空 */
  voiceId: string;
  /**
   * 混音配方（1～3 味 1.0 音色）；null = 单音色。与 voiceId 是二选一的「声音身份」，合并时整体取第一个带身份的层。
   * 老服务端没有这个字段 → 读到 undefined，读的地方一律按 `mix?.length` 判
   */
  mix: VoiceMixEntry[] | null;
  /** 配方来自声音市场的哪个模板（只做「使用中」展示；配方是快照，模板删了服务端会把它置 null） */
  templateId: string | null;
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
  /** 2026-09-04 起服务端带；老服务端没有 */
  generation?: "2.0";
  mixable?: false;
}

/** 混音原料：服务端逐个真调过能出声的 1.0 音色（目录外的 1.0 id 服务端会拒） */
export interface MixableVoice {
  id: string;
  name: string;
  gender: "female" | "male";
  generation: "1.0";
  mixable: true;
}

export interface TtsVoiceCatalog {
  ok: true;
  /** 2.0 单音色 */
  voices: TtsVoice[];
  /** 1.0 可混音目录；老服务端没有 → 面板的「混音」页说明服务端要更新 */
  mixable?: MixableVoice[];
  defaultVoiceId: string;
  /** 一次混音最多几味（豆包上限 3）；老服务端没有 */
  maxMixVoices?: number;
}

/** 豆包音色目录（公开）。单音色允许目录之外的 id；混音的每一味必须在 mixable 里 */
export function getTtsVoices(): Promise<TtsVoiceCatalog> {
  return apiGet("/api/tts/voices", { auth: false });
}

// ── 声音市场（混音模板 /api/voice-templates）────────────────────────

export interface VoiceTemplate {
  _id: string;
  author: PersonaAuthor;
  name: string;
  description: string;
  /** 1～3 味 1.0 音色，权重已归一（和 = 1） */
  recipe: VoiceMixEntry[];
  rate: number | null;
  pitch: number | null;
  /** 存着但对混音无效（1.0 没有 context_texts），只是作者的备注 */
  instruct: string;
  expressive: boolean;
  shared: boolean;
  stats: { useCount: number; likeCount: number };
  liked: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  /** 已拼好的快照（voiceId:""、mix: recipe、templateId: _id、rate/pitch/instruct/expressive），可直接当 VoiceSettings 用 */
  voice: VoiceSettings;
}

/** POST 的 body（PUT 时每个字段都可省）。2.0 id / 超 3 味 → 400，message 是中文人话，直接展示 */
export interface VoiceTemplateInput {
  /** 1～60 字 */
  name: string;
  /** ≤300 字 */
  description?: string;
  recipe: VoiceMixEntry[];
  rate?: number | null;
  pitch?: number | null;
  /** ≤200 字 */
  instruct?: string;
  expressive?: boolean;
  /** 服务端默认 false；面板的「公开」勾选默认勾上 */
  shared?: boolean;
}

export type VoiceTemplateScope = "all" | "mine";
export interface VoiceTemplateQuery {
  scope?: VoiceTemplateScope;
  page?: number;
  /** ≤40 */
  limit?: number;
  sort?: MarketSort;
  /** ≤80 字 */
  q?: string;
}

export interface VoiceTemplatePage {
  ok: true;
  templates: VoiceTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** scope=all 只有公开的；mine 未登录 401 */
export function listVoiceTemplates(opts: VoiceTemplateQuery = {}): Promise<VoiceTemplatePage> {
  return apiGet("/api/voice-templates", { query: { scope: opts.scope, page: opts.page, limit: opts.limit, sort: opts.sort, q: opts.q } });
}

/** 私有且非作者 403 */
export function getVoiceTemplate(id: string): Promise<{ ok: true; template: VoiceTemplate }> {
  return apiGet(`/api/voice-templates/${encodeURIComponent(id)}`);
}

/** 登录，10 次/分钟 → 201 */
export function createVoiceTemplate(input: VoiceTemplateInput): Promise<{ ok: true; template: VoiceTemplate }> {
  return apiPost("/api/voice-templates", input);
}

/** 作者本人 */
export function updateVoiceTemplate(id: string, patch: Partial<VoiceTemplateInput>): Promise<{ ok: true; template: VoiceTemplate }> {
  return apiPut(`/api/voice-templates/${encodeURIComponent(id)}`, patch);
}

/** 作者本人。引用它的数字人 / 人格 / 模型只是 templateId 置 null，配方（快照）原样保留 */
export function deleteVoiceTemplate(id: string): Promise<{ ok: true }> {
  return apiDelete(`/api/voice-templates/${encodeURIComponent(id)}`);
}

export function toggleVoiceTemplateLike(id: string): Promise<{ ok: true; liked: boolean; likeCount: number }> {
  return apiPost(`/api/voice-templates/${encodeURIComponent(id)}/like`);
}

/**
 * 「使用」计数（POST /:id/use）：把模板设为数字人的声音时调一次。只是计数，真正的应用是
 * updateCompanionSettings({ voice: { templateId } })。
 * ★ 名字刻意不叫 useVoiceTemplate：use 开头在 React 里是 hook 的记号，scripts/check-hook-order.mjs 也按这个记号抓，
 *   一个在回调里调用的请求函数顶着 hook 的名字只会招来误报与误读。
 */
export function markVoiceTemplateUsed(id: string): Promise<{ ok: true; useCount: number }> {
  return apiPost(`/api/voice-templates/${encodeURIComponent(id)}/use`);
}

/** 每味归一后的占比（0～1）。只为显示；存进服务端的权重由那边归一（一处实现在 server 的 normalizeWeights） */
export function mixShares(mix: VoiceMixEntry[]): number[] {
  const sum = mix.reduce((a, m) => a + (m.weight > 0 ? m.weight : 0), 0);
  return mix.map((m) => (sum > 0 && m.weight > 0 ? m.weight / sum : 0));
}

/** 配方摘要「高冷御姐 50% · 知性女声 30% · 魅力女友 20%」：面板标题、混音页、市场卡片三处共用 */
export function mixRecipeText(mix: VoiceMixEntry[], nameOf: (id: string) => string): string {
  const shares = mixShares(mix);
  return mix.map((m, i) => `${nameOf(m.voiceId)} ${Math.round(shares[i] * 100)}%`).join(" · ");
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
