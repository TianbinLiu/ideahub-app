// 「剪到一半的那条成片」—— 剪辑页的合成稿落盘。
//
// ★★ 为什么必须落盘（这是**钱**的问题，不是体验问题）：进剪辑页那一刻，用户手上已经有
//   一摊**真花过钱**的东西，而它们**全都只活在内存里**：
//     · 组稿铸出来的卡组（最多 8 张，deckCardsSettle 真扣）与 3D 建模
//       （最多 2 个 × 160k token）—— GLB 落了 idb，但 `idb:` 指针只在内存 draft 上；
//     · 圈选重拍已经改好并已扣钱的那几段；
//     · 合并录出来的那条 webm（几十 MB，实时录制几分钟）；
//     · 方舟直链跨境转存的成果。
//   切后台被系统回收（这正是丢结果最常见的方式）之后，这些全部重来 —— 而"重来"意味着
//   **再收一次那笔钱**。守卫还会把人 `navigate("/studio")`，屏幕上一个字都不解释。
//
// ★ 照 `videos.ts` 的 PendingPublish 写（idb 键 + 内存镜像 + 启动装载 + 可见入口 + 放弃出路），
//   那一套的理由与这里逐条对得上。**不塞进 `data/drafts.ts`**：那是"还没做完的流水线"，
//   字段完全不重叠，而且它有 20 条上限 —— 塞进去等于拿剪辑稿挤真正的在途工程
//   （与「简约模式不进草稿库」被挡掉的理由同型）。
//
// ★ **永远只有一条**：同一时刻只可能在剪一条片子，新的整体覆盖旧的。所以不需要淘汰策略，
//   也不跟草稿那 20 条抢配额。
//
// ⚠ webm 与 GLB 的**字节不进这个键**，进来的只是 `idb:<键>` 指针 —— 但正因为如此，
//   `cacheSweep.collectReferenced` **必须把这条稿子里的指针算进引用**（那边第 5 段），
//   否则放过一夜的剪辑稿会被「清理缓存」把成片和模型真删掉，稿子还在、指针指向空气。
import { idbGet, idbSet, idbDel } from "./db";
import type { DraftVideo } from "../types";

const CUT_KEY = "ideahub-app.cut.v1";

export interface CutSession {
  draft: DraftVideo;
  /** 存下来的时刻（横幅上说"什么时候剪的"用） */
  at: number;
}

/** 内存镜像：页面与守卫都要**同步**问"有没有一条剪到一半的" */
let mirror: CutSession | null = null;
let loaded = false;

const listeners = new Set<() => void>();
function emit(): void {
  for (const fn of listeners) fn();
}
export function subscribeCutSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 启动时装载一次（与 videos/account 那几个 ready 并排挂在 App 的启动路径上） */
export async function readyCutSession(): Promise<void> {
  try {
    const raw = await idbGet<unknown>(CUT_KEY);
    mirror = validate(raw);
  } catch {
    mirror = null; // 读不出来就当没有：这是个恢复用的副本，不该让它把启动搞挂
  }
  loaded = true;
  emit();
}

/**
 * 存下来的东西当**不可信输入**：形状不对整条丢。
 * ★ 一份坏稿不该让剪辑页崩掉 —— 而它恰恰是"上次崩了/被杀了"才留下的。
 */
function validate(raw: unknown): CutSession | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<CutSession>;
  const d = o.draft as DraftVideo | undefined;
  if (!d || typeof d !== "object" || !Array.isArray(d.segments) || d.segments.length === 0) return null;
  return { draft: d, at: typeof o.at === "number" ? o.at : 0 };
}

/** 同步读镜像。★ 没装载完时返回 null —— 调用方要能分清"没有"和"还没装完"就问 `cutSessionReady()` */
export function cutSession(): CutSession | null {
  return mirror;
}

export function cutSessionReady(): boolean {
  return loaded;
}

/**
 * 存一稿。**回执是 boolean**（`idbSet` 本来就返回它）：存不住必须能被上层说出来 ——
 * 而调用它的每一处都恰好是"钱刚花出去"的那一拍（铁律八）。
 */
export async function saveCutSession(draft: DraftVideo): Promise<boolean> {
  const next: CutSession = { draft, at: Date.now() };
  const ok = await idbSet(CUT_KEY, next);
  if (ok) {
    mirror = next;
    emit();
  }
  return ok;
}

/** 这摊活收工了（发布成功 / 用户明确丢掉）。★ blob 不在这里删：交给 cacheSweep 24h 后收
 *  —— 在这儿再写一处删除逻辑就是第二份实现，而且它没有"还有没有别人引用"的全局视野 */
export async function dropCutSession(): Promise<void> {
  mirror = null;
  emit();
  await idbDel(CUT_KEY);
}
