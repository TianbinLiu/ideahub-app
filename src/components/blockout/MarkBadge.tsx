// 一个角色位的「标记徽章」—— 挂卡面板、选卡浮层、核对面板共用的**唯一实现**。
//
// ★★ 为什么值得单开一个组件：这枚徽章今天出现在 4 个地方（RoleCastBoard 的主列表与
//   超限区、CardPickSheet 的标题行、RoleConfirmSheet 的待删行）。两种方案下它的排版不同
//   （编号是一个等宽数字，序数是一句 2~6 字的中文），各处各画一遍的话，漏掉一处的表现是
//   **那一屏的数字被 tabular-nums 撑得七零八落**，而 TS 一声不吭。
//
// ★★★ 本文件里**没有、也永远不许有任何序数措辞常量**：徽章上那句话只来自 props 里的
//   `label`（服务端算好的字符串，App 原样显示、原样写进提示词，见 data/templates 那段 ★★★）。
//   编一个出来的话，作者会照着我们编的那句话去核对画面 —— 那是"以为核对过了"，
//   比不核对更坏。下面那几个 slate/sky/rose 是**界面语气色**（主/次/待删），
//   与角色位本身无关，别混。
// ★ 2026-08-17 删掉了 `MarkDot`（色块）与 `swatch` prop：颜色方案整档删了，人偶全是纯白。
import type { MarkSpec } from "../../data/templates";

/** 徽章的语气：主列表 / 次要（超限、挂不上） / 待删 */
export type MarkBadgeTone = "primary" | "muted" | "doomed";

const TONE: Record<MarkBadgeTone, string> = {
  primary: "bg-sky-500/20 text-sky-200",
  muted: "bg-slate-700 text-slate-300",
  doomed: "bg-rose-500/20 text-rose-200 line-through",
};

export interface MarkBadgeProps {
  /** 这个模板的标记方案（判据唯一实现在 data/templates.markSpecOf） */
  spec: MarkSpec;
  /** 原样显示服务端给的那个标记（序数措辞或数字），**不重编、不换近义说法** */
  label: string;
  tone?: MarkBadgeTone;
  /** 小一号（超限区那种次要位置） */
  small?: boolean;
  className?: string;
}

export default function MarkBadge({ spec, label, tone = "primary", small = false, className = "" }: MarkBadgeProps) {
  const size = small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[13px]";
  if (spec.scheme === "number") {
    // 编号版逐字保留今天的样子（含 tabular-nums：一列数字对齐了才好比对）
    return (
      <span className={`flex-none rounded-md ${TONE[tone]} ${size} font-bold tabular-nums ${className}`}>{label}</span>
    );
  }
  // 序数版：一句短中文。★ 去掉 tabular-nums —— 等宽数字对汉字没有意义，只会把字距撑开
  // ★ `whitespace-nowrap`：「从左数第3个」断成两行之后，一列位置读起来就对不齐了
  return (
    <span className={`flex-none whitespace-nowrap rounded-md ${TONE[tone]} ${size} font-bold ${className}`}>
      {label}
    </span>
  );
}
