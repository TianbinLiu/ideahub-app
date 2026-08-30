// 「AI 生成」显著标识 —— 全 app 唯一的一份。
//
// ★★ 为什么必须有它（不是产品选择，是合规）：《人工智能生成合成内容标识办法》
//   2025-09-01 施行，配套强制性国标 GB 45438-2025 同日实施。其中：
//     · 第四条：视频要在**起始画面**和**播放周边**的适当位置添加**显著**的提示标识；
//     · 第六条：传播平台要在**发布内容周边**加显著提示；
//     · 第十条：用户要**主动声明**并使用平台提供的标识功能。
//   我们此前只做了一半：`drawAigcBadge` 把角标烧进**合并导出的每一帧**（那是"起始画面 +
//   画面内标识"这一半，真的在做），但 App 界面上 —— 首页流、详情页、任何视频卡片 ——
//   **一个 AI 标识都没有**，发布页也只有一句"发布即视为同意"的脚注（法律上是**默示**，
//   不是主动声明）。这个组件补的是"内容周边"那一半。
//
// ★ 判据只有一处（`isAigcWork`）：本 app 里**每一条作品都是 AI 生成的** —— 画面要么是
//   Seedance 出的片，要么是两张 AI 设定帧之间的渐变，白模复刻也是 r2v 的产物。所以它今天
//   恒为真。⚠ 那为什么还要一个函数而不是直接写死？因为将来一旦有"用户自己拍的素材直出"
//   这类路径，改这一处就够了；写死在三个渲染点上，到时必然漏掉其中一两个，
//   而漏掉的后果是**给一条 AI 内容摘掉了法定标识**。
import type { VideoItem } from "../types";

/**
 * 这条作品要不要打「AI 生成」标识。
 *
 * ★ 缺省**判是**（与 `visibility` 的判否定方向相反，这是有意的）：漏标一条 AI 内容是
 *   合规问题，多标一条不是 —— 两个方向的代价不对等时，默认值要倒向代价小的那边。
 */
export function isAigcWork(_v: Pick<VideoItem, "id">): boolean {
  return true;
}

export default function AigcBadge({
  /** overlay = 盖在画面上（首页流那种深色背景）；plain = 普通页面里 */
  tone = "plain",
  className = "",
}: {
  tone?: "overlay" | "plain";
  className?: string;
}) {
  return (
    <span
      // ★ 不做成按钮：它是标识不是入口，点开一个弹层反而会让人以为"可以关掉"。
      title="本内容由人工智能生成或合成"
      className={`inline-flex flex-none items-center rounded-[4px] px-1.5 py-px text-[10px] font-semibold leading-[1.35] ${
        tone === "overlay"
          ? "bg-black/55 text-white/95 ring-1 ring-white/25 backdrop-blur-[2px]"
          : "bg-slate-700/70 text-slate-200 ring-1 ring-slate-600"
      } ${className}`}
    >
      AI 生成
    </span>
  );
}
