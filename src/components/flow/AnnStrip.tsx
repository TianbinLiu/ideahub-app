// 圈选标注的缩略条 —— **两面共用的唯一实现**（线性视图与画布）。
//
// ★★ 2026-08-21 抽出来（对抗评审确认）：画布加了「⭕ 圈选改画面」却没有跟着抽这一条，
//   于是标注**存了看不见、也删不掉**：存完屏幕上一个像素都不变，用户以为没存上就再圈
//   一遍（两条会在下次出片时串行叠加执行，后一条以前一条的产物为底图）；更死的一头是
//   白模段——圈过之后 genNode 会整句拒「白模出片没有设定帧可圈选修改——先删掉圈选标注」，
//   而画布上根本没有"删"这个动作，用户被指着一件在这一面做不到的事。
// ★ 只画与删，不判规则：能不能圈、圈了会怎样都在各自的宿主与 segmentGen 里。
import type { FlowAnn } from "../../studio/flowStore";

export default function AnnStrip({
  anns,
  onRemove,
  className = "",
}: {
  anns: FlowAnn[];
  onRemove: (annId: string) => void;
  className?: string;
}) {
  if (anns.length === 0) return null;
  return (
    <div className={`flex gap-1.5 overflow-x-auto pb-0.5 ${className}`}>
      {anns.map((a) => (
        <div key={a.id} className="relative w-24 flex-none overflow-hidden rounded-lg bg-panel">
          <img src={a.frame} alt="" className="h-12 w-full object-cover" />
          <div className="truncate px-1 py-0.5 text-[9px] text-slate-300" title={a.req}>
            {a.req}
          </div>
          <button
            onClick={() => onRemove(a.id)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] text-slate-200"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
