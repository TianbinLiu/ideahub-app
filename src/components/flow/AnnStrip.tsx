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
  note,
  className = "",
}: {
  anns: FlowAnn[];
  onRemove: (annId: string) => void;
  /**
   * 「这几条不会重画 / 这一段整条不接受圈选」那句话。**整句由宿主传**
   * （唯一实现是 `flowStore.annSkipNote`）—— 本组件只画不判，与它顶上那条 ★ 同一条纪律。
   * ★★ 三个宿主都要传（画布 / 简约 / 工坊）：2026-09-03 主人点名「两面完全一样，
   *   只有 UI 不同」，而这句话此前只长在工坊那一面，圈选却主要发生在画布上。
   */
  note?: { text: string; tone: "warn" | "info" } | null;
  className?: string;
}) {
  if (anns.length === 0) return null;
  return (
    <div className={className}>
    <div className="flex gap-1.5 no-scrollbar overflow-x-auto pb-0.5">
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
      {note && (
        <p
          className={`mt-1 text-[10px] leading-relaxed ${note.tone === "warn" ? "text-amber-300/90" : "text-slate-500"}`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
