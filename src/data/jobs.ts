// 后台任务登记簿 —— 「退出这一页也不断」的**可见性**那一半（2026-09-05 主人点名）。
//
// ★★ 为什么要有它：AI 出图 / 铸卡上传 / 模板登记这些活本来就是 Promise，页面卸载了它们
//   照跑（JS 里没有"随组件一起取消"这回事），断的从来不是任务，是**人**——退出那一页之后
//   屏幕上再没有任何一个字说"它还在跑 / 跑完了 / 失败了"。出片那条路早有全局胶囊
//   （GenerationPill 读 flowStore.busy / genNotice），这里把同一件事做成通用的：任何一条长活
//   `startJob()` 领一张票，进度 `update()`，结局 `done()` / `fail()`，胶囊统一画。
// ★ 与 `data/videoJobs`（付过钱、待取回的出片凭据）不是一回事：那边是**跨进程**的凭据
//   （localStorage，扛得住被系统回收），这边只活在内存里——任务本身随进程死，票也没必要活。
// ★ 结局要**说人话**并带一条路（`route`）：胶囊上那颗「回去看看 ›」点下去要有地方落。
//   `silent` 给"人就在那一页上"的场合：页面自己会画结果，再弹一条通知是重复。
// ★ 与 videos/danmaku 同一套订阅：模块级单例 + 版本号，`hooks/useJobs` 用 useSyncExternalStore 接。

export type JobStatus = "running" | "done" | "failed";

export interface Job {
  id: string;
  /** 分类（card-ai / card-mint / template-register …），只给日志与去重用 */
  kind: string;
  /** 胶囊上的名字（「AI 生成图位」「铸卡上传」） */
  title: string;
  /** 当前一步（「上传视频 63%」） */
  progress: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** 结局那句话（done / failed 时有） */
  msg?: string;
  /** 点通知去哪一页 */
  route?: string;
  /** 发起它的那一页：人就在这一页上时胶囊**不画进行态**（页面自己有进度） */
  page?: string;
}

export interface JobHandle {
  readonly id: string;
  update: (progress: string) => void;
  /** 成了。`silent` = 人就在那一页上、页面自己会画结果，不弹通知（票直接撤掉） */
  done: (o?: { msg?: string; route?: string; silent?: boolean }) => void;
  fail: (msg: string, route?: string) => void;
}

/** 已结束的票最多留几张（只是通知，读过就撤；多了只会挤在胶囊里轮着显示） */
const KEEP_FINISHED = 5;

let jobs: Job[] = [];
let version = 0;
const subs = new Set<() => void>();

function emit(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeJobs(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function jobsVersion(): number {
  return version;
}

/** 当前全部票（进行中 + 未撤的结局）。★ 每次变更都是新数组——useSyncExternalStore 认引用 */
export function listJobs(): Job[] {
  return jobs;
}

export function runningJobs(): Job[] {
  return jobs.filter((j) => j.status === "running");
}

/** hash 路由下"人现在在哪一页"（不带 query），给 `page` 用 —— 发起方在 store/组件里都能问 */
export function currentRoute(): string {
  const h = window.location.hash;
  if (h.startsWith("#/")) return h.slice(1).split("?")[0];
  return window.location.pathname;
}

function patch(id: string, p: Partial<Job>): void {
  const i = jobs.findIndex((j) => j.id === id);
  if (i < 0) return;
  jobs = jobs.map((j, k) => (k === i ? { ...j, ...p } : j));
  // 结束的票只留最近几张
  const finished = jobs.filter((j) => j.status !== "running");
  if (finished.length > KEEP_FINISHED) {
    const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((j) => j.id));
    jobs = jobs.filter((j) => !drop.has(j.id));
  }
  emit();
}

export function startJob(init: { kind: string; title: string; page?: string; route?: string; progress?: string }): JobHandle {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  jobs = [
    ...jobs,
    {
      id,
      kind: init.kind,
      title: init.title,
      progress: init.progress ?? "",
      status: "running",
      startedAt: Date.now(),
      ...(init.route ? { route: init.route } : {}),
      ...(init.page ? { page: init.page } : {}),
    },
  ];
  emit();
  return {
    id,
    update: (progress) => patch(id, { progress }),
    done: (o) => {
      if (o?.silent) {
        dismissJob(id);
        return;
      }
      patch(id, { status: "done", endedAt: Date.now(), progress: "", ...(o?.msg ? { msg: o.msg } : {}), ...(o?.route ? { route: o.route } : {}) });
    },
    fail: (msg, route) => patch(id, { status: "failed", endedAt: Date.now(), progress: "", msg, ...(route ? { route } : {}) }),
  };
}

export function dismissJob(id: string): void {
  if (!jobs.some((j) => j.id === id)) return;
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}
