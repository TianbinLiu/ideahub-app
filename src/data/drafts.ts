// 在途工程草稿库。
//
// 存的是**还没发布**的半成品——出到一半的工作流、摆到一半的桌面。此前这部分完全没有
// 落盘，两个 store 都是纯内存单例，刷新一次就全没了（出片要几分钟、真金白银，丢一次很贵）。
// 已发布的作品**不在这里**。它们的「工坊工程」（供编辑页「🛠 回炉重做」取回来接着改的
// 那份画布）留在**服务端**，本机只有 5 条 LRU 缓存 —— 见 `data/projects.ts`。
// ★★ 两者刻意不共用这个索引：本文件的 `MAX_DRAFTS = 20` 按 updatedAt 降序 slice(0,20)、
//   不区分种类、被挤掉的正文直接 idbDel 且不通知任何人。而工程的 updatedAt 冻结在发布那一刻、
//   在途草稿每炼一段就刷新 —— 混进来的话**工程必然先出局**：用户发满 20 条之后，早期作品的
//   回炉能力会在零提示下消失（那正是 2026-08-10 删掉回炉的理由②的形状）。
//   ⇒ 别把留存工程塞进 drafts.v1，也别让 DraftSheet 去打开它。
//
// ★ 一份草稿同时装工坊侧与工作流侧，因为这两个模式本来就是同一份内容的两个视图：
//   工坊是 3D 桌面上的 NodeSlot 树，工作流是它活动路径铺开的逐段流水线。用户从哪边
//   打开都得能接着干，所以两边的状态要一起存、一起还原。
//
// 存储分两层，索引与正文分开：
//   drafts.v1        → WorkDraftMeta[]（几 KB，个人页列表只读它）
//   draft.<id>       → WorkDraft（含 1MB 级的首尾帧 base64，只在打开时读）
// 合在一起的话，个人页每次进都要把所有草稿的全部帧拉进内存。
//
// ★★ 每条草稿记**主人**（WorkDraftMeta.owner，2026-09-18 主人真机点名同一台手机换账号后数据串号）：
//   原来整台设备一张索引、不记主人 —— B 在草稿箱里看得到、打得开 A 的草稿（接着炼要花钱、发出去挂 B 的名字），
//   B 存草稿超过 20 条时还会把 **A 最旧的草稿**挤掉删除。现在：列表只列现在这个人的（deviceOwner）、
//   写 / 删 / 改名只动「内存里这摊活的主人」的（workOwner）、20 条上限按人各算。主人只问 data/deviceOwner。
//   升级前的草稿没有主人，由升级后第一个登录的账号认领（claimLegacy）。
// ⚠ 清缓存要看**所有人**的草稿（allDraftsForSweep / loadDraftForSweep）：只看现在这个人的，
//   别的账号草稿里引用着的成片与 GLB 会被当孤儿删掉。
import { t } from "@lingui/core/macro";
import { idbDel, idbGet, idbRead, idbSet } from "./db";
import { deviceOwner, mayClaimLegacy, onViewerChange, workOwner } from "./deviceOwner";
import { shrinkDataUrl } from "../utils/image";
import { Card, NodeSlot, uid } from "../types";

/** 草稿能用哪个模式打开 */
export type DraftMode = "studio" | "flow";

/** 工作流侧快照：字段与 flowStore 的同名状态一一对应（这里不 import flowStore，
 *  data 层不该依赖 store——依赖方向是 data → store → 组件） */
export interface FlowSnapshot {
  nodes: unknown[];
  /** 换走向的分支归档（flowStore.alts）。★ 判否定：老草稿缺省 = 没有归档过分支 */
  alts?: unknown;
  cursor: number;
  mode: "workflow" | "simple";
  origin: "studio" | "solo";
  template: unknown;
  subject: string;
  /** 「只出片不出卡组」的选择（flowStore.deckOff）。★ 2026-09-06 起缺省不出卡组：读的时候只有明确 false 才出 */
  deckOff?: boolean;
}

export interface WorkDraft {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 上次在哪个模式里编辑，个人页把它标成推荐入口 */
  lastMode: DraftMode;
  /** 工坊侧：节点树 + 桌面卡组 */
  root: NodeSlot | null;
  deck: Card[];
  /** ★ 曾经存过 editTarget（回炉编辑已发布作品的目标）。字段已去掉。
   *  老草稿正文里可能还带着这个键 —— 读的时候直接忽略即可，无需迁移：
   *  多一个用不上的键既不会让 openWorkDraft 出错，也不占多少空间。
   *  ⚠ 2026-09-07 回炉重新做起来了，但**这一格不复活**：回炉走的是 flowStore.reviseOf +
   *    服务端留存的工程（data/projects），不经草稿库。一份被重新打开的普通草稿**不该**
   *    悄悄拥有替换线上作品的权力 —— 那正是"存档被草稿箱就地认领并覆盖"那类事故的入口。 */
  /** 工作流侧流水线 */
  flow: FlowSnapshot | null;
}

/** 列表项：**不含帧数据**，个人页只读这个 */
export interface WorkDraftMeta {
  id: string;
  title: string;
  /** 320px 缩略图；没有可用画面时是空串 */
  thumb: string;
  createdAt: number;
  updatedAt: number;
  lastMode: DraftMode;
  /** 段数 / 已出片段数：列表上直接告诉用户"这条还差多少" */
  segCount: number;
  doneCount: number;
  hasRoot: boolean;
  hasFlow: boolean;
  /**
   * 这条草稿是**谁的**（user.id，见 data/deviceOwner）。
   * ★ 可选：升级前的索引项没有它 —— 由升级后第一个登录的人认领（claimLegacy），认领之前对谁都不列出。
   */
  owner?: string;
}

const INDEX_KEY = "drafts.v1";
const bodyKey = (id: string) => `draft.${id}`;

/** 上限：草稿带整帧 base64，一条几 MB 到几十 MB。超过就从最旧的开始清，
 *  否则 IndexedDB 配额被吃满后连成片都写不进去（publishVideo 曾因此静默丢过作品）。
 *  ★ 导出：个人页/草稿箱页把这个数说给用户听，别在文案里手写第二份 */
export const MAX_DRAFTS = 20;

let index: WorkDraftMeta[] = [];
let version = 0;
const subs = new Set<() => void>();

function emit() {
  version++;
  for (const fn of subs) fn();
}

export function subscribeDrafts(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

// 换了看的人：认领存量并让草稿箱 / 个人页按新的人重画
onViewerChange(() => {
  claimLegacy();
  emit();
});

/**
 * 升级前那些无主的草稿，归**现在登录的这个人**（见 data/deviceOwner 文件头「存量」那条）。
 * ★ 同步改内存、即发即忘落盘、**不 emit**：它会在渲染里（listDrafts 的快照读）被调到。改完之后这个人看到的
 *   列表本来就包含它们，没有要重画的。索引没读出来时不动（loadIssue：动了会拿空表盖掉磁盘上的真索引）。
 */
function claimLegacy(): void {
  const me = deviceOwner();
  if (!me || loadIssue || !index.some((d) => !d.owner) || !mayClaimLegacy()) return;
  index = index.map((d) => (d.owner ? d : { ...d, owner: me }));
  persistIndex();
}

export function draftsVersion(): number {
  return version;
}

/**
 * 草稿索引没读出来时的原因（空串 = 读好了）。
 *
 * ★★ 为什么不能当成"还没有草稿"（2026-09-11；开机闸调研后定为「局部可用」，见 data/boot 文件头）：
 *   草稿只存在这台设备上，里面躺着花钱炼出来的段。读不出来却照常给一张空表的话，草稿箱会说
 *   「还没有草稿」（用户读到的是"我的东西没了"），而下一次存草稿会拿只含新那一条的索引**整张盖掉**
 *   磁盘上的真索引 —— 旧草稿的正文还躺在库里，却再也列不出来。
 * ★ 所以非空时：列表是空的，但**一切改索引的写都拒**（saveDraft 回 null、删除 / 改名什么都不做），
 *   草稿箱与个人页按它画「没读出来 + 重试」而不是空态，清理缓存按它整轮不删（cacheSweep）。
 *   开机**不**因为它拦住整个 App：首页、账号、发现这些不靠本机草稿的功能照常能用。
 */
let loadIssue = "";
let loaded = false;

export function draftsLoadIssue(): string {
  return loadIssue;
}

/**
 * 装载。开机调一次，草稿箱上的「重试」、存草稿之前的自愈也调它。**不会 reject**：失败记进 loadIssue。
 * ★ 读好了之后再调直接返回：那时候再读一遍会拿磁盘上的索引把内存里那份整张换掉，
 *   而内存里可能正有一次还没落盘的写（persistIndex 是即发即忘的）。
 */
export async function readyDrafts(): Promise<void> {
  if (loaded && !loadIssue) return;
  try {
    // ★★ 读失败要抛（idbRead）落进 catch，不能 `?? []` 当成"还没有草稿"（见 loadIssue）；
    //   形状不对同样按"没读出来"算 —— 拿一个不是数组的东西当索引，列表页会在展开它的那一拍整页崩掉
    const saved = await idbRead<WorkDraftMeta[]>(INDEX_KEY);
    if (saved !== undefined && !Array.isArray(saved)) throw new Error(`${INDEX_KEY} is not an array`);
    index = saved ?? [];
    loadIssue = "";
    claimLegacy();
  } catch (e) {
    index = [];
    loadIssue = e instanceof Error ? e.message : String(e);
    console.warn("[drafts] 草稿索引没读出来，这次会话先不改索引:", e);
  }
  loaded = true;
  emit();
}

/**
 * 草稿箱没打开时，「存草稿没成」该怎么说。★ 唯一措辞（自动存盘 / 手动存 / 起名建档 / 取回后存 四处共用）：
 * 那几处原本只会说"存储空间不足或浏览器隐私模式，再点一次存草稿" —— 可索引没读出来是另一个原因、另一条出路，
 * 照老话再点一次只会原样再失败。调用方先问 draftsLoadIssue()：是它才用这一句，否则用各自原来那句。
 */
export function draftsUnavailableText(): string {
  return t`草稿箱这会儿没打开（本机数据库没读出来），这一版没存进草稿。去草稿箱点「重试」，读出来之后再存。`;
}

/** **现在登录的这个人**的全部草稿，最近改的在前（没登录 = 空） */
export function listDrafts(): WorkDraftMeta[] {
  const me = deviceOwner();
  if (!me) return [];
  claimLegacy();
  return index.filter((d) => d.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 「内存里这摊活的主人」名下的那条（工坊判缩略图、存草稿前查旧项用）。别人的一律当没有 */
export function getDraftMeta(id: string): WorkDraftMeta | null {
  const owner = workOwner();
  claimLegacy();
  return index.find((d) => d.id === id && !!owner && d.owner === owner) ?? null;
}

/** 打开一条草稿的正文。★ 只认「内存里这摊活的主人」的草稿：拿着别人草稿的 id 也打不开 */
export async function loadDraft(id: string): Promise<WorkDraft | null> {
  if (!getDraftMeta(id)) return null;
  return (await idbGet<WorkDraft>(bodyKey(id))) ?? null;
}

/**
 * **所有账号**的草稿索引（含还没被认领的）—— 只给 cacheSweep 收集引用用。
 * ★★ 别拿它画界面；清缓存也别改读 listDrafts()：那只列现在这个人的，别的账号草稿里的成片与 GLB 会被当孤儿删掉。
 */
export function allDraftsForSweep(): WorkDraftMeta[] {
  return [...index];
}

/** 读任意一条草稿的正文，不看主人 —— 只给 cacheSweep 用（理由同 allDraftsForSweep） */
export async function loadDraftForSweep(id: string): Promise<WorkDraft | null> {
  return (await idbGet<WorkDraft>(bodyKey(id))) ?? null;
}

function persistIndex() {
  // ★ 索引没读出来时不写：写下去就是拿内存里这张空表盖掉磁盘上的真索引（见 loadIssue）
  if (loadIssue) return;
  void idbSet(INDEX_KEY, index);
}

/**
 * 新建或更新一份草稿。返回落库后的索引项；写失败返回 null（配额满/隐私模式/索引没读出来）——
 * 调用方必须把这个 null 报给用户，不能静默当成保存成功（铁律八）：索引没读出来那一档用 draftsUnavailableText() 说
 * （判 draftsLoadIssue()），配额满 / 隐私模式由调用方整句说。（原来这里指的 draftSaveFailReason() 从没存在过。）
 */
export async function saveDraft(input: {
  id?: string | null;
  title?: string;
  lastMode: DraftMode;
  root: NodeSlot | null;
  deck: Card[];
  flow: FlowSnapshot | null;
  /** 用来生成缩略图的原始画面（首段首帧），可为空 */
  coverFrame?: string;
  /** 段数/完成数由调用方算（它才知道 FlowNode 的形状） */
  segCount: number;
  doneCount: number;
}): Promise<WorkDraftMeta | null> {
  // ★★ 索引没读出来时先自愈一次（再读一遍）；还读不出来就整个拒：正文照写会落一条永远列不出来的
  //   孤儿正文，索引照改会盖掉磁盘上的真索引（见 loadIssue）
  if (loadIssue) {
    await readyDrafts();
    if (loadIssue) return null;
  }
  // ★★ 记在「内存里这摊活是谁的」名下（workOwner，见 data/deviceOwner）：出片跑完那一拍会话可能刚好失效，
  //   这时自动存盘存的仍是上一个登录的人的流水线。一个人都说不出来就拒（写成无主 = 谁都看不见 = 静默丢）
  const owner = workOwner();
  if (!owner) {
    console.warn("[drafts] 说不出这条草稿是谁的（这一进程里没人登录过），不存");
    return null;
  }
  claimLegacy();
  const now = Date.now();
  // ★★ 拿着**别人**草稿的 id 来存（换号之前那条流水线的 workDraftId 还挂着之类）：另起一条新的，
  //   绝不覆盖别人的草稿 —— 那条是他的、可能是他花过钱的段唯一的备份
  const foreign = !!input.id && index.some((d) => d.id === input.id && d.owner !== owner);
  const id = !input.id || foreign ? uid("wd") : input.id;
  const prev = index.find((d) => d.id === id && d.owner === owner);
  // 缩略图只在没有、或原图换了的时候重算：一次 canvas 编码几十毫秒，自动保存会频繁触发
  const thumb = input.coverFrame ? await shrinkDataUrl(input.coverFrame) : (prev?.thumb ?? "");

  const body: WorkDraft = {
    id,
    // ★ 缺省标题存进草稿、之后原样显示：按存盘那一刻的界面语言定下来（与「未命名卡组」同一条先例）
    title: input.title?.trim() || prev?.title || t`未命名草稿`,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    lastMode: input.lastMode,
    root: input.root,
    deck: input.deck,
    flow: input.flow,
  };
  if (!(await idbSet(bodyKey(id), body))) return null;

  const meta: WorkDraftMeta = {
    id,
    title: body.title,
    thumb,
    createdAt: body.createdAt,
    updatedAt: now,
    lastMode: input.lastMode,
    segCount: input.segCount,
    doneCount: input.doneCount,
    hasRoot: !!input.root,
    hasFlow: !!input.flow && (input.flow.nodes?.length ?? 0) > 0,
    owner,
  };
  index = [meta, ...index.filter((d) => d.id !== id)];

  // 超量淘汰**这个人**最旧的（按 updatedAt），正文一并删掉。
  // ★ 上限按人各算：别的账号的草稿一条都不许因为这个人存草稿而被挤掉
  const mine = index.filter((d) => d.owner === owner);
  if (mine.length > MAX_DRAFTS) {
    const keep = [...mine].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
    const dropped = mine.filter((d) => !keep.some((k) => k.id === d.id));
    index = index.filter((d) => !dropped.some((x) => x.id === d.id));
    for (const d of dropped) void idbDel(bodyKey(d.id));
  }
  persistIndex();
  emit();
  return meta;
}

export async function deleteDraft(id: string): Promise<void> {
  // 索引没读出来：列表本来是空的，没有可删的；动了反而会盖掉磁盘上的真索引（见 loadIssue）
  if (loadIssue) return;
  // ★ 只删自己的（workOwner）：拿着别人草稿的 id 删不掉他的草稿
  if (!getDraftMeta(id)) return;
  index = index.filter((d) => d.id !== id);
  persistIndex();
  emit();
  await idbDel(bodyKey(id));
}

export async function renameDraft(id: string, title: string): Promise<void> {
  if (loadIssue) return; // 同上
  const t = title.trim().slice(0, 40);
  if (!t) return;
  const meta = getDraftMeta(id); // 只改自己的（同 deleteDraft）
  if (!meta) return;
  meta.title = t;
  meta.updatedAt = Date.now();
  persistIndex();
  emit();
  const body = await loadDraft(id);
  if (body) await idbSet(bodyKey(id), { ...body, title: t, updatedAt: Date.now() });
}
