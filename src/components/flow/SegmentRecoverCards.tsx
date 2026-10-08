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
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { showToast } from "../../data/toast";
import { useSyncExternalStore } from "react";
import {
  checkVideoJobCharge,
  dismissVideoJob,
  importServerVideoJobs,
  recoverableVideoJobs,
  subscribeVideoJobs,
  videoJobExpired,
  videoJobFromServer,
  videoJobKnown,
  videoJobNote,
  videoJobRefunded,
  videoJobsVersion,
  type VideoJob,
} from "../../data/videoJobs";
import { ArkTaskFailed, ArkTaskUnknown, briefArkReason, chargeNote, chargeOnFail, unwrapFailure } from "../../ai";
import { jobLandsInPlace, useFlow } from "../../studio/flowStore";
import { useStudio } from "../../studio/studioStore";
import { draftsLoadIssue, draftsUnavailableText } from "../../data/drafts";

/** 待取回凭据的变动订阅（凭据落在 localStorage，见 data/videoJobs） */
export function useVideoJobs(): number {
  return useSyncExternalStore(subscribeVideoJobs, videoJobsVersion, () => 0);
}

/**
 * ★★ **「取回这一段」—— 这一整块是当初那次改造的目的本身。**
 *
 * 出片是先扣钱后等的（受理即计费，见 docs/api-contract.md「扣费」；2026-10-07 起受理之后上游明说失败的那一发由服务端退回），
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
  const { t } = useLingui();
  const takeJob = useFlow((s) => s.takeJob);
  const busy = useFlow((s) => s.busy);
  const [working, setWorking] = useState("");
  const [issue, setIssue] = useState("");
  // 这张卡还挂着吗：取回成功那一拍凭据结案、列表重画，这张卡**当场就卸载了**（见 take 里的 ★★）
  const alive = useRef(true);
  useEffect(() => {
    // ★ 挂载时置回 true（2026-09-18 发版复核抓到）：StrictMode 下 effect 会 mount → unmount → mount，
    //   只在 cleanup 里置 false 的话 dev 里它从第一拍起就恒为 false（同 #291 / #295 那一格）
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // videoJobNote 是纯函数，重渲即刷新剩余时间
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const expired = videoJobExpired(job);
  // 说钱之前先问服务端这一发的账（data/videoJobs.checkVideoJobCharge；到了 emit，这张卡重画）：过期的卡要知道退没退，
  // 没过期的卡要知道该不该许诺「万一没出成会自动退回」（上线之前受理的没有这一笔账、管理员免单的根本没扣）
  useEffect(() => {
    void checkVideoJobCharge(job);
  }, [job]);
  /**
   * 没过期、但服务端已经说「没出成、钱退了 / 正在退」（data/videoJobs.videoJobRefunded，与 videoJobNote 读同一份账）：
   * 没有成片可取了 —— 标题、按钮都跟着那句话走，摆「知道了」不摆「📥 取回」（2.62 发版评审抓到：话说「点知道了」，下面却只有一颗「取回」）。
   * ★ 这颗「知道了」走的仍是 take() → flowStore.takeJob，**不**直接 dismissVideoJob：takeJob 会当场再向上游核对一次（不花钱），
   *   确认没出成才结案，并把那一段挂着的「用下面的「取回」领回来，别重新生成」改成「没出成」—— 直接消掉的话，那句话会一直指着一颗
   *   已经不存在的「取回」（dismissVideoJob 的 ★）。
   * ★ 服务端登记表补来的那种（videoJobFromServer）例外，「知道了」直接在本机消掉（2.62 发版评审第三轮抓到）：它没有挂在哪一段上，
   *   上面那两条理由都不成立 —— 没有段上那句话要改；服务端只在上游明说没出成时才退钱，退了 / 正在退都翻不回「出成了」。
   *   而走 takeJob 要向上游跑一趟：查不动、或回包没带退款结论时卡就收不起来，原来一点就能消掉的卡变成要挂满 24 小时。
   *   （不给它摆「这一发我已经拿到了」那颗：退了钱的那一发根本没有成片，那句话是假的。）
   */
  const refunded = !expired && videoJobRefunded(job);
  /** 退了钱、又是服务端登记表补来的：「知道了」不核对、本机直接消（见上面的 ★） */
  const localClose = refunded && videoJobFromServer(job);
  /** 这张卡已经没有成片可取了（过期 / 退了钱）：灰底、不摆取回、不摆「不是这条流水线的」那句 */
  const closed = expired || refunded;

  /**
   * 取回失败那一句话。上游明说没出成（ArkTaskFailed）的那种要带上钱：退了 / 会退 / 没退各一句（只走 ai/failCharge），
   * 再接一句「重新生成会重新计费」—— 原来这里说的是写死的「费用不退」。其余失败（还在跑、查不动）原样说 data / ai 层给的整句。
   */
  function failLine(e: unknown): string {
    const inner = unwrapFailure(e);
    if (!(inner instanceof ArkTaskFailed)) return e instanceof Error ? e.message : String(e);
    const why = briefArkReason(inner, 80);
    const money = chargeNote(chargeOnFail(e), job.cost);
    const moneyLine = money?.line ?? "";
    return job.seg > 0
      ? t`第 ${job.seg} 段那一发没出成（${why}）。${moneyLine}要这一段的话重新生成（会重新计费）。`
      : t`服务器登记的那一发没出成（${why}）。${moneyLine}要这一段的话重新生成（会重新计费）。`;
  }

  /** @param closing 退了钱的那张卡点「知道了」：同一条 takeJob，只是话按「收起这一条」说（见上面 refunded 的 ★） */
  async function take(closing = false) {
    setIssue("");
    setWorking(closing ? t`正在核对…` : t`正在取回…`);
    try {
      await takeJob(job, (st) => {
        if (alive.current) setWorking(st);
      });
    } catch (e) {
      // ★★ 凭据被结案了（上游明说没出成、服务端已经退了钱 —— flowStore.takeJob 的 ★★）：这张卡在下一次重画时就卸载了，
      //   写进 setIssue 的话**没人看得见**（此刻 alive 多半还是 true，卸载在下一拍）。所以这一种一律用轻提示说，不看 alive。
      // ★ 「知道了」没能收起、而且是**没核对到结局**（ArkTaskUnknown：断网、查不动、上游还没给终态 —— 方舟与真人档两家都抛这个类型）：
      //   不复述取回那几句（里面说的是「再点一次『取回』」，这张卡上没有那颗键），也不另说钱 —— 钱上那句卡上已经照服务端的账说过了。
      // ★ 只这一种（2.62 发版评审第二轮抓到）：其余没收起的照原因说 —— 上游明说没出成、只是这次回包没带退款结论（ArkTaskFailed，
      //   failLine 照 ai/failCharge 说钱）、取回期间换了账号、正忙着别的，都是 failLine 给的那句真话；一律说成「没核对到」是把原因说错了
      const why =
        closing && videoJobKnown(job.taskId) && unwrapFailure(e) instanceof ArkTaskUnknown
          ? t`这一条暂时收不起来：没能向上游核对到这一发的结局——过一会儿再点一次「知道了」（核对不花钱）。`
          : failLine(e);
      if (!videoJobKnown(job.taskId)) {
        showToast(why, 8000);
        return;
      }
      if (alive.current) {
        setIssue(why);
        setWorking("");
      } else showToast(why, 6000);
      return;
    }
    // ★★ 取回成功**当场存草稿**（2026-09-06 主人真机）：取回那一拍凭据已销毁、成片只落在内存里的流水线上，
    //   这时 App 再被重启一次（系统回收 / 出包装机）这一发就谁都找不回来了。创作入口这个宿主没挂
    //   useFlowActions（那条"又炼出一段就自动存盘"只长在工作流 / 工坊页上），所以这里自己存。
    // ★★ 结果用**轻提示**说（2026-09-18，2.46 发版复核抓到）：取回成功那一拍凭据结案、列表重画，这张卡已经卸载了 ——
    //   原来写进 setIssue 的「存草稿没成」从来没人看得见，而那恰恰是「先别关 App」的那一句。
    // ★ 简约流水线（原节点本来就在简约模式里）不进草稿库：不去存，也不说成「存储空间不足」，照实说它只活在内存里。
    if (useFlow.getState().mode === "simple") {
      showToast(t`成片已经取回。简约模式不存草稿——趁现在把它剪完发出去，App 被关掉的话这一段就找不回来了`, 7000);
      return;
    }
    const meta = await useStudio.getState().saveWorkDraft({ from: "flow" }).catch(() => null);
    if (meta) showToast(t`成片已经取回，放进了流水线，也存进了草稿`, 3500);
    else
      // ★ 草稿箱没读出来时"去工坊点一次存草稿"只会原样再失败：换一句指对出路的（drafts.draftsUnavailableText）
      showToast(
        draftsLoadIssue()
          ? draftsUnavailableText()
          : t`成片已经落回流水线，但自动存草稿没成（存储空间不足或隐私模式）——先别关 App，去工坊点一次「存草稿」`,
        7000,
      );
  }

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        closed ? "border-slate-600/60 bg-black/25" : "border-amber-500/50 bg-amber-500/10"
      }`}
    >
      <div className="text-[11px] font-bold text-amber-200">
        {/* seg=0 = 服务端登记表补来的（本机没认领过它属于哪一段）。退了钱的那种不说「还没取回」：没有成片可取了（钱上那句在下面的 note 里） */}
        {expired
          ? job.seg > 0
            ? t`第 ${job.seg} 段那一发已经取不回来了`
            : t`有一发成片已经取不回来了`
          : refunded
            ? job.seg > 0
              ? t`第 ${job.seg} 段那一发没出成`
              : t`服务器上有一发成片没出成`
            : job.seg > 0
              ? t`第 ${job.seg} 段有一发成片还没取回`
              : t`服务器上有一发你付过钱的成片还没取回`}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-slate-400">{job.label}</div>
      <p className={`mt-1 text-[10px] leading-relaxed ${closed ? "text-slate-400" : "text-amber-200/90"}`}>
        {videoJobNote(job)}
      </p>
      {/* ★ 「这一发不是这条工作流的」要说出来，而且**不给按钮**：凭据跨草稿存活，
          用户完全可能是在另一条工作流里看到它的。硬取会把成片挂到别人身上，
          而凭据一销毁就真的没了。判据与 takeJob 里那道拦截同源（节点在不在本流里）。 */}
      {/* ★ 不是这条流水线炼的（原节点没了：重启后没打开草稿、或那一段从没存过草稿）——**照样能取**，
          取回来会新开一段安放（flowStore.placeRescuedSegment）。以前这里把键灰掉并指路"去打开那条草稿"，
          而最常见的情形正是根本没有那条草稿（2026-09-05 主人真机） */}
      {!closed && !mine && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
          <Trans>当初炼它的那一段不在这条流水线里（重启后没打开原草稿，或那一段从没存过草稿）：取回来会作为新的一段落在流水线里，之后照常剪辑、发布。凭据还在，没有浪费。</Trans>
        </p>
      )}
      {issue && <p className="mt-1 text-[10px] leading-relaxed text-rose-300">{issue}</p>}
      {/* 过期的卡把任务号摆出来（可长按复制）：那几句话里说的「把下面的任务号发给客服」要真的在下面 ——
          服务端问不出结局（lost）、真人档不再跟进的那几种，找客服核对这笔钱只能靠它 */}
      {expired && (
        <p className="mt-1 select-all break-all text-[10px] text-slate-500">
          <Trans>任务号：{job.taskId}</Trans>
        </p>
      )}
      {expired ? (
        <button
          onClick={() => dismissVideoJob(job)}
          className="mt-1.5 w-full rounded-full border border-slate-600 py-1.5 text-[11px] text-slate-300"
        >
          <Trans>知道了，不用再提醒我这一发</Trans>
        </button>
      ) : refunded ? (
        // 同一句「知道了」，走的是 take(true)（理由见上面 refunded 的 ★）；与取回键同一道 busy 闸：takeJob 在忙的时候整句拒。
        // 服务端补来的那种本机直接消（localClose），不看 busy；取回还在路上（working）时照旧灰着 —— 别和那一趟抢着结案
        <button
          onClick={() => (localClose ? dismissVideoJob(job) : void take(true))}
          disabled={!!working || (!localClose && busy)}
          className="mt-1.5 w-full rounded-full border border-slate-600 py-1.5 text-[11px] text-slate-300 disabled:opacity-40"
        >
          {working ? <Trans>核对中…</Trans> : <Trans>知道了，不用再提醒我这一发</Trans>}
        </button>
      ) : (
        <button
          onClick={() => void take()}
          disabled={!!working || busy}
          className="mt-1.5 w-full rounded-full bg-amber-500/90 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
        >
          {working ? (
            <Trans>取回中…</Trans>
          ) : mine ? (
            <Trans>📥 取回这一段的成片（不重新下单，不再花钱）</Trans>
          ) : (
            <Trans>📥 取回到这条流水线（新开一段 · 不再花钱）</Trans>
          )}
        </button>
      )}
      {/* ★ 服务端登记表补来的那种没过期也能消掉（data/videoJobs.videoJobFromServer 的 ★，2026-09-18）：
          登记表不知道谁取回了哪一发，这一发很可能在别的设备 / 官网上早就拿到了 —— 只给「取回」一颗键，
          等于逼他把一段已经有了的片子再落一遍流水线。本机自己交的那种照旧只在过期后给「知道了」。 */}
      {!closed && videoJobFromServer(job) && !working && (
        <button
          onClick={() => dismissVideoJob(job)}
          className="mt-1 w-full rounded-full py-1 text-[10px] text-slate-400 underline underline-offset-2"
        >
          <Trans>这一发我已经拿到了，不用再提醒</Trans>
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
  // 服务端登记表里本机不认识的那几发补成凭据（一分钟内只问一次；离线模式不发请求）。
  // ★ hook 排在早退之前（CLAUDE.md 那条坑：早退之后的 hook 会让整棵树崩）
  useEffect(() => {
    void importServerVideoJobs();
  }, []);
  // ★ 读 recoverable 不读 pending：这一会话正在等的那一发不摆（2026-09-05 主人点名
  //   "每次生成视频出片之前都弹『还没取回』"——凭据受理即落盘，等的时候它就在名单里）
  const jobs = recoverableVideoJobs();
  if (jobs.length === 0) return null;
  /** 这一发落得回来吗：它当初炼的那一段那一套走向，还在**这条**工作流里（样片定稿那一发还要那一套挂的还是那条样片）。
   *  ★ 这只是**显示**的门（按钮上说「取回这一段」还是「新开一段」），判据与 `flowStore.takeJob` 真落的那一处是**同一个函数**
   *    （`jobLandsInPlace`）—— 两处各写一遍的话，按钮说落回原位、点下去却新开一段（或反过来），用户读到的是"这个功能坏了"。 */
  const mine = (j: VideoJob) => jobLandsInPlace(nodes, j);
  return (
    <div className={`space-y-1.5 ${className}`}>
      {jobs.map((j) => (
        <SegmentRecoverCard key={j.taskId} job={j} mine={mine(j)} />
      ))}
    </div>
  );
}
