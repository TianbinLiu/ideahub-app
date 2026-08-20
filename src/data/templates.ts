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
// ★ 直接 import arkClient 而不是 ai/index：那一层是**真/假实现的开关**（没配 key 就走
//   mock），而白模化整条链路本来就只在"真的有服务端"时才存在（remoteOn + 能力探测
//   两道门）。轮询一个真实存在的方舟任务没有 mock 版本可言，走开关只会平添一层空实现。
import { fetchArkTask } from "../ai/arkClient";
import { canAfford, currentUser, refreshRemoteWallet, tierBlockReason } from "./account";
import { blockoutTier, blockoutizeCost, blockoutizeIssue, fmtTokens } from "./economy";
import { toPermanentUrl } from "./publishAssets";
import { remoteOn } from "./videos";
import { Card, MarkBox, MarkScheme, VideoAspect, VideoTemplate, uid } from "../types";

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

// ── 种子模板：**2026-08-17 整块删掉** ────────────────────────────────
// 原来这里硬编码着两个 `tpl_seed_*`（特摄剧·换人出演 / 治愈系·一日切片），理由是
// "市场首次打开不能是空的"。删掉的理由比它硬：
//  ① 它们**不是白模模板**（没有 refVideo），点「用它出片」走的是经典配方那条老路，
//     而这一版整个产品的重心是白模挂卡 —— 摆在市场第一屏的两个样板，教的是另一件事；
//  ② 它们恒被 push 进市场、**不受 remoteOn / 能力探测影响**：服务端市场整个挂掉时
//     页面上仍有两个模板可点，看起来像市场是好的（唯一的提示是那条 sharedLoadIssue 横幅）；
//  ③ 它们的 `published: true` 是写死的常量，与服务端状态机无关 —— 而下架/删除这一版
//     刚刚成为用户能做的事，一个谁都下架不了、删不掉的条目会立刻变成"这两个怎么弄不掉"。
// ⇒ 市场空的时候就**照实说空**（TemplateMarketPage 的空态文案已经跟着改成一句能行动的话）。
//   要样板就发真的：建一个真模板、发布它，与所有人走同一条路。

export async function readyTemplates(): Promise<void> {
  const saved = await idbGet<VideoTemplate[]>(KEY);
  if (saved) mine = saved;
  // ★ 这里以前给两个种子模板灌了一份假的浏览量/点赞（seedStats，2026-08-11 删）。
  //   假数字画在屏幕上与真互动长得一模一样，而同一个页面上还摆着服务端算的真热度 ——
  //   并排放一个编的和一个真的就是骗人（铁律八）。宁可从 0 开始。
  emit();
}

/** 我建的模板（含未发布的） */
/**
 * 拉一次「我在服务端的模板」。★ 与 ensureShared 同款：懒加载、到货 emit、失败 15s 冷却。
 * ★ 老服务端没有这条路由 → 抛 404 → 安静保持只有本机那份（**不显示成错误**：
 *   那是服务端能力问题，不是用户的模板没了）。
 */
function ensureMineRemote(): void {
  if (mineRemoteFresh || mineRemoteLoading || Date.now() < mineRemoteRetryAt) return;
  mineRemoteLoading = true;
  void (async () => {
    try {
      const items = await branch.listMyTemplates(50);
      mineRemote = items.map(apiToTemplate).filter((x): x is VideoTemplate => x !== null);
      mineRemoteFresh = true;
      emit();
    } catch {
      // ★ 不设 error 文案：这一屏本来就有本机那份可显示，一条红字只会让作者以为模板出事了。
      //   冷却 15s 之后自然重试（切 tab / 重渲染都会再问一次）。
      mineRemoteRetryAt = Date.now() + 15_000;
    } finally {
      mineRemoteLoading = false;
    }
  })();
}

/**
 * 我的模板 = **本机库** + **服务端上本机没有的那些**。
 *
 * ★★ 去重按 `remoteId`，**本机那份是正主**：它有本机 id、能进 OwnerBar、能就地编辑，
 *   而远端那份只是同一条模板的另一个视角。反过来（远端优先）会让作者在自己
 *   做过模板的那台设备上，点进去看到一个没有本机 id 的只读副本。
 * ★ 没有 remoteId 的本机记录（登记失败/从没登记）**照样在列**：它们的云端视频句柄
 *   只存在本机这一条里，从列表里藏起来就等于泄漏一份谁都删不掉的资产。
 */
export function myTemplates(): VideoTemplate[] {
  if (remoteOn()) ensureMineRemote();
  const extra = mineRemote.filter((r) => !mine.some((m) => m.remoteId && m.remoteId === r.remoteId));
  return extra.length ? [...mine, ...extra].sort((a, b) => b.createdAt - a.createdAt) : mine;
}

/**
 * 「这一条在**本机库**里吗」—— 与 `myTemplates()` 有意分开的一个更窄的问题。
 *
 * ★★ 为什么必须单独有它（2026-08-17 修一个自己造的静默故障）：`myTemplates()` 从
 *   加了 `mineRemote` 那一刻起就是**并集**（本机 + 服务端上本机没有的那些），
 *   而详情页的 `inMine` 一直是用 `myTemplates().some(...)` 算的。于是换设备/重装后：
 *     · 「这台设备上没有它的本机记录（换了设备？）」那句话**永远不再显示**；
 *     · 标题/简介输入框与「保存」照常渲染，而 `updateTemplate` 在 `mine` 里找不到就
 *       **静默 return** —— 点保存什么都不会发生，零报错。
 *   那正是那段注释当初要防的「保存了却什么都没发生的假按钮」，被并集悄悄破坏了。
 * ★ 判据只问 `mine`：能被 `updateTemplate` 写到的**就只有这一份**。谁把它改成
 *   `myTemplates()`，症状就是上面那两条，且照样零报错。
 * ★ 与 `OwnerRow` 的 `isMine`（"是不是我的"）不是一个问题：那一个问归属（并集里就算），
 *   这一个问"改得动吗"。两处措辞相近但语义不同，别合并。
 */
export function hasLocalTemplate(id: string): boolean {
  return mine.some((t) => t.id === id);
}

export function getTemplate(id: string): VideoTemplate | null {
  return (
    mine.find((t) => t.id === id) ??
    // ★ 我在服务端的那份（本机没有的那些）：从「我的模板」点进详情页靠它渲染
    mineRemote.find((t) => t.id === id) ??
    // 远端市场的模板（id = 服务端 _id）：详情页从市场点进来时靠这份缓存渲染
    shared.find((t) => t.id === id) ??
    null
  );
}

/**
 * 模板市场：本机已发布 + **远端 shared**（白模模板；到货前先出本机那份）。
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
  // ★ 种子那一份 2026-08-17 删了（见文件上方那段）：市场 = 本机已发布 + 远端已发布，
  //   两者都真的走过服务端的发布状态机，也都能被作者自己下架/删掉。
  const all = [...mine.filter((t) => t.published), ...remote];
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
   * 标记核对闸：true = 这个模板有角色位，但标记（颜色/编号）**还没被作者核对过**，
   * 服务端不许发布。
   *
   * ★★ 为什么这一位要单独存在于状态快照里、而不是塞进 `VideoTemplate.roles`：
   *   `roles` 是**出片时点名要用的数据**（label/desc 直接进提示词），而这一位是
   *   **模板的生命周期状态**（与 status/provenAt 同族，作者界面据它提示与拦截）。
   *   混在一起的话，套用侧每次拼提示词都要绕过一个与提示词无关的字段。
   * ★ V1 老模板（没有角色位）恒为 false —— 这道门与它无关（判存在性，别判等值）。
   */
  rolesNeedConfirm: boolean;
  /** 服务端还允许**重新识别角色位**吗（= 没有任何一条已核对）。
   *  ★ 与服务端那道闸同源，**不是** `!rolesNeedConfirm`（理由写在赋值处）。 */
  rolesRedetectable: boolean;
}

const remoteStates = new Map<string, RemoteTemplateState>();
/** 登记失败原因（key = 本机模板 id）。登记是 saveTemplate 之后的异步旁路，失败不能只进
 *  console —— 详情页据此显示原因并给「重新登记」（铁律八：响，且有出口） */
const registerErrors = new Map<string, string>();

/** 远端 shared 缓存与加载状态 */
/**
 * 「我在**服务端**的模板」缓存 —— 与本机库 `mine` 是两份，合并由 `myTemplates()` 做。
 *
 * ★★ 为什么必须有它：本机库只装"这台设备上做过的"。换设备/重装/清数据之后它是空的，
 *   而服务端那些模板还在（还占着云端资产、只有作者本人有权删）。没有这一份的话，
 *   作者在新设备上看到的是"我一个模板都没有" —— 不是"加载失败"，是压根不出现。
 * ★ 与 `shared` 完全同构（懒加载 + 到货 emit + 15s 冷却），因为它们是同一类东西：
 *   服务端上的一份清单，本机只是缓存。别为它另发明一套加载状态。
 */
let mineRemote: VideoTemplate[] = [];
let mineRemoteFresh = false;
let mineRemoteLoading = false;
let mineRemoteRetryAt = 0;

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
    // ★★ 与服务端 detect-roles 那道闸**逐字同源**：只要有**任何一条**已核对，重认就会被 400
    //   拒（重认会把作者一条条改过的措辞整份冲掉）。
    // ⚠ **不能用 `!rolesNeedConfirm` 取反**：那一位问的是“有没有没核对的”，
    //   两者在**部分核对**时同时为真 —— 那时取反会让 App 摆出一颗服务端必拒的按钮，
    //   而它写着价钱。（今天 PATCH /roles 是整份置 true，走不到部分核对；
    //   但判据该按服务端那句写，不该按“今天刚好走不到”写。）
    rolesRedetectable: !(Array.isArray(api.roles) && api.roles.some((r) => r?.labelConfirmed === true)),
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
 * ★ label **原样保留字符串**，不转数字、不重排、不补齐：颜色方案下它是色名（"绿色"），
 *   编号方案下实测稳定但**不连续**（一发四人实出 1/2/4/5），两种形态"顺手规整"
 *   都是把卡换到别人身上（types 的 ★★）。
 * @returns 空数组 = 这个模板没有角色位（V1 老模板）。调用方按**存在性**处理，
 *   别把空数组写进本机记录（写了之后"V1 还是 V2"在调试时就分不清了）。
 */
function rolesOf(api: branch.ApiBranchTemplate): NonNullable<VideoTemplate["roles"]> {
  if (!Array.isArray(api.roles)) return [];
  return api.roles
    .map((r) => ({ label: String(r?.label ?? "").trim(), desc: String(r?.desc ?? "").trim() }))
    .filter((r) => r.label !== "");
}

/**
 * 服务端回的那份序数清单 → 本机镜像。**唯一实现**（模板与白模化凭据两条路都走它）。
 *
 * ★★ 逐字段重建是这一层的既定做法，而这一位又**恰恰是方案判据本身** —— 漏在这里
 *   没有任何症状：模板照样能打开、照样能挂卡，只是被判成编号方案，套用时写出
 *   `编号最左边=凛`。所以它必须与 `rolesOf` 并排、被同一批调用点问到（apiToTemplate、
 *   refreshRemoteTemplate 的两条回写路、jobOf）。
 * ★ 顺序**原样保留**：这份数组的下标就是"画面上从左到右第几个"，而套用提示词的升序
 *   排序取的正是 `indexOf`。在这里 sort / dedupe / 补齐都等于改写那条承重规则。
 * @returns 空数组 = 编号方案（存量老模板 / 老服务端）。调用方按**存在性**处理。
 */
function markSlotsOf(api: { markSlots?: unknown }): NonNullable<VideoTemplate["markSlots"]> {
  if (!Array.isArray(api.markSlots)) return [];
  return api.markSlots.map((s) => String(s ?? "").trim()).filter((s) => s !== "");
}

/**
 * 服务端回的那份画面位置框 → 本机镜像（归一化 0~1000）。
 *
 * ★★ **长度必须与 `markSlots` 相等**，否则整份丢掉（回空数组 = 没有位置数据 = 挂卡面板
 *   退回点列表）。缺一个框就整层关掉，不许"能圈的圈上、剩下的靠列表"：局部可拖会让
 *   用户以为"这个人拖不了 = 坏了"，而挂错人是零报错的。
 * ★ 四个数任何一个不是有限数就算这一整份坏了 —— 半份框会让落点落在错的人身上，
 *   而那正是拖拽这条路唯一要防的事。
 */
function markBoxesOf(api: { markBoxes?: unknown }, slotCount: number): NonNullable<VideoTemplate["markBoxes"]> {
  if (!Array.isArray(api.markBoxes) || slotCount <= 0 || api.markBoxes.length !== slotCount) return [];
  const out: NonNullable<VideoTemplate["markBoxes"]> = [];
  for (const raw of api.markBoxes) {
    const b = raw as Record<string, unknown> | null;
    const cx = Number(b?.cx);
    const cy = Number(b?.cy);
    const w = Number(b?.w);
    const h = Number(b?.h);
    if (![cx, cy, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) return [];
    out.push({ cx, cy, w, h });
  }
  return out;
}

/**
 * 服务端那份 `markDescs` → 本机那一份。**长度必须与 `markSlots` 相等**，否则整份丢掉
 * （与 `markBoxesOf` 逐字同源的纪律：少一条就整份错位，而错位是零报错的）。
 *
 * ★★ 这一位与 `roles[].desc` **不是同一件事**（服务端 model 里写了完整理由）：
 *   · `roles[].desc` = 「这个位子**原来**是谁」，给作者核对、给套用者挑卡看；
 *   · `markDescs[i]` = 「**这段白模视频里**那个人偶什么样」，写进套用提示词给 r2v 指认。
 *   合成一位的后果当场就有：白模化（V2）那条路的 desc 来自**原片**，拼进提示词就是
 *   「从左数第2个（白发黑袍的少年）=阿岚」，而参考视频那个位置站着一个白人偶。
 * ★ 元素允许是空串 = 「这一条没通过唯一性自证」（服务端只认出个颜色）。空串**不拼括号** ——
 *   一句"7 个人里 6 个都符合"的话进提示词是纯噪音，2026-08-18 一发实拍验过。
 *   所以这里**不过滤空串**，原样留着（长度是承重的）。
 */
function markDescsOf(api: { markDescs?: unknown }, slotCount: number): string[] {
  if (!Array.isArray(api.markDescs) || slotCount <= 0 || api.markDescs.length !== slotCount) return [];
  const out = api.markDescs.map((d) => (typeof d === "string" ? d.trim() : ""));
  // 全是空串 = 一条都没验过，与"没有这一位"要做的事完全相同 —— 别在本机留一个
  // 看起来有、其实什么都不带的键（调试时分不清"老模板"和"这次一条都没验过"）
  return out.some((d) => d) ? out : [];
}

/**
 * 服务端那份 `realDurationSec` → 本机 refVideo 上的**可选键**（有才出，没有就一个键都不加）。
 * ★ 唯一实现：apiToTemplate 与 registerTemplate 的回写都走它 —— 两处各写一遍 `|| 0`
 *   的话，一处漏了就是"这台设备上的这个模板永远判不出坏"，而且不报错。
 */
function refRealSecKey(v: unknown): { realDurationSec?: number } {
  const n = Number(v);
  return typeof v === "number" && Number.isFinite(n) && n > 0 ? { realDurationSec: n } : {};
}

/** 服务端模板 → 本机领域模型。远端条目的 id 就用服务端 _id（详情页路由直接用它） */
function apiToTemplate(api: branch.ApiBranchTemplate): VideoTemplate | null {
  const rid = String(api._id ?? api.id ?? "");
  const refUrl = api.refVideo?.url;
  if (!rid || !refUrl) return null; // 没有参考视频的"白模模板"不成立，丢弃比展示半个强
  recordState(api);
  const roles = rolesOf(api);
  const markSlots = markSlotsOf(api);
  const markBoxes = markBoxesOf(api, markSlots.length);
  const markDescs = markDescsOf(api, markSlots.length);
  const boxAtSec = Number(api.markBoxAtSec);
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
      // ★ 服务端没给时长时这里是 0。**不再让它静默滑过去**：0 会被 refVideoIssue 判成
      //   "算不出套用要花多少钱"并整句拒绝报价 —— 以前它一路变成"参考视频 0s""约 0
      //   token"，用户点到方舟那儿才失败，全程零报错。
      durationSec: Number(api.refVideo?.durationSec) || 0,
      width: Number(api.refVideo?.width) || 0,
      height: Number(api.refVideo?.height) || 0,
      // ★★ 存在性透出，**绝不写 `Number(x) || 0`**：那会把"老服务端没有这个字段"和
      //   "真的是 0"压成同一个值，而两者的处置完全相反（缺 = 当好、0 = 坏得报不出价）。
      ...refRealSecKey(api.refVideo?.realDurationSec),
    },
    // ★ 只在真有的时候才带这个键（存在性语义，见 rolesOf 与 types 的 ★）
    ...(roles.length > 0 ? { roles } : {}),
    // ★★ 同一条存在性语义，但这一位是**方案判据本身**：写成 `markSlots: markSlots`
    //   （空数组也带上）的话，`isOrdinalMark` 仍然判否（它数的是 length），但本机记录里
    //   就多了一个"看起来像序数方案、其实是空的"的键 —— 调试时分不清"老模板"与
    //   "新模板但序数清单丢了"，而这两者的处置完全相反
    ...(markSlots.length > 0 ? { markSlots } : {}),
    // 画面位置框：与 markSlots 长度不等时 markBoxesOf 已经整份丢掉（缺一个就关掉拖拽层）
    ...(markBoxes.length > 0 ? { markBoxes } : {}),
    ...(markBoxes.length > 0 && Number.isFinite(boxAtSec) && boxAtSec >= 0 ? { markBoxAtSec: boxAtSec } : {}),
    // 人偶描述：同一条存在性语义。★ 它与 markBoxes **各自独立**（框没量出来 ≠ 描述没验过），
    // 所以两者不共用同一个 if —— 合并的话"框失败"会把描述一起带走，白丢一次已经付过的钱
    ...(markDescs.length > 0 ? { markDescs } : {}),
    // 分段组归属：同一条存在性语义（老模板整个字段缺失）。key/count 缺一不可 ——
    // 只有 key 没有 count 的"半个组"没法折卡也没法整组套用，宁可当独立模板
    ...(api.group?.key && Number(api.group.count) > 1
      ? {
          group: {
            key: String(api.group.key),
            index: Number(api.group.index) || 0,
            count: Number(api.group.count),
            sourceUrl: api.group.sourceUrl || "",
            sourceDurationSec: Number(api.group.sourceDurationSec) || 0,
          },
        }
      : {}),
    published: api.status === "published",
  };
}

/**
 * 这条模板所在分段组的**全组**（含自己，按 index 升序）。不是组员就回 [自己]。
 * 只在三份列表（mine/mineRemote/shared）里找 —— 组员天然同源（同一次登记建出来的）。
 */
export function templateGroupOf(t: VideoTemplate): VideoTemplate[] {
  if (!t.group) return [t];
  const key = t.group.key;
  const all = [...mine, ...mineRemote, ...shared].filter((x) => x.group?.key === key);
  const seen = new Set<string>();
  const uniq = all.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  uniq.sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
  // 组不齐（远端列表截断/某段被删）宁可只回自己：整组套用少一段是静默丢内容
  return uniq.length === t.group.count ? uniq : [t];
}

/**
 * ★ 写入端的**唯一调用方**：提取器 ownRef 路选段拉满整条时走的 makeOwnRefTemplateGroup
 *   （templates.ts）—— 它把 splits 一并发给 POST /templates，服务端物理切段并归组，
 *   回来的 parts 逐条落本机。读取端（templateGroupOf / GroupRow / applyTemplateGroup /
 *   draftAudioHint / 剪辑页音轨预置）就是在等这一发。
 *
 * 一次分段登记最多切几段 —— **跨仓契约**：服务端那一半是 zod 的 `splits: …max(11)`
 * （11 刀 = 12 段，schemas/branchTemplate.schemas.js）。谁改一边都必须同步另一边，
 * 只改服务端的表现是：客户端放行 13 段、服务端 400 一句 zod 校验错，用户看不懂也改不动。
 */
export const SPLIT_MAX_PARTS = 12;

/**
 * 用户标的帧 → 合法分段点（**唯一实现**，登记 splits 之前必须过这里）。
 * 规则（与服务端 [4,30] 窗口对齐，服务端只验不修）：
 *   ① 丢掉会切出 <4s 段的标记（丢哪个都要能说出来 —— 返回 dropped 由调用方提示）；
 *   ② 任何一段 >30s 就在中点补刀，直到全部 ≤30s（用户没标就是整片对半切到进窗口）。
 */
export function planSplits(durationSec: number, marks: number[]): { splits: number[]; dropped: number[] } {
  const MIN = 4;
  const MAX = 30;
  const dropped: number[] = [];
  const picked: number[] = [];
  const sorted = [...new Set(marks.map((m) => Math.round(m * 100) / 100))].sort((a, b) => a - b);
  let prev = 0;
  for (const m of sorted) {
    if (m - prev < MIN || durationSec - m < MIN) {
      dropped.push(m); // 切出来不足 4s：这一刀落不下去
      continue;
    }
    picked.push(m);
    prev = m;
  }
  // 对超窗的段递归对半，直到每段 ≤30s（34.18s 没标 → [17.09]；62s → 四段）
  const out: number[] = [];
  const halve = (a: number, b: number) => {
    if (b - a <= MAX) return;
    const mid = Math.round(((a + b) / 2) * 100) / 100;
    halve(a, mid);
    out.push(mid);
    halve(mid, b);
  };
  let start = 0;
  for (const m of [...picked, durationSec]) {
    halve(start, m);
    if (m !== durationSec) out.push(m);
    start = m;
  }
  return { splits: out.sort((a, b) => a - b), dropped };
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
 * 「这条模板是不是我的」的**唯一**判据（2026-08-20 从市场页 OwnerRow 下沉过来）。
 *
 * ★★ 本机库里有这条 = 就是我的（`mine` 按定义只装自己的模板），否则才问服务端的
 *   `isOwner`（市场里别人那些条目走这一支）。⚠ 别写成"有 remoteId 就只认服务端
 *   isOwner"——本机那条的远端状态拉不到（服务端记录已被删）时 isOwner 是 undefined，
 *   于是判否，而那恰恰是最需要删除入口的时候：一条服务端已没有、本机还赖着的幽灵模板。
 * ★ 拿 `author` 显示名比身份仍然是禁止的（CLAUDE.md 那条坑）——这里判的是本机库成员资格。
 */
export function isMyTemplate(t: VideoTemplate): boolean {
  return mine.some((x) => x.id === t.id) || remoteStateOf(t)?.isOwner === true;
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
/**
 * 【自带参考视频】把作者自己传的一段视频做成白模模板 —— **这条路的唯一实现**。
 *
 * 三步，一步都不能省：
 *   ① `deriveTemplateVideo`：把框选那一段裁出来（不够清晰服务端顺带放大到刚过线），
 *      落成一个正规素材。**必须有这一步**：参考视频窗口是 [4,30]s + 像素/边长/比例门，
 *      而用户手上的原片多半不满足（实测一段 34.167s、836×480 的真实素材两条都差）。
 *   ② `registerTemplate` 那条服务端登记（POST /templates）：**毫秒级、必然成功**，
 *      因为认人那些慢活已经拆出去了。
 *   ③ `detectTemplateRoles`：认人 + 量框，**慢且会抖，所以可重试**（失败不留痕）。
 *
 * ★★ 与白模 V2 的分界就一句话：**这条路不出片**。视频已经在作者手上，我们只是
 *   认出画面里有谁、量出他们在哪 —— 没有 r2v 那一笔（V2 是一次真实付费出片）。
 *   所以报价也只有 chat 那几发（`ownRefTemplateCost`）。
 * ★ ③ 失败**不算整件事失败**：模板已经建好了，作者可以在列表里点「识别角色位」重来。
 *   所以这里 catch 住它、把话带回去，而不是让整个流程抛。
 *
 * @returns 本机模板 id + 一句给用户看的话（"" = 全都拿到了）
 */
export async function makeOwnRefTemplate(o: {
  receipt: { publicId: string; url: string; durationSec: number; width: number; height: number; bytes: number };
  clip: { startSec: number; durSec: number; crop: { x: number; y: number; w: number; h: number } };
  title: string;
  intro?: string;
  /**
   * 用户自己标的分析帧，**已经换算成"裁剪后那段视频内的第几秒"**。
   * ★★ 换算责任在调用方（提取器）而不是这里：用户是对着**原片**拖时间轴标的，
   *   而认人量框是在**裁剪后**那份派生视频上做的 —— 两者的零点差着 `clip.startSec`。
   *   不减这一下，标的每一帧都会偏移选段起点那么多秒，而画面照样出得来、零报错。
   * ★ **不给（undefined）** = 用户选的是「自动」，服务端按几何位置铺（判据只在服务端一处）。
   * ★★ **给了但是空数组** = 用户选的是「自己挑」、而一帧都没能用上 —— 这条**响亮拒绝**，
   *   见下面函数体最上面那道门。两者必须分得开，所以调用方传的是
   *   `manual ? boxMarksInSelection(...).atSecs : undefined`，绝不把 auto 也传成 []。
   */
  atSecs?: number[];
  onStep?: (note: string) => void;
}): Promise<{ id: string; note: string }> {
  const say = o.onStep ?? (() => {});
  if (!remoteOn()) throw new Error("现在连不上服务器——联网后再做模板");

  // ★★★ 「自己挑帧」却一帧都没能用上 —— **响亮拒绝，不许悄悄退回自动**。
  //   与 blockoutizeTemplate 那道门同一条理由（那边逐字写着「不许悄悄退回自动」）：
  //   空数组会被 api/branch 的 `atSecs && atSecs.length ? {atSecs} : {}` 变成空请求体，
  //   服务端于是按几何位置自己铺帧 —— 而用户界面上顶着「已标 N/5」，一帧都没用上，
  //   且这一步是**付费**的。这个功能存在的全部理由就是自动铺法在有分镜的素材上认不准。
  // ★ 位置必须在这儿（deriveTemplateVideo 之前）：放到认人那一步才拒的话，裁剪与登记
  //   都已经做完，用户拿到一个半成品模板还挨一句报错。
  // ★★ 这道门**只判空，不做任何规范化** —— 别把 blockoutizeTemplate 的 Math.round 抄过来：
  //   那条路的栅格是**整数秒**（服务端 zod 收整数），这条是 **0.5 秒**
  //   （BoxFramePicker.BOX_FRAME_QUANT，对齐服务端 pickedFrameCandidates）。
  //   抄一个 round 进来会把 3.5s 塌成 4s、还可能把 3.5 与 4.0 去重成一帧，
  //   那正是"同一个量化写两处"的第二份实现。
  // ★ 措辞要同时覆盖两种成因：标了但全落在选段外（选段后来被拖过），以及压根一帧没标。
  //   只说前一种的话，第二种用户会对着一句不成立的解释找不着北。
  if (o.atSecs && o.atSecs.length === 0) {
    throw new Error(
      "你选了「自己挑」分析帧，但一帧都没能用上——要么还没标，要么标的那几帧都落在选中的这一段外面（选段后来被拖动过）。回去在选段里标至少 1 帧，或者切回「自动」。",
    );
  }

  say("正在裁出你框选的那一段…");
  const cut = await uploadsApi.deriveTemplateVideo(o.receipt.publicId, o.clip);

  // ★ 先落本机再登记：登记失败时本机这条还在（带 publicId），删除那条路认得出它、
  //   能把云端那份回收掉。反过来（登记成功、本机没落）才是真的丢句柄。
  say("正在登记模板…");
  const tpl = saveTemplate({
    title: o.title.trim() || "白模模板",
    intro: (o.intro ?? "").trim(),
    cover: "",
    // ★ 白模不带素材卡（提取时认不出，「换成谁」由套用者自己挂卡）—— 与 apiToTemplate 同一句
    cards: [],
    recipe: { styleHint: "", beats: [], durationSec: Math.round(cut.durationSec), videoTier: "", framePrompt: "" },
    refVideo: {
      url: cut.url,
      durationSec: Math.round(cut.durationSec),
      width: cut.width,
      height: cut.height,
      publicId: cut.publicId,
    },
  });
  const id = tpl.id;
  await registerTemplate(id);

  say("AI 正在认画面里有哪些人…（要一到几分钟）");
  let note = "";
  try {
    note = await detectTemplateRoles(id, o.atSecs);
  } catch (e) {
    // ★ 认人失败**不算整件事失败**：模板已经建好，列表里那颗「识别角色位」能重来。
    //   把原因原样带回去 —— 编一句"稍后再试"会让作者以为是网络问题。
    note = `${e instanceof Error ? e.message : String(e)}（模板已经建好了，可以在「我的模板」里点「识别角色位」重试）`;
  }
  return { id, note };
}

/**
 * 【自带参考视频 · 长视频】整条分段登记成一个模板组 —— **>30 秒那条路的唯一实现**。
 *
 * 与单段的 `makeOwnRefTemplate` 是同一条产品路的两种形态，但步骤不同、刻意不合并：
 *   · 单段：deriveTemplateVideo 裁剪（可裁画面）→ 本机先落 → registerTemplate 登记；
 *   · 分段：**跳过裁剪**（服务端 splits 路吃整条原始上传，v1 不支持画面裁剪 —— 限制
 *     由提取器在选段界面整句说出），POST /templates 带 `splits` 一发登记出 N 段独立
 *     资产（group 归组），再把服务端回的 parts **逐段**落本机、**逐段**认人。
 *
 * ★★ 落库顺序与单段相反（先服务端后本机）是有意的：单段"先落本机"是为了握住派生
 *   资产的回收句柄；分段路**不产生本机先知道的资产**（切段由服务端完成、失败服务端
 *   自己回滚），本机没有可先落的东西。登记成功那一刻源视频成为 `group.sourcePublicId`
 *   （合并回填原片音轨靠它），从此**不许再回收** —— `onRegistered` 就是让宿主把回执标成
 *   spent 的钩子，漏调的表现是关窗时客户端徒劳地去删、服务端整句拒、控制台多一条假警报。
 * ★★ 每段落库走 `adoptRemoteTemplate`（与白模化取件同一跳），认人回写走
 *   `detectTemplateRoles`（与单段同一跳）—— 五件套（roles/markSlots/markBoxes/
 *   markBoxAtSec/markDescs）对每段各来一遍，全部经由那两处唯一实现，这里不碰任何字段。
 * ★ 认人是**逐段串行**的：detect-roles 限流 6 次/分，N 段并发出去会自己撞自己的限流；
 *   而且每段一发是一笔钱，串行让"第 3 段失败"停在第 3 段的报错上，好认。
 * ★ 某段认人失败**不算整件事失败**（与单段同一条纪律）：那一段模板已经在「我的模板」里，
 *   单独点「识别角色位」重试即可 —— 失败的段逐段点名，别把 N 段的结果压成一句"部分失败"。
 *
 * @param o.splits 分段点（秒，升序）——调用方经 `planSplits` 规划过的那份（唯一实现，
 *   丢刀/对半都在那边）。这里不重新规划：服务端只验不修，不合法就整单 400 原文透传。
 * @returns 第 1 段的本机 id + 段数 + 一句给用户看的话（"" = 全都拿到了）
 */
export async function makeOwnRefTemplateGroup(o: {
  receipt: { publicId: string; url: string; durationSec: number; width: number; height: number; bytes: number };
  splits: number[];
  title: string;
  intro?: string;
  /** 登记一成功（源视频从此归模板组管、不许再回收）就回调 —— 宿主拿它标记回执 spent */
  onRegistered?: () => void;
  onStep?: (note: string) => void;
}): Promise<{ id: string; count: number; note: string }> {
  const say = o.onStep ?? (() => {});
  if (!remoteOn()) throw new Error("现在连不上服务器——联网后再做模板");
  // 断言而不是静默兜底：空 splits 意味着调用方没走 planSplits 就进来了（≤30 秒该走单段路）
  if (!o.splits.length) throw new Error("分段登记需要至少一个分段点——不超过 30 秒的选段请走单段那条路。");

  const count = o.splits.length + 1;
  say(`正在把整条视频切成 ${count} 段登记…（每段都要独立转码，请稍候）`);
  const { parts } = await branch.createTemplate({
    title: o.title.trim() || "白模模板",
    intro: (o.intro ?? "").trim(),
    coverUrl: "",
    recipe: {
      styleHint: "",
      beats: [],
      // ★ recipe.durationSec 是「经典降级路的镜像时长」，服务端 zod 窗口 [3,30] ——
      //   整条源时长（>30 才走到这条路）直接塞会整单 400（2026-08-20 实测 34.18s 撞的
      //   第一发）。这份 recipe 是 N 段共用的，而每段真实时长在各自 refVideo 上；
      //   镜像取窗口上限即可（老客户端降级跑经典配方时的拍长，不参与任何计价）。
      durationSec: Math.min(ARK_EDIT_RULES.maxSec, Math.max(3, Math.round(o.receipt.durationSec))),
      videoTier: "",
      framePrompt: "",
    },
    videoUrl: o.receipt.url,
    splits: o.splits,
  });
  // ★ 判回包**形状**不判状态码（Capacitor SPA 回退恒 200，CLAUDE.md 那条坑）：
  //   老服务端对带 splits 的请求可能按整段登记处理（zod strip 掉不认识的字段）——
  //   那时回的是单个 template 而没有 parts，必须整句拒，否则一段 34 秒的"整段模板"
  //   会带着超窗的时长静默落库，套用的人付费那一步才 400。
  if (!parts?.length) {
    throw new Error("这台服务器不支持分段登记（回包没有 parts，可能需要升级服务端）——模板没有创建，本次没有花钱。");
  }
  o.onRegistered?.();

  // 逐段落本机（五件套此刻多半还是空的 —— needsDetect，由下面逐段认人回写）
  const landed = parts.map((api) =>
    adoptRemoteTemplate(api, "分段登记成功了，但服务器返回的某一段缺少参考视频地址——请到「我的模板」里确认各段状态。"),
  );

  const lines: string[] = [];
  let failed = 0;
  for (let i = 0; i < landed.length; i += 1) {
    say(`第 ${i + 1}/${landed.length} 段：AI 正在认画面里有哪些人…（要一到几分钟）`);
    try {
      // atSecs 不传 = 服务端按几何位置自动铺：用户标的帧在分段路里是**切段点**（镜头边界），
      // 拿镜头切换那一瞬当认人帧正好是最差的一帧 —— 两种语义别混
      const n = await detectTemplateRoles(landed[i].id, undefined);
      if (n) lines.push(`第 ${i + 1} 段：${n}`);
    } catch (e) {
      failed += 1;
      lines.push(`第 ${i + 1} 段认人失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failed > 0) {
    lines.push("失败的段不用重做模板：在「我的模板」里找到那一段，单独点「识别角色位」重试就行。");
  }
  return { id: landed[0].id, count: landed.length, note: lines.join("\n") };
}

/**
 * 让服务端去认一遍这个模板的角色位（并量出画面位置）——**「自己传参考视频」那条路的第二步**。
 *
 * ★★ 与登记分开是有意的（服务端那条路由的文件头写了完整理由）：认人+量框慢起来是
 *   分钟级、上游还会抖，塞在登记里一次抖动就让作者拿到一个没有角色位的模板。
 *   拆开之后**失败就再点一次，模板一直好好地在**。
 * ★ 回来的四位（roles / markSlots / markBoxes / markBoxAtSec）**同批搬**，走的是
 *   与 `registerTemplate` / `refreshRemoteTemplate` 同一套逐字段搬运器。
 *   漏搬任何一位都是零报错：漏 roles → 核对入口永不出现；漏 markSlots → 整份被判成
 *   编号方案；框与清单长度不等 → 拖拽层静默关掉（CLAUDE.md 那条已经咬过三次的坑）。
 * ★ 这一发**花钱**（认人 + 量框都是计费的 chat，报价见 economy.ownRefTemplateCost），
 *   所以只在用户点了之后调，绝不做成自动轮询重试。
 *
 * @param atSecs 用户自己标的那几帧 —— **「要分析的那段视频」上的第几秒**（不是原片时间轴：
 *   提取器那条路在调用前已经减掉过选段起点）。⚠ 一律是**升序去重**的，不是"按他标的顺序"：
 *   两个调用点给进来的都排过序。服务端是依次试、第一个成的就停，所以别以为用户能把
 *   最有把握的那一帧排到最前面先试 —— 他做不到。不给 = 服务端按几何位置
 *   自动铺（1/2 → 1/4 → 3/4 → 1/8 → 7/8）。
 *   ★★ 为什么要给用户这条路：自动铺法不知道**分镜在哪**。2026-08-17 实测同一段 15 秒
 *     群舞里画面人数在 8→7→5→6 之间跳，同一个人在不同镜头里的「从左数第几个」都不一样 ——
 *     而看得见画面的人挑得出"人最齐、最能代表这一段"的那一帧。
 *   ★ 上限与量化只在服务端一处（`pickedFrameCandidates`）。这里不截、不排序、不去重：
 *     每试一帧就是一笔钱，两处各判一次 = 报价与实收分家。App 要做的是**在标记界面上
 *     就不让他标超**，而不是发送前偷偷改掉他标好的东西。
 * @returns 一句给用户看的话（"" = 全都拿到了，不用说什么）
 * @throws message 可直接显示（含 409「正在识别中」那一句）
 */
export async function detectTemplateRoles(id: string, atSecs?: number[]): Promise<string> {
  // ★ 三份都要找：本机库、**我在服务端的那份**（换设备后就只有它）、市场缓存。
  //   漏掉 mineRemote 的表现是"列表里明明有这一条，点识别却说不在本机库里"
  const t = mine.find((x) => x.id === id) ?? mineRemote.find((x) => x.id === id) ?? shared.find((x) => x.id === id);
  if (!t) throw new Error("这个模板不在本机库里");
  if (!t.remoteId) throw new Error("这个模板还没登记到服务器，先登记再识别角色位");
  if (!remoteOn()) throw new Error("现在连不上服务器——联网后再识别");
  let out: Awaited<ReturnType<typeof branch.detectTemplateRoles>>;
  try {
    out = await branch.detectTemplateRoles(t.remoteId, atSecs);
  } catch (e) {
    // ★★★ 超时**不等于失败**（2026-08-18 真机撞到）：服务端那一发可能还在跑、
    //   甚至已经成功并**已经计费**，而它还抱着一把 11 分钟的锁 —— 这时候说
    //   「请求超时」会把用户推去立刻重试，而重试只会吃 409「正在识别中」。
    //   ⇒ 把这一档单独说清楚：等一会儿、回来看，别急着再点（铁律八：失败要带下一步）。
    // ★ 只改这一种（`TIMEOUT`）的措辞：网络不可用、401、409 那几档服务端/客户端
    //   本来就说得准，原样抛。
    if (e instanceof ApiError && e.code === "TIMEOUT") {
      throw new Error(
        "等太久没等到回复——但**这一发多半还在服务器上跑**（认人最坏要几分钟），而且可能已经计费。" +
          "先别急着再点（这会儿再点只会说「正在识别中」）：等一两分钟，退出这一页再进来看看角色位是不是已经有了。",
      );
    }
    throw e;
  }
  if (!out) throw new Error("这台服务器不支持识别角色位（回包形状不对，可能需要升级服务端）");
  const api = out.template;
  if (api) {
    // ★ 四位同批搬。★★ 服务端**认不出人时一个字都不写**，所以这里也要按存在性搬 ——
    //   拿一份空的去覆盖，会把上一次成功认出来的角色位抹掉（这条路是可重试的，
    //   而"重试一次反而更差"是最难查的一种）
    const back = rolesOf(api);
    if (back.length) t.roles = back;
    const backSlots = markSlotsOf(api);
    if (backSlots.length) t.markSlots = backSlots;
    const backBoxes = markBoxesOf(api, (backSlots.length ? backSlots : t.markSlots ?? []).length);
    if (backBoxes.length) {
      t.markBoxes = backBoxes;
      const at = Number(api.markBoxAtSec);
      if (Number.isFinite(at) && at >= 0) t.markBoxAtSec = at;
    } else if (back.length) {
      // ★ 这一次认出了人却没量出框：把旧框**清掉**。留着的话新 roles 会配着旧框 ——
      //   人数没变时长度还正好相等，出口那道长度校验也放行，于是整份错位、零报错。
      delete t.markBoxes;
      delete t.markBoxAtSec;
    }
    // ★ 人偶描述：与框**各自独立**（框没量出来 ≠ 描述没验过），所以单独一段。
    //   ★★ 这一次认出了人却一条描述都没验过时要**清掉旧的**，理由与上面的框一模一样：
    //   留着的话新 roles 会配着上一次的描述，长度还正好相等（人数没变），
    //   于是套用提示词里那句括号说的是**另一个人偶**的样子 —— 零报错、指错人。
    const backDescs = markDescsOf(api, (backSlots.length ? backSlots : t.markSlots ?? []).length);
    if (backDescs.length) t.markDescs = backDescs;
    else if (back.length) delete t.markDescs;
    recordState(api);
    persist();
  }
  emit();
  return out.note;
}

export async function registerTemplate(id: string): Promise<void> {
  // mineRemote 条目天生带 remoteId，下面会走"已登记 → 刷新"那条路（同 setTemplatePublished 的 ★★）
  const t = mine.find((x) => x.id === id) ?? mineRemote.find((x) => x.id === id);
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
    const { template: api } = await branch.createTemplate({
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
        // ★ 真实时长只有服务端算得出（Cloudinary 回执）。存在性透出，理由同 apiToTemplate
        ...refRealSecKey(api.refVideo.realDurationSec),
      };
    }
    // ★★★ 角色位与位置框**必须在这里回写**（2026-08-17：服务端这条登记路开始认人+量框了）。
    //   这是整条改造里最容易漏、也最贵的一处：不搬的话，服务端建得好好的（有 roles、
    //   有 markSlots、有 markBoxes），而作者**自己那台设备**的本机记录里一位都没有 ——
    //   `RoleConfirmEntry` 第一行就是 `if (!t.roles?.length) return null`，于是核对入口
    //   **永远不出现**；他去详情页点发布，服务端的 rolesNeedConfirm 闸回 400。
    //   作者只会以为"发布坏了"，而 App 侧没有任何一处指得到真正的原因（全程零报错）。
    //   ⚠ CLAUDE.md 那条「服务端加字段、本机库那几跳必须一起搬」说的就是这里。
    // ★ 一律走现成的逐字段搬运器（rolesOf / markSlotsOf / markBoxesOf），别在这儿手写
    //   `|| []`：markBoxesOf 里那道「长度与 markSlots 不等就整份丢」是网络这一端的边界检查。
    // ★ 四位**同批搬、按存在性写**：markSlots 缺失 = 判成编号方案（挂卡面板会让用户去找
    //   人偶头上的数字，而画面上什么都没印）；框与清单长度不等 = 拖拽层静默关掉。
    const back = rolesOf(api);
    if (back.length) t.roles = back;
    const backSlots = markSlotsOf(api);
    if (backSlots.length) t.markSlots = backSlots;
    const backBoxes = markBoxesOf(api, (backSlots.length ? backSlots : t.markSlots ?? []).length);
    if (backBoxes.length) {
      t.markBoxes = backBoxes;
      const at = Number(api.markBoxAtSec);
      if (Number.isFinite(at) && at >= 0) t.markBoxAtSec = at;
    }
    // 人偶描述：第五位，同批搬。★ 漏了它的表现是套用提示词里那句括号**永远不出现**，
    // 而"没有括号"与"这段素材本来就没什么可描述的"在界面上完全一样（零报错）
    const backDescs = markDescsOf(api, (backSlots.length ? backSlots : t.markSlots ?? []).length);
    if (backDescs.length) t.markDescs = backDescs;
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
      // ★★ 方案位同样跟着服务端走，理由比 roles 那条更硬：本机 `mine` 里那份是**建模板
      //   那一刻写下的**，而这一位是后加的 —— 换句话说，作者自己那台设备上
      //   的老记录永远不会自己长出它。少了这一段，一个真·序数模板在**作者本人**的
      //   设备上会一直被判成编号方案：他去挂卡，输入框里写的是 `编号最左边=凛`；
      //   而别人（走 shared，走的是 apiToTemplate 那条新路）看到的是对的。
      // ★ 只在服务端真有这一位时才回写，**绝不因为"这次没回"就把本机那份删掉**：
      //   读路径的一次抖动不该把一个序数模板降级成编号模板（那正是判否定要防的方向）。
      const backSlots = markSlotsOf(api);
      if (backSlots.length && JSON.stringify(backSlots) !== JSON.stringify(local.markSlots ?? [])) {
        local.markSlots = backSlots;
        dirty = true;
      }
      // 画面位置框跟着序数清单一起搬（它按下标对齐 markSlots，分开搬会错位）
      const backBoxes = markBoxesOf(api, (backSlots.length ? backSlots : local.markSlots ?? []).length);
      if (backBoxes.length && JSON.stringify(backBoxes) !== JSON.stringify(local.markBoxes ?? [])) {
        local.markBoxes = backBoxes;
        const at = Number(api.markBoxAtSec);
        if (Number.isFinite(at) && at >= 0) local.markBoxAtSec = at;
        dirty = true;
      }
      // ★★ 人偶描述同样跟着服务端走，而且这一跳**比别处更要紧**：作者可以在核对面板里
      //   改写它（服务端 PATCH /roles 会把他改的那一份写进 markDescs），而他很可能是在
      //   **另一台设备**上改的。不同步的话，这台设备出片时括号里塞的还是 AI 原来那句 ——
      //   而他改写它的理由多半正是"AI 那句认不出人"。
      // ★ 只在服务端真有时才回写，绝不因为"这次没回"就删本机那份（判否定的方向）。
      const backDescs = markDescsOf(api, (backSlots.length ? backSlots : local.markSlots ?? []).length);
      if (backDescs.length && JSON.stringify(backDescs) !== JSON.stringify(local.markDescs ?? [])) {
        local.markDescs = backDescs;
        dirty = true;
      }
      // ★★ `realDurationSec` 也必须跟着服务端走，理由与上面 roles 那条**完全同构**，
      //   但少了它的后果更刁钻：这一位是 2026-08-16 才新增的（服务端回填脚本补进老文档），
      //   而本机 `mine` 里那份是**建模板时写下的**、永远不会自己长出这一位。
      //   于是「模板视频短于方舟下限」这件事在**作者自己那台设备上认不出来** ——
      //   而作者恰恰是唯一能补救的人：详情页那句「这不是你操作错了、之前几次试炼没扣费、
      //   重做时至少选 5 秒」、市场卡片的「暂时不可用」角标、出片按钮的禁用，
      //   全都判在这一位上，全都不会触发（`getTemplate` 是 mine 优先于 shared，
      //   所以别人看得见的角标，作者自己反而看不见）。
      // ★ 只回写这一位、不整份替换 `local.refVideo`：本机那份还带着 url/publicId 等
      //   建模板时的字段，整份换成服务端 payload 会把它们悄悄换掉，那是另一类事故。
      const realSec = refRealSecKey(api.refVideo?.realDurationSec).realDurationSec;
      if (local.refVideo && realSec !== undefined && local.refVideo.realDurationSec !== realSec) {
        local.refVideo = { ...local.refVideo, realDurationSec: realSec };
        dirty = true;
      }
      if (dirty) persist();
    }
    // ★★ 本机**没有**这条记录时（换设备/重装，模板只活在 shared 内存缓存里），
    //   角色位同样要跟着服务端走。少了这一段，「打开核对面板前先取一次服务端那份」
    //   在**它唯一想防的那条路上恰好是空转**：
    //     设备 B 重装后进详情页 → 模板落进 shared（roles = 那份没核对过的猜测）
    //     → 同一会话再进详情页时 `if (!id || t || …) return` 短路、不再回源
    //     → 期间作者在设备 A 上把编号改对了并删掉两个位
    //     → 设备 B 点「重新核对」，这里只更新了状态快照、**shared 那份 roles 一个字没动**
    //     → 面板照着旧的 1/2/3/4/5 渲染（看着就像"还没核对的猜测"，作者看不出异常）
    //     → 一提交就是**整份替换**，设备 A 上那次修正被悄悄撤销，两边零报错。
    //   ⚠ 注释里承认的"已知可接受"是**并发写**后到者覆盖先到者；这里覆盖的却是一份
    //     这台设备从未刷新过的旧值 —— 那不在"可接受"里，是这一段该修的。
    else {
      const cached = shared.find((x) => x.id === id);
      const back = rolesOf(api);
      const backSlots = markSlotsOf(api);
      // shared 只活在内存里，没有本机库要写（persist 只管 mine）
      if (cached && back.length) cached.roles = back;
      // 方案位同上（有才写、不因一次没回就抹掉）
      if (cached && backSlots.length) cached.markSlots = backSlots;
      // 位置框与序数清单同批（下标对齐，分开搬会错位）
      const backBoxes = markBoxesOf(api, (backSlots.length ? backSlots : cached?.markSlots ?? []).length);
      if (cached && backBoxes.length) {
        cached.markBoxes = backBoxes;
        const at = Number(api.markBoxAtSec);
        if (Number.isFinite(at) && at >= 0) cached.markBoxAtSec = at;
      }
      // 人偶描述：第五位。★★ **mine 与 shared 两份都要搬**（CLAUDE.md 那条坑的原话）——
      //   `getTemplate` 是 mine 优先，所以只搬 shared 的话作者自己看不见；
      //   只搬 mine 的话别人（换设备、市场来的）看不见。两边各管一半的路径。
      const backDescs = markDescsOf(api, (backSlots.length ? backSlots : cached?.markSlots ?? []).length);
      if (cached && backDescs.length) cached.markDescs = backDescs;
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
  // ★★ mineRemote 也必须查（2026-08-20 真机实拍：重装后本机库空了，「我的模板」列表
  //   里的条目全来自 mineRemote，点发布却报"不在本机库里"）—— detectTemplateRoles
  //   647 行的注释早写了这个坑的形状，这里当时还是漏了。三份列表一个都不能少。
  const t = local ?? mineRemote.find((x) => x.id === id) ?? shared.find((x) => x.id === id);
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
 * 「删到只剩这么多，行不行」—— 角色位**下限**的唯一实现（null = 行得通，否则是一句
 * 可直接显示的整句）。核对面板（最后一条不给删的那句解释）、提交前的预检、
 * `confirmTemplateRoles` 自己，问的都是它；UI 不许另写 `rows.length <= 1` 的判断。
 *
 * ★★ 为什么下限是 1 而不是 0（删到 0 的后果是一条**四段全静默**的降级链）：
 *   ① 服务端 `toTemplatePayload` 只在 `roles.length > 0` 时才带这个键 → 模板在回包里
 *      退化成 V1 形状；② `rolesOf` 回空数组 → 本机记录不带 `roles` 键；
 *   ③ 出片时 `segmentGen` 的 `blockout && roles?.length` 为假 → **静默退成 V1 泛指出片**，
 *      套用者花了 r2v 的钱，换来一段"AI 自己挑人换"的片；④ 服务端 `rolesNeedConfirm`
 *      同时变 false → **发布闸失效**，一个没有任何挂卡入口的白模模板能上市场。
 *   全程零报错，所以这一步必须在本机就拦住，并把"真正想要的那个操作"指出来。
 * ★ 这是**预检**，不是第二份判据：服务端那边也拦（它才是唯一权威）。这一层存在的意义
 *   是别让作者白跑一趟网络，以及把机器话（zod 的英文 "Validation error"）换成人话。
 */
export function roleFloorIssue(remaining: number): string | null {
  if (remaining >= 1) return null;
  return "至少要留一个角色位——一个都不留的话，套用你模板的人没有任何地方可以挂卡，这个模板会退回成「整段只有一个白模人偶」的老形态。整个模板不要了的话，用详情页的「删除」。";
}

/**
 * 核对角色位标记 —— **唯一入口**（页面别自己调 branch API：本机镜像与远端状态要一起改）。
 *
 * ★★ 为什么非有这一步不可（这是白模 V2 最阴的一条错法）：白模化落库那一刻的 label 是
 *   **服务端按视觉清单顺序分配的猜测**，而成片上人偶身上真正的标记是**方舟画上去的**。
 *   对不上时，套用者给「绿色」（老模板是「3 号位」）挂上张三 —— 模型老老实实换掉画面上
 *   真正的那个绿色人偶（另一个人），**钱照扣、零报错**。所以标记只能由看得见画面的人确认。
 * ★ 提交的是**完整的那一份**（服务端整份替换）：作者可以改标记、改描述、删掉 AI 多认的
 *   一条、补上它漏认的一个。标记重复服务端整句 400（重了会让套用侧的挂卡互相覆盖）。
 * ★★ **「删掉一个角色位」就走这一条路，没有第二条**（2026-08-15 实测逼出来的常规操作）：
 *   两种方案各有各的不准法 —— 编号版实出过 2/2/1/1/5（两组重号，3、4 整个没出现）；
 *   颜色版最常见的是**有个人根本没被换成人偶**（尤其是画面正中央那个最像主角的），
 *   以及相邻两色互换。库里那份永远是不重复的，所以**对不上只发生在画面上**：作者要把
 *   能对上的位子改成画面上真实的那个标记，把画面上找不到的那几个位子删掉。删的表达形式
 *   就是**提交的数组里少了那一条**（整份替换）—— 改标记与删位因此是**同一次提交的两半**，
 *   拆成两次必然撞服务端的重号闸（把 1 号位改成 2 时库里已经有个 2；把这一行改成绿色时
 *   库里已经有个绿色）。
 * ★★ 剩下的 label **逐字不动、顺序不动**：调用方给什么就发什么，这一层不排序、不补号、
 *   不重编、不换近义色名。删掉 3 号之后 5 号仍然叫 5 号，"绿色"不许写成"青色" ——
 *   重排/换词等于把卡挂到别人身上，两边都不报错。
 * ★★ **`markSlots` 一个字都不发**（也不许发）：那是"这个模板是哪种方案"的判据、也是升序
 *   排序的依据，由白模化那一刻的服务端说了算。让作者的一次「核对无误」把方案位擦掉，
 *   套用侧当场整份错且零报错 —— 服务端 zod 的 strip 是第二道，这里是第一道。
 * ★ 成功后**本机 roles 一起改写**：出片时点名用的就是本机这份（segmentGen 读 template.roles），
 *   只改远端的话，作者在这台设备上出的片仍然按旧标记点名 —— 那正是"改了却没生效"的
 *   零症状故障。
 * @throws message 可直接显示
 */
export async function confirmTemplateRoles(
  id: string,
  roles: NonNullable<VideoTemplate["roles"]>,
): Promise<void> {
  const local = mine.find((x) => x.id === id);
  // 本机没有 ≠ 不是我的（换设备/重装后本机库是空的，身份由服务端按 ownerId 把关），
  // 与 setTemplatePublished 同一条理由；mineRemote 同样不能漏（同处的 ★★）
  const t = local ?? mineRemote.find((x) => x.id === id) ?? shared.find((x) => x.id === id);
  if (!t) throw new Error("这个模板不在本机库里");
  // 名词按方案说（唯一实现是 markNoun）：对着一群一模一样的白人偶找"编号"，用户只会以为坏了
  const spec = markSpecOf(t);
  const noun = markNoun(spec);
  if (!t.remoteId) throw new Error(`模板还没登记到服务器，登记成功后才能核对${noun}`);
  if (!remoteOn()) throw new Error(`现在连不上服务器——${noun}登记在服务端，联网后再核对`);
  const clean = roles.map((r) => ({ label: String(r.label ?? "").trim(), desc: String(r.desc ?? "").trim() }));
  // ★★ 空编号**整句拒**，绝不静默丢掉那一条。原来这里是 `.filter((r) => r.label !== "")` ——
  //   而这条端点是**整份替换**，被 filter 掉就等于把那个角色位真的删了：
  //   作者把某一行的编号框全选清空（想重打画面上的真数字，或者以为"清空=不改"），
  //   那一行既不进面板的 `doomed`、也就不进底部那条待删汇总，按钮上写的还是
  //   「我已逐个核对，编号无误」—— 点下去角色位连同 AI 写的 desc 一起永久消失，
  //   服务端 200、labelConfirmed 全置 true、rolesNeedConfirm 变 false，此后**没有任何一处**
  //   会再提醒他少了一个位子。套用者看到的就是"这个人偶永远挂不上卡"。
  //   ⚠ 服务端拦不住这一格：zod 是 `label: z.string().trim().min(1)`，空 label 根本到不了那边
  //     ——它压根不在请求里。所以这一条只能在 App 侧成立，而"删"必须只有一种表达：显式点删除。
  //   （同一条 filter 的反向症状：点「加一个」只填描述忘了填号 → 提交后那行被静默丢掉，
  //     服务端 200、行数没变，作者以为补上了。）
  const blank = clean.findIndex((r) => r.label === "");
  if (blank >= 0) {
    throw new Error(
      `第 ${blank + 1} 行的人偶${noun}是空的——${noun}是"把卡挂到这个人偶身上"的唯一凭据，不能留空。${
        spec.scheme === "ordinal" ? "对着画面从左往右数，选一个位置" : "照画面上印的数字填一个"
      }；想去掉这个角色位，请点它的「删掉」。`,
    );
  }
  // 下限只有一处实现（面板里"最后一条不给删"说的也是这一句）
  const floor = roleFloorIssue(clean.length);
  if (floor) throw new Error(floor);
  const api = await branch.patchTemplateRoles(t.remoteId, clean);
  if (!api) {
    throw new Error("这台服务器还不支持核对角色位（回包形状不对，可能需要升级服务端）");
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
    // 本机没有但远端缓存里有 = 换设备的作者在删自己的远端模板（身份由服务端把关，
    // 非 owner 的请求服务端会 403）。删成即从缓存摘掉，别等下一次懒加载才消失。
    // ★ **两份缓存都要找**：`mineRemote`（我的模板那一屏）与 `shared`（市场那一屏）。
    //   只找 shared 的话，换设备的作者在「我的模板」里点删除会得到一句"这个模板不在本机库里"
    //   —— 而那正是这条分支存在的唯一场景。
    const remote = mineRemote.find((x) => x.id === id) ?? shared.find((x) => x.id === id);
    if (!remote?.remoteId) return;
    if (!remoteOn()) throw new Error("现在连不上服务器——联网后再删");
    const landed = await branch.deleteRemoteTemplate(remote.remoteId);
    if (!landed) throw new Error("这台服务器不支持删除模板（回包形状不对，可能需要升级服务端）");
    remoteStates.delete(remote.remoteId);
    shared = shared.filter((x) => x.id !== id);
    mineRemote = mineRemote.filter((x) => x.id !== id);
    sharedFresh = false;
    mineRemoteFresh = false;
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
    // ★ 远端缓存里同一条也要摘掉：不摘的话本机那条一删，`myTemplates()` 立刻把远端那份
    //   补进来 —— 用户看到的是"删了它又回来了"（其实服务端已经删掉了，只是缓存没刷）
    mineRemote = mineRemote.filter((x) => x.remoteId !== t.remoteId);
    sharedFresh = false;
    mineRemoteFresh = false;
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
   * 这个模板用的是**序数**标记（服务端下发的那份"从左到右一共有哪几个位置"的清单）。
   *
   * ★★ 这一位**必须跟着 roles 一起搬进本机库**，漏了它的表现极其刁钻：
   *   方案判据是 `markSlots` 的存在性（判否定 → 缺失即"老的编号方案"），所以漏一位
   *   不是"少显示一个位置"，而是**刚做出来的序数模板在作者自己那台设备上从出生起就被
   *   判成编号方案**。接着他点「用这个模板出片」（提取器成功卡片上最显眼的下一步），
   *   挂卡界面会让他"记住人偶头上那个数字"——而画面里是一群一模一样的纯白人偶、
   *   什么都没印；合成出来的提示词是「编号最左边=凛…把编号全部去掉」，三道校验
   *   **全部通过**（正则找的是 `编号\s*最左边`，命中），于是零报错地花掉一发 r2v 的钱，
   *   而那一发正是发布前必须做的试炼。
   *   ⚠ 更狠的一层：漏了它，**升序排序也跟着丢**（排序依据就是这份清单的下标）——
   *   而顺序一乱就是"换错人 + 多出重复角色"，实测 5 个位子里错 3 个。
   * ★ TS 拦不住这种漏：少传一个可选字段没有任何症状 —— 所以它必须**先在这里有名字**，
   *   `adoptBlockoutTemplate` 那边才谈得上"忘了搬"会被看见。
   */
  markSlots?: VideoTemplate["markSlots"];
  /** 画面位置框（拖拽挂卡用）。与 markSlots 下标对齐，同批搬 */
  markBoxes?: VideoTemplate["markBoxes"];
  /** 人偶描述（写进套用提示词给 r2v 指认）。★ 类型里必须有名字 —— 没有的话
   *  `adoptBlockoutTemplate` 漏传它时 TS 连一声都不吭（CLAUDE.md 那条坑的原话）。
   *  ⚠ 它**不是** `roles[].desc`，理由写在 types.ts 的 markDescs 上 */
  markDescs?: VideoTemplate["markDescs"];
  /** 那些框量自第几秒 */
  markBoxAtSec?: VideoTemplate["markBoxAtSec"];
  /**
   * 分段组归属（长视频切段登记，2026-08-20）。★ 类型里必须有名字（CLAUDE.md 那条坑的
   * 原话）：`saveTemplate` 是 `{...t}` 展开、`adoptRemoteTemplate` 是逐字段搬 —— 这里
   * 没有名字的话，分段登记落进 `mine` 的每一段都会**静默丢掉组归属**，
   * `templateGroupOf` 判成单模板，「从任何一段套用都整组铺」当场退化成只铺一段，零报错。
   */
  group?: VideoTemplate["group"];
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

// ── 白模化（V2：任意视频 → 带标记的白模模板）──────────────────────
//
// 与 V1（作者自己已经有白模预演视频 → 上传 → 登记）是两条进货渠道，最大的差别是
// **这一条花真钱**：服务端要看几帧列出画面里有谁，再付费出一次 r2v edit 片把人全换成
// 白模人偶（2026-08-17 起是**全都一模一样的纯白色、身上不印任何东西**，此前印过数字、
// 也上过颜色，见 isOrdinalMark 上面那段复盘），产物转存之后才是模板。
// 所以这里的每一步都按"钱已经动了"来写。

// ── 白模化那一步「先看」会看几帧 ────────────────────────────────────
//
// ★★ 2026-08-15 之前这里是个写死的 `BLOCKOUTIZE_VISION_FRAMES = 3`（服务端 `VISION_FRAMES`
//   的跨仓镜像）。真机实测把它打掉了：一段 4 秒的素材，**前段 2 人、后段围坐群戏人更多**，
//   3 帧只认出 2 个人 → 登记的角色位是 1、2，而方舟出片时看到更多人、**自己往下编到了 3**。
//   结果画面上有 3 号、列表里却没有第 3 个角色位 —— 用户挂不上它，只会以为坏了。
//   ⇒ 帧数必须跟着素材走：短片也别只看 3 帧，人数会变的素材还要让用户自己指定看哪几帧。
//
// ★★ 这几个数是**服务端 `routes/branchTemplate.routes.js` 的跨仓镜像**，两边必须逐字相等：
//   它们是**报价的输入**（`economy.blockoutizeCost(frameCount, durSec)` 的前一半），
//   猜一个数就是本仓头号事故的形状 —— 页面按 6 帧报价、服务端按 3 帧扣钱，两个方向都不报错。
//   服务端改了公式就必须同步改这里（跨仓无法共码，契约见 docs/api-contract.md「白模模板」）。
// ★ 阶段一回包会带回**服务端真正看了几帧**（`BlockoutStartResult.frames`）：与本机这份
//   算出来的对不上时以服务端为准，并在进度里如实说一句（见 blockoutizeTemplate 的 ★★）。

/** 自动模式：每多少秒取一帧。★ 一帧几百 token（VISION_FRAME_TOKENS），比"漏掉一个人"便宜得多 */
export const BLOCKOUTIZE_FRAME_EVERY_SEC = 1.5;
/** 自动模式的下限。★ 4 秒的素材按 1.5 秒一帧只有 3 帧 —— 这是**下限兜住的**，不是巧合 */
export const BLOCKOUTIZE_FRAME_MIN = 3;
/** 帧数上限（自动与手挑**同一个**上限）。再多就是花钱买重复画面 */
export const BLOCKOUTIZE_FRAME_MAX = 8;

/**
 * 「自动」模式下这一段会看几帧 —— **跨仓镜像的唯一实现**（服务端按同一条式子算）。
 *
 * ★ `ceil` 不是 `round`：向下取整会让 5 秒的素材只看 3 帧，而漏认一个人的代价是
 *   "画面上有 3 号、列表里没有 3 号位"（用户挂不上，只会以为坏了）。多看一帧只多几百 token。
 */
export function autoVisionFrames(durSec: number): number {
  const n = Math.ceil(Math.max(0, durSec) / BLOCKOUTIZE_FRAME_EVERY_SEC);
  return Math.min(BLOCKOUTIZE_FRAME_MAX, Math.max(BLOCKOUTIZE_FRAME_MIN, n));
}

/**
 * 这一发**实际会看几帧** —— 报价、余额预检、界面文案共用的**唯一实现**。
 *
 * @param frameTimes 用户自己挑的那些时刻（相对选段起点的整数秒）。
 *   **`undefined` = 自动**：请求体里不带这个字段，帧数由服务端按时长算（那条式子在服务端，
 *   本机这份 `autoVisionFrames` 只是为了**报出同一个数**的镜像）。
 * ★ 传了空数组时返回 0 而不是退回自动：那种状态由 `arkVideoRules.selectionIssue` 当场
 *   拦住（"至少标 1 帧"），在这里悄悄退回自动会让**报价按自动的帧数、请求却带着空数组**，
 *   两边算的不是同一件事。
 */
export function visionFrameCount(durSec: number, frameTimes?: number[]): number {
  return frameTimes ? frameTimes.length : autoVisionFrames(durSec);
}

// ── 方舟 edit 的输入视频窗口，与白模路自己的输入下限 ──────────────────
//
// ★★ 为什么这两把尺子住在 data 而不是 `components/blockout/arkVideoRules`（它一直是
//   窗口②的家，现在改成从这里 re-export）：**store 层也要问同一个判据**
//   （flowStore.applyTemplate、segmentGen 的出片门禁），而 store 不该反过来 import 组件；
//   而且 arkVideoRules 自己 import 本模块（帧数镜像），把常量放回它那边、再让本模块
//   去 import 它就成环 —— Vite 下会拿到半初始化的模块（CLAUDE.md 那条 store 环坑同源）。
//   同一个理由已经让 `BLOCKOUTIZE_FRAME_MAX` / `BLOCKOUT_MAX_ROLES` 住在这里，见它们的 ★。

/**
 * 方舟 edit 对**输入视频**的窗口 —— 跨仓镜像（服务端 `middleware/upload.js` 的
 * `TEMPLATE_REF_RULES` / `templateRefIssue` 是唯一权威实现，这份只负责提前说人话）。
 *
 * 数值出处（2026-08-15 实测，纪要见 WM_V2_probe.md）：
 *   时长 [4,30]s   F1：超出**同步 400**（原文 "the video selected must satisfy the
 *                  duration requirement of 4 to 30 seconds"）
 *   ≥407,696 像素  F3：像素数硬门，官方文档没写，方舟直接拒单
 *   边长 [300,6000] / 宽高比 [0.4,2.5]   F3
 *
 * ★★ 这一份**永远是 4，不许抬**：它同时是「模板视频（= 白模化的**产出**）自己能不能被
 *   套用」的判据（`refVideoIssue`）。把它抬到 5，合法的 5s 输入产出 4.736s 就会被自己的
 *   门拒掉 —— 等于把唯一正确的用法也封死。输入那一侧的下限是下面 `BLOCKOUT_INPUT_RULES`。
 */
export const ARK_EDIT_RULES = Object.freeze({
  minSec: 4,
  maxSec: 30,
  minEdge: 300,
  maxEdge: 6000,
  minRatio: 0.4,
  maxRatio: 2.5,
  minPixels: 407_696,
});

/**
 * 实测：方舟 edit 的**产出比输入短**（2026-08-16）。
 *   4.00s → 3.712s（−0.288）　5.00s → 4.736s（−0.264）　14.04s → 13.67s（−0.370）
 * 最坏 0.37s，且**不随时长成比例**，像是固定的头尾帧损耗。
 *
 * ★★ 这是**观测值不是协议**：只准用来给用户估一句"大概会剩多少秒"，**绝不许**拿它去
 *   算门槛（门槛是下面那个整数 5，本身就留了约两倍余量）。方舟哪天多裁一点，5 还成立，
 *   这个数会过时 —— 把它写进判断就等于把一个会变的观测值钉成了协议。
 */
export const EDIT_SHRINK_WORST_SEC = 0.37;

/**
 * 白模这条路对**输入片段**的时长下限（秒）。
 *
 * ★★ 这个 5 **不是方舟的窗口**（方舟永远是 [4,30]，见上），是「产出还要能当下一发的
 *   输入」推导出来的**白模路自我约束**：edit 的产出比输入短，而白模化的产出**本身就是
 *   模板视频**，别人套用时它又要当 r2v 的输入 —— 4 秒进去只剩 3.7 秒，低于方舟自己的
 *   4 秒下限，**谁都套用不了**。2026-08-16 线上 6 个模板里有 3 个已经是这个状态：
 *   作者付了钱、模板建出来了、能核对能发布，而每一个想用它的人都失败，作者永远不知道为什么。
 * ★ 为什么是整数、为什么是 5：服务端 zod 的 `durSec` 是 int、Cloudinary 变换的 `du_`
 *   只认整数、编辑页时间轴全程整数秒 —— 候选只有 4（已知坏）和 5。5 的余量
 *   1.0 − 0.37 ≈ 0.63s，约为最坏观测值的两倍。
 * ★★ 权威实现在服务端（`middleware/upload.js` 的 `BLOCKOUT_INPUT_RULES` /
 *   `blockoutInputIssue`）。App 这一份是**预检 + 换人话**，不是第二份判据。
 */
export const BLOCKOUT_MIN_INPUT_SEC = 5;

/** 白模**输入片段**的完整窗口 = 方舟那份、只把时长下限换成 5。其余六条逐字相同，
 *  所以 `selectionIssue` 的另外六条继续读同一组数，不会两份一起漂。 */
export const BLOCKOUT_INPUT_RULES = Object.freeze({ ...ARK_EDIT_RULES, minSec: BLOCKOUT_MIN_INPUT_SEC });

/** 「这 N 秒进去，产出大概剩多少秒」——只用来说话（见 EDIT_SHRINK_WORST_SEC 的 ★★） */
export function shrunkSecText(inputSec: number): string {
  return Math.max(0, inputSec - EDIT_SHRINK_WORST_SEC).toFixed(1);
}

/**
 * 从模板视频的地址派生一张**封面帧**（jpg）。拿不到就返回 ""。
 *
 * ══ 为什么用派生而不是另存一张封面（2026-08-17）══════════════════════════
 * 「自己传白模视频」那条路建出来的模板 `cover` 一直是空串 —— 于是「我的模板」里
 * 那张卡是**纯黑**的，详情页的参考视频在点播放之前也是**纯黑**（Android WebView 下
 * `<video>` 没有 poster 就不画首帧）。两处是同一个缺口。
 * 补一张真封面要多一次抓帧 + 上传 + 存储，而我们手上已经有那段视频在 Cloudinary 上，
 * 它本来就能按 URL 投递任意一帧 —— 零存储、零上传，而且**永远与视频一致**
 * （换了视频封面自动跟着变，不会出现"封面还是上一版"）。
 *
 * ★ 取第 1 秒而不是第 0 帧：很多片子第一帧是黑场/淡入，取 0 会得到一张黑图 ——
 *   那正是这个函数要解决的问题本身。
 * ★ 只认规范形态的上传地址（`/video/upload/` 且没有别的变换）：这一位存的是服务端
 *   写进库的 `secure_url`，形状是固定的。匹配不上就返回 "" —— 宁可没有封面，
 *   也不要拼一个 404 的地址（那会让卡片从"黑的"变成"破图标"，更难看也更难查）。
 * ★ 宽度 640：卡片与详情页都用得上，再大只是白下载。
 */
export function refVideoPoster(ref: VideoTemplate["refVideo"]): string {
  const url = ref?.url ?? "";
  const at = url.indexOf("/video/upload/");
  if (!url.startsWith("https://") || at < 0) return "";
  const head = url.slice(0, at + "/video/upload/".length);
  const tail = url.slice(at + "/video/upload/".length);
  // 已经带了变换（含 `,` 或以 `so_`/`w_` 之类开头的那一段）就不碰它 —— 我们只认规范形态
  if (/^[a-z]{1,3}_[^/]*\//.test(tail)) return "";
  const noExt = tail.replace(/\.[a-z0-9]+$/i, "");
  return `${head}so_1,w_640/${noExt}.jpg`;
}

/**
 * 模板视频文件的**真实**时长（秒）。缺 = 老数据/老服务端，返回 null（**当好**，不是当坏）。
 * ★ 它不是计价锚点（那是 `refVideo.durationSec`），只用于如实展示与下面这条判据。
 */
export function refVideoRealSec(ref: VideoTemplate["refVideo"]): number | null {
  const v = ref?.realDurationSec;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * 「这个白模模板的**模板视频本身**能不能拿去出片」—— **客户端唯一判据**（铁律六）。
 * null = 能；否则是一句**能直接显示给用户的整句原因**（铁律八：不让用户点一个必然
 * 失败、还要扣一次心跳的按钮，也不让它灰着不说话）。
 *
 * ★★ 判的是 `realDurationSec ?? durationSec`，尺子是 `ARK_EDIT_RULES`（**4，不是 5**）：
 *   一个 4.0s 的模板完全能用；5 是**输入**那一侧的下限，拿它来判模板会把合法模板拒掉。
 * ★★ 后加字段一律**存在性 + 否定式**：`realDurationSec` 缺失（存量 V1 与老 V2 都没有）
 *   一律退回锚点、判不出坏就当好。反过来写会在上线那一刻把整个市场判成不可用，且零报错。
 * ★ 服务端也会判（`ark.routes.js` 的 resolveR2v、发布闸）。这一层不是安全边界，
 *   只是"别让用户白花一次钱、白等一次失败"。
 */
export function refVideoIssue(ref: VideoTemplate["refVideo"]): string | null {
  if (!ref) return null; // 经典配方模板：这条规则与它无关
  const R = ARK_EDIT_RULES;
  const sec = refVideoRealSec(ref) ?? ref.durationSec;
  if (!Number.isFinite(sec) || sec <= 0) {
    // ★ 报价锚点缺失。**不许静默当 0** —— 那会让详情页显示"参考视频 0s""套用一次约
    //   0 token"，用户一路点下去到方舟那儿才失败，全程一个错都不报。
    return "服务器没有返回这个模板的参考视频时长，算不出套用一次要花多少 token，也没法确认它能不能出片。请下拉刷新重试；一直这样就把这句话反馈给我们。";
  }
  if (sec < R.minSec) {
    return `这个白模模板的模板视频只有约 ${Math.floor(sec * 10) / 10} 秒，短于 AI 出片引擎的 ${R.minSec} 秒下限，用它出片一定会失败，所以这里不让你白花钱。请换一个模板。`;
  }
  if (sec > R.maxSec) {
    return `这个白模模板的模板视频约 ${Math.ceil(sec * 10) / 10} 秒，超过 AI 出片引擎的 ${R.maxSec} 秒上限，用它出片一定会失败。请换一个模板。`;
  }
  return null;
}

/**
 * 同一条判据**对作者本人**的说法（详情页 isOwner 时）。null = 这个模板没毛病。
 *
 * ★ 不是第二处判断：先问 `refVideoIssue`，它说没事就没事。只有措辞不同 ——
 *   对套用者要说"换一个模板"，对作者要说清**这不是他操作错了**，以及重做时怎么才对。
 *   线上那 3 条坏模板的作者反复试炼、反复撞方舟的英文 400（那些是同步 400，服务端
 *   原路退了费，所以他们**没在重试上损失 token**，损失的是时间和信任）—— 这句话要把
 *   这件事说清楚。
 */
export function refVideoOwnerNote(ref: VideoTemplate["refVideo"]): string | null {
  if (!refVideoIssue(ref)) return null;
  const sec = refVideoRealSec(ref) ?? ref?.durationSec;
  const secText = typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? `只有约 ${Math.floor(sec * 10) / 10} 秒，` : "";
  return `这个模板的白模视频${secText}不满足 AI 出片引擎要求的 ${ARK_EDIT_RULES.minSec}~${ARK_EDIT_RULES.maxSec} 秒，所以它没法用来出片，也不能发布。这是我们当时的校验漏掉了，不是你操作错了——你之前那几次试炼失败都没有扣费。请重新做一个模板：框选时至少选 ${BLOCKOUT_MIN_INPUT_SEC} 秒（AI 换白模时会把成片截短零点几秒，得留出这个余量）。`;
}

// ── 一个模板最多有几个「能挂卡」的角色位 ────────────────────────────

/**
 * **跨仓镜像**：服务端白模化时最多编到这个数，核对端点（`PATCH /templates/:id/roles`）
 * 收的条数上限也是它（server `schemas/branchTemplate.schemas.js` 的 `roles` 数组上限），
 * 两边必须逐字相等 —— 契约见 docs/api-contract.md「白模模板」。
 *
 * ★★ 9 不是技术上限，是**看得清的上限**（2026-08-15 实测）：12 个角色位时标记照样画得出来，
 *   但画面上人眼能稳定认出的只有 4~5 个。再往上加只会造出一堆"看不见、挂不上"的位子——
 *   用户对着列表里的 11 号在画面里找半天，找不到，只会以为坏了（而全程零报错）。
 * ⚠ 颜色方案下这个 9 还多一层**没验过的风险**：白模化提示词按 9 人算约 709 字，而实测
 *   594 字通过、605 字就开始顶穿预算（抹外观那几句先垮）。也就是说 6 人以上已经在
 *   出过问题的长度区间里。这个数是**跨仓的**（服务端白模化最多编到它，PATCH 收的条数
 *   上限也是它），改它是另一次跨仓决策，本次不动 —— 产品侧用文案劝到 5 人以内。
 * ★ 参考图预算**不是**瓶颈：9 个角色位 × 每卡最多 2 张 = 18 张，而方舟 2.5 收 30 张
 *   （`ai/real.ARK_REF_IMAGES_MAX`）。所以这个 9 纯粹由"画面上认不认得出"这一条定，
 *   别拿参考图预算去推它 —— 那两个数各有各的依据，绑在一起改一个就会悄悄动到另一个。
 * ⚠ 服务端还没跟上这个数时，模板可能带回多于 9 个角色位：那时多出来的**照样显示**
 *   （画面上真有那个标记），只是挂不了卡 —— 见 `splitCastRoles` 与 RoleCastBoard。
 */
export const BLOCKOUT_MAX_ROLES = 9;

/**
 * 「这段素材里有没有一个**压倒性的角色**」—— 有就返回一句给作者看的整话，没有返回 null。
 *
 * ⚠⚠⚠ **现在全仓零调用，而且这份判据已经被实测推翻。别原样接回任何界面。**
 *   ① 零调用是有意的，不是漏接：挂卡面板上那条黄色警告是用户**明确要求删掉**的
 *      （每次挂卡都出现、又给不出下一步的提醒 = 背景噪音）；登记完那一屏也没有接。
 *      函数体留着只为一件事 —— 别把下面那几发付费实测的**结论**跟着实现一起删掉。
 *      （曾经的注释在这里写着"登记那一屏与挂卡面板读的是同一个函数"，那是**旧行为**。）
 *   ② **它抓的是错的那个变量**（2026-08-17，又六发付费实测）：把那个红色主舞
 *      **推到画面边缘**之后，它**没有**被选中；而"居中"单拎出来也不足以决定胜负。
 *      ⇒ "颜色跟别人不一样"只是**伴生现象** —— 08-17 那段素材里"红色"和"主角"恰好
 *      是同一个人，于是判颜色看起来很准。下面这份实现判的正是颜色异类，它准的是那个巧合。
 *   ③ 要重新启用，判据得换成「**画面里有没有一个明显居中、且占画面比例大的人**」
 *      （位置 + 面积一起看，颜色出局）。**但那两个阈值现在标不出来**：面积那条 08-17
 *      量过（见下），两个样本挨得太近划不出线；位置那条一个实测数都还没有。
 *      ⇒ **先补实测再定阈值**，别把下面这份颜色实现改个名字接着用
 *      （本仓纪律：数值不许拍脑袋）。这也是这次只改注释、**不动实现**的原因：
 *      改判据需要新的一轮标定，那是另一件事。
 *
 * ══ 证据①：序数在有主角的素材上会失效（2026-08-17，四发付费实测 ¥35.2）══════
 * 在「都市主角群舞转场」这段素材上（7 个人偶，其中一个是**红色**主舞）连打四发：
 *   ① 单个序数点名红色主舞      → 换的是红色 ✅
 *   ② 跨分镜、单个序数点名红色  → 换的是红色 ✅
 *   ③ 单个序数点名一个**白模**  → 换的仍是**红色** ❌
 *   ④ **按时间区间分段**、每一镜各写对序数、点名一个白模 → 换的仍是**红色** ❌
 * 四发合起来只有一个解释：**在这段素材上序数根本没起作用，赢的永远是那个最显眼的角色**。
 * ①② 之所以看起来"对"，只是因为点名的恰好就是它 —— 那两发是假阳性。
 * 对照：公园那段（5 个一模一样的白模、单镜头、没有主角）用最朴素的单个序数 12/12 全对。
 * ⇒ 决定成败的不是分镜、不是提示词写法，是**画面里有没有一个压倒一切的角色**。
 *   这条结论 08-18 复测仍然成立 —— 被推翻的是下面"怎么认出那个角色"这一步。
 *
 * ══ 证据②：单看颜色不成立，单看居中也不成立（六发 + 三发 + 一次量框）════════
 * · 把红色主舞**推到画面边缘**：它没被选中（颜色照旧异类，结果变了 ⇒ 颜色**单独**不成立）。
 * · 2026-08-18 量框推翻了接替它的那个猜测：对照组（公园，序数全对）**比出事那段更居中**
 *   （最居中偏移 12 vs 34），面积也分不开（1.10x vs 1.27x），而且群舞里最大的那个是
 *   **最右边**那个白模、不是红色的 ⇒ 居中与占比**单独**也都不成立。
 * ⇒ 成立的是**合取**：颜色异类 **∧** 它就在画面正中。判据落在 `prominentRoleWarning`。
 *
 * ══ 已经量过的数（留给下一次标定，别重复花钱）══════════════════════════
 * · 框面积：公园 最大/中位 = **1.10**；群舞 = **1.27**。太近，且指向的是另一个人 ⇒ **否决**。
 * · 居中度：公园 最居中偏移 **12**、与次居中之比 0.07；群舞 **34**、比值 0.26 ⇒ 方向是**反**的。
 * · 外观众数：群舞 白,白,白,红,白,白 → 恰好一个例外 → 命中；公园 5 个全米白 → 没有例外 → 不命中。
 * ⚠ 它只能是**尽力而为**的提示，与帧角水印探测同一性质：漏报 = 退回现状（不多说一句话），
 *   误报 = 作者看到一句可以忽略的提醒。所以措辞里必须写明"看错了直接忽略"，绝不能写成断言。
 */
const COLOR_WORDS = ["白", "红", "橙", "黄", "绿", "青", "蓝", "紫", "粉", "黑", "灰", "金", "银", "棕"];

/** 一条描述里**第一个**出现的颜色词 —— 它就是这个人的"主色"。没有颜色词返回 "" */
function primaryColor(desc: string): string {
  let best = "";
  let at = Infinity;
  for (const c of COLOR_WORDS) {
    const i = desc.indexOf(c);
    if (i >= 0 && i < at) {
      at = i;
      best = c;
    }
  }
  return best;
}

/**
 * `markDescs[i]` 那一句 → 主色词（"红"/"白"/…，"" = 认不出）。
 *
 * ★ 这是 `primaryColor` 的**公开出口**，给套用提示词按颜色点名用（blockoutPrompt 的
 *   keyOf）。「谁是颜色异类」的警告（prominentRoleWarning）与「按什么颜色点名」**必须是
 *   同一份词表、同一条实现** —— 分开写的话，警告说它是"红"、提示词却点名"橙色人偶"，
 *   两边各自看着都对，合起来指了个不存在的人。
 * ★ 取**第一个**颜色词是安全的：服务端 composeRosterDesc 拼的顺序是「颜色、动作、位置关系」，
 *   颜色永远在最前 —— 地标里的颜色（"在红人偶右侧"）不会顶掉它自己的主色。
 */
export function markColorOf(desc: string): string {
  return primaryColor(desc);
}

/** 少于这个人数不判：两三个人的画面里"一个不一样"是常态，不是压倒性主角 */
const DOMINANT_MIN_ROLES = 4;

/**
 * 「这段素材里有没有一个会把挂卡抢走的人」—— 判据是**颜色异类 ∧ 就在画面正中**，两个都要。
 *
 * ══ 为什么是这个合取（2026-08-18 量完才敢定，九发实拍 + 一次几分钱的量框）═════════
 * 此前两次都判错了方向，两次都是**只看了一半证据**：
 *   · 一开始判「颜色异类」→ 被 #46 第 5、6 发推翻（红色被裁到**边缘**后目标就换对了，
 *     颜色照旧异类 ⇒ 颜色**单独**不成立）；
 *   · 于是改判「居中 + 占比大」→ 08-18 量完当场推翻：对照组（公园，5 个一模一样的
 *     米白人偶，序数全对）**比出事那段更居中**。
 * 真数（同一发量框，`markBoxes` 的口径）：
 *   ┌ 群舞（三发都栽）  最居中偏移 **34**、与第二居中之比 0.26、最大面积/中位 1.27x、6 白 + **1 红**
 *   └ 公园（对照，全对）最居中偏移 **12**、与第二居中之比 0.07、最大面积/中位 1.10x、5 个全米白
 * ⇒ 居中度**反着**（对照组更居中）、面积分不开（而且群舞里最大的那个是**最右边**那个白模，
 *   不是红色的 —— 拿面积当信号会直接指错人）。能把两段分开的只剩**颜色异类**。
 * ⇒ 合起来解释得了全部九发：**颜色异类 + 它在正中 → 出事；异类被推到边缘 → 没事；
 *   没有异类（哪怕有人很居中）→ 没事**。
 *
 * ★★ 面积那一维**量过并被否决**，别再捡回来（1.27 vs 1.10 划不出线，且它指向的是另一个人）。
 * ★ 只在有 `markBoxes` 时才判：没有框就答不了"在不在正中"，而拿颜色单独下结论正是
 *   上一次判错的那一步。没框 = 不说话（漏报比误报便宜，见下）。
 * ⚠ 它是**尽力而为**的提示，不是闸：漏报 = 退回现状（不多一句话），误报 = 作者看到一句
 *   可以忽略的提醒。所以措辞里必须有"看错了直接忽略"，绝不能写成断言。
 *
 * @returns null = 没看出问题（也可能是判不了）；否则是一句可直接显示的整句
 */
export function prominentRoleWarning(
  roles: ReadonlyArray<{ label: string; desc: string }>,
  slots: readonly string[] | undefined,
  markBoxes: readonly MarkBox[] | undefined,
): string | null {
  const boxes = markBoxes ?? [];
  if (roles.length < DOMINANT_MIN_ROLES || !slots?.length || boxes.length !== slots.length) return null;
  const list = roles.filter((r) => r.desc);
  if (list.length !== roles.length) return null; // 有人没描述 —— 判不了，别猜
  const colors = list.map((r) => primaryColor(r.desc));
  if (colors.some((c) => !c)) return null;
  const tally = new Map<string, number>();
  for (const c of colors) tally.set(c, (tally.get(c) ?? 0) + 1);
  // ★ 「恰好一个例外」：众数占了除一人以外的全部。放宽到"两个例外"会把"两个主角对打"
  //   这种正常构图也报进来，而那类素材我们没有任何实测
  let modal = "";
  let modalN = 0;
  for (const [c, n] of tally) if (n > modalN) [modal, modalN] = [c, n];
  if (modalN !== list.length - 1) return null;
  const oddAt = colors.findIndex((c) => c !== modal);
  const odd = list[oddAt];
  const box = boxes[slots.indexOf(odd.label)];
  if (!box) return null;
  // ── 第二个条件：这个异类**就是最居中的那个**，而且中得明显 ──────────────
  const offs = boxes.map((b) => Math.abs(b.cx - 500));
  const mine = Math.abs(box.cx - 500);
  const others = offs.filter((_, i) => boxes[i] !== box).sort((a, b) => a - b);
  // ★ 两个数都来自上面那次量：群舞的异类 34（≤150 ✓）且 34 ≤ 129/2 ✓；
  //   「≤ 次居中的一半」这一条是要它**明显**居中 —— 一堆人挤在中间时谁都不算主角
  if (mine > CENTER_MAX_OFF || mine * 2 > (others[0] ?? Infinity)) return null;
  // ★ 纯文本、不带 markdown 星号：调用方是直接塞进 JSX 的。
  // ★★ 2026-08-18 第二版措辞：第十一发（用户在同一段素材上实跑）之后，「给它也挂上卡」
  //   从猜测升级成了**有实证的出路**（出片时会按「红色人偶」点名它，见 blockoutPrompt 的
  //   keyOf）——所以这句话现在给的是两条真能做的事，而不是只叫人重做。
  return (
    `这段素材里有 ${modalN} 个人偶是「${modal}」色的，只有「${odd.label}」是「${colors[oddAt]}」色的，` +
    `而且它就站在画面正中间。实测：不给它挂卡的话，出片时它也会被换成别人（AI 自己挑一张）。` +
    `最稳的做法是给它也挂上一张卡——出片时会直接按「${colors[oddAt]}色人偶」点名它，` +
    `同一张卡可以挂在多个位子上；或者拿原视频重走一遍「AI 白模化」，人偶全变纯白就没有这个显眼的人了。` +
    `看错了直接忽略。`
  );
}

/** 「就在正中间」的容忍度（千分比，画面中心是 500）。★ 群舞那个异类量出来是 34；
 *  给到 150 是留余量，再大就不该叫"正中间"了（1000 分的画面，±150 已经是中间那一段） */
const CENTER_MAX_OFF = 150;

/**
 * ⚠⚠ **旧版，零调用，判据不完整**（只判颜色，被 #46 第 5、6 发推翻）——
 * 留着只是为了让"为什么不能只判颜色"这段复盘有个落点。新的判据是
 * `prominentRoleWarning`（颜色异类 ∧ 居中），别再接这一个。
 */
export function dominantRoleWarning(roles: VideoTemplate["roles"]): string | null {
  const list = (roles ?? []).filter((r) => r.desc);
  if (list.length < DOMINANT_MIN_ROLES) return null;
  const colors = list.map((r) => primaryColor(r.desc));
  if (colors.some((c) => !c)) return null; // 有人没写颜色 —— 判不了，别猜
  const tally = new Map<string, number>();
  for (const c of colors) tally.set(c, (tally.get(c) ?? 0) + 1);
  // ★ 「恰好一个例外」：众数占了除一人以外的全部。放宽到"两个例外"会把
  //   "两个主角对打"这种正常构图也报进来，而那类素材我们没有任何实测
  let modal = "";
  let modalN = 0;
  for (const [c, n] of tally) if (n > modalN) [modal, modalN] = [c, n];
  if (modalN !== list.length - 1) return null;
  const odd = list[colors.findIndex((c) => c !== modal)];
  if (!odd) return null;
  // ★ 纯文本，**不带 markdown 星号**：这句话是要被直接塞进 JSX 的（删掉的那处调用方就是
  //   `{dominantNote}`），写 `**…**` 会原样显示成星号。将来重新接的话也保持这一条 ——
  //   要加粗由调用方拆句子，不在这里混排版
  return `这段素材里有 ${modalN} 个人偶是「${modal}」的，只有「${odd.label}」不是（${odd.desc}）。实测这种情况下，挂卡多半会挂到那个最显眼的人身上——不管你挂给谁。出片后请对着画面核对一遍。看错了直接忽略。`;
}

/**
 * 角色位 → 「能挂卡的」与「超出上限的」两摞。**唯一实现**：挂卡面板（渲染那一处）与
 * `flowStore.applyCast`（真正落 materials 那一处）问的是同一个函数。
 *
 * ★ 为什么不在收模板那一层就把多出来的**扔掉**：画面上那些人偶身上真的带着标记，
 *   列表里悄悄消失的话，用户看见它却在列表里找不到，只会以为坏了。摆出来 +
 *   说清"它保持人偶原样、挂不了卡"，才是诚实的降级（铁律八）。
 * ★ 收 `roles` 的行内形状而不是组件里那个 `TemplateRole` 别名：那个别名定义在
 *   `components/blockout/arkVideoRules`，data 层 import 组件会把依赖方向掉个个儿。
 */
export function splitCastRoles(roles: NonNullable<VideoTemplate["roles"]>): {
  castable: NonNullable<VideoTemplate["roles"]>;
  extra: NonNullable<VideoTemplate["roles"]>;
} {
  return { castable: roles.slice(0, BLOCKOUT_MAX_ROLES), extra: roles.slice(BLOCKOUT_MAX_ROLES) };
}

// ── 角色位标记是「序数」还是「编号」──────────────────────────────
//
// ★★ 2026-08-17 起新做的白模模板：人偶**全都是一模一样的纯白色**，身上不印任何东西，
//   套用时靠**序数措辞**（「最左边」「从左数第3个」「最右边」）指认。此前走过两代：
//   ① **在人偶头上印阿拉伯数字**（存量线上 6 个模板都是这一代，其中 2 个好用、还在被人套）。
//      失败形状全是实测：5 个角色位从来没有一发 5/5 全对（最好 4/5，且带重号：实出过
//      2/2/1/1/5）；「头部前后左右四面各印同一个数字」**从没被执行过**（每发只印一面、
//      哪一面还不可控，改成"镜头转到哪面印哪面"之后同一个人偶正面 1/1/3、背面 2/3/3，
//      无法仲裁）；编号还会被逐帧**原样复刻进成片**（实拍：换上去的角色后脑顶着「1」），
//      所以套用提示词必须额外加一句「把编号全部去掉」才修得好。
//      根因：这个模型把数字当"贴在当前这一帧上的二维贴纸"，**不维持跨帧对象恒等性**。
//   ② **一位一色**（人偶通体一色）。它确实消掉了上面两个老毛病（颜色是材质，任何角度都对），
//      但命中率只有 ~57%（同素材同参数 7 发 4 发全对），失败形状高度一致：画面正中央那个
//      "最像主角"的根本没被抹掉、相邻两色互换。根因是白模化那一步要模型**同时维持 5 组
//      "人↔颜色"绑定**。⚠ 这一代**从没产出过任何线上模板**（markColors 非空的模板数 = 0、
//      在途凭据 = 0），所以 2026-08-17 整档删掉，不留任何运行期分支。
// ★★ 全白为什么更好：它把"做出区分"换成了"**不要有任何区分**" —— 不需要维持任何绑定。
//   提示词 406 字（彩色版 590），实测是所有版本里**抹得最干净的一版**（无头发/五官/衣服/记号）。
//   而套用侧用序数指认的实测成绩：2 组绑定 2/2、复跑 2/2、5 组满负载 5/5、3 组跳着挂 + 留 2 个
//   空位 5/5 —— **升序累计 12 组绑定零错误**。
// ★★★ 但这条成绩有一个**硬前提**：指令必须**按位置从左到右升序书写**。同样 3 张卡、同样
//   3 个目标位置，只把书写顺序从 (第2→最右→第3) 改成 (第2→第3→最右)，结果就从 **2/5 变成
//   5/5**（乱序那一发还多出一个重复角色）。机理：这个模型是在**对齐两个序列**（指令序列 ↔
//   画面从左到右的序列），不是在解析符号。升序排序的唯一实现在
//   `studio/blockoutPrompt.orderSlots`，依据就是 `markSlots` 的下标。
// ⚠ 序数**不是"修好了"**：AI 分配的"第几个"仍然只是猜测，作者核对/删位那一整套机制必须
//   **保留**并跟着改文案。而且序数多了一条前两代都没有的失效模式：**删掉一个位子之后，
//   它右边那些位子的序数会变**（画面上少了一个人偶）—— 核对面板必须明说这一条。
//
// ★★★ **序数措辞（第 k 个该怎么说）在本仓一份都没有，也永远不许有。** 唯一实现在服务端
//   （`blockoutize.service.ordinalSlots`）：App 侧的**文字**一律来自 `roles[].label` 或
//   `markSlots[i]`（服务端给的字符串，原样显示、原样写进提示词），**顺序**一律来自
//   `markSlots.indexOf(label)`。于是"两边相等"从靠约定变成**结构上不可能不等**
//   —— 这比 `BLOCKOUT_MAX_ROLES` 那种镜像强一档（那一个今天其实并没有测试钉住两边）。
//   ⚠ 本仓全仓无测试框架（无 `*.spec.ts`），这条只能靠这段注释 + 契约文档 + review 兜。
//   看到有人在本仓加一个 `["最左边","从左数第2个",…]` 数组、或者任何"按下标算措辞"的
//   函数，就是这条设计被推翻了 —— 回来改这段注释再动手。
//   ★ 这条禁的是**当数据用的**措辞。界面文案里举例说「别人给「最左边」挂的卡…」
//     是**举例**，不参与任何判断、改措辞表也不会让它算错，别顺手把它们也删了。

/**
 * 「这个模板的角色位标记是序数吗」—— **全 app 唯一实现**（提示词、核对面板、挂卡面板、
 * flowStore 的错误文案，全部问它，谁都不许自己判一遍）。
 *
 * ★★ 判据是**存在性**：只有明确带着一份非空的 `markSlots` 才算序数方案，缺失 / 空数组 /
 *   null 一律回落编号方案。线上那 6 个老模板（其中 `都市主角群舞转场`、`宗主垫脚舞`
 *   还在被人用）天然没有这一位 → 判成编号 → 套用走老提示词（含那句「把编号全部去掉」）
 *   → 一个字都不受影响。反过来写成 `!== "number"` 会把存量整批翻面，画面上人偶头上明明
 *   印着号、提示词却说「最左边=凛」——**当场作废且零报错**，这是本次改动的头号红线。
 * ★ 收 `Pick` 而不是整个 `VideoTemplate`：flowStore 的模板快照、编辑页的入参都是只带
 *   几个字段的形状，让它们也能问同一个函数（而不是各自 `!!x.markSlots?.length` 一遍）。
 */
export function isOrdinalMark(t: Pick<VideoTemplate, "markSlots"> | null | undefined): boolean {
  return !!t?.markSlots?.length;
}

/**
 * 一个模板的标记方案 **+ 它那份顺序表**，收成一个判别联合。
 *
 * ★★ 为什么不是光返回 `MarkScheme`：序数方案下"怎么排序"与"能选哪几个位置"都要那份
 *   `slots`，而它与方案位是**同一件事**。分成两个参数传（`mark` + `markSlots`）就允许
 *   出现"序数方案但没有顺序表"这种在类型上合法、在运行期必然排错序的状态 ——
 *   而排错序的后果是换错人 + 多出重复角色，零报错。收成判别联合之后它在类型上不可表达。
 * ★ `slots` 非空由这个函数保证（判据只有 isOrdinalMark 一处），下游可以直接用。
 */
export type MarkSpec = { scheme: "number" } | { scheme: "ordinal"; slots: string[] };

export function markSpecOf(t: Pick<VideoTemplate, "markSlots"> | null | undefined): MarkSpec {
  return isOrdinalMark(t) ? { scheme: "ordinal", slots: t!.markSlots! } : { scheme: "number" };
}

/**
 * 界面上称呼这个标记的那个名词 —— **一处实现**（标题、按钮、错误句、提示语都取它）。
 * ★ 别在组件里写 `isOrdinalMark(t) ? "位置" : "编号"`：那就是同一条规则的第 N 处实现，
 *   哪天多出第三种方案时改不干净（而改漏了只表现为某一屏说错名字，没有任何报错）。
 */
const MARK_NOUN: Record<MarkScheme, string> = { number: "编号", ordinal: "位置" };

export function markNoun(spec: MarkSpec): string {
  return MARK_NOUN[spec.scheme];
}

/**
 * 这个角色位在画面上的位置框 —— 没有位置数据就回 null（调用方退回点列表）。
 *
 * ★★ **唯一的连接键是 `markSlots.indexOf(label)`**：框挂在"位置"上、不挂在角色位上。
 *   作者在核对面板把某一行改成「从左数第3个」，落点自动跟着走，两者结构上不可能不一致。
 * ★ 长度对不上时 `markBoxesOf` 已经在收货那一层整份丢掉了，所以这里只做一次查表。
 */
export function boxOfLabel(
  t: Pick<VideoTemplate, "markSlots" | "markBoxes"> | null | undefined,
  label: string,
): MarkBox | null {
  const i = t?.markSlots?.indexOf(label) ?? -1;
  return (i >= 0 ? t?.markBoxes?.[i] : undefined) ?? null;
}

/**
 * 这个角色位在**白模视频里**长什么样 —— 没有就回 ""（套用提示词不拼那个括号）。
 *
 * ★★ 连接键与 `boxOfLabel` **逐字相同**（`markSlots.indexOf(label)`）：描述也挂在"位置"上、
 *   不挂在角色位上。作者在核对面板把某一行改成「从左数第3个」，描述自动跟着走。
 * ★ 回 "" 而不是 null：调用方只关心"有没有话可说"，两个空值形状只会让判断多一种写法。
 * ⚠ **不要拿 `roles[].desc` 兜底**。那一位说的是「这个位子原来是谁」，白模化（V2）那条路
 *   它来自原片（「白发黑袍的少年」）—— 兜底进提示词就是让模型照着白模化**之前**那个人画，
 *   而参考视频里站着的是一个白人偶。缺了就是缺了，退回"只有序数"的老形状。
 */
export function markDescOfLabel(
  t: Pick<VideoTemplate, "markSlots" | "markDescs"> | null | undefined,
  label: string,
): string {
  const i = t?.markSlots?.indexOf(label) ?? -1;
  return (i >= 0 ? t?.markDescs?.[i] : "") || "";
}

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

// ── 两阶段与「掉线可恢复」────────────────────────────────────────
//
// ★★ 白模化 2026-08-15 起是**两阶段**的（此前是一条同步等到底的长请求）：
//     ① `startBlockoutize`   服务端做完归属校验/拼变换 URL/预热/看帧/发 r2v，落一条**凭据**；
//        —— 钱在这一刻花掉（看帧 + r2v 受理，受理后失败不退）
//     ② 客户端**轮询**既有的 `GET /api/ark/contents/generations/tasks/:id`（不计费、
//        已有独立限流桶）等出片；**不新造轮询端点**
//     ③ `finishBlockoutize`  服务端自己向方舟核实 → 转存产物 → 建模板
//   拆的理由：手机切后台、弱网断线、App 进程被系统回收、nginx 超时掐断，任何一条都会让
//   用户**丢掉这一发的结果，而钱已经花了**。两阶段让"结果"变成一件可以再来取的东西。
//
// ★★ 所以这一段代码里**最重要的不是主路径，是恢复路径**：拿到凭据之后，无论中间发生
//   什么，用户都必须能从「我的模板」把结果领回去（`pendingBlockoutJobs` + `resumeBlockoutize`）。
//   没有那个入口的话，两阶段就白拆了 —— 反而比同步版多了一处会丢结果的地方。

/**
 * 凭据的有效期 —— **24 小时，不是 48**。
 *
 * ★★ 这个数不是拍脑袋的时限，是**方舟产物的物理寿命**：产物 URL 是 TOS 签名地址，
 *   24h 过期（F12）。过了这个点，服务端拿着 jobId 也拉不到那段视频了 ——
 *   这一发的钱**无法挽回**，不是"稍后再来"。文案不许粉饰（见 blockoutJobNote）。
 * ★ 只在**服务端没给 expiresAt** 时才用它兜底推算；有 expiresAt 一律以服务端那份为准
 *   （本机时钟可能是错的，而"还能不能取"由服务端说了算）。
 */
export const BLOCKOUT_JOB_TTL_MS = 24 * 3600_000;

/** 一发**已经付过钱、但还没取回结果**的白模化（服务端 BlockoutJob 的镜像） */
export interface BlockoutJob {
  /** 阶段二只认它。★ 归属在服务端按 ownerId 判 —— 别人拿到 jobId 也取不走 */
  jobId: string;
  /** 方舟任务号（轮询用）。空 = 服务端没给，那就直接去 finish，由服务端向方舟核实 */
  taskId: string;
  /** 计价口径：服务端真正拿去拼变换 URL 的那个时长 */
  durSec: number;
  title: string;
  /** 看帧那一步的角色位**草案**（标记仍是猜测，建成模板后作者还要核对一次） */
  roles: { label: string; desc: string }[];
  /**
   * 这一发白模化**当时真正算出来的**那份序数清单（存在性 = 序数方案，同模板那一位）。
   *
   * ★★ 为什么凭据上也要存一份、而不是等它变成模板再说：白模化提示词在**阶段一**就发出去了，
   *   凭据 TTL 24 小时 —— 发版正好夹在两阶段之间时，只有"凭据里记着当初发的是哪一套"
   *   才能保证 finish 出来的模板与那段视频真正的样子一致。在途的老凭据没有这一位 →
   *   finish 出编号方案模板 → **正确**（它的视频上印的确实是数字）。
   */
  markSlots: NonNullable<VideoTemplate["markSlots"]>;
  /** 失效时刻（ms，服务端说了算）。0 = 服务端没说，按 createdAt + TTL 兜底推算 */
  expiresAt: number;
  createdAt: number;
}

function jobOf(api: branch.ApiBlockoutJob): BlockoutJob | null {
  const jobId = String(api.jobId ?? api.id ?? api._id ?? "").trim();
  if (!jobId) return null; // 没有 jobId 的"待取回"取不回，展示它只会让人白点
  const roles = Array.isArray(api.roles) ? api.roles : [];
  return {
    jobId,
    taskId: String(api.taskId ?? "").trim(),
    durSec: Number(api.durSec) || 0,
    title: String(api.title ?? "").trim() || "未命名白模模板",
    roles: roles
      .map((r) => ({ label: String(r?.label ?? "").trim(), desc: String(r?.desc ?? "").trim() }))
      .filter((r) => r.label !== ""),
    markSlots: markSlotsOf(api),
    expiresAt: toMs(api.expiresAt ?? null) ?? 0,
    createdAt: toMs(api.createdAt ?? null) ?? Date.now(),
  };
}

/** 这条凭据什么时候失效（ms）。0 = 完全说不准（服务端既没给 expiresAt 也没给 createdAt） */
function jobExpiresAt(job: BlockoutJob): number {
  if (job.expiresAt > 0) return job.expiresAt;
  return job.createdAt > 0 ? job.createdAt + BLOCKOUT_JOB_TTL_MS : 0;
}

/** 过期了吗（过期 = 产物已经不在了，取不回来）。**唯一实现**，界面别自己减时间戳 */
export function blockoutJobExpired(job: BlockoutJob): boolean {
  const at = jobExpiresAt(job);
  return at > 0 && Date.now() >= at;
}

/**
 * 「还剩多久 / 已经过期」的那一句话 —— **唯一实现**（列表、取回失败、提取器的提醒都用它）。
 *
 * ★★ 过期那一句必须**整句说明费用无法挽回**，不许写成"已过期，请重新开始"：
 *   用户会以为只是超时重来，而这一发的看帧 + 出片是**真花过钱的**，重开一发是再花一次。
 *   诚实地说清楚，比让他误以为随时能回来取要好得多。
 */
export function blockoutJobNote(job: BlockoutJob): string {
  const at = jobExpiresAt(job);
  if (at <= 0) return "这一发已经付过费，但服务器没说结果能留到什么时候——建议尽快取回。";
  const left = at - Date.now();
  if (left <= 0) {
    return "产物已过期：AI 出片的产物只在服务器上留 24 小时，现在已经取不回来了，这一发已经付过的费用无法挽回（不是超时重来——重开一发是再花一次钱）。";
  }
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  return `还剩 ${h > 0 ? `${h} 小时 ` : ""}${m} 分钟可以取回——AI 出片的产物只在服务器上留 24 小时，过期就取不回来了，而这一发的钱已经付过。`;
}

// 待取回列表的缓存（与 shared 同一套「懒加载 + 到货 emit + 失败冷却」的写法）
let pendingJobs: BlockoutJob[] = [];
let pendingFresh = false;
/** 在途的那一次拉取。★ 存 Promise 而不是布尔：强制刷新要能 await 到它真的到货，
 *  而"已经在拉了"与"刚拉完"是两件事（布尔只答得出前者） */
let pendingInflight: Promise<void> | null = null;
let pendingIssue = "";
let pendingRetryAt = 0;

function sortJobs(list: BlockoutJob[]): BlockoutJob[] {
  // 快过期的排前面：这一屏的用途就是"先去救最急的那一发"
  return [...list].sort((a, b) => (jobExpiresAt(a) || Infinity) - (jobExpiresAt(b) || Infinity));
}

/**
 * 「这几发**取不回来了**、别再提醒我」—— 本机忽略名单（只存 jobId）。
 *
 * ══ 为什么必须有它（2026-08-17 用户反馈）══════════════════════════════
 * 产物过期之后，那条凭据在服务端名单里**永远留着**（它记录的是一笔已经付过、
 * 无法挽回的钱，服务端没有理由删它）。而 App 这边照实把它显示成"你还有一发没取回"，
 * 于是用户点取回 → 失败 → 那句话**还在**，且没有任何办法让它消失。
 * 一个永远关不掉的提醒，比不提醒更糟：它把"这里有件事要处理"降级成了背景噪音。
 *
 * ★★★ **只有已经过期的才允许忽略** —— 没过期的那些里面还躺着**能取回来的钱**，把它藏起来
 *   正是两阶段设计存在的全部意义的反面（见文件里 BlockoutJob 那段：没有这个入口，用户就是
 *   "钱花了、结果没了、还不知道该去哪找"）。谁把这条门禁放宽，症状是用户再也看不到自己
 *   有一发能领 —— 零报错。
 * ★★ 这条门禁**在过滤那一侧执行**，不是在点击那一侧（2026-08-17 收口）：名单里存的是
 *   jobId，一存就存到卸载为止，而"过期没过期"是**随时间变的**。只在写入那一拍判一次的话，
 *   这条不变量就只在那一拍成立，之后永不复核 —— 名单被脏数据污染（localStorage 是用户
 *   可写的）、或者将来过期判据变了（服务端延长留存、补发 expiresAt），那笔**还能取回来的钱**
 *   就被一条早年的记号永久藏了起来，且零报错。所以 `pendingBlockoutJobs` 每次读都
 *   重新问一遍 `blockoutJobExpired`。
 *   ⚠ 这不是"同一条规则写了两遍"：两处问的都是**同一个** `blockoutJobExpired`（过期的唯一
 *   实现）。写入侧那道只是"别往名单里塞垃圾"，**真正的门禁是读那一侧**。
 * ★ 因此不需要单独的「解除忽略」入口：一条记号只在"这一发此刻仍然是过期的"时才生效 ——
 *   真出现"它又能取回了"（服务端延了留存 / 补了 expiresAt），它**自己就回到列表里**了。
 *   而只要它还是过期的，解除的唯一效果就是把一条**永远失败**的提醒放回去，那正是这整段
 *   要消掉的东西。（想连本机记号一起抹掉：清掉本 key 即可 —— 它只是阅读状态。）
 * ★ 落 localStorage 而不是服务端：这是"我知道了"这类**这台设备上的阅读状态**，
 *   不是需要跨设备一致的事实。换设备后再看到一次不是故障。
 * ★ 不做淘汰：一发白模化 = 一笔钱，名单量级是个位数的短字符串，没有值得写代码去省的空间；
 *   而"按 pendingJobs 反向清理"在缓存还没到货那一拍会**误删**，反倒把提醒放回来。
 */
const JOB_HIDE_KEY = "ideahub-app.blockoutJobs.hidden.v1";

function readHiddenJobs(): Set<string> {
  try {
    const raw = localStorage.getItem(JOB_HIDE_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

let hiddenJobs = readHiddenJobs();

/**
 * 把一发**已经过期**的凭据从提醒里去掉。
 * ★ 这里拒掉没过期的只是"别往名单里塞垃圾"；**真正的门禁在 `pendingBlockoutJobs` 的过滤**
 *   （那边每次读都复核一遍过期）。所以就算这一道被绕过去，能取回的钱也藏不住。
 */
export function dismissBlockoutJob(job: BlockoutJob): void {
  if (!blockoutJobExpired(job)) return;
  hiddenJobs = new Set([...hiddenJobs, job.jobId]);
  try {
    localStorage.setItem(JOB_HIDE_KEY, JSON.stringify([...hiddenJobs]));
  } catch {
    /* 存不下：这一次会话内不再提（内存里那份还在），下次启动会再出现一次。
       比整块崩掉好，也没有任何值得报给用户的东西 */
  }
  emit();
}

/**
 * 本账号**还没取回结果**的白模化（同步返回缓存，第一次调用触发后台拉取，到货 emit）。
 *
 * ★★ 这份名单**只有服务端说得准**，本机不存第二份：凭据的归属/状态/过期时刻都在那边，
 *   而"结果丢了"最典型的场景恰恰是**进程被系统回收**（本机 state 一起没了）——
 *   那时服务端那份是唯一还在的。本机再存一份就是两处真相，换设备后还必然是错的那份。
 *   （上面那份忽略名单不违反这一条：它存的是"我看过了"，不是凭据本身。）
 * ★ 空数组既可能是"真的没有"，也可能是"还没到货/老服务端"。要区分就看
 *   `pendingBlockoutIssue()`（拉失败会说话）——界面据此决定要不要显示"加载失败"。
 */
export function pendingBlockoutJobs(): BlockoutJob[] {
  if (remoteOn()) ensurePendingJobs();
  // ★ 过滤在**出口**一处做：所有读方（市场页那张卡、提取器的提醒）看到的是同一份名单，
  //   在各调用点各滤一次必然漏一处，而漏掉的那处会继续显示一个已经被消掉的提醒
  // ★★ 名单只是「我知道了」的**记号**，不是"可以藏起来"的授权：真正的门禁是右边这半句
  //   —— 每次读都重新问一遍 `blockoutJobExpired`。记号会留到卸载为止，而"过期"随时间变，
  //   只在点击那一拍判过就再也不复核的话，一条被污染/过时的记号会把**还能取回来的钱**
  //   永久藏掉（零报错）。判据本身仍然只有 `blockoutJobExpired` 一处实现。
  return hiddenJobs.size
    ? pendingJobs.filter((j) => !(hiddenJobs.has(j.jobId) && blockoutJobExpired(j)))
    : pendingJobs;
}

/** 待取回列表这一拍没到货的原因（空串 = 一切正常）。别让"拉挂了"伪装成"你没有待取回的" */
export function pendingBlockoutIssue(): string {
  return pendingIssue;
}

/** 真正去拉那一次（同一时刻只有一发在途；**唯一实现**，懒加载与强制刷新都走它） */
function loadPendingJobs(): Promise<void> {
  pendingInflight ??= (async () => {
    try {
      if (!(await remoteTemplatesCapable())) {
        // 瞬时网络失败（探测没缓存结论）≠ 老服务端：前者要说出来（这一屏关系到钱），
        // 后者安静 —— 老服务端连白模化入口都不渲染，说"待取回列表拉不到"只是噪音
        if (remoteOn() && capProbe === null) {
          pendingIssue = "还没取回的白模化结果暂时拉不到（网络不稳），稍后自动重试——这不代表你没有待取回的";
          pendingRetryAt = Date.now() + 15_000;
          emit();
        }
        return;
      }
      const list = await branch.listBlockoutJobs();
      if (list === null) {
        // 这台服务器有模板能力、但没有两阶段的 pending 端点（上一版服务端）。
        // 它那条白模化是同步跑完的（startBlockoutize 的 legacy 分支），本来就没有
        // "待取回"这回事 —— 安静收工，不摆一个永远是空的区块。
        pendingFresh = true;
        pendingJobs = [];
        pendingIssue = "";
        emit();
        return;
      }
      pendingJobs = sortJobs(list.map(jobOf).filter((j): j is BlockoutJob => j !== null));
      pendingFresh = true;
      pendingIssue = "";
      emit();
    } catch (e) {
      pendingIssue = `还没取回的白模化结果拉取失败：${e instanceof Error ? e.message : String(e)}`;
      pendingRetryAt = Date.now() + 15_000;
      emit();
    }
  })().finally(() => {
    pendingInflight = null;
  });
  return pendingInflight;
}

function ensurePendingJobs(): void {
  // ★ 没登录就别问：凭据是**按账号**发的，而这条端点是 requireAuth 的 —— 未登录时问一次
  //   只会换回一句 401，然后在界面上摆一行"拉取失败"，吓到一个根本不可能有待取回凭据的人。
  if (!currentUser()) return;
  if (pendingFresh || pendingInflight || Date.now() < pendingRetryAt) return;
  void loadPendingJobs();
}

/**
 * 强制重拉待取回列表（进模板市场时调一次；取回失败后想刷新也调它）。
 * ★ 与懒加载共用 `loadPendingJobs`，区别只在于它**跳过冷却与 fresh 缓存**：用户点进
 *   模板市场，多半就是因为刚才那一发被打断了 —— 这时候给他看一份可能过时的名单没有意义。
 */
export async function refreshPendingBlockoutJobs(): Promise<void> {
  if (!currentUser() || !remoteOn()) return;
  pendingFresh = false;
  pendingRetryAt = 0;
  await loadPendingJobs();
}

/** 刚受理的那一发立刻进列表：不等下一次拉取，恢复入口当场就在（页面已经在订阅 emit） */
function rememberPendingJob(job: BlockoutJob): void {
  pendingJobs = sortJobs([...pendingJobs.filter((j) => j.jobId !== job.jobId), job]);
  emit();
}

/** 取回成功 → 结案。★ 失败**不摘**：失败恰恰是最需要保留这条入口的时候 */
function dropPendingJob(jobId: string): void {
  pendingJobs = pendingJobs.filter((j) => j.jobId !== jobId);
  emit();
}

// 轮询参数。★ 5s 一次是与 arkClient 里那两个循环一致的口径（同一个端点、同一个限流桶）。
const BLOCKOUT_POLL_MS = 5_000;
/** 客户端愿意盯着等多久。★ 到点**不是失败**：任务还在方舟那边跑，结果 24 小时内都能取回，
 *  所以到点只是"我们不等了"，文案必须把用户领到恢复入口，而不是说"这一发废了"。 */
const BLOCKOUT_POLL_MAX_MS = 12 * 60_000;
/** 连续几次查询失败才放弃盯着（单次抖动不算——任务在云端好好跑着，白扔太亏） */
const BLOCKOUT_POLL_TOLERATE = 5;

type TaskOutcome =
  | { kind: "succeeded" }
  /** 方舟明说这一发失败/取消了。★ 仍然要去 finish：由服务端向方舟核实并结案，
   *  「到底扣没扣钱」那句话只能由服务端说（客户端报的数不作数） */
  | { kind: "failed" }
  /** 轮不动 / 等到点了 —— **不许当成失败**（结果可能好好的，只是我们没看到） */
  | { kind: "unknown"; note: string };

/**
 * 盯着方舟那一发出片。走**既有**的 `GET /api/ark/contents/generations/tasks/:id`
 * （契约：不计费、90/分的独立限流桶），不新造轮询端点。
 *
 * ★ 进度必须报出来：这一步最长几分钟，不报进度用户会以为死了然后去连点。
 * ★ 这里的结论**不作数**——finish 那一步服务端会自己再向方舟核实一次（与试炼闸
 *   provenAt 同一条理由）。轮询在这条链路上的职责只有两个：给用户看进度，
 *   以及决定"什么时候去取结果"。
 * ⚠ **dev 下可能查不到这个任务**：`arkClient` 的端点在 dev 走 vite 代理（注入的是本机
 *   `.env.local` 的 ARK_API_KEY），而这一发是**服务端**用它自己那把 key 建的 ——
 *   两把 key 不是同一个方舟账号时，这里会连查五次都拿不到，于是退成 `unknown`
 *   并把人领到恢复入口（结果照样取得回，只是看不到进度）。打包后两边都是
 *   `${API_BASE}/api/ark`，同一把 key，不存在这个问题。
 */
async function waitBlockoutTask(taskId: string, prog: (s: string) => void): Promise<TaskOutcome> {
  const t0 = Date.now();
  let fails = 0;
  while (Date.now() - t0 < BLOCKOUT_POLL_MAX_MS) {
    await new Promise((r) => setTimeout(r, BLOCKOUT_POLL_MS));
    let st: Awaited<ReturnType<typeof fetchArkTask>>;
    try {
      st = await fetchArkTask(taskId);
      fails = 0;
    } catch (e) {
      if (++fails >= BLOCKOUT_POLL_TOLERATE) {
        return {
          kind: "unknown",
          note: `盯不住这一发的进度了（${e instanceof Error ? e.message : String(e)}）。`,
        };
      }
      continue;
    }
    const sec = Math.round((Date.now() - t0) / 1000);
    const label = st.status === "queued" ? "排队中" : st.status === "running" ? "生成中" : st.status;
    // ★ 这句话里那半句"可以退出"是这次改造的**用户可见部分**：它必须出现在等待的每一拍上，
    //   否则用户仍然会以为自己必须一直盯着（而两阶段的全部意义就是他不必）。
    // ★ 措辞跟着白模化提示词走（服务端那份 2026-08-17 起把所有人换成完全一样的纯白人偶，
    //   不再印数字、也不再上色）：这句话是用户在几分钟等待里唯一看得见的东西，
    //   说的和真正发生的事不一样就是骗人
    prog(`AI 正在把画面里的人换成一模一样的纯白色人偶：${label} ${sec}s（可以退出，24 小时内都能回「我的模板」取回结果）`);
    if (st.status === "succeeded") return { kind: "succeeded" };
    if (st.status === "failed" || st.status === "cancelled") return { kind: "failed" };
  }
  return { kind: "unknown", note: "等了 12 分钟还没出片（任务还在方舟那边跑，不是失败）。" };
}

/**
 * 服务端刚回的模板 → 本机库。**幂等**（铁律：重复取回不许多出一条记录）。
 *
 * ★★ 同一条凭据被取回两次（两个入口、两台设备、手抖点两下）时服务端会回**同一条**模板；
 *   本机再 saveTemplate 一次就会多出一条 remoteId 相同的记录 —— 它们的发布/删除都指向
 *   同一个远端实体，删掉一条另一条就成了指向已删实体的幽灵（列表里点进去 404）。
 */
/**
 * 服务端已经建好的模板实体 → 本机库（`mine`）—— **落库这一跳的唯一实现**。
 * 白模化取件（adoptBlockoutTemplate）与分段登记（makeOwnRefTemplateGroup）都走它：
 * 两处各写一遍的话，五件套（roles/markSlots/markBoxes/markBoxAtSec/markDescs）迟早
 * 有一处漏搬一位，而那正是 CLAUDE.md「服务端加字段本机几跳一起搬」钉过三次的坑。
 * @param missingRefMsg 服务端回包缺参考视频时抛的整句 —— 两条路的"钱花没花过"不同，
 *   话术必须各说各的（白模化那句提"钱已付过"，分段那句不能提）
 */
function adoptRemoteTemplate(api: branch.ApiBranchTemplate, missingRefMsg: string): VideoTemplate {
  const mapped = apiToTemplate(api);
  if (!mapped?.remoteId) {
    throw new Error(missingRefMsg);
  }
  const already = mine.find((t) => t.remoteId === mapped.remoteId);
  if (already) return already;
  return saveTemplate({
    title: mapped.title,
    intro: mapped.intro,
    cover: mapped.cover,
    cards: [], // 白模不带素材卡：「换成谁」由套用者在编辑页逐个角色位挂
    recipe: mapped.recipe,
    refVideo: mapped.refVideo,
    ...(mapped.roles?.length ? { roles: mapped.roles } : {}),
    // ★★ 方案位与 roles **同批搬**，理由见 NewTemplate.markSlots 的 ★★：
    //   这条路（takeBlockoutResult / resumeBlockoutize / legacy 同步）产出的那条记录
    //   会被**直接**塞进 applyTemplate（提取器成功卡片上那颗「用这个模板出片」），
    //   发生在任何一次 refreshRemoteTemplate 之前 —— 所以指望"以后刷新时补回来"救不了它。
    //   判否定的代价就在这里：漏一位不是少个位置，是整份判成上一代方案（连升序排序一起丢）。
    ...(mapped.markSlots?.length ? { markSlots: mapped.markSlots } : {}),
    ...(mapped.markBoxes?.length ? { markBoxes: mapped.markBoxes } : {}),
    // 人偶描述：与框各自独立（框没量出来 ≠ 描述没验过），所以单独一个存在性判断
    ...(mapped.markDescs?.length ? { markDescs: mapped.markDescs } : {}),
    ...(mapped.markBoxAtSec !== undefined ? { markBoxAtSec: mapped.markBoxAtSec } : {}),
    // 分段组归属：存在性搬运（白模化那条路没有它，分段登记的每一段都有）。
    // ★ 漏了它 = 组在 mine 里散架（见 NewTemplate.group 的 ★），且 mineRemote 那份带着组、
    //   去重后只显示 mine 这份 —— 两份并存反而把症状盖得更深
    ...(mapped.group ? { group: mapped.group } : {}),
    remoteId: mapped.remoteId,
  });
}

function adoptBlockoutTemplate(api: branch.ApiBranchTemplate): VideoTemplate {
  return adoptRemoteTemplate(
    api,
    "结果取回来了，但服务器返回的模板缺少参考视频地址——钱在开炼那一步已经付过，请去「我的模板」确认后再决定要不要重来。",
  );
}

/**
 * 「等出片 → 取回结果」这后半段 —— **唯一实现**：刚开炼的那一发与从恢复入口领回来的
 * 那一发走的是同一段代码（铁律六）。两处各写一遍的话，"取回失败之后凭据还留不留"
 * 这种事必然分叉，而分叉的代价是用户的钱。
 */
async function takeBlockoutResult(job: BlockoutJob, prog: (s: string) => void): Promise<VideoTemplate> {
  if (job.taskId) {
    const out = await waitBlockoutTask(job.taskId, prog);
    if (out.kind === "unknown") {
      // ★ 不当成失败、也**不摘掉凭据**：结果多半好好的，只是我们没盯到。
      //   这句话唯一要做的事就是把用户领到恢复入口去。
      throw new Error(
        `${out.note}这一发的钱已经付过了，结果没有丢——${blockoutJobNote(job)}「我的模板」页顶部的「还没取回结果」那一栏随时可以继续取，别重新开炼（那是再花一次钱）。`,
      );
    }
    if (out.kind === "failed") {
      // 方舟说失败了，但**扣没扣钱只有服务端说得准**（客户端报的数不作数）——
      // 照样走 finish，让服务端核实、结案，并给出那句权威的整话
      prog("方舟报这一发没能出片，正在向服务器核实到底怎么回事…");
    }
  }
  prog("正在取回结果：服务端会自己向方舟核实，再把产物转存下来（这一步不额外花钱）…");
  const res = await branch.finishBlockoutize(job.jobId);
  dropPendingJob(job.jobId);
  prog("白模模板已生成");
  return adoptBlockoutTemplate(res.template);
}

/**
 * **恢复入口**：把一发已经付过钱、还没取回的白模化领回来。
 *
 * ★★ 这条路是两阶段改造的**目的本身**。没有它，拆两阶段只是把一次长请求换成两次短请求，
 *   反而多了一个会丢结果的接缝。
 * ★ 过期的直接整句拒，不去打服务端：产物已经不在了（TOS 签名地址 24h），
 *   打过去也只会拿回同一句话，还让用户多等一次转圈。
 * @throws message 可直接显示
 */
export async function resumeBlockoutize(
  jobId: string,
  onProgress?: (status: string) => void,
): Promise<VideoTemplate> {
  const prog = (s: string) => onProgress?.(s);
  if (!remoteOn()) throw new Error("现在连不上服务器——结果在服务端那边，联网后再来取（产物 24 小时内有效）");
  const job = pendingJobs.find((j) => j.jobId === jobId);
  if (!job) {
    // 缓存里没有（列表还没到货 / 换了设备）也不该拦着：jobId 在手就能取，
    // 归属由服务端按 ownerId 把关。这时没有 taskId，直接去 finish 让服务端核实。
    prog("正在取回结果…");
    const res = await branch.finishBlockoutize(jobId);
    dropPendingJob(jobId);
    return adoptBlockoutTemplate(res.template);
  }
  if (blockoutJobExpired(job)) throw new Error(blockoutJobNote(job));
  return takeBlockoutResult(job, prog);
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
  /** 选段时长（整数秒，窗口 [5,30] 由编辑页的 arkVideoRules.selectionIssue 把关 ——
   *  下限是 5 不是方舟的 4，理由见 BLOCKOUT_MIN_INPUT_SEC 的 ★★） */
  durSec: number;
  /** 裁剪框（整数像素，相对原片**原始分辨率**，不是预览尺寸） */
  crop: { x: number; y: number; w: number; h: number };
  /**
   * 「AI 看哪几帧」—— **相对选段起点的整数秒**，升序去重，1~`BLOCKOUTIZE_FRAME_MAX` 个。
   *
   * ★★ **缺省 = 自动**：那时请求体里**不带**这个字段，帧数由服务端按时长算
   *   （`autoVisionFrames` 那条式子的权威实现在服务端，本机只是报价用的镜像）。
   *   给一个"自动算出来的数组"上去等于把那条式子抄成两份，服务端改了公式我们不会知道。
   * ★ 有值时它同时决定**报价**（`visionFrameCount`）与请求 —— 两者读的是同一个数组，
   *   不许在别处再数一次长度。
   */
  frameTimes?: number[];
  title: string;
  intro?: string;
  /** 封面（dataURL 或 https）。dataURL 会先转成永久地址再提交（服务端 zod 拒 dataURL） */
  cover?: string;
  /** 作者对画面的补充说明，服务端拼进「先看」那一步的提示词 */
  note?: string;
  aspect?: VideoAspect;
  /** 进度播报。这一步要等好几分钟，不报进度用户会以为死了 */
  onProgress?: (status: string) => void;
  /**
   * **钱已经花出去了**的那一刻（r2v 被方舟受理、凭据落库；`null` = 老服务端一口气跑完了）。
   *
   * ★★ 宿主必须在这里放掉"用户中途放弃就回收那段原始素材"的念头：从这一刻起那段素材
   *   归这一发（以及它将变成的模板）管了，回收它等于把一发**已经付过钱**的白模化的
   *   来源删掉。提取器的 close() 就是照这一位决定还删不删的。
   * ★ 它**不是**"成功了"：成功要等 finish 回来。这一位只回答"钱动了没有"。
   */
  onBilled?: (job: BlockoutJob | null) => void;
}

/**
 * 白模化**流程的唯一实现**：提交四组数 →（钱在这一刻花掉，落一条凭据）→ 轮询出片 →
 * 取回结果 → 落本机（带 remoteId）。
 *
 * ★★ 中途的每一种意外都**不该让结果丢掉**：拿到凭据之后（`onBilled` 那一刻起）
 *   这一发就进了「待取回」名单，用户随时可以退出，24 小时内从「我的模板」的恢复入口
 *   （`resumeBlockoutize`）把结果领回来。这里抛出的每一句失败话，凡是结果还能取的，
 *   都必须把人领到那个入口去 —— 说成"失败了，重试吧"就是让他再花一次钱。
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

  const durSec = Math.round(o.durSec);
  /**
   * 「自己挑帧」那条路的**规范化**：整数秒、去重、升序、落在选段内。
   *
   * ★ 这**不是**第二处校验：会说话的那份在编辑页（`arkVideoRules.selectionIssue`，
   *   它才写得出"删掉几帧""把选段拖回去"这种话）。这里做的是与 `Math.round(startSec)`
   *   同一件事 —— 把要上线的数**规范成服务端 zod 收得下的形状**（它收的是整数秒）。
   * ★ 规范化之后为空 = 用户标的帧全落在选段外面。**响亮拒绝**，不许悄悄退回自动：
   *   退回自动会让"页面按 3 帧报的价"变成"服务端按 8 帧扣的钱"，而且一个字都不说。
   */
  const frameTimes = o.frameTimes
    ? [
        ...new Set(
          o.frameTimes
            .map((t) => Math.round(t))
            .filter((t) => Number.isFinite(t) && t >= 0 && t <= Math.max(0, durSec - 1)),
        ),
      ].sort((a, b) => a - b)
    : undefined;
  if (o.frameTimes && (!frameTimes || frameTimes.length === 0)) {
    throw new Error("你标的那几帧都落在选中的这一段外面了（选段后来被拖动过）——回去把标记删掉重标，或者切回「自动」。");
  }
  // ★ 上限在这里是**断言**（会说话的那份在 selectionIssue）：条数**只夹不静默截断** ——
  //   截掉几帧的话，报价按 8 帧、实际只看 5 帧，用户多付的那几帧没有任何一处会说出来。
  //   走到这儿说明有调用方绕过了编辑页那道门，响亮拒绝比悄悄改数好。
  if (frameTimes && frameTimes.length > BLOCKOUTIZE_FRAME_MAX) {
    throw new Error(`最多只能指定 ${BLOCKOUTIZE_FRAME_MAX} 帧给 AI 看（现在是 ${frameTimes.length} 帧）——删掉几帧再开炼。`);
  }
  /** 这一发**要看几帧** —— 报价与下面那句进度话读的是同一个数（唯一实现在 visionFrameCount） */
  const frames = visionFrameCount(durSec, frameTimes);

  // ③ 余额够不够。★ 服务端也会判（402 INSUFFICIENT_TOKENS，一分钱没动），这里再判一次
  //   不是为了安全，是为了**时机**：走到这一步用户已经传完一段最大 100MB 的视频、
  //   框了半天选段，这时候才告诉他"钱不够"太晚了。判据仍只有 account.canAfford 一处。
  const cost = blockoutizeCost(frames, durSec);
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

  prog(`正在提交：AI 先看 ${frames} 帧认出画面里有哪些人，再把这一段发去出片…`);
  let started: branch.BlockoutStarted;
  try {
    started = await branch.startBlockoutize({
      publicId: o.publicId,
      // ★ 整数秒/整数像素在这里取一次整，别指望服务端替你四舍五入（它的 zod 声明是 int，
      //   小数直接 400）。取整口径与服务端一致（Math.round）。
      startSec: Math.round(o.startSec),
      durSec,
      // ★★ 自动模式**不发这个字段**（不是发一个空数组、也不是把本机算的帧数发上去）：
      //   "按时长算几帧"那条式子只有一处实现 —— 在服务端。发上去就是第二处。
      ...(frameTimes ? { frameTimes } : {}),
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

  if (started.kind === "legacy") {
    // 老服务端（这一轮改造之前那份同步实现）：它在那一条请求里把九步全跑完了，
    // 模板就在回包里。没有凭据、也没有"待取回"这回事 —— 直接落本机，降级但**完整**。
    o.onBilled?.(null);
    prog("白模模板已生成");
    return adoptBlockoutTemplate(started.result.template);
  }

  /**
   * 服务端**真正看了几帧**与本机报价用的那个数对不上 —— 以服务端为准，并把这件事
   * 如实说出来（贴在之后每一句进度话的后面）。
   *
   * ★★ 为什么不能默默按本机那个数继续显示：帧数就是钱（视觉那一半 = 帧数 ×
   *   VISION_FRAME_TOKENS）。两边不等时界面上那句"AI 看 N 帧（xx token）"就是错的，
   *   而这是本仓头号事故的形状（页面报 ¥25、实际扣 ¥15），两个方向都不报错。
   *   会走到这里的正常原因只有一个：服务端的自动公式改了、本机镜像还没跟上。
   * ★ 为什么**贴在每一句后面**而不是单独 prog 一次：5 秒后第一次轮询就会把它盖掉，
   *   而这一整段等待里用户能看到的只有那一行进度话。
   * ★ 服务端没说（frames = 0，老服务端）就什么都不说：编不出来的话不许编。
   */
  const serverFrames = started.job.frames;
  const framesNote =
    serverFrames > 0 && serverFrames !== frames
      ? `（服务端实际看了 ${serverFrames} 帧，与本机报价用的 ${frames} 帧不同，以服务端为准）`
      : "";
  const say = framesNote ? (s: string) => prog(`${s}${framesNote}`) : prog;

  const job: BlockoutJob = {
    jobId: started.job.jobId,
    taskId: started.job.taskId,
    durSec: started.job.durSec,
    title: o.title.trim() || "未命名白模模板",
    roles: started.job.roles,
    markSlots: started.job.markSlots,
    expiresAt: toMs(started.job.expiresAt) ?? 0,
    createdAt: Date.now(),
  };
  // ★★ 到这一行为止，钱**已经花掉了**（看帧 + r2v 受理，受理后失败不退）。所以这一行
  //   要做的第一件事不是"接着等"，而是把这一发**记成一条待取回的凭据**：从现在起
  //   无论轮询挂掉、用户切后台、还是进程被系统回收，「我的模板」那个恢复入口都在。
  //   （本机这份只是让入口**当场**就亮起来；真正保命的是服务端那份 —— 进程被回收时
  //   本机 state 一起没了，而 pending 端点还在。）
  rememberPendingJob(job);
  o.onBilled?.(job);
  return takeBlockoutResult(job, say);
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
