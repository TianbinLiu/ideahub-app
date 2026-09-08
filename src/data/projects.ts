// 已发布作品的「工坊工程」—— **服务端为真相，本地只是缓存**。
//
// 发布（以及每一次回炉）成功之后，把当时那份工坊画布（flowStore 的 nodes/alts + 桌面卡组）
// 瘦身成一份**只含永久 URL** 的 JSON，PUT 进服务端。作者在编辑页点「🛠 回炉重做」把它
// 取回工坊，正常出片、剪辑，再走 PATCH 替换原作品的内容（同一个链接、同一批互动数据）。
//
// ★★ 为什么本地**不能**是第二份真相：`data/drafts.ts` 的 `MAX_DRAFTS = 20` 按 updatedAt
//   降序 `slice(0, 20)`，不区分种类，被挤掉的正文直接 idbDel、不通知任何人。而留存工程的
//   updatedAt 冻结在发布那一刻、在制品草稿每炼一段就刷新 —— 方向是确定的：**工程必然先
//   出局**。用户发满 20 条之后，早期作品的回炉能力会在零提示下消失。那正是 2026-08-10
//   删掉回炉的理由②的形状（功能看着在、实际不生效、零提示）。
//   所以工程不进草稿库、不共用那 20 条额度，本地这份 LRU 掉了也只是下次多一次网络往返。
//
// ★★ 不变量：存进去的 canvas 里**没有任何** `data:<mime>/` / `idb:` / 方舟地址。
//   服务端的 zod 与这里的 `assertClean` 是同一条正则的两道门。这条不变量顺带买下两件事：
//     ① 跨设备取回来能用（`idb:` 是「这台手机上某处」，换台机器就是空气）；
//     ② `data/cacheSweep.ts` **不需要**认识这个键 —— 工程不引用任何 idb: blob，
//        所以本地那套 LRU 淘汰是安全的。⚠ 哪天有人放宽这条断言，**必须同时**去
//        cacheSweep.collectReferenced 补一段引用来源，否则清一次缓存就真删用户资产。
//
// ★ 与 videos / danmaku / jobs 同一套订阅：模块级单例 + 版本号 + useSyncExternalStore。
// ★ 依赖方向：本文件属 data 层，**不 import 任何 store**（与 drafts.ts 同一条纪律）。
//   画布快照由宿主（hooks/useFlowActions）从 store 现抓、当参数传进来。
import { idbDel, idbGet, idbSet } from "./db";
import { startJob } from "./jobs";
import { isPermanentUrl, pairAssetUrls, type PairTarget } from "./publishAssets";
import * as api from "../api/projects";
import { ApiError } from "../api/client";
import type { DraftVideo } from "../types";

/** 待提交的画布快照（组稿那一拍抓的，还没瘦身）。**单键**：同一时刻只可能有一摊活 */
const PENDING_KEY = "ideahub-app.project.pending.v1";
/** 本地取回缓存的键名前缀 + 那张 LRU 名单 */
const cacheKey = (videoId: string) => `ideahub-app.project.${videoId}`;
const LRU_KEY = "ideahub-app.project.lru.v1";
/** 本地缓存留几条。★ 缓存掉了只是多一次网络往返（真相在服务端），不需要留很多 */
const LRU_MAX = 5;
/** 2026-08 那套「工坊源工程」留下的遗留键（saveProject/loadProject 已随回炉一起删掉）。
 *  ★ 这次要清：留着会让下一个人以为它是本功能的一部分，而它的正文是**带 dataURL 的
 *    整棵树**、MB 级、只增不减。搭在 readyProjects() 本来就要做的那次往返上。 */
const LEGACY_KEY = "ideahub-app.projects.v1";

/**
 * 画布快照的形状（客户端定义，服务端只当 Mixed 存）。
 * ★ 字段与 `flowStore` 的同名状态一一对应，但这里**不 import flowStore**（见文件头），
 *   所以节点用 `unknown[]` —— 与 `drafts.FlowSnapshot` 同一种写法、同一个理由。
 */
export interface CanvasSnapshot {
  v: 1;
  flow: {
    nodes: unknown[];
    alts: unknown;
    cursor: number;
    mode: string;
    origin: string;
    template: unknown;
    subject: string;
    deckOff: boolean;
  };
  deck: unknown[];
}

/** 组稿那一拍落盘的待办：还没提交上去的一份画布 */
interface PendingCanvas {
  at: number;
  /** 发布的幂等键（`publishVideo` 拿到 clientId 之后盖上去）。缺省 = 还没走到发布 */
  clientId?: string;
  /** 这一摊是回炉某条作品（回炉提交成功后按它对上号） */
  reviseOf?: { videoId: string; baseRevision: number };
  /**
   * 这份画布归哪条**已发布作品**（`retain` 归属校验通过那一拍盖上）。
   *
   * ★★★ 为什么不能只靠 `clientId`（2026-09-08 评审抓到的重要项）：编辑页那颗「重试留存」
   *   的判据是 `pendingFor(video.id, video.clientId)`，而首次发布那份待办身上只有 clientId，
   *   于是走的是"比 clientId"那一支 —— 可 `VideoItem.clientId` **活不过冷启动**：
   *   远端模式下 `videos.save()` 是 no-op，重启后 cache 由 `res.items.map(toVideoItem)`
   *   整份重建，而 `toVideoItem` 里根本没有 clientId 这一格 ⇒ 恒为 undefined ⇒ 判据恒假。
   *   症状：首次发布时 PUT 失败（断网/配额/5xx），用户当时没处理、关掉 App，再进来时
   *   那颗能救回来的键**一次都不会画出来**，而留存失败那句话还写着"可在编辑页点「重试留存」"
   *   —— 明明躺在本机 IndexedDB 里的画布永远点不到，这条作品的回炉能力就此永久消失。
   *   ⇒ 盖一格作品 id：它跟着待办一起进 IndexedDB，重启后照样对得上号。
   */
  videoId?: string;
  title: string;
  canvas: CanvasSnapshot;
  /**
   * 这份 canvas **已经瘦身过了**（配对 + 墓碑 + 断言都过了，可以直接 PUT）。
   *
   * ★★ 为什么要有这一位：配对表是拿「发出去之前那份 draft」与「发布回包」现对出来的，
   *   那两样**只在发布成功那一拍同时存在**。如果 PUT 那一步失败（配额满 / 断网 / 400），
   *   而待办里躺的还是原始画布，那么编辑页那颗「重试留存」就再也配不出表来 ——
   *   整份画布会被墓碑化成一堆空框，然后**成功**存上去，零报错。
   *   ⇒ 瘦身一算完就把结果写回待办：重试只剩一次网络往返，判据一个字都不用再算。
   */
  ready?: true;
  /** ready 时随之定下的缺失数（重试要原样报上去，重算一遍必然得到 0——那时已经没有 before 了） */
  lostCount?: number;
}

// ── 订阅（模块级单例 + 版本号）────────────────────────────
let metas: api.ApiProjectMeta[] = [];
/** null = 还没问过；true/false = 这台服务器支不支持工程端点。
 *  ★ 三态是必须的：「还没问」「不支持」「支持但这条没有」在编辑页是三句**不同的话** */
/** 三档之外还有第四档，见 `ProjectsSupport` */
let supported: ProjectsSupport = null;
let pending: PendingCanvas | null = null;
let pendingLoaded = false;
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeProjects(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function projectsVersion(): number {
  return version;
}

let readyOnce: Promise<void> | null = null;

/**
 * 拉一次工程列表填 meta 缓存（首次调用才真跑，之后共用同一个 Promise）。
 *
 * ★ **不挂在 App 的启动路径上**：这些端点是 requireAuth 的，而启动那一拍登录态还没结论，
 *   多打一发 401 只会让 `auth:expired` 误触。编辑页挂载时问一次就够了（那正是唯一要用它
 *   的地方），代价是第一次进编辑页那颗键有一拍是"正在确认"。
 * ★ 失败**不抛**：编辑页据 `projectsSupported()` 的四态说话，异常在这里就地记录。
 *
 * ★★ 「网络抖了一下」与「这台服务器没有这个端点」**必须分开**（2026-09-07 评审补）：
 *   压成同一档 `false` 之后，第一次进编辑页撞上一次超时/DNS 失败，整个会话里所有作品的
 *   「🛠 回炉重做」都灰着并写「这台服务器还不支持回炉重做」—— 一句与事实不符、且**没有
 *   任何重试出路**的话（说一句错的原因比不给原因更坏）。而 `readyOnce` 是永久 memo，
 *   失败的那个 Promise 会被缓存一辈子。
 *   ⇒ 只有「回包形状认不出来」（老服务端）与 404/501（没这个路由）算 `false`；
 *     其余（断网、401、5xx、超时）落 `"error"` 档，并且**把 readyOnce 置回 null**
 *     让下一次调用真的重问。
 */
export function readyProjects(): Promise<void> {
  readyOnce ??= (async () => {
    // 遗留键搭这次往返一起清（见 LEGACY_KEY 的 ★）。失败忽略：它只是占地方
    void idbDel(LEGACY_KEY).catch(() => {});
    await readPending();
    try {
      const items = await api.listProjects();
      if (items === null) {
        // 回包形状认不出来 = 这台服务器没有这个端点（**不能**看状态码，见 api/projects 的 ★）
        supported = false;
      } else {
        supported = true;
        metas = items;
      }
    } catch (e) {
      // 404 / 501 = 这台服务器真的没有这条路由；其余一律是"没问出来"，不是"不支持"
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 404 || status === 501) {
        supported = false;
      } else {
        supported = "error";
        // ★★ 失败的 Promise **不许**永久缓存：不置回 null 的话这个会话里再也问不了第二次
        readyOnce = null;
      }
      console.warn("[projects] 工程列表没拉到:", status, e instanceof Error ? e.message : e);
    }
    emit();
  })();
  return readyOnce;
}

/**
 * 待办**现在就能补留存**吗（编辑页那颗「重试留存」的判据）。
 *
 * ★★ 比 `pendingFor` 多一道 `ready`（2026-09-08 评审补的两条次要项，同一个根）：
 *   `ready` 是"配对表已经算好、可以直接 PUT"的标志，只在 `submit` 里置位 —— 也就是说
 *   **只有已经发布/回炉成功、只差最后那一发 PUT 的待办才为真**。不加这一道的话，
 *   「组稿完了但还没点替换」那一档也会把键摆出来，而那时：
 *     · 键上写着「重新留存这一版（现存那份还是上一版）」—— 假话，这一版根本还没提交；
 *     · 点下去 `retryRetain` 走 `!pend.ready` 那支，回一句「这份画布没能整理成可留存的
 *       样子——这条作品没法再补留存了」—— 与真实原因（还没提交）毫不相干的死路话。
 *   用户此刻该做的是去把回炉提交完，而屏幕上这两句都在把他往别处推。⇒ 那一档整颗键不画。
 */
export function pendingRetainable(videoId: string, clientId?: string): boolean {
  return pendingFor(videoId, clientId) && !!pending?.ready;
}

/** 「这台服务器支不支持工坊工程」的四档答案。★ 四档各有各的话要说（见 readyProjects 的 ★★）：
 *  null = 还没问出结果；`"error"` = 问了但没问到（网络原因，**可以重试**）；
 *  false = 这台服务器确实没有这个端点；true = 支持。 */
export type ProjectsSupport = boolean | "error" | null;

export function projectsSupported(): ProjectsSupport {
  return supported;
}

/** 「重新问一次服务器」（编辑页那颗重试键）。★ 只有 `"error"` 档摆得出来 */
export function retryReadyProjects(): Promise<void> {
  if (supported === "error") {
    supported = null;
    emit();
  }
  return readyProjects();
}

/** 这条作品有没有留存工程（读 meta 缓存，同步） */
export function hasProject(videoId: string): boolean {
  return metas.some((m) => m.video === videoId);
}

/** 这条作品那份工程的元信息（体积 / 版次 / 缺了几处预览图），没有则 null */
export function projectMetaOf(videoId: string): api.ApiProjectMeta | null {
  return metas.find((m) => m.video === videoId) ?? null;
}

function upsertMeta(m: api.ApiProjectMeta): void {
  metas = [m, ...metas.filter((x) => x.video !== m.video)];
  emit();
}

// ── 待办（组稿那一拍抓的画布）──────────────────────────────

async function readPending(): Promise<PendingCanvas | null> {
  if (pendingLoaded) return pending;
  pending = (await idbGet<PendingCanvas>(PENDING_KEY)) ?? null;
  pendingLoaded = true;
  return pending;
}

async function writePending(p: PendingCanvas | null): Promise<boolean> {
  pending = p;
  pendingLoaded = true;
  const ok = p ? await idbSet(PENDING_KEY, p) : (await idbDel(PENDING_KEY), true);
  emit();
  return ok;
}

/**
 * 组稿成功那一拍抓下画布，**当场落 IndexedDB**。
 *
 * ★★ 位置是承重的：必须在 `persistCutDraft()` 之后、`useFlow.getState().reset()`
 *   **之前**（见 hooks/useFlowActions 的 cut()）。挂在 `finishPublish` 上是错的 ——
 *   reset() 在组稿成功那一拍就把 nodes 清成 `[]`，此后剪辑页/发布页读到的画布**恒为空**，
 *   每条作品都会"成功"留存一份空工程，而不变量断言对空画布恒过、零报错。
 * ★★ 只放内存也是错的：上传一条三段片慢网上要一两分钟，App 被系统回收之后模块级变量
 *   随进程死（videos.ts:1691 那条 ★★ 记的正是这个形状），而**离线发布**与
 *   **传到一半被杀、下次冷启动由 flushPending 补发**这两条路上，画布本来就要跨进程活着。
 * ★ 这一刻**不做任何瘦身**：映射表要等发布回包才有（见 retain）。所以待办里躺的是一份
 *   带 dataURL 的完整画布，只活到 retain 成功那一刻。
 *
 * @returns null = 存住了；字符串 = **整句人话**（铁律八），由调用方随导航带到 /cut 去说。
 */
export async function captureCanvas(input: {
  title: string;
  canvas: CanvasSnapshot;
  reviseOf?: { videoId: string; baseRevision: number } | null;
}): Promise<string | null> {
  // 空画布不值得留（也留不出东西来）：组稿被拒/单段编辑那些路都不该落一份空的
  if (!input.canvas?.flow?.nodes?.length) return null;
  try {
    const ok = await writePending({
      at: Date.now(),
      title: input.title,
      canvas: input.canvas,
      ...(input.reviseOf ? { reviseOf: input.reviseOf } : {}),
    });
    if (!ok) throw new Error("写盘被拒");
    return null;
  } catch (e) {
    console.warn("[projects] 画布捕获失败", e);
    return "工坊工程没能留在这台设备上（存储空间不足或浏览器隐私模式）——这条片发出去之后不能回炉";
  }
}

/**
 * 给待办盖上发布幂等键：`flushPending` 补发时靠它认出"这份画布是那条作品的"。
 *
 * ★★ **只盖没盖过章的那一份**（2026-09-07 评审补）。原来是无条件覆盖，而
 *   `captureCanvas` 对空画布是**静默 return null**（不清、也不覆盖旧待办）——
 *   两条凑一起就能把上一条作品残留的待办认成这一条的：盖上 clientId 之后 `pendingFor`
 *   返回真，`retain` 会拿**上一条片**的画布去和这一条的回包配对，配不出映射 ⇒ 整份被
 *   墓碑化 ⇒ 然后"成功"PUT 上去。用户之后回炉打开的是另一条片的结构（一堆空框），
 *   而屏幕上一个字都没说错。
 *   ⇒ 判据：待办身上已经有 clientId（上一次发布盖的）或 reviseOf（那是回炉那摊活的身份）
 *     就**不盖**。此时这一条作品确实没有本机画布，`retain` 会走"待办缺失"那句实话，
 *     而上一条那份待办仍留着供它自己的「重试留存」用 —— 两边都不说谎。
 */
export async function stampPendingCanvas(clientId: string | undefined): Promise<void> {
  if (!clientId) return;
  const p = await readPending();
  if (!p || p.clientId === clientId) return;
  if (p.clientId || p.reviseOf) {
    console.warn("[projects] 待办已属于另一摊活，不盖章", { has: p.clientId ?? "revise", want: clientId });
    return;
  }
  await writePending({ ...p, clientId });
}

/**
 * 本机还留着一份**没提交上去**的待办、而且它对得上这条作品吗（供编辑页那颗「重试留存」）。
 * ★ 回炉的那份认 `reviseOf.videoId`；新发布的那份没有目标可认，只要还在就算 ——
 *   待办是**单键**（同一时刻只可能在做一摊活），认错的窗口就是"发了 A 又立刻发 B"，
 *   而那时 A 的待办早被 B 顶掉了，重试只会拿 B 的画布去补 A，`assertClean` 拦不住它。
 *   ⇒ 所以「重试留存」那颗键只在**这条作品是最近一次发布/回炉的那条**时才摆出来，
 *   判据由调用方补上（编辑页比对 `clientId`）。
 */
export function pendingFor(videoId: string, clientId?: string): boolean {
  if (!pending) return false;
  if (pending.reviseOf) return pending.reviseOf.videoId === videoId;
  // ★ 盖过作品 id 就只认它（见 PendingCanvas.videoId 的 ★★★）：这一格跨得过冷启动，
  //   而下面那个 clientId 跨不过（重启后 VideoItem.clientId 恒为 undefined）。
  if (pending.videoId) return pending.videoId === videoId;
  return !!clientId && pending.clientId === clientId;
}

// ── 瘦身：把画布里的本机地址换成永久 URL ─────────────────────

/** 与服务端 zod 那条**逐字同源**的不变量正则。
 *  ★ `data:` 那一段**带 mime 前缀**：canvas 里有 requirement / plot / genPrompt 这些自由
 *    文本，裸 `"data:` 会误伤。 */
const LOCAL_RE = /"(?:data:[a-z]+\/|idb:)|https?:\/\/[^"]*\.(?:volces|volccdn)\.com\//i;

/** 这个值是不是一个「只在本机 / 马上要过期」的资产地址（整段判，不扫自由文本内部） */
function isLocalAsset(v: string): boolean {
  if (/^data:[a-z]+\//i.test(v)) return true;
  if (/^idb:/.test(v)) return true;
  // 方舟临时直链：是 http(s)、但不是永久地址（判据与发布路径同一处，铁律六）
  return /^https?:\/\//.test(v) && !isPermanentUrl(v);
}

/** 这几格的「没有」值是 `undefined`（类型上就是可选的），其余一律空串 —— 塞对象是禁止的
 *  （见 types.Proposal.lost 的 ★★：会打坏承接判定 / refVideoOn / blockoutIssue 三条规则） */
const OPTIONAL_URL_KEYS = new Set(["videoUrl", "prevVideoUrl", "modelUrl", "poster", "sourceUrl", "castPreview"]);

/**
 * 就地重写：命中映射表的换成永久 URL，没命中的资产地址一律**墓碑化**（置成该字段本来
 * 就有的「没有」值）。返回一份新画布 —— 原对象一个字节不动（它还挂在 store 上）。
 */
function rewriteValues(node: unknown, map: Map<string, string>, key?: string): unknown {
  if (typeof node === "string") {
    const hit = map.get(node);
    if (hit) return hit;
    if (!isLocalAsset(node)) return node;
    return key && OPTIONAL_URL_KEYS.has(key) ? undefined : "";
  }
  if (Array.isArray(node)) {
    const out = node.map((x) => rewriteValues(x, map, key));
    // ★ 纯字符串数组（customRef.mids 那种参考图列表）里把空串清掉：留着它们，渲染层会
    //   拿 `src=""` 去画一张裂图。tags 之类的字符串数组本来就不含空串，顺带过滤无害。
    if (out.every((x) => typeof x === "string")) return (out as string[]).filter((x) => x !== "");
    return out;
  }
  if (node && typeof node === "object") {
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) {
      // ★ `videoByProposal` 是「走向 id → 成片地址」：值被墓碑化时**整条删掉**，
      //   不留空串。留着的话 `Object.keys(videoByProposal).length > 0` 仍为真 ——
      //   `openWorkDraft` 的 savedDoneCount 与草稿箱的「已出片 N」会把丢掉的段照报，
      //   而 `nodeDone` 读的是值（空串为假），两处对同一段给出相反的答案。
      if (k === "videoByProposal" && src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
        const m = src[k] as Record<string, unknown>;
        const kept: Record<string, string> = {};
        for (const pid of Object.keys(m)) {
          const v = m[pid];
          if (typeof v !== "string") continue;
          const hit = map.get(v);
          if (hit) kept[pid] = hit;
          else if (!isLocalAsset(v)) kept[pid] = v;
        }
        out[k] = kept;
        continue;
      }
      const v = rewriteValues(src[k], map, k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return node;
}

/** 第二遍：对着「重写前 / 重写后」两份方案，把丢掉的图位打上 `lost` 标记并计数 */
function markLost(before: unknown, after: unknown): number {
  let lost = 0;
  const mark = (b: Record<string, unknown>, a: Record<string, unknown>): void => {
    const gone = (k: string) => !!b[k] && !a[k];
    const flags: Record<string, true> = {};
    if (gone("firstFrame")) {
      flags.first = true;
      lost++;
    }
    if (gone("lastFrame")) {
      flags.last = true;
      lost++;
    }
    // ★★ 成片丢失与预览图丢失是**两笔账**（2026-09-07 评审补）：预览图重新推演就能补回来，
    //   而一段付过钱的成片没留下只能**重新出片、再花一次钱**。计数还是合一份（服务端的
    //   `lostCount` 只有一格），但**说话时必须分开**——把"要再花一次钱"的那一档说成
    //   "重新推演可以补回来"，是本仓最不该犯的那种错。分档判据在 `Proposal.lost.video`，
    //   横幅与方案卡各按它挑话（ReviseBar / PlanBoard）。
    if (gone("videoUrl")) {
      flags.video = true;
      lost++;
    }
    // ★★ `poster` **每一条**留存画布都必然丢（服务端不存它，发布时 zod 就 strip 了），
    //   所以只有 `firstFrame` 也空着时才算"真的少了一张预览"——白模段与参考直出段
    //   firstFrame 恒空，全靠 poster 显示。其余的用 firstFrame 顶上，报出来只会让
    //   用户以为坏了（本仓「不许拼一个骗人的数」的反面：也不许报一个吓人的数）。
    if (gone("poster") && !a.firstFrame) {
      flags.poster = true;
      lost++;
    }
    if (Object.keys(flags).length) a.lost = flags;
  };
  /** 一条链上的每个节点、每套方案都要过（主链与 alts 归档链都是 FlowNode[]） */
  const walkChain = (bs: unknown, as: unknown): void => {
    if (!Array.isArray(bs) || !Array.isArray(as) || bs.length !== as.length) return;
    for (let i = 0; i < bs.length; i++) {
      const bn = bs[i] as Record<string, unknown> | undefined;
      const an = as[i] as Record<string, unknown> | undefined;
      if (!bn || !an) continue;
      const bp = bn.proposals;
      const ap = an.proposals;
      if (!Array.isArray(bp) || !Array.isArray(ap) || bp.length !== ap.length) continue;
      for (let j = 0; j < bp.length; j++) {
        const b = bp[j] as Record<string, unknown> | undefined;
        const a = ap[j] as Record<string, unknown> | undefined;
        if (b && a) mark(b, a);
      }
    }
  };
  const bf = (before as CanvasSnapshot | undefined)?.flow;
  const af = (after as CanvasSnapshot | undefined)?.flow;
  if (!bf || !af) return 0;
  walkChain(bf.nodes, af.nodes);
  const ba = (bf.alts ?? {}) as Record<string, Record<string, unknown>>;
  const aa = (af.alts ?? {}) as Record<string, Record<string, unknown>>;
  for (const nid of Object.keys(ba)) {
    const byPidB = ba[nid] ?? {};
    const byPidA = aa[nid] ?? {};
    for (const pid of Object.keys(byPidB)) walkChain(byPidB[pid], byPidA[pid]);
  }
  return lost;
}

/** 断言：重写完还残留本机地址就抛（判据与服务端那条 zod refine 同源） */
function assertClean(canvas: unknown, videoId: string): void {
  const text = JSON.stringify(canvas ?? null);
  const m = LOCAL_RE.exec(text);
  if (!m) return;
  // ★ **不打整份画布**：它有几十到几百 KB，日志里刷一屏没人读得完
  console.warn("[projects] 断言不过", { videoId, sample: text.slice(Math.max(0, m.index - 20), m.index + 60) });
  throw new Error("画布里还有本机地址，换台设备取回来会是空的");
}

/**
 * 「留存的那份画布描述的是别的版次」——**不是网络问题**。
 *
 * ★ 单独一个类型是为了让调用方分得开：这一档重试与换网络都没用（再试一万次还是同一句话），
 *   摆一颗永远不会成的重试键比不摆更坏。出路只有两条：本机还留着那一版的待办就点
 *   「重新留存这一版」，否则只能重新发一条。
 */
export class StaleProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleProjectError";
  }
}

function msg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message.slice(0, 80) : "原因不明";
}

// ── 留存 ────────────────────────────────────────────────

/**
 * 发布成功之后留存这条作品的工程。**即发即忘**（调用方 `void` 它）：作品已经发出去了，
 * 留存成败是另一件事，靠 `data/jobs` 那张票说话。
 *
 * @param before **materialize 之前**那份草稿（还带着 dataURL）——不是 `sending`。
 *   配对表就是拿"发出去之前"与"回包"逐位置对出来的，传 sending 会得到一张空表。
 */
export function retainAfterPublish(videoId: string, before: DraftVideo, after: PairTarget & { title?: string }): Promise<void> {
  return retain(videoId, before, after, 0);
}

/** 回炉成功之后重新留存（`revision` 是回包里的新版次，必须对齐，否则下一次回炉
 *  会拿着一份描述上一版的画布去提交，把线上内容**静默退回**） */
export function retainAfterRevise(
  videoId: string,
  before: DraftVideo,
  after: PairTarget & { title?: string },
  revision: number,
): Promise<void> {
  return retain(videoId, before, after, revision);
}

async function retain(
  videoId: string,
  before: DraftVideo,
  after: PairTarget & { title?: string },
  revision: number,
): Promise<void> {
  // ★★ 老服务端（没有 /api/branch/projects 这条路由）**不弹失败票**（2026-09-08 评审）：
  //   那边每一次发布都会走到这里、PUT 撞 404，于是每发一条作品就多一张红票，写着
  //   「可在编辑页点「重试留存」」—— 而编辑页那颗键的判据是 `supported === true`，
  //   在这台服务器上永远不会出现。给一张指向不存在按钮的失败票，比不给更糟。
  //   ⚠ 只挡 `false` 这一档：`"error"`（问了没问到）要照常走 —— 把它当成"不支持"
  //     就会把真正的留存失败一起吞掉（铁律八）。
  //   ★★ `null`（还没问出结果）要**先问一次再判**（2026-09-08 复核补）：`supported` 的唯一
  //     写点是 `readyProjects()`，而它的唯一调用点在**编辑页**挂载时 —— 发布链路
  //     （pushPublish / flushPending / reviseVideo）一个都不调。于是最常见的那条路
  //     「装完 App 冷启动 → 直接进工坊 → 组稿 → 发布」走到这里时 supported 恒为 null，
  //     这道闸整个不触发，老服务端上照旧弹那张指向不存在按钮的红票；冷启动补发
  //     （flushPending）更是必然踩中。补问一次的代价是一次网络往返，而这整条路本来就是
  //     即发即忘的异步，不阻塞任何界面。
  if (supported === null) await readyProjects();
  if (supported === false) {
    console.warn("[projects] 这台服务器不支持工坊工程，跳过留存", { videoId });
    return;
  }
  let pend = await readPending();
  // ★★ 待办是**单键**，而它与 `cutSession` 是同一拍写的、两边都只有一格 —— 正常路径上
  //   它必然就是这条作品那一摊活。但"必然"是靠两个不变量撑起来的，而这里认错的后果不是
  //   "少留一份工程"，是**把另一条片的画布当成这条的工程存上去**：回炉打开是别人的内容，
  //   用户就着它点一下「替换原作品」，线上这条作品就被换成了那个（全程零报错）。
  //   ⇒ 就地比一次归属，对不上就当"待办缺失"处理（那句话说的正是实话：这条作品那份画布
  //     确实已经不在本机了）。判据走 `pendingFor()` **同一处实现**（铁律六）——
  //     编辑页那颗「重试留存」摆不摆得出来，问的是同一个问题。
  const mine = pendingFor(videoId, before.clientId);
  if (pend && mine && pend.videoId !== videoId) {
    // ★ 归属刚校验过，趁这一拍把作品 id 盖进待办 —— 之后「重试留存」就不再依赖那个
    //   活不过冷启动的 clientId（见 PendingCanvas.videoId 的 ★★★）。
    //   写盘失败不挡下面的留存：那只是让这颗键退回"只在本次会话里有"，比整发失败好。
    pend = { ...pend, videoId };
    await writePending(pend);
  }
  if (!pend || !mine) {
    // 待办不在了（换过设备 / 清过库 / 上一条待办被这条顶掉）。作品本身**已经发出去了**，
    // 所以这不是发布失败——话必须把两件事分开说（铁律八）
    console.warn("[projects] 待办缺失", { videoId, has: !!pend, mine });
    startJob({ kind: "project-retain", title: "留存工坊工程" }).fail(
      "没能留存工坊工程（本机那份画布已经不在了）——作品已经发出去了，只是这条暂时不能回炉。",
      `/edit/${videoId}`,
    );
    return;
  }
  const job = startJob({ kind: "project-retain", title: "留存工坊工程", progress: "提交中" });
  try {
    const { lost, videos } = await submit(videoId, before, after, revision, pend);
    job.done({
      // ★★ 分两句说（见 submit 的 ★★）：把"要再花一次钱"和"重截一下就有"混成一句
      //   「N 处素材」，往哪个方向说错都不高尚 —— 前者会让人以为不要紧，后者会把人吓住。
      msg: videos
        ? `工程已留存，但有 ${videos} 段成片没能留下——回炉时那几段要重新出片（会再花一次钱）${
            lost > videos ? `；另外 ${lost - videos} 处只是预览图` : ""
          }。回炉页会逐格标出来`
        : lost
          ? `工程已留存（有 ${lost} 处预览图没能留下，回炉时重新截一下就有，不花钱）`
          : "工程已留存，之后可在编辑页回炉重做",
      route: `/video/${videoId}`,
    });
  } catch (e) {
    console.warn("[projects] 留存失败", { videoId, why: msg(e) });
    job.fail(
      `工程没能留存（${msg(e)}）——作品已经发出去了，只是这条暂时不能回炉；可在编辑页点「重试留存」`,
      `/edit/${videoId}`,
    );
  }
}

/**
 * 「重试留存」：拿本机那份**已经瘦身好**的待办再 PUT 一次（编辑页那颗小键）。
 *
 * ★ 只在 `pendingFor()` 为真时摆得出来，所以这里不需要 before/after —— 那两样早就随
 *   发布那一拍过去了，重试要用的东西全在待办的 `ready` 里（见 PendingCanvas.ready 的 ★★）。
 * @returns null = 成了；字符串 = 整句人话。★ 这一条**要等结果**（用户就站在按钮前面）。
 */
export async function retryRetain(videoId: string, title: string): Promise<string | null> {
  const pend = await readPending();
  if (!pend) return "本机那份画布已经不在了——这条作品没法再补留存了。";
  if (!pend.ready) {
    // 瘦身都没算成（配对那一步就抛了）：重试也算不出来，如实说，别让用户点一辈子
    return "这份画布没能整理成可留存的样子——这条作品没法再补留存了。";
  }
  // ★★★ 版次**只能从待办自己身上算**，绝不许调用方把「现读的 video.revision」传进来
  //   （2026-09-08 评审抓到的致命项，原先的签名收第三个参数 `revision`，编辑页传的正是现读值）。
  //   服务端 putProject 那道 PROJECT_REVISION_MISMATCH 闸比的是「你报的 videoRevision」与
  //   「作品当下的 revision」，它挡的是**陈旧画布**。拿现读值去报，等于每次都报一个必然相等的数：
  //   闸恒开，而手里这份 canvas 描述的仍是**旧那一版**。落库就成了「canvas=第 1 版正文 /
  //   videoRevision=2」这种自相矛盾的行，而此后谁也看不出它陈旧了（客户端拿它和作品 revision
  //   一比正好对上）⇒ 下一次回炉就着它提交，**线上内容被静默退回上一版**，200、零报错、不可逆。
  //   正确的值待办里现成就有：回炉那份是 `reviseOf.baseRevision + 1`（回炉成功那一拍版次涨 1），
  //   新发布那份的作品是刚创建出来的，恒为 0。
  //   ⇒ 报错了反而是对的：版次对不上时服务端回 400，用户看到一句实话，而不是一次静默的内容回退。
  const revision = pend.reviseOf ? pend.reviseOf.baseRevision + 1 : 0;
  try {
    await put(videoId, title || pend.title, revision, pend.canvas, pend.lostCount ?? 0);
    return null;
  } catch (e) {
    return msg(e);
  }
}

/**
 * 瘦身 → 断言 → **写回待办** → PUT → 写缓存 → 清待办。
 * **唯一实现**（自动留存与「重试留存」共用最后那半段，铁律六）。
 * @returns `{ lost, videos }` —— 一共丢了几处、其中几处是**成片**。
 *   ★★ 两者必须分开报（见 markLost 的 ★★）：预览图重截一下就有，而一段付过钱的成片
 *   没留下只能重新出片、**再花一次钱**。合成一个数说「素材」是在两个方向上都说不准 ——
 *   要么把要花钱的那档盖过去，要么把不花钱的那档说得吓人。
 */
async function submit(
  videoId: string,
  before: DraftVideo,
  after: PairTarget & { title?: string },
  revision: number,
  pend: PendingCanvas,
): Promise<{ lost: number; videos: number }> {
  let canvas = pend.canvas;
  let lost = pend.lostCount ?? 0;
  if (!pend.ready) {
    const map = pairAssetUrls(before, after);
    canvas = rewriteValues(pend.canvas, map) as CanvasSnapshot;
    lost = markLost(pend.canvas, canvas);
    assertClean(canvas, videoId);
    // ★★ **先写回待办再 PUT**：配对表只在这一拍配得出来（before 是发出去之前那份草稿，
    //   after 是发布回包，两者只在此刻同时存在）。PUT 失败之后待办里如果还是原始画布，
    //   「重试留存」就再也配不出表 —— 整份画布会被墓碑化成一堆空框然后**成功**存上去。
    // ★ `videoId` 一并带上：这一句是拿调用方手里那份 pend 整份覆写，
    //   不显式带的话会把 retain 刚盖的作品 id 抹掉（见 PendingCanvas.videoId 的 ★★★）
    await writePending({ ...pend, videoId, canvas, ready: true, lostCount: lost });
  }
  await put(videoId, after.title || pend.title, revision, canvas, lost);
  // ★ 从**改写之后**那份画布上数（`markLost` 把 flags 写进去的正是它）——
  //   这样"重试留存"那条路（pend.ready 已经是改写过的）也数得出来，不用另存一位
  return { lost, videos: lostVideoCount(canvas) };
}

/**
 * 这份画布里有几套方案是**成片**没留下 —— 与 `lostCount` 同源，但分得出
 * 「重截一下就有」和「要重新出片（再花一次钱）」。判据只有 `Proposal.lost.video` 一处。
 */
function lostVideoCount(canvas: unknown): number {
  let n = 0;
  const chain = (ns: unknown): void => {
    if (!Array.isArray(ns)) return;
    for (const node of ns) {
      const ps = (node as Record<string, unknown> | undefined)?.proposals;
      if (!Array.isArray(ps)) continue;
      for (const p of ps) {
        const lost = (p as Record<string, unknown> | undefined)?.lost as Record<string, unknown> | undefined;
        if (lost?.video) n++;
      }
    }
  };
  const f = (canvas as CanvasSnapshot | undefined)?.flow;
  if (!f) return 0;
  chain(f.nodes);
  for (const alt of Object.values((f.alts ?? {}) as Record<string, unknown>)) chain(alt);
  return n;
}

/** PUT + 写本地缓存 + 清待办（成功才清）。★ 这三步的顺序不能换：清早了重试就没料了 */
async function put(videoId: string, title: string, revision: number, canvas: CanvasSnapshot, lost: number): Promise<void> {
  const meta = await api.putProject(videoId, {
    title: (title || "").slice(0, 120),
    canvas,
    videoRevision: revision,
    lostCount: lost,
  });
  // 回包形状认不出来 = 这台服务器还没有工程端点（**不看状态码**，见 api/projects 的 ★）
  if (!meta) throw new Error("这台服务器还不支持留存工坊工程");
  upsertMeta(meta);
  await writeCache(videoId, canvas, lost, revision);
  // ★ 只有真成了才清待办：失败时那颗「重试留存」还要用它
  await writePending(null);
}

// ── 取回 ────────────────────────────────────────────────

interface CachedProject {
  canvas: CanvasSnapshot;
  lostCount: number;
  videoRevision: number;
}

async function writeCache(videoId: string, canvas: CanvasSnapshot, lostCount: number, videoRevision: number): Promise<void> {
  await idbSet(cacheKey(videoId), { canvas, lostCount, videoRevision } satisfies CachedProject);
  const lru = ((await idbGet<string[]>(LRU_KEY)) ?? []).filter((x) => x !== videoId);
  const next = [videoId, ...lru];
  for (const gone of next.slice(LRU_MAX)) await idbDel(cacheKey(gone));
  await idbSet(LRU_KEY, next.slice(0, LRU_MAX));
}

/**
 * 取回这条作品的工程：本地缓存命中直接回，否则 GET 并写缓存。
 *
 * ★ 失败**原样抛**：404 `PROJECT_NOT_FOUND` 与"网络不通"是两句完全不同的话，
 *   调用方按 `ApiError.code` 分档（编辑页那条灰键 vs 整页取回态的 rose 正文）。
 *
 * ★★★ `expectedRevision` 是**硬闸**，不是对账用的显示值（2026-09-07 评审推翻的旧注释：
 *   那里写着「缓存里那份的 videoRevision 不当权威」——完全说反了，它是唯一说得出
 *   "这份画布画的是哪一版"的那一格）。
 *
 *   并发与陈旧是两件事，各要一道闸：
 *     · 作品的 `revision` 挡**并发**（两台设备同时提交，第二发 409）；
 *     · 画布的 `videoRevision` 挡**陈旧**（画布是第 1 版、线上已经是第 2 版）。
 *   只有前者时，一份陈旧画布配上现读的 `baseRevision` 会被服务端**正常接受**：
 *   200、revision 照涨、客户端那道 `revision === base + 1` 的门恰好判它成功，
 *   而线上内容被**静默退回上一版**，作者上一轮的改动全丢、全程零报错。
 *
 *   两条都很常见的可达路径：
 *     ① 单设备：回炉成功（rev 0→1）但 `retainAfterRevise` 那发 PUT 失败（断网 / PROJECT_QUOTA /
 *        待办缺失）——`put()` 只在 PUT 成功之后才 writeCache，于是本地缓存与服务端画布**都**
 *        停在 rev 0；再点一次回炉就是一次退回。
 *     ② 双设备：B 机点过一次回炉（GET 写了 rev 0 的缓存）后退出；A 机回炉成功（线上 rev 1）；
 *        B 机再点回炉，缓存命中拿到 rev 0 的画布，而 baseRevision 从 feed 现读是 1。
 *
 *   ⇒ 这里两道都判：缓存命中要 `videoRevision === expectedRevision` 才用（否则当没命中），
 *     GET 回来的也要对得上，对不上**整句拒**、不铺进工坊。
 * ★ 调用方拿到的 `videoRevision` 就是提交时该报的 `baseRevision`（**用画布自己那一格**，
 *   不是现读作品的 revision —— 后者永远"新鲜"，那道 409 就永远不会响）。
 */
export async function loadProject(videoId: string, expectedRevision: number): Promise<CachedProject> {
  const want = Number(expectedRevision) || 0;
  const hit = await idbGet<CachedProject>(cacheKey(videoId));
  if (hit?.canvas?.flow?.nodes) {
    if (hit.videoRevision === want) return hit;
    // 缓存里那份描述的是别的版次：当没命中，去问服务端要最新那份
    console.warn("[projects] 本地缓存的画布版次对不上，改走网络", { videoId, cached: hit.videoRevision, want });
  }
  const p = await api.getProject(videoId);
  if (!p) throw new Error("这台服务器还不支持回炉重做（没有工坊工程这个端点）");
  const canvas = p.canvas as CanvasSnapshot;
  if (!canvas?.flow?.nodes?.length) throw new Error("取回的工程是空的，铺不进工坊");
  if (p.videoRevision !== want) {
    // ★ 整句人话 + 说得出出路（铁律八）。这一档**不是**网络问题，所以"再试一次"没用，
    //   要么这台设备上还有那份没交上去的画布（编辑页那颗「重新留存这一版」），
    //   要么这一版的工程根本没留存成功，只能重新发一条。
    console.warn("[projects] 服务端那份画布也对不上版次", { videoId, got: p.videoRevision, want, stale: p.stale });
    throw new StaleProjectError(
      `留存的这份工程描述的是第 ${p.videoRevision + 1} 版，而这条作品已经是第 ${want + 1} 版了` +
        `——最新那一版的工程没有留存上来，取不到。`,
    );
  }
  const out: CachedProject = { canvas, lostCount: p.lostCount, videoRevision: p.videoRevision };
  await writeCache(videoId, canvas, p.lostCount, p.videoRevision);
  return out;
}

/** 用户主动放弃留存（编辑页那颗文字小键）。作品本身不受影响。
 *  @returns null = 删掉了；字符串 = 整句人话 */
export async function dropProject(videoId: string): Promise<string | null> {
  try {
    const ok = await api.deleteProject(videoId);
    if (!ok) return "这台服务器没有正常应答（工程可能还在）。";
  } catch (e) {
    return msg(e);
  }
  metas = metas.filter((m) => m.video !== videoId);
  await idbDel(cacheKey(videoId));
  await idbSet(LRU_KEY, ((await idbGet<string[]>(LRU_KEY)) ?? []).filter((x) => x !== videoId));
  emit();
  return null;
}
