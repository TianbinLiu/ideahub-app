// 加载圈只有一份实现（2026-09-06 第五轮收口：此前 11 处各写各的尺寸 / 边色 / 边宽）。
// 三档：xs 12px（行内、胶囊里）、sm 16px（按钮 / 字段旁）、lg 32px（整页 / 空态）。
// ★ 工坊那块开场动画（StudioPage 的双环）不是它：那是演出，不是"在等"。
export default function Spinner({ size = "sm", className = "" }: { size?: "xs" | "sm" | "lg"; className?: string }) {
  const box = size === "lg" ? "h-8 w-8" : size === "sm" ? "h-4 w-4" : "h-3 w-3";
  return <span aria-hidden className={`inline-block flex-none animate-spin rounded-full border-2 border-slate-700 border-t-brand ${box} ${className}`} />;
}
