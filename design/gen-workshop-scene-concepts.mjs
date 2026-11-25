// 工坊对局「横屏长桌」的 4 张**场景概念图**（A/B/C/D 四个美术方向，给主人挑）。
//
// 用法（仓库根目录 = app/）：
//   node design/gen-workshop-scene-concepts.mjs                      只补缺的（已有文件跳过）
//   node design/gen-workshop-scene-concepts.mjs --force              全部重出（换提示词 / 换模型之后）
//   node design/gen-workshop-scene-concepts.mjs --only=A,C           只重出点名的方向
//   node design/gen-workshop-scene-concepts.mjs --out=<目录>          改落盘目录（默认 design/workshop-scene-concepts）
//   ARK_API_KEY=... node design/gen-workshop-scene-concepts.mjs      key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-workshop-scene-concepts.mjs 没装 ffmpeg 时点名
//
// 产物：<out>/<A|B|C|D>.webp —— 512 宽、16:9（512×288），单张 ≤ 200KB。
// ★ 为什么不放进 public/：这四张是**给人看的候选**，不是 App 资源。进了 public/ 就会被打进
//   APK、被 CI 的体积检查盯上，而它们随时会被主人否掉重画。默认落 design/（离线素材区，
//   不参与构建），交付时再用 --out 指到仓库外的下载目录（本轮就是 Downloads 下那一份）。
//
// ★ 为什么是「同一句主场景描述、只换美术方向」（与 design/gen-style-samples.mjs 同一条纪律）：
//   要比的是"这套美术怎么重建这张桌子"，不是"哪张画得更热闹"。SCENE 一个字都不许按方向改，
//   否则四张就没法比。主场景 = 长桌在房间中央、桌上有卡牌与投影光、玩家一侧视角、暖光 + 品牌蓝。
// ★ 为什么横屏 16:9：工坊对局是横屏（G1，docs/g1-scene-plan.md），概念图要与真机取景一致，
//   1536×864 正好是 16:9、1,327,104 像素（4.0 的窗口 ≥921,600 / ≤16,777,216）。
// ★ 为什么 key 从 .env.local 读（铁律三：密钥只进 .env，永不入仓）：ARK_API_KEY **不带 VITE_ 前缀**
//   是刻意的（带了会被打进客户端包）。查找顺序：环境变量 → --env=<路径> → app/.env.local →
//   ../server/.env。读到就用，读不到整句退出并说清去哪儿配。**任何情况下都不打印 key 本身**。
// ★ 为什么用 ffmpeg 而不是 sharp：同 gen-style-samples.mjs —— 仓库的一次性出图脚本历来走
//   IMGTOOLS 里的 sharp，那要额外装 40MB 依赖；ffmpeg 在开发机上是现成的，`-c:v libwebp` 是同一个编码器。
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
 * ★ 也不用 5.0 pro：概念图只到 512px 宽，精绘多花 3 倍单价在这个尺寸上看不出来。
 */
const MODEL = "doubao-seedream-4-0-20260415";
/** 1536×864 = 16:9；与工坊横屏对局的取景比例一致 */
const SIZE = "1536x864";
/** 成品宽（高按 16:9 出 288）；512 是"四张并排一屏能看清"的尺寸 */
const OUT_WIDTH = 512;
/** 200KB/张 —— 这是给人看的图，不打包，所以不必像样张那样压到 80KB */
const MAX_KB = 200;
const WEBP_QUALITIES = [86, 80, 72, 64];

/**
 * **四个方向共用的那一句主场景描述**。
 * ★ 只写"桌上有什么、镜头在哪、光是什么"，不写画风 —— 画风在 VARIANTS[].look 里。
 * ★ 刻意写"画面中没有人"：人物这次的方案是**不重建人物**（工坊里角色是另外的模型/立绘），
 *   而方舟对多人物构图也容易拒图。
 */
const SCENE =
  "一张长桌摆在房间正中央，桌面上摆着卡牌与投影光，镜头在玩家一侧、略高于桌面看向桌面，" +
  "暖色主光从房间内侧打过来，另有一道品牌蓝的光作为点缀。画面中没有任何人物。";
/** 每张都一样的收尾：构图与"别写字"（概念图上叠字会干扰判断，真机上这些位置要放 UI） */
const FRAME =
  "16:9 横构图，水平视角、略带俯角看长桌，长桌是画面主体并占满中景。" +
  "画面干净，没有文字、字母、数字、水印、边框、UI 元素、签名。";

// ─────────────────────── 四个美术方向（id 同时是文件名） ───────────────────────
const VARIANTS = [
  {
    id: "A",
    name: "日系赛璐璐 · 温暖书店/图书馆",
    // 这套的"技法 + 题材"在提示词里的说法（不要写成一句话的评价，写成画法）
    look:
      "日系赛璐璐着色（cel-shading）＋三渲二动画质感：硬边阴影、大色块平涂、清晰的黑线描边，" +
      "题材是温暖的书店/图书馆房间——一整面到顶的书架、桌上的铜色台灯、脚下的厚地毯，" +
      "暖黄主光与窗外斜射进来的日光，蓝色只出现在台灯罩与地毯的一小块纹样上。",
  },
  {
    id: "B",
    name: "新海诚式光影 · 落地窗/城市夜景",
    look:
      "新海诚式动画电影光影：高饱和的青蓝与橙金色、镜头光晕与体积光束、云与城市灯火的细节，" +
      "题材是落地窗边的房间——窗外是夜色中的城市与点点灯火，玻璃上有反光与光斑，" +
      "室内暖光与窗外霓虹交织，品牌蓝来自窗外霓虹与桌上的投影光。",
  },
  {
    id: "C",
    name: "吉卜力式木质工坊 · 壁炉",
    look:
      "吉卜力式手绘动画质感：柔和的水彩背景、木纹与织物有手绘的笔触、暖褐色调、圆润的造型，" +
      "题材是木质工坊——外露的木梁与木地板、墙边的石砌壁炉、架上的小摆件与垂下来的绿植，" +
      "壁炉的橙光与台灯的暖光，品牌蓝是小摆件与地毯纹样上的点缀色。",
  },
  {
    id: "D",
    name: "赛博朋克阁楼 · 全息投影",
    look:
      "赛博朋克动画质感：暗调场景 + 高反差霓虹、金属与磨砂玻璃的材质、细密的线缆与格栅、" +
      "题材是阁楼改造的工作间——金属桌面的长桌、头顶垂下的线缆、桌上的全息投影与散落的卡牌，" +
      "主光是暖色的工作灯，品牌蓝是投影光与墙边灯带的主色，窗外是雨夜霓虹。",
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

const KEY = resolveKey();
if (!KEY) {
  console.error(
    "没有 ARK_API_KEY：环境变量 / --env=<路径> / app/.env.local / ../server/.env 都找过了。\n" +
      "  配法见 AGENTS.md 铁律三（密钥只进 .env，永不入仓、不入文档、不入日志）。",
  );
  process.exit(1);
}

const OUT_DIR = opt("out")
  ? isAbsolute(opt("out"))
    ? opt("out")
    : resolve(ROOT, opt("out"))
  : join(ROOT, "design", "workshop-scene-concepts");
const only = opt("only")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const force = flag("force");
const todo = VARIANTS.filter((v) => (only?.length ? only.includes(v.id) : force || !existsSync(join(OUT_DIR, `${v.id}.webp`))));
if (todo.length === 0) {
  console.log(`4 张概念图都在 ${OUT_DIR}（要重出：--force 或 --only=<A|B|C|D>）`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 尺寸 ${SIZE} → ${OUT_WIDTH}px webp · 本次出 ${todo.length}/${VARIANTS.length} 张`);
console.log(`落盘：${OUT_DIR}`);
console.log(`同一句主场景：${SCENE.slice(0, 30)}…（四个方向共用，详见文件头）`);

const tmpBase = join(tmpdir(), `workshop-scene-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (v) => {
  const prompt = `${SCENE}${v.look}${FRAME}`;
  try {
    const url = await seedream(prompt);
    const outFile = join(OUT_DIR, `${v.id}.webp`);
    const { bytes, quality } = await toWebp(url, `${tmpBase}-${v.id}`, outFile);
    ok += 1;
    console.log(`   [${ok}/${todo.length}] ${v.id} · ${v.name} · ${Math.round(bytes / 1024)}KB (q${quality})`);
    console.log(`         ${outFile}`);
    return { id: v.id, bytes, file: outFile, prompt };
  } catch (e) {
    console.log(`   ✗ ${v.id}: ${e instanceof Error ? e.message : e}`);
    return { id: v.id, bytes: 0, err: String(e) };
  }
});

// 把这一轮用到的提示词留一份在产物旁边：以后要改方向，先看这里当初到底写了什么
const manifest = join(OUT_DIR, "manifest.json");
const prior = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
const merged = { ...prior };
for (const r of results) if (r.prompt) merged[r.id] = { name: VARIANTS.find((v) => v.id === r.id).name, model: MODEL, size: SIZE, prompt: r.prompt };
writeFileSync(manifest, JSON.stringify(merged, null, 2));

const bad = results.filter((r) => !r.bytes);
console.log(`\n成功 ${results.length - bad.length}/${results.length}`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => b.id).join("、"));
for (const v of VARIANTS) {
  const f = join(OUT_DIR, `${v.id}.webp`);
  if (existsSync(f)) console.log(`   ${v.id} ${Math.round(readFileSync(f).length / 1024)}KB  ${f}`);
}
if (bad.length) process.exitCode = 1;
