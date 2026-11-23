// 工坊对局「事件卡」的插画（G4 §5：卡面正中那块六边形图位）。离线、脚本化、可复现。
//
// 用法（仓库根目录）：
//   node design/gen-event-art.mjs                只补缺的（已有文件跳过）
//   node design/gen-event-art.mjs --force        全部重出（换提示词 / 换模型之后）
//   node design/gen-event-art.mjs --only=heal,double-shoot   只重出点名的这几张
//   ARK_API_KEY=... node design/gen-event-art.mjs              key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-event-art.mjs         没装 ffmpeg 时点名
// 产物：public/events/<选项 id>.webp（512×288、16:9，与卡面图位的比例对齐）
//
// ★ 为什么是**每个选项一张**（10 张），不是每个事件一张（3 张）：
//   事件屏上三张卡讲的是三件不同的事（画质升级 / 批量采购 / 金币大使），共用一张图
//   三张卡就长得一模一样，玩家扫读时只能读标题 —— 而参照图里那块图位正是"先认卡、再看字"。
//   所以 `rules.GAME_EVENTS[].options[].art` 一条一个文件，id 同时是文件名。
//   ★ 注意"三选一"是**选项数不是 3**：模型军备有 4 条（L2 / L3 两条升级线按档位与连胜
//     只出一条，见 rules.optionsForPlayer），另外两个事件各 3 条 ⇒ 4+3+3 = 10 张。
// ★ 为什么是脚本而不是手工出图：同 gen-style-samples.mjs —— 手工出图会退化成"没人记得当初
//   那句提示词是什么"。提示词、尺寸、模型全写在这一个文件里，删掉 public/events/*.webp
//   重跑就是同一批图。
// ★ 为什么 key 从 .env.local 读（本仓惯例，铁律三：密钥只进 .env，永不入仓）：
//   ARK_API_KEY **不带 VITE_ 前缀**是刻意的（带了会被打进客户端包）。查找顺序是
//   环境变量 → --env=<路径> → app/.env.local → ../server/.env。**任何情况下都不打印 key 本身**。
// ★ 为什么用 ffmpeg 而不是 sharp：同 gen-style-samples（不额外装 40MB 依赖，开发机上
//   ffmpeg 是现成的，`-c:v libwebp` 就是同一个编码器）。
//
// ── 风格基调（与 gen-style-samples.mjs 的样张同一套"写实 / 概念艺术"底子）──
//   同一段 STYLE 写死在这里、十张只换主体；暗背景 + 单主体居中 + 无文字。
//   ★ 为什么全是**物件**、没有人物：① 这块图在真机上只有 ~50 CSS px（六边形裁切），
//     人物的脸缩到这个尺寸只剩一团；② 方舟对含人物 / 未成年暗示的提示词会整发拒，
//     十张里混一张人脸就多一条会被拒的路。
//   ★ 为什么要求"主体落在画面正中"：六边形是近似正方形，512×288 的图会用 object-cover
//     从**中间**裁 —— 主体一旦铺满整个 16:9 宽度，两侧先被裁掉的就是主体本身。
//
// ── 体积（这是要打进 APK 的资源，不是截图）──
//   每张目标 ≤ 60KB，十张合计 ≤ 600KB（10 × 60KB 正好是上限，所以逐张卡死就等于合计达标）。
//   真机那张卡只有 232 CSS px 宽、图位 ~50px，512 宽已经过采样；出图 1536×864 原图
//   2~4MB，**绝不入包**。超过 60KB 的那张会自动降质重编一次（WEBP_QUALITIES）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "events");

// ────────────────────────────── 参数 ──────────────────────────────

/**
 * 出图模型：与 gen-style-samples.mjs 同一颗（方舟 4.0 的继任型号 = 默认档「速写」）。
 * ★ 不用 5.0 pro：成品只有 512×288，精绘多花的单价在这个尺寸上看不出来。
 * ★ 不用 `doubao-seedream-5-0-260128`（老默认）：它在方舟第十批下线名单上（2026-11-24 14:00）——
 *   这个脚本要能重跑，钉一个正在停服的型号等于让下一个人跑一次失败一次。
 */
const MODEL = "doubao-seedream-4-0-20260415";
/** 1536×864 = 16:9、1,327,104 像素（4.0 的窗口是 ≥921,600 / ≤16,777,216） */
const SIZE = "1536x864";
/** 成品宽 512（高按 16:9 出 288）：与卡面图位的比例对齐，真机 ~50px 也够锐 */
const OUT_WIDTH = 512;
/** 60KB/张是硬上限；超了往下降质，不是往小裁（裁小图会更糊，降质只是多几个噪点） */
const MAX_KB = 60;
const MAX_TOTAL_KB = 600;
const WEBP_QUALITIES = [82, 72, 62, 52, 44];

/**
 * **十张共用的那句风格基调**（与 gen-style-samples.mjs 的样张一致）。
 * ★ 只描述"怎么画"、不描述"画什么"：主体在下面 SUBJECTS 里，一个 id 一句。
 * ★ 改它是允许的，但要整批重跑（--force）—— 十张换一套底子，事件屏上才不会三张一个新调子。
 */
const STYLE =
  "电影级概念艺术（cinematic concept art）写实质感：体积光与空气中的尘埃、湿润表面的高光反射、" +
  "细腻的金属与皮革材质、深色背景里只有主体被一束光勾出轮廓，克制的青蓝与琥珀双色光，" +
  "像一张电影概念设定图，不是卡通、不是水彩、不是像素风。";
/** 每张都一样的收尾：构图与"别写字"（卡面会叠 UI，图上再出现字就脏了；图位还会被裁成六边形） */
const FRAME =
  "16:9 横构图。主体完整地落在画面**正中央**（中间那块正方形区域里），" +
  "四边全是压暗的背景与柔焦光点，不要把主体铺满整个画面宽度。" +
  "画面里没有任何人物，没有文字、字母、数字、水印、边框、UI 元素、签名。";

// ────────────────────────────── 十个选项（4 + 3 + 3） ──────────────────────────────
// id 必须与 rules.GAME_EVENTS[].options[].id、public/events/<id>.webp 的文件名**三处一致**。
// `subject` 是这一张"画什么"；中文名与收益那句话在 labels.ts（界面文案，走 Lingui），不从这里读。
const SUBJECTS = [
  // ── 模型军备（4 条，三选一里永远只有一条升级线在）──
  {
    id: "upgrade-draft",
    subject:
      "一台老式电影摄影机架在三脚架上，镜头里射出的一道光比周围更锐利清晰：" +
      "光束里悬浮着细小的胶片颗粒正被吸进镜头，机身上有一颗青蓝色的小指示灯刚刚亮起。",
  },
  {
    id: "upgrade-cinema",
    subject:
      "一台大型电影放映机立在暗处，两个巨大的金属胶片盘在它上方缓缓转动，" +
      "放映口喷出一道浓郁的金色光柱打到画面中央，光柱里浮着尘埃，机身是黄铜与黑铁的质感。",
  },
  {
    id: "half-next",
    subject:
      "一只敞开的木箱立在画面中央，箱里整整齐齐码着成摞的电影胶片盒与几卷捆好的胶片，" +
      "暖光从箱口内部打上来照亮最上面那一盒，箱盖靠在后方的木架上。",
  },
  {
    id: "free-gold",
    subject:
      "一只鼓鼓的皮质钱袋立在画面中央，袋口敞开、金币从袋口涌出来在脚边堆成一小堆，" +
      "袋身是深棕皮革与金色系带；金币上不要刻任何字符、字母或标志，只有浮雕的齿边与光。" +
      "金色高光与青蓝色反光撞在一起。",
  },
  // ── 灵感爆发（3 条）──
  {
    id: "double-shoot",
    subject:
      "两台电影摄影机并排架在同一条金属滑轨上、同时对准正前方，" +
      "两台镜头上都亮着红色的录制指示点，轨道下方是一小块被两束光同时照亮的暗红色地毯。",
  },
  {
    id: "long-prompt",
    subject:
      "一叠稿纸在画面中央摊开，纸页向上翻卷如浪，翻起的一端化成一道发光的墨蓝色光带冲进空中，" +
      "纸上只有不可辨认的笔迹线条，没有能读出内容的字。",
  },
  {
    id: "free-blue-card",
    subject:
      "一张发光的蓝色卡牌从上方翻转着落向画面中央，卡面是抽象的胶片齿孔与星形纹样，" +
      "边缘散出青蓝色的火星与细屑，卡牌下方是一小团被照亮的光晕。",
  },
  // ── 补给站（3 条）──
  {
    id: "bag-expand",
    subject:
      "一个敞开的复古皮质道具背包立在画面中央，包口张得很开、里面整齐插着一卷胶片、" +
      "一支老式话筒与一只亮着的老式灯泡，不要场记板之类会带字的道具，" +
      "黄铜锁扣被打开、搭在一旁，一道暖光从包口溢出来。",
  },
  {
    id: "heal",
    subject:
      "一只打开的金属医疗箱放在画面中央，箱盖内侧亮着一圈翡翠色的环形灯，" +
      "箱里立着一支发绿光的针剂和一卷绷带，甲板上落着几粒细小的绿色光点。",
  },
  {
    id: "free-refresh",
    subject:
      "两张深蓝色的票券在画面中央悬着、正要翻个面：正面朝里，朝外的只有纯色卡背，" +
      "卡背上印着一枚抽象星形徽记，四角没有任何字母、数字或花色符号（不是扑克牌）；" +
      "它们周围环着一道青蓝色的旋转箭头光轨，箭头由光点串成、没有实体，卡牌下缘还挂着未散尽的火星。",
  },
];

// ────────────────────────────── key 与工具 ──────────────────────────────

const argv = process.argv.slice(2);
// ★ 认 `--force` / `--only=a,b` 这两种写法（与 gen-style-samples 同一套参数；别写成只认不带前缀的 ——
//   那边第一次跑的时候就是这么错的，`--only=x` 静默变成了"全都出"，白花 7 张的钱）
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

/** 下载 → ffmpeg 转 webp（超 60KB 就降质重编）→ 写进 public/events/。回这一张的字节数 */
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
    if (!best || best.size > MAX_KB * 1024) throw new Error(`${Math.round(best?.size / 1024 ?? 0)}KB 降质后仍超 ${MAX_KB}KB`);
    return { bytes: best.size, quality: best.q };
  } finally {
    rmSync(src, { force: true });
  }
}

/** 并发 2 路：方舟同账号并发出图会 429（一次性脚本不抢 real.ts 那 3 路上限） */
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
const todo = SUBJECTS.filter((s) => (only?.length ? only.includes(s.id) : force || !existsSync(join(OUT_DIR, `${s.id}.webp`))));
if (todo.length === 0) {
  console.log(`10 张事件插画都在 ${OUT_DIR}（要重出：--force 或 --only=<id>）`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 尺寸 ${SIZE} → ${OUT_WIDTH}×288 webp · 本次出 ${todo.length}/${SUBJECTS.length} 张`);
console.log(`同一套风格底子：${STYLE.slice(0, 26)}…（10 张共用，详见文件头）`);

const tmpBase = join(tmpdir(), `event-art-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (item) => {
  const prompt = `${STYLE}${item.subject}${FRAME}`;
  try {
    const url = await seedream(prompt);
    const { bytes, quality } = await toWebp(url, `${tmpBase}-${item.id}`, join(OUT_DIR, `${item.id}.webp`));
    ok += 1;
    console.log(`   [${ok}/${todo.length}] ${item.id} · ${Math.round(bytes / 1024)}KB (q${quality})`);
    return { id: item.id, bytes };
  } catch (e) {
    console.log(`   ✗ ${item.id}: ${e instanceof Error ? e.message : e}`);
    return { id: item.id, bytes: 0, err: String(e) };
  }
});

// 十张一起核总量（--only 时也算上已有的），这才是要打进包的数字
const all = SUBJECTS.map((s) => ({
  id: s.id,
  bytes: existsSync(join(OUT_DIR, `${s.id}.webp`)) ? readFileSync(join(OUT_DIR, `${s.id}.webp`)).length : 0,
}));
const totalKB = Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024);
const bad = results.filter((r) => !r.bytes);
const missing = all.filter((f) => !f.bytes).map((f) => f.id);
const per = all.filter((f) => f.bytes).map((f) => `${f.id} ${Math.round(f.bytes / 1024)}KB`).join(" · ");
console.log(`\n成功 ${results.length - bad.length}/${results.length} · 10 张合计 ${totalKB}KB（上限 ${MAX_TOTAL_KB}KB）`);
if (per) console.log(`   ${per}`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => b.id).join("、"));
if (missing.length) console.log("还缺：", missing.join("、"));
if (totalKB > MAX_TOTAL_KB) console.log(`⚠ 总量超了 ${totalKB - MAX_TOTAL_KB}KB：降 MAX_KB 或缩 OUT_WIDTH 重跑，别把 4K 原图塞进包`);
if (bad.length || missing.length || totalKB > MAX_TOTAL_KB) process.exitCode = 1;
