// 【跟着做 C「九宫格分镜」开工前的付费对比】官方「组图」 vs 「真九宫格 + 逐格高清」（docs/guided-modes-design.md §二 C、§六 第 4 条：
//  主人定的「先付费比两种出图做法再定」）。出片那一半（挑 3 格、各出一段高清 5 秒）不在这个脚本里 —— 走开发环境里 App 自己的出片路
//  （这一格当开头帧、人物图照发），与第三期上线后的路径一致。
//
// 两种做法、同一份 9 个镜头的分镜、同两张人物参考图（林夏：B 付费验证现做的全身立绘；沈舟：A 验证用过的三维形象渲染图）、同一个模型：
//   A 官方组图：一个请求 `sequential_image_generation: "auto"` + `max_images: 6`，画分镜的前 6 个镜头；每一张本身是一张完整单图。
//     官方文档（图片生成 API，2026-10-05 读）：Seedream 5.0 lite / 4.5 / 4.0 支持；参考图 2~14 张、参考图 + 出图 ≤ 15；
//     「仅对成功生成图片按张数进行计费」（usage.generated_images），max_images 只是上限、实际几张由模型定。
//   B 真九宫格（LibTV 的做法）：一张 3×3 的拼图画全部 9 个镜头，再把其中 3 格逐格重画成单张高清（格子裁图当构图参考 + 两张人物图）。
//     ⚠ 当初「一张图里画同一个角色六个姿势」被方舟按文本敏感整发拒过（精灵图那次，public/perch/README.md）—— 这条先验它会不会被拒；
//       被拒是在创建那一拍（400），不计费。
//
// 读数（都要）：
//   ① 组图：回了几张（usage.generated_images）、每张是不是单独完整的画面（没有分格 / 拼贴 / 字）、两人在各张之间像不像、是不是照分镜那几个镜头；
//   ② 九宫格：拒不拒；格子分得齐不齐（裁得准不准）；格子里两人像不像；重画成高清之后构图还在不在、人像不像；
//   ③ 钱：每一发的 usage 原样落盘（按张计费的那几行）。
//
// 预算（刊例，Seedream 4.0 ¥0.20/张）：组图 ≤ 6 张 ≤ ¥1.20；九宫格 1 张 ¥0.20 + 逐格重画 3 张 ¥0.60。图这一半合计 ≤ ¥2.00。
//
// 用法（仓库根目录）：node design/c-grid-compare.mjs <林夏参考图> <沈舟参考图> <输出目录> [--real]
//   不带 --real 只打印要发的请求，一分钱不花。
//   只重画指定的格子：… --real --redraw=<裁好的格子图>:<镜头序号(1起)>,…（读数追加进同一份 log）
// ★ 2026-10-05 实跑：九宫格**不是均分的 3×3** —— 模型排成了漫画式的五行（有的格子横跨整行、各格大小不一），
//   按 3×3 均分裁必然裁到格子中间。所以主流程只出九宫格，逐格重画用 --redraw 交人看着裁好的格子。
// ★ 网络断了（fetch 抛）不再让整个脚本崩掉：那一发记成 noReply（方舟那边可能已经处理并按张计费，查不到），读数照样落盘。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const [LIN_PATH, ZHOU_PATH, OUT = "."] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const REAL = process.argv.includes("--real");
if (!LIN_PATH || !ZHOU_PATH) throw new Error("用法：node design/c-grid-compare.mjs <林夏参考图> <沈舟参考图> <输出目录> [--real]");
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";
/** 与 App 画帧默认档同一个模型（economy.DEFAULT_IMAGE_TIER = 速写 = Seedream 4.0，¥0.20/张） */
const MODEL = "doubao-seedream-4-0-250828";
/** 竖屏帧的画布（types.VIDEO_ASPECTS 的 portrait.frameSize） */
const SIZE = "1440x2560";

const dataUrl = (p) => {
  const ext = extname(p).slice(1).toLowerCase().replace("jpg", "jpeg");
  return `data:image/${ext};base64,${readFileSync(p).toString("base64")}`;
};
const LIN = dataUrl(LIN_PATH);
const ZHOU = dataUrl(ZHOU_PATH);

/** 9 个镜头（接着 B 付费验证那场戏往下写）。组图画前 6 个，九宫格画全部 9 个 */
const SHOTS = [
  "远景：清晨的海边，灯塔立在礁石上，林夏背着邮差包沿着海岸小路走来",
  "中景：林夏站在灯塔门口抬手敲门，海风吹起她的短发",
  "中景：灯塔的木门打开，沈舟站在门里，看见林夏有些意外",
  "近景：林夏从邮差包里拿出一封泛黄的旧信，双手递给沈舟",
  "特写：沈舟戴着黑手套的手接过旧信，信封上盖着褪色的邮戳",
  "中景：灯塔里的旋转楼梯旁，沈舟低头读信，林夏站在一旁",
  "近景：沈舟抬起头，眼眶微红",
  "近景：林夏看着他，温柔地笑了",
  "远景：两人站在灯塔顶层的窗边，望向海面上升起的太阳",
];
const CAST = "图1 是林夏（栗色齐肩短发、琥珀色眼睛、米白针织毛衣、深绿百褶裙、帆布邮差包），图2 是沈舟（黑色短发、红眼睛、深蓝色金边长外套、黑手套）";
const list = (n) => SHOTS.slice(0, n).map((s, i) => `${i + 1}. ${s}`).join("；");

const GROUP_PROMPT =
  `根据参考图里的两个角色（${CAST}），生成 6 张连续的电影分镜画面，按下面的顺序一张一个镜头：${list(6)}。` +
  `每张都是一张单独完整的竖版画面（不要分格、拼贴、边框、文字、对话框、字幕），两人的长相、发型与服装在每张里都与参考图一致，同一个清晨海边灯塔的场景与光线贯穿始终。二次元动画风格，电影感光影。`;
const GRID_PROMPT =
  `一张 3×3 九宫格电影分镜图：整张竖版画面均匀分成 3 行 3 列共 9 个格子，格子之间用细白边隔开，按从左到右、从上到下的顺序每格一个镜头。` +
  `角色：${CAST}，每个格子里人物的长相、发型与服装都与参考图一致。九个镜头依次是：${list(9)}。格子里不要任何文字、编号或对话框。二次元动画风格。`;
/** 逐格重画：图1 = 那一格的裁图（构图），图2 / 图3 = 人物 */
const redrawPrompt = (shot) =>
  `把图1这一格分镜重画成一张完整的高清电影画面（竖版），构图、人物位置与动作照图1；人物的长相、发型与服装照图2（林夏）和图3（沈舟）。` +
  `这个镜头是：${shot}。单一完整画面，不要分格、边框、文字。二次元动画风格。`;

async function jpost(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    // 没收到回包：方舟那边可能已经处理并计费（查不到），记下来、不当成「没花钱」
    return { ok: false, status: 0, j: { error: { code: "noReply", message: String(e?.cause?.code ?? e) } } };
  }
}
async function save(url, name) {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(join(OUT, name), buf);
  return name;
}

const LOG = join(OUT, "c-grid-compare.log.json");
const log = (() => {
  try {
    return JSON.parse(readFileSync(LOG, "utf8")).log ?? [];
  } catch {
    return [];
  }
})();
const redrawArg = process.argv.find((a) => a.startsWith("--redraw="))?.slice("--redraw=".length);
const plan = [
  { step: "A 组图", body: { model: MODEL, prompt: GROUP_PROMPT, image: [LIN, ZHOU], size: SIZE, watermark: false, sequential_image_generation: "auto", sequential_image_generation_options: { max_images: 6 }, response_format: "url" } },
  { step: "B 九宫格", body: { model: MODEL, prompt: GRID_PROMPT, image: [LIN, ZHOU], size: SIZE, watermark: false, sequential_image_generation: "disabled", response_format: "url" } },
];
if (REAL && redrawArg) {
  for (const item of redrawArg.split(",")) {
    const [file, n] = item.split(":");
    const k = Number(n) - 1;
    const t1 = Date.now();
    const rr = await jpost("/images/generations", { model: MODEL, prompt: redrawPrompt(SHOTS[k]), image: [dataUrl(join(OUT, file)), LIN, ZHOU], size: SIZE, watermark: false, sequential_image_generation: "disabled", response_format: "url" });
    const hd = rr.ok && rr.j.data?.[0]?.url ? await save(rr.j.data[0].url, `B-hd-${k + 1}.jpeg`) : null;
    log.push({ step: `B 重画第 ${k + 1} 个镜头（${file}）`, status: rr.status, ms: Date.now() - t1, usage: rr.j.usage, error: rr.ok ? undefined : rr.j.error, file: hd });
    console.log(JSON.stringify(log.at(-1)));
  }
  writeFileSync(LOG, JSON.stringify({ model: MODEL, size: SIZE, shots: SHOTS, log }, null, 2));
  process.exit(0);
}
if (!REAL) {
  for (const p of plan) console.log(`[dry] ${p.step}: ${JSON.stringify({ ...p.body, image: p.body.image.map((u) => u.slice(0, 30) + "…") }).slice(0, 900)}`);
  console.log(`[dry] B 逐格重画 ×3：图1 = 第 1 / 4 / 6 格的裁图，图2 / 图3 = 两人参考图。例：${redrawPrompt(SHOTS[3]).slice(0, 200)}…`);
  console.log("[dry] 不带 --real，一个请求都没发。");
  process.exit(0);
}

// ── A 组图 ──
{
  const t0 = Date.now();
  const r = await jpost("/images/generations", plan[0].body);
  const files = [];
  if (r.ok) for (const [i, d] of (r.j.data ?? []).entries()) if (d.url) files.push(await save(d.url, `A-group-${i + 1}.jpeg`));
  log.push({ step: "A 组图", status: r.status, ms: Date.now() - t0, usage: r.j.usage, error: r.ok ? undefined : r.j.error, files });
  console.log(JSON.stringify(log.at(-1)));
}
// ── B 九宫格 + 逐格重画 ──
{
  const t0 = Date.now();
  const r = await jpost("/images/generations", plan[1].body);
  const grid = r.ok && r.j.data?.[0]?.url ? await save(r.j.data[0].url, "B-grid.jpeg") : null;
  log.push({ step: "B 九宫格", status: r.status, ms: Date.now() - t0, usage: r.j.usage, error: r.ok ? undefined : r.j.error, file: grid });
  console.log(JSON.stringify(log.at(-1)));
  // 逐格重画不在这里做：格子不一定均分（见文件头 ★），裁哪一块由人看着定，再用 --redraw 跑
}
writeFileSync(LOG, JSON.stringify({ model: MODEL, size: SIZE, shots: SHOTS, log }, null, 2));
const images = log.reduce((n, l) => n + (l.usage?.generated_images ?? 0), 0);
console.log(`出图合计 ${images} 张（刊例 ¥${(images * 0.2).toFixed(2)}）。读数写在 ${join(OUT, "c-grid-compare.log.json")}`);
