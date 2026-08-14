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
import { currentUser } from "./account";
import { toPermanentUrl } from "./publishAssets";
import { remoteOn } from "./videos";
import { Card, VideoTemplate, uid } from "../types";

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
  };
  remoteStates.set(rid, st);
  return st;
}

/** 服务端模板 → 本机领域模型。远端条目的 id 就用服务端 _id（详情页路由直接用它） */
function apiToTemplate(api: branch.ApiBranchTemplate): VideoTemplate | null {
  const rid = String(api._id ?? api.id ?? "");
  const refUrl = api.refVideo?.url;
  if (!rid || !refUrl) return null; // 没有参考视频的"白模模板"不成立，丢弃比展示半个强
  recordState(api);
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
      const pub = st.status === "published";
      if (local.published !== pub) {
        local.published = pub;
        persist();
      }
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
  if (tpl.refVideo) {
    void registerTemplate(tpl.id).catch(() => {});
  }
  return tpl;
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
