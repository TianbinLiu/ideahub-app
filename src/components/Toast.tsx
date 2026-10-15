// 轻提示的唯一画法（数据在 data/toast）。挂在 App 根上一次，页面不用各自养 state。
// ★ 位置钉在底栏上方 1rem：与出片胶囊同一带，不压住底栏也不压住页面主键。
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { currentToast, runToastAction, subscribeToast } from "../data/toast";

export default function Toast() {
  const t = useSyncExternalStore(subscribeToast, currentToast, () => null);
  if (!t) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center" style={{ bottom: "calc(var(--tabbar-h) + 1rem)" }}>
      {/* 带键的那种整条可点（外层是 pointer-events-none，别让键被它罩住）；键本身 ≥32px 高，手指点得到 */}
      <span
        key={t.id}
        className={`flex items-center gap-3 rounded-full bg-black/80 text-xs text-white ${t.action ? "pointer-events-auto py-1.5 pl-4 pr-1.5" : "px-4 py-2"}`}
      >
        <span>{t.msg}</span>
        {t.action && (
          <button
            onClick={runToastAction}
            className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-semibold text-brand active:opacity-60"
          >
            {t.action.label}
          </button>
        )}
      </span>
    </div>,
    document.body,
  );
}
