// ★ 实验档的小角标（只在 gsStep0On() 时存在）：fps / 高斯数 / draw call / 三角面 / 首进加载耗时。
//
// 为什么不是 React 组件：它要挂在 <Canvas> 子树里（GsStep0Room 是 TableScene 的子节点），
//   而 R3F 的 reconciler 渲染不了 DOM 元素（drei 的 Html 也是另起一个 React root）。
//   这里只有一个 <div>，命令式创建 + 每秒刷一次字最省，也不必给 3D 树加一层 DOM 依赖。
//
// ★ 1 秒刷新：fps 由 GsStep0Room 的 useFrame 累加器算（每次结算 = 1 秒的帧数），
//   这里只负责把 GS_STATS 画出来 —— 别在角标里再挂一个 setInterval 各自算一遍。
// ★ 文字全用 ASCII：这是开发者读数，不是界面文案（混进中文会被 scripts/check-i18n.mjs 当成漏译）。
//
// ★★ 2026-11-28（`feat/ui-fonts-hud-fixes`，真机验收 P0）：**生产默认不挂 + 永远在 UI 层之下**。
//   原来只要自动判定开着（正式包在够格的机器上默认就是开）就常驻一块 z-9999 的读数，
//   右下角压住对局里的主键与底栏提示 —— 那是开发者读数，不该出现在玩家屏幕上。两条一起改：
//     · 只有三种"人在调试"的信号才挂（`gsHudWanted`，唯一判据）：
//       地址栏 `?gs=1` / localStorage `gsAcceptDebug=1` / 设置 →「高斯场景（实验）」**被用户显式点开**
//       （`gsExperimentOverride() === "on"`；不认"自动判定为开"—— 那正是这一条要修的常驻）。
//     · z-index 从 9999 降到 **25**：对局 UI 是 z-30、大厅与 StylePick 是 z-40、设置是 z-50，
//       于是读数**在任何一层可点界面的下面** —— 样式卡 / 商店卡 / 底部主键自己会盖住它，
//       它压不到一个键（真机上就是"锁定那颗键被读数糊住"）。叠层较满的屏里它会被面板盖掉一部分，
//       这是有意的取舍：调试读数不抢 UI。
//     · 位置从右下改到**左上安全区以下**，`pointer-events:none` + 半透明：露出来也点得穿。
import { gsAutoGate } from "./gsGate";
import { gsExperimentOverride, gsLoadMs, gsYawProbe, type GsSplatTier } from "./gsStep0";

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
/**
 * 谁要求把读数藏起来（集合而不是一个布尔）。
 * ★ 为什么是集合：大厅（`lobby`）与风格选择屏（`stylepick`）会**同时**是"该藏"的
 *   （退出对局 → 大厅开、StylePick 卸载，两个 effect 在同一拍里一开一关）。
 *   一个布尔时后跑的那个说了算 —— 明明人在大厅、角标却冒出来压住「✕ 返回工坊」。
 *   集合语义：任何一格还在，就藏；最后一格撤掉才放回来。
 */
const hideKeys = new Set<string>();
const hiddenNow = () => hideKeys.size > 0;

/**
 * 这块读数该不该存在（**唯一判据**，见文件头 ★★）。
 * ★ 地址栏的 `?gs=1` 三条里排最前：验收走 Capacitor 的启动地址也能带上它；
 *   与 `gsStep0.devOn()` 不同，这里**不看 import.meta.env.DEV** —— 它只决定 HUD 显不显示，
 *   不碰场景（场景在正式包里仍由自动判定 / 用户覆盖决定）。
 */
export function gsHudWanted(): boolean {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("gs") === "1") return true;
  } catch {
    /* location 被裁掉的壳子里当作没有这个信号 */
  }
  try {
    if (localStorage.getItem("gsAcceptDebug") === "1") return true;
  } catch {
    /* 存储被禁：当作没写 */
  }
  // 设置页那颗开关的**显式值**（点过 on）；自动判定为开不在这里（见文件头）
  return gsExperimentOverride() === "on";
}

/** 当前读数该不该画（DEV 钩子 / 验收脚本用它判断，不重复写上面那三条） */
export function gsHudVisible(): boolean {
  return el !== null && !hiddenNow();
}

function num(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

function readout(): string {
  const s = GS_STATS;
  const load = gsLoadMs();
  const probe = gsYawProbe();
  const gate = gsAutoGate();
  return [
    // ★ 2026-11-27（`feat/gs-auto-gate-align`）：这一行是"为什么这台机器有这个房间"的证据。
    //   HUD 只在开着时存在 —— 判 off 的那一侧看的是 gsGate 在启动时打的那行 console。
    `gsAutoGate: ${gate.on ? "on" : "off"} reason: ${gate.reason}`,
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

/** 大厅 / 风格选择屏盖着时把角标藏起来（2026-11-27 feat/gs-moon-window；2026-11-28 改成按 key 计数）。
 *  `key` = 谁在要这个（"lobby" / "stylepick"）；两处同时开着时任何一格还在就藏。
 *  读数节点本身照旧每秒刷新，撤掉最后一格就放回来。 */
export function setGsHudHidden(next: boolean, key = "default"): void {
  if (next) hideKeys.add(key);
  else hideKeys.delete(key);
  if (el) el.style.display = hiddenNow() ? "none" : "";
}

/** 挂上角标，返回摘掉它的函数（GsStep0Room 的 useLayoutEffect 用） */
export function mountGsHud(): () => void {
  // 生产默认不挂（见文件头 ★★）：没有调试信号时连节点都不建 —— 不是建好再藏，
  // 因为「有没有这个节点」本身就是验收（真机默认包必须读不到 [data-gs-hud]）。
  if (!gsHudWanted()) return () => {};
  // 同一个人重复挂（StrictMode 的挂→卸→挂、或路由快速来回）时先摘掉上一份，
  // 否则第一份的 cleanup 会把第二份的 el 变成孤儿（角标再也不出现）。
  el?.remove();
  const node = document.createElement("div");
  node.setAttribute("data-gs-hud", "1");
  // 大厅开着时建出来的角标也照样藏（StrictMode 挂→卸→挂 / 场景重挂会重新走这里）。
  // ★ 这一行必须在下面 cssText 之后：cssText 会把整个 inline style 覆写掉（第一版放前面，display 被抹平）。
  // ★ 位置（2026-11-28）：**左上、安全区以下**，z-index 25（在任何可点 UI 之下）。
  //   底部主键（StylePick 的「锁定这张风格，开局」）与底栏提示都在下面，读数永远压不到；
  //   `pointer-events:none` + 半透明让它就算露出来也点得穿。11px 是手机屏上"能读、又不占半屏"
  //   的量（真机 dpr 3.5 ⇒ 物理 38px）。
  node.style.cssText = [
    "position:fixed",
    "left:8px",
    "top:calc(var(--safe-float-top, env(safe-area-inset-top, 0px) + 8px))",
    "z-index:25",
    "pointer-events:none",
    "white-space:pre",
    "text-align:left",
    "max-width:46vw",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#d9fff5",
    "background:rgba(0,0,0,0.55)",
    "padding:5px 7px",
    "border-radius:7px",
    "opacity:0.78",
    "box-shadow:0 1px 6px rgba(0,0,0,0.35)",
  ].join(";");
  node.style.display = hiddenNow() ? "none" : "";
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

// DEV 钩子：验收脚本要在大厅打开的那几屏把角标藏掉（正式包里不存在）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__gsHudHide = setGsHudHidden;
  (window as unknown as Record<string, unknown>).__gsHudVisible = gsHudVisible;
  (window as unknown as Record<string, unknown>).__gsHudWanted = gsHudWanted;
}
