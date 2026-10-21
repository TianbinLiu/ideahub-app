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
// ★ `mascot`（2026-10-21）= 用一张 Q 版看板娘表情代替那颗灰图标（public/avatars 那八张，256² 每张十几 KB）。
//   调研（docs/ui-benchmark-2026-10.md 第五节：B 站 2233、Duolingo、天猫 / 度小满的 IP 用法）定下的用法：
//   吉祥物只在「边缘位置 + 情绪时刻」出现，配一句说明 + 一条出路，永远不替代错误原因与重试键。
//   表情按情境挑：nap = 还没有东西（空草稿箱 / 空收藏）；wonder = 搜不到 / 找不到；hi = 第一次来的邀请；
//   cheer / joy = 全都处理完了。⚠ 禁区：涉及钱的失败与报价、删除 / 注销、举报 / 拉黑、法务与 AI 标识、
//   登录安全 —— 那些地方一律不放吉祥物、不开玩笑（同上第五节）；视频流里也不放（会挡画面）。
import { type ReactNode } from "react";
import Spinner from "./Spinner";
import { Link } from "react-router";
import Icon, { type IconName } from "./Icon";

/** public/avatars 里那八张 Q 版表情（清单在 data/mascotAvatars.ts，自动生成的）里挑得上空态的几张 */
export type EmptyMascot = "nap" | "wonder" | "hi" | "cheer" | "joy" | "smile";

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
  mascot,
  loading,
  title,
  text,
  hint,
  error,
  cta,
  full,
  compact,
  className = "",
}: {
  /** 40px 线性图标（消息页的铃铛、卡片页的卡组） */
  icon?: IconName;
  /** 或者一个 emoji（📝 / 🔒），与 icon 二选一 */
  emoji?: string;
  /** 或者一张 Q 版看板娘表情（优先于 icon / emoji）。用法与禁区见文件头 */
  mascot?: EmptyMascot;
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
  /** 紧凑态（弹层 / 面板里的空态）：py-8、emoji 与正文各小一号。与 full 互斥，full 优先 */
  compact?: boolean;
  className?: string;
}) {
  const shell = full ? "safe-top min-h-[70vh] justify-center" : compact ? "gap-2 py-8" : "py-16";
  const ctaCls = cta?.primary
    ? "rounded-xl bg-brand px-5 py-2.5 text-sm font-bold text-ink"
    : "rounded-xl bg-panel px-5 py-2.5 text-sm font-semibold text-slate-100 ring-1 ring-slate-700";
  return (
    <div className={`flex flex-col items-center gap-3 px-6 text-center ${shell} ${className}`}>
      {loading ? (
        <Spinner size="lg" />
      ) : mascot ? (
        // 圆形取景（那八张本来就是正脸特写 + 深蓝底，裁成圆与「我的」页的官方头像同一副样子）。aria-hidden：意思在下面那句话里
        <img
          src={`/avatars/mascot-${mascot}.webp`}
          alt=""
          aria-hidden
          decoding="async"
          className={`${compact ? "h-16 w-16" : "h-24 w-24"} rounded-full object-cover ring-1 ring-slate-700/70`}
        />
      ) : icon ? (
        <Icon name={icon} size={40} className="text-slate-600" />
      ) : emoji ? (
        <span className={`${compact ? "text-2xl" : "text-4xl"} leading-none`}>{emoji}</span>
      ) : null}
      {title && <h2 className="text-base font-bold text-slate-100">{title}</h2>}
      <p className={`${compact ? "text-xs" : "text-sm"} leading-relaxed ${error ? "text-rose-300" : "text-slate-400"}`}>{text}</p>
      {hint && <p className={`${compact ? "text-[11px]" : "text-xs"} leading-relaxed text-slate-400`}>{hint}</p>}
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
