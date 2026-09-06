// 空态 / 整页状态只有一份实现（2026-09-05 收口）。
//
// ★ 为什么要有它：收之前全 app 的"这里还没有东西"有四副面孔——草稿箱是 emoji + py-20，
//   消息页是铃铛图标 + 两行灰字，个人页是一行字 + bg-panel 键（没图标），模板市场是一行字
//   （没键），卡片/卡组/模板详情的"不存在"又各写一份 min-h-[70vh] 居中。同一个人在
//   同一个下午能看到四种，就像四个 app。
// ★ 三档字：正文 text-sm slate-400（出错时 rose-300）、补充 text-xs slate-600、
//   标题（很少用，只有"这一页只有管理员能进"这种要先说结论的）text-base 加粗。
// ★ 按钮走同一条按钮规则（CLAUDE.md「按钮两档形状」）：主 = bg-brand、次 = bg-panel + ring。
// ★ `full` = 整页态（卡不存在 / 未登录墙 / 取回中）：min-h-[70vh] 居中，自带 safe-top——
//   这类页面没有 PageHeader，状态栏那一圈只能由它自己让。
import { type ReactNode } from "react";
import Spinner from "./Spinner";
import { Link } from "react-router";
import Icon, { type IconName } from "./Icon";

export interface EmptyStateCta {
  label: string;
  /** 给 to 就渲染成 Link，否则渲染成 button */
  to?: string;
  onClick?: () => void;
  /** 死页跳走用 replace，别把死页留在历史栈里（CLAUDE.md「操作完去别的页」那条坑） */
  replace?: boolean;
  /** 主按钮（bg-brand）；默认是次级键 */
  primary?: boolean;
}

export default function EmptyState({
  icon,
  emoji,
  loading,
  title,
  text,
  hint,
  error,
  cta,
  full,
  className = "",
}: {
  /** 40px 线性图标（消息页的铃铛、卡片页的卡组） */
  icon?: IconName;
  /** 或者一个 emoji（📝 / 🔒），与 icon 二选一 */
  emoji?: string;
  /** 加载中：图标位换成转圈 */
  loading?: boolean;
  title?: ReactNode;
  text: ReactNode;
  hint?: ReactNode;
  /** 出错态：正文变 rose-300（"没取到"与"确实没有"要分开说——铁律八） */
  error?: boolean;
  cta?: EmptyStateCta;
  /** 整页态：min-h-[70vh] 居中 + safe-top */
  full?: boolean;
  className?: string;
}) {
  const shell = full ? "safe-top min-h-[70vh] justify-center" : "py-16";
  const ctaCls = cta?.primary
    ? "rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-ink"
    : "rounded-xl bg-panel px-5 py-2.5 text-sm font-semibold text-slate-100 ring-1 ring-slate-700";
  return (
    <div className={`flex flex-col items-center gap-3 px-6 text-center ${shell} ${className}`}>
      {loading ? (
        <Spinner size="lg" />
      ) : icon ? (
        <Icon name={icon} size={40} className="text-slate-600" />
      ) : emoji ? (
        <span className="text-4xl leading-none">{emoji}</span>
      ) : null}
      {title && <h2 className="text-base font-bold text-slate-100">{title}</h2>}
      <p className={`text-sm leading-relaxed ${error ? "text-rose-300" : "text-slate-400"}`}>{text}</p>
      {hint && <p className="text-xs leading-relaxed text-slate-600">{hint}</p>}
      {cta &&
        (cta.to ? (
          <Link to={cta.to} replace={cta.replace} className={ctaCls}>
            {cta.label}
          </Link>
        ) : (
          <button type="button" onClick={cta.onClick} className={ctaCls}>
            {cta.label}
          </button>
        ))}
    </div>
  );
}
