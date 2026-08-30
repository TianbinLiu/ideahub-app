// 【backlog §2.7 P2-a 的付费验证】refMode（参考生视频）参考图预算从 3 张放宽到档位协议上限。
//
// 验的是**放宽后 app 真会发出的那一发**：hd 档（doubao-seedance-2-0-mini，协议上限 9 张）
// 带 5 张参考图 —— 2 张人物卡各 face+body（4 张，multiChar 分配的形状）+ 1 张道具卡。
// 老预算（3 张）下第二张人物卡一张图都进不了模型，她的脸只能靠模型编 —— 这发要证明的
// 就是「放开之后每个人各归各位」。
//
// 提示词**逐字复刻**放宽后 segmentGen 的拼法：紧凑点名句前置（bindCompact，含道具那句
// BIND_HINT 原文）+ 正文 + 素材设定尾巴（materialText 原文）。剧情里对两人只用名字 ——
// 身份信息只能来自参考图与点名句。
//
// 三个读数（都要）：
//   ① 任务受理且 succeeded —— 2.0 系收 5 张 reference_image（协议 9 张上限的实证半发）；
//   ② usage —— 与 2 图那发（ab-bind-syntax，108,900）比：参考图张数**不该**改变计费
//      （报价侧因此一行不用改；若变了，economy 那边要跟着动，放宽就得回滚）；
//   ③ 抽帧人工比对 —— 凛雪（银白长发/金星发夹/深蓝披风）与玄墨（黑发束起/狐狸面具/
//      暗红和服）各是各的人、灯笼与道具图一致。特征全挑肉眼可判的。
//
// 预算：Seedream ×5 ≈ ¥1.0 + Seedance 5s 720p ×1 ≈ ¥1.0，合计约 ¥2.0。
// 用法（仓库根目录）：node design/p2a-refmode-budget.mjs . <输出目录>
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

// ── 测试素材：与 ab-bind-syntax 同一位「凛雪」（连续性）+ 新对照角色 + 道具 ──
const RIN = "一位银白色长发、佩戴金色星星发饰的动漫女性角色，蓝绿色眼睛，深蓝色短披风与白色衬衫";
const RIN_ID = "凛雪：银白色长发别金色星星发夹，蓝绿色眼睛，深蓝色短披风配白衬衫";
const XUAN = "一位黑色短发束起、侧头佩戴红白狐狸面具的动漫男性角色，琥珀色眼睛，暗红色和服外套";
const XUAN_ID = "玄墨：黑色短发束起，侧头挂红白狐狸面具，琥珀色眼睛，暗红色和服外套";
const LANTERN = "一盏发着青色微光的六角纸灯笼，深色木质提手，灯面绘有简单的波浪纹";
const LANTERN_SUM = "青色微光的六角纸灯笼，木提手，波浪纹灯面";

const STORY =
  "夜晚的古街石板路上，两人并肩慢行：凛雪提着灯笼走在左侧，灯光照亮青石路面；玄墨在右侧驻足回头望向镜头，衣摆被夜风轻轻掀起，中景跟拍。";

// ── 提示词 = 放宽后 segmentGen 的原样拼法：bindCompact 前置（去句首句号）+ 正文 + mats 尾巴 ──
const BIND_HEAD =
  "参考图：凛雪=@图片1@图片2；玄墨=@图片3@图片4；@图片5是道具卡「青焰灯笼」的实物参考，画面中出现它时必须与之一致" +
  "。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。";
const MATS =
  "。本段固定素材设定（必须严格遵守，不得改动其外形与身份）：" +
  `人物卡「凛雪」＝${RIN_ID}；人物卡「玄墨」＝${XUAN_ID}；道具卡「青焰灯笼」（${LANTERN_SUM}）`;
const PROMPT = `${BIND_HEAD}${STORY}${MATS}`;

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

// ── 1) 参考图 ×5（face+body ×2 人 + 道具 ×1，即 multiChar 分配对这套素材的产物）──
console.log("① 出参考图（Seedream ×5）…");
const jobs = [
  [`${RIN}的面部特写肖像：纯白色背景，头肩构图，五官清晰，二次元插画风。`, "rin-face.jpg"],
  [`${RIN}的全身立绘：纯白色背景，全身完整可见，站姿自然，二次元插画风。`, "rin-body.jpg"],
  [`${XUAN}的面部特写肖像：纯白色背景，头肩构图，五官清晰，二次元插画风。`, "xuan-face.jpg"],
  [`${XUAN}的全身立绘：纯白色背景，全身完整可见，站姿自然，二次元插画风。`, "xuan-body.jpg"],
  [`${LANTERN}：纯白色背景，物体完整居中，商品图质感，二次元插画风。`, "prop-lantern.jpg"],
];
const refUrls = [];
for (const [prompt, file] of jobs) {
  const url = await seedream(prompt);
  refUrls.push(url);
  await download(url, file);
  console.log(`   ${file} ✓`);
}

// ── 2) 一发 Seedance（协议形状逐字对齐 arkClient：hd 档 reference 模式，5 张图）──
console.log(`② 创建出片任务（${PROMPT.length} 字，5 张参考图）…`);
console.log(`   提示词：${PROMPT}`);
const task = await jfetch("/contents/generations/tasks", {
  model: "doubao-seedance-2-0-mini-260615",
  content: [
    { type: "text", text: PROMPT },
    ...refUrls.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" })),
  ],
  resolution: "720p",
  generate_audio: true,
  watermark: false,
  ratio: "16:9",
  duration: 5,
});
console.log(`   任务号 ${task.id}，轮询中…`);
let videoUrl;
for (let i = 0; i < 80; i++) {
  await new Promise((r) => setTimeout(r, 6000));
  const j = await jfetch(`/contents/generations/tasks/${task.id}`);
  if (j.status === "succeeded") {
    console.log(`   完成 · usage=${JSON.stringify(j.usage)}（对照：2 图那发 completion=108900）`);
    videoUrl = j.content?.video_url;
    break;
  }
  if (j.status === "failed") throw new Error(`失败：${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  if (i % 5 === 0) console.log(`   ${j.status}…`);
}
if (!videoUrl) throw new Error(`超时（8 分钟）——任务号 ${task.id}，可稍后手查`);
const sz = await download(videoUrl, "video.mp4");
console.log(`③ 已存 video.mp4（${Math.round(sz / 1024)}KB）`);
console.log("   接下来：ffmpeg 抽帧，人工比对两人身份与灯笼（读数③）。");
