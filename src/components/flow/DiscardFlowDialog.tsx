// 「已经有一条工作流在跑」——**创作入口与工坊法阵共用这一份**。
//
// ★★ 为什么非共用不可（2026-08-21 真机上撞见）：这段话要回答的是「丢弃到底会丢掉什么」，
//   而它此前在两处各写了一遍，且**两处都在撒谎**——都写着"已出片的段要重新花 token 再炼一次"。
//   事实是：每炼成一段，FlowPage 就会自动落一次草稿（见那边 doneCount 的 ★），
//   已出片的段躺在「我的 → 草稿」里，一个 token 都不用重花。
//   往"吓人"的方向说错不比往"放心"的方向说错高尚：用户会为了保住其实没危险的东西，
//   放弃一次本来无害的操作；而真正该慌的那种情况（自动存盘失败）反倒没人提醒他。
// ★ 所以这里不猜，只报**已知的事实**：studioStore.savedDoneCount 记的是"确实落进草稿的
//   已出片段数"，只有 saveWorkDraft 真的写成功才会动。它与当前 doneCount 的差额，
//   就是丢弃真正会烧掉的钱。
import { createPortal } from "react-dom";
import { useFlow } from "../../studio/flowStore";
import { useStudio } from "../../studio/studioStore";

export default function DiscardFlowDialog({
  discardLabel,
  onResume,
  onDiscard,
  onCancel,
}: {
  /** 丢弃那颗按钮上的字：两条入口做的事不同（开新的一条 / 按现在的走向重铺） */
  discardLabel: string;
  onResume: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const nodes = useFlow((s) => s.nodes);
  const savedDone = useStudio((s) => s.savedDoneCount);
  const done = nodes.filter((n) => Object.keys(n.videoByProposal).length > 0).length;
  const anns = nodes.reduce((s, n) => s + n.anns.length, 0);
  /** 出了片、却没能落进草稿的段数 —— 只有这些是丢弃时真会烧掉的钱 */
  const unsaved = Math.max(0, done - savedDone);

  // ★ portal 到 body + fixed：宿主已经有四个页面（创作入口/工坊法阵/模板货架/模板详情），
  //   靠"祖先恰好是定位容器"太脆；而祖先上任何一个 backdrop-blur / transform 都会给
  //   fixed 后代造包含块（CLAUDE.md「全屏浮层只铺满一小块」那条）。
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-100">已经有一条工作流在跑</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          {nodes.length} 段
          {done > 0 && <span className="text-emerald-300">，其中 {done} 段已出片</span>}
          {anns > 0 && <span className="text-amber-300">，{anns} 条圈选要求</span>}。
        </p>
        {/* ★ 第二段单独摆：上面是"有什么"，这里是"丢了会怎样"。三种情况说三句不同的话，
            含糊成一句的话，最该看清的那一种（有段没存上）就被稀释掉了 */}
        <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
          {done === 0 ? (
            <>开新的一条会把它丢掉——都还没出片，丢的是写好的要求与设定，没有花掉的钱。</>
          ) : unsaved === 0 ? (
            <>
              已出片的 <span className="text-emerald-300">{done} 段在炼成那一刻就自动存进了草稿</span>
              （「我的 → 草稿」里能接着做），<span className="text-emerald-300">不用重花 token</span>。
              这里丢掉的是那之后手改的东西：文字、圈选要求、还没炼的段。
            </>
          ) : (
            <>
              ⚠ 其中 <span className="text-rose-300">{unsaved} 段出片后没能存进草稿</span>
              （存储空间不足或隐私模式），丢弃就要<span className="text-rose-300">重花 token 再炼一次</span>。
              建议先「回去接着炼」，在那一页点「存草稿」把它们留住。
            </>
          )}
        </p>
        <div className="mt-3.5 flex flex-col gap-2">
          <button onClick={onResume} className="rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
            回去接着炼
          </button>
          <button
            onClick={onDiscard}
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 py-2.5 text-sm font-semibold text-rose-300"
          >
            {discardLabel}
          </button>
          <button onClick={onCancel} className="rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200">
            取消
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
