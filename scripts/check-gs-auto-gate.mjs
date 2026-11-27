#!/usr/bin/env node
// 构建门禁：高斯场景「按机型自动判定」的规则实跑（2026-11-27，`feat/gs-auto-gate-align`）。
//
// ★★ 为什么要它：这一条规则决定"用户打开工坊看到的是实景房间还是程序化书房"，
//   而它判错的两种方式都是零报错的 —— ① 把软渲染机器判成够格（每帧上百次 ALU，机器直接卡死）；
//   ② 把够格的机器判成不够格（默认体验悄悄退回上一版，没人发现）。
//   规则本身在 `src/studio/scene/gsAutoGateRules.ts`（零依赖纯函数），这里**直接 import 它**，
//   用真机探到的数与几种典型坏机器跑一遍正反例；一条规则都不在本文件里重写。
//
// ★ 仓内门禁纪律（check-hook-order 那条）：写完先造一个真违规，确认它会红。
//   试过的两处：把 `shortPx` 门槛改成 720（真机用例立刻红）；把软渲染正则删掉
//   （SwiftShader 用例立刻红）。
//
// 用法：node scripts/check-gs-auto-gate.mjs
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const R = await import(url.pathToFileURL(path.join(root, "src/studio/scene/gsAutoGateRules.ts")).href);

const problems = [];
let ran = 0;

/** 断言一组探测事实的判定结果 */
function expect(label, probe, wantOn, reasonIncludes = []) {
  ran += 1;
  const base = {
    cores: 8,
    memory: 8,
    gpu: "Adreno (TM) 750",
    screenShortPx: 1272,
    screenLongPx: 2800,
    android: 16,
    ...probe,
  };
  const v = R.decideGsAutoGate(base);
  if (v.on !== wantOn) problems.push(`${label}: 期望 on=${wantOn}，实际 ${v.on}（${v.reason}）`);
  for (const s of reasonIncludes) {
    if (!v.reason.includes(s)) problems.push(`${label}: reason 里没有「${s}」：${v.reason}`);
  }
  // HUD / 日志里印的是这一行 ASCII —— 一旦混进中文，check-i18n 会把角标当漏译
  if (!/^[\x20-\x7E]+$/.test(v.reason)) problems.push(`${label}: reason 不是 ASCII：${v.reason}`);
  if (!v.reason) problems.push(`${label}: reason 为空`);
}

// ── 正例：真机 3C15CJ00C8V00000（8 核 / Android 16 / 1272×2800 / Adreno）──
expect("真机", {}, true, ["cores=8", "mem=8", "screen=2800x1272", "android=16"]);

// ── 正例：够格的下沿（6 核 / 4GB / 1080p / Android 12）──
expect("下沿", { cores: 6, memory: 4, screenShortPx: 1080, screenLongPx: 1920, android: 12 }, true, [
  "cores=6",
  "mem=4",
  "screen=1920x1080",
  "android=12",
]);

// ── 正例：内存量不到（navigator.deviceMemory 缺）不拦，其余够格 → 开 ──
expect("无内存项", { memory: null }, true, ["cores=8", "screen=2800x1272", "android=16"]);

// ── 反例：软渲染一律不开（哪怕核数/内存/分辨率/Android 全是旗舰）──
expect("SwiftShader", { gpu: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)..." }, false, ["gpu=software"]);
expect("llvmpipe", { gpu: "llvmpipe (LLVM 15.0.7, 256 bits)" }, false, ["gpu=software"]);
expect("WARP", { gpu: "ANGLE (Microsoft, Basic Render Driver Direct3D11 vs_5_0 ps_5_0)" }, false, ["gpu=software"]);
// ── 反例：取不到 GPU 信息 → 保守不开 ──
expect("无 GPU 信息", { gpu: null }, false, ["gpu=unknown"]);
expect("空 GPU 串", { gpu: "   " }, false, ["gpu=unknown"]);
// ── 反例：量不到 Android（桌面浏览器 / 被裁 UA）→ 保守不开 ──
expect("无 Android", { android: null }, false, ["android=unknown"]);
// ── 反例：四项里有任何一项不过 → 不开，且 reason 指出是哪一项 ──
expect("4 核", { cores: 4 }, false, ["weak(cores=4)"]);
expect("3GB 内存", { memory: 3 }, false, ["weak(mem=3)"]);
expect("720p", { screenShortPx: 720, screenLongPx: 1280 }, false, ["weak(screen=1280x720)"]);
expect("Android 11", { android: 11 }, false, ["weak(android=11)"]);
// ── 反例：连两项都量不到 → too-few-signals（"至少两项"就是这么钉住的）──
expect(
  "只量到一项",
  { cores: null, memory: null, screenShortPx: null, screenLongPx: null, android: 16 },
  false,
  ["too-few-signals"],
);

// ── 软渲染正则本身：Adreno / Mali / Apple 这些真 GPU 不许被误杀 ──
for (const gpu of ["Adreno (TM) 740", "Mali-G715-Immortalis MC11", "Apple GPU", "ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)"]) {
  ran += 1;
  if (R.isSoftwareGpu(gpu)) problems.push(`真 GPU 被当成软渲染：${gpu}`);
}
for (const gpu of ["SwiftShader", "swiftshader device", "llvmpipe", "softpipe", "Microsoft Basic Render Driver"]) {
  ran += 1;
  if (!R.isSoftwareGpu(gpu)) problems.push(`软渲染没被认出来：${gpu}`);
}

// ── 门槛本身不许被改歪（例如把短边门槛删到 0）──
ran += 1;
if (!(R.GS_GATE_MIN.cores >= 4 && R.GS_GATE_MIN.memory >= 2 && R.GS_GATE_MIN.shortPx >= 720 && R.GS_GATE_MIN.android >= 10)) {
  problems.push(`门槛不在合理范围：${JSON.stringify(R.GS_GATE_MIN)}`);
}

if (problems.length) {
  console.error(`[check-gs-auto-gate] ${problems.length} 处不对（跑了 ${ran} 组）：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`[check-gs-auto-gate] ok（${ran} 组正反例）`);
