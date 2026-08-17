// 一个角色位的「标记徽章」—— 原样显示服务端算出来的那个标记（序数措辞或编号）的**唯一实现**。
//
// ── 今天谁在用（2026-08-17 版式改造之后）────────────────────────────
//   · 核对角色位那一屏：一直在用 —— 作者要核对的正是"服务端算出来的那句话"本身。
//   · 挂卡面板：**只在没有画面位置数据时**用（`!dragOn`，格子上那一枚，走 `wrap`）。
//     有位置数据时那一屏改用中性的「人物N」+ 点格子让画面上对应的框亮起来 ——
//     序数措辞只有在人真是整齐一排时才成立，印在格子上是个我们自己都不保证的承诺；
//     而没有框可亮时，编号方案老模板画面上那个数字是认人的**唯一**线索，必须印出来。
//   · 选卡浮层（CardPickSheet）曾经也用，那个组件 2026-08-17 已删。
//
// ★★ 为什么值得单开一个组件：两种标记方案下它的排版不同（编号是一个等宽数字，
//   序数是一句 2~6 字的中文），各处各画一遍的话，漏掉一处的表现是
//   **那一屏的数字被 tabular-nums 撑得七零八落**，而 TS 一声不吭。
//
// ★★★ 本文件里**没有、也永远不许有任何序数措辞常量**：徽章上那句话只来自 props 里的
//   `label`（服务端算好的字符串，App 原样显示、原样写进提示词，见 data/templates 那段 ★★★）。
//   编一个出来的话，作者会照着我们编的那句话去核对画面 —— 那是"以为核对过了"，
//   比不核对更坏。下面那几个 slate/sky/rose 是**界面语气色**（主/次/待删），
//   与角色位本身无关，别混。
// ★ 2026-08-17 删掉了 `MarkDot`（色块）与 `swatch` prop：颜色方案整档删了，人偶全是纯白。
import type { MarkSpec } from "../../data/templates";

/** 徽章的语气：主（核对面板那一列） / 次要（超限、挂不上） / 待删 */
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
  /**
   * 允许折行（**竖排格子里用**）。默认不折 —— 横排列表里断成两行会让一列位置读不齐。
   * ★★ 2026-08-17 真机上抓到的：格子行的格子只有几十像素宽，而序数措辞最长 6 个汉字
   *   （「从左数第3个」），`whitespace-nowrap` 让它**横着撑破格子、压到邻居身上**，
   *   一排格子看起来像叠在一起。折行 + 居中是这个版式下唯一读得通的排法。
   * ★ 不用截断（truncate）：截掉之后「从左数第2个」和「从左数第3个」长得一样，
   *   而这枚徽章的**全部作用**就是分清是哪一个。
   * ⚠ 编号方案那一支**不吃 wrap**（下面 number 分支逐字保留旧样式）。这看起来别扭，
   *   因为格子行里传 wrap 的主要消费者恰恰是编号模板（挂卡面板只在 !dragOn 时用本组件，
   *   而 dragOn 要求序数方案 ⇒ 那里出现的一定是编号）。实际无害：编号是 1~2 个字符，
   *   撑不破格子。留着不改是因为 number 分支的 tabular-nums 排版是**存量行为的逐字副本**。
   */
  wrap?: boolean;
  className?: string;
}

export default function MarkBadge({ spec, label, tone = "primary", small = false, wrap = false, className = "" }: MarkBadgeProps) {
  const size = wrap ? "px-1 py-0.5 text-[10px] leading-tight" : small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-[13px]";
  if (spec.scheme === "number") {
    // 编号版逐字保留今天的样子（含 tabular-nums：一列数字对齐了才好比对）
    return (
      <span className={`flex-none rounded-md ${TONE[tone]} ${size} font-bold tabular-nums ${className}`}>{label}</span>
    );
  }
  // 序数版：一句短中文。★ 去掉 tabular-nums —— 等宽数字对汉字没有意义，只会把字距撑开
  // ★ `whitespace-nowrap`：「从左数第3个」断成两行之后，一列位置读起来就对不齐了
  return (
    <span
      className={`rounded-md ${TONE[tone]} ${size} font-bold ${
        wrap ? "block w-full break-all text-center" : "flex-none whitespace-nowrap"
      } ${className}`}
    >
      {label}
    </span>
  );
}
