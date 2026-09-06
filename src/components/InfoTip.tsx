// 行内 ⓘ：长解释的**按需展开**容器（docs/ui-copy-grammar.md 的第三件套）。
//
// ★★ 它存在的全部意义：让「常驻一句短话」与「铁律八的信息如实可得」同时成立 ——
//   把 30 字的括号解释从界面上拿走而不是删掉。**不许**用它装三类必须内联的东西：
//   价钱（报价=实扣要贴在花钱的按钮上）、拒绝原因（err 整句就地）、危险确认
//   （DiscardFlowDialog 那类弹层）——那三类收进 ⓘ 就是把承重墙改成暗门。
// ★ portal 到 body（CLAUDE.md「fixed inset-0 却只铺满一小块」那条：画布世界层带
//   transform，会给 fixed 后代造包含块）；点任意处关闭；stopPropagation 隔开画布手势。
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function InfoTip({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        className="inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border border-slate-600 text-[9px] leading-none text-slate-500 align-middle"
        aria-label="说明"
      >
        ⓘ
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <div
              className="mb-24 w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-slate-700 bg-ink p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {title && <div className="mb-1.5 text-xs font-bold text-slate-100">{title}</div>}
              <div className="text-[11px] leading-relaxed text-slate-300">{children}</div>
              <button
                onClick={() => setOpen(false)}
                className="mt-3 w-full rounded-full border border-slate-600 py-1.5 text-[11px] text-slate-300"
              >
                知道了
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
