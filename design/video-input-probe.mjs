// 【「修这一段」第一批开工前的付费探测】Seedance 带视频输入的三种子任务：参考 / 编辑 / 延长（docs/canvas-platforms-ecosystem-research.md §八）。
//  主人 10-05「按你的建议做第一批，花钱前先报价」。要答的问题都是官方文档没写清、又直接决定怎么做的：
//   H1~H3 高清档（2.0 mini）：官方能力表写着「参考视频 / 编辑视频 / 延长视频 ✓」，而本仓档位表一直是 refVid:false（当年没核实）——
//     ① 收不收；② 认不认 `omni_reference_task_type`（官方只在 2.5 教程里写了它；不认的话是同步 400 还是静默忽略）；
//     ③ 账单是不是「含视频输入」那一档单价（刊例 14 元/M）、用量是不是同一条公式 (输入 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024。
//   U1 / U2 电影级（2.5）延长两轮：⑤ 接不接得上（第二轮拿第一轮的产物当输入）。
//     ④ 产物带不带原片**已经不用花钱问了**（2026-10-05）：官方 2.5 提示词指南延长示例的三个文件量过 —— 输入 15.05s、产物 5.00s（mov，带 PCM 声音）、
//     「拼接后的视频」20.08s ⇒ 产物**只有新的一截**。所以 U2 的输入就是 U1 的那 5 秒，按下限报价。
//   U3 电影级按时间段编辑（片段重拍）：⑥ 写了「只改第 2~3 秒」之后是不是只改那一截；⑦ 开着出声时声音留不留得住（返修现在钉死无声）。
//
// 素材：火山官方文档里编辑 / 延长 / 参考三个示例的输入视频（ark-project.tos-cn-beijing.volces.com/doc_video/*，公网可取、没有版权顾虑）。
//   方舟收视频只认 URL / 素材 ID（不收 Base64），所以用官方自己托管的这几段。2026-10-05 量过：
//   r2v_edit_video1 854×480 30fps 5.500s 有声；r2v_extend_video1 854×480 30fps 5.067s；r2v_tea_video1 1280×720 24fps 5.042s。
//
// 预估价按带视频输入的账单公式（白模 A3 三发逐 token 钉过）：tokens = (输入秒 + 输出秒) × 1280 × 720 × 24 ÷ 1024 = (输入 + 输出) × 21,600；
//   输出 5 秒 = 121 帧 = 5.0417 秒；编辑的输出跟随输入（按 = 输入取上界）。单价刊例：2.0 mini 含视频输入 14 元/M、2.5 含视频输入 42 元/M。
//
// 用法（仓库根目录）：node design/video-input-probe.mjs <输出目录> [--real] [--only=H1,U3] [--budget=50]
//   不带 --real 只打印要发的请求与逐发预估价，一分钱不花。U2 用 U1 的产物当输入（读同一份 log）。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "video-input-probe";
const REAL = process.argv.includes("--real");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;
const BUDGET = Number(process.argv.find((a) => a.startsWith("--budget="))?.slice(9) ?? 50);
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";

const MINI = "doubao-seedance-2-0-mini-260615";
const SD25 = "doubao-seedance-2-5-260628";
/** 元/百万 token（刊例，含视频输入那一档） */
const YUAN_PER_M = { [MINI]: 14, [SD25]: 42 };
/** 最坏情况的单价：高清档要是没按「含视频输入」那一档收、按不含视频输入的 23 元/M 收（这正是 H1~H3 要核的 ③） */
const YUAN_PER_M_WORST = { [MINI]: 23, [SD25]: 42 };
const DOC = "https://ark-project.tos-cn-beijing.volces.com";
const SRC = {
  edit: { url: `${DOC}/doc_video/r2v_edit_video1.mp4`, sec: 5.5 },
  extend: { url: `${DOC}/doc_video/r2v_extend_video1.mp4`, sec: 5.0667 },
  tea: { url: `${DOC}/doc_video/r2v_tea_video1.mp4`, sec: 5.0417 },
};
const CREAM = `${DOC}/doc_image/r2v_edit_pic1.jpg`;
const OUT5 = 121 / 24; // 输出 5 秒实际是 121 帧
const tokensOf = (inSec, outSec) => Math.round((inSec + outSec) * 21600);

const LOG = join(OUT, "video-input-probe.log.json");
const log = (() => {
  try {
    return JSON.parse(readFileSync(LOG, "utf8")).log ?? [];
  } catch {
    return [];
  }
})();
const save = () => writeFileSync(LOG, JSON.stringify({ log }, null, 2));

const text = (t) => ({ type: "text", text: t });
const vid = (url) => ({ type: "video_url", role: "reference_video", video_url: { url } });
const img = (url) => ({ type: "image_url", role: "reference_image", image_url: { url } });

/**
 * 六发。`omni`：先带上任务类型参数发；高清档若被同步拒（参数不认，方舟提交即拒、不扣钱）就去掉重发一次，两次都记下。
 * ★ 提示词与 App 真发出去的**逐字同形**（2026-10-05 改：探测验的就是要上线的写法）——延长 = segmentGen.EXTEND_HEAD + 接下来发生什么；
 *   编辑 = segmentGen.revisePlotOf（只改其中几秒时）+ REVISE_TAIL（带着官方要的关键词「修改」）。参考图的点名照 App 的紧凑式写。
 */
const CASES = [
  {
    id: "H1",
    what: "高清 · 参考视频出片（reference）",
    model: MINI,
    omni: "reference",
    input: SRC.tea,
    outSec: OUT5,
    body: { content: [text("参考视频1的运镜和手部动作节奏，拍一段新的画面：一只手拿着裱花袋，在一杯拿铁的奶泡上慢慢挤出一个心形，俯拍，暖色晨光"), vid(SRC.tea.url)], duration: 5, ratio: "adaptive" },
  },
  {
    id: "H2",
    what: "高清 · 编辑视频（edit）",
    model: MINI,
    omni: "edit",
    input: SRC.edit,
    outSec: SRC.edit.sec,
    body: { content: [text("参考图：面霜=@图片1。把礼盒里的香水换成图片1里的面霜。以上是要改的地方：在参考视频的基础上只做这些修改，其余画面、人物形象、动作、运镜与时长保持不变，画面中不要出现任何水印、台标、字幕或角标"), vid(SRC.edit.url), img(CREAM)], duration: -1, ratio: "adaptive" },
  },
  {
    id: "H3",
    what: "高清 · 延长视频（extend）",
    model: MINI,
    omni: "extend",
    input: SRC.extend,
    outSec: OUT5,
    body: { content: [text("向后延长视频1：从视频1的最后一帧接着往下拍，画面、人物与声音无缝衔接。接下来：镜头继续缓慢下降，穿过那扇拱形窗户，进入一座美术馆的室内，一镜到底不要切镜"), vid(SRC.extend.url)], duration: 5, ratio: "adaptive", return_last_frame: true },
  },
  {
    id: "U1",
    what: "电影级 · 延长第一轮",
    model: SD25,
    omni: "extend",
    input: SRC.extend,
    outSec: OUT5,
    body: { content: [text("向后延长视频1：从视频1的最后一帧接着往下拍，画面、人物与声音无缝衔接。接下来：镜头继续缓慢下降，穿过那扇拱形窗户，进入一座美术馆的室内，一镜到底不要切镜"), vid(SRC.extend.url)], duration: 5, ratio: "adaptive", return_last_frame: true },
  },
  {
    id: "U2",
    what: "电影级 · 延长第二轮（输入 = U1 的产物）",
    model: SD25,
    omni: "extend",
    dependsOn: "U1",
    // 输入 = U1 的产物：只有新的一截（官方示例量过，见文件头），≈ 5.04 秒
    input: { url: null, sec: OUT5 },
    outSec: OUT5,
    body: { content: [text("向后延长视频1：从视频1的最后一帧接着往下拍，画面、人物与声音无缝衔接。接下来：镜头在美术馆里沿着长廊缓缓向前，最后停在一幅发着微光的油画前，一镜到底不要切镜")], duration: 5, ratio: "adaptive", return_last_frame: true },
  },
  {
    id: "U3",
    what: "电影级 · 按时间段编辑 + 出声（片段重拍）",
    model: SD25,
    omni: "edit",
    input: SRC.edit,
    outSec: SRC.edit.sec,
    body: {
      content: [text("只改视频1中第2-3秒：把打开盒子的那双手换成戴着红色手套的手。这几秒以外的内容不要变化。以上是要改的地方：在参考视频的基础上只做这些修改，其余画面、人物形象、动作、运镜与时长保持不变，画面中不要出现任何水印、台标、字幕或角标"), vid(SRC.edit.url)],
      duration: -1,
      ratio: "adaptive",
      generate_audio: true,
    },
  },
];

const picked = CASES.filter((c) => !ONLY || ONLY.includes(c.id));
const yuan = (c, inSec) => (tokensOf(inSec, c.outSec) * YUAN_PER_M[c.model]) / 1e6;
let total = 0;
let worst = 0;
for (const c of picked) {
  const lo = yuan(c, c.input.sec);
  const hi = (tokensOf(c.input.sec, c.outSec) * YUAN_PER_M_WORST[c.model]) / 1e6;
  total += lo;
  worst += hi;
  console.log(`[${c.id}] ${c.what}｜${c.model}｜预估 ${tokensOf(c.input.sec, c.outSec).toLocaleString()} token ≈ ¥${lo.toFixed(2)}${hi !== lo ? `（若按不含视频输入的单价收：¥${hi.toFixed(2)}）` : ""}`);
}
console.log(`合计 ≈ ¥${total.toFixed(2)}（最多 ¥${worst.toFixed(2)}：高清档若按不含视频输入的 23 元/M 收；刊例，含视频输入单价：2.0 mini 14 元/M、2.5 42 元/M）`);
if (!REAL) {
  for (const c of picked) console.log(`[dry] ${c.id}: ${JSON.stringify({ model: c.model, omni_reference_task_type: c.omni, ...c.body }).slice(0, 700)}`);
  console.log("[dry] 不带 --real，一个请求都没发。");
  process.exit(0);
}
if (worst > BUDGET) throw new Error(`最坏 ¥${worst.toFixed(2)} 超过 --budget=${BUDGET}，不发`);

async function jfetch(method, path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    // 没收到回包：方舟那边可能已经受理并计费（查不到），记下来、不当成「没花钱」
    return { ok: false, status: 0, j: { error: { code: "noReply", message: String(e?.cause?.code ?? e) } } };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function probe(file) {
  try {
    const v = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames", "-show_entries", "format=duration", "-of", "json", file], { encoding: "utf8" });
    const a = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8" }).trim();
    const j = JSON.parse(v);
    return { ...j.streams?.[0], duration: Number(j.format?.duration), audio: a || null };
  } catch (e) {
    return { err: String(e).slice(0, 200) };
  }
}

async function run(c) {
  const body = structuredClone(c.body);
  if (c.dependsOn) {
    const prev = log.findLast((l) => l.id === c.dependsOn && l.videoUrl);
    if (!prev) return { id: c.id, skipped: `没有 ${c.dependsOn} 的产物` };
    body.content.push(vid(prev.videoUrl));
  }
  const attempts = [];
  let created = null;
  for (const withOmni of [true, false]) {
    const req = { model: c.model, ...body, resolution: "720p", watermark: false, ...(withOmni ? { omni_reference_task_type: c.omni } : {}) };
    const r = await jfetch("POST", "/contents/generations/tasks", req);
    attempts.push({ withOmni, status: r.status, error: r.ok ? undefined : r.j.error });
    if (r.ok) {
      created = r.j.id;
      break;
    }
    // 只有「高清档 + 带了任务类型 + 同步 4xx」才去掉参数再试一次；别的失败照实记下、不重发
    if (!(c.model === MINI && withOmni && r.status >= 400 && r.status < 500)) break;
  }
  const rec = { id: c.id, what: c.what, model: c.model, attempts, taskId: created };
  if (!created) return rec;
  const t0 = Date.now();
  for (;;) {
    await sleep(10_000);
    const q = await jfetch("GET", `/contents/generations/tasks/${created}`);
    const st = q.j?.status;
    if (st === "succeeded" || st === "failed" || st === "cancelled" || Date.now() - t0 > 25 * 60_000) {
      rec.status = st ?? "timeout";
      rec.ms = Date.now() - t0;
      rec.usage = q.j?.usage;
      rec.error = q.j?.error;
      rec.videoUrl = q.j?.content?.video_url;
      rec.lastFrameUrl = q.j?.content?.last_frame_url;
      rec.reported = { duration: q.j?.duration, ratio: q.j?.ratio, resolution: q.j?.resolution, fps: q.j?.framespersecond };
      break;
    }
  }
  if (rec.videoUrl) {
    const file = join(OUT, `${c.id}.mp4`);
    writeFileSync(file, Buffer.from(await (await fetch(rec.videoUrl)).arrayBuffer()));
    rec.file = file;
    rec.probe = probe(file);
  }
  const tok = rec.usage?.completion_tokens ?? rec.usage?.total_tokens;
  if (tok) rec.yuan = +((tok * YUAN_PER_M[c.model]) / 1e6).toFixed(3);
  return rec;
}

for (const c of picked) {
  const rec = await run(c);
  log.push({ at: new Date().toISOString(), ...rec });
  save();
  console.log(JSON.stringify(rec));
}
const spent = log.reduce((n, l) => n + (l.yuan ?? 0), 0);
console.log(`实扣合计（按用量 × 刊例） ¥${spent.toFixed(2)}。读数写在 ${LOG}`);
