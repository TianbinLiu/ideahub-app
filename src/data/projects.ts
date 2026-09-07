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
let supported: boolean | null = null;
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
 * ★ 失败**不抛**：编辑页据 `projectsSupported()` 的三态说话，异常在这里就地记录。
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
      supported = false;
      console.warn("[projects] 工程列表没拉到:", e instanceof Error ? e.message : e);
    }
    emit();
  })();
  return readyOnce;
}

/** 三态：null = 还没问出结果；false = 这台服务器不支持；true = 支持 */
export function projectsSupported(): boolean | null {
  return supported;
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

/** 给待办盖上发布幂等键：`flushPending` 补发时靠它认出"这份画布是那条作品的" */
export async function stampPendingCanvas(clientId: string | undefined): Promise<void> {
  if (!clientId) return;
  const p = await readPending();
  if (!p || p.clientId === clientId) return;
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
  const pend = await readPending();
  // ★★ 待办是**单键**，而它与 `cutSession` 是同一拍写的、两边都只有一格 —— 正常路径上
  //   它必然就是这条作品那一摊活。但"必然"是靠两个不变量撑起来的，而这里认错的后果不是
  //   "少留一份工程"，是**把另一条片的画布当成这条的工程存上去**：回炉打开是别人的内容，
  //   用户就着它点一下「替换原作品」，线上这条作品就被换成了那个（全程零报错）。
  //   ⇒ 就地比一次归属，对不上就当"待办缺失"处理（那句话说的正是实话：这条作品那份画布
  //     确实已经不在本机了）。判据走 `pendingFor()` **同一处实现**（铁律六）——
  //     编辑页那颗「重试留存」摆不摆得出来，问的是同一个问题。
  const mine = pendingFor(videoId, before.clientId);
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
    const lost = await submit(videoId, before, after, revision, pend);
    job.done({
      msg: lost
        ? `工程已留存（有 ${lost} 处预览图没能留下，回炉时会标出来）`
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
export async function retryRetain(videoId: string, title: string, revision: number): Promise<string | null> {
  const pend = await readPending();
  if (!pend) return "本机那份画布已经不在了——这条作品没法再补留存了。";
  if (!pend.ready) {
    // 瘦身都没算成（配对那一步就抛了）：重试也算不出来，如实说，别让用户点一辈子
    return "这份画布没能整理成可留存的样子——这条作品没法再补留存了。";
  }
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
 * @returns 有几处预览图没能留下；失败原样抛。
 */
async function submit(
  videoId: string,
  before: DraftVideo,
  after: PairTarget & { title?: string },
  revision: number,
  pend: PendingCanvas,
): Promise<number> {
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
    await writePending({ ...pend, canvas, ready: true, lostCount: lost });
  }
  await put(videoId, after.title || pend.title, revision, canvas, lost);
  return lost;
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
 * ★ 缓存里那份的 `videoRevision` **不当权威**：真正的并发支点是作品自己的 `revision`
 *   （data/videos 那边搬过来的那一格），提交时报的是它。这里回的这个只用来对账/显示。
 */
export async function loadProject(videoId: string): Promise<CachedProject> {
  const hit = await idbGet<CachedProject>(cacheKey(videoId));
  if (hit?.canvas?.flow?.nodes) return hit;
  const p = await api.getProject(videoId);
  if (!p) throw new Error("这台服务器还不支持回炉重做（没有工坊工程这个端点）");
  const canvas = p.canvas as CanvasSnapshot;
  if (!canvas?.flow?.nodes?.length) throw new Error("取回的工程是空的，铺不进工坊");
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
