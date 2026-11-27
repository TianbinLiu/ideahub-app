// ★★ 壁炉火焰图集（离线生成，2026-11-26，`feat/gs-fullscreen-fire`）
//
// 为什么不再用程序化 shader 现算（上一版 `HearthFire` 的 fbm）：
//   现算的噪声每个像素都要跑 3 个八度 + 三条火舌的循环，中端机上是笔不小的片元开销；
//   更要紧的是"火怎么翻卷"是**时间演化**的，现算噪声只能近似成"会动的噪点"。这一版把火焰
//   烘成**逐帧图集**：卷边在离线生成时一次做对（curl noise 推着温度场往上走），运行时只采样。
//
// 生成的是**温度场**（单通道灰度，0 = 冷、1 = 白热）：
//   · 颜色不上图集 —— 颜色由 shader 现算（黑体曲线，见 `HearthFire` 的 `blackbody()`），
//     同一张图集才能同时表达"外焰 900 K 的暗红"和"内焰 1900 K 的黄白"；
//   · 单通道写进 RGB 三通道同值：WebP 有损编码是 YUV 4:2:0，色度会被降采样 —— 三通道
//     放同一份数据等于让色度恒定，细节一点不丢（换成 RGB 各放一份数据就会被糊掉）。
//
// 三个场（对应主人要求的 curl noise + 温度场 + 上升速度场）：
//   ① **上升速度场** `speed(u)`：中间那束升得最快（火舌主干）、两侧慢（贴柴面卷）——
//      表现为每列纵向**缩放**（`sy`），因为时间项只能整周期，见下面"无缝"。
//   ② **curl noise**：流函数 ψ 的旋度当横向扰动场，把火舌拧出卷边（低分辨率网格算好再
//      双线性采样，省掉每像素 4 次额外噪声）。ψ 和温度场**一起**被拧 —— 只拧细节的话轮廓
//      仍是标准锥体（第一版就是这个形状，读起来像贴片）。
//   ③ **温度场**：横向冷热衰减 × 高度衰减 × 低频噪声咬出轮廓，再按阈值成形。
//
// ★★ 无缝（这是整份脚本最容易做错的一处）：
//   · 时间周期固定为 1（= 64 帧）。噪声用 `vn(x, wrap1(y - t), P, k)`：**每个八度按
//     "一个图块 = 它自己的一个完整周期"取样**（P = 该八度的格数），于是 t=1 时坐标刚好
//     平移一整个周期、和 t=0 逐像素相同；
//   · 每条火舌的摆动只用 `sin(2πt)` / `cos(2πt)`；
//   · 于是第 63 帧接第 0 帧天然无缝，**没有做任何首尾混合**（混合会把第一帧变糊）。
//   ⚠ 第一版把 `-K_UP*t` 乘进每列的 `speed(u)` 里（非整数周期），t=1 接不上；
//     现在 `speed(u)` 只进**空间**上的 `sy`。
//
// 用法：
//   node design/gen-fire-atlas.mjs                # 8×8 格 × 512 px = 4096²，有损 WebP
//   node design/gen-fire-atlas.mjs --tile=256     # 每格 256 px（1024²… 调试用，快）
//   node design/gen-fire-atlas.mjs --q=84         # 有损质量（体积门禁 1.5 MB）
//   node design/gen-fire-atlas.mjs --lossless     # 无损（体积大，仅对比用）
//
// 依赖：**只要一个带 Pillow 的 Python 来编码 WebP**（Node 侧零依赖）。
//   `PILLOW_PY=<python 路径> node design/gen-fire-atlas.mjs`
//   不写就依次试 python / python3 / py 与 DSH 自带的那一份。
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "public/models/study/tex/fire-atlas.webp");
const TMP = resolve(ROOT, ".tmp-fire-atlas");

const argOf = (name, dflt) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : dflt;
};
const TILE = argOf("tile", 512);
const QUALITY = argOf("q", 86);
const LOSSLESS = process.argv.includes("--lossless");

/** 图集布局：8×8 = 64 帧，行主序（第 f 帧在 col = f%8、row = floor(f/8)） */
const FRAMES = 64;
const COLS = 8;
const ROWS = 8;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const wrap1 = (x) => x - Math.floor(x);

// ── 周期噪声 ─────────────────────────────────────────────────────────────────
// 64×64 的随机表 + 一个散列把 (格点x, 格点y, 八度) 映射进表里。
// 这样"周期"完全由调用方给的 P（每格多少噪声单元，即该八度的周期）决定，而散列保证不同
// 八度之间不相关。⚠ 第一版错在把"表边长"当成了"周期"：256 个格点铺满一个图块 = 每格 256
// 个噪声单元 = 一片静态雪花点（预览图里那团白噪就是这么来的）。
const NT = 64;
const TABLE = new Float32Array(NT * NT);
{
  // 固定种子（xorshift32）：任何时候跑出来的图集逐字节一致，"这一版长什么样"才可复现
  let s = 0x9e3779b9;
  for (let i = 0; i < TABLE.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    TABLE[i] = ((s >>> 0) % 65536) / 65536;
  }
}
/** 值噪声：x,y 为**归一图块坐标**（[0,1) = 一块），Px/Py = 一格在横向/纵向各有几个噪声单元。
 *  ★ 两个方向分开取频率：火焰的特征是"竖着拉长的卷边"，所以要 Py < Px。
 *  取值按 P 环绕 ⇒ 在归一坐标上以 1.0 为周期（这就是无缝的支点）。 */
function vnA(x, y, Px, Py, k) {
  const fx = x * Px;
  const fy = y * Py;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const mx = (i) => ((i % Px) + Px) % Px;
  const my = (i) => ((i % Py) + Py) % Py;
  const x0 = mx(ix);
  const x1 = mx(ix + 1);
  const y0 = my(iy);
  const y1 = my(iy + 1);
  // 散列到表里：同一格点永远取同一个值（双线性插值本身连续，取值怎么散都不影响连续）
  const h = (a, b) => TABLE[(((a * 73856093) ^ (b * 19349663) ^ (k * 83492791)) >>> 0) & (TABLE.length - 1)];
  const a0 = h(x0, y0);
  const b0 = h(x1, y0);
  const c0 = h(x0, y1);
  const d0 = h(x1, y1);
  const ab = a0 + (b0 - a0) * tx;
  const cd = c0 + (d0 - c0) * tx;
  return ab + (cd - ab) * ty;
}
/** 3 八度 fbm（各向异性）：每个八度各自以"一块"为周期（P 翻倍、坐标不乘），
 *  时间项统一是 `-t`（对该八度正好是一个完整周期）⇒ 无缝。 */
function fbm(x, y, t, fx, fy) {
  const yy = wrap1(y - t);
  return (
    0.55 * vnA(x, yy, fx, fy, 1) +
    0.29 * vnA(x, yy, fx * 2, fy * 2, 2) +
    0.16 * vnA(x, yy, fx * 4, fy * 4, 3)
  );
}

// ── 场的参数（都是对着 .tmp-fire-atlas/preview.png 一版版调出来的）──────────────
/** 温度场基础频率：横向 FX_BODY、纵向 FY_BODY 个噪声单元/格。
 *  ★ 纵向必须明显低于横向（2.6 vs 4.6）：火焰的卷边是竖向拉长的；两边相等会生成圆斑。 */
const FX_BODY = 6;
const FY_BODY = 2;
/** curl 流函数的基础频率 */
const FX_CURL = 2;
const FY_CURL = 1;
/** curl 扰动的幅度（归一图块单位）：轮廓与细节**一起**拧 */
const WARP = 0.18;
/** 速度场网格边长（低分辨率算好再双线性放大） */
const VN = 48;
/** 三条火舌：中心位（归一 u）、根部半宽 w、高度 h（相对一格高）、相位 ph。
 *  ★ 轮廓必须有"三条高低不一的舌"：只给一条解析轮廓 + 噪声的话，出来的是标准锥体
 *    （第一版就是这个形状，读起来像贴片）。 */
const TONGUES = [
  { c: 0.33, w: 0.145, h: 0.66, ph: 0.0 },
  { c: 0.5, w: 0.165, h: 0.92, ph: 0.37 },
  { c: 0.68, w: 0.13, h: 0.58, ph: 0.71 },
];
/** 纵向衰减的指数：越靠柴面越热 */
const FALL_POW = 1.6;
/** 温度场的阈值窗（成形用）：窗越窄，火舌之间的缝越深 */
const CUT_LO = 0.3;
const CUT_HI = 0.72;

/** 每帧的 curl 速度场（VN×VN）：ψ 的旋度，ψ 自己也按"一块一个周期"演化 */
function curlField(t) {
  const vx = new Float32Array(VN * VN);
  const vy = new Float32Array(VN * VN);
  const h = 1 / VN;
  const psi = (x, y) => fbm(x, y, t, FX_CURL, FY_CURL);
  for (let j = 0; j < VN; j++) {
    for (let i = 0; i < VN; i++) {
      const x = i / VN;
      const y = j / VN;
      const dx = (psi(x + h, y) - psi(x - h, y)) / (2 * h);
      const dy = (psi(x, y + h) - psi(x, y - h)) / (2 * h);
      // 二维旋度 v = (∂ψ/∂y, -∂ψ/∂x)；减掉 0.5 让场只形变、不整体平移
      vx[j * VN + i] = dy - 0.5;
      vy[j * VN + i] = -(dx - 0.5);
    }
  }
  return { vx, vy };
}
function sampleField(f, x, y) {
  const fx = wrap1(x) * VN;
  const fy = wrap1(y) * VN;
  const i0 = Math.floor(fx) % VN;
  const j0 = Math.floor(fy) % VN;
  const i1 = (i0 + 1) % VN;
  const j1 = (j0 + 1) % VN;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const a = f[j0 * VN + i0];
  const b = f[j0 * VN + i1];
  const c = f[j1 * VN + i0];
  const d = f[j1 * VN + i1];
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

/** 一帧的温度场（TILE×TILE，0~1）；t ∈ [0,1) 是整段循环里的相位 */
function heatFrame(t) {
  const { vx, vy } = curlField(t);
  const out = new Float32Array(TILE * TILE);
  const tau = Math.PI * 2;
  for (let py = 0; py < TILE; py++) {
    // 图集里存的是**正着**的火焰（图片上沿 = 火舌顶）：v=1 是顶、v=0 是柴面
    const v = 1 - (py + 0.5) / TILE;
    for (let px = 0; px < TILE; px++) {
      const u = (px + 0.5) / TILE;
      // ① 上升速度场：中心快、两侧慢 —— 只进**空间**缩放 sy（时间项见文件头 ★★）
      const center = (u - 0.5) / 0.30;
      const speed = Math.exp(-center * center); // 0 = 两侧、1 = 正中
      // ② curl：轮廓与细节一起拧（只拧细节的话轮廓仍是直边锥体）
      const uu = u + sampleField(vx, u, v) * WARP;
      const vv = v + sampleField(vy, u, v) * WARP * 0.7;
      // ③ 轮廓：**三条火舌取并集 + 一层连续的火床**（真实壁炉不是三根蜡烛）
      let shape = 0;
      for (let i = 0; i < TONGUES.length; i++) {
        const T = TONGUES[i];
        // 摆动只吃 sin(2πt) ⇒ 首尾接得上；越高摆得越大
        const yy = clamp01(vv / T.h);
        const sway = 0.028 * Math.sin(tau * (t + T.ph)) + 0.014 * Math.sin(tau * 2 * (t + T.ph) + 1.1);
        const c = T.c + sway * yy;
        const hw = T.w * (1 - Math.pow(yy, 1.30));
        if (hw <= 0.002) continue;
        const band = smoothstep(hw, hw * 0.12, Math.abs(uu - c));
        const tall = smoothstep(1.02, T.h > 0.8 ? 0.86 : 0.72, yy);
        const s = band * tall;
        if (s > shape) shape = s;
      }
      // 火床：底部连成一片（宽度 0.34、高度 0.24），往上让位给火舌
      const bed = smoothstep(0.34, 0.12, Math.abs(uu - 0.5)) * smoothstep(0.26, 0.02, vv);
      if (bed > shape) shape = bed;

      // ④ 内部纹理：向上平流的各向异性噪声（竖向拉长），温度 = 轮廓 × 纹理
      const sy = 1.0 + 0.6 * speed;
      const n = fbm(uu, vv * sy, t, FX_BODY, FY_BODY);
      const fall = Math.pow(clamp01(1 - vv), FALL_POW); // 越高越冷
      // 纹理当遮罩：低于阈值的整块被"撕"掉，火焰才有镂空的舌缝
      let heat = shape * (0.34 + 0.92 * n) * (0.55 + 0.55 * fall);
      heat = smoothstep(CUT_LO, CUT_HI, heat);
      // ⑤ 根部：柴缝里那一线白热（温度最高、最亮），上沿尽快收掉
      const root = smoothstep(0.19, 0.0, vv) * Math.pow(clamp01(1 - Math.abs(uu - 0.5) / 0.33), 1.1);
      heat = Math.max(heat, root * (0.5 + 0.5 * n));
      out[py * TILE + px] = clamp01(heat);
    }
  }
  return out;
}

// ── 拼图集 + 编码 ────────────────────────────────────────────────────────────
function runPy(py, args) {
  const candidates = [
    process.env.PILLOW_PY,
    "python",
    "python3",
    "py",
    "C:/Users/tliu7/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe",
  ].filter(Boolean);
  for (const exe of candidates) {
    const r = spawnSync(exe, ["-c", py, ...args], { encoding: "utf8" });
    if (r.status === 0) return r.stdout.trim();
    if (r.error && r.error.code === "ENOENT") continue;
    console.error(`[fire-atlas] ${exe} 失败：${(r.stderr || "").split("\n").slice(-3).join(" ")}`);
  }
  throw new Error("找不到能编码 WebP 的 Python（需要 Pillow）。设 PILLOW_PY=<python 路径> 再跑。");
}

const PY_ENCODE = [
  "import sys",
  "from PIL import Image",
  "raw, out, w, h, mode, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], int(sys.argv[6])",
  "im = Image.frombytes('L', (w, h), open(raw, 'rb').read()).convert('RGB')",
  "if mode == 'lossless':",
  "    im.save(out, 'WEBP', lossless=True, method=6)",
  "else:",
  "    im.save(out, 'WEBP', quality=q, method=6)",
  "print(im.size)",
].join("\n");

const t0 = Date.now();
const W = COLS * TILE;
const H = ROWS * TILE;
const atlas = new Uint8Array(W * H);
for (let f = 0; f < FRAMES; f++) {
  const heat = heatFrame(f / FRAMES);
  const ox = (f % COLS) * TILE;
  const oy = Math.floor(f / COLS) * TILE;
  for (let y = 0; y < TILE; y++) {
    const src = y * TILE;
    const dst = (oy + y) * W + ox;
    for (let x = 0; x < TILE; x++) atlas[dst + x] = (heat[src + x] * 255 + 0.5) | 0;
  }
  if (f % 16 === 15) console.log(`[fire-atlas] ${f + 1}/${FRAMES} 帧 · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

mkdirSync(TMP, { recursive: true });
const rawPath = resolve(TMP, `fire-heat-${W}x${H}.raw`);
writeFileSync(rawPath, atlas);
runPy(PY_ENCODE, [rawPath, OUT, String(W), String(H), LOSSLESS ? "lossless" : "lossy", String(QUALITY)]);
const bytes = statSync(OUT).size;
console.log(`[fire-atlas] ${OUT}`);
console.log(`[fire-atlas] ${FRAMES} 帧 · 每帧 ${TILE}×${TILE} · 图集 ${W}×${H} · ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > 1.5 * 1024 * 1024) {
  console.error("[fire-atlas] ⚠ 超过 1.5 MB 门禁：降 --q 或 --tile");
  process.exitCode = 1;
}

// 对照图：抽 6 帧横排（含第 0 与第 63 帧，用肉眼确认首尾接得上），
// 写 .tmp-fire-atlas/preview.png —— 调参用的临时件，不进仓库（.tmp-* 在 .gitignore 里）。
{
  const picks = [0, 12, 24, 36, 48, 63];
  const sheet = new Uint8Array(TILE * picks.length * TILE);
  picks.forEach((f, k) => {
    const ox = (f % COLS) * TILE;
    const oy = Math.floor(f / COLS) * TILE;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) sheet[y * TILE * picks.length + k * TILE + x] = atlas[(oy + y) * W + ox + x];
    }
  });
  const prevRaw = resolve(TMP, "preview.raw");
  writeFileSync(prevRaw, sheet);
  const prevOut = resolve(TMP, "preview.png");
  runPy(
    ["import sys", "from PIL import Image", "w, h, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]", "im = Image.frombytes('L', (w, h), open(sys.argv[4], 'rb').read())", "im.save(out)"].join("\n"),
    [String(TILE * picks.length), String(TILE), prevOut, prevRaw],
  );
  console.log(`[fire-atlas] 对照图（帧 ${picks.join(",")}）→ ${prevOut}`);
}
