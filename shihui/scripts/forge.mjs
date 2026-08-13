// 内容库预生成管线（MVP-0）：把内容库的诗逐句炼成真视频，落到 public/clips/。
//
// 用法（在 shihui/ 目录下）：
//   node scripts/forge.mjs --dry-run              # 只打印计划与预估成本，不花钱
//   node scripts/forge.mjs --poem jingyesi        # 只炼指定的诗（逗号分隔多首）
//   node scripts/forge.mjs                        # 炼整个内容库（先看清 dry-run 的总价！）
//   node scripts/forge.mjs --force                # 忽略已存在的产物重炼
//
// 设计（每处取舍都有出处，详见 docs/IDEA-REVIEW.md「技术方案」）：
// - 段间承接走「首尾帧锁定」而不是浏览器抽尾帧：1-0-pro 的 flf2v 会真拍到设定尾帧，
//   于是 下一段首帧 = 上一段设定尾帧（同一张图，逐字节相同），边界零跳变，
//   且整条管线纯 Node 可脚本化（浏览器抽帧那条路需要窗口可见，不适合批量跑）。
//   注：pro-fast 便宜 4 倍但**不支持尾帧锁定**（实测 400 flf2v not support），
//   要换它就得回到浏览器抽帧方案，别只改模型名。
// - 关键帧链式 i2i：每张尾帧都以上一张为参考图生成，锁住画风与场景延续。
// - 提示词里明确「画面中不要出现任何文字」：Seedream 极爱往水墨画上题字，
//   而 AI 题的字十有八九是错字，教育产品不能赌。
// - 产物（TOS 域 URL 24h 失效）立刻下载落盘；脚本可续跑（存在即跳过）。
// - 敏感词 400 = 整个请求失败不是降级（主仓实测）：报清楚是哪首哪句，跳过该诗继续。
import { mkdir, readFile, writeFile, readdir, access, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "clips");
const ARK = "https://ark.cn-beijing.volces.com/api/v3";

// 模型与参数（与主仓 arkClient 同源的实测值）
const MODEL_IMG = process.env.FORGE_IMG_MODEL || "doubao-seedream-5-0-260128"; // ¥0.60/张（我们的尺寸超 261 万 px）
const MODEL_VID = process.env.FORGE_VID_MODEL || "doubao-seedance-1-0-pro-250528"; // 15元/M token
const FRAME_SIZE = "1440x2560"; // 9:16 竖屏，恰为 Seedream 最小合法面积（总像素 ≥ 3,686,400）
const DURATION = 5; // 秒。5s/720p ≈ 10.4 万 token ≈ ¥1.6/段；一年级孩子念一句 + 缓冲够用
const COST_IMG = 0.6;
const COST_SEG = 1.6;

// 风格串的唯一出处在 src/ai/inkStyle.json（与创作侧 real.ts 共用，一处实现）
const ink = JSON.parse(await readFile(path.join(ROOT, "src", "ai", "inkStyle.json"), "utf8"));
const STYLE = ink.style;

// ---------- 参数与环境 ----------
// ★ 解析必须严格：这个脚本的参数错误不是"用法提示"级别的事——`--poem=xx` 被静默忽略的
//   后果是范围扩成整库、一次烧掉约 ¥190。所以：支持空格与等号两种写法；`--poem` 后面
//   缺值直接报错退出；不认识的参数一律拒绝，不猜。
const argv = process.argv.slice(2);
const KNOWN = new Set(["--dry-run", "--force", "--all", "--poem"]);
const opts = { poem: undefined };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const eq = a.indexOf("=");
  const name = eq >= 0 ? a.slice(0, eq) : a;
  if (!KNOWN.has(name)) {
    console.error(`不认识的参数：${a}\n用法：node scripts/forge.mjs [--dry-run] [--force] [--poem id[,id]] [--all]`);
    process.exit(1);
  }
  if (name === "--poem") {
    const v = eq >= 0 ? a.slice(eq + 1) : argv[++i];
    if (!v || v.startsWith("--")) {
      console.error("--poem 后面要跟诗的 id（逗号分隔多首）");
      process.exit(1);
    }
    opts.poem = v.split(",");
  } else {
    opts[name.slice(2)] = true;
  }
}
const DRY = !!opts["dry-run"];
const FORCE = !!opts.force;
const ONLY = opts.poem;

async function arkKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  // 复用 vite 的约定：密钥在 shihui/.env.local（gitignore 兜底已验证）。
  // dotenv 语法允许引号包值，剥掉——带引号的 key 发出去是 401，错得莫名其妙
  try {
    const env = await readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = /^ARK_API_KEY=(.+)$/m.exec(env);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* 落到下面的报错 */
  }
  throw new Error("没有 ARK_API_KEY：配在 shihui/.env.local 或环境变量里");
}

// 内容库直接从 TS 源里抠（不引打包器）：POEMS 是纯数据字面量，用括号配平切出数组求值。
// 若未来 poems.ts 里出现依赖打包器的语法，这里会以报错的方式立刻暴露（失败要响）。
async function loadPoems() {
  const src = await readFile(path.join(ROOT, "src", "data", "poems.ts"), "utf8");
  const start = src.indexOf("export const POEMS");
  // ★ 必须从赋值号之后找 "["：声明是 `POEMS: Poem[] = [`，直接 indexOf("[") 会先撞上
  //   类型标注 Poem[] 的方括号，切出一个空数组——而空数组是"合法"的，静默错到底
  const open = src.indexOf("[", src.indexOf("=", start));
  let depth = 0;
  let inStr = ""; // 当前字符串定界符；括号扫描要跳过字符串字面量里的 [ ]
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === inStr) inStr = "";
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      // 行注释里的引号/括号都不算数（"孩子的诗"这类注释文案里最容易出现）
      i = src.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      // eslint-disable-next-line no-new-func
      const poems = new Function(`return ${src.slice(open, i + 1)}`)();
      if (!Array.isArray(poems) || !poems.length) throw new Error("解析 poems.ts 得到空库");
      return poems;
    }
  }
  throw new Error("解析 poems.ts 失败：POEMS 数组不完整");
}

// ---------- Ark 调用（形状照抄主仓 arkClient，那边全部实测过） ----------
let KEY = "";
async function ark(pathName, body, timeoutMs = 120_000) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ARK}${pathName}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // 429 = 限流、请求未受理，退避一次再试（与主仓 arkClient 同策略）——
    // 批量脚本两路并发，最容易撞的就是这个
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Ark ${pathName} ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }
}

async function genImage(prompt, refDataUrl) {
  const body = {
    model: MODEL_IMG,
    prompt,
    size: FRAME_SIZE,
    response_format: "url",
    watermark: false,
  };
  if (refDataUrl) body.image = refDataUrl;
  const out = await ark("/images/generations", body);
  const url = out.data?.[0]?.url;
  if (!url) throw new Error("Seedream 未返回图片");
  return url;
}

async function genVideo(prompt, firstDataUrl, lastDataUrl, tag) {
  const created = await ark("/contents/generations/tasks", {
    model: MODEL_VID,
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: firstDataUrl }, role: "first_frame" },
      { type: "image_url", image_url: { url: lastDataUrl }, role: "last_frame" },
    ],
    resolution: "720p",
    ratio: "9:16", // 画幅只由这个参数决定；帧是竖的也拦不住它按 16:9 出片再裁（主仓踩过）
    duration: DURATION,
    generate_audio: false,
    watermark: false,
  });
  // id 缺失时轮询会打到 /tasks/undefined 恒 404，十分钟后报成"超时"——在这就掐断
  if (!created.id) throw new Error(`Seedance 创建未返回 id: ${JSON.stringify(created).slice(0, 200)}`);
  const t0 = Date.now();
  let pollFails = 0;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    let st;
    try {
      st = await ark(`/contents/generations/tasks/${created.id}`, undefined, 20_000);
      pollFails = 0;
    } catch (e) {
      // 单次抖动不弃单（视频已在云端排队，白扔太亏），但连续失败要抛真实原因——
      // 否则断网/密钥失效会退化成"每段盲等 10 分钟后报超时"，把人往错误方向带
      if (++pollFails >= 5) throw e;
      continue;
    }
    process.stdout.write(`\r  ${tag} ${st.status} ${Math.round((Date.now() - t0) / 1000)}s   `);
    if (st.status === "succeeded") {
      process.stdout.write("\n");
      const url = st.content?.video_url;
      if (!url) throw new Error("Seedance 成功但无 video_url");
      return url;
    }
    if (st.status === "failed" || st.status === "cancelled") {
      process.stdout.write("\n");
      throw new Error(`Seedance ${st.status}: ${st.error?.message ?? ""}`);
    }
  }
  throw new Error("Seedance 超时（10 分钟）");
}

// TOS 产物 24h 失效 → 立刻落盘。Node 直连没有浏览器的 CORS 问题，不需要代理。
// ① 重试 3 次：钱在任务 succeeded 那一刻已经花了，最后一步下载抖一下就丢 URL 等于重炼重付；
// ② 先写 .part 再改名：续跑逻辑靠"文件存在=完好"，Ctrl+C 留下的半截文件会把整条链坐实成坏帧。
async function download(url, file) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url.slice(0, 80)}`);
      await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
      await rename(`${file}.part`, file);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

const exists = (f) => access(f).then(() => true, () => false);
const asDataUrl = async (file) => `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}`;

// ---------- 单首诗的流水线 ----------
async function forgePoem(poem) {
  const dir = path.join(OUT, poem.id);
  await mkdir(dir, { recursive: true });
  const N = poem.lines.length;
  console.log(`\n《${poem.title}》 ${N} 句`);

  const sceneOf = (i) =>
    poem.lines[i].scene ?? `${poem.lines[i].gloss}，画面元素：${poem.lines[i].keywords.join("、")}`;

  // 关键帧链：f0 = 第一句的起始帧；t{i} = 第 i 句的收束帧（也是第 i+1 句的首帧）
  const frameFile = (i) => path.join(dir, i === 0 ? "f0.jpg" : `t${i - 1}.jpg`);
  for (let i = 0; i <= N; i++) {
    const file = frameFile(i);
    if (!FORCE && (await exists(file))) continue;
    const scene = sceneOf(Math.min(i === 0 ? 0 : i - 1, N - 1));
    const prompt =
      i === 0
        ? `${STYLE} ${scene}`
        : `${STYLE} 与参考图完全同一场景、同一画风的延续画面，镜头缓缓收束定格：${scene}`;
    const ref = i === 0 ? undefined : await asDataUrl(frameFile(i - 1));
    console.log(`  帧 ${i}/${N} 生成中…`);
    await download(await genImage(prompt, ref), file);
  }

  // 视频段：seg{i} = flf2v(帧 i → 帧 i+1)。帧已就绪，段与段无依赖，两路并行
  const jobs = [];
  for (let i = 0; i < N; i++) {
    const file = path.join(dir, `seg${i}.mp4`);
    if (!FORCE && (await exists(file))) continue;
    jobs.push(async () => {
      // URL 旁车：钱在任务 succeeded 那一刻已花，若上次跑在"下载"这最后一步崩了，
      // 24h 内续跑先试旧 URL 直接取，不再创建任务重付。过期就自然退回重炼。
      const urlFile = `${file}.url`;
      if (!FORCE && (await exists(urlFile))) {
        try {
          await download((await readFile(urlFile, "utf8")).trim(), file);
          return;
        } catch {
          /* 旁车过期，走正常重炼 */
        }
      }
      const [first, last] = await Promise.all([asDataUrl(frameFile(i)), asDataUrl(frameFile(i + 1))]);
      const prompt = `${ink.motion} 画面内容：${sceneOf(i)}`;
      const url = await genVideo(prompt, first, last, `段 ${i + 1}/${N}`);
      await writeFile(urlFile, url);
      await download(url, file);
    });
  }
  // 并行度 2：礼貌起见，也避免账号级限流（429）。
  // allSettled 而不是 all：一路失败时另一路的任务钱已经花出去了，让它跑完落盘，
  // 失败的段留给续跑补（存在即跳过），最后统一抛
  const errs = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const batch = await Promise.allSettled(jobs.slice(i, i + 2).map((j) => j()));
    errs.push(...batch.filter((b) => b.status === "rejected").map((b) => b.reason));
  }
  if (errs.length) throw new Error(errs.map((e) => e.message).join("；"));
}

// manifest 以磁盘为准重扫（而不是记流水账）：续跑/手删文件后它仍然是对的
async function writeManifest(poems) {
  const manifest = { generatedAt: new Date().toISOString(), model: MODEL_VID, poems: {} };
  for (const p of poems) {
    const dir = path.join(OUT, p.id);
    try {
      const files = await readdir(dir);
      const segs = [];
      for (let i = 0; i < p.lines.length; i++) {
        if (!files.includes(`seg${i}.mp4`)) break; // 只登记连续完整的前缀：中断的诗不给半截体验
        segs.push({
          video: `/clips/${p.id}/seg${i}.mp4`,
          poster: `/clips/${p.id}/${i === 0 ? "f0.jpg" : `t${i - 1}.jpg`}`,
        });
      }
      if (segs.length === p.lines.length) manifest.poems[p.id] = { segments: segs };
    } catch {
      /* 该诗未生成 */
    }
  }
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest：${Object.keys(manifest.poems).length} 首完整可播`);
}

// ---------- 主流程 ----------
// 已知不支持首尾帧锁定的模型直接拒绝：pro-fast 收到 flf2v 是 400（实测），
// 2.5 的首尾帧任务只收 ratio=adaptive 而本脚本发 9:16——换这两款不是改个环境变量的事
if (/pro-fast|seedance-2-5/.test(MODEL_VID)) {
  console.error(`FORGE_VID_MODEL=${MODEL_VID} 不适配本管线（首尾帧锁定），见脚本头注释`);
  process.exit(1);
}

const all = await loadPoems();
if (ONLY) {
  const known = new Set(all.map((p) => p.id));
  const bad = ONLY.filter((id) => !known.has(id));
  if (bad.length) {
    console.error(`不认识的诗 id：${bad.join(", ")}\n可选：${all.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }
}
const targets = ONLY ? all.filter((p) => ONLY.includes(p.id)) : all;

// 预估只算"还缺的"：续跑场景下按全量报价会把人吓退（或诱导错误决策）
let nSeg = 0;
let nImg = 0;
for (const p of targets) {
  const dir = path.join(OUT, p.id);
  for (let i = 0; i <= p.lines.length; i++) {
    const f = path.join(dir, i === 0 ? "f0.jpg" : `t${i - 1}.jpg`);
    if (FORCE || !(await exists(f))) nImg++;
  }
  for (let i = 0; i < p.lines.length; i++) {
    if (FORCE || !(await exists(path.join(dir, `seg${i}.mp4`)))) nSeg++;
  }
}
console.log(
  `计划：${targets.length} 首，待生成 ${nSeg} 段视频 + ${nImg} 张关键帧` +
    `，预估 ≈ ¥${(nSeg * COST_SEG + nImg * COST_IMG).toFixed(1)}` +
    `（帧 ¥${COST_IMG}/张 + 段 ¥${COST_SEG}/段@5s720p；已有产物已扣除）`,
);
if (DRY) process.exit(0);
// 整库是一笔真钱（全新跑约 ¥190），必须显式说"我就是要全跑"
if (!ONLY && !opts.all) {
  console.error("要跑整个内容库请加 --all（或用 --poem 指定范围；先 --dry-run 看价）");
  process.exit(1);
}

KEY = await arkKey();
let failed = 0;
for (const p of targets) {
  try {
    await forgePoem(p);
  } catch (e) {
    // 敏感词 400 等按诗隔离：报清楚哪首坏了，别把整批拖死（失败要响且局部）
    failed++;
    console.error(`\n《${p.title}》失败：${e.message}`);
  }
}
await writeManifest(all);
if (failed) {
  console.error(`\n${failed} 首未完成，续跑同一条命令可补（已有产物不重花）`);
  process.exitCode = 1; // 自动化（CI/发版脚本）要能感知到"没炼全"
}
