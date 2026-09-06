// 轻提示的唯一画法（数据在 data/toast）。挂在 App 根上一次，页面不用各自养 state。
// ★ 位置钉在底栏上方 1rem：与出片胶囊同一带，不压住底栏也不压住页面主键。
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { currentToast, subscribeToast } from "../data/toast";

export default function Toast() {
  const t = useSyncExternalStore(subscribeToast, currentToast, () => null);
  if (!t) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center" style={{ bottom: "calc(var(--tabbar-h) + 1rem)" }}>
      <span key={t.id} className="rounded-full bg-black/80 px-4 py-2 text-xs text-white">{t.msg}</span>
    </div>,
    document.body,
  );
}
