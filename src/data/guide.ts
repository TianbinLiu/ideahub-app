// 界面引导（新手教程）的**状态与"看过没有"的唯一实现**。
//
// ══ 这是什么 ══════════════════════════════════════════════════════════
// 每个界面角落一颗 `?`。点它 → 屏幕变暗、**锁住一切点击**、逐步讲这一屏怎么用，
// 用户只能点「下一步」，走完才恢复互动。**第一次进这个界面时自动强制弹一次**，
// 弹过之后不再自动弹，只能靠那颗 `?` 再看。
//
// ══ 为什么要有它（不是"再加一个功能"，是**减法**）══════════════════════
// 2026-08-17 盘了一遍：src/pages 与 src/components 的 44 个 .tsx 里有 **314 段**
// 界面说明文案，其中白模那条链上的 5 个文件就占了 165 段（RoleConfirmSheet 一个文件
// 71 段，最长的一屏连着 5 段约 400 字）。这些话每一句都有来历（多半是真事故的复盘），
// 但它们**常驻**在界面上：老用户每次都要跳过它们才能看见按钮。
// ⇒ 把「这个功能是什么、怎么用、会发生什么」那一类**常驻说明**搬进引导里；
//   界面上只留下**当下这一刻才成立**的那些话。
//
// ★★★ 有一类文案**绝不许**搬进来：条件触发的故障解释（离线 / 没登录 / 服务端没有
//   这个能力 / 余额不足 / 已发布不能改 / 超上限 / 删掉这个位子会怎样）。
//   它们是"出事了，这是原因和下一步"，而引导是"第一次进来看一遍就再也不弹"。
//   把故障解释藏进一个看过一次就不再出现的地方 = 静默失败（铁律八）。
//   判据很简单：**这句话是不是只在某个条件成立时才该出现**？是 → 留在界面上。
//
// ── 落盘 ────────────────────────────────────────────────────────────
// ★★ 必须用 localStorage 这类**同步可读**的存储：首帧就要判断"这一页要不要自动弹"。
//   本机库（data/db.ts）是 IndexedDB、异步的，读到的时候页面已经画完了 ——
//   表现是引导**闪现一下才出来**，或者干脆漏弹。现成先例：data/appUpdate 的 SKIP_KEY、
//   studio/quality 的首次定档、data/danmaku 的开关。
// ★ 不上服务端、不进账号库：这是**这台设备**的界面状态，不是用户数据。上服务端要额外
//   背两条坑（zod 默认 strip 未声明字段、本机库逐字段重建漏搬一行零报错），换来的
//   "换设备后不用再看一遍引导"并不值。
// ★ 存的是「引导 id → 看过的版本号」而不是一个布尔：将来某一屏改版了，把那份引导的
//   version 加一，就能只对那一屏重弹一次。**但"改了内容就重弹"不是默认行为** ——
//   用户明确要的是"弹过一次不再自动弹"，所以版本号只在**有意**要重弹时才动。

const SEEN_KEY = "ideahub-app.guide.seen.v1";

/** 「引导 id → 已看过的版本号」。读不出来一律当空表（宁可多弹一次，也不要漏弹） */
function readSeen(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return {};
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSeen(next: Record<string, number>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* 存不下（隐私模式/配额满）：这一次会话内不再弹（内存里那份还在），下次启动会再弹一遍。
       比整块崩掉好，也没有任何值得报给用户的东西 —— 引导多看一遍不是故障。 */
  }
}

/** 内存里那份（首帧就读一次，之后以它为准；写盘只是把它同步出去） */
let seen: Record<string, number> = readSeen();

// ── 订阅（与 data/account、data/drafts 同一套：模块级单例 + 单调版本号）──────
const listeners = new Set<() => void>();
let version = 0;
function emit(): void {
  version += 1;
  for (const fn of listeners) fn();
}
export function subscribeGuide(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function guideVersion(): number {
  return version;
}

// ── 正在放的那份引导 ────────────────────────────────────────────────
/**
 * 当前打开的引导。null = 没开（界面正常可点）。
 * ★ 全 app 同时只可能有一份：它是**锁住整屏**的东西，两份叠起来意味着有一份关不掉。
 */
let active: { id: string; step: number; path: string } | null = null;

export function activeGuide(): { id: string; step: number; path: string } | null {
  return active;
}

/**
 * 打开一份引导。`auto` = 这是"第一次进这一页"自动弹的（不是用户点 `?`）。
 *
 * ★★ 自动那一路**当场就记成看过**，而不是等用户走完最后一步。
 *   理由：用户完全可能在走到一半时被电话打断、或者应用被系统回收。若按"走完才算"，
 *   他下次进这一页会**再被强制拦一次**，而他已经看过前面几步了 —— 一个只该出现一次的
 *   东西反复出现，比漏看几步糟得多。想重看随时有那颗 `?`。
 * ★ 手动那一路（点 `?`）不动落盘：他本来就是回来复习的。
 */
export function openGuide(id: string, opts?: { auto?: boolean; version?: number }): void {
  // ★★ 记下**开在哪条路由上**。GuideGate 靠它判断"路由真的变了吗"，而不是
  //   "我的 effect 又跑了一次吗" —— 后者会被任何一次重挂误触发，表现是引导
  //   刚弹出来就自己没了（2026-08-17 真机上首页正是这个症状）。
  //   ★ 用 location.hash 而不是 useLocation：这是个纯数据模块，不该认识 React Router。
  //     HashRouter 下两者说的是同一件事。
  active = { id, step: 0, path: currentPath() };
  if (opts?.auto) markGuideSeen(id, opts.version ?? 1);
  emit();
}

/** 下一步。已经是最后一步时由调用方改调 closeGuide —— 这里只管推进下标 */
export function stepGuide(): void {
  if (!active) return;
  active = { ...active, step: active.step + 1 };
  emit();
}

/** 当前路由（HashRouter 下就是 hash 里那一段，不含 query） */
export function currentPath(): string {
  try {
    return (location.hash || "#/").replace(/^#/, "").split("?")[0];
  } catch {
    return "/";
  }
}

export function closeGuide(): void {
  if (!active) return;
  active = null;
  emit();
}

// ── 「看过没有」——**唯一实现** ───────────────────────────────────────
/**
 * 这份引导要不要自动弹？
 * ★ 判据只有这一处。谁在页面里另写一遍 `localStorage.getItem(...)`，症状是两处对
 *   版本号的理解漂移 —— 一边认为看过、一边认为没看过，于是引导要么再也不弹、
 *   要么每次进都弹，而两个方向都不报错。
 */
export function guideSeen(id: string, ver = 1): boolean {
  const got = seen[id];
  return typeof got === "number" && got >= ver;
}

export function markGuideSeen(id: string, ver = 1): void {
  if (guideSeen(id, ver)) return;
  seen = { ...seen, [id]: ver };
  writeSeen(seen);
  emit();
}

/**
 * 把「看过」的记录全清掉 —— 设置页那颗「重看所有新手引导」用。
 * ★ 有这颗按钮的理由：引导是**强制**弹的，一旦用户在没看懂的时候连点几下过去，
 *   那几屏就再也不会自动出现了。没有复位入口的话，他只能一页一页去找那颗 `?`。
 */
export function resetGuidesSeen(): void {
  seen = {};
  writeSeen(seen);
  emit();
}
