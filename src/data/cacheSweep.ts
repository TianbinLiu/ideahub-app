// 清理本机缓存：只删**已经没人引用**的大文件（孤儿 blob）。
//
// 库里占地方的就两类，都是 blob 仓里的键：
//   merged:<id>    剪辑页合并出来的成片（几十 MB 一条）
//   model3d:<id>   AI 生成的 3D 模型 GLB（36MB 级）
// 它们不是直接被读的 —— 别的地方存的是一个 `idb:<键>` 指针（见 utils/mediaUrl）。
// 指针没了、blob 还在，就是孤儿：删了谁也不受影响，留着纯占配额。
// 孤儿是怎么来的：草稿被删/被 20 条上限挤掉、发布失败后重发、同一段重新合并过。
//
// ★★ 这个功能最大的风险是**删掉还有用的东西**，所以判据一律是"证明没人引用"，
//   不是"看着像没用"。凡是列不全引用来源的东西一概不碰：
//     - 未发布的草稿（正文 + 索引）—— 用户唯一的副本，永远不动；
//     - 待上传队列（发布失败的作品）—— 同上，那是还没传上去的成果；
//     - 账号库、互动数据、弹幕、设置 —— 都是 KB 级，删了也省不出空间。
//
// ★★ 还有一条时间闸门：**只扫 24 小时以前的键**。刚在剪辑页合出来的成片，
//   在存进草稿或发布之前**只被内存里的 store 引用着**，磁盘上找不到任何指针 ——
//   按"没人引用"判它就是孤儿，一键清理会把用户刚合完还没保存的成片删掉。
//   键名里带着生成时刻（uid() = `<前缀>_<Date.now() 的 36 进制>_<随机>`），
//   拿它兜住这一类"正在用但还没落盘"的情况。
import { idbDel, idbGet, idbKeys } from "./db";
import { listDrafts, loadDraft } from "./drafts";
import { listVideos, pendingPublishes } from "./videos";
import { cutSession } from "./cutSession";
import { myCards } from "./account";
import type { VideoSegment } from "../types";

/** 只清这两个前缀 —— 其余键要么是用户资产，要么小到不值得动 */
const SWEEPABLE = ["merged:", "model3d:"];

/** 比这个还新的键一律不碰（毫秒）。见文件头"时间闸门" */
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepPlan {
  keys: string[];
  bytes: number;
}

/** 从 `idb:xxx` 指针里取出键名；不是这种形式就返回 null */
function pointerKey(url: string | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  return url.startsWith("idb:") ? url.slice(4) : null;
}

function collectSegment(seg: VideoSegment | undefined, out: Set<string>): void {
  if (!seg) return;
  for (const u of [seg.videoUrl, seg.firstFrame, seg.lastFrame]) {
    const k = pointerKey(u);
    if (k) out.add(k);
  }
}

/**
 * 把磁盘上**所有**还指向 blob 的指针收集起来。
 * ★ 漏掉一处 = 删掉一份还在用的东西。所以宁可多收，别偷懒。
 */
async function collectReferenced(): Promise<Set<string>> {
  const refs = new Set<string>();

  // 1) 作品库（含分集、分支树、随片卡组）
  for (const v of listVideos()) {
    const cover = pointerKey(v.cover);
    if (cover) refs.add(cover);
    v.segments?.forEach((s) => collectSegment(s, refs));
    v.parts?.forEach((p) => p.segments?.forEach((s) => collectSegment(s, refs)));
    if (v.branchTree) for (const n of Object.values(v.branchTree.nodes)) collectSegment(n?.segment, refs);
    v.deck?.cards?.forEach((c) => {
      for (const u of [c.cover, c.modelUrl]) {
        const k = pointerKey(u);
        if (k) refs.add(k);
      }
    });
  }

  // 2) 待上传队列 —— 还没传上去的成果，里面的指针必须算数
  for (const p of pendingPublishes()) {
    const cover = pointerKey(p.draft.cover);
    if (cover) refs.add(cover);
    p.draft.segments?.forEach((s) => collectSegment(s, refs));
    p.draft.deck?.cards?.forEach((c) => {
      const k = pointerKey(c.cover);
      if (k) refs.add(k);
    });
  }

  // 3) 草稿正文（用户唯一的副本）。索引里只有缩略图，指针在正文里
  for (const meta of listDrafts()) {
    const thumb = pointerKey(meta.thumb);
    if (thumb) refs.add(thumb);
    const body = await loadDraft(meta.id);
    if (!body) continue;
    // 草稿正文的形状随创作模式变（工坊节点树 / 工作流快照），逐字段遍历容易漏。
    // 直接在序列化结果里扫 `idb:<键>` —— 宁可多认几个也不能漏
    try {
      for (const m of JSON.stringify(body).matchAll(/"idb:([^"]+)"/g)) refs.add(m[1]);
    } catch {
      /* 正文里有循环引用之类：那就保守地把这条草稿相关的都当成"引用中" */
      return new Set([...refs, "*"]);
    }
  }

  // 5) 剪到一半的那条成片（data/cutSession）——它引用着 merged webm 与组稿铸出来的 GLB，
  //    而那些**只被这一份稿子引用着**。⚠ 顺序上这一段必须与持久化同拍上线：
  //    漏了它，一条放过夜的剪辑稿会被这里把成片和模型真删掉，稿子还在、指针指向空气。
  //    写法照第 3 段（序列化后正则扫）：逐字段遍历容易漏。
  const cut = cutSession();
  if (cut) {
    try {
      for (const m of JSON.stringify(cut).matchAll(/"idb:([^"]+)"/g)) refs.add(m[1]);
    } catch {
      return new Set([...refs, "*"]); // 循环引用之类：保守起见这一轮什么都别删
    }
  }

  // 4) 账号库里的卡片（卡面 / 3D 模型）
  for (const c of myCards()) {
    for (const u of [c.cover, c.modelUrl]) {
      const k = pointerKey(u);
      if (k) refs.add(k);
    }
  }

  return refs;
}

/** 键名里带的生成时刻（uid() 的第二段是 Date.now() 的 36 进制）。解不出来返回 null */
function bornAt(key: string): number | null {
  const m = /_([0-9a-z]{6,10})_/.exec(key);
  if (!m) return null;
  const t = parseInt(m[1], 36);
  return Number.isFinite(t) && t > 1_600_000_000_000 && t < Date.now() + 86400_000 ? t : null;
}

/**
 * 算一算能清掉什么。**只看不删**，页面拿它显示"可清理 xx MB"。
 * @param now 注入当前时间，方便测试
 */
export async function planSweep(now = Date.now()): Promise<SweepPlan> {
  const refs = await collectReferenced();
  if (refs.has("*")) return { keys: [], bytes: 0 }; // 引用收集不完整，一个都不删
  const all = await idbKeys();
  const keys: string[] = [];
  for (const k of all) {
    if (!SWEEPABLE.some((p) => k.startsWith(p))) continue;
    if (refs.has(k)) continue;
    const t = bornAt(k);
    // 解不出时间的一律**不删**（老格式的键）：省这点空间不值得冒删错的风险
    if (t === null || now - t < MIN_AGE_MS) continue;
    keys.push(k);
  }
  let bytes = 0;
  for (const k of keys) {
    const v = await idbGet<unknown>(k);
    if (v instanceof Blob) bytes += v.size;
    else if (typeof v === "string") bytes += v.length;
  }
  return { keys, bytes };
}

/** 真删。返回实际删掉的条数 */
export async function runSweep(plan: SweepPlan): Promise<number> {
  for (const k of plan.keys) await idbDel(k);
  return plan.keys.length;
}
