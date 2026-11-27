// ★★ 高斯场景「按机型自动判定」的**探测层**（2026-11-27，`feat/gs-auto-gate-align`）。
//
// 分工：规则与门槛在 `gsAutoGateRules`（零依赖、Node 里实跑）；这里只做三件事 ——
//   ① 读本机事实（navigator / screen / WebGL）→ GsGateProbe；
//   ② 只算一次并缓存（设置页、HUD、TableScene 到处问，别各探一遍）；
//   ③ 打一行 `gsAutoGate: on|off reason:...` 的日志（HUD 只在开着时有，关掉那一侧只能看日志）。
//
// ★ 为什么探测要在模块加载时同步做完：`gsStep0` 一被 import 就要决定 `phase`（loading / off）——
//   晚一拍的话，米制桌面会先按老书房建一遍再换，NPC/桌子/机位全闪一下。这一层只建一个
//   **不带 antialias、不带 canvas 挂载**的临时 WebGL 上下文读两个字符串，然后立刻 loseContext；
//   真机上量到的是毫秒级（设备探针日志里有一行 [gs] probe 的耗时）。
//
// ★ 读不到的项一律 null（不是 0）：「没量到」和「量到 0」在判定里含义不同 —— 见 gsAutoGateRules
//   的注释（内存可以没有、GPU 与 Android 没有就不开）。

import { decideGsAutoGate, type GsGateProbe, type GsGateVerdict } from "./gsAutoGateRules";

/** 正的有限数读成 number，其余一律 null（脏 UA / 隐私模式 / 被裁掉的 navigator 都走这里） */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** 读 GPU renderer 字符串：临时 WebGL 上下文 → WEBGL_debug_renderer_info → loseContext。 */
function readGpu(): string | null {
  if (typeof document === "undefined") return null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    const gpu = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string | null) : null;
    // ★ 读完就把上下文还回去：手机上同时活着的 WebGL 上下文有限，多留一个可能在真机上
    //   让 r3f 那个建不出来（不是理论问题 —— 同一进程里 Spark 还要再拿一个）。
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return gpu && String(gpu).trim() ? String(gpu) : null;
  } catch {
    return null;
  } finally {
    canvas = null;
  }
}

/** 读本机事实。任何一步抛错都退回 null（→ 判定保守不开），绝不让它把 App 启动打崩。 */
export function probeGsDevice(): GsGateProbe {
  try {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const ua = nav?.userAgent ?? "";
    const m = /Android\s+([\d.]+)/i.exec(ua);
    const androidRaw = m ? Math.trunc(Number(m[1])) : NaN;
    const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1;
    const sw = typeof screen !== "undefined" ? screen.width : 0;
    const sh = typeof screen !== "undefined" ? screen.height : 0;
    const physicallyKnown = sw > 0 && sh > 0;
    return {
      cores: num(nav?.hardwareConcurrency),
      memory: num((nav as (Navigator & { deviceMemory?: number }) | null)?.deviceMemory),
      gpu: readGpu(),
      screenShortPx: physicallyKnown ? Math.round(Math.min(sw, sh) * dpr) : null,
      screenLongPx: physicallyKnown ? Math.round(Math.max(sw, sh) * dpr) : null,
      android: Number.isFinite(androidRaw) && androidRaw > 0 ? androidRaw : null,
    };
  } catch {
    return { cores: null, memory: null, gpu: null, screenShortPx: null, screenLongPx: null, android: null };
  }
}

let verdict: GsGateVerdict | null = null;
let probed: GsGateProbe | null = null;
let probeMs = 0;

/** 验收钩子（localStorage `gsAutoGateForce` = "on"/"off"）：把判定强制拨到某一边。
 *  ★ 为什么留这个口子：真机验收要截"自动判定未启用"那一屏（程序化书房 + 设置页那行文案），
 *    而验收机的判定是真·已启用 —— 没有这个键就只能退回实验开关，那截出来的是"手动关"，
 *    不是"自动判定关"。生产里没人写这个键 = 完全不存在（判定本身的规则不变）。 */
function forcedVerdict(): GsGateVerdict | null {
  try {
    const raw = localStorage.getItem("gsAutoGateForce");
    if (raw === "on" || raw === "off") return { on: raw === "on", reason: `forced=${raw}` };
  } catch {
    /* 存储被禁：当作没写 */
  }
  return null;
}

/** 自动判定的结论（只探一次）。`gsStep0.gsStep0On` 就是读它。 */
export function gsAutoGate(): GsGateVerdict {
  if (verdict) return verdict;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  probed = probeGsDevice();
  verdict = forcedVerdict() ?? decideGsAutoGate(probed);
  probeMs = typeof performance !== "undefined" ? Math.round(performance.now() - t0) : 0;
  // 日志是"关掉那一侧"唯一的证据（HUD 只在开着时存在）：一行结论 + 一行原始事实。
  // ★ 全是 ASCII：这是开发者读数，不是界面文案（混进中文会被 scripts/check-i18n.mjs 当漏译）。
  try {
    console.info(`[gs] gsAutoGate: ${verdict.on ? "on" : "off"} reason: ${verdict.reason}`);
    console.info(
      `[gs] probe (${probeMs}ms) cores=${probed.cores ?? "-"} mem=${probed.memory ?? "-"} ` +
        `screen=${probed.screenLongPx ?? "-"}x${probed.screenShortPx ?? "-"} android=${probed.android ?? "-"} ` +
        `gpu=${probed.gpu ?? "-"}`,
    );
  } catch {
    /* console 被裁掉的壳子里不该因为打日志失败把启动打崩 */
  }
  return verdict;
}

/** 验收/日志用：探测到的原始事实（第一次调用时会触发探测） */
export function gsAutoGateProbe(): GsGateProbe | null {
  gsAutoGate();
  return probed;
}
