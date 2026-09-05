// 页顶栏 —— 全 app **一份实现**。
//
// ★★ 为什么（2026-09-05 主人真机点名"返回按钮偏上、各页按钮位置不统一"）：此前 24 屏的顶栏各写各的，
//   返回键中心离状态栏底沿从 24px（简约模式 / 设置）到 32px（消息页）不等，标题 15 / 16 / 18px 三种，
//   返回键有裸箭头、32px 圆底两种长相，「?」有的贴标题、有的在最右 —— 用户在页与页之间切换时
//   手指要重新找位置。收成这一个组件之后，任何一页的返回键、标题、「?」都在同一个位置。
//
// 规格（量过的数，别拍脑袋改）：
//   · 顶部：`safe-top`（状态栏 + 10px 呼吸，index.css）+ **48px 一行**（h-12），返回键 / 标题 / 右侧的键
//     都在这一行里垂直居中 → 中心离状态栏底沿 34px。比此前最靠上的那几页低 10px，与消息页齐平；
//     再往下就是把首屏内容往下顶，往上就回到"贴着状态栏"的感觉。
//   · 左：`BackButton`（44×44 命中区，图标 22px），图标左缘 = 页面 px-4 的 16px；
//   · 标题 18px 加粗一行截断（text-lg），可带一行 11px 灰字副标题；
//   · 右：`right` 插槽，从左到右依次「?」→ 操作键，全部 flex-none；
//   · `sticky`：要钉在顶上的长页（消息 / 作品 / 编辑 / 发布 / 视频编辑）—— 自带背景、下边线与 px-4，
//     这种页的根**不要**再 px-4（否则内容与顶栏各缩一次）。
// ★ 页面根不再写 `safe-top` / `pt-3`：安全区留白归顶栏，正文从顶栏的 mb 开始。
//   sticky 顶栏尤其如此 —— safe-top 必须在 sticky 元素**内部**，挂在页面根上它会滑到状态栏底下
//   （ProfilePage 那条注释）。
import type { ReactNode } from "react";
import { BackButton } from "./IconTapButton";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** 不给 = 没有返回键（tab 页那种，标题贴左） */
  onBack?: () => void;
  backLabel?: string;
  /** 右侧插槽：「?」与操作键，按从左到右传；每一件自己 flex-none */
  right?: ReactNode;
  /** 钉在顶上（长列表页）：带背景与下边线，横向自带 px-4 */
  sticky?: boolean;
  /** 追加到 <header> 上。非 sticky 默认 `mb-3`（传了就整个替换） */
  className?: string;
  /** 标题样式覆盖（作品页那种"标题是内容不是页名"的用小一号） */
  titleClassName?: string;
}

export default function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel,
  right,
  sticky = false,
  className,
  titleClassName = "text-lg font-bold text-slate-100",
}: PageHeaderProps) {
  const shell = sticky ? "sticky top-0 z-20 border-b border-slate-800 bg-ink/90 px-4 backdrop-blur" : "";
  return (
    <header className={`safe-top ${shell} ${className ?? (sticky ? "" : "mb-3")}`}>
      <div className="flex h-12 items-center gap-2">
        {/* ★ label 只在给了时才传：`label={undefined}` 会把 BackButton 自己的默认「返回」盖成空 */}
        {onBack && <BackButton size={22} {...(backLabel ? { label: backLabel } : {})} onClick={onBack} />}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <h1 className={`min-w-0 truncate leading-tight ${titleClassName}`}>{title}</h1>
          {subtitle && <p className="min-w-0 truncate text-[11px] leading-tight text-slate-500">{subtitle}</p>}
        </div>
        {right}
      </div>
    </header>
  );
}
