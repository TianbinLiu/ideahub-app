// 轻提示的唯一画法（数据在 data/toast）。挂在 App 根上一次，页面不用各自养 state。
// ★ 位置钉在底栏上方 1rem：与出片胶囊同一带，不压住底栏也不压住页面主键。
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { currentToast, pauseToast, resumeToast, runToastAction, subscribeToast } from "../data/toast";

export default function Toast() {
  const t = useSyncExternalStore(subscribeToast, currentToast, () => null);
  // ★ 两个 live region **常驻**，提示只在里面换进换出（2026-10-15 教材人格评审，WCAG 2.2 · 4.1.3 状态消息）：
  //   读屏只播报「已经在树上的 live region 里换进来的内容」，原来 `if (!t) return null` 让节点随消息一起挂载 ——
  //   整条提示是一个新节点，一个字都播不出，删草稿之后唯一的「撤销」也听不到。
  //   两个区各管一类：没键的回执 role=status（polite，等读完手头的再说）；带键的 role=alert（assertive：那颗键几秒就没了，得立刻说）。
  //   各自常驻是因为 role 不能临时换：区要先在树上、内容后进来才算「变化」。两个都空着时什么都不画，容器 pointer-events-none 也挡不住任何点击。
  const withAction = !!t?.action;
  const body = t && (
    /* 带键的那种整条可点（外层是 pointer-events-none，别让键被它罩住）；键本身 ≥32px 高，手指点得到。
       焦点落到「撤销」上就把计时停住（data/toast.pauseToast，离开再接着数）：读屏念完那句再摸到键，6 秒常常不够 */
    <span
      key={t.id}
      onFocus={pauseToast}
      onBlur={resumeToast}
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
  );
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center" style={{ bottom: "calc(var(--tabbar-h) + 1rem)" }}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {withAction ? null : body}
      </div>
      <div role="alert" aria-atomic="true">
        {withAction ? body : null}
      </div>
    </div>,
    document.body,
  );
}
