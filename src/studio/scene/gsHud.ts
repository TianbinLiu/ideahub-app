// ★ 实验档的小角标（只在 gsStep0On() 时存在）：fps / 高斯数 / draw call / 三角面 / 首进加载耗时。
//
// 为什么不是 React 组件：它要挂在 <Canvas> 子树里（GsStep0Room 是 TableScene 的子节点），
//   而 R3F 的 reconciler 渲染不了 DOM 元素（drei 的 Html 也是另起一个 React root）。
//   这里只有一个 <div>，命令式创建 + 每秒刷一次字最省，也不必给 3D 树加一层 DOM 依赖。
//
// ★ 1 秒刷新：fps 由 GsStep0Room 的 useFrame 累加器算（每次结算 = 1 秒的帧数），
//   这里只负责把 GS_STATS 画出来 —— 别在角标里再挂一个 setInterval 各自算一遍。
// ★ 文字全用 ASCII：这是开发者读数，不是界面文案（混进中文会被 scripts/check-i18n.mjs 当成漏译）。
import { gsLoadMs, gsYawProbe, type GsSplatTier } from "./gsStep0";

/** GsStep0Room 每帧写、角标每秒读一次。cap=dev 的渲染期截断（0 = 不截断），fill=NPC 补光开没开，
 *  quality=两档画质（refined 2M / draft 524k，见 gsStep0.GS_QUALITY），
 *  tier=三档 LOD（full / 1.6 / 1.4 / 1.2，见 gsStep0.GS_SPLAT_TIER；
 *  ★ 它读的是**实际用哪个文件**，不是设置里存的愿望值） */
export const GS_STATS = {
  fps: 0,
  splats: 0,
  calls: 0,
  tris: 0,
  cap: 0,
  fill: true,
  quality: "refined" as "refined" | "draft",
  tier: "full" as GsSplatTier,
};

let el: HTMLDivElement | null = null;
let painted = "";

function num(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

function readout(): string {
  const s = GS_STATS;
  const load = gsLoadMs();
  const probe = gsYawProbe();
  return [
    `GS ${s.fps.toFixed(1)} fps   fill ${s.fill ? "on" : "off"}${probe ? `   probe ${probe > 0 ? "+" : ""}${probe}deg` : ""}`,
    `splat ${num(s.splats)}  tier ${s.tier}${s.cap > 0 ? `  cap ${num(s.cap)}` : ""}  ${s.quality}`,
    `calls ${s.calls}  tris ${num(s.tris)}`,
    // ★ 毫秒（2026-11-26 验收口径）：首进 8~12 s 的量级下，秒的小数位读起来像噪声；
    //   真机报告要的就是"非零毫秒数"，与 gsStep0.gsLoadMs 的单位一致。
    `load ${load > 0 ? `${load}ms` : "-"}`,
  ].join("\n");
}

/** 每帧算完 fps 之后调；没挂角标（例如失败回退）时什么也不做 */
export function updateGsHud(): void {
  if (!el) return;
  const next = readout();
  if (next === painted) return;
  painted = next;
  el.textContent = next;
}

/** 挂上角标，返回摘掉它的函数（GsStep0Room 的 useLayoutEffect 用） */
export function mountGsHud(): () => void {
  // 同一个人重复挂（StrictMode 的挂→卸→挂、或路由快速来回）时先摘掉上一份，
  // 否则第一份的 cleanup 会把第二份的 el 变成孤儿（角标再也不出现）。
  el?.remove();
  const node = document.createElement("div");
  node.setAttribute("data-gs-hud", "1");
  // 右下角：不压顶栏的键、也不压底部提示条（StudioPage 底栏在中间）。
  // 11px 是手机屏上"能读、又不占半屏"的量（真机 dpr 3 ⇒ 物理 33px）。
  node.style.cssText = [
    "position:fixed",
    "right:10px",
    "bottom:12px",
    "z-index:9999",
    "pointer-events:none",
    "white-space:pre",
    "text-align:left",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#d9fff5",
    "background:rgba(0,0,0,0.66)",
    "padding:5px 7px",
    "border-radius:7px",
    "box-shadow:0 1px 6px rgba(0,0,0,0.35)",
  ].join(";");
  document.body.appendChild(node);
  el = node;
  painted = readout();
  node.textContent = painted;
  return () => {
    node.remove();
    if (el === node) el = null;
    painted = "";
  };
}
