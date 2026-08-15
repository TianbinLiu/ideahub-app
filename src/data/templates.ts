// 视频模板库：模板 = 卡组 + 生成配方，套上之后一句话出片。
//
// 为什么单独一个库而不是塞进 account：模板是**可发布的社区内容**（有作者、有市场、
// 有互动数据），生命周期与"我的卡片/卡组"不同——我的卡组删了不影响别人装过的模板，
// 而模板发布后即使作者本地删掉，市场里那份也该继续可用。所以两边分开存。
//
// 互动数据（浏览/点赞/收藏/评论）不在这里，走 data/social.ts 的旁路存储。
import { idbGet, idbSet } from "./db";
import { apiGet, ApiError } from "../api/client";
import * as branch from "../api/branch";
import * as uploadsApi from "../api/uploads";
import { canAfford, currentUser, refreshRemoteWallet, tierBlockReason } from "./account";
import { blockoutTier, blockoutizeCost, blockoutizeIssue, fmtTokens } from "./economy";
import { toPermanentUrl } from "./publishAssets";
import { remoteOn } from "./videos";
import { Card, VideoAspect, VideoTemplate, uid } from "../types";

const KEY = "templates.v1";

let mine: VideoTemplate[] = [];
let version = 0;
const subs = new Set<() => void>();

function emit() {
  version++;
  for (const fn of subs) fn();
}

function persist() {
  void idbSet(KEY, mine);
}

export function subscribeTemplates(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function templatesVersion(): number {
  return version;
}

// ── 种子模板 ─────────────────────────────────────────────
// 市场首次打开不能是空的，否则用户根本不知道"模板"长什么样。两个种子刻意选了
// 两种极端用法：一个是"换人不换戏"（特摄剧那类），一个是纯氛围短片。
// 它们不带素材卡——卡组是套用时按用户那句话现铸的，种子只提供配方。
const SEEDS: VideoTemplate[] = [
  {
    id: "tpl_seed_tokusatsu",
    title: "特摄剧·换人出演",
    intro: "模仿上世纪特摄剧的画面质感与运镜，把主角换成你指定的任何人物。胶片颗粒、爆炸逆光、夸张定格。",
    cover: "/create/workflow.jpg",
    author: "IdeaHub",
    createdAt: Date.now() - 86400000 * 12,
    cards: [],
    recipe: {
      styleHint:
        "上世纪特摄剧质感：16mm 胶片颗粒、轻微掉色与色偏、实景微缩模型布景、硬光高对比、逆光烟雾、镜头轻微晃动与变焦推拉，画面 4:3 安全框构图。人物动作夸张有停顿感，转身/摆架势时有明显定格。禁止现代数码感与柔光。",
      beats: [
        "{{主题}}在废弃工厂前摆出登场架势，背后爆炸腾起橙红火光，镜头从低角度快速推近，逆光下轮廓分明。",
        "{{主题}}侧身翻滚躲开落下的钢梁，起身后握拳定格，烟尘在硬光里翻涌，镜头轻微晃动。",
      ],
      durationSec: 5,
      videoTier: "hd",
      framePrompt:
        "{{主题}}的全身特摄剧风格定妆画面，废弃工厂布景，逆光烟雾，16mm 胶片颗粒，硬光高对比，4:3 构图，无文字无水印。",
    },
    source: "参考画面特征：高对比硬光、胶片颗粒、微缩布景、爆炸逆光、夸张定格动作。",
    published: true,
  },
  {
    id: "tpl_seed_cozy",
    title: "治愈系·一日切片",
    intro: "柔光、浅景深、缓慢横移。适合把任何角色放进一段安静的生活片段。",
    cover: "/create/simple.jpg",
    author: "IdeaHub",
    createdAt: Date.now() - 86400000 * 5,
    cards: [],
    recipe: {
      styleHint:
        "治愈系日常动画质感：柔和自然光、浅景深、低饱和暖色调、细腻的空气感颗粒，镜头缓慢横移或轻微推近，never 快切。人物表情克制，动作幅度小。",
      beats: ["{{主题}}在窗边安静地做着手里的事，午后的光斜斜落进来，尘埃在光柱里浮动，镜头极缓地横移。"],
      durationSec: 5,
      videoTier: "std",
      framePrompt: "{{主题}}在窗边的柔光画面，治愈系日常动画风，浅景深，暖色调，空气感颗粒，无文字无水印。",
    },
    published: true,
  },
];

export async function readyTemplates(): Promise<void> {
  const saved = await idbGet<VideoTemplate[]>(KEY);
  if (saved) mine = saved;
  // ★ 这里以前给两个种子模板灌了一份假的浏览量/点赞（seedStats，2026-08-11 删）。
  //   假数字画在屏幕上与真互动长得一模一样，而同一个页面上还摆着服务端算的真热度 ——
  //   并排放一个编的和一个真的就是骗人（铁律八）。宁可从 0 开始。
  emit();
}

/** 我建的模板（含未发布的） */
export function myTemplates(): VideoTemplate[] {
  return mine;
}

export function getTemplate(id: string): VideoTemplate | null {
  return (
    mine.find((t) => t.id === id) ??
    SEEDS.find((t) => t.id === id) ??
    // 远端市场的模板（id = 服务端 _id）：详情页从市场点进来时靠这份缓存渲染
    shared.find((t) => t.id === id) ??
    null
  );
}

/**
 * 模板市场：本机已发布 + 种子 + **远端 shared**（白模模板；到货前先出本机那份）。
 *
 * ★ 「在不在远端上」只问 videos.remoteOn()（弹幕铁律同款，唯一开关）；「这台服务器
 *   认不认模板端点」在 ensureShared 里问 remoteTemplatesCapable（也是唯一实现）——
 *   本函数自己不另探任何一层。
 * ★ 远端列表是「懒加载 + 到货 emit」（videos.loadDetail 同款）：本函数保持同步，
 *   第一次调用触发后台拉取，到货后 emit，订阅方（市场页 useTemplatesVersion）自然重渲。
 * ★ 去重按 remoteId：我自己发布的白模模板在 shared 里也有一份（服务端视角它就是
 *   published），本机那份是正主（有本机 id、能进 OwnerBar），远端那份滤掉。
 */
export function browseTemplates(q = ""): VideoTemplate[] {
  if (remoteOn()) ensureShared();
  const remote = shared.filter((r) => !mine.some((m) => m.remoteId && m.remoteId === r.remoteId));
  const all = [...mine.filter((t) => t.published), ...SEEDS, ...remote];
  const kw = q.trim().toLowerCase();
  const list = kw
    ? all.filter((t) => (t.title + t.intro + t.recipe.styleHint).toLowerCase().includes(kw))
    : all;
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 这台服务器认不认「白模模板」这一套能力（上传 /api/uploads/template-video 与
 * 模板登记/市场端点是同一次服务端发布加的，一荣俱荣）。
 *
 * ★ 判据是**回包形状**（`ok:true` + `templates` 数组），绝不判状态码：Capacitor 的
 *   SPA 回退对未命中路径恒回 200 + HTML（apiGet 把 HTML 当字符串吐出来，形状不符）；
 *   老服务端对这条路径回 JSON 404（apiGet 抛，catch 成 false）。
 * ★ **唯一实现**（铁律六）：上传入口（VideoTemplateExtractor 的白模开关）与模板市场的
 *   远端区（browseTemplates 的远端合并，后续施工位）都必须问这一个函数，不许各探一次
 *   ——各探会出现"开关亮着、市场说没有"的半边天。
 * ★ 「在不在远端上」先问 videos.remoteOn()（全 app 只有那一处判断，弹幕铁律同款）；
 *   remoteOn 为假时**不缓存**结论——联网自愈（account.armOnlineRetry 那条路）之后
 *   再问要能重新探。
 * ★ **只缓存"服务器真实作答"的结论**：ApiError 且 status>0（老服务端回 JSON 404 之类）
 *   才是「这台服务器没这能力」；超时/断网（status 0 或非 ApiError）是瞬时故障，缓存它
 *   等于把一次弱网冷启动固化成"功能不存在"，整个会话入口都不渲染、还零提示——
 *   重启才能恢复（2026-08-14 对抗审查抓到的静默失败）。瞬时失败当场返回 false 但
 *   清掉缓存，下一次调用重探。
 */
let capProbe: Promise<boolean> | null = null;

export function remoteTemplatesCapable(): Promise<boolean> {
  if (!remoteOn()) return Promise.resolve(false);
  capProbe ??= apiGet<{ ok?: boolean; templates?: unknown }>("/api/branch/templates/shared", {
    query: { limit: 1 },
    timeoutMs: 8000,
  })
    .then((r) => r.ok === true && Array.isArray(r.templates))
    .catch((e) => {
      if (!(e instanceof ApiError) || e.status === 0) capProbe = null; // 瞬时：不缓存，下次重探
      return false;
    });
  return capProbe;
}

// ── 远端（白模模板的服务端实体）──────────────────────────
//
// 首发**只有白模模板**上服务端（经典配方照旧本机）：白模的参考视频本来就必须公网托管
// （方舟 r2v 只收 URL），服务端实体是它能被套用的前置，不是锦上添花；经典配方没有这个
// 硬前置，搬远端是另一个施工位的事，别顺手裹进来。
//
// 生命周期（服务端 status 是权威，本机 published 只是它的镜像）：
//   登记（POST，status=pending）→ 作者自己付费出一次片（服务端在 r2v 任务 succeeded 时
//   置 provenAt —— 试炼闸，客户端说"我跑通了"不作数）→ 发布（PATCH publish）→ 上市场。

/** 远端实体的状态快照（key = remoteId）。挂 map 不挂 VideoTemplate：types.VideoTemplate
 *  是三处（本机库/草稿快照/市场）共用的形状，把服务端才说得准的东西（status/provenAt/
 *  isOwner）塞进去，草稿里就会存下一份必然过时的复印件 */
export interface RemoteTemplateState {
  remoteId: string;
  status: "pending" | "published" | "blocked";
  /** 试炼闸：非空 = 作者本人用它真实出过一次片（发布的前置） */
  provenAt: number | null;
  /** 服务端按 ownerId 对当前 JWT 算的 —— 白模路的身份判定只认它，不比显示名 */
  isOwner: boolean;
  /**
   * 编号核对闸：true = 这个模板有角色位，但编号**还没被作者核对过**，服务端不许发布。
   *
   * ★★ 为什么这一位要单独存在于状态快照里、而不是塞进 `VideoTemplate.roles`：
   *   `roles` 是**出片时点名要用的数据**（label/desc 直接进提示词），而这一位是
   *   **模板的生命周期状态**（与 status/provenAt 同族，作者界面据它提示与拦截）。
   *   混在一起的话，套用侧每次拼提示词都要绕过一个与提示词无关的字段。
   * ★ V1 老模板（没有角色位）恒为 false —— 这道门与它无关（判存在性，别判等值）。
   */
  rolesNeedConfirm: boolean;
}

const remoteStates = new Map<string, RemoteTemplateState>();
/** 登记失败原因（key = 本机模板 id）。登记是 saveTemplate 之后的异步旁路，失败不能只进
 *  console —— 详情页据此显示原因并给「重新登记」（铁律八：响，且有出口） */
const registerErrors = new Map<string, string>();

/** 远端 shared 缓存与加载状态 */
let shared: VideoTemplate[] = [];
let sharedFresh = false;
let sharedLoading = false;
let sharedError = "";
/** 失败后的冷却（15s）：browseTemplates 每次渲染都会来问，不冷却就是失败风暴 */
let sharedRetryAt = 0;

function toMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function recordState(api: branch.ApiBranchTemplate): RemoteTemplateState | null {
  const rid = String(api._id ?? api.id ?? "");
  if (!rid) return null;
  const st: RemoteTemplateState = {
    remoteId: rid,
    // 判定写存在性/白名单而不是信任任意串：认不出的 status 当 pending（最保守的一档）
    status: api.status === "published" || api.status === "blocked" ? api.status : "pending",
    provenAt: toMs(api.provenAt ?? null),
    isOwner: api.isOwner === true,
    // ★ 逐条 `!== true`：只有服务端**明说**核对过才算数。老服务端不回这一位（undefined）
    //   → 判成"待核对"，界面会多提示一次；反过来把没核对的当成核对过，就是让作者
    //   带着一份可能指错人的编号上市场（错了零报错）。往多提醒那一侧退。
    rolesNeedConfirm: Array.isArray(api.roles) && api.roles.length > 0 && api.roles.some((r) => r?.labelConfirmed !== true),
  };
  remoteStates.set(rid, st);
  return st;
}

/**
 * 服务端回的角色位 → 本机镜像。**唯一实现**（远端列表、详情、白模化回包都走它）。
 *
 * ★ 逐字段兜底再进本机库：这是网络回包，`roles` 又是后加字段 —— 一个 label 变成
 *   `undefined` 混进去，出片时点名句里就会出现「编号 undefined」，模型不会报错，
 *   只会自己挑一个人换（换错人是零报错的故障）。没有 label 的条目直接丢掉。
 * ★ label **原样保留字符串**，不转数字、不重排、不补齐：实测编号稳定但**不连续**
 *   （一发四人实出 1/2/4/5），"规整成 1..N"就是把卡换到别人身上（types 的 ★★）。
 * @returns 空数组 = 这个模板没有角色位（V1 老模板）。调用方按**存在性**处理，
 *   别把空数组写进本机记录（写了之后"V1 还是 V2"在调试时就分不清了）。
 */
function rolesOf(api: branch.ApiBranchTemplate): NonNullable<VideoTemplate["roles"]> {
  if (!Array.isArray(api.roles)) return [];
  return api.roles
    .map((r) => ({ label: String(r?.label ?? "").trim(), desc: String(r?.desc ?? "").trim() }))
    .filter((r) => r.label !== "");
}

/** 服务端模板 → 本机领域模型。远端条目的 id 就用服务端 _id（详情页路由直接用它） */
function apiToTemplate(api: branch.ApiBranchTemplate): VideoTemplate | null {
  const rid = String(api._id ?? api.id ?? "");
  const refUrl = api.refVideo?.url;
  if (!rid || !refUrl) return null; // 没有参考视频的"白模模板"不成立，丢弃比展示半个强
  recordState(api);
  const roles = rolesOf(api);
  return {
    id: rid,
    remoteId: rid,
    title: api.title || "未命名模板",
    intro: api.intro || "",
    cover: api.coverUrl || "",
    author: api.authorName || "创作者",
    createdAt: toMs(api.createdAt ?? null) ?? Date.now(),
    cards: [], // 白模不带素材卡（提取时认不出，「换成谁」由套用者自己挂卡）
    recipe: {
      styleHint: api.recipe?.styleHint || "",
      beats: Array.isArray(api.recipe?.beats) ? api.recipe.beats : [],
      durationSec: Number(api.recipe?.durationSec) || 5,
      videoTier: api.recipe?.videoTier || "hd",
      aspect: api.recipe?.aspect,
      framePrompt: api.recipe?.framePrompt || "",
    },
    refVideo: {
      url: refUrl,
      durationSec: Number(api.refVideo?.durationSec) || 0,
      width: Number(api.refVideo?.width) || 0,
      height: Number(api.refVideo?.height) || 0,
    },
    // ★ 只在真有的时候才带这个键（存在性语义，见 rolesOf 与 types 的 ★）
    ...(roles.length > 0 ? { roles } : {}),
    published: api.status === "published",
  };
}

/** 市场远端区这一拍没到货/没到齐的原因（空串 = 一切正常）。市场页拿它明说，
 *  别让"远端拉挂了"伪装成"市场里就这么几个模板" */
export function sharedLoadIssue(): string {
  return sharedError;
}

/** 懒加载远端 shared（到货 emit）。能力探测走 remoteTemplatesCapable 唯一实现 */
function ensureShared(): void {
  if (sharedFresh || sharedLoading || Date.now() < sharedRetryAt) return;
  sharedLoading = true;
  void (async () => {
    try {
      if (!(await remoteTemplatesCapable())) {
        // 瞬时网络失败（探测没缓存结论，capProbe 被清）≠ 老服务端：前者要说出来并稍后
        // 自动重试，否则"远端拉挂了"伪装成"市场里就这么几个模板"（铁律八）
        if (remoteOn() && capProbe === null) {
          sharedError = "远端模板加载失败：网络不稳，稍后自动重试";
          sharedRetryAt = Date.now() + 15_000;
          emit();
        }
        return; // 真·老服务端：安静保持本机市场
      }
      const items = await branch.listSharedTemplates(50);
      shared = items.map(apiToTemplate).filter((t): t is VideoTemplate => t !== null);
      sharedFresh = true;
      sharedError = "";
      emit();
    } catch (e) {
      sharedError = `远端模板加载失败：${e instanceof Error ? e.message : String(e)}`;
      sharedRetryAt = Date.now() + 15_000;
      emit();
    } finally {
      sharedLoading = false;
    }
  })();
}

/** 这个模板的远端状态（没登记过 / 还没到货 = null）。远端条目与已登记的本机条目都走它 */
export function remoteStateOf(t: VideoTemplate): RemoteTemplateState | null {
  return t.remoteId ? (remoteStates.get(t.remoteId) ?? null) : null;
}

/**
 * 按 id 现取一个远端模板并塞进 shared 缓存（getTemplate 随之能查到，emit 触发重渲）。
 *
 * ★ 为什么存在：shared 缓存靠市场页懒加载，**直达详情路由**（会话恢复、未来的分享
 *   链接）时缓存是空的——不回源就对一个真实存在的已发布模板显示"不存在或已被删除"
 *   （2026-08-14 对抗审查抓到的撒谎路径）。
 * @returns false = 真不存在 / 取不到（调用方据此才许下"不存在"的结论）
 */
export async function fetchRemoteTemplateById(rid: string): Promise<boolean> {
  if (!remoteOn()) return false;
  try {
    const api = await branch.getRemoteTemplate(rid);
    if (!api) return false;
    const t = apiToTemplate(api);
    if (!t) return false;
    shared = shared.some((s) => s.remoteId === t.remoteId)
      ? shared.map((s) => (s.remoteId === t.remoteId ? t : s))
      : [t, ...shared];
    emit();
    return true;
  } catch {
    return false;
  }
}

/** 登记失败的原因（null = 没失败过或已成功）。详情页据此给「重新登记」按钮 */
export function registerIssueOf(id: string): string | null {
  return registerErrors.get(id) ?? null;
}

/**
 * 把本机白模模板**登记**到服务端（POST /api/branch/templates）。
 *
 * ★ 为什么登记必须发生在 saveTemplate 之后立刻、而不是等到发布：服务端 r2v 是
 *   「只准已登记模板 URL」（resolveR2v 反查不到就 400），而发布的前置又是作者先真实
 *   出过一次片（试炼闸）——不先登记，作者连自己都用不了，试炼闸就成了死锁。
 * ★ 封面是硬步骤：dataURL 走 publishAssets.toPermanentUrl（唯一实现）转成 https 再发
 *   （服务端 zod 拒 dataURL）。传不上去就整体失败并给重试 —— 静默用空封面上市场，
 *   作者只会以为市场坏了。
 * ★ 幂等：已有 remoteId 就只刷新状态。同一段视频重复登记服务端会 409（unique 索引），
 *   message 原样透传给用户。
 * @throws 失败时抛出，message 可直接显示；同时记进 registerErrors 供详情页展示
 */
export async function registerTemplate(id: string): Promise<void> {
  const t = mine.find((x) => x.id === id);
  if (!t) throw new Error("这个模板不在本机库里");
  if (!t.refVideo) throw new Error("经典配方模板首发只存本机，不需要登记到服务器");
  if (t.remoteId) {
    await refreshRemoteTemplate(id);
    return;
  }
  if (!remoteOn()) {
    const msg = "现在连不上服务器，模板暂时没登记——联网后在模板详情页点「重新登记」";
    registerErrors.set(id, msg);
    emit();
    throw new Error(msg);
  }
  try {
    const coverUrl = await toPermanentUrl(t.cover, `tpl-${t.id}-cover`);
    const api = await branch.createTemplate({
      title: t.title,
      intro: t.intro,
      coverUrl,
      recipe: t.recipe,
      videoUrl: t.refVideo.url,
    });
    const rid = String(api?._id ?? api?.id ?? "");
    if (!api || !rid) throw new Error("服务器没有返回模板登记信息（可能是旧版服务端），模板还没登记上");
    t.remoteId = rid;
    // ★ 登记值以服务端回的**规范化 secure_url** 为准回写镜像：resolveR2v 的反查是
    //   字符串等值匹配，本机若存着上传回执的原串而服务端存了规范串，出片会 400
    //   "地址与登记完全一致"。publicId 是本机回收句柄，服务端不回传，原样保留。
    if (api.refVideo?.url) {
      t.refVideo = {
        url: api.refVideo.url,
        durationSec: Number(api.refVideo.durationSec) || t.refVideo.durationSec,
        width: Number(api.refVideo.width) || t.refVideo.width,
        height: Number(api.refVideo.height) || t.refVideo.height,
        publicId: t.refVideo.publicId,
      };
    }
    recordState(api);
    registerErrors.delete(id);
    persist();
    emit();
  } catch (e) {
    registerErrors.set(id, e instanceof Error ? e.message : String(e));
    emit();
    throw e;
  }
}

/**
 * 刷新远端状态（GET /:id → 更新状态快照，并把本机 published 校准成服务端的说法）。
 * 详情页打开时、以及作者点「我已出过片，刷新状态」时调。失败静默降级为"用上次的快照"
 * —— 这是**读**路径，读失败还有旧值可看；写路径（发布/删除）失败必须响，别学这里。
 */
export async function refreshRemoteTemplate(id: string): Promise<void> {
  const t = getTemplate(id);
  if (!t?.remoteId || !remoteOn()) return;
  try {
    const api = await branch.getRemoteTemplate(t.remoteId);
    if (!api) return;
    const st = recordState(api);
    const local = mine.find((x) => x.id === id);
    if (local && st) {
      let dirty = false;
      const pub = st.status === "published";
      if (local.published !== pub) {
        local.published = pub;
        dirty = true;
      }
      // ★★ 角色位也跟着服务端走（白模 V2）：作者可能是在**另一台设备**上核对的编号。
      //   不同步的话，这台设备本机存的还是那份没核对过的猜测编号，而出片点名读的正是
      //   本机这份 —— 卡会挂到别人身上，且两边都不会报错。服务端那份永远是权威。
      const back = rolesOf(api);
      if (back.length && JSON.stringify(back) !== JSON.stringify(local.roles ?? [])) {
        local.roles = back;
        dirty = true;
      }
      if (dirty) persist();
    }
    emit();
  } catch (e) {
    console.warn(`[templates] 远端模板状态刷新失败 ${t.remoteId}:`, e);
  }
}

/**
 * 发布 / 取消发布 —— **唯一入口**（详情页别自己各调一遍 branch API）。
 * 经典配方照旧只翻本机布尔；白模走服务端（试炼闸在那边，400 的整句原样抛给界面）。
 * @throws message 可直接显示
 */
export async function setTemplatePublished(id: string, on: boolean): Promise<void> {
  const local = mine.find((x) => x.id === id);
  // ★ 本机没有 ≠ 不是我的：换设备/重装后本机库是空的，但服务端按 ownerId 算的
  //   isOwner 还在——此时作者必须仍能下架自己的模板（服务端端点本来就支持，
  //   没有这条路的话作废/侵权模板只能干挂在市场上，2026-08-14 对抗审查抓到）。
  //   shared 条目全是白模（apiToTemplate 丢弃无 refVideo 的），身份由服务端把关。
  const t = local ?? shared.find((x) => x.id === id);
  if (!t) throw new Error("这个模板不在本机库里");
  if (!t.refVideo) {
    updateTemplate(id, { published: on }); // 经典路：存量行为原样保留
    return;
  }
  if (!remoteOn()) throw new Error("现在连不上服务器——白模模板的市场在服务端，联网后再试");
  if (!t.remoteId) {
    const reg = registerErrors.get(id);
    throw new Error(reg ? `模板还没登记到服务器（${reg}）` : "模板还在登记中，稍等几秒再试");
  }
  const api = on ? await branch.publishTemplate(t.remoteId) : await branch.unpublishTemplate(t.remoteId);
  if (!api) throw new Error("这台服务器不支持模板发布（回包形状不对，可能需要升级服务端）");
  const st = recordState(api);
  t.published = st?.status === "published";
  if (local) persist(); // shared 条目只活在内存缓存里，没有本机库要写
  // 自己刚上/下架，市场缓存作废重取（别让作者切到市场 tab 还看见旧列表）
  sharedFresh = false;
  emit();
}

/**
 * 核对角色位编号 —— **唯一入口**（页面别自己调 branch API：本机镜像与远端状态要一起改）。
 *
 * ★★ 为什么非有这一步不可（这是白模 V2 最阴的一条错法）：白模化落库那一刻的 label 是
 *   **服务端按视觉清单顺序编的猜测**（1..N），而成片上人偶胸口的数字实测**稳定但不连续**
 *   （一发四人实出 1/2/4/5）。对不上时，套用者点"3 号位"挂上张三 —— 模型老老实实换掉
 *   画面上的 3 号（另一个人），**钱照扣、零报错**。所以编号只能由看得见画面的人确认。
 * ★ 提交的是**完整的那一份**（服务端整份替换）：作者可以改编号、改描述、删掉 AI 多认的
 *   一条、补上它漏认的一个。重复编号服务端整句 400（重了会让套用侧的挂卡互相覆盖）。
 * ★ 成功后**本机 roles 一起改写**：出片时点名用的就是本机这份（segmentGen 读 template.roles），
 *   只改远端的话，作者在这台设备上出的片仍然按旧编号点名 —— 那正是"改了却没生效"的
 *   零症状故障。
 * @throws message 可直接显示
 */
export async function confirmTemplateRoles(
  id: string,
  roles: NonNullable<VideoTemplate["roles"]>,
): Promise<void> {
  const local = mine.find((x) => x.id === id);
  // 本机没有 ≠ 不是我的（换设备/重装后本机库是空的，身份由服务端按 ownerId 把关），
  // 与 setTemplatePublished 同一条理由
  const t = local ?? shared.find((x) => x.id === id);
  if (!t) throw new Error("这个模板不在本机库里");
  if (!t.remoteId) throw new Error("模板还没登记到服务器，登记成功后才能核对编号");
  if (!remoteOn()) throw new Error("现在连不上服务器——编号登记在服务端，联网后再核对");
  const clean = roles
    .map((r) => ({ label: String(r.label ?? "").trim(), desc: String(r.desc ?? "").trim() }))
    .filter((r) => r.label !== "");
  if (!clean.length) throw new Error("至少要留一个角色位——一个都不留的话，套用你模板的人没有任何地方可以挂卡");
  const api = await branch.patchTemplateRoles(t.remoteId, clean);
  if (!api) {
    throw new Error("这台服务器还不支持核对角色位编号（回包形状不对，可能需要升级服务端）");
  }
  recordState(api);
  // ★ 以**服务端回的那一份**为准写本机（不是回显我们提交的 clean）：服务端会 trim、
  //   截断超长描述，两边不一致时出片点名用的串就与模板上登记的对不上了
  const back = rolesOf(api);
  if (back.length) {
    t.roles = back;
    if (local) persist(); // shared 条目只活在内存缓存里，没有本机库要写
  }
  emit();
}

/**
 * 删除 —— 白模先删远端（服务端连带回收 Cloudinary 视频），成功了才删本机。
 * 顺序不能反：先删本机的话远端失败就成了"本机看不见、市场还挂着"的孤儿，
 * 而 remoteId 已经跟着本机记录一起没了，再也删不掉。
 * ★ **没登记上的白模模板**（remoteId 缺省但 publicId 在）走孤儿回收端点：
 *   DELETE 模板的级联只覆盖已登记实体，这条缝不收口，"登记一直失败→用户删掉"
 *   之后那段托管视频两端都没了句柄（2026-08-14 对抗审查抓到的泄漏路径）。
 * @throws message 可直接显示；抛出时本机记录**原样保留**（可重试）
 */
export async function deleteTemplateEverywhere(id: string): Promise<void> {
  const t = mine.find((x) => x.id === id);
  if (!t) {
    // 本机没有但 shared 缓存里有 = 换设备的作者在删自己的远端模板（身份由服务端把关，
    // 非 owner 的请求服务端会 403）。删成即从缓存摘掉，别等下一次懒加载才消失。
    const remote = shared.find((x) => x.id === id);
    if (!remote?.remoteId) return;
    if (!remoteOn()) throw new Error("现在连不上服务器——联网后再删");
    const landed = await branch.deleteRemoteTemplate(remote.remoteId);
    if (!landed) throw new Error("这台服务器不支持删除模板（回包形状不对，可能需要升级服务端）");
    remoteStates.delete(remote.remoteId);
    shared = shared.filter((x) => x.id !== id);
    sharedFresh = false;
    emit();
    return;
  }
  if (t.refVideo && t.remoteId) {
    if (!remoteOn()) {
      throw new Error("现在连不上服务器——这个模板在服务端还有登记（含托管的视频），联网后再删");
    }
    const landed = await branch.deleteRemoteTemplate(t.remoteId);
    if (!landed) throw new Error("这台服务器不支持删除模板（回包形状不对，可能需要升级服务端）");
    remoteStates.delete(t.remoteId);
    sharedFresh = false;
  } else if (t.refVideo?.publicId) {
    // 传上去了、从没登记成：托管视频的唯一句柄就在本机这条记录里，删记录前必须先回收
    if (!remoteOn()) {
      throw new Error("现在连不上服务器——这个模板的视频还托管在云端，联网后再删（否则它会变成删不掉的孤儿）");
    }
    await uploadsApi.deleteTemplateVideo(t.refVideo.publicId);
    registerErrors.delete(id);
  }
  deleteTemplate(id);
}

export interface NewTemplate {
  title: string;
  intro: string;
  cover: string;
  cards: Card[];
  recipe: VideoTemplate["recipe"];
  source?: string;
  /**
   * 白模参考视频 —— **服务端登记值的镜像**（/api/uploads/template-video 回执，
   * 见 types.VideoTemplate.refVideo 的 ★）。只有上传硬门全过之后才许带上：
   * 没有公网 URL 的"白模模板"连作者自己都用不了（方舟 r2v 只收 URL），存半成品是骗人。
   */
  refVideo?: VideoTemplate["refVideo"];
  /** 白模人偶的角色位（服务端登记值的镜像）。只有白模化那条路（V2）会带 */
  roles?: VideoTemplate["roles"];
  /**
   * **服务端已经建好了**这个模板（白模化那条路：blockoutize 一次性出片 + 转存 + 建库，
   * 回包里就带着实体）。带上它意味着两件事：
   *   ① 本机记录直接带 remoteId 落库（市场去重、发布/删除都靠它）；
   *   ② **跳过 registerTemplate** —— 那是 V1「本机先有、再补登记」那条路专用的，
   *      对着一个已经存在的实体再 POST 一次只会撞 refVideo.url 的唯一索引拿 409。
   */
  remoteId?: string;
}

export function saveTemplate(t: NewTemplate): VideoTemplate {
  const tpl: VideoTemplate = {
    id: uid("tpl"),
    ...t,
    author: currentUser()?.name ?? "我",
    createdAt: Date.now(),
    // 白模模板也从未发布起步：发布要走服务端的试炼闸（作者先用它真实出过一次片），
    // 那是后续「分享侧」的流程，这里只落本机
    published: false,
  };
  mine = [tpl, ...mine];
  persist();
  emit();
  // ★ 白模模板存完立刻登记到服务端（异步旁路，不挡提取器的成功画面）：
  //   服务端 r2v 只认**已登记**模板 URL（resolveR2v 反查不到就 400），不登记的话
  //   作者连自己的试炼片都出不了。失败不静默——registerTemplate 会把原因记进
  //   registerErrors 并 emit，详情页显示原因 + 「重新登记」；这里 catch 掉的只是
  //   "重复上报"（错误本体已经落在 registerErrors 里了），不是把错误吞掉。
  if (tpl.refVideo && !tpl.remoteId) {
    void registerTemplate(tpl.id).catch(() => {});
  }
  return tpl;
}

// ── 白模化（V2：任意视频 → 带编号白模模板）──────────────────────
//
// 与 V1（作者自己已经有白模预演视频 → 上传 → 登记）是两条进货渠道，最大的差别是
// **这一条花真钱**：服务端要看几帧列出画面里有谁，再付费出一次 r2v edit 片把人全换成
// 带编号的白模人偶，产物转存之后才是模板。所以这里的每一步都按"钱已经动了"来写。

/**
 * 白模化那一步「先看」会看几帧 —— **服务端 `routes/branchTemplate.routes.js` 的
 * `VISION_FRAMES` 的跨仓镜像**（今天是 3）。
 *
 * ★★ 它是**报价的输入**（`economy.blockoutizeCost(frameCount, durSec)` 的前一半）。
 *   猜一个数就是本仓头号事故的形状：页面按 6 帧报价、服务端按 3 帧扣钱，两个方向都不报错。
 *   服务端改了 `VISION_FRAMES` 就必须同步改这里（跨仓无法共码，契约见
 *   docs/api-contract.md「白模模板」）。
 * ★ 为什么帧数不进请求体：帧数决定花多少钱，收客户端报的数 = 让用户自己标价。
 */
export const BLOCKOUTIZE_VISION_FRAMES = 3;

/**
 * 「**这个账号**现在能不能开炼白模化」—— 全 app 唯一实现（null = 能，否则是一句
 * 直接可显示的整句原因）。入口（提取器的白模开关）与真正开炼那一步问的都是它。
 *
 * ★★ 为什么不能只问 `economy.blockoutizeIssue()`：那一个只回答**目录侧**的一半
 *   （闸门开没开、这一档有没有 r2v 价），它认不出"当前用户的套餐" —— economy 是纯目录，
 *   account 已经 import 它，反过来 import 会成环（Vite 下会拿到半初始化的模块）。
 *   而白模化**钉死走 SEEDANCE_2_5**，那正是 `paidOnly` 的那一档：免费套餐在服务端是
 *   403 PLAN_REQUIRED，而且**充值解决不了**（得换套餐）。
 * ★★ 2026-08-15 对抗审查抓到的形状就是这里：整条白模化路一次都没调过
 *   `account.tierBlockReason`（全仓唯一实现，另外四个出片入口都调了），于是免费用户
 *   传完一段最大 100MB 的视频、框完选段、读完报价，**点下去才在服务端吃 403** ——
 *   而在此之前他很可能已经为这件事充了值（充值对这道门一分钱都不管用）。
 *   所以这句话必须在**选文件之前**就说出口（见 VideoTemplateExtractor 的调用点）。
 * ★ 一条判据都没有新写：闸门/价目仍在 `economy.blockoutizeIssue`，套餐仍在
 *   `account.tierBlockReason`。本函数只是把两者接起来，让 UI 与开炼那一步问同一句话。
 * ★ 顺序是有意的（先目录后套餐）：闸门没开时说「暂未开放」比说「升级套餐后可用」诚实
 *   —— 闸都没开，升级了也照样用不了，那句话会把用户骗去付钱。
 * ★ 这**只是提示，不是安全边界**（同 tierBlockReason）：套餐未知时它一律放行，由服务端
 *   说了算 —— 宁可多打一次请求，也不能因为镜像慢半拍就把付费用户挡在自己买过的档位外。
 */
export function blockoutizeBlockReason(): string | null {
  const catalog = blockoutizeIssue();
  if (catalog) return catalog;
  const tier = blockoutTier();
  // catalog 为 null ⇒ tier 必然非空（blockoutizeIssue 的第一句就在拦 null）。
  // 这一行只为让类型闭合；真走到这里说明那两个函数分了叉
  return tier ? tierBlockReason(tier) : null;
}

/** 白模化的入参：编辑页框出来的那**四组数** + 已经传好的那段素材。 */
export interface BlockoutizeInput {
  /**
   * 原始素材的 Cloudinary public_id（`uploads.uploadTemplateVideo` 的回执）。
   *
   * ★ 这里收的是 **publicId 不是 File**：上传归宿主管（它手上才有那份回执，
   *   也只有它知道用户中途放弃时该不该回收 —— 见 VideoTemplateExtractor 的 close()）。
   *   本函数只做"提交四组数 → 拿回模板 → 落本机"这一段。
   */
  publicId: string;
  /** 选段起点（整数秒） */
  startSec: number;
  /** 选段时长（整数秒，窗口 [4,30] 由编辑页的 arkVideoRules.selectionIssue 把关） */
  durSec: number;
  /** 裁剪框（整数像素，相对原片**原始分辨率**，不是预览尺寸） */
  crop: { x: number; y: number; w: number; h: number };
  title: string;
  intro?: string;
  /** 封面（dataURL 或 https）。dataURL 会先转成永久地址再提交（服务端 zod 拒 dataURL） */
  cover?: string;
  /** 作者对画面的补充说明，服务端拼进「先看」那一步的提示词 */
  note?: string;
  aspect?: VideoAspect;
  /** 进度播报。这一步要等好几分钟，不报进度用户会以为死了 */
  onProgress?: (status: string) => void;
}

/**
 * 白模化**流程的唯一实现**：提交四组数 → 拿回模板 → 落本机（带 remoteId）。
 *
 * ★ 两道**花钱前**的门在这里问，一道都不许挪到后面：
 *   ① 这台服务器认不认这套端点 —— 复用 `remoteTemplatesCapable()`（唯一实现，不另探）；
 *   ② 这一发**这个账号**能不能开炼 —— `blockoutizeBlockReason()`（闸门 + 价目 + 套餐门禁，
 *      唯一实现）。报不出价就既不报也不开炼；套餐不够格就当场说清"充值不管用，要换套餐"。
 *      ★ 提取器在**选文件之前**已经问过同一句（那才是止损最早的时机），这里再问一次不是
 *        第二处判断 —— 是同一个函数的第二个调用点：浮层开着的这几分钟里套餐可能刚变
 *        （换账号、镜像到货），而这一步之后就要真花钱了。
 *   ★ **框选窗口（F1/F3）不在这里判**：客户端那一份的唯一实现是编辑页的
 *     `components/blockout/arkVideoRules.selectionIssue`（它要说"差多少、往哪拖"，
 *     离裁剪框近才说得出来），服务端还会对着裁后元数据现查复核。在这里再抄一份，
 *     两份一起漂时没有任何症状。而且窗口不满足是 **400 且 billed:false** ——
 *     不涉及钱，不需要客户端多设一道闸。
 * ★ 不做真人脸门禁：浏览器 FaceDetector 覆盖率极低，漏报比不检查更坏。开炼前那句
 *   「含真人面孔时 AI 可能受理后才拒绝、费用不退」由 BlockoutTrimmer 常驻告知（方案 §三），
 *   这里只负责把服务端回的 `billed` 原样带给调用方（branch.BlockoutizeError）。
 * @throws message 可直接显示；`branch.BlockoutizeError` 还带一位 `billed`
 */
export async function blockoutizeTemplate(o: BlockoutizeInput): Promise<VideoTemplate> {
  const prog = (s: string) => o.onProgress?.(s);
  if (!remoteOn()) throw new Error("现在连不上服务器——白模化整条都在服务端跑（看帧、出片、转存），联网后再来");
  if (!(await remoteTemplatesCapable())) {
    throw new Error("这台服务器还不支持白模化（可能需要升级服务端）——你仍然可以直接上传一段白模预演视频来建模板");
  }
  const priced = blockoutizeBlockReason();
  if (priced) throw new Error(priced);
  // ③ 余额够不够。★ 服务端也会判（402 INSUFFICIENT_TOKENS，一分钱没动），这里再判一次
  //   不是为了安全，是为了**时机**：走到这一步用户已经传完一段最大 100MB 的视频、
  //   框了半天选段，这时候才告诉他"钱不够"太晚了。判据仍只有 account.canAfford 一处。
  const cost = blockoutizeCost(BLOCKOUTIZE_VISION_FRAMES, Math.round(o.durSec));
  // cost === null ⇒ economy.blockoutizeIssue 必然非空（那对函数一一对应，见 economy 的 ★）
  // ⇒ blockoutizeBlockReason 也非空（它把前者当第一道），上面那道门已经拦过 ——
  // 这句只为让类型闭合；真走到这里说明那几个函数分了叉
  if (cost === null) throw new Error("白模化暂时报不出价，先不开炼（价目未就绪）");
  if (!canAfford(cost)) {
    throw new Error(
      `这一发白模化预估要 ${fmtTokens(cost)} token（看帧认人 + 一次真实付费出片），余额不够——去「我的」页充值后再回来，框选不会丢。`,
    );
  }

  let coverUrl = "";
  if (o.cover) {
    prog("上传封面…");
    coverUrl = await toPermanentUrl(o.cover, `tpl-blockout-${Date.now()}-cover`);
  }

  prog("AI 正在看画面里有哪些人，然后把他们换成带编号的白模人偶（要几分钟，别退出）…");
  let res: branch.BlockoutizeResult;
  try {
    res = await branch.blockoutizeTemplate({
      publicId: o.publicId,
      // ★ 整数秒/整数像素在这里取一次整，别指望服务端替你四舍五入（它的 zod 声明是 int，
      //   小数直接 400）。取整口径与服务端一致（Math.round）。
      startSec: Math.round(o.startSec),
      durSec: Math.round(o.durSec),
      crop: {
        x: Math.round(o.crop.x),
        y: Math.round(o.crop.y),
        w: Math.round(o.crop.w),
        h: Math.round(o.crop.h),
      },
      title: o.title.trim() || "未命名白模模板",
      intro: o.intro ?? "",
      coverUrl,
      // ★ 只是**展示镜像**：走哪一档由服务端钉死，这里报的是 App 侧同一条链路认的那一档
      //   （economy.blockoutTier 唯一实现），好让模板详情页显示的档位与报价对得上。
      videoTier: blockoutTier()?.id ?? "",
      ...(o.aspect ? { aspect: o.aspect } : {}),
      note: o.note ?? "",
    });
  } finally {
    // ★★ **成败都刷**余额镜像，而且是无条件的（原来只挂在成功路径上，2026-08-15
    //   对抗审查抓到）：这条路最典型的失败恰恰是**扣了钱的** —— 真人脸受理后 failed、
    //   产物转存失败、看帧之后 r2v 没发出去，服务端对这几条都明说 `billed:true`。
    //   不刷的话，用户看到的还是白模化之前那个**虚高**的本地余额，照它再开一发，
    //   下一次要么在服务端撞 402，要么白等几分钟 —— 而这中间没有任何一处会报错。
    // ★ 为什么不写成"只在 billed 为真时刷"：客户端根本判不准。超时那一条报的是
    //   `billed:false`（我们确实不知道），而服务端很可能已经跑完并计费（见 branch.ts
    //   那句超时文案的 ★）。刷余额是只读的、不花钱、不改本地状态，往"多刷一次"的方向
    //   退永远安全；往"少刷一次"退就是拿一个假余额继续做决定。
    // ★ 放 finally 而不是 catch：成功路径本来就要刷（服务端刚扣过看帧 + 一次真实出片），
    //   两处各写一遍就是同一条规则的两份实现（铁律六）。
    // ★ fire-and-forget，且**故意不 await**：它自己不会抛（内部 catch 成 emitApiError），
    //   拉不到就是镜像停在旧值 —— 与修这一条之前的状态一样，不是新的退步。真正拦住
    //   "拿假余额再开一发"的最后一道仍在服务端（402）。这里不能 await，否则一次慢网
    //   的余额请求会把真正的失败原因（下面那个 throw）在界面上拖后好几秒。
    void refreshRemoteWallet();
  }

  const mapped = apiToTemplate(res.template);
  if (!mapped?.remoteId) {
    throw new Error(
      "白模化跑完了，但服务器返回的模板缺少参考视频地址——这次很可能已经计费，请去「我的模板」确认后再决定要不要重来。",
    );
  }
  prog("白模模板已生成");
  return saveTemplate({
    title: mapped.title,
    intro: mapped.intro,
    cover: mapped.cover,
    cards: [], // 白模不带素材卡：「换成谁」由套用者在编辑页逐个角色位挂
    recipe: mapped.recipe,
    refVideo: mapped.refVideo,
    ...(mapped.roles?.length ? { roles: mapped.roles } : {}),
    remoteId: mapped.remoteId,
  });
}

export function updateTemplate(id: string, patch: Partial<Pick<VideoTemplate, "title" | "intro" | "cover" | "published">>): void {
  const t = mine.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  persist();
  emit();
}

export function deleteTemplate(id: string): void {
  mine = mine.filter((t) => t.id !== id);
  persist();
  emit();
}

/** 把配方里的 {{主题}} 换成用户那句话 */
export function fillBeat(text: string, subject: string): string {
  return text.replace(/\{\{\s*主题\s*\}\}/g, subject.trim() || "主角");
}
