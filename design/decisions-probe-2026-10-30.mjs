// 【2026-10-30 主人「花」】docs/decisions-2026-10-30.md §七 里那三笔付费验证，一个脚本跑完（读数回写进各自的正本）：
//   E1 推演三套直接写成分镜（node-modes 416-3）：
//      ① chat：现行提示词（散文 plot）与改写版（plot 写成「镜头1：…」几行）各跑 3 发同一个上下文 —— 量输出 token（chat() 的上限是 800，
//         三套各 120 字已经不远）、finish_reason、JSON 能不能读、parseShots 认出几个镜头；
//      ② 视频：同一批人物图 + 同一个走向，散文 plot 与分镜 plot 各出 2 发（草稿 480p 9:16 5 秒，同一个模型 2.0 mini），看切镜是不是照分镜来。
//   E2 「同上一段的地点」自动补句（guided-modes 181 ③）：第 1 段出一发、截真实尾帧，第 2 段从它承接各出 2 发 ——
//      A = 现行写法（承接句 + 自己的剧情，不写地点）；B = 承接句后面多一句「全段都在图片1这个地点…不要换到别的场景」。10-04 那次 A 在 2.33 秒切镜后漂到了白天大图书馆。
//   E3 多人同框绑定（multi-character §七 4）：两张人物图，两人同框的一帧各出 2 发 ——
//      V0 = 现行（只喂第一个人物的图，第二个人只有名字）；V1 = 每人一张图 + 长句绑定（Seedream 画帧现行的 bind 句式）；V2 = 紧凑式「林夏=@图片1；沈舟=@图片2」。
//   人物图由 Seedream 现画两张（仓里没有可用的人物参考图；10-04 用的小枫 / 夜川在主人设备上）。
//
// ★ 提示词与 App 发出去的逐字同形之处：参考图直出 = segmentGen.mainPrompt 的 refMode（紧凑绑定句前置 + 正文，real.compactBind 的 foot）；
//   承接 = customRefPrompt 的承接句 + frameBind(offset=帧数)；画帧 = real.generateFrame 的外壳（ONE_FRAME / NO_TEXT / 9:16 promptHint）。
//   偏差：没有过 softenForImage（素材里没有敏感词）、没有素材设定文字 mats（这几张卡没有出片句）。
// ★ 价钱（刊例）：2.0 mini 无视频输入 ¥23/M；480p 9:16 一发 5 秒 = 121 帧 × 496×864 ÷ 1024 ≈ 50,628 token ≈ ¥1.16；
//   Seedream 4.0（4-0-20260415）¥0.20/张；seed-2.1-turbo 一发不到 ¥0.01。合计约 ¥12（主人认的是「≈¥5 + ≈¥5 + ¥1~2」）。
//
// 用法（仓库根目录）：node design/decisions-probe-2026-10-30.mjs <输出目录> [--real] [--only=chars,e3,e1chat,e1vid,e2] [--budget=14]
//   不带 --real 只打印请求与预估价，一分钱不花。各步的产物记在 <输出目录>/probe.log.json，重跑会复用已有的人物图 / 第 1 段。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseShots } from "../src/data/shotScript.ts";

const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "decisions-probe";
const REAL = process.argv.includes("--real");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;
const BUDGET = Number(process.argv.find((a) => a.startsWith("--budget="))?.slice(9) ?? 14);
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";
const MINI = "doubao-seedance-2-0-mini-260615";
const IMG = "doubao-seedream-4-0-20260415";
const CHAT = "doubao-seed-2-1-turbo-260628";
const VID_TOKENS_480P_916 = Math.round((121 * 496 * 864) / 1024);
const VID_YUAN = (VID_TOKENS_480P_916 * 23) / 1e6;
const IMG_YUAN = 0.2;
const want = (k) => !ONLY || ONLY.includes(k);

const LOG = join(OUT, "probe.log.json");
const log = (() => {
  try {
    return JSON.parse(readFileSync(LOG, "utf8"));
  } catch {
    return {};
  }
})();
const save = () => writeFileSync(LOG, JSON.stringify(log, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jfetch(method, path, body, extraHeaders = {}) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: { ...H, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    return { ok: false, status: 0, j: { error: { code: "noReply", message: String(e?.cause?.code ?? e) } } };
  }
}

// ── 素材（冻结中文；两个人在九宫格文档里也叫这两个名字）──
const CAST = {
  林夏: "二十多岁的年轻女性，齐肩黑色短发，红色长风衣，白色围巾，细长的银色耳坠，身形瘦高",
  沈舟: "三十岁上下的男性，黑框眼镜，深灰色高领毛衣，棕色皮围裙，短胡茬，身形敦实",
};
const SCENE_SEG1 = "雨夜的旧书店，暖黄灯光，木书架林立；林夏推门进来收伞，柜台后的沈舟抬头微笑";
const PLOT_SEG2 = "沈舟从身后的书架取下一本旧书递给林夏，林夏翻开书页、露出惊喜的表情，两人相视而笑";
const ASPECT_HINT = "竖版 9:16 全屏画面，主体居中偏上，上下留出呼吸空间";
const ONE_FRAME = "单一完整画面，不要分格、拼贴、对话框或字幕，";
const NO_TEXT = "无文字无水印。";
const FRAME_SIZE = "1440x2560";
/** real.compactBind：人物那一组 + foot */
const compactBind = (names) =>
  `参考图：${names.map((n, i) => `${n}=@图片${i + 1}`).join("；")}。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。`;
/** segmentGen.customRefPrompt 的承接句（帧只有一张，不说「按图片编号顺序推进」） */
const CARRIED = "图片1是上一镜的最后一帧，本段从这一帧接着往下演——人物、服装、场景、光线与机位保持连续";
/** E2-B 要验的那一句（系统替人补的「同上一段的地点」） */
const SAME_PLACE = "；全段都发生在图片1这个地点，切换镜头之后仍是同一地点、同一时间与同一光线，不要换到别的场景";
/** frameBind(offset=1)：卡片图排在帧后面 */
const frameBind = (names, offset) =>
  `。参考图：${names.map((n, i) => `${n}=@图片${offset + i + 1}`).join("；")}。等号右边的图只用来锁这个角色的长相、发色与服装，不要照抄其构图与背景。`;

// ── 画面 / 视频 / 对话三个调用 ──
async function image(tag, prompt, refs) {
  const body = { model: IMG, prompt, size: FRAME_SIZE, response_format: "url", watermark: false };
  if (refs?.length) body.image = refs.length === 1 ? refs[0] : refs;
  if (!REAL) {
    console.log(`[dry][img ${tag}] refs=${refs?.length ?? 0} ${prompt}`);
    return { url: `dry:${tag}` };
  }
  const t0 = Date.now();
  const r = await jfetch("POST", "/images/generations", body);
  const url = r.j?.data?.[0]?.url;
  const rec = { tag, status: r.status, ms: Date.now() - t0, url, error: r.ok ? undefined : r.j.error, prompt, refs: refs?.length ?? 0 };
  if (url) {
    const file = join(OUT, `${tag}.jpg`);
    writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
    rec.file = file;
  }
  (log.images ??= []).push({ at: new Date().toISOString(), ...rec });
  save();
  console.log(JSON.stringify({ img: tag, status: r.status, ms: rec.ms, err: rec.error?.message?.slice(0, 160) }));
  if (!url) throw new Error(`image ${tag} failed: ${JSON.stringify(r.j.error).slice(0, 300)}`);
  return rec;
}
async function video(tag, prompt, refs) {
  const body = {
    model: MINI,
    content: [{ type: "text", text: prompt }, ...refs.map((url) => ({ type: "image_url", image_url: { url }, role: "reference_image" }))],
    resolution: "480p",
    ratio: "9:16",
    duration: 5,
    generate_audio: true,
    watermark: false,
  };
  if (!REAL) {
    console.log(`[dry][vid ${tag}] refs=${refs.length}（${refs.map((u) => u.slice(0, 24)).join(" | ")}）\n   ${prompt}`);
    return { tag, videoUrl: `dry:${tag}` };
  }
  const r = await jfetch("POST", "/contents/generations/tasks", body);
  const rec = { tag, prompt, refs: refs.map((u) => (u.startsWith("data:") ? `dataURL(${u.length})` : u)), submit: r.status, taskId: r.j?.id, error: r.ok ? undefined : r.j.error };
  if (!r.ok) {
    (log.videos ??= []).push({ at: new Date().toISOString(), ...rec });
    save();
    console.log(JSON.stringify({ vid: tag, submit: r.status, err: JSON.stringify(r.j.error).slice(0, 300) }));
    return rec;
  }
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
    const file = join(OUT, `${tag}.mp4`);
    writeFileSync(file, Buffer.from(await (await fetch(rec.videoUrl)).arrayBuffer()));
    rec.file = file;
    // 10 格缩略（每 0.5 秒一帧）给人看；尾帧单独截给承接用
    try {
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", "fps=2,scale=248:-1,tile=5x2", "-frames:v", "1", join(OUT, `${tag}.sheet.png`)]);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-sseof", "-0.08", "-i", file, "-frames:v", "1", "-q:v", "3", "-vf", "scale=-1:1280", join(OUT, `${tag}.tail.jpg`)]);
      rec.sheet = join(OUT, `${tag}.sheet.png`);
      rec.tail = join(OUT, `${tag}.tail.jpg`);
    } catch (e) {
      rec.ffmpeg = String(e).slice(0, 200);
    }
  }
  const tok = rec.usage?.completion_tokens ?? rec.usage?.total_tokens;
  if (tok) rec.yuan = +((tok * 23) / 1e6).toFixed(3);
  (log.videos ??= []).push({ at: new Date().toISOString(), ...rec });
  save();
  console.log(JSON.stringify({ vid: tag, status: rec.status, ms: rec.ms, tokens: tok, yuan: rec.yuan, err: rec.error?.message?.slice(0, 200) }));
  return rec;
}
async function chat(tag, system, user) {
  const body = { model: CHAT, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: 800, thinking: { type: "disabled" } };
  if (!REAL) {
    console.log(`[dry][chat ${tag}] system=${system.length}字 user=${user.length}字`);
    return { text: "[]", truncated: false };
  }
  const t0 = Date.now();
  const r = await jfetch("POST", "/chat/completions", body);
  const ch = r.j?.choices?.[0];
  const rec = { tag, status: r.status, ms: Date.now() - t0, finish: ch?.finish_reason, usage: r.j?.usage, text: ch?.message?.content ?? "", error: r.ok ? undefined : r.j.error };
  (log.chats ??= []).push({ at: new Date().toISOString(), ...rec });
  save();
  return { text: rec.text, truncated: rec.finish === "length", rec };
}

// ── 预算 ──
const plan = [];
if (want("chars")) plan.push(["人物图 ×2", 2 * IMG_YUAN]);
if (want("e3")) plan.push(["E3 同框 ×6", 6 * IMG_YUAN]);
if (want("e1chat")) plan.push(["E1 chat ×6", 0.06]);
if (want("e1vid")) plan.push(["E1 视频 ×4", 4 * VID_YUAN]);
if (want("e2")) plan.push(["E2 视频 ×5", 5 * VID_YUAN]);
const est = plan.reduce((n, [, y]) => n + y, 0);
for (const [w, y] of plan) console.log(`${w} ≈ ¥${y.toFixed(2)}`);
console.log(`合计 ≈ ¥${est.toFixed(2)}（视频一发 ${VID_TOKENS_480P_916.toLocaleString()} token ≈ ¥${VID_YUAN.toFixed(3)}）`);
if (REAL && est > BUDGET) throw new Error(`预估 ¥${est.toFixed(2)} 超过 --budget=${BUDGET}，不发`);

// ── 0. 人物图 ──
async function chars() {
  log.chars ??= {};
  for (const [name, desc] of Object.entries(CAST)) {
    if (log.chars[name]?.url && !log.chars[name].url.startsWith("dry:")) continue;
    const rec = await image(
      `char-${name}`,
      `角色设定图：${desc}，全身正面站立，表情自然，纯浅灰色背景，二次元动画风格，${ONE_FRAME}高细节，${NO_TEXT}${ASPECT_HINT}。`,
    );
    log.chars[name] = { url: rec.url, file: rec.file, at: new Date().toISOString() };
    save();
  }
  return log.chars;
}
const refOf = (name) => log.chars?.[name]?.file ?? "";
/** 本地文件 → dataURL（人物图的方舟地址只活 24 小时，重跑时照样可用） */
const dataUrl = (file) => `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
/** 视频的参考图优先用方舟回的 https 地址（reference_image 只实测过 https；地址 24 小时内有效），过期了才退回 dataURL */
const charRefs = () =>
  ["林夏", "沈舟"].map((n) => (!REAL ? `dry:${n}` : /^https:/.test(log.chars?.[n]?.url ?? "") && Date.now() - Date.parse(log.chars[n].at ?? 0) < 20 * 3600e3 ? log.chars[n].url : dataUrl(refOf(n))));

// ── E3 ──
async function e3() {
  const moment = "雨夜的旧书店里，林夏推门进来收伞，柜台后的沈舟抬头微笑，中景，两人都在画面里";
  const shell = (bind) => `视频中的一个画面：${moment}。${ONE_FRAME}高细节，电影感构图，氛围光，${NO_TEXT}${ASPECT_HINT}。${bind}`;
  const [lx, sz] = charRefs();
  const variants = {
    V0: {
      refs: [lx],
      bind: `参考图：将<图片1>的长相、发色与服装定义为角色「林夏」（设定：${CAST.林夏}），本段画面中该角色的长相、发色与服装必须与之完全一致。`,
    },
    V1: {
      refs: [lx, sz],
      bind: `参考图：将<图片1>的长相、发色与服装定义为角色「林夏」（设定：${CAST.林夏}），本段画面中该角色的长相、发色与服装必须与之完全一致；<图片2>是人物「沈舟」的形象参考：该角色出现时长相、发色与服装必须与之一致。`,
    },
    V2: { refs: [lx, sz], bind: compactBind(["林夏", "沈舟"]) },
  };
  for (const [v, { refs, bind }] of Object.entries(variants)) {
    for (const k of [1, 2]) {
      const tag = `e3-${v}-${k}`;
      if (log.images?.some((i) => i.tag === tag && i.url)) continue;
      await image(tag, shell(bind), refs);
    }
  }
}

// ── E1 ──
const SYS_A =
  '你是互动视频编剧兼分镜师。基于素材与要求，为同一段视频写 3 个不同走向（顺势推进/风云突变/柳暗花明），输出 JSON 数组：[{"title":"12字内标题","plot":"80-120字剧情，画面感强，小说式","durationSec":4到9的整数,"shot":{"size":"景别（远景/全景/中景/近景/特写）","camera":"运镜（固定/推/拉/摇/移/跟/环绕/手持，可带方向，6字内）","beat":"情绪节拍，6字内，如 压抑→爆发"}}]。只输出 JSON。';
const SYS_B =
  '你是互动视频编剧兼分镜师。基于素材与要求，为同一段视频写 3 个不同走向（顺势推进/风云突变/柳暗花明），输出 JSON 数组：[{"title":"12字内标题","plot":"分镜：2到3个镜头，每个镜头一行、以「镜头1：」「镜头2：」开头（行之间用\\n），每行30-45字写清谁在哪、做什么、景别与运镜，不写秒数；总计80-130字","durationSec":4到9的整数,"shot":{"size":"景别（远景/全景/中景/近景/特写）","camera":"运镜（固定/推/拉/摇/移/跟/环绕/手持，可带方向，6字内）","beat":"情绪节拍，6字内，如 压抑→爆发"}}]。只输出 JSON。';
const USER_E1 = `这是第1段。素材：character:林夏(${CAST.林夏})；character:沈舟(${CAST.沈舟})；scene:雨夜旧书店(暖黄灯光、木书架林立、窗外雨声)\n要求：林夏冒雨推门进店，沈舟在柜台后抬头\n已定前情：无`;
function readPlots(text) {
  try {
    const arr = JSON.parse(text.replace(/```json|```/g, "").trim());
    if (!Array.isArray(arr) || arr.length < 3) return { ok: false, why: "不是 3 条" };
    return { ok: true, arr };
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 80) };
  }
}
async function e1chat() {
  log.e1 ??= { A: [], B: [] };
  for (const [arm, sys] of [["A", SYS_A], ["B", SYS_B]]) {
    while (log.e1[arm].length < 3) {
      const k = log.e1[arm].length + 1;
      const { text, truncated, rec } = await chat(`e1-${arm}-${k}`, sys, USER_E1);
      const parsed = readPlots(text);
      const row = {
        k,
        tokens: rec?.usage?.completion_tokens,
        finish: rec?.finish,
        truncated,
        jsonOk: parsed.ok,
        why: parsed.why,
        plots: parsed.ok
          ? parsed.arr.map((p) => ({ title: p.title, len: String(p.plot ?? "").length, shots: parseShots(String(p.plot ?? "")).shots.length, durationSec: p.durationSec, shot: p.shot, plot: p.plot }))
          : [],
      };
      log.e1[arm].push(row);
      save();
      console.log(JSON.stringify({ e1: `${arm}${k}`, tokens: row.tokens, finish: row.finish, jsonOk: row.jsonOk, lens: row.plots.map((p) => `${p.len}/${p.shots}镜`) }));
      if (!REAL) break;
    }
  }
}
async function e1vid() {
  const pick = (arm) => log.e1?.[arm]?.find((r) => r.jsonOk)?.plots?.[0];
  const a = pick("A");
  const b = pick("B");
  if (!a || !b) {
    console.log("[e1vid] 先跑 e1chat 拿到两边的 plot");
    return;
  }
  const shotLine = (s) => (s && (s.size || s.camera || s.beat) ? `镜头：${[s.size, s.camera, s.beat].filter(Boolean).join(" · ")}。` : "");
  const refs = charRefs();
  const head = compactBind(["林夏", "沈舟"]);
  for (const [arm, p] of [["prose", a], ["shots", b]]) {
    for (const k of [1, 2]) {
      const tag = `e1-${arm}-${k}`;
      if (log.videos?.some((v) => v.tag === tag && v.videoUrl)) continue;
      await video(tag, `${head}${shotLine(p.shot)}${p.plot}`, refs);
    }
  }
}

// ── E2 ──
async function e2() {
  const refs = charRefs();
  let seg1 = log.videos?.find((v) => v.tag === "e2-seg1" && v.tail);
  if (!seg1) seg1 = await video("e2-seg1", `${compactBind(["林夏", "沈舟"])}镜头：中景 · 缓推 · 平静→温暖。${SCENE_SEG1}`, refs);
  if (!REAL) {
    for (const arm of ["A", "B"]) console.log(`[dry][e2-${arm}] ${CARRIED}${arm === "B" ? SAME_PLACE : ""}${frameBind(["林夏", "沈舟"], 1)}镜头：中景 · 固定 · 温暖→惊喜。${PLOT_SEG2}`);
    return;
  }
  if (!seg1?.tail) {
    console.log("[e2] 第 1 段没出来，后面不发");
    return;
  }
  // 承接帧按 App 的样子压到 720p 长边再发（real.ts 那条：2560 的 dataURL 白白撑大上传）；reference_image 收不收 dataURL 这里顺手验了
  const tail720 = join(OUT, "e2-seg1.tail720.jpg");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", seg1.tail, "-vf", "scale=-1:1280", "-q:v", "4", tail720]);
  const carry = dataUrl(tail720);
  for (const arm of ["A", "B"]) {
    for (const k of [1, 2]) {
      const tag = `e2-${arm}-${k}`;
      if (log.videos?.some((v) => v.tag === tag && v.videoUrl)) continue;
      const roles = `${CARRIED}${arm === "B" ? SAME_PLACE : ""}`;
      const prompt = `${roles}${frameBind(["林夏", "沈舟"], 1)}镜头：中景 · 固定 · 温暖→惊喜。${PLOT_SEG2}`;
      const rec = await video(tag, prompt, [carry, ...refs]);
      if (rec.submit && rec.submit >= 400) {
        console.log(`[e2] reference_image 不收 dataURL（${rec.submit}），后面的承接发不出去 —— 要先把尾帧传成公网地址`);
        return;
      }
    }
  }
}

if (want("chars")) await chars();
if (want("e3")) await e3();
if (want("e1chat")) await e1chat();
if (want("e1vid")) await e1vid();
if (want("e2")) await e2();
const spentImg = (log.images ?? []).filter((i) => i.url).length * IMG_YUAN;
const spentVid = (log.videos ?? []).reduce((n, v) => n + (v.yuan ?? 0), 0);
console.log(`${REAL ? "实扣" : "预估"}：出图 ¥${spentImg.toFixed(2)} + 视频 ¥${spentVid.toFixed(2)}（chat 另计，不到 ¥0.1）。读数在 ${LOG}`);
