// 工坊「魔女阁楼」夜景的 **5 档动漫强度**高细节概念图（方舟 Seedream 5.0 pro · 2560×1440）。
//
// 上一轮 design/gen-workshop-night-concepts.mjs 的 1536×864「夜间满月」六张，主人连看几版都嫌
// 「没细节、像草稿」。这一轮换的是**出图这一侧**的三件事，构图方向沿用已定的那一版：
//   · 模型换成方舟 **Seedream 5.0 pro**（细节量比 4.0 高一档；代价是 ~0.6 元/张、一张近百秒）；
//   · 画布从 1536×864 提到 **2560×1440**（5.0-pro 的像素窗口 [921,600, 4,624,220]，
//     2K 落在窗口里；退路 2048×1152 见 SIZE / FALLBACK_SIZE）；
//   · 提示词**不许**再出现 flat colors / hard-edged shadows / 2-3 tone shading / no gradients /
//     cel shaded / no 3d render 这类「压细节」的词 —— 上一版正是被它们画成草稿的（那些词对
//     「平涂感」有效、对「细节」是反向的）。改成正向堆细节（DETAIL 段），画风只留
//     anime background art / illustration + not a photograph 一条。
//
// 同一间屋子、同一个夜、同一束冷光，五张只改**动漫强度**这一维，为的是回答一个问题：
// 「细节够」与「最像动漫」在哪一档同时成立。
//
// 用法（仓库根目录 = app/）：
//   node design/gen-workshop-seedream-detail.mjs                      只补缺的（已有文件跳过）
//   node design/gen-workshop-seedream-detail.mjs --force              五张全部重出
//   node design/gen-workshop-seedream-detail.mjs --only=2,cel         只重出点名的（序号或 id 都认）
//   node design/gen-workshop-seedream-detail.mjs --out=<目录>          改落盘目录
//   node design/gen-workshop-seedream-detail.mjs --dry                只打印五条提示词，不出图、不花钱
//   node design/gen-workshop-seedream-detail.mjs --size=2048x1152     跳过首选尺寸直接出退路尺寸
//   ARK_API_KEY=... node design/gen-workshop-seedream-detail.mjs      key 也可以从环境变量给
//   FFMPEG=<ffmpeg 路径> node design/gen-workshop-seedream-detail.mjs 没装 ffmpeg 时点名
//
// 产物（默认落仓库外 ~/Downloads/workshop-seedream-detail）：
//   <out>/1.webp … 5.webp          2560×1440、单张 ≤400KB（交付要求）
//   <out>/hires/1.png … 5.png       同一张的 2560×1440 无损 PNG（压缩前的母版，webp 只用来交付）
//   <out>/manifest.json             这一轮每张实际用的提示词与尺寸
//   <out>/notes.md                  五档提示词全文（已存在就不覆盖：自查结论要能活着）
//
// ★ 为什么模型钉 `doubao-seedream-5-0-pro-260628`：它就是 src/data/economy.ts 的
//   IMAGE_TIERS「精绘」那一档，全仓唯一还在用的 5.0-pro 型号。**不要**再发
//   `doubao-seedream-5-0-260128`（5.0 Lite，方舟第十批下线名单 2026-11-24 14:00）——
//   理由与实测耗时（~96s/张 @1728×2304）都记在 economy.ts 那两段 ★ 里。
// ★ 为什么 2560×1440：16:9、与工坊横屏对局的取景比例一致；3,686,400 像素落在 5.0-pro
//   的窗口 [921,600, 4,624,220] 里（窗口是 2026-08-11 拿真 key 探出来的，见
//   src/ai/arkClient.ts generateImage 的注释）。**别照 4.5/5.0 的下限 3,686,400 去挑尺寸**
//   再往上加——pro 的上限是 4,624,220，撞穿就是整张 400。
// ★ 为什么 webp 想压到 ≤400KB 要一路降到 q40 附近：3.7M 像素的细节图在同样质量下比
//   「干净平涂」大一倍，交付又卡死 400KB。留 hires/ 的 PNG 就是为了不把「交付压缩损失」
//   当成出图质量来评。
// ★ 为什么 key 从 .env.local 读（铁律三：密钥只进 .env，永不入仓）：ARK_API_KEY **不带
//   VITE_ 前缀**是刻意的（带了会被打进客户端包）。查找顺序：环境变量 → --env=<路径> →
//   app/.env.local → ../server/.env。读到就用，读不到整句退出并说清去哪儿配。
//   **任何情况下都不打印 key 本身。**
// ★ 为什么默认落到仓库外：这是给人挑的候选，随时会被否掉重画；进 public/ 会被打进 APK、
//   被 CI 的体积检查盯上。同一份纪律见 design/gen-workshop-night-concepts.mjs 头部。
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
/** 降质阶梯：从高往低试，第一档就过就停。3.7M 像素的细节图一般要落到 q50~q60 */
const QUALITIES = [92, 86, 80, 74, 68, 64, 60, 56, 52, 48, 44, 40, 36];

/**
 * **五张共用的场景段**（逐字共用，一个字都不按档改）。
 * ★ 窗：正对面、小、圆、**毛玻璃**——冷光漫射；玻璃不透明，所以「窗外没有月亮/星空」
 *   靠「看不见外面」实现，比写两遍 "no moon" 更稳（模型对"看不见"比"没有"敏感）。
 * ★ 「只有这一扇窗」「屋顶实心，没有天窗」「没有月亮/星空意象」这三句是第二轮补的：
 *   第一轮 2 号屋顶长出两扇天窗、窗外还是星空（违背"窗外不要星空"），4 号圆窗画成辐条花格，
 *   5 号壁炉上方挂了一幅月亮小画。三处都不是画风问题，是场景没把「唯一一扇窗」说死 ——
 *   这类约束一律写进 BASE，五张逐字共用。
 * ★ 壁炉：主人点名**火必须熄灭**。不逐项点名，模型一定给炉膛里添一团火（上一版的血泪）。
 * ★ 桌面：同样是逐项点名禁掉。「空的」这两个字模型基本不认。
 * ★ 别在这里写任何画风词：五档的差别只在 TIERS[].style，BASE 一旦带风格，五档就不成对比。
 */
const BASE =
  "Night-time interior of a witch's attic workshop under a steep sloped roof, heavy dark wooden rafters and exposed beams crossing the ceiling. " +
  "Set into the far wall, directly facing the camera, is one small round window of frosted glass: the glass is milky and translucent, glowing with cold pale blue-white diffused light; nothing can be seen through it — no moon, no stars, no night sky, no landscape, no silhouettes outside. " +
  "The pane is a single smooth sheet of old frosted glass — no muntins, no spokes, no leaded grid. " +
  "This is the only window in the room: the roof and the other walls are solid dark wood and plaster — no skylights, no roof windows, no glass roof, no open sky visible anywhere. " +
  "No moon imagery anywhere: no moon in the sky, no moon-shaped ornament, no crescent or full-moon painting on the walls. " +
  "On the left side of the room stands a stone fireplace whose fire is completely extinguished: the firebox is a cold black empty void with grey ash and soot-blackened stone; no fire, no flames, no glowing coals, no embers, no orange glow, no smoke, no warmth. " +
  "In the centre of the room, a long dark wooden table with carved turned legs and an embroidered table runner; the tabletop is completely empty — nothing is placed on it: no books, no papers, no quills, no candles, no cups, no jars, no tools, no cards, no bowls; only the embroidered runner, the bare wood grain and the cold window light on the wood. " +
  "Two empty carved wooden chairs stand at the table. No people, no human figures, no silhouettes anywhere in the room. " +
  "Bookshelves cover the walls, packed with books whose individual spines are clearly separated — leather spines, gold tooling, cracked gilt lettering, worn edges. " +
  "An old star chart / celestial map hangs on the wall beside a brass armillary sphere on a wooden stand. " +
  "Stacks of loose handwritten manuscripts and rolled scrolls lie on the shelves and on the floor, away from the table. " +
  "A few glass specimen jars holding dried flowers and dried herbs stand on the shelves. " +
  "Wide old wooden floorboards with visible grain and cracks. " +
  "The only light in the room is the cold pale light diffusing through the round frosted window; the corners away from it sink into deep cold shadow. No lamps, no lanterns, no candles, no chandeliers, no glowing screens.";

/**
 * **正向堆细节段**（这一轮的核心改动）。
 * ★ 这些词是「涨细节」的那一半：hand-painted / intricate textures / visible wood grain /
 *   cracked plaster / individual book spines / dust motes / fine lineart / rich subtle shading /
 *   sharp focus。删掉哪一条，细节就掉一档。
 * ★ 这里**不写**任何「不是…」——否定的细节词（no gradients / no 3d render 之类）会顺带把
 *   材质与光影一起压平，上一版就是那么变成草稿的。
 */
const DETAIL =
  "Highly detailed hand-painted background art, intricate textures, visible wood grain, cracked plaster, individual book spines, dust motes, fine lineart, rich subtle shading, sharp focus. " +
  "Fine dust motes float in the cold air and catch the light. ";

/**
 * 画风钉死的那一句：风格词只用 anime background art / illustration，保留 not a photograph 一条。
 * ★ 不再写 cel shaded / flat colors / no gradients —— 那是「压细节」的方向，五档的赛璐璐感
 *   由 TIERS[3].style 单独说，并且要同时把细节焊住。
 */
const STYLE_FIXED = "This is anime background art / illustration, not a photograph. ";

/**
 * 取景收尾（五张共用）。
 * ★ 镜头在长桌近端、略高于桌面、正对圆窗 —— 桌面、壁炉（左）、书架（右/后）一屏都在。
 * ★ 画面里没有人是硬的：之后要叠 App 自己的 3D 角色；自带人影在高斯重建里撕不掉。
 */
const FRAME =
  "16:9 horizontal widescreen composition, camera at the near end of the long table, slightly above tabletop height, looking across the empty table toward the round frosted window: the table runs through the centre of the frame, the fireplace on the left, the bookshelves on the right and behind. " +
  "No text, no letters, no numbers, no watermark, no border, no signature, no UI.";

// ───────────────────── 五档「动漫强度」（序号 + id 同时是 --only 的认法） ─────────────────────
// ★ style 只写「这一档比别的多/少多少动漫感」，场景、光、陈设一个字都不许改。
// ★ 第 4 档（赛璐璐）最险：平涂天然会丢细节，所以那一句末尾必须把「细节不许简化」焊回去。
const TIERS = [
  {
    id: "detail-light",
    name: "细节优先·轻动漫",
    style:
      "Stylization: minimal and restrained — a finely painted concept image with only a light anime touch: believable perspective, extremely detailed surfaces, delicate fine lineart and softly painted shading; the anime feeling comes from the clean line work and the idealized cold light, not from simplification.",
  },
  {
    id: "detail-mid",
    name: "细节优先·中动漫",
    style:
      "Stylization: moderate anime illustration — clean confident lineart over a detailed painted surface, gently simplified edges, rich subtle shading; the props and textures stay fully detailed.",
  },
  {
    id: "anime-bg",
    name: "动漫背景美术（新海诚式细节）",
    style:
      "Stylization: meticulous modern Japanese animated feature film background art — finely observed, luminous, delicate fine lineart, rich subtle shading, cold atmospheric light and crisp focus, painted like a patient background plate.",
  },
  {
    id: "cel",
    name: "明显赛璐璐（平涂不丢细节）",
    style:
      "Stylization: clear cel-animation look — clean flat colour areas and crisp graphic shapes, yet the detail level stays high: intricate linework, individual book spines, carved wood, embroidery, cracks and wood grain are all still drawn; do not simplify, soften or blur the textures.",
  },
  {
    id: "stylized",
    name: "强风格化动漫（细节掉一档）",
    style:
      "Stylization: bold strongly stylized anime illustration — expressive shapes, graphic colour blocking, a more decorative and simplified look; texture detail may drop a level but the room, its props and the cold light stay readable and rich.",
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

TIERS.forEach((t, i) => (t.n = i + 1));
/** 文件名就是序号：主人说"第几张"时不用再对一遍 id */
const fileName = (t) => `${t.n}.webp`;
const promptOf = (t) => `${BASE}${DETAIL}${STYLE_FIXED}${t.style}${FRAME}`;

const OUT_DIR = opt("out")
  ? isAbsolute(opt("out"))
    ? opt("out")
    : resolve(ROOT, opt("out"))
  : join(homedir(), "Downloads", "workshop-seedream-detail");
const HIRES_DIR = join(OUT_DIR, "hires");

const SIZE_OVERRIDE = opt("size") ?? SIZE;
parseSize(SIZE_OVERRIDE); // 早退：写法错了不该等到花了钱才发现

if (flag("dry")) {
  // 只打印提示词：核"五张是不是只差动漫强度"最省事的方式，也是重出前留证的办法
  console.log(`模型 ${MODEL} · 首选尺寸 ${SIZE}（退路 ${FALLBACK_SIZE}）· ${TIERS.length} 张 · 落盘 ${OUT_DIR}\n`);
  for (const t of TIERS) {
    console.log(`── ${fileName(t)}（${t.name}）`);
    console.log(promptOf(t));
    console.log(`[动漫强度句] ${t.style}\n`);
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

// --only 认序号（1..5）也认 id，大小写不敏感
const only = opt("only")
  ?.split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const force = flag("force");
const todo = TIERS.filter((t) =>
  only?.length
    ? only.includes(t.id) || only.includes(String(t.n))
    : force || !existsSync(join(OUT_DIR, fileName(t))),
);
if (todo.length === 0) {
  // ★ 两种"没活干"要分开说：--only 没认出来时不能文不对题地说"五张都在"
  const absent = TIERS.filter((t) => !existsSync(join(OUT_DIR, fileName(t))));
  console.log(
    absent.length
      ? `--only 没选中任何一张（认序号 1..5 或 id：${TIERS.map((t) => t.id).join(" / ")}）`
      : `5 张都在 ${OUT_DIR}（要重出：--force 或 --only=<1..5|id>）`,
  );
  process.exit(0);
}

mkdirSync(HIRES_DIR, { recursive: true });
console.log(`模型 ${MODEL} · 画布 ${SIZE_OVERRIDE}（退路 ${FALLBACK_SIZE}）· 交付 webp ≤${MAX_KB}KB + hires PNG`);
console.log(`本次出 ${todo.length}/${TIERS.length} 张 → ${OUT_DIR}`);

const tmpBase = join(tmpdir(), `workshop-seedream-detail-${process.pid}`);
let ok = 0;
const results = await mapLimit(todo, 2, async (t) => {
  const prompt = promptOf(t);
  try {
    const { url, size } = await seedreamRetry(prompt, SIZE_OVERRIDE);
    const fullFile = join(OUT_DIR, fileName(t));
    const pngFile = join(HIRES_DIR, `${t.n}.png`);
    const { full, png } = await toDeliverables(url, `${tmpBase}-${t.id}`, pngFile, fullFile, size);
    ok += 1;
    console.log(
      `   [${ok}/${todo.length}] ${fileName(t)} · ${t.name} · ${size} · webp ${Math.round(full.bytes / 1024)}KB (q${full.quality})` +
        ` · PNG ${Math.round(png / 1024)}KB`,
    );
    return { ...t, size, bytes: full.bytes, pngBytes: png, file: fullFile, pngFile, prompt };
  } catch (e) {
    console.log(`   ✗ ${fileName(t)}: ${e instanceof Error ? e.message : e}`);
    return { ...t, size: SIZE_OVERRIDE, bytes: 0, err: String(e) };
  }
});

// 把这一轮用到的提示词与**实际**画布留一份在产物旁边：以后要改，先看这里当初到底写了什么
const manifest = join(OUT_DIR, "manifest.json");
const prior = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};
const merged = { ...prior, _model: MODEL, _size: SIZE, _fallbackSize: FALLBACK_SIZE, _base: BASE, _detail: DETAIL, _styleFixed: STYLE_FIXED, _frame: FRAME };
for (const r of results) {
  if (!r.prompt) continue;
  merged[r.id] = { n: r.n, name: r.name, file: fileName(r), size: r.size, style: r.style, prompt: r.prompt };
}
writeFileSync(manifest, JSON.stringify(merged, null, 2));

// notes.md 草稿：五档提示词全文（自查结论由出图那一轮补在下面）。
// ★ 已存在就不覆盖：这份 notes 里记着逐张的自查结论（出图的人写的），重跑脚本不该把它冲掉。
const notesFile = join(OUT_DIR, "notes.md");
const notesBody = [
  "# 工坊夜间魔女阁楼 · Seedream 5.0 pro 高细节 · 五档动漫强度",
  "",
  `- 模型：\`${MODEL}\`（方舟 Seedream 5.0 pro）· 首选 ${SIZE}（退路 ${FALLBACK_SIZE}）`,
  `- 交付：webp 2560×1440 ≤${MAX_KB}KB；母版 PNG 见 \`hires/\``,
  "- 场景：夜里魔女阁楼；正对面小圆毛玻璃窗（冷光漫射、窗外看不见东西）；左侧壁炉**火已熄灭**（冷灰、黑膛、无火光无余烬）；长桌居中、雕花桌腿、绣花桌旗、**桌面全空**；两把雕花椅；满墙书架（书脊清晰）；星图；浑天仪；成堆手稿；玻璃标本罐（干花/草药）；木地板；空气里的细尘；无人物。",
  "- 细节纪律：只用正向的细节词（DETAIL 段），**不写** flat colors / hard-edged shadows / 2-3 tone shading / no gradients / cel shaded / no 3d render；风格词只有 anime background art / illustration + not a photograph。",
  "",
  "## 共用段（五张逐字相同）",
  "",
  "```",
  BASE,
  "",
  DETAIL,
  STYLE_FIXED,
  FRAME,
  "```",
  "",
  "## 逐档",
  "",
];
for (const t of TIERS) {
  notesBody.push(`### ${t.n}. ${t.name}（id: \`${t.id}\`）`, "", "**动漫强度句**：" + t.style, "", "```", promptOf(t), "```", "", "**自查**：（待补）", "");
}
if (!existsSync(notesFile)) writeFileSync(notesFile, notesBody.join("\n"));

const bad = results.filter((r) => !r.bytes);
const all = TIERS.map((t) => {
  const f = join(OUT_DIR, fileName(t));
  const p = join(HIRES_DIR, `${t.n}.png`);
  return {
    file: f,
    bytes: existsSync(f) ? readFileSync(f).length : 0,
    pngBytes: existsSync(p) ? readFileSync(p).length : 0,
  };
});
const totalKB = Math.round(all.reduce((n, f) => n + f.bytes, 0) / 1024);
const missing = all.filter((f) => !f.bytes).map((f) => f.file);

console.log(`\n成功 ${results.length - bad.length}/${results.length} · 五张 webp 合计 ${totalKB}KB`);
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
