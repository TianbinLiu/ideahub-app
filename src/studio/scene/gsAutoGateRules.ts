// ★★ 高斯场景「按机型自动判定」的**唯一判定处**（2026-11-27，`feat/gs-auto-gate-align`）。
//
// 为什么单独一个文件：探测要碰 navigator / WebGL（跑不进 Node），而"够不够格"这条规则要能在
//   构建里拿正反例实跑（`scripts/check-gs-auto-gate.mjs`）—— 所以规则留在零依赖的纯函数里，
//   DOM 那一层在 `gsGate.ts`。
//
// ★ 判定原则（主人这一轮的六条）：
//   ① 至少组合两项探测：核数 / 内存（有才用）/ GPU renderer（必须有，软渲染一律不开）/
//      屏幕物理分辨率 / Android 大版本；
//   ② 够格 → 默认开（1.6M 档，档位仍在 gsStep0.GS_SPLAT_TIER）；
//   ③ 用户显式开/关仍然优先（那一层在 gsStep0.gsStep0On，判定本身不读用户设置）；
//   ④ 保守：取不到 GPU 信息、连两项都量不到、任何一项不达标 → 不开；
//   ⑤ 判定结果与依据要能在 HUD / 日志里读到（`gsAutoGate: on|off reason:...`）。
//
// ★ 为什么 GPU 是硬门槛而不是加分项：SwiftShader / llvmpipe 这类软渲染跑 160 万高斯不是
//   "慢一点"，是每个高斯都走上百次 ALU —— 实测在 Playwright 的软渲染里连一帧都出不来。
//   WebGL 拿不到 `WEBGL_debug_renderer_info` 时 renderer 是 null，也就无从排除软渲染 ⇒ 不开。
//
// ★ 为什么 Android 版本这一项是"必须量到"：这一档只在 Capacitor 的 Android WebView 里发。
//   量不到 Android（桌面浏览器 / 被裁过的 UA）时按保守处理不开 —— dev 要看效果本来就有
//   `?gs=1`，不需要自动判定替开发机做主。
//
// ★ 断网不影响判定：这一层**不发任何网络请求**，读的全是本机信息；"断网时保守"指的是
//   取不到信息那一边（gpu=null / too-few-signals）本来就判 off，不会因为网络好坏翻成 on。
//
// ⚠ 改门槛之前先想清楚"谁会被关掉"：这些数是按真机 3C15CJ00C8V00000（8 核 / Android 16 /
//   1272×2800）定的一档底线，不是按旗舰机定的 —— 详见 docs/gs-table-light-log.md §18。

/** 探测到的原始事实。null = 这一项没量到（不是 0）。 */
export interface GsGateProbe {
  /** navigator.hardwareConcurrency（逻辑核数） */
  cores: number | null;
  /** navigator.deviceMemory（GB；WebView 才有，Chrome 上限报 8） */
  memory: number | null;
  /** WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL */
  gpu: string | null;
  /** 物理分辨率短边（screen 短边 × devicePixelRatio） */
  screenShortPx: number | null;
  /** 物理分辨率长边 */
  screenLongPx: number | null;
  /** UA 里的 Android 大版本（16 = Android 16） */
  android: number | null;
}

export interface GsGateVerdict {
  on: boolean;
  /** ASCII、可直接印进 HUD 的依据（不含空格之外的界面文案） */
  reason: string;
}

/** 门槛：核数 / 内存 / 物理短边 / Android 大版本。四项都是"底线"，不是推荐值。 */
export const GS_GATE_MIN = {
  cores: 6,
  memory: 4,
  shortPx: 1080,
  android: 12,
} as const;

/** 软渲染黑名单（大小写不敏感）。命中任何一个 → 一律不开。 */
const SOFTWARE_GPU_RE =
  /swiftshader|llvmpipe|softpipe|software\s*(rasterizer|adapter|renderer)|microsoft\s*basic\s*render|d3d11\s*warp|basic\s*render\s*driver|mesa\s*offscreen/i;

/** 这个 GPU 字符串是不是软渲染（导出给构建里的正反例与日志用） */
export function isSoftwareGpu(gpu: string | null): boolean {
  return !!gpu && SOFTWARE_GPU_RE.test(gpu);
}

const fmt = (n: number | null): string => (n == null ? "?" : String(n));

/** 一项探测的三态：量不到 / 过 / 不过。量不到的项不算"过"，也不拦（GPU 与 Android 两项例外）。 */
type Check = { name: string; known: boolean; ok: boolean; text: string };

function checksOf(p: GsGateProbe): Check[] {
  return [
    { name: "cores", known: p.cores != null, ok: (p.cores ?? 0) >= GS_GATE_MIN.cores, text: `cores=${fmt(p.cores)}` },
    { name: "mem", known: p.memory != null, ok: (p.memory ?? 0) >= GS_GATE_MIN.memory, text: `mem=${fmt(p.memory)}` },
    {
      name: "screen",
      known: p.screenShortPx != null,
      ok: (p.screenShortPx ?? 0) >= GS_GATE_MIN.shortPx,
      text: `screen=${fmt(p.screenLongPx)}x${fmt(p.screenShortPx)}`,
    },
    { name: "android", known: p.android != null, ok: (p.android ?? 0) >= GS_GATE_MIN.android, text: `android=${fmt(p.android)}` },
  ];
}

/**
 * 判定。返回的 `reason` 永远是 ASCII 的"依据清单"：
 *   开：`cores=8,mem=8,screen=2800x1272,android=16`
 *   关：`gpu=unknown` / `gpu=software(SwiftShader...)` / `android=unknown` /
 *       `weak(cores=4)` / `too-few-signals`
 */
export function decideGsAutoGate(p: GsGateProbe): GsGateVerdict {
  // ── 硬门槛 ①：GPU 信息必须有，且不能是软渲染 ──
  const gpu = p.gpu?.trim() ?? "";
  if (!gpu) return { on: false, reason: "gpu=unknown" };
  if (isSoftwareGpu(gpu)) return { on: false, reason: `gpu=software(${gpu.slice(0, 48)})` };

  const checks = checksOf(p);
  const known = checks.filter((c) => c.known);
  // ── 硬门槛 ②：Android 版本必须量到（这一档只在 Android WebView 里发）──
  if (p.android == null) return { on: false, reason: "android=unknown" };
  // ── 硬门槛 ③：至少量到两项（主人给的"至少两项"）──
  if (known.length < 2) return { on: false, reason: "too-few-signals" };

  // 量到的每一项都必须达标；量不到的项（内存）不拦，但不能让"只量到一项"混过去。
  const failed = known.filter((c) => !c.ok);
  if (failed.length) return { on: false, reason: `weak(${failed.map((c) => c.text).join(",")})` };

  const evidence = checks
    .filter((c) => c.known)
    .map((c) => c.text)
    .join(",");
  return { on: true, reason: evidence };
}
