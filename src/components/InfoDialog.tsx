// 纯信息小窗：只有一颗「知道了」，没有确认语义（要用户点头选边的用 ConfirmDialog）。
//
// ★ 它是"规则 / 须知"类长文案的容身处（2026-08-28 文案收纳）：页面上只留一句精华，
//   点入口才展开全文。与引导（tours）分工：引导是**这一屏**的一次性导览、内容集中在
//   tours.tsx；这里装的是**按当前数据动态拼**的说明（比如按卡种生成的取舍规则），
//   那种文案塞不进静态的引导步骤。
// ★ createPortal 到 body：这类页面的祖先里常有 backdrop-blur / transform 容器，
//   会给 fixed 后代造包含块（CLAUDE.md「fixed inset-0 却只铺满一小块」，栽过两次）。
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export default function InfoDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6" onClick={onClose}>
      <div
        className="max-h-[76vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-700 bg-ink p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-300">{children}</div>
        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-brand py-2.5 text-xs font-bold text-ink">
          知道了
        </button>
      </div>
    </div>,
    document.body,
  );
}
