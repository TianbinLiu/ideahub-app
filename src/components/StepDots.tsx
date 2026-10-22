// 多步功能屏顶上的圆点进度条，只有这一份实现（2026-10-22 主人点名：
// 「横线上几个圆点对应不同步骤，做完的实心、没做的空心、当前那颗的边缘放大一些，切换要丝滑，每颗下面两三个字」）。
//
// ★ 画法：一条横线贯穿各点的圆心，点均匀分布（grid N 列，每列一颗点居中）；线的左右端各缩进半列，
//   正好落在首尾两颗的圆心上。进度那一截是同一条线上的亮色层，按「做完几步 / (N−1)」缩放。
// ★ 动画只动 transform / opacity（CLAUDE.md「动画只动 transform / opacity」：首页视频流本就吃紧）：
//   - 当前那颗的「边缘放大」是一枚独立的环，用 scale 从 1 放到 1.7，不改 border 宽 / 尺寸（那会重排）；
//   - 实心 / 空心是内芯那一层的 opacity；
//   - 进度线是 scaleX，transform-origin 在左端。
//   缓动 cubic-bezier(0.22, 1, 0.36, 1) 与首页点赞粒子同一条（index.css 的 .burst-fly），带一点回弹、收尾软。
//   减少动态效果：`motion-reduce:transition-none`，状态照样切、只是不过渡。
// ★ 文字：≤14px 的字不用 slate-600（CLAUDE.md「小字不许用 slate-600」），没到的步骤用 slate-400；
//   当前步 slate-100 加粗、做完的 slate-300。每格的字可以换行（两三个字一般不会）。
// ★ 不管「步骤能不能点回去」的规则：那是各向导自己的事（有的步骤花过钱、有的已经落段）。
//   给了 onPick 时只有「做完的」步骤能点（回去改），当前与没到的不能；没给就是纯展示。
// ★ 位置：各向导的标题行**正下方**、正文之上。页面级（PageHeader 之后）与抽屉级（标题行之后）都这么放，
//   别塞进 PageHeader 的右侧插槽（那是动作键的位置）。
import type { ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";

export interface StepDot {
  /** 两三个字的概括（「选人」「写对白」），调用方已翻译好（Trans / t） */
  label: ReactNode;
}

export default function StepDots({
  steps,
  current,
  onPick,
  canPick,
  className = "",
}: {
  steps: StepDot[];
  /** 0 起算的当前步 */
  current: number;
  /** 给了就允许点回**做完的**步骤（哪些能点可由 canPick 改） */
  onPick?: (index: number) => void;
  /** 哪些步骤能点（默认：做完的）。人格向导那种「往前也能跳到够得着的步」传它 */
  canPick?: (index: number) => boolean;
  className?: string;
}) {
  const { t } = useLingui();
  const n = steps.length;
  if (n < 2) return null;
  const cur = Math.max(0, Math.min(n - 1, current));
  // 进度线盖到当前这颗的圆心：做完 k 步就是 k/(N−1)
  const progress = cur / (n - 1);
  const inset = `${100 / (2 * n)}%`;
  return (
    <ol
      className={`relative grid ${className}`}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      aria-label={t`步骤`}
    >
      {/* 轨道与进度：绝对定位在圆心那一行（圆点 12px → 圆心离顶 6px） */}
      <span aria-hidden className="pointer-events-none absolute top-[5px] h-0.5 bg-slate-700" style={{ left: inset, right: inset }}>
        <span
          className="absolute inset-0 origin-left bg-brand transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{ transform: `scaleX(${progress})` }}
        />
      </span>
      {steps.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        const pickable = !!onPick && !active && (canPick ? canPick(i) : done);
        const body = (
          <>
            <span className="relative h-3 w-3 flex-none">
                {/* 外圈：空心点的边；当前步放大 1.7 倍 */}
                <span
                  aria-hidden
                  className={`absolute inset-0 rounded-full border-2 bg-ink transition-[transform,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                    done || active ? "border-brand" : "border-slate-500"
                  }`}
                  style={{ transform: active ? "scale(1.7)" : "scale(1)" }}
                />
                {/* 内芯：做完才实心 */}
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-brand transition-opacity duration-300 ease-out motion-reduce:transition-none"
                  style={{ opacity: done ? 1 : 0 }}
                />
              </span>
              <span
                className={`max-w-full px-0.5 text-center text-[10px] leading-tight transition-colors duration-300 motion-reduce:transition-none ${
                  active ? "font-semibold text-slate-100" : done ? "text-slate-300" : "text-slate-400"
                }`}
              >
                {s.label}
              </span>
            </>
        );
        const cls = "flex w-full min-w-0 flex-col items-center gap-1.5";
        return (
          <li key={i} className="relative flex min-w-0 flex-col items-center" aria-current={active ? "step" : undefined}>
            {pickable ? (
              <button type="button" onClick={() => onPick(i)} className={`${cls} active:opacity-60`}>
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
