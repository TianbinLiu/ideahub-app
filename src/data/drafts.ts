// 在途工程草稿库。
//
// 存的是**还没发布**的半成品——出到一半的工作流、摆到一半的桌面。此前这部分完全没有
// 落盘，两个 store 都是纯内存单例，刷新一次就全没了（出片要几分钟、真金白银，丢一次很贵）。
// 已发布的作品不在这里，也不可回炉：成片一经发布即定稿，编辑页只改壳。
// （data/videos.ts 里曾有一套「源工程」备份专供回炉，2026-08 随回炉一起删了。）
//
// ★ 一份草稿同时装工坊侧与工作流侧，因为这两个模式本来就是同一份内容的两个视图：
//   工坊是 3D 桌面上的 NodeSlot 树，工作流是它活动路径铺开的逐段流水线。用户从哪边
//   打开都得能接着干，所以两边的状态要一起存、一起还原。
//
// 存储分两层，索引与正文分开：
//   drafts.v1        → WorkDraftMeta[]（几 KB，个人页列表只读它）
//   draft.<id>       → WorkDraft（含 1MB 级的首尾帧 base64，只在打开时读）
// 合在一起的话，个人页每次进都要把所有草稿的全部帧拉进内存。
import { idbDel, idbGet, idbSet } from "./db";
import { shrinkDataUrl } from "../utils/image";
import { Card, NodeSlot, uid } from "../types";

/** 草稿能用哪个模式打开 */
export type DraftMode = "studio" | "flow";

/** 工作流侧快照：字段与 flowStore 的同名状态一一对应（这里不 import flowStore，
 *  data 层不该依赖 store——依赖方向是 data → store → 组件） */
export interface FlowSnapshot {
  nodes: unknown[];
  cursor: number;
  mode: "workflow" | "simple";
  origin: "studio" | "solo";
  template: unknown;
  subject: string;
  /** 「只出片不出卡组」的选择（flowStore.deckOff）。★ 判否定：老草稿缺省 = false = 随片出卡组 */
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
  /** ★ 曾经存过 editTarget（回炉编辑已发布作品的目标）。回炉功能已删，字段一并去掉。
   *  老草稿正文里可能还带着这个键 —— 读的时候直接忽略即可，无需迁移：
   *  多一个用不上的键既不会让 openWorkDraft 出错，也不占多少空间。 */
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
}

const INDEX_KEY = "drafts.v1";
const bodyKey = (id: string) => `draft.${id}`;

/** 上限：草稿带整帧 base64，一条几 MB 到几十 MB。超过就从最旧的开始清，
 *  否则 IndexedDB 配额被吃满后连成片都写不进去（publishVideo 曾因此静默丢过作品）。 */
const MAX_DRAFTS = 20;

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

export function draftsVersion(): number {
  return version;
}

export async function readyDrafts(): Promise<void> {
  index = (await idbGet<WorkDraftMeta[]>(INDEX_KEY)) ?? [];
  emit();
}

/** 全部草稿，最近改的在前 */
export function listDrafts(): WorkDraftMeta[] {
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDraftMeta(id: string): WorkDraftMeta | null {
  return index.find((d) => d.id === id) ?? null;
}

export async function loadDraft(id: string): Promise<WorkDraft | null> {
  return (await idbGet<WorkDraft>(bodyKey(id))) ?? null;
}

function persistIndex() {
  void idbSet(INDEX_KEY, index);
}

/**
 * 新建或更新一份草稿。返回落库后的索引项；写失败返回 null（配额满/隐私模式）——
 * 调用方必须把这个 null 报给用户，不能静默当成保存成功（铁律八）。
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
  const now = Date.now();
  const id = input.id ?? uid("wd");
  const prev = index.find((d) => d.id === id);
  // 缩略图只在没有、或原图换了的时候重算：一次 canvas 编码几十毫秒，自动保存会频繁触发
  const thumb = input.coverFrame ? await shrinkDataUrl(input.coverFrame) : (prev?.thumb ?? "");

  const body: WorkDraft = {
    id,
    title: input.title?.trim() || prev?.title || "未命名草稿",
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
  };
  index = [meta, ...index.filter((d) => d.id !== id)];

  // 超量淘汰最旧的（按 updatedAt），正文一并删掉
  if (index.length > MAX_DRAFTS) {
    const keep = [...index].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_DRAFTS);
    const dropped = index.filter((d) => !keep.some((k) => k.id === d.id));
    index = keep;
    for (const d of dropped) void idbDel(bodyKey(d.id));
  }
  persistIndex();
  emit();
  return meta;
}

export async function deleteDraft(id: string): Promise<void> {
  index = index.filter((d) => d.id !== id);
  persistIndex();
  emit();
  await idbDel(bodyKey(id));
}

export async function renameDraft(id: string, title: string): Promise<void> {
  const t = title.trim().slice(0, 40);
  if (!t) return;
  const meta = index.find((d) => d.id === id);
  if (meta) {
    meta.title = t;
    meta.updatedAt = Date.now();
    persistIndex();
    emit();
  }
  const body = await loadDraft(id);
  if (body) await idbSet(bodyKey(id), { ...body, title: t, updatedAt: Date.now() });
}
