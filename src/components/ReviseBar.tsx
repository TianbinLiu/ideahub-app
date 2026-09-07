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
import { useState, useSyncExternalStore } from "react";
import { useFlow } from "../studio/flowStore";
import { useStudio } from "../studio/studioStore";
import { projectMetaOf, projectsVersion, subscribeProjects } from "../data/projects";

export default function ReviseBar({ className = "" }: { className?: string }) {
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
          回炉：《{reviseOf.title}》
          <span className="text-slate-400"> · 完成后会替换它的内容，链接不变</span>
        </span>
        <button
          onClick={() => {
            // ★ 只断开"替换谁"这一格，**画布一个字不动**：它接着当一条普通在途草稿，
            //   下一次自动存盘会把它另存下来（newWorkDraft 断开与旧草稿的关联）。
            useFlow.setState({ reviseOf: null });
            useStudio.getState().newWorkDraft();
          }}
          className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-300 ring-1 ring-slate-700"
        >
          退出回炉
        </button>
      </div>
      {lostCount > 0 && !lostClosed && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-amber-200">
            这份工程有 {lostCount} 处预览图没有留存 · 方案卡上画了虚线框，重新推演可以补回来
          </span>
          <button onClick={() => setLostClosed(true)} aria-label="知道了" className="flex-none text-[11px] text-amber-300/80">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
