// 提示条的唯一实现（2026-10-23，《Refactoring UI》走查第四节第 2 件，规则 §8.2 / §5.7）。
//
// ★ 为什么要有它：收口之前全仓有 114 处裸琥珀 `<p className="… text-amber-200">`（36 处 ≤10px），
//   警告与旁边的说明文字只差一个颜色 —— 色弱的人读不出来这是在提醒，正常视力的人看多了也会把琥珀当成普通灰字。
//   书上的做法是「侧边色条 + 图标」：形状先于颜色，颜色只是第二重信号。
// ★ 与 CLAUDE.md「提示条一律带同色 /40 边框」那种**整块染色**的 tip bar 分工：
//   - 整块 tip bar（`rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2`）给**独立成段、要人停下来读**的话；
//   - 这里的 `<Warn>` 给**挂在控件 / 段落旁边的一两句**（原来那些裸琥珀 `<p>` 的位置），不占底色、只有左边一道 2px 色条 + 图标。
// ★ 颜色只在这一张表上：警告琥珀 / 报错玫瑰 / 说明天蓝 / 成功翠绿。别在调用点再写 text-amber-*。
// ★ 文案里原来手打的「⚠ 」前缀收口时一并去掉了（图标顶替它）：新写的别再加。
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type WarnTone = "warn" | "danger" | "info" | "ok";

const TONE: Record<WarnTone, { bar: string; text: string; icon: IconName }> = {
  warn: { bar: "border-amber-500/60", text: "text-amber-200", icon: "alert" },
  danger: { bar: "border-rose-500/60", text: "text-rose-300", icon: "alert" },
  info: { bar: "border-sky-500/60", text: "text-slate-300", icon: "info" },
  ok: { bar: "border-emerald-500/60", text: "text-emerald-200", icon: "check" },
};

export default function Warn({
  tone = "warn",
  compact = false,
  className = "",
  children,
}: {
  tone?: WarnTone;
  /** 紧凑面板里的 10px 版（画布 / 工坊弹层 / 方案台）；缺省 11px */
  compact?: boolean;
  /** 只放外边距之类的布局类（mt-* / mb-* / px-*），颜色与字号由 tone / compact 定 */
  className?: string;
  children: ReactNode;
}) {
  const c = TONE[tone];
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      className={`flex items-start gap-1.5 border-l-2 pl-2.5 leading-relaxed ${c.bar} ${c.text} ${compact ? "text-[10px]" : "text-[11px]"} ${className}`}
    >
      <Icon name={c.icon} size={compact ? 12 : 14} strokeWidth={2} className="mt-px flex-none opacity-80" />
      <span className="min-w-0 flex-1">{children}</span>
    </p>
  );
}
