// 「你正在回炉重做某条已发布作品」那条常驻横条 —— **唯一实现**，工作流页与画布顶栏共用。
//
// ★ 为什么必须常驻：回炉态下这条流水线的终点不是「发一条新片」而是**替换掉一条线上作品**
//   （同一个链接、同一批播放/点赞/评论）。这件事只在发布页那一屏说一次是不够的：从取回工程
//   到点「替换原作品」中间隔着逐段出片、剪辑、合并，几十分钟起步；中途忘了自己在改哪条片
//   是最正常不过的事，而代价不可逆。
// ★ 出路也必须常驻（「退出回炉」）：断开之后画布**原样留着**当一条普通在途草稿 ——
//   用户随时可以改主意"把这一版当新片发出去"，而不是被锁在替换那条路上。
// ★ 缺失横幅（amber）是**事件档、可关**：留存那一刻拿不到映射的图位被显式墓碑化了
//   （见 data/projects 的 markLost），这里如实报数 —— 不报的话用户会以为方案卡坏了。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState, useSyncExternalStore } from "react";
import { useFlow } from "../studio/flowStore";
import { projectMetaOf, projectsVersion, subscribeProjects } from "../data/projects";

export default function ReviseBar({ className = "" }: { className?: string }) {
  const { t } = useLingui();
  const reviseOf = useFlow((s) => s.reviseOf);
  // ★ 缺失数**自己去问**，不靠上层传：这个横条有两个宿主（工作流页、画布顶栏），
  //   靠 prop 传就必然有一个宿主忘了传，而"忘了"的表现是横幅整条不出现（零报错）
  useSyncExternalStore(subscribeProjects, projectsVersion);
  const lostCount = reviseOf ? (projectMetaOf(reviseOf.videoId)?.lostCount ?? 0) : 0;
  const [lostClosed, setLostClosed] = useState(false);
  if (!reviseOf) return null;
  return (
    <div className={`flex-none space-y-1.5 px-4 ${className}`}>
      <div className="flex items-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-gold">
          <Trans>回炉：《{reviseOf.title}》</Trans>
          <span className="text-slate-400"> · <Trans>完成后会替换它的内容，链接不变</Trans></span>
        </span>
        <button
          onClick={() => {
            // ★ 只断开"替换谁"这一格，**画布一个字不动、草稿关联也一个字不动**：
            //   它接着当一条普通在途草稿，下一次自动存盘照常存回**同一条**。
            // ⛔ **不许在这里调 `newWorkDraft()`**（2026-09-08 评审删掉的那一句）。
            //   旧注释说它是为了"断开与旧草稿的关联"，但那件事 `openProject` 进来时
            //   就已经做过了（它把 workDraftId 置 null、savedDoneCount 置 0）——
            //   此刻 workDraftId 指的是**本次回炉自己新建的那条草稿**，断它有两条后果：
            //     ① `savedDoneCount` 归零，而 `done` 不变 ⇒ DiscardFlowDialog 按
            //        `unsaved = done - savedDone` 当面告诉用户「这 N 段出片后还没进草稿，
            //        丢了要重花 token」—— 那 N 段就好好躺在草稿里，一个 token 都不用重花。
            //        （那个弹层的文件头写着：往吓人的方向说错不比往放心的方向说错高尚。）
            //     ② 下一次自动存盘走 `saveDraft({ id: null })` **另存一条**，两条各带 MB 级的帧、
            //        抢同一份 MAX_DRAFTS=20 的额度，而那条孤儿只能靠用户自己去草稿箱认出来删。
            //   这正是 `useApplyTemplate` 的 `claim` 标记专门挡下来过的那个回归，
            //   ReviseBar 绕过那个 hook 直接调，把它重新引了回来。
            useFlow.setState({ reviseOf: null });
          }}
          className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-300 ring-1 ring-slate-700"
        >
          <Trans>退出回炉</Trans>
        </button>
      </div>
      {lostCount > 0 && !lostClosed && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          {/* ★★ 说「素材」不说「预览图」（2026-09-07 评审改）：这个数里**混着成片**
              （data/projects.markLost 把 `videoUrl` 丢失也计进同一个 lostCount），
              而一段成片没留下要**重新出片、再花一次钱**，不是"重新推演可以补回来"。
              把要花钱的那一档说成不花钱的那一档，是本仓最不该犯的那种错。
              ⚠ 服务端只回一个合计数（`lostCount`），这里分不出各是几处 —— 所以**不拆数**、
                只把两种可能都说到；逐格的准话在方案卡上（PlanBoard 按 `p.lost.video` 分档）。 */}
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-200">
            <Trans>
              这份工程有 {lostCount} 处素材没有留存 · 方案卡上逐格标了出来：预览图重新推演就能补回来，
              成片要重新出片（会再花一次钱）
            </Trans>
          </span>
          <button onClick={() => setLostClosed(true)} aria-label={t`知道了`} className="flex-none text-[11px] text-amber-300/80">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
