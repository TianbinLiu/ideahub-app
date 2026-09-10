// 开机装载：全 app **唯一**的一道开机闸（铁律六）。App.tsx 只把结果画出来。
//
// ★★ 为什么要有它（2026-09-10）：原来 App 是 `void Promise.all([ready*…]).then(() => setReady(true))`，
//   没有 catch。七个 ready* 里任何一个 reject，页面就永远停在「正在打开作品库…」—— 不说原因、
//   没有出路，`void` 还把这个 rejection 一起吞了。
// ★★ 而更常见的故障原来**根本不 reject**：`db.idbGet` 把一切读失败答成 undefined，装载拿 undefined
//   当"第一次用"。IndexedDB 打不开时 App 照常开机：草稿箱是空的、离线账号被登出、作品只剩种子，
//   下一次写入还会拿这份空表把磁盘上那份真的盖掉。所以核心库的装载改用 `idbRead`（读失败会抛），
//   失败才走得到这道闸上来。
//
// 分两档，判据只有一句：**缺了它硬进去，用户会不会以为做出来的东西没了**（下一次写入会不会把它盖掉）。
//   核心库 —— 失败就整页停住，说清原因，给「重试」（重跑一遍装载，不 reload）。
//   可降级 —— 互动记录、弹幕：自己 catch、冻结落盘，在用到它的那一屏说一句
//              （social.socialLoadIssue / danmaku.danmakuLoadIssue）。它们在这里还会 reject 的
//              只剩一种：等的上游核心库（账号库 / 作品库）挂了、原样抛上来 —— 由那一项负责说。
// ★ 剪到一半的成片（cutSession）自己把读失败当"没有"（它文件里的 ★，有意为之）、从不 reject；
//   列在核心库里是为了哪天它改成会抛时照样被拦住。连库级的故障（打不开）会先被草稿箱那一项拦下。
//
// ⚠ 失败页**不给「清理缓存」**（2026-09-10 核过）：它删的是没人引用的 merged: / model3d: blob，
//   碰不到让开机失败的任何一样东西；而它判"没人引用"读的正是草稿索引、剪辑稿、作品库 ——
//   它们没装上时去扫，草稿还指着的合并成片会被当成孤儿真删（cacheSweep.collectReferenced）。
import { readyAccount } from "./account";
import { readyCutSession } from "./cutSession";
import { readyDanmaku } from "./danmaku";
import { IdbError } from "./db";
import { readyDrafts } from "./drafts";
import { readySocial } from "./social";
import { readyTemplates } from "./templates";
import { readyVideos } from "./videos";

export interface BootFailure {
  /** 没打开的是哪几样。同一个错并成一条：离线模式下作品库要等账号库，账号库挂了它带着同一个错一起挂 */
  labels: string[];
  /** 人话原因 */
  reason: string;
  /** storage = 本地数据库打不开（腾空间、彻底重开 App 有用）；other = 装载时出了别的错 */
  kind: "storage" | "other";
  /** 原始错误，一行，给截图反馈用 */
  detail: string;
}

interface BootTask {
  label: string;
  core: boolean;
  run: () => Promise<void>;
}

// ★ 顺序就是原来 Promise.all 里的调用顺序，一个没动：它们是同一拍里并发起的，
//   谁先发请求 / 先排进 IndexedDB 队列由这个顺序决定，装载成功时的行为不该因为加了闸而变。
const TASKS: BootTask[] = [
  { label: "作品库", core: true, run: readyVideos },
  { label: "账号库", core: true, run: readyAccount },
  { label: "互动记录", core: false, run: readySocial },
  { label: "我的模板", core: true, run: readyTemplates },
  { label: "草稿箱", core: true, run: readyDrafts },
  { label: "弹幕", core: false, run: readyDanmaku },
  // 剪到一半的那条成片（钱已经花在里面了，见 data/cutSession 的 ★★）
  { label: "剪到一半的成片", core: true, run: readyCutSession },
];

let running: Promise<BootFailure[]> | null = null;

/**
 * 跑一遍开机装载，返回**核心库**的失败（空数组 = 可以进）。**按构造不会 reject**。
 *
 * ★ allSettled 而不是 all：all 在第一个失败时就返回，其余几样还在跑 —— 这时按「重试」会和上一轮
 *   叠着跑；而且只说得出第一个失败。
 * ★ StrictMode 下 effect 跑两遍：在途时复用同一轮。
 */
export function bootData(): Promise<BootFailure[]> {
  running ??= Promise.allSettled(TASKS.map((t) => t.run()))
    .then(collect)
    .catch((e: unknown) => [failureOf("作品库", e)])
    .finally(() => {
      running = null;
    });
  return running;
}

function collect(results: PromiseSettledResult<void>[]): BootFailure[] {
  // ★ 按**人话原因**归并：同一次"本地数据库打不开"会让四个核心库各抛一个 IdbError，一条条列出来就是
  //   同一句话说四遍；上游原样抛上来的（离线作品库在等账号库）本来就是同一个错。原始错误去重后并在一行。
  const byReason = new Map<string, { f: BootFailure; details: Set<string> }>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") return;
    const t = TASKS[i];
    // ★ 每一条都进控制台，降级那两样也不例外（铁律八：响）
    console.error(`[boot] ${t.label}没打开:`, r.reason);
    if (!t.core) return;
    const one = failureOf(t.label, r.reason);
    const same = byReason.get(one.reason);
    if (same) {
      same.f.labels.push(t.label);
      same.details.add(one.detail);
    } else {
      byReason.set(one.reason, { f: one, details: new Set([one.detail]) });
    }
  });
  return [...byReason.values()].map(({ f, details }) => ({ ...f, detail: [...details].join(" / ") }));
}

function failureOf(label: string, e: unknown): BootFailure {
  if (e instanceof IdbError) {
    const name = (e.original as { name?: unknown } | null)?.name;
    return {
      labels: [label],
      kind: "storage",
      reason: name === "QuotaExceededError" ? "手机存储空间不够，本地数据库打不开" : "手机上的本地数据库这会儿打不开",
      detail: e.why.slice(0, 200),
    };
  }
  return {
    labels: [label],
    kind: "other",
    reason: "装载时出了错",
    detail: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200),
  };
}
