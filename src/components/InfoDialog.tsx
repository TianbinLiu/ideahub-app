// 纯信息小窗：只有一颗「知道了」，没有确认语义（要用户点头选边的用 ConfirmDialog）。
//
// ★ 它是"规则 / 须知"类长文案的容身处（2026-08-28 文案收纳）：页面上只留一句精华，
//   点入口才展开全文。与引导（tours）分工：引导是**这一屏**的一次性导览、内容集中在
//   tours.tsx；这里装的是**按当前数据动态拼**的说明（比如按卡种生成的取舍规则），
//   那种文案塞不进静态的引导步骤。
// ★ createPortal 到 body：这类页面的祖先里常有 backdrop-blur / transform 容器，
//   会给 fixed 后代造包含块（CLAUDE.md「fixed inset-0 却只铺满一小块」，栽过两次）。
import { Trans } from "@lingui/react/macro";
import { useId } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useDialogShell } from "./Sheet";

export default function InfoDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  // 对话框语义与焦点（2026-10-15 教材人格评审，规矩见 useDialogShell）。只给标题当名字、不把正文挂成描述：
  // 这里装的是整段规则 / 须知，挂成描述会让读屏在开窗那一拍一口气念完整篇，正文留给人自己往下读
  const titleId = useId();
  const { panelProps } = useDialogShell(onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        {...panelProps}
        aria-labelledby={titleId}
        className="max-h-[76vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-700 bg-ink p-4 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-sm font-bold text-slate-100">{title}</h3>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-slate-300">{children}</div>
        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-brand py-2.5 text-xs font-bold text-ink">
          <Trans>知道了</Trans>
        </button>
      </div>
    </div>,
    document.body,
  );
}
