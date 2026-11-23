// 工坊对局「风格卡」的**真实样张**（G2-c）。离线、脚本化、可复现。
//
// 用法（仓库根目录）：
//   node design/gen-style-samples.mjs              只补缺的（已有文件跳过）
//   node design/gen-style-samples.mjs --force      全部重出（换提示词 / 换模型之后）
//   node design/gen-style-samples.mjs --only=ink-wuxia,cultured  只重出点名的这几套
//   ARK_API_KEY=... node design/gen-style-samples.mjs           key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-style-samples.mjs      没装 ffmpeg 时点名
// 产物：public/styles/<id>.webp（512 宽、4:3，与 StylePick 卡的 aspect-[4/3] 对齐）
//
// ★ 为什么是「同一句话、只换风格」（docs/workshop-game-design.md §2.2）：
//   选风格那一屏要的是**能比较的三张图**。换了画面内容就没法比了 —— 三张各画各的，
//   玩家比较的是"哪张好看"而不是"这套风格长什么样"。所以 SCENE 一个字都不许按风格改。
// ★ 为什么是脚本而不是手工出图：8 套以后还会加（§2.2 写的是 6~10 套），手工出图的做法
//   在这里会退化成"没人记得当初那句提示词是什么"。提示词、尺寸、模型全写在这一个文件里，
//   删掉 public/styles/*.webp 重跑就是同一批图。
// ★ 为什么 key 从 .env.local 读（本仓惯例，铁律三：密钥只进 .env，永不入仓）：
//   ARK_API_KEY **不带 VITE_ 前缀**是刻意的（带了会被打进客户端包）。
//   server/.env 今天其实**没有**这一行（那边只有 VOLC_AK / VOLC_SK，是另一套鉴权），
//   所以查找顺序是：环境变量 → --env=<路径> → app/.env.local → ../server/.env。
//   读到就用，读不到就整句退出并说清去哪儿配。**任何情况下都不打印 key 本身**。
// ★ 为什么用 ffmpeg 而不是 sharp：这个仓库的一次性出图脚本历来走 IMGTOOLS 里的 sharp，
//   但那要额外装一份 40MB 的依赖；ffmpeg 在开发机上是现成的（android 出片那套也要它），
//   `-c:v libwebp` 就是同一个编码器。没有 ffmpeg 时脚本会明确告诉你去装或 `FFMPEG=` 点名。
//
// ── 体积（这是要打进 APK 的资源，不是截图）──
//   每张目标 ≤ 80KB，全部 ≤ 600KB。真机选风格那一屏三张卡只有 ~110px 宽，512 宽已经过采样；
//   出图 1536×1152 原图 2~4MB，**绝不入包**。超过 80KB 的那张会自动降质重编一次（WEBP_QUALITIES）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "styles");

// ────────────────────────────── 参数 ──────────────────────────────

/**
 * 出图模型：方舟 4.0 的继任型号（= src/data/economy.ts 的默认档「速写」那一个）。
 * ★ 不用更贵的 5.0 pro：样张成品只有 512px 宽，精绘多花的 3 倍单价在这个尺寸上看不出来。
 * ★ 不用 `doubao-seedream-5-0-260128`（老默认）：它在方舟第十批下线名单上（2026-11-24 14:00），
 *   这个脚本是要能重跑的，钉一个正在停服的型号等于让下一个人跑一次失败一次。
 */
const MODEL = "doubao-seedream-4-0-20260415";
/** 1536×1152 = 4:3、1,769,472 像素（4.0 的窗口是 ≥921,600 / ≤16,777,216） */
const SIZE = "1536x1152";
/** 成品宽（高按 4:3 出 384）；512 是"三张卡并排、真机 110px 宽"的上限再留一倍余量 */
const OUT_WIDTH = 512;
/** 80KB/张是硬上限；超了往下降质，不是往小裁（裁小图会更糊，降质只是多几个噪点） */
const MAX_KB = 80;
const MAX_TOTAL_KB = 600;
const WEBP_QUALITIES = [82, 72, 62, 52];

/**
 * **八套风格共用的那一句话**（§2.2「同一句话，不同风格」）。
 * ★ 这里刻意不写"少女"：方舟会把含未成年暗示的词整发 400 拒掉（AGENTS.md「方舟实测约束」）。
 *   也刻意只有一个人：一张图里画多个角色在方舟上一律被拒。
 * ★ 改成别的句子是允许的，但要整批重跑 —— 句式一改，8 张就不再是"同一句话"了，比较的前提就没了。
 */
const SCENE =
  "雨夜里，一个年轻女性在霓虹街头回头看向镜头，半身构图，神情平静，头发被雨打湿，" +
  "身后是湿漉漉反光的街面、模糊的行人与远处的霓虹招牌，画面中只有她一个人物。";
/** 每张都一样的收尾：构图与"别写字"（卡面会叠 UI，图上再出现字就脏了） */
const FRAME =
  "4:3 横构图，人物半身居中略偏右，面部清晰，皮肤与衣料有真实质感。" +
  "画面干净，没有文字、字母、数字、水印、边框、UI 元素、签名。";

// ────────────────────────────── 八套风格 ──────────────────────────────
// id 必须与 rules.STYLE_POOL 的 id、public/styles/<id>.webp 的文件名**三处一致**。
// `look` 是这一套的"技法 + 题材"在提示词里的说法；中文的技法名词 / 题材名在
// labels.ts（界面文案，走 Lingui），规则的英文占位在 rules.ts —— 那两处都不从这里读。
const STYLES = [
  {
    id: "cel-cyberpunk",
    look:
      "赛璐璐着色（cel-shading）＋三渲二（3D-to-2D）动画质感：硬边阴影、大色块平涂、清晰的黑线描边、" +
      "高饱和的青与品红霓虹，日本动画电影式的赛博朋克夜城。",
  },
  {
    id: "film-hk-neon",
    look:
      "胶片颗粒＋50mm 定焦浅景深：柯达胶片的细腻颗粒、柔和的高光溢出、大片圆形散景光斑、" +
      "青绿与品红交织的九十年代香港霓虹色调，王家卫式的潮湿夜雨氛围。",
  },
  {
    id: "fresco-renaissance",
    look:
      "文艺复兴湿壁画（buon fresco）：整幅画面就在一面教堂老墙上，颜料已经褪色、剥落、布满细密龟裂与斑驳的墙皮，" +
      "只用土黄、赭石、灰绿与灰蓝的矿物色，人物用平涂与淡彩勾勒成壁画里的圣像，金色背景光晕，" +
      "一束伦勃朗式强侧光只照亮半边脸，庄重的宗教奇幻绘画。画面是墙面的质感，不是摄影、不是油画。",
  },
  {
    id: "toon-wasteland",
    look:
      "3D 动画电影质感（三维卡通渲染，皮克斯那一类）：圆润的立体角色造型、夸张的头身比、次表面散射的通透皮肤、" +
      "体积光里飘着尘埃与雨丝，橙黄与铁锈色的末日废土——塌了一半的楼架、生锈的管道与废铁棚屋，霓虹招牌歪歪扭扭地挂在废墟上。",
  },
  {
    id: "ink-wuxia",
    look:
      "水墨写意：宣纸的纤维质感、浓淡墨色分层、飞白笔触与墨点、大片留白、" +
      "只在霓虹与人脸上点少量朱红，雾气与雨丝比人物更抢戏的武侠山水。",
  },
  {
    id: "picturebook-forest",
    look:
      "儿童绘本水彩：柔和的水彩晕染、暖黄与苔绿的配色、柔边勾线、纸张纤维纹理、" +
      "萤火虫般的光点飘在雨丝里，童话森林般的温柔光影。",
  },
  {
    id: "noir-alley",
    look:
      "硬派明暗对照（chiaroscuro）：近乎黑白的强烈明暗块面、湿地面上的长条反光、雾气与逆光剪影、" +
      "整幅画面只有一处红色是亮的，黑色电影式的压迫构图。",
  },
  {
    id: "gouache-seaside",
    look:
      "水粉画与柔粉色调：干湿笔触叠色、粉橘与薄荷绿的配色、松软的边缘、颗粒感纸面、" +
      "像夏天午后一样温柔的光，雨也画成斜斜的笔触。",
  },
];

// ────────────────────────────── key 与工具 ──────────────────────────────

const argv = process.argv.slice(2);
// ★ 认 `--force` / `--only=a,b` 这两种写法（别写成只认不带前缀的那种：第一次跑的时候就是这么错的，
//   结果 `--only=ink-wuxia` 静默变成了"全都出"，白花 7 张的钱，而那正是这个开关要省的东西）
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
    // server 仓与 app 仓是并列的两个目录（三仓关系见 AGENTS.md）；server 那边今天没有 ARK_API_KEY，
    // 留着这一格是为了"哪天搬过去"时脚本不用改
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
    // 客户端出图超时 170s（arkClient 那条），一次性脚本可以更宽：这里不等报价，只求别白跑
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  return j.data[0].url;
}

/** 下载 → ffmpeg 转 webp（超 80KB 就降质重编）→ 写进 public/styles/。回这一张的字节数 */
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
        // -2：高度按比例取最近的偶数（512×384）；webp 的 yuv420p 要偶数
        "-vf", `scale=${OUT_WIDTH}:-2:flags=lanczos`,
        "-frames:v", "1",
        "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6",
        outFile,
      ]);
      const size = readFileSync(outFile).length;
      best = { size, q };
      if (size <= MAX_KB * 1024) break;
    }
    if (!best || best.size > MAX_KB * 1024) throw new Error(`${Math.round(best?.size / 1024 ?? 0)}KB 降质后仍超 ${MAX_KB}KB`);
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

const only = opt("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const force = flag("force");
const todo = STYLES.filter((s) => (only?.length ? only.includes(s.id) : force || !existsSync(join(OUT_DIR, `${s.id}.webp`))));
if (todo.length === 0) {
  console.log(`8 套样张都在 ${OUT_DIR}（要重出：--force 或 --only=<id>）`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 尺寸 ${SIZE} → ${OUT_WIDTH}px webp · 本次出 ${todo.length}/${STYLES.length} 张`);
console.log(`同一句话：${SCENE.slice(0, 28)}…（8 套共用，详见文件头）`);

const tmpBase = join(tmpdir(), `style-sample-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (style) => {
  const prompt = `${SCENE}${style.look}${FRAME}`;
  try {
    const url = await seedream(prompt);
    const { bytes, quality } = await toWebp(url, `${tmpBase}-${style.id}`, join(OUT_DIR, `${style.id}.webp`));
    ok += 1;
    console.log(`   [${ok}/${todo.length}] ${style.id} · ${Math.round(bytes / 1024)}KB (q${quality})`);
    return { id: style.id, bytes };
  } catch (e) {
    console.log(`   ✗ ${style.id}: ${e instanceof Error ? e.message : e}`);
    return { id: style.id, bytes: 0, err: String(e) };
  }
});

// 全部 8 张一起核总量（--only 时也算上已有的），这才是要打进包的数字
const all = STYLES.map((s) => ({ id: s.id, bytes: existsSync(join(OUT_DIR, `${s.id}.webp`)) ? readFileSync(join(OUT_DIR, `${s.id}.webp`)).length : 0 }));
const totalKB = Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024);
const bad = results.filter((r) => !r.bytes);
const missing = all.filter((f) => !f.bytes).map((f) => f.id);
console.log(`\n成功 ${results.length - bad.length}/${results.length} · 8 套合计 ${totalKB}KB（上限 ${MAX_TOTAL_KB}KB）`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => b.id).join("、"));
if (missing.length) console.log("还缺：", missing.join("、"));
if (totalKB > MAX_TOTAL_KB) console.log(`⚠ 总量超了 ${totalKB - MAX_TOTAL_KB}KB：把某几张的 OUT_WIDTH 降到 448 重跑，别把 4K 原图塞进包`);
if (bad.length || missing.length || totalKB > MAX_TOTAL_KB) process.exitCode = 1;
