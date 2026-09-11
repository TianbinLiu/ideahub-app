// 开机装载：全 app **唯一**的一道开机闸（铁律六）。App.tsx 只把结果画出来（components/BootFailed）。
//
// ★★ 为什么要有它（2026-09-10）：原来 App 是 `void Promise.all([ready*…]).then(() => setReady(true))`，没有 catch ——
//   任何一个 reject，页面就永远停在「正在打开作品库…」，不说原因、没有出路。
// ★★ 而更常见的故障原来根本不 reject：`db.idbGet` 把一切读失败答成 undefined，装载拿它当"第一次用"。
//   IndexedDB 打不开时草稿箱是空的、离线账号被登出、作品只剩种子，下一次写入还会拿空表把磁盘上的真数据盖掉。
//   所以存着用户东西的库一律改用 `db.idbRead`（读失败会抛）。
//
// ★★ 拦还是降级（2026-09-11 调研后定；出处与取舍见 docs/local-storage-failure.md）：
//   **本机数据只是缓存、或者只影响某一块功能 → 那一块降级，其余照常；整个 App 唯一的数据源都打不开 → 才整页拦住。**
//   · 整页拦（core）：作品库、账号库。远端模式（正式包）下它们来自服务端、开机根本不读 IndexedDB，
//     这道闸几乎只在「开机那一刻连不上服务器、只能退回本机库」时才可能关上 —— 那时本机库就是全部。
//   · 局部降级：草稿箱、我的模板、剪到一半的成片、互动记录、弹幕。各自 catch、记下原因
//     （draftsLoadIssue / templatesLoadIssue / cutSessionLoadIssue / socialLoadIssue / danmakuLoadIssue），
//     **冻结会盖掉磁盘数据的写**，在用到它的那一屏说清楚并给「重试」（进那一屏先自动试一次）。
//     它们在这里还会 reject 的只剩一种：等的上游核心库挂了、原样抛上来 —— 由核心库那一项负责说。
//
// ⚠ 失败页**不给「清理缓存」**：它删的是没人引用的 merged: / model3d: blob，碰不到让开机失败的任何东西；
//   而它判"没人引用"读的正是草稿索引、剪辑稿、作品库 —— 它们没读出来时去扫会误删（cacheSweep 按 loadIssue 整轮不删）。
import { readyAccount } from "./account";
import { readyCutSession } from "./cutSession";
import { readyDanmaku } from "./danmaku";
import { IdbError } from "./db";
import { readyDrafts } from "./drafts";
import { readySocial } from "./social";
import { readyTemplates } from "./templates";
import { readyVideos } from "./videos";

/** 整页拦住的那两样。★ 状态里只存 id，界面渲染时再翻：切语言时要跟着变 */
export type BootCore = "videos" | "account";

export interface BootFailure {
  /** 没打开的是哪几样（同一种原因的并成一条） */
  cores: BootCore[];
  /** storage = 本地数据库打不开；quota = 存储空间不够；other = 装载时出了别的错 */
  kind: "storage" | "quota" | "other";
  /** 原始错误，一行（技术信息，给截图反馈用，不翻译） */
  detail: string;
}

interface BootTask {
  /** null = 局部降级的库（自己 catch，不拦开机） */
  core: BootCore | null;
  /** 只进控制台 */
  name: string;
  run: () => Promise<void>;
}

// ★ 顺序就是原来 Promise.all 里的调用顺序，一个没动：它们是同一拍里并发起的，谁先发请求 / 先排进
//   IndexedDB 队列由这个顺序决定，装载成功时的行为不该因为加了闸而变。
const TASKS: BootTask[] = [
  { core: "videos", name: "videos", run: readyVideos },
  { core: "account", name: "account", run: readyAccount },
  { core: null, name: "social", run: readySocial },
  { core: null, name: "templates", run: readyTemplates },
  { core: null, name: "drafts", run: readyDrafts },
  { core: null, name: "danmaku", run: readyDanmaku },
  // 剪到一半的那条成片（钱已经花在里面了，见 data/cutSession 的 ★★）
  { core: null, name: "cutSession", run: readyCutSession },
];

let running: Promise<BootFailure[]> | null = null;

/**
 * 跑一遍开机装载，返回**核心库**的失败（空数组 = 可以进）。**按构造不会 reject**。
 *
 * ★ allSettled 而不是 all：all 在第一个失败时就返回，其余几样还在跑 —— 这时按「重试」会和上一轮叠着跑。
 * ★ StrictMode 下 effect 跑两遍：在途时复用同一轮。
 */
export function bootData(): Promise<BootFailure[]> {
  running ??= Promise.allSettled(TASKS.map((task) => task.run()))
    .then(collect)
    .catch((e: unknown) => [failureOf("videos", e)])
    .finally(() => {
      running = null;
    });
  return running;
}

function collect(results: PromiseSettledResult<void>[]): BootFailure[] {
  // ★ 按原因归并：同一次"本地数据库打不开"会让两个核心库各抛一个 IdbError；上游原样抛上来的本来就是同一个错
  const byKind = new Map<BootFailure["kind"], { f: BootFailure; details: Set<string> }>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    const task = TASKS[i];
    // ★ 每一条都进控制台，降级的那几样也不例外（铁律八：响）
    console.error(`[boot] ${task.name} 没打开:`, r.reason);
    if (!task.core) return;
    const one = failureOf(task.core, r.reason);
    const same = byKind.get(one.kind);
    if (same) {
      if (!same.f.cores.includes(task.core)) same.f.cores.push(task.core);
      same.details.add(one.detail);
    } else {
      byKind.set(one.kind, { f: one, details: new Set([one.detail]) });
    }
  });
  return [...byKind.values()].map(({ f, details }) => ({ ...f, detail: [...details].join(" / ") }));
}

function failureOf(core: BootCore, e: unknown): BootFailure {
  if (e instanceof IdbError) {
    const name = (e.original as { name?: unknown } | null)?.name;
    return { cores: [core], kind: name === "QuotaExceededError" ? "quota" : "storage", detail: e.why.slice(0, 200) };
  }
  return {
    cores: [core],
    kind: "other",
    detail: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200),
  };
}
