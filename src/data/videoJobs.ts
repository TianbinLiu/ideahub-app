// 「一发**已经付过钱、还没取回成片**的出片任务」—— 本机凭据与那个 24 小时取回入口。
//
// ══ 为什么要有这一整个文件 ═══════════════════════════════════════════════
// 出片是**先扣钱、再等**的：契约「先扣钱、再转发；上游没受理就原路退回」+「受理之后才
// 失败不退」（docs/api-contract.md「扣费」）。也就是说任务一被方舟受理，这一发的钱就
// 已经花掉了，而后面还要等最长 25.5 分钟（死线按输出秒数缩放，见 arkClient）。
// 这段时间里手机切后台、弱网断线、**App 进程被系统回收**，任何一条都会让客户端接不到结果。
//
// 在这个文件之前，接不到结果 = `throw` → 节点被打成 `status:"failed"` → 界面上唯一
// 可点的是「♻ 重新生成（N token）」，也就是**再花一次钱**。而 2026-08-18 实测：15s 模板
// 方舟 ~13 分钟才出片，App 10 分钟就放弃了 —— 那 ¥27 的成片在方舟侧好好地存在着，
// 是事后用任务号从方舟侧捞回来的。**用户没有任务号，也没有能捞的地方。**
//
// ★★ 所以这里最重要的东西和 templates.ts 那一段一样：**不是主路径，是取回路径**。
//   取回入口的价值只有一个 —— **避免二次付费**。文案里必须把这句话说到脸上
//   （见 videoJobNote）：用户分不清"重试"和"再下一单"，而这两者差的是一次真金白银。
//
// ★★ 与 `data/templates.ts` 的 `BlockoutJob` 是**同一个形状、不同的存放地**，别把两者
//   的规则互相搬：那边的凭据由**服务端**发（阶段一 `startBlockoutize` 落库），所以那边
//   立了「这份名单只有服务端说得准，本机不存第二份」的规矩；而这里的方舟任务是
//   **客户端自己建的**（POST /api/ark/contents/generations/tasks，服务端只当代理计费，
//   不落业务凭据），**本机是唯一知道任务号的人**。要把这份名单搬到服务端得先改跨仓契约
//   （铁律：服务端要先发）—— 那是另一件事，不是这一件的前提。
// ★ 落 localStorage 而不是 IndexedDB：这份记录要在**渲染那一拍就能问出来**（"这一段
//   有没有待取回"直接决定按钮长什么样），异步库得再套一层"懒加载 + 到货 emit"的缓存，
//   而它救的恰恰是"进程被回收"这种最不该多绕一圈的场景。一条记录两百来字节。

/**
 * 凭据的有效期 —— 24 小时，**和 BLOCKOUT_JOB_TTL_MS 是同一个物理事实**：
 * 方舟产物 URL 是 TOS 签名地址，24h 过期；任务本身也只在方舟侧留这么久。
 * 过了这个点，我们拿着任务号也拉不到那段视频 —— 这一发的钱**无法挽回**，
 * 不是"稍后再来"。文案不许粉饰（见 videoJobNote）。
 *
 * ★ 这个数**没有和 templates 那份合并成一个常量**：两者今天相等是因为背后是同一条
 *   方舟规则，但它们的权威来源不同（那边以服务端下发的 `expiresAt` 为准，本机推算只是
 *   兜底；这边只有本机推算这一条路）。合并成一个 import 会让"服务端改了留存"这类变化
 *   看起来只该改一处，而实际上要改两处。
 */
import type { VideoAspect } from "../types";

export const VIDEO_JOB_TTL_MS = 24 * 3600_000;

/**
 * 过期多久之后把记录**真删掉**（纯粹的存储卫生，不是关于钱的规则）。
 * ★ 为什么不到期就删：过期那一刻用户多半还不知道这一发废了，那条"取不回来了、
 *   钱无法挽回"的说明本身就是要给他看的（他可以点「知道了」消掉，见 dismissVideoJob）。
 * ★ 为什么最终还是要删：这是**我们自己的** localStorage，一条永不清理的记录没有任何人
 *   受益。一周之后它既救不回钱、也不再是新闻。
 */
const PRUNE_AFTER_EXPIRY_MS = 7 * 24 * 3600_000;

/** 一发已经受理、还没取回成片的出片任务 */
export interface VideoJob {
  /**
   * 这一发是哪家出的。**可选、且缺省当成 "ark"** —— 2026-08-31 加这一位时，用户手上
   * 已经有的凭据里没有它，写成必填会让 `isJob` 把它们整批判否、**所有待取回的方舟成片
   * 一起蒸发**（后加的字段一律判否定，CLAUDE.md 那条）。
   *
   * ★ 为什么非有不可：取回的实现按家分流（方舟查 `GET tasks/:id`，真人档查
   *   `GET /video/:id` 再 `GET /file/:id`）。分错家的后果不是"取不到"，而是方舟那条
   *   404 分支会对着一发好好活着的真人档成片说「已经花掉的钱无法挽回」——
   *   一句权威的死刑判决，而用户不会来报 bug，他会直接走。
   */
  provider?: "ark" | "minimax";
  /** 任务号 —— 取回全靠它（两家的查询与取件都不计费） */
  taskId: string;
  /** 这一发是**哪条工作流的哪一段的哪一套方案**炼的：取回来的成片要落回同一个位置 */
  nodeId: string;
  proposalId: string;
  /** 第几段（1 起）。只为说人话——"第 3 段"比一串 id 好认 */
  seg: number;
  /**
   * 认得出是哪一发的一句话（模板名/段落标题）。
   *
   * ★ 这里**没有草稿 id**，是结论不是遗漏：落凭据的地方是 `flowStore.genNode`，而
   *   flowStore **绝不 import studioStore**（两个 store 互相 import，Vite 下会拿到
   *   半初始化的模块 —— 文件头那条铁律），草稿 id 只有 studioStore 手上有。
   *   所以"这一发属于哪条工作流"靠 `nodeId` 在当前工作流里找得到找不到来判
   *   （见 flowStore.takeJob），而这一句话负责让用户认出是哪一发。
   */
  label: string;
  /**
   * 取回成功时要补扣的 token —— 与 `flowStore.genNode` 成功时扣的是**同一个数**。
   *
   * ★★ 为什么取回也要扣：genNode 遵守全 app 的老约定「**拿到结果才扣**」，所以接不到
   *   结果的那一发在本机账上是没扣过的。取回等于这一段终于成了，此时不扣的话，
   *   "等到超时再取回"就成了一条白嫖通道 —— 而一段视频只该扣一次钱，不是零次。
   * ★ 这不和「取回不额外花钱」矛盾：远端模式下真正的扣费在**提交那一刻**由服务端做完了
   *   （`spendTokens` 在远端模式只是改本机镜像，见 account.ts），所以取回一分钱不多花；
   *   离线模式没有服务端、账是本机记的，这一扣补的正是提交时没记上的那一笔。
   *   两种模式下"这一段一共扣一次"都成立。
   */
  cost: number;
  /**
   * 原段的时长 / 画幅 / 档位 / 剧情（2026-09-05 加，老凭据没有——**判否定**）。
   * ★ 为什么要存：原节点已经不在流水线里时（App 被重启、而那一段从没存过草稿），取回来的成片
   *   要**新开一段**安放（flowStore.placeRescuedSegment），这几样定的是那一段长什么样。
   *   缺了按成片实测（时长 / 画幅）与缺省（档位）补，不整句拒。
   */
  durationSec?: number;
  aspect?: VideoAspect;
  videoTier?: string;
  plot?: string;
  createdAt: number;
}

const KEY = "ideahub-app.videoJobs.v1";

let jobs: VideoJob[] = load();
let version = 0;
const subs = new Set<() => void>();

function emit() {
  version++;
  for (const fn of subs) fn();
}

export function subscribeVideoJobs(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function videoJobsVersion(): number {
  return version;
}

function load(): VideoJob[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(isJob).filter((j) => !prunable(j));
  } catch {
    // 存储坏了/被清了：当作没有待取回的。★ 这里不该报错给用户 ——
    // 他要么真的没有待取回的，要么已经无从救起，两种情况下弹一句解析错误都没用
    return [];
  }
}

function isJob(x: unknown): x is VideoJob {
  const j = x as Partial<VideoJob> | null;
  return (
    !!j &&
    typeof j.taskId === "string" &&
    j.taskId !== "" &&
    typeof j.nodeId === "string" &&
    typeof j.proposalId === "string" &&
    typeof j.createdAt === "number"
  );
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    /* 存不下（配额满）：内存里那份还在，这次会话仍然取得回，重启后才丢。
       比整块崩掉好 —— 而且真到配额满的地步，用户手上有更大的问题 */
  }
}

function expiresAt(job: VideoJob): number {
  return job.createdAt + VIDEO_JOB_TTL_MS;
}

function prunable(job: VideoJob): boolean {
  return Date.now() >= expiresAt(job) + PRUNE_AFTER_EXPIRY_MS;
}

/** 过期了吗（过期 = 成片在方舟那边已经没了，取不回来）。**唯一实现**，界面别自己减时间戳 */
export function videoJobExpired(job: VideoJob): boolean {
  return Date.now() >= expiresAt(job);
}

/**
 * 「还剩多久 / 已经没了」的那一句话 —— **唯一实现**（取回卡、取回失败、节点角标都用它）。
 *
 * ★★ 两句话里都必须出现**「重新生成 = 再花一次钱」**。这是这整个功能存在的理由：
 *   用户面对一个没出片的段，默认理解是"重试一下"，而在这条路上"重试"的真实含义是
 *   **重新下一单**。不把这句话说到脸上，取回入口就只是一颗没人懂的按钮。
 * ★★ 过期那一句不许写成"已过期，请重新开始"：那一发的钱是**真花过**的，说清楚
 *   "无法挽回"比让他以为随时能回来取要好得多（templates.blockoutJobNote 同一条理由）。
 */
export function videoJobNote(job: VideoJob): string {
  // ★★ 真人档**不许出现任何小时数**：24 小时那个数是方舟产物 TOS 签名地址的物理事实，
  //   我们从没量过 MiniMax 那边留多久，仓里也没有任何一处记过。编一个数出来，
  //   用户会照着它决定"还来得及，明天再取" —— 而那正是最坏的一种错。
  //   过期判定（expiresAt）仍按同一个 TTL 走：它决定的是"我们还提不提醒你"，
  //   偏保守地早收手，比让一条永远关不掉的提醒钉在屏幕上强。
  const flat = job.provider === "minimax";
  const left = expiresAt(job) - Date.now();
  if (left <= 0) {
    return flat
      ? "这一发我们不再跟进了：任务号还在下面，如果一直没取回来，把它发给客服还有机会。已经花掉的钱我们这边退不了——重新生成是再花一次钱。"
      : "这一发已经取不回来了：方舟的成片只在服务器上留 24 小时，现在已经过期。已经花掉的钱无法挽回——这不是超时重来，重新生成是再花一次钱。";
  }
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  if (flat) {
    return (
      "这一发的钱在提交那一刻就已经花掉了，任务多半还在上游跑 —— 点「取回」不重新下单、不再花一分钱；" +
      "点「重新生成」是重新下一单、会再花一次。出片通常 1~2 分钟，隔一会儿再点一次。"
    );
  }
  return (
    `还剩 ${h > 0 ? `${h} 小时 ` : ""}${m} 分钟可以取回——方舟的成片只留 24 小时，过期就没了。` +
    `这一发的钱在提交那一刻就已经花掉了，取回不再花一分钱；点「重新生成」是重新下一单、会再花一次。`
  );
}

/**
 * 记下一发刚被受理的出片任务。**在开始等待之前调**（理由钉在 arkClient 的 onTask 上：
 * 进程被回收时，落过盘的那一份是唯一还活着的线索）。
 *
 * ★ 同一个 taskId 重复记只留一条：受理只发生一次，重复调用只可能来自重挂载/重试。
 */
export function rememberVideoJob(job: VideoJob): void {
  jobs = [...jobs.filter((j) => j.taskId !== job.taskId && !prunable(j)), job];
  persist();
  emit();
}

/**
 * 结案：成片已经落到节点上了，或者方舟明说这一发废了。
 * ★ **只在这两种情况下调**。"没接到结果"绝不许走这里 —— 那正是要留着凭据的场景，
 *   而销毁一条还能取回的凭据没有任何症状：界面上只剩「♻ 重新生成」，用户照付第二次。
 */
export function dropVideoJob(taskId: string): void {
  const next = jobs.filter((j) => j.taskId !== taskId);
  if (next.length === jobs.length) return;
  jobs = next;
  persist();
  emit();
}

/**
 * 「这一发取不回来了、别再提醒我」。
 * ★★ **只有已经过期的才允许消掉**：没过期的那些里面躺着的是**还能取回来的钱**，
 *   把它藏起来正是这整个文件存在意义的反面（templates.dismissBlockoutJob 同一条门禁，
 *   那边写得更长，理由一模一样）。谁把这道门放宽，症状是用户再也看不到自己有一发能领，
 *   而且零报错。
 */
export function dismissVideoJob(job: VideoJob): void {
  if (!videoJobExpired(job)) return;
  dropVideoJob(job.taskId);
}

/**
 * 这一会话里**正在等结果**的那几发（只在内存里，不落盘）。
 *
 * ★★ 为什么要有它（2026-09-05 主人真机点名"每次生成视频，出片之前都会弹一个黄色提示
 *   『第 1 段有一发成片还没取回』"）：凭据是**受理即落盘**的（理由见 rememberVideoJob），
 *   而取回卡读的是"本机所有凭据" —— 于是正在等的那一发从受理那一刻起就被当成"没接到"
 *   摆了出来，取回键还灰着（busy）。用户读到的是"刚下单就丢了一发"。
 * ★ **不落盘是设计**：进程一没，"正在等"就不成立了，那正是取回入口该出现的时刻
 *   （冷启动回来 waiting 为空，凭据照常摆出来）。
 * ★ 只是**显示门**：pendingVideoJobs / takeJob 那些读的仍是全部凭据，判据一处没变。
 */
const waiting = new Set<string>();

export function setVideoJobWaiting(taskId: string, on: boolean): void {
  if (on === waiting.has(taskId)) return;
  if (on) waiting.add(taskId);
  else waiting.delete(taskId);
  emit();
}

export function videoJobWaiting(taskId: string): boolean {
  return waiting.has(taskId);
}

/** 本机所有待取回的出片（新的在前）。★ 过期的**照样返回** —— 那句"钱无法挽回"要给人看见 */
export function pendingVideoJobs(): VideoJob[] {
  const live = jobs.filter((j) => !prunable(j));
  if (live.length !== jobs.length) {
    jobs = live;
    persist();
  }
  return [...live].sort((a, b) => b.createdAt - a.createdAt);
}

/** 该**摆出来让人取回**的那几发 = 全部凭据里去掉这一会话正在等的（取回卡列表读这个） */
export function recoverableVideoJobs(): VideoJob[] {
  return pendingVideoJobs().filter((j) => !waiting.has(j.taskId));
}

/** 这一段的这一套方案有没有待取回的那一发（节点卡上的取回入口据它显示） */
export function videoJobOf(nodeId: string, proposalId: string): VideoJob | null {
  return recoverableVideoJobs().find((j) => j.nodeId === nodeId && j.proposalId === proposalId) ?? null;
}
