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
import { postMultipart, type MultipartPart } from "./uploads";
import { streamSseRequest } from "./stream";
import type { CompanionSentence } from "../companion/protocol";
// ★ 只借类型（`import type` 编译后整行消失，不构成 api → live2d 的运行时依赖）。
//   刻意**不在这里另写一份**映射的形状：向导拿到的 mapping 要原样喂给 live2d/mapping 的 setPreviewMapping
//   去驱动预览，两份各自正确地漂开的话，症状是"预览按 A 演、发布出去按 B 演"，而两边都不报错。
import type { CompanionMapping } from "../live2d/mapping";

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

/**
 * companion.json 在网络上的形状 —— 与运行时那份 `live2d/mapping.CompanionMapping` **是同一个类型**
 * （只是在 api 层换了个名字，方便调用方一眼看出"这是从服务端来 / 要发给服务端的那份"）。
 * 服务端的自动映射（`suggestMapping`）与校验（`validateMapping`）是唯一实现，客户端不自己猜。
 */
export type CompanionMappingWire = CompanionMapping;

/** 市场卡片上的四枚能力角标；服务端从包里提取（一处实现在 server 的 live2dCapabilities.service） */
export type Live2dBadge = "motions" | "expressions" | "touch" | "physics";

/**
 * 角标 → 中文（一处实现）：形象市场的卡片、上传向导的"这个包会什么"两处都读它。
 * ★ 各写一份的话，向导里说"会表情"、市场里说"有表情"，同一个包在两屏上是两种说法。
 */
export const LIVE2D_BADGE_LABEL: Record<Live2dBadge, string> = {
  motions: "会动",
  expressions: "会表情",
  touch: "可触摸",
  physics: "有物理",
};

/** 一个模型包"会什么"（服务端提取，存库 + 进列表 payload）。设计见 docs/digital-human-creator-center.md §3.3 */
export interface Live2dCapabilities {
  motionGroups: string[];
  motionCount: number;
  expressions: string[];
  hitAreas: string[];
  /** 参数 id 表（从 cdi3 读；没有 cdi3 就是空的） */
  params: string[];
  /**
   * 参数表是不是**真的读到了**。★ 必须看它再看 params：`params: []` 有两种意思 ——
   * "这个包没有可用参数"与"没有 cdi3、我们读不到"，压成一档就会对着一个完全正常的包说"不能眨眼"。
   */
  paramsKnown: boolean;
  hasPhysics: boolean;
  hasPose: boolean;
  textures: { count: number; maxSide: number };
  badges: Live2dBadge[];
}

/** 上传时的授权勾选留痕（§2）。null / 缺省 = 这条是勾选功能上线之前的老数据 */
export interface Live2dLicense {
  selfMade: boolean;
  agreedAt: string | null;
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
  // ── 2026-09-05 起服务端才带的四项。★ 一律**缺失 = 老数据**（判否定不判等值，CLAUDE.md）：
  //    `capabilities?.badges?.length` 而不是 `badges.length === 4`，否则老条目会被整批判成"什么都不会"。
  /** 这个包会什么（角标 / 向导用）；缺省 = 这条是能力提取上线之前入库的 */
  capabilities?: Live2dCapabilities;
  /** 作者调好的 companion.json；null = 用服务端的自动映射 */
  mapping?: CompanionMappingWire | null;
  license?: Live2dLicense | null;
  /** 被运营下架：列表里本来就不该出现，详情页要说明白 */
  takenDown?: boolean;
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

// ── 创作中心：Live2D 上传向导（/support/models/new）──────────────────────
//
// ★★ 一个包有**两条**上路，向导要能在两条之间自己切（docs/digital-human-creator-center.md §3.6）：
//   ① 直传：`uploadLive2dBundle`（uploads.ts）拿票分块推到 Cloudinary → 这里带 `bundleRef` 走 JSON；
//   ② multipart：整份 zip 直接 POST 给我们的服务器。
//   ②**受 Cloudflare 那道 125 秒读超时约束**（CLAUDE.md 坑表、uploads.ts 文件头 ★★★）：手机 5G 上行实测
//   0.126MB/s ⇒ 15MB 上下就传不完了，而 25MB 是允许的上限 —— 所以 ① 才是默认，② 只是老服务端的退路。
//   ⚠ `POST /api/live2d-models/bundle/sign` 的服务端 PR（ideahub-server#60）尚未合并，线上会回 404：
//   `uploadLive2dBundle` 那时返回 null，向导必须退到 ②，并在进度文案里说清"现在走的是慢的那条"。
// ★ multipart 的文本字段到手全是字符串，服务端 zod（live2dModel.schemas.js）按字符串形态转型：
//   布尔只认 "true"/"1"/"on"/"yes"（**所以 false 一律不发**，发 "false" 会被 `Boolean("false")` 判成真的年代还在别处存在）、
//   voice / mapping 要 JSON.stringify、tags 逗号分隔。这几条在下面 `bundleParts` 一处实现，别在调用点各拼一遍。

/** `/inspect` 的完成度清单：required 少一项就不能发布，recommended 只是"有了会更像活人" */
export interface Live2dCompletenessItem {
  slot: string;
  ok: boolean;
}
export interface Live2dCompleteness {
  required: Live2dCompletenessItem[];
  recommended: Live2dCompletenessItem[];
  recommendedDone: number;
  recommendedTotal: number;
}

export interface Live2dInspectResult {
  ok: true;
  /** 包里所有 *.model3.json（多个时让用户挑一个当入口） */
  entries: string[];
  /** 这次按哪个入口读的 */
  entry: string;
  capabilities: Live2dCapabilities;
  /** 服务端算的自动映射：向导拿它当默认值，用户在第 4 步上面改 */
  mapping: CompanionMappingWire;
  completeness: Live2dCompleteness;
  /** 整句人话（"没有 Idle 动作组，会用我们的呼吸兜底"这类），原样显示 */
  warnings: string[];
  bundleBytes: number;
  fileCount: number;
}

/**
 * 只看不存（向导第 3 步）：解析包 → 能力档案 + 自动映射 + 入口候选。登录，10 次/分钟。
 * @param input `file`（本地 zip）与 `bundleRef`（已直传的 public_id）**二选一**；`entry` 只在包里有多个 model3.json 时给。
 */
export async function inspectLive2dBundle(input: { file?: File; bundleRef?: string; entry?: string }): Promise<Live2dInspectResult> {
  let data: Record<string, unknown>;
  if (input.file) {
    const parts: MultipartPart[] = [["bundle", input.file, input.file.name || "model.zip"]];
    if (input.entry) parts.push(["entry", input.entry]);
    // 180s：25MB 的包在慢网上要传一会儿，服务端还要解压 + 逐个文件核对。老服务端没这条路 → 404，调用方翻译
    data = await postMultipart("/api/live2d-models/inspect", parts, 180_000);
  } else {
    if (!input.bundleRef) throw new ApiError("要检查的模型包既没有文件也没有直传编号（这是调用方的 bug）", 400);
    data = await apiPost("/api/live2d-models/inspect", { bundleRef: input.bundleRef, entry: input.entry || undefined });
  }
  // ★ 按**回包形状**验收，不看状态码（Capacitor 那条坑：未命中路径回 200 + index.html，uploads.ts 的 receiptOf 同款）。
  //   不验的话老服务端上 `capabilities` 是 undefined，症状要拖到向导第 4 步渲染映射表时才炸，而那时人已经填了三屏。
  if (!data || typeof data.capabilities !== "object" || !data.capabilities) {
    throw new ApiError("这台服务器还不会解析 Live2D 模型包（需要更新服务端），暂时传不了。", 501, "UNSUPPORTED");
  }
  return data as unknown as Live2dInspectResult;
}

/** 建模型时要填的一份表。★ `selfMade` 必填：授权勾选漏传是零症状的（服务端 `Boolean(undefined)` = false，静默存成"没勾"） */
export interface Live2dModelForm {
  name: string;
  description?: string;
  coverImageUrl?: string;
  tags?: string[];
  /** 公开到市场；false = 只有自己能用 */
  shared?: boolean;
  /** 作者推荐的人格；空 = 不推荐 */
  personaId?: string | null;
  /** 作者推荐的嗓子；null = 不推荐 */
  voice?: VoiceSettings | null;
  /** 向导第 4 步调好的映射；缺省 = 让服务端自动映射 */
  mapping?: CompanionMappingWire | null;
  /** 多个 model3.json 时选定的那个（来自 inspect 的 entries） */
  entry?: string;
  /** 授权勾选：我是作者或已获授权（§2 的三条声明） */
  selfMade: boolean;
  /** 二选一：已直传的 public_id …… */
  bundleRef?: string;
  /** …… 或本地 zip 文件（走 multipart 退路） */
  file?: File;
  /** 走 bundleRef 时把原始文件名带上（multipart 那条服务端自己从 originalname 读，不用给） */
  bundleName?: string;
}

export interface Live2dCreateResult {
  ok: true;
  model: Live2dModelItem;
  warnings: string[];
  entries: string[];
}

/** 把表转成 multipart 的文本字段（布尔 / JSON / tags 的写法只有这一处，见上面 ★） */
function bundleParts(form: Live2dModelForm): MultipartPart[] {
  const parts: MultipartPart[] = [];
  parts.push(["name", form.name]);
  if (form.description) parts.push(["description", form.description]);
  if (form.coverImageUrl) parts.push(["coverImageUrl", form.coverImageUrl]);
  if (form.tags?.length) parts.push(["tags", form.tags.join(",")]);
  // ★ 只在为真时发：服务端认的是 "true"/"1"/"on"/"yes"，缺省就是 false，不需要（也不该）发 "false"
  if (form.shared) parts.push(["shared", "true"]);
  if (form.selfMade) parts.push(["selfMade", "true"]);
  if (form.personaId) parts.push(["personaId", form.personaId]);
  if (form.voice) parts.push(["voice", JSON.stringify(form.voice)]);
  if (form.mapping) parts.push(["mapping", JSON.stringify(form.mapping)]);
  if (form.entry) parts.push(["entry", form.entry]);
  return parts;
}

/**
 * 建一个 Live2D 模型（向导第 6 步）。登录，5 次/分钟 → 201。
 * 映射里引用了包里没有的动作组 / 表情 / 命中区 → 400，`message` 带那个名字，**原样显示**（自己编一句会把它盖掉）。
 */
export async function createLive2dModel(form: Live2dModelForm): Promise<Live2dCreateResult> {
  if (form.file) {
    const parts: MultipartPart[] = [["bundle", form.file, form.file.name || "model.zip"], ...bundleParts(form)];
    // 600s：25MB 走 multipart 时字节要经过我们的服务器（那条路本来就慢），别比 Cloudflare 那道 125 秒墙更早响
    const data = await postMultipart("/api/live2d-models", parts, 600_000);
    // 同 inspect：按形状验收。没拿到 model 就是"没建成"，绝不能让向导跳到成功那一屏
    if (!data || typeof data.model !== "object" || !data.model) throw new ApiError("服务器没有返回建好的模型（可能是旧版服务端），没有创建成功。", 502);
    return data as unknown as Live2dCreateResult;
  }
  if (!form.bundleRef) throw new ApiError("建模型时既没有文件也没有直传编号（这是调用方的 bug）", 400);
  return apiPost("/api/live2d-models", {
    bundleRef: form.bundleRef,
    bundleName: form.bundleName || undefined,
    name: form.name,
    description: form.description ?? "",
    coverImageUrl: form.coverImageUrl ?? "",
    tags: form.tags ?? [],
    shared: Boolean(form.shared),
    personaId: form.personaId || undefined,
    voice: form.voice ?? undefined,
    mapping: form.mapping ?? undefined,
    entry: form.entry || undefined,
    selfMade: Boolean(form.selfMade),
  });
}

/**
 * 改映射（作者本人）。`null` = **恢复服务端的自动映射**，不是"清空映射"——
 * 传 `{}` 才是"所有槽位都不演"，两者差一个字、后果相反。服务端校验后重写包里的 companion.json。
 */
export function updateLive2dModelMapping(id: string, mapping: CompanionMappingWire | null): Promise<{ ok: true; model: Live2dModelItem; warnings: string[] }> {
  return apiPut(`/api/live2d-models/${encodeURIComponent(id)}`, { mapping });
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

// ── 创作中心：人格制作向导（/support/personas/new）──────────────────────
//
// 七步见 docs/digital-human-creator-center.md §4.3：基本设定 → 素材 → 问卷 → 生成 → 试聊 → 微调 → 发布。
// ★ analyze 与 generate **刻意分成两步**：第 5 步「整体再来一版」只重跑 generate，不重读素材（素材可能有几万字，
//   重读一遍既慢又多烧一次限流额度）。素材不落库、不公开。
// ★ 服务端限流：analyze / generate 各 5 次/分钟，preview-chat 20 次/分钟 —— 429 一律翻成
//   companionErrorText 那句「操作太频繁了，稍等几秒再试。」

/** 人格卡的风格段。前四项是老字段，后五项是向导生成的（老数据没有 → 一律判否定） */
export interface PersonaStyle {
  summary: string;
  catchphrases: string[];
  stats: Array<{ key: string; label?: string; value?: number; grade?: string }>;
  stanceHint: string;
  /** 语气一句话 */
  tone?: string;
  /** 怎么称呼用户 */
  addressUser?: string;
  /** 开场白 */
  greeting?: string;
  /** 3~8 组示例对话，服务端当 few-shot 轮次注入（≤12 组，各 ≤300 字） */
  examples?: Array<{ user: string; reply: string }>;
  /** 这个人格自己的边界（"不聊前任"）；平台安全条款不在这里，服务端固定注入 */
  boundaries?: string[];
}

/** `POST /generate` 回的草稿（**不落库**，落库要再调 createPersona） */
export interface PersonaDraft {
  name: string;
  description: string;
  coverEmoji: string;
  tags: string[];
  style: PersonaStyle;
}

/** `POST /analyze` 回的素材分析。原样带回 generate（服务端按同一形状收） */
export interface PersonaAnalysis {
  catchphrases: string[];
  /** sentenceLength / punctuation / emoji / particles / tone，值都是整句人话 */
  habits: Record<string, string>;
  stances: string[];
  topics: string[];
  avoids: string[];
  /** 3~6 段代表性原话（服务端已做隐私改写） */
  samples: string[];
}

export type PersonaMaterialKind = "chat" | "posts" | "notes";
export interface PersonaMaterial {
  kind: PersonaMaterialKind;
  /** ≤60000 字；一次最多 10 条，合计也是 ≤60000 */
  text: string;
}

/** 第 1 步的基本设定 */
export interface PersonaBasics {
  name?: string;
  /** 定位：陪聊 / 客服 / 老师 / 角色扮演 / 自定义 */
  role?: string;
  /** 与用户的关系 */
  relation?: string;
  intro?: string;
  addressUser?: string;
}

/**
 * 第 3 步问卷的键（服务端 `personaAi.service` 的 QUESTIONNAIRE_LABELS 认得这些；≤30 项，键 ≤40 字）。
 * ★ 键名列在这里是为了**一处实现**：向导的表单与这里发出去的 body 用同一份名字，
 *   拼错一个键服务端不会报错（record 收任意键），只会安静地少喂模型一项。
 */
export const PERSONA_QUESTION_KEYS = [
  "extroversion",
  "rationality",
  "formality",
  "humor",
  "talkative",
  "politeness",
  "emotional",
  "catchphrase",
  "addressUser",
  "language",
  "emoji",
  "taboos",
] as const;
export type PersonaQuestionKey = (typeof PERSONA_QUESTION_KEYS)[number];
/** 值：数字（滑杆）/ 字符串（自填）/ 布尔 / 字串数组（多选，各 ≤60 字、≤12 条） */
export type PersonaQuestionnaire = Partial<Record<PersonaQuestionKey, string | number | boolean | string[]>>;

/** 草稿里能单独重生成的字段（`only` 必须与 `draft` 一起发，否则服务端 400） */
export type PersonaDraftField =
  | "name"
  | "description"
  | "tags"
  | "summary"
  | "catchphrases"
  | "stanceHint"
  | "tone"
  | "addressUser"
  | "greeting"
  | "examples"
  | "boundaries";

export interface PersonaGenerateInput {
  /** 老入口：直接贴一段聊天记录（≥20 字，服务端校验层就拦） */
  chatText?: string;
  hint?: string;
  basics?: PersonaBasics;
  questionnaire?: PersonaQuestionnaire;
  analysis?: PersonaAnalysis;
  /** 只重生成这几个字段（「只换开场白」）；给了它就**必须**同时给 draft */
  only?: PersonaDraftField[];
  draft?: PersonaDraft;
}

/**
 * 第 2 步：素材 → 分析。5 次/分钟。
 * @param input `speaker` = 聊天记录里哪个昵称是"TA"（只取 TA 的话）
 */
export function analyzePersonaMaterials(input: {
  materials: PersonaMaterial[];
  speaker?: string;
}): Promise<{ ok: true; analysis: PersonaAnalysis; model: string; sampledChars: number }> {
  return apiPost("/api/personas/analyze", { materials: input.materials, speaker: input.speaker || undefined });
}

/**
 * 第 4 步：生成草稿（不落库）。5 次/分钟。
 * ★ `chatText` / `analysis` / `basics` **至少要有一个**，一个都没有服务端 400（这是它唯一的输入来源）。
 */
export function generatePersonaDraft(input: PersonaGenerateInput): Promise<{ ok: true; draft: PersonaDraft; model: string }> {
  return apiPost("/api/personas/generate", {
    chatText: input.chatText || undefined,
    hint: input.hint || undefined,
    basics: input.basics,
    questionnaire: input.questionnaire,
    analysis: input.analysis,
    only: input.only?.length ? input.only : undefined,
    draft: input.draft,
  });
}

/** 第 7 步：落库。★ `remixable` / `license` 服务端还没有（治理 P5），别发 —— z.object 默认 strip，发了也是静默丢掉 */
export interface PersonaCreateInput {
  name: string;
  description?: string;
  coverEmoji?: string;
  coverImageUrl?: string;
  tags?: string[];
  style?: PersonaStyle;
  shared?: boolean;
  /** 0~100000 积分，0 = 免费。App 内没有支付，付费人格只能在官网买 */
  price?: number;
  voice?: VoiceSettings | null;
}

export function createPersona(input: PersonaCreateInput): Promise<{ ok: true; persona: MarketPersona }> {
  return apiPost("/api/personas", {
    name: input.name,
    description: input.description ?? "",
    coverEmoji: input.coverEmoji || "🎭",
    coverImageUrl: input.coverImageUrl ?? "",
    tags: input.tags ?? [],
    style: input.style ?? {},
    shared: Boolean(input.shared),
    price: Math.max(0, Math.round(input.price ?? 0)),
    voice: input.voice ?? undefined,
  });
}

export interface PersonaPreviewHandlers {
  /** 逐句（带 [情绪][face][action] 演出标签 + TTS 参数），与客服页同一套演出协议 */
  onSentence?: (sentence: CompanionSentence) => void;
  onToken?: (token: string) => void;
  onDone?: (result: { text: string }) => void;
}

/**
 * 第 5 步：拿草稿试聊（SSE）。20 次/分钟；草稿随请求带上、不落库。
 * ★ 事件与 `/api/companion/chat` **逐字相同**（sentence / token / done / error），所以传输那一半直接走
 *   `api/stream.streamSseRequest`（客服页的 streamSupportChat 走的也是它）—— 不是抄一份，是同一份。
 * ★ `messages` ≤20 且**最后一条必须是 user**，不满足服务端 400。
 */
export async function streamPersonaPreviewChat(
  body: { draft: PersonaDraft; messages: Array<{ role: "user" | "assistant"; content: string }>; lang?: "zh" | "en" },
  handlers: PersonaPreviewHandlers,
  signal?: AbortSignal,
): Promise<void> {
  await streamSseRequest(
    "/api/personas/preview-chat",
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
      else if (event === "done") handlers.onDone?.({ text: String(payload.text ?? "") });
    },
    { signal, unsupported: "服务端还没有人格试聊（返回的不是事件流）" },
    ({ event, data }) => {
      if (event !== "error") return "";
      try {
        return String((JSON.parse(data) as { message?: string }).message || "试聊失败了，稍后再试。");
      } catch {
        return "试聊失败了，稍后再试。";
      }
    },
  );
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
