// 「这一发成片还没取回」—— 待取回凭据的那块 UI，**唯一实现**（铁律六）。
//
// ★★ 为什么把它从 FlowPage 里搬出来（2026-08-31 复核抓到）：这一整块原来长在
//   `FlowPage` 的 `NodeScreen` 里，而 `NodeScreen` 在 2026-08-23 之后整个落进了
//   `{simple && …}` 那道闸 —— 于是**工作流画布与工坊这两面根本不渲染它**。
//   同一时刻 `flowStore.genNode` 的 pending 分支照常把「用下面的「取回」领回来，
//   别重新生成」写进 err（画布自己读 `s.err`，那句话看得见），而画布上唯一那颗键
//   是 `genNode` = 重新下一单。**提示语指向一个不存在的出口**，24 小时后凭据作废、
//   那笔钱彻底沉没。全程零报错。
//
// ★ 组件不认宿主：只读 flowStore 与 data/videoJobs，谁都能挂一份。
//   判「这一发是不是这条流水线的」由 `mine` 传进来（真闸在 `flowStore.takeJob`，
//   这里只是把"为什么按钮是灰的"画出来，别在这儿另写一遍判断）。
import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import {
  dismissVideoJob,
  pendingVideoJobs,
  subscribeVideoJobs,
  videoJobExpired,
  videoJobNote,
  videoJobsVersion,
  type VideoJob,
} from "../../data/videoJobs";
import { useFlow } from "../../studio/flowStore";

/** 待取回凭据的变动订阅（凭据落在 localStorage，见 data/videoJobs） */
export function useVideoJobs(): number {
  return useSyncExternalStore(subscribeVideoJobs, videoJobsVersion, () => 0);
}

/**
 * ★★ **「取回这一段」—— 这一整块是当初那次改造的目的本身。**
 *
 * 出片是先扣钱后等的（受理即计费，受理之后失败不退，见 docs/api-contract.md「扣费」），
 * 而等待窗口最长 25.5 分钟。在这块 UI 之前，客户端没接到结果 = 节点被打成
 * `failed` = 屏幕上唯一可点的是「♻ 重新生成（N token）」，也就是**再花一次钱**——
 * 而那一发的成片往往在方舟那边好好地存在着（2026-08-18 实测：15s 模板方舟约 13 分钟
 * 出片，当时 App 10 分钟就放弃了，那 ¥27 的成片是事后用任务号从方舟侧捞回来的）。
 *
 * ★★ 文案的重点**不是"重试"，是"别重复付费"**：用户看不出「取回」和「重新生成」的区别，
 *   而这两者差的是一次真金白银。整句由 `videoJobNote` 一处生成（列表、失败回话共用）。
 * ★ 剩余时间要**真的在走**（每分钟重算）：一条永远停在"还剩 3 小时"的提示比不显示更坏。
 *   24 小时不是我们定的时限，是方舟产物的物理寿命。
 * ★ 过期的那条**不给取回键**（摆一颗点了必然失败的按钮 = 让用户以为还有救），
 *   改给一颗"知道了"——否则这条提醒永远关不掉，久了连还能救的那几发一起被当成噪音。
 * ★ 取回失败**绝不自动重试、也绝不补一句"再试试"**：这条路上"再试"和"再下一单"
 *   长得一模一样。原样显示 data/ai 层给的整句人话。
 */
export function SegmentRecoverCard({ job, mine }: { job: VideoJob; mine: boolean }) {
  const takeJob = useFlow((s) => s.takeJob);
  const busy = useFlow((s) => s.busy);
  const [working, setWorking] = useState("");
  const [issue, setIssue] = useState("");
  // videoJobNote 是纯函数，重渲即刷新剩余时间
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const expired = videoJobExpired(job);

  async function take() {
    setIssue("");
    setWorking("正在取回…");
    try {
      await takeJob(job, (st) => setWorking(st));
    } catch (e) {
      setIssue(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking("");
    }
  }

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        expired ? "border-slate-600/60 bg-black/25" : "border-amber-500/50 bg-amber-500/10"
      }`}
    >
      <div className="text-[11px] font-bold text-amber-200">
        {expired ? `第 ${job.seg} 段那一发已经取不回来了` : `第 ${job.seg} 段有一发成片还没取回`}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-slate-400">{job.label}</div>
      <p className={`mt-1 text-[10px] leading-relaxed ${expired ? "text-slate-400" : "text-amber-200/90"}`}>
        {videoJobNote(job)}
      </p>
      {/* ★ 「这一发不是这条工作流的」要说出来，而且**不给按钮**：凭据跨草稿存活，
          用户完全可能是在另一条工作流里看到它的。硬取会把成片挂到别人身上，
          而凭据一销毁就真的没了。判据与 takeJob 里那道拦截同源（节点在不在本流里）。 */}
      {!expired && !mine && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          这一发不是这条工作流炼的：回到当初炼它的那条工作流（草稿在「我的」页），这颗取回键才会亮。凭据还在，没有浪费。
        </p>
      )}
      {issue && <p className="mt-1 text-[10px] leading-relaxed text-rose-300">{issue}</p>}
      {expired ? (
        <button
          onClick={() => dismissVideoJob(job)}
          className="mt-1.5 w-full rounded-full border border-slate-600 py-1.5 text-[11px] text-slate-300"
        >
          知道了，不用再提醒我这一发
        </button>
      ) : (
        <button
          onClick={() => void take()}
          disabled={!mine || !!working || busy}
          className="mt-1.5 w-full rounded-full bg-amber-500/90 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
        >
          {working ? "取回中…" : "📥 取回这一段的成片（不重新下单，不再花钱）"}
        </button>
      )}
      {/* 进度摆在按钮下面而不是塞进按钮里：它是整句（"正在向方舟核对…"），塞进去会折行 */}
      {working && <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{working}</p>}
    </div>
  );
}

/**
 * 本机**所有**待取回的那几发。三个宿主（简约页、工作流画布、工坊投影窗）各挂一份。
 *
 * ★ 列的是全部、不只当前这一段：每一条都是一笔已经花掉的钱，藏起来（哪怕只是藏到
 *   别的段里）就等于让它悄悄过期。
 * ★ 一条都没有时**整块不画**（返回 null），宿主不用自己判。
 */
export function SegmentRecoverList({ className = "" }: { className?: string }) {
  useVideoJobs(); // 凭据变了要重渲（落在 localStorage，不订阅就看不见新增/取回后的消失）
  const nodes = useFlow((s) => s.nodes);
  const jobs = pendingVideoJobs();
  if (jobs.length === 0) return null;
  /** 这一发落得回来吗：它当初炼的那一段那一套走向，还在**这条**工作流里。
   *  ★ 这只是**显示**的门（决定按钮亮不亮），判据必须与 `flowStore.takeJob` 里那道
   *    真拦截**逐字一致** —— 那边问的就是 `s.nodes` 上有没有这个 node+proposal。
   *    在这儿放宽（比如把 alts 里归档的旧走向也算上）会让按钮亮起来、点下去被拒，
   *    而用户读到的是"这个功能坏了"。 */
  const mine = (j: VideoJob) =>
    nodes.some((n) => n.id === j.nodeId && n.proposals.some((pp) => pp.id === j.proposalId));
  return (
    <div className={`space-y-1.5 ${className}`}>
      {jobs.map((j) => (
        <SegmentRecoverCard key={j.taskId} job={j} mine={mine(j)} />
      ))}
    </div>
  );
}
