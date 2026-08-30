// 【backlog 2.8-⑥ 的付费 A/B】经典路（refMode）视频提示词的点名句：
//   A = 现状（长句绑定，尾置）—— 逐字复刻 ai/real.prepareMaterialRefs 非 multiChar 形态
//   B = 提案（@槽位紧凑式，**前置**）—— 复用白模路（multiChar）实测钉死的措辞
//     （「凛雪=@图片1@图片2」「等号右边的图只用来锁…」，G0/A2 那批），加上方舟官方
//     「重要素材前置」的位置。
// 两发同素材、同剧情、同档（hd = doubao-seedance-2-0-mini，refMode 真用的那档）。
// 预算：Seedream ×2 ≈ ¥0.4 + Seedance 5s 720p ×2 ≈ ¥2.0，合计约 ¥2.4。
//
// 用法（仓库根目录）：node design/ab-bind-syntax.mjs . <输出目录>
// 产物：<输出目录>/ref-face.jpg ref-body.jpg videoA.mp4 videoB.mp4 + 控制台的用量对账
//
// ★ 判定方法：产物抽帧后人工比对「画面里的人像不像参考图那个人」（银白长发/金色星星
//   发夹/蓝绿眼/深蓝披风白衬衫，特征都挑了肉眼可判的）。剧情里刻意只写「她」——
//   身份信息**只能**来自参考图与点名句，句式差异才测得出来。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.argv[2] ?? ".";
const OUT = process.argv[3] ?? ".";
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";

// ── 固定测试素材（与 gen-scheme-examples 的示例主体同一人设：虚构、特征肉眼可判） ──
const SUBJECT = "一位银白色长发、佩戴金色星星发饰的动漫女性角色，蓝绿色眼睛，深蓝色短披风与白色衬衫";
const ID_LINE = "凛雪：银白色长发别金色星星发夹，蓝绿色眼睛，深蓝色短披风配白衬衫";
const STORY =
  "雨夜的霓虹长街上，她撑着透明伞缓缓走向镜头，路过一家亮着暖灯的拉面店时停下回头看了一眼，伞沿雨珠滑落，中景跟拍。";

// ── A：现状长句（逐字对齐 prepareMaterialRefs 非 multiChar + segmentGen.materialText）──
// 结构 = 正文 + 素材设定 + 参考图说明（尾置）。图序 face→body（allocateRefs 规则三）。
const PROMPT_A =
  `${STORY}` +
  `。本段固定素材设定（必须严格遵守，不得改动其外形与身份）：人物卡「凛雪」＝${ID_LINE}` +
  `。参考图说明：将<图片1>的面部特征与发型发色、<图片2>的服装、体型与整体配色定义为角色「凛雪」` +
  `（设定：${ID_LINE}），本段画面中该角色的长相、发色与服装必须与之完全一致。` +
  `参考图只用于锁定形象，不要照抄它们的构图、背景、边框与文字`;

// ── B：@槽位紧凑式 + 前置（白模路措辞复用 + 方舟「重要素材前置」）──
const PROMPT_B =
  `参考图：凛雪=@图片1@图片2。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。` +
  `${STORY}` +
  `。本段固定素材设定（必须严格遵守，不得改动其外形与身份）：人物卡「凛雪」＝${ID_LINE}`;

async function jfetch(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: H, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j;
}

async function seedream(prompt) {
  const j = await jfetch("/images/generations", {
    model: "doubao-seedream-5-0-260128",
    prompt,
    size: "1764x2352",
    response_format: "url",
    watermark: false,
  });
  return j.data[0].url;
}

async function download(url, file) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  writeFileSync(join(OUT, file), buf);
  return buf.length;
}

// ── 1) 参考图：大头照 + 全身照（方舟指南推荐的两张，refMode 的 hero 正是这么取）──
console.log("① 出参考图（Seedream ×2）…");
const faceUrl = await seedream(`${SUBJECT}的面部特写肖像：纯白色背景，头肩构图，五官清晰，二次元插画风。`);
const bodyUrl = await seedream(`${SUBJECT}的全身立绘：纯白色背景，全身完整可见，站姿自然，二次元插画风。`);
await download(faceUrl, "ref-face.jpg");
await download(bodyUrl, "ref-body.jpg");
console.log("   参考图已存 ref-face.jpg / ref-body.jpg");

// ── 2) 两发 Seedance（协议形状逐字对齐 arkClient：hd 档 reference 模式）──
async function createTask(prompt) {
  const j = await jfetch("/contents/generations/tasks", {
    model: "doubao-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: faceUrl }, role: "reference_image" },
      { type: "image_url", image_url: { url: bodyUrl }, role: "reference_image" },
    ],
    resolution: "720p",
    generate_audio: true,
    watermark: false,
    ratio: "16:9",
    duration: 5,
  });
  return j.id;
}

async function waitTask(id, tag) {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 6000));
    const j = await jfetch(`/contents/generations/tasks/${id}`);
    if (j.status === "succeeded") {
      console.log(`   ${tag} 完成 · usage=${JSON.stringify(j.usage)}`);
      return j.content?.video_url;
    }
    if (j.status === "failed") throw new Error(`${tag} 失败：${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    if (i % 5 === 0) console.log(`   ${tag} ${j.status}…`);
  }
  throw new Error(`${tag} 超时（8 分钟）——任务号 ${id}，可稍后手查`);
}

console.log("② 创建两发出片任务（A=现状长句尾置 / B=@槽位前置）…");
console.log(`   A 提示词（${PROMPT_A.length} 字）：${PROMPT_A}`);
console.log(`   B 提示词（${PROMPT_B.length} 字）：${PROMPT_B}`);
const idA = await createTask(PROMPT_A);
const idB = await createTask(PROMPT_B);
console.log(`   任务号 A=${idA} B=${idB}，轮询中…`);
const [urlA, urlB] = [await waitTask(idA, "A"), await waitTask(idB, "B")];
const [szA, szB] = [await download(urlA, "videoA.mp4"), await download(urlB, "videoB.mp4")];
console.log(`③ 已存 videoA.mp4（${Math.round(szA / 1024)}KB） videoB.mp4（${Math.round(szB / 1024)}KB）`);
console.log("   接下来：ffmpeg 抽帧，人工比对身份贴合度。");
