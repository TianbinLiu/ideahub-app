// 示例视频「默认去水印」那句话压不压得住 —— 付费对照（2026-10-24 主人「花」）。
// 同一条带假水印的示例视频（官方 r2v_tea_video1 + ffmpeg 烧上「LIVE」角标、「抖音 @qimeng_probe」），
// 首尾帧照 App 的做法从它截（所以帧上也有水印），提示词与 App 真发的**逐字同形**（segmentGen 素材参考那条路）：
//   keep  = 正文 + customRefPrompt 时序句
//   strip = 正文 + 时序句 + NO_REF_MARK_LINE（afterStop 去掉重复的句号）
// 2.5（电影级）与 2.0 mini（高清）各一对。用法（仓库根目录）：node design/ref-video-watermark-probe.mjs <输出目录> [--real] [--budget=30]
// 输入要先自己传到公网（方舟只收 URL）：<输出目录>/uploaded.json 写 { "tea-wm.mp4": { url, duration }, "first.jpg": { url }, "last.jpg": { url } }。
// 2026-10-24 主人「花」跑过一次（四发全成，实扣 ¥24.29）：读数与结论在 docs/ref-video-watermark-probe-2026-10-24.md。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? join(HERE, "wm-out");
const REAL = process.argv.includes("--real");
const BUDGET = Number(process.argv.find((a) => a.startsWith("--budget="))?.slice(9) ?? 30);
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";
const MINI = "doubao-seedance-2-0-mini-260615";
const SD25 = "doubao-seedance-2-5-260628";
const YUAN_PER_M = { [MINI]: 14, [SD25]: 42 };
const up = JSON.parse(readFileSync(join(OUT, "uploaded.json"), "utf8"));
const VIDEO = up["tea-wm.mp4"];
const FIRST = up["first.jpg"].url;
const LAST = up["last.jpg"].url;
const IN_SEC = VIDEO.duration;
const OUT5 = 121 / 24;
const tokensOf = (inSec, outSec) => Math.round((inSec + outSec) * 21600);

// ── 与 App 逐字同形的那几截（src/studio/segmentGen.ts）──
const PLOT = "一只手拿着裱花袋，在小蛋糕上慢慢挤出一圈奶油，俯拍，暖色晨光，画面干净";
const ROLES = "。参考视频提供整体画面、运镜与节奏；图片1是这段视频的第一帧画面，视频从它开始；图片2是这段视频的最后一帧画面，视频结束在它。画面按图片编号顺序推进，衔接自然。";
const NO_REF_MARK_LINE = "。参考视频与参考图里的水印、台标、账号名和字幕都不要出现在画面里";
const afterStop = (prev, s) => (prev.endsWith("。") && s.startsWith("。") ? s.slice(1) : s);
const KEEP = `${PLOT}${ROLES}`;
const STRIP = `${PLOT}${ROLES}${afterStop(ROLES, NO_REF_MARK_LINE)}`;

const text = (t) => ({ type: "text", text: t });
const vid = (url) => ({ type: "video_url", role: "reference_video", video_url: { url } });
const img = (url) => ({ type: "image_url", image_url: { url }, role: "reference_image" });
// App 的顺序（arkClient composeSegments）：正文 → 参考视频 → 参考图（帧 1..N）
const content = (prompt) => [text(prompt), vid(VIDEO.url), img(FIRST), img(LAST)];

const CASES = [
  { id: "U-keep", what: "电影级 · 不加那句", model: SD25, prompt: KEEP },
  { id: "U-strip", what: "电影级 · 加「去水印」那句", model: SD25, prompt: STRIP },
  { id: "H-keep", what: "高清 · 不加那句", model: MINI, prompt: KEEP },
  { id: "H-strip", what: "高清 · 加「去水印」那句", model: MINI, prompt: STRIP },
];
let total = 0;
for (const c of CASES) {
  const y = (tokensOf(IN_SEC, OUT5) * YUAN_PER_M[c.model]) / 1e6;
  total += y;
  console.log(`[${c.id}] ${c.what}｜${c.model}｜预估 ${tokensOf(IN_SEC, OUT5).toLocaleString()} token ≈ ¥${y.toFixed(2)}`);
}
console.log(`合计 ≈ ¥${total.toFixed(2)}（刊例含视频输入单价：2.0 mini 14 元/M、2.5 42 元/M；输入 ${IN_SEC}s + 输出 ${OUT5.toFixed(4)}s）`);
console.log(`[prompt keep] ${KEEP}`);
console.log(`[prompt strip] ${STRIP}`);
if (!REAL) {
  console.log("[dry] 不带 --real，一个请求都没发。");
  process.exit(0);
}
if (total > BUDGET) throw new Error(`¥${total.toFixed(2)} 超过 --budget=${BUDGET}，不发`);

const LOG = join(OUT, "wm-probe.log.json");
const log = (() => { try { return JSON.parse(readFileSync(LOG, "utf8")).log ?? []; } catch { return []; } })();
const save = () => writeFileSync(LOG, JSON.stringify({ log }, null, 2));
async function jfetch(method, path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    return { ok: false, status: 0, j: { error: { code: "noReply", message: String(e?.cause?.code ?? e) } } };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(c) {
  const req = {
    model: c.model,
    content: content(c.prompt),
    resolution: "720p",
    ratio: "16:9",
    duration: 5,
    watermark: false,
    generate_audio: true,
    omni_reference_task_type: "reference",
  };
  const r = await jfetch("POST", "/contents/generations/tasks", req);
  return { id: c.id, what: c.what, model: c.model, submit: { status: r.status, error: r.ok ? undefined : r.j.error }, taskId: r.ok ? r.j.id : null };
}
async function wait(rec) {
  const t0 = Date.now();
  for (;;) {
    await sleep(10_000);
    const q = await jfetch("GET", `/contents/generations/tasks/${rec.taskId}`);
    const st = q.j?.status;
    if (st === "succeeded" || st === "failed" || st === "cancelled" || st === "expired" || Date.now() - t0 > 25 * 60_000) {
      rec.status = st ?? "timeout";
      rec.ms = Date.now() - t0;
      rec.usage = q.j?.usage;
      rec.error = q.j?.error;
      rec.videoUrl = q.j?.content?.video_url;
      break;
    }
  }
  if (rec.videoUrl) {
    const file = join(OUT, `${rec.id}.mp4`);
    writeFileSync(file, Buffer.from(await (await fetch(rec.videoUrl)).arrayBuffer()));
    rec.file = file;
    // 抽 6 帧看水印：0.1s 起每 0.9s 一张
    for (let i = 0; i < 6; i++) {
      const t = (0.1 + i * 0.9).toFixed(2);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", t, "-i", file, "-frames:v", "1", "-q:v", "3", join(OUT, `${rec.id}-f${i}.jpg`)]);
    }
  }
  const tok = rec.usage?.completion_tokens ?? rec.usage?.total_tokens;
  if (tok) rec.yuan = +((tok * YUAN_PER_M[rec.model]) / 1e6).toFixed(3);
  return rec;
}

// 四发一起提交（互不依赖），再逐个等
const recs = [];
for (const c of CASES) {
  const rec = await submit(c);
  recs.push(rec);
  console.log(JSON.stringify(rec));
}
for (const rec of recs) {
  if (!rec.taskId) { log.push({ at: new Date().toISOString(), ...rec }); save(); continue; }
  await wait(rec);
  log.push({ at: new Date().toISOString(), ...rec });
  save();
  console.log(JSON.stringify({ id: rec.id, status: rec.status, ms: rec.ms, usage: rec.usage, yuan: rec.yuan, error: rec.error }));
}
const spent = log.reduce((n, l) => n + (l.yuan ?? 0), 0);
console.log(`实扣合计（按用量 × 刊例） ¥${spent.toFixed(2)}。读数写在 ${LOG}`);
