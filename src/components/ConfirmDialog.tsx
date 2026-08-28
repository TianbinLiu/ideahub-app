// 居中确认小窗（设置页系共用：退出登录 / 重看引导 / 清理缓存）。
//
// ★ 为什么是弹窗而不是把说明常驻在页面上：这些动作一年点不了几次，但每个都带着
//   一段"点了会发生什么"的话。常驻的话设置页就回到"说明文字铺满整屏"的老样子 ——
//   拆页那一轮（2026-08-27）的原则是：界面只留控件，话在用户要动手那一刻再说。
// ★ createPortal 到 body：设置子页现在没有会造包含块的祖先，但这类弹层已经在
//   backdrop-filter/transform 上栽过两次（CLAUDE.md「fixed inset-0 却只铺满一小块」），
//   统一走 portal 是唯一不用逐页核对祖先样式的写法。
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  /** 危险动作（退出登录这类）把确认键染红；默认品牌色 */
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  /** 「点了会发生什么」。只写已知事实，别吓人也别打包票（CLAUDE.md 那条确认卡文案的教训） */
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-8" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl border border-slate-700 bg-ink p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        <div className="mt-2 text-xs leading-relaxed text-slate-400">{children}</div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-600 py-2.5 text-xs font-semibold text-slate-300"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold disabled:opacity-50 ${
              danger ? "bg-rose-500 text-white" : "bg-brand text-ink"
            }`}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
