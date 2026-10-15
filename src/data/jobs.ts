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
import { t } from "@lingui/core/macro";
import { onOwnerSwitch } from "./deviceOwner";

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
  /**
   * 「发起它的那一页」换了（见 Job.page）。给**抽屉里**发起的长活用（2026-10-15 教材人格评审 norman-interaction-1）：
   * 画布上的技能面板是 StudioPage / FlowPage 里的一层浮层，路由不变 —— 面板挂着时它自己画进度、胶囊不画（传路由）；
   * 面板收起之后哪怕人还在同一条路由上，胶囊也得出来说它还在跑（传 undefined），否则「收起但不丢」只是一句话，人看不见。
   */
  setPage: (page: string | undefined) => void;
}

/** 心跳间隔：5 秒 —— 比人「这是不是卡死了」的疑心起得早，又不至于让胶囊的字一直在抖 */
export const JOB_HEARTBEAT_MS = 5000;

/**
 * 给一张票打心跳：每 5 秒把「<head> · 已等 N 秒」写进进度，直到调返回的那个停表函数。
 * ★★ 为什么（2026-10-15 教材人格评审 norman-interaction-8 / norman-interaction-1）：分钟级的活（发布 Live2D 模型包 600 秒的
 *   multipart 退路、铸卡串行传图、等模型回话 30~170 秒）此前从 startJob 起一句话不动 —— 胶囊上「正在发布…」与卡死长得
 *   一模一样；分不清就会退出去重来，又是一次几分钟、或再扣一次钱。一个会动的「已等 N 秒」是最便宜的「它还活着」。
 * ★ `sync` 给页内那一行用（live2dUploadStore 的 progress、铸卡键下那句）：页内与胶囊写的是**同一个串**，不各算一个数。
 * ★ 停表要在结局之前调（done / fail 之后再 update 会把结局那句话盖掉）—— 放 finally 里；票已经被撤（换账号整表清掉）时
 *   update 找不到票是空操作，多跳几拍没有后果。
 */
export function heartbeatJob(job: JobHandle, head: string | (() => string), sync?: (text: string) => void): () => void {
  const t0 = Date.now();
  const timer = window.setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const prefix = typeof head === "function" ? head() : head;
    const text = t({ message: `${prefix} · 已等 ${sec} 秒`, comment: "后台任务胶囊的心跳行：prefix 是那一步本来的话（「拆分镜中」「正在发布…」），后面接已经等了几秒" });
    sync?.(text);
    job.update(text);
  }, JOB_HEARTBEAT_MS);
  return () => window.clearInterval(timer);
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

// ★★ 换成另一个账号的那一拍（2026-09-18，见 data/deviceOwner）：这些票都是上一个人的 —— 通知里写着他的卡名、
//   「回去看看 ›」点下去是他的表单 / 他的卡。整表撤掉。还在跑的那几件活回包时 update / done / fail
//   找不到票就什么都不做（patch 按 id 找），不会在新账号的胶囊里冒出来。
onOwnerSwitch(() => {
  if (jobs.length === 0) return;
  jobs = [];
  emit();
});

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
    // 传 undefined 就是「没有发起页」：胶囊在哪一页都画它（GenerationPill 判的是 `j.page && j.page === here`）
    setPage: (page) => patch(id, { page }),
  };
}

export function dismissJob(id: string): void {
  if (!jobs.some((j) => j.id === id)) return;
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}
