// 「窗前看月亮」4 个候选（方舟 Seedream 5.0 pro · 2560×1440）。
//
// 这一轮的产物**不是**给人直接看的壁纸，而是给「单图 → 3DGS」工具（Apple SHARP 的本地 Web 包，
// 见本轮调研）当**输入**用的。输入图的三条硬要求因此和普通概念图不同：
//   ① **几何干净**：镜头站在室内**正对窗户**（不俯仰、不歪、不侧转），窗在画面正中。单图重建
//      只能绕小角度——相机一歪，重建出来的"正面墙"就歪，绕一圈立刻穿帮。
//   ② **别挡主体**：窗前不许有桌子/家具。前中景一挡，遮挡边界两侧的深度是模型自己猜的，
//      一转视角就撕开（上一轮「长桌穿心」的构图在这里是反例）。
//   ③ **要有深度线索**：木窗框 + 十字窗棂 + 窗台器物 + 地板缝 + 椽子，都是让单目深度站得住的
//      "平行/透视参照"；一块平涂的墙没有任何尺度线索。
//
// 与 _gen-workshop-seedream-detail.mjs_ 的关系：**读 key / 幂等补缺 / --only / manifest / hires
// PNG 的那一套原样复用**（同一个方舟出图协议、同一个 ffmpeg 编码阶梯、同一个"产物落仓库外"的
// 纪律）。换掉的只有场景与四张之间的差异维度。**别把那一份脚本改成通用库**——它记着上一轮
// 已经否掉的构图结论（毛玻璃圆窗、熄灭的壁炉、空桌面），删掉就少了一份证据。
//
// 用法（仓库根目录 = app/）：
//   node design/gen-window-moon.mjs                      只补缺的（已有文件跳过）
//   node design/gen-window-moon.mjs --force              四张全部重出（会重新花钱）
//   node design/gen-window-moon.mjs --only=2,stars-clouds 只重出点名的（序号或 id 都认）
//   node design/gen-window-moon.mjs --out=<目录>          改落盘目录
//   node design/gen-window-moon.mjs --dry                只打印四条提示词，不出图、不花钱
//   node design/gen-window-moon.mjs --size=2048x1152     跳过首选尺寸直接出退路尺寸
//   ARK_API_KEY=... node design/gen-window-moon.mjs      key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-window-moon.mjs 没装 ffmpeg 时点名
//
// 产物（默认落仓库外 ~/Downloads/window-moon）：
//   <out>/1.webp … 4.webp           2560×1440、单张 ≤400KB（与上一轮同一档交付纪律）
//   <out>/hires/1.png … 4.png        同一张的 2560×1440 无损 PNG（压缩前母版，喂给重建工具的也是它）
//   <out>/manifest.json              这一轮每张实际用的提示词与尺寸
//   <out>/notes.md                   四张的差异 + 自查结论（已存在就不覆盖：自查是人工写的）
//
// ★ 为什么四张只差**一句**：这是候选集，不是风格研究。共用段逐字相同，主人才好回答
//   "到底是月亮大小不对，还是窗外太干净，还是窗台太素"——上一轮五档动漫强度就是这么用的。
// ★ 为什么月亮要写"锋利的边缘 + 月海 + 环形山 + 临边变暗"：单图重建会把月亮当成一块
//   无深度的白斑（它确实在无穷远）。写清楚这些特征只是为了让**输入图**好看、让工具面板里
//   一眼能认出哪张是我要的；真正的深度靠窗框/窗棂/窗台，不靠月亮。
// ★ 为什么禁止毛玻璃：毛玻璃会把窗外压成一块均匀的亮，月亮没有轮廓、窗外没有可分辨的层次，
//   重建出来就是一块"发光平板"。通透玻璃（clear glass）是这一轮和上一轮场景的最大区别，
//   上一轮特意要毛玻璃（为了让窗外看不见东西），这一轮反过来——**两次要求相反是刻意的**。
// ★ 为什么 key 从 .env.local 读（铁律三：密钥只进 .env，永不入仓）：ARK_API_KEY **不带
//   VITE_ 前缀**是刻意的（带了会被打进客户端包）。查找顺序：环境变量 → --env=<路径> →
//   app/.env.local → ../server/.env。读到就用，读不到整句退出并说清去哪儿配。
//   **任何情况下都不打印 key 本身。**
// ★ 为什么默认落到仓库外：这是给人挑的候选，随时会被否掉重画；进 public/ 会被打进 APK、
//   被 CI 的体积检查盯上。
//
// ★★ **三轮实测的已知偏差（2026-11-27 记，下一轮别从零再试）**：交付要求是「窗占画面宽度
//   45%~60%」，三轮都没画到，模型稳定停在 26%~33%：
//     pass1  逐字写 "the window opening spans about half of the frame width"        → 27%~35%
//     pass2  加"窗框外沿约占画面宽度一半、两侧各留约四分之一墙"                          → 25%~36%
//     pass3  改成算术式的"洞口从 1/4 处到 3/4 处、上 1/10 到下 2/3"+"窗是近处主体"        → 26%~33%
//   同一轮里月亮是听话的（直径能做到窗洞宽度的 72%~92%），所以不是"尺寸词写不进去"，而是
//   模型**不肯让窗户挤掉阁楼的墙体与屋架**——它把这个场景理解成"室内全景"，不是"窗的特写"。
//   下一轮要么接受 26%~33%，要么把构图整个换掉（例如不写 attic，只写 window wall），
//   继续在这三段的措辞上加码是没用的。
//   ★ 顺带记一条几何上的打架：窗宽占 45%~60% 时洞口宽约 1280px、高至多约 900px，而「月亮
//   占满窗洞 ≥80% 面积」只有在月亮比洞口还大（被窗框裁掉）时才可能——圆内接于矩形最多
//   只占 π/4 ≈ 78.5%。所以那两条要求本身不能同时按"面积"读；这一轮按"直径 ≥ 窗洞短边
//   的 80%、四角只剩一线夜空"来实现（视觉上就是"几乎占满"）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ────────────────────────────── 参数 ──────────────────────────────

/** 方舟 Seedream 5.0 pro（= src/data/economy.ts 的「精绘」档；全仓唯一在用的 5.0-pro 型号） */
const MODEL = "doubao-seedream-5-0-pro-260628";
/** 首选画布：16:9 · 3,686,400 像素，落在 5.0-pro 的 [921,600, 4,624,220] 窗口里 */
const SIZE = "2560x1440";
/** 退路画布：方舟若拒了上面的尺寸（窗口改过 / 尺寸语法变了）就退这一档，2,359,296 像素 */
const FALLBACK_SIZE = "2048x1152";
/** 单张交付上限（webp）；PNG 母版不设限 */
const MAX_KB = 400;
/** 降质阶梯：从高往低试，第一档就过就停 */
const QUALITIES = [92, 86, 80, 74, 68, 64, 60, 56, 52, 48, 44, 40, 36];

/**
 * **四张共用的场景段**（逐字共用，一个字都不按变体改）。
 *
 * ★ 三条是给"单图 → 3DGS"这个用途写的，不是给好看写的：
 *   ① 「正对、水平、不俯仰不歪」—— 相机一歪，重建的墙面跟着歪；
 *   ② 「窗前没有桌子/家具」—— 前中景遮挡物会撕开；
 *   ③ 「窗占画面宽度 45~60%」—— 太窄则窗外（月亮）只占很少像素，太宽则墙面/窗台这些
 *      真正提供深度的东西被挤出画面。
 * ★ 玻璃这一句写死"clear transparent, not frosted, not milky"：模型对"要什么"比对"不要什么"
 *   敏感，所以两种写法都写（正向 clear glass + 反向 not frosted）。
 * ★ 「这是房间里唯一一扇窗」：上一轮吃过亏——模型会自作主张长出天窗/第二扇窗。
 * ★ 星图/剥落放在**侧墙**，不进窗洞：窗洞里只能有月亮与夜空，否则月亮占比被挤下去。
 * ★ 这里不写任何画风词：画风在 STYLE_FIXED 单独一句，四张不变。
 */
const BASE =
  "Night-time interior of a witch's attic room under a steep sloping wooden roof, dark weathered oak beams and rafters crossing the ceiling. " +
  "The camera stands on the wooden floor at eye height, about one and a half metres above the floorboards, perfectly level and square-on: facing the far wall straight ahead, no tilt up or down, no dutch angle, no side turn. " +
  "Set into that far wall, exactly in the centre of the frame, is ONE LARGE window with a dark stained-oak frame, divided by a simple cross muntin into four clear panes. " +
  "The window is close and dominant, and its size in the picture is fixed: the opening is about half as wide as the whole picture (from roughly one quarter of the picture width to roughly three quarters) and nearly square, running from about a tenth of the picture height down to about two thirds of it; the thin strips of wall left and right of it are barely a quarter of the picture width each, and below the sill there is only a band of floorboards. " +
  "The glass is clear and fully transparent, plain polished window glass: everything behind it is sharply visible through it — no frosted glass, no milkiness, no fog, no condensation, no etching, no stained glass, no heavy curtain, no blind, no shutter. " +
  "This is the only window in the room: the other walls, the roof and the ceiling are solid dark wood and plaster — no skylights, no roof windows, no second window, no door, no mirror. " +
  "Outside the glass a huge full moon hangs in the black night sky: the moon is so big and so near that its disc is as wide as the window opening and a little taller than the opening, so its left and right edges come right up against the side frame, its top and bottom are cropped by the frame, and the black night sky is visible only in the small four corners of the opening. " +
  "The moon shows real lunar detail: large dark grey maria, many small craters with bright rims, a finely mottled surface, a razor sharp crisp edge, and a crisp limb that is slightly darker toward the outer edge. " +
  "Around the moon the black sky is clean and the moonlight is cold silver-white and clean-edged, not a blurry glow, not lens flare. " +
  "A wide flat wooden windowsill runs under the window. The sill holds only ONE or TWO small objects and nothing else — not a row of bottles, not a pile of books, not a cluster of jars. " +
  "The floor between the camera and the window is completely empty: nothing stands in front of the window — no table, no desk, no chest, no bench, no bookshelf, no furniture of any kind between the camera and the window, an uninterrupted view of the sill and the glass. " +
  "The floorboards run away from the camera toward the window in clear straight lines, with visible grain, gaps and cracks. " +
  "On the side walls: peeling cracked plaster showing bare lath in places, a hanging parchment star chart / celestial map on the left wall, a few dried herbs and an old iron key hanging from a nail on the right wall. " +
  "Dark heavy wooden furniture and stacks of old books are pushed to the left and right edges of the room, out of the way of the window. " +
  "The room is dark and warm-toned: dark stained wood, dusty warm brown shadow in the corners, against the cold silver moonlight coming in through the window. " +
  "No people, no human figures, no silhouettes, no hands, no animals anywhere in the room.";

/**
 * **正向堆细节段**（与上一轮同一批词，删掉哪条细节就掉一档）。
 * ★ 这里**不写**任何「不是…」的细节词：否定的细节词（no gradients / no 3d render 之类）
 *   会顺带把材质与光影一起压平，上一轮就是那么变成草稿的。
 */
const DETAIL =
  "Highly detailed hand-painted background art, intricate textures, visible wood grain, individual floorboard gaps, cracked flaking plaster, fine lineart, rich subtle shading, sharp focus, clean crisp edges. " +
  "Fine dust motes float in the cold moonlit air and catch the light. ";

/** 画风钉死的那一句：只用 anime background art / illustration，保留 not a photograph 一条 */
const STYLE_FIXED = "This is anime background art / illustration, not a photograph. ";

/**
 * 取景收尾（四张共用）。
 * ★ 「16:9 横构图 + 窗在正中 + 一点窗外夜空」在这里再钉一遍：BASE 里已经说过，收尾再说一次
 *   不浪费——这两个模型对**末尾**的构图句最敏感。
 * ★ 画面里没有人是硬的：之后要叠 App 自己的 3D 角色；自带人影在高斯重建里撕不掉。
 */
const FRAME =
  "16:9 horizontal widescreen composition, one-point perspective, camera perfectly level and centred on the window: the window opening is the dominant shape, about half of the picture width and nearly square, centred in the picture, with the huge moon almost filling it and black night sky only in its corners; the sill and the empty floorboards lead the eye to the window. " +
  "No text, no letters, no numbers, no watermark, no border, no signature, no UI.";

// ────────────── 四个变体：只差**一句**（序号 + id 同时是 --only 的认法） ──────────────
// ★ 只写「这一张比别的多/少什么」，场景、窗、月亮的位置、光的方向一个字都不许改。
// ★ ① 月亮更大更近：不写"更大"（BASE 已经很大了），写它**挤到窗框**——
//   "几乎贴住窗棂"是模型能画出来的具体关系，"更大"只是形容词。
// ★ ② 窗外多几颗星/薄云：星星和云都**在月亮后面**，不许压到月面上（压上去月亮就花了）。
// ★ ③ 窗台有烛台：唯一可能有人的误导点——烛台要小、要在一侧，不能立在窗洞正中把月亮劈开。
// ★ ④ 更暗更克制：把"暖"压到只剩木头的反光，只留冷月光勾边；这一张的用途是"给重建工具
//   一个更干净的对比度"，太暗的代价是暗部纹理在重建里会糊成一片——主人挑的时候要权衡。
const VARIANTS = [
  {
    id: "moon-near",
    name: "① 月亮更近更大",
    extra:
      "Variant: the moon is even closer and larger — its disc is slightly wider than the window opening, so the frame crops it a little at the top and at the bottom, its maria and craters spread across all four panes, leaving only the four corner slivers of black night sky.",
  },
  {
    id: "stars-clouds",
    name: "② 窗外多几颗星与薄云",
    extra:
      "Variant: outside the glass a scatter of a few faint sharp stars fills the corner slivers of sky, and one thin band of high cirrus cloud drifts across the lower pane just below the moon's edge and catches the moonlight; the stars and the cloud stay outside the moon's disc, behind it, never over its face.",
  },
  {
    id: "candle-sill",
    name: "③ 窗台有烛台",
    extra:
      "Variant: a single small brass candlestick with one lit candle stands on the windowsill at the left end of the sill, its tiny warm flame the only warm light in the room, well clear of the moon's disc.",
  },
  {
    id: "darker",
    name: "④ 更暗更克制",
    extra:
      "Variant: darker and more restrained — the interior sinks almost entirely into deep cold shadow, the warm colour reduced to a faint brown reflection on the wood, only the cold moonlight tracing the edges of the window frame, the sill and the floorboards.",
  },
];

// ────────────────────────────── key 与工具 ──────────────────────────────

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit?.slice(n.length + 3);
};

/** 从一份 env 文件里读 ARK_API_KEY；没有那一行回空串。★ 只返回 key，绝不打印整个文件 */
function keyFrom(file) {
  if (!file || !existsSync(file)) return "";
  const m = readFileSync(file, "utf8").match(/^\s*ARK_API_KEY\s*=\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

function resolveKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY.trim();
  const candidates = [
    opt("env"),
    join(ROOT, ".env.local"),
    join(ROOT, "..", "server", ".env"),
    join(homedir(), "ideahub", "server", ".env"),
  ].filter(Boolean);
  for (const f of candidates) {
    const k = keyFrom(f);
    if (k) return k;
  }
  return "";
}

const FFMPEG = process.env.FFMPEG || "ffmpeg";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** "2560x1440" → { w, h, pixels } */
function parseSize(s) {
  const m = /^(\d+)x(\d+)$/i.exec(s.trim());
  if (!m) throw new Error(`尺寸写法不对：${s}（要 WIDTHxHEIGHT）`);
  const w = Number(m[1]);
  const h = Number(m[2]);
  return { w, h, pixels: w * h };
}

/** 出一次文生图，回图片 URL。参数与 src/ai/arkClient.generateImage 同一份协议 */
async function seedream(prompt, size) {
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, prompt, size, response_format: "url", watermark: false }),
    // 客户端出图超时 170s（arkClient 那条），一次性脚本给到 240s：pro 大画布一张近百秒，别白跑
    signal: AbortSignal.timeout(240_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) {
    const detail = `${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`;
    throw new Error(detail);
  }
  return j.data[0].url;
}

/**
 * 出图 + 一次重试。
 * ★ 429 / 5xx 是瞬时的，重试一次；★ 方舟拒了**尺寸**（400 且报错里提到 size/pixel/resolution）
 *   不是瞬时错，直接退到 FALLBACK_SIZE 再发一次 —— "2560×1440 不行就退 2048×1152" 这一条
 *   写在交付要求里，不该每跑一次靠人记得改常量。
 */
async function seedreamRetry(prompt, size) {
  const attemptOne = async (sz) => {
    let last;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await seedream(prompt, sz);
      } catch (e) {
        last = e;
        const msg = String(e);
        if (/^(400)\b/.test(msg) && /size|pixel|resolution/i.test(msg)) {
          throw Object.assign(new Error(msg), { sizeRejected: true });
        }
        const transient = /^(429|500|502|503|504)\b/.test(msg);
        if (!transient || attempt === 1) throw e;
        console.log(`      ↻ 瞬时错误，2s 后重试：${msg.slice(0, 120)}`);
        await sleep(2_000);
      }
    }
    throw last;
  };
  try {
    return { url: await attemptOne(size), size };
  } catch (e) {
    if (!e?.sizeRejected || size === FALLBACK_SIZE) throw e;
    console.log(`      ⤵ ${size} 被方舟拒了，退 ${FALLBACK_SIZE} 重发`);
    return { url: await attemptOne(FALLBACK_SIZE), size: FALLBACK_SIZE };
  }
}

/** 下载一次出图源到临时文件 */
async function download(url, dest) {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`下载出图 ${r.status}`);
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

/** 按质量阶梯把源图编成指定宽高的 webp，回 {bytes, quality} */
async function encodeWebp(src, outFile, width, height, qualities, maxKB) {
  let best = null;
  for (const q of qualities) {
    await run(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", src,
      // 宽高都钉死：webp 的 yuv420p 要偶数，而交付要的就是这一档尺寸
      "-vf", `scale=${width}:${height}:flags=lanczos`,
      "-frames:v", "1",
      "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6",
      outFile,
    ]);
    const size = readFileSync(outFile).length;
    best = { size, q };
    if (size <= maxKB * 1024) break;
  }
  if (!best || best.size > maxKB * 1024) {
    throw new Error(`${Math.round(best?.size / 1024 ?? 0)}KB 降质后仍超 ${maxKB}KB`);
  }
  return { bytes: best.size, quality: best.q };
}

/** 源图 → hires 无损 PNG（2560×1440 母版）+ 交付 webp（≤400KB） */
async function toDeliverables(url, tmpBase, pngFile, fullFile, size) {
  const { w, h } = parseSize(size);
  const src = `${tmpBase}.src`;
  await download(url, src);
  try {
    await run(FFMPEG, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", src,
      "-vf", `scale=${w}:${h}:flags=lanczos`,
      "-frames:v", "1",
      pngFile,
    ]);
    const full = await encodeWebp(src, fullFile, w, h, QUALITIES, MAX_KB);
    return { full, png: readFileSync(pngFile).length };
  } finally {
    rmSync(src, { force: true });
  }
}

/** 并发 2 路：方舟同账号并发出图会 429（real.ts 用的 3 路是上限，一次性脚本不抢那一条） */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// ────────────────────────────── 主流程 ──────────────────────────────

VARIANTS.forEach((v, i) => (v.n = i + 1));
/** 文件名就是序号：主人说"第几张"时不用再对一遍 id */
const fileName = (v) => `${v.n}.webp`;
const promptOf = (v) => `${BASE}${DETAIL}${STYLE_FIXED}${v.extra}${FRAME}`;

const OUT_DIR = opt("out")
  ? isAbsolute(opt("out"))
    ? opt("out")
    : resolve(ROOT, opt("out"))
  : join(homedir(), "Downloads", "window-moon");
const HIRES_DIR = join(OUT_DIR, "hires");

const SIZE_OVERRIDE = opt("size") ?? SIZE;
parseSize(SIZE_OVERRIDE); // 早退：写法错了不该等到花了钱才发现

if (flag("dry")) {
  // 只打印提示词：核"四张是不是只差一句"最省事的方式，也是重出前留证的办法
  console.log(`模型 ${MODEL} · 首选尺寸 ${SIZE}（退路 ${FALLBACK_SIZE}）· ${VARIANTS.length} 张 · 落盘 ${OUT_DIR}\n`);
  for (const v of VARIANTS) {
    console.log(`── ${fileName(v)}（${v.name}）`);
    console.log(promptOf(v));
    console.log(`[变体那一句] ${v.extra}\n`);
  }
  process.exit(0);
}

const KEY = resolveKey();
if (!KEY) {
  console.error(
    "没有 ARK_API_KEY：环境变量 / --env=<路径> / app/.env.local / ../server/.env 都找过了。\n" +
      "  配法见 AGENTS.md 铁律三（密钥只进 .env，永不入仓、不入文档、不入日志）。",
  );
  process.exit(1);
}
// ★ 探测 ffmpeg 要真的跑一次 `-version`：`existsSync("ffmpeg")` 在 Windows 上永远为假
//   （PATH 里是 ffmpeg.exe），照它提示会在一台装好了 ffmpeg 的机器上说"没装"。
// ★ 拦在花钱之前：否则要等出图的钱花完、下载也下完了，才在编码那一步报 ENOENT。
try {
  await run(FFMPEG, ["-version"]);
} catch {
  console.error(`找不到 ${FFMPEG}：装一个 ffmpeg，或用 FFMPEG=<ffmpeg 路径> 再跑。`);
  process.exit(1);
}

// --only 认序号（1..4）也认 id，大小写不敏感
const only = opt("only")
  ?.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const force = flag("force");
const todo = VARIANTS.filter((v) =>
  only?.length
    ? only.includes(v.id) || only.includes(String(v.n))
    : force || !existsSync(join(OUT_DIR, fileName(v))),
);
if (todo.length === 0) {
  // ★ 两种"没活干"要分开说：--only 没认出来时不能文不对题地说"四张都在"
  const absent = VARIANTS.filter((v) => !existsSync(join(OUT_DIR, fileName(v))));
  console.log(
    absent.length
      ? `--only 没选中任何一张（认序号 1..4 或 id：${VARIANTS.map((v) => v.id).join(" / ")}）`
      : `4 张都在 ${OUT_DIR}（要重出：--force 或 --only=<1..4|id>）`,
  );
  process.exit(0);
}

mkdirSync(HIRES_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 画布 ${SIZE_OVERRIDE}（退路 ${FALLBACK_SIZE}）· 交付 webp ≤${MAX_KB}KB + hires PNG`);
console.log(`本次出 ${todo.length}/${VARIANTS.length} 张 → ${OUT_DIR}`);

const tmpBase = join(tmpdir(), `window-moon-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (v) => {
  const prompt = promptOf(v);
  try {
    const { url, size } = await seedreamRetry(prompt, SIZE_OVERRIDE);
    const fullFile = join(OUT_DIR, fileName(v));
    const pngFile = join(HIRES_DIR, `${v.n}.png`);
    const { full, png } = await toDeliverables(url, `${tmpBase}-${v.id}`, pngFile, fullFile, size);
    ok += 1;
    console.log(
      `   [${ok}/${todo.length}] ${fileName(v)} · ${v.name} · ${size} · webp ${Math.round(full.bytes / 1024)}KB (q${full.quality})` +
        ` · PNG ${Math.round(png / 1024)}KB`,
    );
    return { ...v, size, bytes: full.bytes, pngBytes: png, file: fullFile, pngFile, prompt };
  } catch (e) {
    console.log(`   ✗ ${fileName(v)}: ${e instanceof Error ? e.message : e}`);
    return { ...v, size: SIZE_OVERRIDE, bytes: 0, err: String(e) };
  }
});

// 把这一轮用到的提示词与**实际**画布留一份在产物旁边：以后要改，先看这里当初到底写了什么
const manifest = join(OUT_DIR, "manifest.json");
const prior = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
const merged = { ...prior, _model: MODEL, _size: SIZE, _fallbackSize: FALLBACK_SIZE, _base: BASE, _detail: DETAIL, _styleFixed: STYLE_FIXED, _frame: FRAME };
for (const r of results) {
  if (!r.prompt) continue;
  merged[r.id] = { n: r.n, name: r.name, file: fileName(r), size: r.size, extra: r.extra, prompt: r.prompt };
}
writeFileSync(manifest, JSON.stringify(merged, null, 2));

// notes.md 草稿：四条提示词全文（自查结论由出图那一轮补在下面）。
// ★ 已存在就不覆盖：这份 notes 里记着逐张的自查结论（出图的人写的），重跑脚本不该把它冲掉。
const notesFile = join(OUT_DIR, "notes.md");
const notesBody = [
  "# 窗前看月亮 · 4 个候选 · Seedream 5.0 pro",
  "",
  `- 模型：\`${MODEL}\`（方舟 Seedream 5.0 pro）· 首选 ${SIZE}（退路 ${FALLBACK_SIZE}）`,
  `- 交付：webp 2560×1440 ≤${MAX_KB}KB；母版 PNG 见 \`hires/\``,
  "- 用途：给「单图 → 3DGS」工具当输入。所以几何要干净：正对窗户、水平、窗在正中、窗前无遮挡。",
  "- 场景：夜里魔女阁楼；正对一扇木框通透玻璃窗（十字棂、简单分格）；窗外巨大明月；窗台少量器物；侧墙星图与剥落灰泥；冷月光 / 暖木对比；细尘；无人物。",
  "",
  "## 共用段（四张逐字相同）",
  "",
  "```",
  BASE,
  "",
  DETAIL,
  STYLE_FIXED,
  FRAME,
  "```",
  "",
  "## 逐变体（只差那一句）",
  "",
];
for (const v of VARIANTS) {
  notesBody.push(`### ${v.n}. ${v.name}（id: \`${v.id}\`）`, "", "**变体句**：" + v.extra, "", "```", promptOf(v), "```", "", "**自查**：（待补）", "");
}
if (!existsSync(notesFile)) writeFileSync(notesFile, notesBody.join("\n"));

const bad = results.filter((r) => !r.bytes);
const all = VARIANTS.map((v) => {
  const f = join(OUT_DIR, fileName(v));
  const p = join(HIRES_DIR, `${v.n}.png`);
  return {
    file: f,
    bytes: existsSync(f) ? readFileSync(f).length : 0,
    pngBytes: existsSync(p) ? readFileSync(p).length : 0,
  };
});
const totalKB = Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024);
const missing = all.filter((f) => !f.bytes).map((f) => f.file);

console.log(`\n成功 ${results.length - bad.length}/${results.length} · 四张 webp 合计 ${totalKB}KB`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => `${b.n}-${b.id}`).join("、"));
if (missing.length) console.log("还缺：", missing.join("、"));
for (const f of all) {
  if (!f.bytes) continue;
  const flagKB = f.bytes > MAX_KB * 1024 ? `  ⚠ 超 ${MAX_KB}KB` : "";
  console.log(
    `   ${String(Math.round(f.bytes / 1024)).padStart(4)}KB  ${f.file}（PNG ${Math.round(f.pngBytes / 1024)}KB）${flagKB}`,
  );
}
// ★ --only 只出其中几张时，"别的那几张不存在"是正常的，不能据此让整轮判失败
//   （否则 --only=1 成功出图也退出 1，调用方以为失败、白重跑一遍又要花钱）。
if (bad.length || all.some((f) => f.bytes > MAX_KB * 1024) || (!only?.length && missing.length)) {
  process.exitCode = 1;
}
