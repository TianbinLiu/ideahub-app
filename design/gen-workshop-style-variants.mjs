// 工坊对局「横屏长桌」场景的 **6 种动漫画风变体**（同一张场景，只换画风，给主人挑最终画风）。
//
// 用法（仓库根目录 = app/）：
//   node design/gen-workshop-style-variants.mjs                      只补缺的（已有文件跳过）
//   node design/gen-workshop-style-variants.mjs --force              全部重出（换提示词 / 换模型之后）
//   node design/gen-workshop-style-variants.mjs --only=2,ufotable    只重出点名的这几张（序号或 id 都认）
//   node design/gen-workshop-style-variants.mjs --out=<目录>          改落盘目录
//   node design/gen-workshop-style-variants.mjs --dry                只打印六条提示词，不出图、不花钱
//   ARK_API_KEY=... node design/gen-workshop-style-variants.mjs      key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-workshop-style-variants.mjs 没装 ffmpeg 时点名
//
// 产物：<out>/1-shinkai.webp … 6-thickpaint.webp —— 512 宽、16:9（512×288），单张 ≤ 200KB，六张合计 ≤ 1.5MB。
//
// ★ 为什么不写进仓库（这是本轮最硬的一条）：这六张是**给人挑的候选**，随时会被否掉重画；
//   进了 public/ 就会被打进 APK、被 CI 的体积检查盯上。所以**默认落点就在仓库外**
//   （~/Downloads/workshop-style-variants），交付时用 --out 指到要交的目录 —— 哪怕忘了传 --out，
//   仓库里也一张图都不会多出来（与 design/gen-workshop-scene-concepts.mjs 默认落 design/ 刻意不同：
//   那个目录在这个仓库里已经存在且是离线素材区，本脚本没有"仓库内的家"）。
//
// ★ 为什么是「同一句场景、只换画风」（与 design/gen-style-samples.mjs 同一条纪律）：
//   要比的是"这套画风怎么重建这张桌子"，不是"哪张画得更热闹"。SCENE 一个字都不许按画风改。
// ★ 为什么横屏 16:9：工坊对局是横屏（G1，docs/g1-scene-plan.md），与真机取景一致，
//   1536×864 正好是 16:9、1,327,104 像素（4.0 的窗口 ≥921,600 / ≤16,777,216）。
// ★ 为什么 key 从 .env.local 读（铁律三：密钥只进 .env，永不入仓）：ARK_API_KEY **不带 VITE_ 前缀**
//   是刻意的（带了会被打进客户端包）。查找顺序：环境变量 → --env=<路径> → app/.env.local →
//   ../server/.env。读到就用，读不到整句退出并说清去哪儿配。**任何情况下都不打印 key 本身**。
// ★ 为什么用 ffmpeg 而不是 sharp：与仓库其他一次性出图脚本一致 —— ffmpeg 在开发机上是现成的，
//   `-c:v libwebp` 是同一个编码器，不必为几张图装一份 40MB 的 sharp。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ────────────────────────────── 参数 ──────────────────────────────

/**
 * 出图模型：方舟 4.0 的继任型号（= src/data/economy.ts 的默认档「速写」那一个）。
 * ★ 不钉 `doubao-seedream-5-0-260128`：它在方舟第十批下线名单上，脚本要能重跑。
 * ★ 也不用 5.0 pro：候选图只到 512px 宽，精绘多花 3 倍单价在这个尺寸上看不出来。
 */
const MODEL = "doubao-seedream-4-0-20260415";
/** 1536×864 = 16:9；与工坊横屏对局的取景比例一致 */
const SIZE = "1536x864";
/** 成品宽（高按 16:9 出 288）；512 是"六张在图库里并排能看清"的尺寸 */
const OUT_WIDTH = 512;
/** 200KB/张 —— 这是给人看的图，不打包，所以不必像 App 资源那样压到 80KB */
const MAX_KB = 200;
/** 六张合计 ≤ 1.5MB（要求原文；1536KB 就是 1.5MiB） */
const MAX_TOTAL_KB = 1536;
const WEBP_QUALITIES = [88, 82, 76, 68, 60];

/**
 * **六张共用的那一句场景描述**（主人给的原句，**逐字不改**）。
 * ★ 改成别的句子当然也行，但要整批重跑 —— 一改，六张就不再是"同一张场景"，比较的前提就没了。
 * ★ 只写"桌上有什么、镜头在哪、光是什么"，画风一个字都不许进来（画风在 VARIANTS[].look）。
 */
const SCENE =
  "一张横屏长桌摆在木质工坊正中央，桌面上散着几张卡牌与一块浮起的投影光幕，" +
  "桌边有四把椅子，背后是石墙与木梁、壁炉、书架、绿植与小摆件，玩家一侧略微俯视，暖光，点缀品牌蓝。";
/**
 * 每张都一样的收尾：取景 + "别写字" + "没有人"。
 * ★ `画面中没有任何人物` 是刻意的：工坊里角色是另外的模型/立绘，而方舟对多人物构图容易拒图。
 * ★ `没有文字/字母/数字…`：概念图上要叠 UI，图上自带字会干扰判断。
 */
const FRAME =
  "16:9 横构图，水平视角、略高一点的俯角看长桌，长桌是画面主体并占满中景，桌边四把椅子完整可辨。" +
  "画面干净，没有文字、字母、数字、水印、边框、UI 元素、签名。画面中没有任何人物。";

// ─────────────────────── 六种画风（序号 + id 同时是文件名） ───────────────────────
const VARIANTS = [
  {
    id: "shinkai",
    name: "新海诚",
    // `look` 写"技法"而不是"评价"：这句是喂给模型的画风段，其余全同
    look:
      "Makoto Shinkai 风格（新海诚式动画电影光影）：高饱和的天空光与体积光束、镜头光晕与光斑、" +
      "极细致的云与水汽、柔和的整体辉光、通透的空气感、细腻到每块材质都像背景美术的笔触；" +
      "室内暖光被窗光与柱状光束切成层次，蓝色作为点缀色出现在投影光幕与空气里的细小光点上。",
  },
  {
    id: "ghibli",
    name: "吉卜力",
    // ★ 末尾那两句「不是写实油画、不是摄影」是重出第 2 次才加的：不加时这一路会往写实油画跑
    look:
      "Studio Ghibli 风格（吉卜力式手绘动画）：水彩质感的背景美术、柔和自然的日光与壁炉火光、" +
      "手绘笔触与颜料颗粒感、温润的褐绿配色、生活化的细节与暖意——木头有年久的磕碰、" +
      "书架塞得满满当当、绿植与摆件随意而有生活气。画面是手绘动画的背景美术，不是写实油画、不是摄影。",
  },
  {
    id: "kyoani",
    name: "京阿尼",
    // ★ 末尾两句「不是三维游戏场景、不是等距视角」是重出第 2 次才加的：不加时这一路会画成
    //   干净到发硬的等距三维游戏背景（线条、空气感全丢），与京阿尼那种二维手绘背景美术差得很远
    look:
      "Kyoto Animation 风格（京阿尼式二维手绘动画背景美术）：柔和的渐变与细腻的笔触、克制的细线描边、" +
      "柔和的高光与浅景深、通透的光与空气感，木纹、石墙的砌缝、纸张与布料的毛边画得一丝不苟；" +
      "整体明亮清爽、有安静的生活气息。这是二维手绘动画的背景画，不是三维游戏场景、不是等距视角游戏美术。",
  },
  {
    id: "ufotable",
    name: "ufotable",
    // ★ 光效这一段写足了就不容易只是"变暗"；但重出时最容易翻车的也是这里（光幕高光糊成一片白）
    look:
      "ufotable 风格（厚重后期光效的动画电影）：强烈的明暗对比与电影级调色、体积光与粒子尘埃/火星在空气里翻涌、" +
      "投影光幕发出高亮的辉光与光晕、暗部压得很深而高光很亮、细节密集、带一点厚涂的笔触感，整体厚重而有张力。",
  },
  {
    id: "cel90s",
    name: "90 年代赛璐璐",
    look:
      "90 年代赛璐璐动画质感：平涂色块、硬边阴影、清晰的黑线描边、有限的配色数、" +
      "轻微胶片颗粒与偏暖的色偏、复古电视动画的质感与构图（对比度不像现代动画那么高）。" +
      "画面是九十年代电视动画的赛璐璐画风格，不是现代厚涂插画。",
  },
  {
    id: "thickpaint",
    name: "现代日系厚涂",
    look:
      "现代日系厚涂插画（Pixiv 插画风）：厚涂笔触、丰富的材质与笔刷纹理、强氛围光与明显的光色反差、" +
      "插画感的构图与景深，色彩浓郁、笔触可见，像一张精心绘制的商业插画。",
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

/** 出一次文生图，回图片 URL。参数与 src/ai/arkClient.generateImage 同一份协议 */
async function seedream(prompt) {
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, prompt, size: SIZE, response_format: "url", watermark: false }),
    // 客户端出图超时 170s（arkClient 那条），一次性脚本给到 180s：只求别白跑
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  return j.data[0].url;
}

/** 下载 → ffmpeg 转 webp（超 200KB 就降质重编）→ 落盘。回这一张的字节数 */
async function toWebp(url, tmpBase, outFile) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`下载出图 ${r.status}`);
  const src = `${tmpBase}.src`;
  writeFileSync(src, Buffer.from(await r.arrayBuffer()));
  try {
    let best = null;
    for (const q of WEBP_QUALITIES) {
      await run(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-i", src,
        // -2：高度按比例取最近的偶数（512×288）；webp 的 yuv420p 要偶数
        "-vf", `scale=${OUT_WIDTH}:-2:flags=lanczos`,
        "-frames:v", "1",
        "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6",
        outFile,
      ]);
      const size = readFileSync(outFile).length;
      best = { size, q };
      if (size <= MAX_KB * 1024) break;
    }
    if (!best || best.size > MAX_KB * 1024) {
      throw new Error(`${Math.round(best?.size / 1024 ?? 0)}KB 降质后仍超 ${MAX_KB}KB`);
    }
    return { bytes: best.size, quality: best.q };
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

/** 文件名 = 序号-id.webp（序号就是主人挑画风时说的"第几张"） */
VARIANTS.forEach((v, i) => (v.n = i + 1));
const fileName = (v) => `${v.n}-${v.id}.webp`;

const OUT_DIR = opt("out")
  ? isAbsolute(opt("out"))
    ? opt("out")
    : resolve(ROOT, opt("out"))
  : join(homedir(), "Downloads", "workshop-style-variants");

if (flag("dry")) {
  // 只打印提示词：核"六张是不是只换了画风那一段"最省事的方式，也是重出前留证的办法
  console.log(`模型 ${MODEL} · 尺寸 ${SIZE} · ${VARIANTS.length} 张 · 落盘 ${OUT_DIR}\n`);
  for (const v of VARIANTS) {
    console.log(`── ${fileName(v)}（${v.name}）`);
    console.log(`${SCENE}${v.look}${FRAME}\n`);
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

// --only 认序号（1..6）也认 id，大小写不敏感
const only = opt("only")
  ?.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const force = flag("force");
const todo = VARIANTS.filter((v) =>
  only?.length ? only.includes(v.id) || only.includes(String(v.n)) : force || !existsSync(join(OUT_DIR, fileName(v))),
);
if (todo.length === 0) {
  console.log(`6 张都在 ${OUT_DIR}（要重出：--force 或 --only=<1..6|id>）`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 尺寸 ${SIZE} → ${OUT_WIDTH}px webp · 本次出 ${todo.length}/${VARIANTS.length} 张`);
console.log(`落盘：${OUT_DIR}`);
console.log(`同一句场景：${SCENE.slice(0, 30)}…（六张共用，详见文件头）`);

const tmpBase = join(tmpdir(), `workshop-style-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (v) => {
  const prompt = `${SCENE}${v.look}${FRAME}`;
  try {
    const url = await seedream(prompt);
    const outFile = join(OUT_DIR, fileName(v));
    const { bytes, quality } = await toWebp(url, `${tmpBase}-${v.id}`, outFile);
    ok += 1;
    console.log(`   [${ok}/${todo.length}] ${fileName(v)} · ${v.name} · ${Math.round(bytes / 1024)}KB (q${quality})`);
    return { id: v.id, bytes, file: outFile, prompt };
  } catch (e) {
    console.log(`   ✗ ${fileName(v)}: ${e instanceof Error ? e.message : e}`);
    return { id: v.id, bytes: 0, err: String(e) };
  }
});

// 把这一轮用到的提示词留一份在产物旁边：以后要改画风，先看这里当初到底写了什么
const manifest = join(OUT_DIR, "manifest.json");
const prior = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
const merged = { ...prior, _model: MODEL, _size: SIZE, _scene: SCENE, _frame: FRAME };
for (const r of results) {
  if (r.prompt) merged[r.id] = { n: VARIANTS.find((v) => v.id === r.id).n, name: VARIANTS.find((v) => v.id === r.id).name, file: fileName(VARIANTS.find((v) => v.id === r.id)), prompt: r.prompt };
}
writeFileSync(manifest, JSON.stringify(merged, null, 2));

const bad = results.filter((r) => !r.bytes);
const all = VARIANTS.map((v) => {
  const f = join(OUT_DIR, fileName(v));
  return { file: f, bytes: existsSync(f) ? readFileSync(f).length : 0 };
});
const totalKB = Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024);
const missing = all.filter((f) => !f.bytes).map((f) => f.file);

console.log(`\n成功 ${results.length - bad.length}/${results.length} · 六张合计 ${totalKB}KB（上限 ${MAX_TOTAL_KB}KB）`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => b.id).join("、"));
if (missing.length) console.log("还缺：", missing.join("、"));
for (const f of all) {
  if (!f.bytes) continue;
  const flagKB = f.bytes > MAX_KB * 1024 ? `  ⚠ 超 ${MAX_KB}KB` : "";
  console.log(`   ${String(Math.round(f.bytes / 1024)).padStart(4)}KB  ${f.file}${flagKB}`);
}
if (totalKB > MAX_TOTAL_KB) console.log(`⚠ 合计超了 ${totalKB - MAX_TOTAL_KB}KB（上限 ${MAX_TOTAL_KB}KB）`);
if (bad.length || missing.length || totalKB > MAX_TOTAL_KB || all.some((f) => f.bytes > MAX_KB * 1024)) process.exitCode = 1;
