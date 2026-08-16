// 一个角色位的「标记徽章」—— 挂卡面板、选卡浮层、核对面板共用的**唯一实现**。
//
// ★★ 为什么值得单开一个组件：这枚徽章今天出现在 4 个地方（RoleCastBoard 的主列表与
//   超限区、CardPickSheet 的标题行、RoleConfirmSheet 的待删行）。颜色方案下它从
//   「一个等宽数字」变成「色块 + 色名」，各处各画一遍的话，漏掉一处的表现是
//   **那一屏还在显示一个纯文字的"绿色"**（看起来像坏了），而 TS 一声不吭。
//
// ★★★ 本文件里**没有、也永远不许有任何颜色名或色值常量**：色块的颜色只来自 props 里那个
//   `swatch`（服务端按色名现查调色板派生的值，见 data/templates 那段 ★★★）。拿不到就退
//   中性灰 + 纯色名，**绝不自己编一个颜色** —— 编了的话作者会照着我们编的那个颜色去核对
//   画面，那是"以为核对过了"，比不核对更坏。下面那几个 slate/sky/rose 是**界面语气色**
//   （主/次/待删），与角色位的颜色是两回事，别混。
import type { MarkScheme } from "../../types";

/** 徽章的语气：主列表 / 次要（超限、挂不上） / 待删 */
export type MarkBadgeTone = "primary" | "muted" | "doomed";

const TONE: Record<MarkBadgeTone, string> = {
  primary: "bg-sky-500/20 text-sky-200",
  muted: "bg-slate-700 text-slate-300",
  doomed: "bg-rose-500/20 text-rose-200 line-through",
};

/**
 * 一枚色块 —— 徽章与核对面板的颜色选择器共用的**唯一实现**。
 *
 * ★ 描一圈半透明白边：调色板里有「黑色」，不描边的话它在深色面板上根本看不见 ——
 *   而这枚色块正是作者/套用者拿去和画面比对的东西。
 * ★ `swatch` 拿不到就退中性灰（那是"我们不知道这是什么颜色"的诚实表示，**不是**一个
 *   编出来的颜色）。这一条只在这一个函数里实现，别在别处再写一遍三元。
 */
export function MarkDot({ swatch }: { swatch?: string | null }) {
  return (
    <span
      aria-hidden
      className={`h-3 w-3 flex-none rounded-full ring-1 ring-white/50 ${swatch ? "" : "bg-slate-500"}`}
      style={swatch ? { backgroundColor: swatch } : undefined}
    />
  );
}

export interface MarkBadgeProps {
  mark: MarkScheme;
  /** 原样显示服务端给的那个标记（色名或数字），**不重编、不换近义词** */
  label: string;
  /** 这个色名对应的色值（`data/templates.swatchOf` 查出来的）。没有就画中性灰块 */
  swatch?: string | null;
  tone?: MarkBadgeTone;
  /** 小一号（超限区那种次要位置） */
  small?: boolean;
  className?: string;
}

export default function MarkBadge({
  mark,
  label,
  swatch,
  tone = "primary",
  small = false,
  className = "",
}: MarkBadgeProps) {
  const size = small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[13px]";
  if (mark === "number") {
    // 编号版逐字保留今天的样子（含 tabular-nums：一列数字对齐了才好比对）
    return (
      <span className={`flex-none rounded-md ${TONE[tone]} ${size} font-bold tabular-nums ${className}`}>{label}</span>
    );
  }
  // 颜色版：色块 + 色名。★ 去掉 tabular-nums —— 等宽数字对汉字没有意义，只会把字距撑开
  return (
    <span className={`flex flex-none items-center gap-1 rounded-md ${TONE[tone]} ${size} font-bold ${className}`}>
      <MarkDot swatch={swatch} />
      {label}
    </span>
  );
}
