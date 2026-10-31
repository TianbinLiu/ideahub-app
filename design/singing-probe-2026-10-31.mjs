// 【L 唱段 · 付费探测（要「花」）】docs/canvas-platforms-ecosystem-research.md 第五节 L、docs/decisions-2026-10-30.md §五「唱段」：
//   定的是「只做『歌词让模型唱』+ 本人声音样本自证，不收第三方歌曲」—— 可官方 2.5 提示词指南里**一个字都没提唱歌**（2026-10-31 查：
//   只有台词、对白、背景音乐的负向控制、音频参考里的「音乐 / 旋律 / 台词 / 音色」），社区指南也只写「引号里的台词会配音」、
//   「要唱得准多半得给一段音频参考」。所以建向导之前先花十来块钱问模型一句：**给歌词，它是念出来还是唱出来？**
//   五发，都是 480p 9:16 5 秒、不带参考图（问的只是声音）：
//     S1 mini · 中文 · App 现行的台词写法（「林夏说：“……”」）—— 对照组：这就是今天把歌词当台词写会得到的东西
//     S2 mini · 中文 · 明说「唱」+ 曲风 + 旋律 + 官方台词格式「林夏台词（唱）：」
//     S3 mini · 英文 · 同 S2
//     S4 2.5  · 中文 · 同 S2（电影级是 L 定的档位；2.5 的 480p 比 720p 便宜一半多，问「会不会唱」够用）
//     S5 2.5  · 英文 · 同 S2
//   读数：① 产物有没有音轨、时长；② **人耳听**（成片发给主人，这才是结论）；③ 一个粗指标 —— 把音轨切成 50ms 窗做自相关找基频，
//   「同一个音高连续 ≥ 300ms」的窗占比。⚠ 10-31 拿 10-30 那三条带台词的成片校准过：0.17 / 0.46 / 0.70 —— 模型自配的背景音乐
//   会把这个数顶上去，它分不开「人在唱」与「有 bgm」，只能在同一批里横向比、不能单独当结论（纯正弦旋律 = 1.0 是上限）。
//
// ★ 价钱（刊例，2026-10-19 核过）：2.0 mini 无视频输入 ¥23/M、2.5 无视频输入 ¥70/M；480p 9:16 5 秒 = 121 帧 × 496×864 ÷ 1024 ≈ 50,628 token
//   ⇒ mini 一发 ≈ ¥1.16、2.5 一发 ≈ ¥3.54；五发合计 ≈ ¥10.6。
//
// 用法（仓库根目录）：node design/singing-probe-2026-10-31.mjs <输出目录> [--real] [--only=s1,s2,s3,s4,s5] [--budget=12]
//   不带 --real 只打印请求与预估价，一分钱不花。产物与读数记在 <输出目录>/probe.log.json，重跑跳过已出的那几发。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "singing-probe";
const REAL = process.argv.includes("--real");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;
const BUDGET = Number(process.argv.find((a) => a.startsWith("--budget="))?.slice(9) ?? 12);
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const BASE = "https://ark.cn-beijing.volces.com/api/v3";
const MINI = "doubao-seedance-2-0-mini-260615";
const ULTRA = "doubao-seedance-2-5-260628";
const YUAN_PER_M = { [MINI]: 23, [ULTRA]: 70 };
const VID_TOKENS_480P_916 = Math.round((121 * 496 * 864) / 1024);
const yuanOf = (model, tokens) => (tokens * YUAN_PER_M[model]) / 1e6;
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
async function jfetch(method, path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } catch (e) {
    return { ok: false, status: 0, j: { error: { code: "noReply", message: String(e?.cause?.code ?? e) } } };
  }
}

// ── 歌词（自己写的，四句、不押任何已有歌曲；中英各一份）──
const LYRIC_ZH = ["夜色落在窗台上", "风把灯火吹得轻轻晃", "我把名字写进月光", "等一个人回头望"];
const LYRIC_EN = ["The night comes down on the windowsill", "The wind keeps every lantern still", "I write your name into the moon", "And wait for you to turn around"];
const SCENE_ZH = "小剧场的舞台上，一个穿浅色连衣裙的年轻女孩站在一支立式麦克风前，暖黄追光，背景一片深蓝。固定机位中景，竖屏构图。";
const SCENE_EN = "On a small theater stage, a young woman in a light dress stands at a standing microphone under a warm spotlight, deep blue backdrop. Fixed medium shot, vertical framing.";

// S1：App 今天的写法 —— 歌词当台词（shotScript 的「X说：“……”」骨架，引号内会被配音；segmentGen.NO_SUBTITLE_LINE 照带）
const S1 = `${SCENE_ZH}林夏说：“${LYRIC_ZH.join("，")}。”台词只用声音说出来，画面上不要出现字幕。`;
// S2：明说唱 + 曲风 + 旋律 + 官方台词格式「角色台词（情绪）：内容」，歌词分行
const S2 = `${SCENE_ZH}她对着麦克风唱歌，不是念白：抒情民谣，慢板，有清晰的旋律起伏，每一句拖长尾音，背景只有轻柔的钢琴伴奏。\n林夏台词（唱，温柔）：“${LYRIC_ZH[0]}，${LYRIC_ZH[1]}。”\n林夏台词（唱，渐强）：“${LYRIC_ZH[2]}，${LYRIC_ZH[3]}。”\n严格按歌词演唱，不要增减歌词；画面上不要出现字幕。`;
const S3 = `${SCENE_EN}She sings into the microphone — singing, not speaking: a slow acoustic ballad with a clear melody, each line held on a long note, only a soft piano underneath.\nLin Xia lyrics (singing, tender): "${LYRIC_EN[0]}, ${LYRIC_EN[1]}."\nLin Xia lyrics (singing, building): "${LYRIC_EN[2]}, ${LYRIC_EN[3]}."\nSing exactly these lyrics, add nothing; no subtitles on screen.`;

const ARMS = [
  { tag: "s1", model: MINI, prompt: S1 },
  { tag: "s2", model: MINI, prompt: S2 },
  { tag: "s3", model: MINI, prompt: S3 },
  { tag: "s4", model: ULTRA, prompt: S2 },
  { tag: "s5", model: ULTRA, prompt: S3 },
];

const plan = ARMS.filter((a) => want(a.tag)).map((a) => [`${a.tag} ${a.model === MINI ? "mini" : "2.5"}`, yuanOf(a.model, VID_TOKENS_480P_916)]);
const est = plan.reduce((n, [, y]) => n + y, 0);
for (const [w, y] of plan) console.log(`${w} ≈ ¥${y.toFixed(2)}`);
console.log(`合计 ≈ ¥${est.toFixed(2)}（一发 ${VID_TOKENS_480P_916.toLocaleString()} token）`);
if (REAL && est > BUDGET) throw new Error(`预估 ¥${est.toFixed(2)} 超过 --budget=${BUDGET}，不发`);

/** 粗指标：音轨切 50ms 窗，自相关找基频；「同一音高（±3%）连续 ≥ 6 窗」的窗占比 */
function sustainRatio(file) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 26 });
  const n = pcm.length >> 1;
  const win = 800; // 50ms @16k
  const f0s = [];
  for (let i = 0; i + win <= n; i += win) {
    let e = 0;
    const x = new Float32Array(win);
    for (let k = 0; k < win; k++) {
      x[k] = pcm.readInt16LE((i + k) * 2) / 32768;
      e += x[k] * x[k];
    }
    if (e / win < 1e-4) {
      f0s.push(0);
      continue;
    }
    let best = 0;
    let bestLag = 0;
    for (let lag = 40; lag <= 400; lag++) {
      // 40~400 样本 = 400~40 Hz
      let s = 0;
      for (let k = 0; k + lag < win; k++) s += x[k] * x[k + lag];
      if (s > best) {
        best = s;
        bestLag = lag;
      }
    }
    f0s.push(best / e > 0.3 ? 16000 / bestLag : 0);
  }
  let sustained = 0;
  let run = 1;
  for (let i = 1; i <= f0s.length; i++) {
    const same = i < f0s.length && f0s[i] > 0 && f0s[i - 1] > 0 && Math.abs(f0s[i] - f0s[i - 1]) / f0s[i - 1] < 0.03;
    if (same) run++;
    else {
      if (run >= 6 && f0s[i - 1] > 0) sustained += run;
      run = 1;
    }
  }
  const voiced = f0s.filter((f) => f > 0).length;
  return { windows: f0s.length, voiced, sustained, ratio: voiced ? +(sustained / voiced).toFixed(3) : 0 };
}

// 只量一个现成文件的粗指标（校准用）：node design/singing-probe-2026-10-31.mjs --pitch=<mp4>
const PITCH_ONLY = process.argv.find((a) => a.startsWith("--pitch="))?.slice(8);
if (PITCH_ONLY) {
  console.log(JSON.stringify({ file: PITCH_ONLY, pitch: sustainRatio(PITCH_ONLY) }));
  process.exit(0);
}

async function video(a) {
  const body = {
    model: a.model,
    content: [{ type: "text", text: a.prompt }],
    resolution: "480p",
    ratio: "9:16",
    duration: 5,
    generate_audio: true,
    watermark: false,
  };
  if (!REAL) {
    console.log(`[dry][${a.tag} ${a.model}]\n${a.prompt}\n`);
    return;
  }
  if (log.videos?.some((v) => v.tag === a.tag && v.videoUrl)) {
    console.log(`[skip] ${a.tag} 已出过`);
    return;
  }
  const r = await jfetch("POST", "/contents/generations/tasks", body);
  const rec = { tag: a.tag, model: a.model, prompt: a.prompt, submit: r.status, taskId: r.j?.id, error: r.ok ? undefined : r.j.error };
  if (!r.ok) {
    (log.videos ??= []).push({ at: new Date().toISOString(), ...rec });
    save();
    console.log(JSON.stringify({ vid: a.tag, submit: r.status, err: JSON.stringify(r.j.error).slice(0, 300) }));
    return;
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
    const file = join(OUT, `${a.tag}.mp4`);
    writeFileSync(file, Buffer.from(await (await fetch(rec.videoUrl)).arrayBuffer()));
    rec.file = file;
    try {
      rec.streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim().split("\n");
      rec.pitch = sustainRatio(file);
      execFileSync("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", "fps=2,scale=248:-1,tile=5x2", "-frames:v", "1", join(OUT, `${a.tag}.sheet.png`)]);
    } catch (e) {
      rec.ffmpeg = String(e).slice(0, 200);
    }
  }
  const tok = rec.usage?.completion_tokens ?? rec.usage?.total_tokens;
  if (tok) rec.yuan = +yuanOf(a.model, tok).toFixed(3);
  (log.videos ??= []).push({ at: new Date().toISOString(), ...rec });
  save();
  console.log(JSON.stringify({ vid: a.tag, status: rec.status, ms: rec.ms, tokens: tok, yuan: rec.yuan, streams: rec.streams, pitch: rec.pitch, err: rec.error?.message?.slice(0, 200) }));
}

for (const a of ARMS) if (want(a.tag)) await video(a);
const spent = (log.videos ?? []).reduce((n, v) => n + (v.yuan ?? 0), 0);
console.log(`${REAL ? "实扣" : "预估"}：视频 ¥${spent.toFixed(2)}。读数在 ${LOG}`);
