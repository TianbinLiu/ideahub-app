// 搜索框的唯一实现（2026-10-23，《Refactoring UI》走查第四节第 8 件）。
//
// ★ 收口之前五个市场 / 列表页各画一个：工坊 `rounded-xl … px-3.5 py-2.5`、分区 `rounded-full border-slate-700/70 … px-4`、
//   人格市场与模板货架 `rounded-full … bg-black/30 py-2`、声音市场 `py-1.5`、素材抽屉 `rounded-lg`，清空键三种大小、两种热区。
//   同一个动作在相邻两页长得不一样，用户会以为是两种东西。
// ★ 三档形状，别再加第四种：
//   - `field`：页面级表单字段那一档规格（CLAUDE.md「页面级表单字段一个规格」，与主按钮同高 40px）—— 工坊第一层、管理页；
//   - `pill`：顶栏 / 列表头那一行的胶囊 —— 分区页、人格 / 模板市场；
//   - `compact`：抽屉与小面板里的紧凑版（`text-xs`）—— 声音市场、素材抽屉。
// ★ 清空键一律 44px 热区（`after:-inset-3`）；`clearKeepsFocus` 给「清掉一个词多半是要换一个词」的搜索态页面（分区页）：
//   onPointerDown 先挡住失焦，清完把光标放回框里。
import { useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";
import { useLingui } from "@lingui/react/macro";
import Icon from "./Icon";

export type SearchShape = "field" | "pill" | "compact";

const SHAPE: Record<SearchShape, string> = {
  field: "rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5",
  pill: "rounded-full border border-slate-700/70 bg-panel px-4 py-2.5",
  compact: "rounded-full border border-slate-700/70 bg-panel px-3 py-1.5",
};

export default function SearchField({
  value,
  onChange,
  placeholder,
  shape = "pill",
  guide,
  className = "",
  inputRef,
  onFocus,
  onBlur,
  onKeyDown,
  maxLength,
  clearKeepsFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  shape?: SearchShape;
  /** 新手引导锚点（data-guide） */
  guide?: string;
  /** 只放布局类（mb-* / flex-1 / min-w-0） */
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  maxLength?: number;
  /** 点 ✕ 不让输入框失焦、清完光标留在框里（搜索态页面） */
  clearKeepsFocus?: boolean;
}) {
  const { t } = useLingui();
  const inner = useRef<HTMLInputElement | null>(null);
  const compact = shape === "compact";
  return (
    <div data-guide={guide} className={`flex min-w-0 items-center gap-2 focus-within:border-brand ${SHAPE[shape]} ${className}`}>
      <Icon name="search" size={16} className="flex-none text-slate-500" />
      <input
        ref={(el) => {
          inner.current = el;
          if (inputRef) inputRef.current = el;
        }}
        type="search"
        enterKeyHint="search"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`min-w-0 flex-1 bg-transparent ${compact ? "text-xs" : "text-sm"} text-slate-100 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden`}
      />
      {value && (
        <button
          type="button"
          onPointerDown={clearKeepsFocus ? (e) => e.preventDefault() : undefined}
          onClick={() => {
            onChange("");
            if (clearKeepsFocus) inner.current?.focus();
          }}
          aria-label={t`清空搜索`}
          className="relative flex-none text-slate-400 after:absolute after:-inset-3 after:content-[''] active:scale-95"
        >
          <Icon name="close" size={compact ? 14 : 16} />
        </button>
      )}
    </div>
  );
}
