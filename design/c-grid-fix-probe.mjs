// 【九宫格分镜（C）两个出图问题的付费验证】docs/seedream-grid-fix-research.md 第五节（2026-10-07 主人「花」）。
//  问题 1：组图不照分镜画（空镜里有人、同一个人出现两次、特写画成中景、只该有一个人的格子多了一个人）；
//  问题 2：单格重画带同一个人的两张图时画成上下两格的拼图。
//
// 四组（同一份 10-06 的 8 格分镜、同三张人物图：图1 林夏大头照 / 图2 林夏全身 / 图3 沈舟全身）：
//   arm1 新写法 · Seedream 4.0（250828）跑 2 遍：普通的 6 格一组（办法 A 压短 + C 参考图标用途）+ 空镜单画（办法 B：不带人物图，
//        拿这一遍组图里第 1 格的画面当「地点 / 光线 / 画风」参考）+ 特写单画（办法 B：只带这一格的人）。每遍 ≤ 8 张。
//   arm2 单格重画第 4 格 · 4.0（250828）：10-06 的原提示词 ×3 vs 新写法（办法 F 标用途 + G 正面写画幅）×3。6 张。
//   arm4 同 arm1 ×2 + arm2 的新写法 ×3，换官方给 4.0 指定的替换型号 doubao-seedream-4-0-20260415。≤ 19 张。
//        （原计划第 4 组测 5.0 lite；10-07 核对下线公告原文：5.0 lite（doubao-seedream-5-0-lite-260128）同在第十批，
//         能出组图的 5.0 lite / 4.5 / 4.0 全部 11-24 下线，5.0 pro / flash 不支持组图 —— 所以第 4 组改测 4.0 的替换型号。）
//   judge 看图核对：每张图问一次对话模型（几格、几个人、有没有两个一样的人、景别、有没有字），判定在代码里按分镜算；
//        先拿 10-06 已经付过钱的 10 张定标（标准答案见 OLD_TRUTH），再给新图打分。图先用 ffmpeg 缩到 720×1280。
//
// 刊例：4.0 ¥0.20/张；4.0-20260415 价目表按模型名列（「doubao-seedream-4-0」），这一版的名字也是它 ⇒ 推断同价 ¥0.20（以账单为准）。
//   arm1 ≤ 16 张、arm2 6 张、arm4 ≤ 19 张，合计 ≤ 41 张 ≤ ¥8.20；看图约 51 次 × 约 ¥0.007 ≈ ¥0.35。组图按实际画出的张数收。
//
// 用法（仓库根目录）：node design/c-grid-fix-probe.mjs <人物图目录> <10-06 旧图目录> <输出目录> [--real] [--only=arm1,arm2,arm4,judge]
//   人物图目录里要有 lin-face.jpg / lin-body.jpg / shen.jpg；旧图目录里要有 g0..g7.jpg / redraw4-norefs.jpg / redraw4-refs.jpg。
//   不带 --real 只打印要发的请求与字数，一分钱不花。
//   ★ 可以重跑：log 里记成功（或「没收到回包」）的那一步不再发 —— 没收到回包时方舟那边可能已经画了、已经计费，不自动重发。
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const pos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const [CARDS, OLD, OUT] = pos;
const REAL = process.argv.includes("--real");
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length) ?? "arm1,arm2,arm4,judge").split(",");
if (!CARDS || !OLD || !OUT) throw new Error("用法：node design/c-grid-fix-probe.mjs <人物图目录> <10-06 旧图目录> <输出目录> [--real] [--only=…]");
mkdirSync(OUT, { recursive: true });
const env = readFileSync(resolve(".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (REAL && !KEY) throw new Error("ARK_API_KEY 未配置");
const BASE = "https://ark.cn-beijing.volces.com/api/v3";
const H = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };
const M_OLD = "doubao-seedream-4-0-250828";
const M_NEW = "doubao-seedream-4-0-20260415";
const CHAT = "doubao-seed-2-1-turbo-260628";
const SIZE = "1440x2560";

const dataUrl = (p) => `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
const LIN_FACE = join(CARDS, "lin-face.jpg");
const LIN_BODY = join(CARDS, "lin-body.jpg");
const SHEN = join(CARDS, "shen.jpg");

// ── 10-06 那份分镜（AI 写的，原样）与那天 App 实际发出去的两段提示词（从会话记录里取回，逐字） ──
const LEAD = "雨夜旧车站站台，路灯昏黄，雨丝斜飘，氛围湿冷又带着期待";
const SHOTS = [
  { n: 1, size: "远景", picture: "雨夜旧车站站台，路灯下林夏撑伞站着，望向轨道方向", who: ["林夏"] },
  { n: 2, size: "全景", picture: "一列亮灯的火车缓缓驶入站台，车窗透出暖光", who: [] },
  { n: 3, size: "中景", picture: "沈舟站在车厢门口，脚刚踏站台，目光落在林夏身上", who: ["沈舟"] },
  { n: 4, size: "中景", picture: "林夏和沈舟隔着几步距离面对面，互相望着彼此", who: ["林夏", "沈舟"] },
  { n: 5, size: "近景", picture: "沈舟伸手从怀里取出一封旧信，递向林夏面前", who: ["林夏", "沈舟"] },
  { n: 6, size: "特写", picture: "林夏指尖捏着旧信信纸，视线落在纸面上", who: ["林夏"] },
  { n: 7, size: "近景", picture: "林夏抬起头，眼眶发红，嘴角却弯着笑看向沈舟", who: ["林夏", "沈舟"] },
  { n: 8, size: "中景", picture: "沈舟抬手把伞举到林夏头顶，伞面倾斜向她", who: ["林夏", "沈舟"] },
];
const shot = (n) => SHOTS[n - 1];
const OLD_GROUP_PROMPT =
  "根据参考图（图1、图2 是林夏（橙棕色齐肩短发、琥珀色眼睛的年轻女生，白色麻花针织毛衣、绿色短裙，斜挎军绿色帆布包）；图3 是沈舟（黑色短发的年轻男生，深蓝色金边立领制服外套）），生成 8 张连续的电影分镜画面，按下面的顺序一张一个镜头：1. 远景：雨夜旧车站站台，路灯下林夏撑伞站着，望向轨道方向（画面里：林夏）；2. 全景：一列亮灯的火车缓缓驶入站台，车窗透出暖光（画面里没有人）；3. 中景：沈舟站在车厢门口，脚刚踏站台，目光落在林夏身上（画面里：沈舟）；4. 中景：林夏和沈舟隔着几步距离面对面，互相望着彼此（画面里：林夏、沈舟）；5. 近景：沈舟伸手从怀里取出一封旧信，递向林夏面前（画面里：林夏、沈舟）；6. 特写：林夏指尖捏着旧信信纸，视线落在纸面上（画面里：林夏）；7. 近景：林夏抬起头，眼眶发红，嘴角却弯着笑看向沈舟（画面里：林夏、沈舟）；8. 中景：沈舟抬手把伞举到林夏头顶，伞面倾斜向她（画面里：林夏、沈舟）。每张都是一张单独完整的画面（不要分格、拼贴、边框、文字、对话框、字幕）；每个人在一张画面里只出现一次；人物的长相、发型与服装在每张里都与参考图一致；雨夜旧车站站台，路灯昏黄，雨丝斜飘，氛围湿冷又带着期待，同一个场景与光线贯穿始终。高细节，电影感构图，氛围光。竖版 9:16 全屏画面，主体居中偏上，上下留出呼吸空间。";
const ASK = "林夏只出现一次，画面里只有林夏和沈舟两个人";
const OLD_REDRAW_PROMPT =
  "视频中的一个画面：雨夜旧车站站台，路灯昏黄，雨丝斜飘，氛围湿冷又带着期待。中景，林夏和沈舟隔着几步距离面对面，互相望着彼此（画面里只有林夏、沈舟，每个人只出现一次）。要求：林夏只出现一次，画面里只有林夏和沈舟两个人。参考图：图1、图2 是林夏（橙棕色齐肩短发、琥珀色眼睛的年轻女生，白色麻花针织毛衣、绿色短裙，斜挎军绿色帆布包）；图3 是沈舟（黑色短发的年轻男生，深蓝色金边立领制服外套）；人物的长相、发型与服装与参考图一致。单一完整画面，不要分格、拼贴、对话框或字幕，高细节，电影感构图，氛围光，无文字无水印。竖版 9:16 全屏画面，主体居中偏上，上下留出呼吸空间。";

// ── 新写法（都只用分镜里已有的字段拼，App 里能照着写成代码；不手改任何一格的画面描述） ──
// C：参考图逐张标用途（官方 Seedance 指南「面部参考图片 1，妆造参考图片 2」的写法），外貌交给图、不再写外貌文字
const BIND3 = "图1是林夏的脸，图2是林夏的服装和身形，图3是沈舟";
const BIND_LIN = "图1是林夏的脸，图2是林夏的服装和身形";
const whoTag = (who) => (who.length === 0 ? "画面里没有人" : who.length === 1 ? `只有${who[0]}` : who.join("、"));
// 特写在 App 里能统一补的一句（按景别字段加，不改画面描述）
const SIZE_HINT = { 特写: "特写镜头，只拍局部，主体占满画面" };
const sizeOf = (s) => SIZE_HINT[s.size] ?? s.size;
/** 组图里一格的「有谁」：画面描述里已经点到全部在场的人、且不止一个时不再重复（省字数）；只有一个人的格子照写「只有某某」——描述里常带着画外的人（「目光落在林夏身上」） */
const groupWho = (s) => (s.who.length >= 2 && s.who.every((n) => s.picture.includes(n)) ? "" : `（${whoTag(s.who)}）`);
/** A：组图压短到 300 字上下（全局规则只说一次、不写外貌、正面写画幅）+ C */
const groupNew = (cells) =>
  `${BIND3}。按顺序生成${cells.length}张视频静帧，一张一个镜头：` +
  cells.map((s, i) => `${i + 1}.${s.size}，${s.picture}${groupWho(s)}`).join("；") +
  `。${LEAD}。每张竖版9:16、单个完整画面；每人在一张里只出现一次，不出现两个长相、着装一样的人；无文字。`;
/** B：空镜单画、不带人物图；图1 = 这一遍组图里第 1 格（只取地点 / 光线 / 画风） */
const emptyNew = (s) =>
  `图1只用来参考地点、光线、色调和画风，不要画出图1里的人。一张竖版9:16的视频静帧，单个完整画面：${s.size}，${s.picture}。${LEAD}。画面里没有任何人（没有人物、人影或剪影）；无文字。`;
/** B：特写单画、只带这一格的人 */
const closeNew = (s) => `${BIND_LIN}。一张竖版9:16的视频静帧，单个完整画面：${sizeOf(s)}：${s.picture}（${whoTag(s.who)}）。${LEAD}。无文字。`;
/** F + G：单格重画（标用途 + 正面写「整张是同一个连续的场景」、写清上下各是什么、去掉「上下留出呼吸空间」） */
const redrawNew = (s, ask) =>
  `${BIND3}。一张竖版9:16的视频静帧，整张是同一个连续的场景：${s.size}，${s.picture}（画面里只有${s.who.join("、")}）。${LEAD}。画面上方是场景的背景，下方是地面。要求：${ask}。每人只出现一次，不出现两个长相、着装一样的人；电影感光影，无文字。`;

const GROUP_CELLS = [1, 3, 4, 5, 7, 8].map(shot);
const PROMPTS = {
  oldGroup: OLD_GROUP_PROMPT,
  groupNew: groupNew(GROUP_CELLS),
  emptyNew: emptyNew(shot(2)),
  closeNew: closeNew(shot(6)),
  oldRedraw: OLD_REDRAW_PROMPT,
  redrawNew: redrawNew(shot(4), ASK),
};

// ── 计划：每一步一个 key，重跑时已经做过的跳过 ──
/** spec = 这一张图应该是什么样（看图核对拿它算对错） */
const spec = (s) => ({ cell: s.n, size: s.size, who: s.who });
function planFor(arm, model, run) {
  const tag = `${arm}-r${run}`;
  return [
    { key: `${tag}-group`, arm, model, kind: "group", prompt: PROMPTS.groupNew, refs: ["lin-face", "lin-body", "shen"], max: 6, cells: GROUP_CELLS.map(spec) },
    { key: `${tag}-empty`, arm, model, kind: "single", prompt: PROMPTS.emptyNew, refs: [`@${tag}-group#0`], spec: spec(shot(2)) },
    { key: `${tag}-close`, arm, model, kind: "single", prompt: PROMPTS.closeNew, refs: ["lin-face", "lin-body"], spec: spec(shot(6)) },
  ];
}
const PLAN = [];
if (ONLY.includes("arm1")) PLAN.push(...planFor("arm1", M_OLD, 1), ...planFor("arm1", M_OLD, 2));
if (ONLY.includes("arm2"))
  for (let i = 1; i <= 3; i++)
    PLAN.push(
      { key: `arm2-old-${i}`, arm: "arm2", model: M_OLD, kind: "single", prompt: PROMPTS.oldRedraw, refs: ["lin-face", "lin-body", "shen"], spec: spec(shot(4)) },
      { key: `arm2-new-${i}`, arm: "arm2", model: M_OLD, kind: "single", prompt: PROMPTS.redrawNew, refs: ["lin-face", "lin-body", "shen"], spec: spec(shot(4)) },
    );
if (ONLY.includes("arm4")) {
  PLAN.push(...planFor("arm4", M_NEW, 1), ...planFor("arm4", M_NEW, 2));
  for (let i = 1; i <= 3; i++)
    PLAN.push({ key: `arm4-new-${i}`, arm: "arm4", model: M_NEW, kind: "single", prompt: PROMPTS.redrawNew, refs: ["lin-face", "lin-body", "shen"], spec: spec(shot(4)) });
}
const maxImages = PLAN.reduce((n, p) => n + (p.kind === "group" ? p.max : 1), 0);

// ── 10-06 旧图的标准答案（人看过定的：第 2、3、4、6 格与重画②不合格；重画①是两个陌生人，数人数看不出来） ──
const OLD_TRUTH = [
  ...SHOTS.map((s, i) => ({ file: join(OLD, `g${i}.jpg`), key: `old-g${i + 1}`, spec: spec(s), truth: [2, 3, 4, 6].includes(s.n) ? "fail" : "pass" })),
  { file: join(OLD, "redraw4-norefs.jpg"), key: "old-redraw-norefs", spec: spec(shot(4)), truth: "pass" },
  { file: join(OLD, "redraw4-refs.jpg"), key: "old-redraw-refs", spec: spec(shot(4)), truth: "fail" },
];

if (!REAL) {
  for (const [k, p] of Object.entries(PROMPTS)) console.log(`[dry] ${k}（${[...p].length} 字）：${p}\n`);
  for (const p of PLAN) console.log(`[dry] ${p.key} ${p.model} ${p.kind}${p.kind === "group" ? ` max ${p.max}` : ""} refs=${p.refs.join(",")}`);
  console.log(`[dry] 计划出图最多 ${maxImages} 张（刊例 ≤ ¥${(maxImages * 0.2).toFixed(2)}）；看图核对 ${OLD_TRUTH.length} 张旧图 + 新图。没发任何请求。`);
  process.exit(0);
}

// ── 记账：每一步落盘，重跑可接 ──
const LOG = join(OUT, "grid-fix.log.json");
const state = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : { steps: {}, judge: {} };
const save = () => writeFileSync(LOG, JSON.stringify(state, null, 1));
const refData = (r) => {
  if (r.startsWith("@")) {
    const [key, idx] = r.slice(1).split("#");
    const ims = state.steps[key]?.images ?? [];
    const im = ims.find((x) => x.index === Number(idx)) ?? ims[0];
    if (!im?.file) return null;
    return dataUrl(join(OUT, im.file));
  }
  return dataUrl({ "lin-face": LIN_FACE, "lin-body": LIN_BODY, shen: SHEN }[r]);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 请求没发出去（连不上）才自动重试；发出去了没收到回包的不重试（方舟可能已经画了、计了费） */
const notSent = (e) => /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e?.cause?.code ?? e?.code ?? ""));
async function post(body, stream) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/images/generations`, { method: "POST", headers: { ...H, ...(stream ? { Accept: "text/event-stream" } : {}) }, body: JSON.stringify(body) });
    } catch (e) {
      if (notSent(e) && attempt < 3) {
        await sleep(5000);
        continue;
      }
      return { noReply: String(e?.cause?.code ?? e) };
    }
    // 429 / 5xx：方舟没受理（不计费），等一会儿重试
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await res.text().catch(() => "");
      await sleep(20000 * (attempt + 1));
      continue;
    }
    return { res };
  }
}
async function download(url, name) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        writeFileSync(join(OUT, name), Buffer.from(await r.arrayBuffer()));
        return name;
      }
    } catch {}
    await sleep(3000);
  }
  return null;
}
async function runSingle(p) {
  const refs = p.refs.map(refData);
  if (refs.some((r) => !r)) return { status: "skipped", why: "参考图那一步没有图" };
  const body = { model: p.model, prompt: p.prompt, image: refs.length === 1 ? refs[0] : refs, size: SIZE, watermark: false, response_format: "url", sequential_image_generation: "disabled" };
  const t0 = Date.now();
  const { res, noReply } = await post(body, false);
  if (noReply) return { status: "noReply", error: noReply, ms: Date.now() - t0 };
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { status: `http${res.status}`, error: j.error, ms: Date.now() - t0 };
  const url = j.data?.[0]?.url;
  const file = url ? await download(url, `${p.key}.jpg`) : null;
  return { status: "ok", ms: Date.now() - t0, usage: j.usage, files: file ? [file] : [], urls: url ? [url] : [] };
}
async function runGroup(p) {
  const refs = p.refs.map(refData);
  const body = { model: p.model, prompt: p.prompt, image: refs, size: SIZE, watermark: false, response_format: "url", sequential_image_generation: "auto", sequential_image_generation_options: { max_images: p.max }, stream: true };
  const t0 = Date.now();
  const { res, noReply } = await post(body, true);
  if (noReply) return { status: "noReply", error: noReply, ms: Date.now() - t0 };
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    return { status: `http${res.status}`, error: t.slice(0, 400), ms: Date.now() - t0 };
  }
  const images = [];
  const failures = [];
  let usage = null;
  let completed = false;
  let streamError = null;
  const take = (raw) => {
    if (raw === "[DONE]") return;
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const type = String(ev.type ?? "");
    if (type.endsWith("partial_succeeded") && ev.url) images.push({ index: ev.image_index ?? images.length, url: ev.url, at: Date.now() - t0 });
    else if (type.endsWith("partial_failed")) failures.push({ index: ev.image_index, error: ev.error });
    else if (type.endsWith("completed")) {
      completed = true;
      usage = ev.usage ?? null;
    } else if (ev.error) streamError = ev.error;
  };
  try {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let data = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          if (data.length) take(data.join("\n"));
          data = [];
        } else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (data.length) take(data.join("\n"));
  } catch (e) {
    streamError = streamError ?? { code: "INTERRUPTED", message: String(e?.cause?.code ?? e) };
  }
  images.sort((a, b) => a.index - b.index);
  for (const im of images) im.file = await download(im.url, `${p.key}-${im.index + 1}.jpg`);
  return { status: images.length ? "ok" : "failed", completed, ms: Date.now() - t0, usage, images, files: images.map((i) => i.file).filter(Boolean), failures, streamError };
}

if (PLAN.length) {
  // 同时最多 4 发（四遍组图各要几分钟；退役中的 4.0 配额在被下调，别一次全压上去）
  const todo = PLAN.filter((p) => !state.steps[p.key]);
  let active = 0;
  const queue = [...todo];
  await new Promise((resolveAll) => {
    const pump = () => {
      if (!queue.length && active === 0) return resolveAll();
      while (active < 4 && queue.length) {
        // 依赖组图第 1 格的空镜要等那一遍组图落地
        const i = queue.findIndex((p) => p.refs.every((r) => !r.startsWith("@") || state.steps[r.slice(1).split("#")[0]]));
        if (i < 0) break;
        const p = queue.splice(i, 1)[0];
        active++;
        (async () => {
          console.log(`→ ${p.key}`);
          const r = p.kind === "group" ? await runGroup(p) : await runSingle(p);
          state.steps[p.key] = { ...r, model: p.model, kind: p.kind, prompt: p.prompt, refs: p.refs, spec: p.spec, cells: p.cells };
          save();
          console.log(`← ${p.key} ${r.status} ${r.ms ?? ""}ms images=${r.files?.length ?? 0} usage=${JSON.stringify(r.usage ?? null)}${r.error ? " err=" + JSON.stringify(r.error).slice(0, 200) : ""}`);
          active--;
          pump();
        })();
      }
      if (active === 0 && queue.length) {
        // 剩下的都在等一个没出图的组图：记成跳过
        for (const p of queue.splice(0)) state.steps[p.key] = { status: "skipped", why: "依赖的那一遍组图没有图", model: p.model, kind: p.kind, prompt: p.prompt, refs: p.refs, spec: p.spec };
        save();
        resolveAll();
      }
    };
    pump();
  });
}

// ── 看图核对 ──
const SHOT_RANK = { 远景: 0, 全景: 1, 中景: 2, 近景: 3, 特写: 4 };
// ★ 2026-10-07 那一次就是照下面这段跑的：JSON 样子里的「景别」「note」没写成带引号的字符串，模型 51 次里有 7 次照抄成 `"shot": 全景`，
//   JSON.parse 读不出来（当时按原文宽松解析才救回来，判定见 docs/seedream-grid-fix-research.md 第七节）。再用时把样子写成 `"shot": "远景"` 这种。
//   另：判定里景别那一条误报 6 次、一次都没多抓到（不合格的都是人数 / 两个一样的人 / 分格），「有字」会把站名牌、信纸都算进去 —— 都别进判定。
const JUDGE_SYS =
  "你是视频分镜画面的质检员。只按这一张图里实际看到的回答，不要猜。只输出一个 JSON 对象，不要别的字：" +
  '{"panels": 画面被边框或明显分界线分成了几格（单个完整画面就是 1）, "people": 画面里一共能看到几个人（背影、侧影、远处很小的人都算；只露出手或身体局部的也算 1 个；没有人就是 0）, ' +
  '"duplicate": 有没有两个长相、发型、衣着几乎一样的人同时出现（true 或 false）, "shot": 景别，只能是 远景、全景、中景、近景、特写 之一, ' +
  '"text": 画面里有没有文字、字幕、对话框或水印（true 或 false）, "note": 一句话说画面里有谁、在做什么}';
function small(file) {
  const out = join(OUT, "judge-cache", file.replace(/[\\/:]/g, "_"));
  mkdirSync(join(OUT, "judge-cache"), { recursive: true });
  if (!existsSync(out)) execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=720:-2", "-q:v", "4", out]);
  return out;
}
function verdictOf(j, sp) {
  const why = [];
  if (!j) return { verdict: "unknown", why: ["读不出回话"] };
  if (Number(j.panels) > 1) why.push(`分成 ${j.panels} 格`);
  if (Number(j.people) !== sp.who.length) why.push(`${j.people} 个人（应 ${sp.who.length}）`);
  if (j.duplicate === true) why.push("有两个一样的人");
  if (j.text === true) why.push("有字");
  const a = SHOT_RANK[sp.size];
  const b = SHOT_RANK[j.shot];
  if (a !== undefined && b !== undefined && Math.abs(a - b) >= 2) why.push(`景别 ${j.shot}（应 ${sp.size}）`);
  return { verdict: why.length ? "fail" : "pass", why };
}
async function judgeOne(key, file, sp) {
  if (state.judge[key]?.raw) return state.judge[key];
  const img = dataUrl(small(file));
  const body = { model: CHAT, messages: [{ role: "system", content: JUDGE_SYS }, { role: "user", content: [{ type: "text", text: "看这张图。" }, { type: "image_url", image_url: { url: img } }] }], max_tokens: 300, thinking: { type: "disabled" } };
  let j = null;
  let raw = "";
  let usage = null;
  try {
    const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: H, body: JSON.stringify(body) });
    const o = await r.json();
    raw = o.choices?.[0]?.message?.content ?? JSON.stringify(o.error ?? o).slice(0, 300);
    usage = o.usage ?? null;
    const m = raw.match(/\{[\s\S]*\}/);
    j = m ? JSON.parse(m[0]) : null;
  } catch (e) {
    raw = raw || String(e);
  }
  const v = verdictOf(j, sp);
  state.judge[key] = { file, spec: sp, raw, usage, ...v };
  save();
  return state.judge[key];
}
if (ONLY.includes("judge")) {
  const items = [...OLD_TRUTH.map((o) => ({ key: o.key, file: o.file, spec: o.spec, truth: o.truth }))];
  for (const [key, st] of Object.entries(state.steps)) {
    if (st.status !== "ok") continue;
    // 组图第 k 张（image_index）对第 k 格：与 App 收组图的规则一致；某张没画出来时后面的不前移
    if (st.kind === "group") for (const im of st.images ?? []) im.file && st.cells?.[im.index] && items.push({ key: `${key}#${im.index + 1}`, file: join(OUT, im.file), spec: st.cells[im.index] });
    else if (st.files?.[0]) items.push({ key, file: join(OUT, st.files[0]), spec: st.spec });
  }
  for (let i = 0; i < items.length; i += 4) {
    const batch = items.slice(i, i + 4);
    await Promise.all(batch.map((it) => judgeOne(it.key, it.file, it.spec).then((r) => console.log(`judge ${it.key}: ${r.verdict}${it.truth ? `（标准答案 ${it.truth}）` : ""} ${r.why.join("，")}`))));
  }
}

// ── 小结 ──
const steps = Object.values(state.steps);
const images = steps.reduce((n, s) => n + (s.kind === "group" ? (s.usage?.generated_images ?? s.files?.length ?? 0) : s.status === "ok" ? 1 : 0), 0);
const chatIn = Object.values(state.judge).reduce((n, j) => n + (j.usage?.prompt_tokens ?? 0), 0);
const chatOut = Object.values(state.judge).reduce((n, j) => n + (j.usage?.completion_tokens ?? 0), 0);
console.log(`出图 ${images} 张（刊例 ¥${(images * 0.2).toFixed(2)}）；看图对话 ${Object.keys(state.judge).length} 次，输入 ${chatIn} / 输出 ${chatOut} token（刊例 ¥${((chatIn * 3 + chatOut * 15) / 1e6).toFixed(3)}）。读数在 ${LOG}`);
