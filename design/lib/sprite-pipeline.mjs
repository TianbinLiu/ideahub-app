// 逐帧精灵图流水线：Seedream 出 A/B 两个端点姿势 → Seedance 首尾帧补中间动作 →
// 抽帧 → 绿幕抠图 → 统一裁切框 → 横向拼接成 WebP。
//
// ★ 为什么单独一个模块：现在有三个脚本走同一条流水线——
//     design/gen-mascot-sprites.mjs   工作流页中央的正片演出（handover / forge / …）
//     design/gen-discover-icons.mjs   分区页六个分区图标（Q 版 + 分区道具）
//     design/gen-createbtn-sprites.mjs 底栏 ➕ 上那几套 Q 版看板娘
//   下面那些阈值（DOM_BG/DOM_FG=85/35、连通块面积 0.1%、alpha 高斯 σ=2.5）全是量出来的，
//   抄三份的结局一定是三份各自漂（铁律六）。要调就只调这一处。
//
// ★ 不是帧插值。RIFE/FILM 这类只能在两帧之间做形变，手臂会「融化」着平移；
//   视频模型会生成合理的运动弧线（手臂沿弧线抬起、头发跟着甩）。踩坑记录见
//   public/perch/README.md 与 public/mascot/README.md。
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

// ── 角色与画风 ──────────────────────────────────────────────────────────
// ★ 与 design/gen-create-covers.mjs 逐字一致，一个字都不要改。
//   她是全 app 同一个人（/create 三张封面、工坊里的铸卡师 NPC、底栏挂件都是她），
//   改了这里就等于全线换人。
export const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";

export const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";

/** Q 版画风：给 40–56px 的小图标用。正片那套脸缩到这个尺寸就是一团糊。 */
export const Q_STYLE =
  "Q版卡通贴纸风格，二头身比例，大头小身，干净的线条与赛璐璐上色，柔和的边缘光，色彩通透明亮，作画精致。";

/** 视频段共用的镜头约束。不写这些，模型会自己加推拉摇移，抽出来的帧角色忽大忽小。 */
export const SHOT =
  "镜头完全静止不动，没有任何推拉摇移与变焦；角色始终保持在画面正中，大小与位置完全不变；" +
  "背景始终是纯正绿色 #00FF00，绝对不变。只有描述中提到的部位在动。";

/** Q 版取景与绿幕要求。★ 绿幕、居中、不变形三条必须每张都写，漏一条抠出来就是废片。 */
export const Q_STAGE =
  "构图：正方形画幅，角色连同手里的道具一起居中，占画面高度约八成，半身入镜（到腰部，不画腿）。" +
  // ★ 这几句是 cardbtn 那轮补的：第一版只说「拿着一块牌」，模型就把道具画成一整块挡板，
  //   躯干和双臂整个消失、手退化成两个圆球贴在道具边缘上，缩到 42px 只剩一团色块。
  //   道具尺寸、可见部位、手指、服装四件事都得逐条写死，模型不会自己补。
  "道具的宽度不超过角色肩宽的一半，绝不能遮住她的肩膀与手臂；" +
  "必须完整画出上半身与两条手臂，双手要画出清晰可辨的五根手指，绝对不要把手画成圆球或省略手指；" +
  "服装细节必须清晰：深蓝色立领短披风搭在肩上、披风领口正中一枚金色圆扣、内搭白色衬衫的立领与袖口、浅灰色百褶裙；" +
  "背景是纯正绿色 #00FF00 的纯色背景，绝对均匀，无渐变、无阴影、无图案、无任何其他物体。" +
  "重要：双眼形状左右对称。无任何文字、字母、数字、水印、UI 元素、边框。";

// ── 环境 ────────────────────────────────────────────────────────────────

/** 从 .env.local 读 ARK_API_KEY。★ 不接受命令行传 key：粘进 shell 历史就是泄露（铁律三）。 */
export function loadKey(root) {
  const env = readFileSync(resolve(root, ".env.local"), "utf8");
  const key = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
  if (!key) {
    console.error("ARK_API_KEY 未配置（仓库根目录的 .env.local）");
    process.exit(1);
  }
  return key;
}

/** sharp 与 ffmpeg-static 是一次性工具，刻意不进项目依赖——它们只在重出贴图时用得上，
 *  进 dependencies 会让每个装 App 的人都下载一份 60MB 的原生二进制。 */
export function loadTools() {
  const dir = process.env.IMGTOOLS;
  if (!dir) {
    console.error("需要 IMGTOOLS=<装了 sharp 与 ffmpeg-static 的目录>（一次性工具，刻意不进项目依赖）");
    process.exit(1);
  }
  const req = createRequire(resolve(dir, "package.json"));
  return { sharp: req("sharp"), ffmpeg: req("ffmpeg-static") };
}

// ── 方舟 ────────────────────────────────────────────────────────────────

/**
 * ★ 429 要退避重试，不能直接抛。这几个脚本可以并行跑（六个分区图标 + 四套按钮 + 正片），
 *   一撞限流就整条挂掉的话，前面已经花掉的出图钱会连着这一轮全部作废——
 *   缓存是按 pose 存的，半途死在 Seedance 那步，A/B 两张图的钱仍然白花。
 *   退避到 60s 上限、最多 5 次；仍然失败才抛（响且局部，铁律八）。
 */
function makeArk(key) {
  return async function ark(path, body, timeoutMs = 180_000) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://ark.cn-beijing.volces.com/api/v3${path}`, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) return j;
      if (res.status === 429 && attempt < 5) {
        const wait = Math.min(60_000, 5000 * 2 ** attempt) + Math.random() * 2000;
        console.log(`   429 限流，${Math.round(wait / 1000)}s 后重试（第 ${attempt + 1} 次）`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`${path} ${res.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
    }
  };
}

async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── 绿幕抠图 ────────────────────────────────────────────────────────────
// 判定用「绿色优势度」dom = g - max(r,b)，不是「颜色接近纯绿」——
// AI 出的背景常有轻微明暗不匀，卡死一个 RGB 值会留一圈杂边。
//
// ★ 阈值是量出来的，不是抄 perch 那套静态图的 130/50。视频抽帧比静态图多一层
//   H.264 的账：色度二次采样会在高对比边缘糊出一片**宏块**，dom 落在 50~140，
//   照 130/50 会让它们拿到 alpha 64~159，成品上就是发丝周围一圈方格状白渣。
//   收到 85/35 后宏块整块归零，而 ≤35 的角色本体（薄荷挑染最高 ~26）一根头发都没少。
const DOM_BG = 85;
const DOM_FG = 35;

/**
 * 只保留够大的连通块。
 * ★ 光靠 dom 阈值杀不干净：编码器还会在角落糊出**灰白色**的宏块，它们 dom≈0，
 *   在颜色判据下是彻头彻尾的"前景"。但角色（连同道具）是一整块连通域，
 *   孤立的小块必然是脏东西 —— 按连通块面积筛比继续调颜色阈值稳得多。
 */
function dropSpecks(alpha, w, h, minArea) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blob = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || alpha[s] <= 16) continue;
    let sp = 0;
    let n = 0;
    stack[sp++] = s;
    seen[s] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      blob[n++] = p;
      const x = p % w;
      // 4 邻接够用，且比 8 邻接少一半分支——斜着搭一格的宏块本来就该被切开
      if (x > 0 && !seen[p - 1] && alpha[p - 1] > 16) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && alpha[p + 1] > 16) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (p >= w && !seen[p - w] && alpha[p - w] > 16) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (p < w * h - w && !seen[p + w] && alpha[p + w] > 16) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (n < minArea) for (let k = 0; k < n; k++) alpha[blob[k]] = 0;
  }
}

/** 返回 { data(RGBA), w, h, box, hist } */
async function keyGreen(sharp, buf) {
  const img = sharp(buf).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const out = Buffer.alloc(w * h * 4);
  const alpha = new Uint8Array(w * h);
  const hist = new Array(9).fill(0); // dom 分布，用来核对阈值是不是还站得住
  for (let i = 0, p = 0; i < w * h; i++, p += channels) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const dom = g - Math.max(r, b);
    hist[Math.max(0, Math.min(8, Math.floor((dom + 40) / 30)))]++;
    let a = 255, gg = g;
    if (dom >= DOM_BG) a = 0;
    else if (dom > DOM_FG) {
      a = Math.round((255 * (DOM_BG - dom)) / (DOM_BG - DOM_FG));
      gg = Math.max(r, b); // 去绿溢色，只在过渡带做（角色本体的薄荷挑染不能碰）
    }
    const o = i * 4;
    out[o] = r; out[o + 1] = gg; out[o + 2] = b;
    alpha[i] = a;
  }
  // 面积门槛按画幅比例给：换分辨率时不用重调（1440² 下约 2000px，一个宏块才 256px）
  dropSpecks(alpha, w, h, Math.round(w * h * 0.001));

  // ★ 只糊 alpha，不碰颜色。
  //   画风里那圈「柔和的边缘光」（STYLE 里点名要的）落在绿幕上就是一圈半透明过渡带，
  //   而 H.264 把这条平滑渐变压成了一格一格的宏块 —— 于是每个宏块一个透明度台阶，
  //   在深色背景上看过去就是发丝周围一片棋盘格。颜色本身是好的，坏的只有 alpha 的台阶。
  //   σ=2.5 是量着调的：1.5 还看得见格子，4 会把发梢糊成一团棉花。
  //
  // ★ 必须按 info.channels 取步长，不能默认 1：sharp 的 blur 收 1 通道 raw 时
  //   **吐回 3 通道**（实测 8×4 的灰度图进去、96 字节出来）。按 1 通道下标读的话，
  //   读到的是图像上三分之一的 R 值当成整张的 alpha —— 表现为一块与人物毫无关系的
  //   拱形区域被留了下来（绿幕没抠干净），而颜色本身完全正常，极难往"通道数"上想。
  const sm = await sharp(Buffer.from(alpha), { raw: { width: w, height: h, channels: 1 } })
    .blur(2.5)
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const st = sm.info.channels;
  for (let i = 0; i < w * h; i++) {
    const v = sm.data[i * st];
    alpha[i] = v <= 60 ? 0 : Math.min(255, Math.round(((v - 60) * 255) / 195));
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    out[i * 4 + 3] = alpha[i];
    if (alpha[i] > 16) {
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("整帧都被判成背景了——绿幕阈值不对");
  return { data: out, w, h, box: { x0, y0, x1, y1 }, hist };
}

function unionBox(boxes) {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────

/**
 * 跑一组姿势，产出 `<outDir>/<key>.webp`，返回 [{ pose, w, h, frames, kb }]。
 *
 * @param root      仓库根目录（读 .env.local 与 design/character-ref.jpg）
 * @param outDir    相对仓库根的产物目录，如 "public/mascot"
 * @param srcDir    相对仓库根的中间产物缓存目录（不入仓），如 "design/mascot-src"
 * @param poses     姿势表，每项 { key, a, b, motion, frames?, cell?, style?, stage?, q?, aFrom? }
 * @param only      只跑这几个 key（命令行第二个参数，逗号分隔）
 * @param defaults  { style, stage, cell, frames, videoSec }
 *
 * 姿势字段：
 *   a/b     两个端点姿势的描述；**b 以 a 为参考图生成**，否则两端会长成两个人
 *   aFrom   A 端点直接复用另一姿势的 B 帧（做多段连续动作时接得上）
 *   q       true = Q 版（参考图取 perch/save.webp 的第 8 帧，见 qRef）
 *   frames  抽几帧。8 帧摊在 1.5 秒里只有 5fps，真机上是一格一格地跳；
 *           **循环播的动作给 16**。停住之后的呼吸/浮动交给 CSS transform 做 60fps，
 *           堆帧堆不出那个效果，只会把包撑大。
 */
export async function buildSprites({ root, outDir, srcDir, poses, only, defaults = {} }) {
  const { sharp, ffmpeg } = loadTools();
  const ark = makeArk(loadKey(root));
  const CELL_W = defaults.cell ?? 420;
  const FRAMES_D = defaults.frames ?? 8;
  const VIDEO_SEC = defaults.videoSec ?? 3;

  /** Seedream。size 取正方形且总像素 ≥3,686,400（方舟下限，见 src/ai/arkClient.ts 的实测注释） */
  async function seedream(prompt, ref) {
    const j = await ark("/images/generations", {
      model: "doubao-seedream-5-0-260128",
      prompt,
      size: "1920x1920",
      response_format: "url",
      watermark: false,
      ...(ref ? { image: ref } : {}),
    });
    const url = j.data?.[0]?.url;
    if (!url) throw new Error("Seedream 未返回图片");
    return url;
  }

  /** Seedance 首尾帧。ratio 必须 1:1——默认 16:9 会把方形角色图裁掉两边（README 记过） */
  async function seedance(prompt, firstUrl, lastUrl, label) {
    const created = await ark("/contents/generations/tasks", {
      model: "doubao-seedance-1-0-pro-250528",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: firstUrl }, role: "first_frame" },
        { type: "image_url", image_url: { url: lastUrl }, role: "last_frame" },
      ],
      resolution: "1080p",
      ratio: "1:1",
      duration: VIDEO_SEC,
      generate_audio: false,
      watermark: false,
    });
    const t0 = Date.now();
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const st = await ark(`/contents/generations/tasks/${created.id}`, null, 30_000);
      const sec = Math.round((Date.now() - t0) / 1000);
      if (st.status === "succeeded") {
        const url = st.content?.video_url;
        if (!url) throw new Error("Seedance 成功但无视频 URL");
        console.log(`   [${label}] 视频就绪 ${sec}s`);
        return url;
      }
      if (st.status === "failed" || st.status === "cancelled") {
        throw new Error(`Seedance ${st.status}: ${st.error?.message ?? ""}`);
      }
      if (i % 4 === 0) console.log(`   [${label}] ${st.status} ${sec}s`);
    }
    throw new Error("Seedance 超时");
  }

  const absOut = resolve(root, outDir);
  const absSrc = resolve(root, srcDir);
  mkdirSync(absOut, { recursive: true });
  mkdirSync(absSrc, { recursive: true });
  // 中间产物（A/B 帧、mp4、抽帧）几十 MB，缓存下来是为了重跑不重复烧钱，但不入仓
  writeFileSync(join(absSrc, ".gitignore"), "*\n!.gitignore\n");

  const refPath = resolve(root, "design/character-ref.jpg");
  if (!existsSync(refPath)) {
    console.error("缺 design/character-ref.jpg（定妆照）——先跑一次 design/gen-create-covers.mjs");
    process.exit(1);
  }
  // 参考图走 base64：方舟返回的 URL 有时效
  const refDataUrl = `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;

  /**
   * Q 版参考图：直接从 `public/perch/save.webp` 抠一帧出来当定妆照。
   * ★ 不另外画一张 Q 版定妆照，是为了让这些小图标上的角色和右侧栏/底栏那六个挂件
   *   长得一模一样——那六张已经是这个角色的 Q 版权威形象了，再生成一版必然是第二个人。
   *   取最后一帧（save 那套结尾是睁眼），铺白底后当参考图（绿底会污染新图的背景判断）。
   */
  async function qRef() {
    const p = join(absSrc, "q-ref.jpg");
    if (existsSync(p)) return `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
    const sheet = resolve(root, "public/perch/save.webp");
    const meta = await sharp(sheet).metadata();
    const cell = Math.round(meta.width / 8);
    const buf = await sharp(sheet)
      .extract({ left: cell * 7, top: 0, width: cell, height: meta.height })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .resize(1024, null, { kernel: "lanczos3" })
      .jpeg({ quality: 95 })
      .toBuffer();
    writeFileSync(p, buf);
    console.log(`   Q 版参考图 ← perch/save.webp 第 8 帧（${cell}px → 1024px）`);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }

  const todo = only?.length ? poses.filter((p) => only.includes(p.key)) : poses;
  if (!todo.length) {
    console.error(`没有匹配的姿势（可选 ${poses.map((p) => p.key).join(" / ")}）`);
    process.exit(1);
  }

  /** 缓存包装：同名文件已在就直接用，重跑不重复花钱 */
  async function cached(name, make) {
    const p = join(absSrc, name);
    if (existsSync(p)) {
      console.log(`   复用 ${name}`);
      return readFileSync(p);
    }
    const buf = await make();
    writeFileSync(p, buf);
    return buf;
  }

  const table = [];
  for (const pose of todo) {
    console.log(`\n【${pose.key}】`);
    const style = pose.style ?? defaults.style ?? STYLE;
    const stage = pose.stage ?? defaults.stage ?? Q_STAGE;
    const cellW = pose.cell ?? CELL_W;
    const baseRef = (pose.q ?? defaults.q) ? await qRef() : refDataUrl;

    console.log(pose.aFrom ? `① A 端点：复用 ${pose.aFrom} 的 B 帧（保证两段接得上）` : "① A 端点姿势…");
    const aBuf = pose.aFrom
      ? readFileSync(join(absSrc, `${pose.aFrom}-b.jpg`))
      : await cached(`${pose.key}-a.jpg`, async () =>
          download(await seedream(`${CHAR}她此刻的动作与表情：${pose.a}${style}${stage}`, baseRef)),
        );
    console.log("② B 端点姿势（以 A 为参考图锁形象与取景）…");
    const aDataUrl = `data:image/jpeg;base64,${aBuf.toString("base64")}`;
    const bBuf = await cached(`${pose.key}-b.jpg`, async () =>
      download(
        await seedream(
          `保持参考图中角色的外观、服装、画风、构图取景与背景完全不变，只改变她的动作与表情：${pose.b}${stage}`,
          aDataUrl,
        ),
      ),
    );

    console.log("③ Seedance 首尾帧补中间动作…");
    const mp4 = await cached(`${pose.key}.mp4`, async () =>
      download(
        await seedance(
          `${pose.motion}${SHOT}`,
          aDataUrl,
          `data:image/jpeg;base64,${bBuf.toString("base64")}`,
          pose.key,
        ),
      ),
    );

    console.log("④ 抽帧…");
    const frameDir = join(absSrc, `${pose.key}-frames`);
    rmSync(frameDir, { recursive: true, force: true });
    mkdirSync(frameDir, { recursive: true });
    const mp4Path = join(absSrc, `${pose.key}.mp4`);
    writeFileSync(mp4Path, mp4);
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", mp4Path, join(frameDir, "f%04d.png")]);
    const all = readdirSync(frameDir).filter((f) => f.endsWith(".png")).sort();
    // 掐头去尾各一帧：首尾两帧常带编码器的过渡糊边
    const pool = all.slice(1, -1);
    const FRAMES = pose.frames ?? FRAMES_D;
    const picked = Array.from({ length: FRAMES }, (_, i) =>
      join(frameDir, pool[Math.round((i * (pool.length - 1)) / (FRAMES - 1))]),
    );
    console.log(`   共 ${all.length} 帧，等距取 ${FRAMES} 帧`);

    console.log("⑤ 抠图 + 统一裁切框…");
    const keyed = [];
    for (const f of picked) keyed.push(await keyGreen(sharp, readFileSync(f)));
    const box = unionBox(keyed.map((k) => k.box));
    // 四周留 2px，免得抗锯齿边被裁掉一行
    const pad = 2;
    const bx = Math.max(0, box.x0 - pad);
    const by = Math.max(0, box.y0 - pad);
    const bw = Math.min(keyed[0].w - bx, box.x1 - box.x0 + 1 + pad * 2);
    const bh = Math.min(keyed[0].h - by, box.y1 - box.y0 + 1 + pad * 2);
    const cellH = Math.round((cellW * bh) / bw);
    console.log(`   并集框 ${bw}×${bh} → 单格 ${cellW}×${cellH}`);
    console.log(`   dom 分布(每档30) ${keyed[0].hist.join(",")}`);

    const cells = [];
    for (const k of keyed) {
      cells.push(
        await sharp(k.data, { raw: { width: k.w, height: k.h, channels: 4 } })
          .extract({ left: bx, top: by, width: bw, height: bh })
          .resize(cellW, cellH, { fit: "fill" })
          .png()
          .toBuffer(),
      );
    }

    console.log("⑥ 横向拼接 → WebP…");
    const sheet = await sharp({
      create: { width: cellW * FRAMES, height: cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(cells.map((b, i) => ({ input: b, left: i * cellW, top: 0 })))
      .webp({ quality: 80, alphaQuality: 90 })
      .toBuffer();
    writeFileSync(join(absOut, `${pose.key}.webp`), sheet);
    console.log(`   ✓ ${outDir}/${pose.key}.webp  ${Math.round(sheet.length / 1024)}KB`);
    table.push({ pose: pose.key, w: cellW, h: cellH, frames: FRAMES, kb: Math.round(sheet.length / 1024) });
  }

  console.log("\n把这张表抄进对应组件的 SHEET：");
  for (const t of table) console.log(`  ${t.pose}: { w: ${t.w}, h: ${t.h}, frames: ${t.frames} },   // ${t.kb}KB`);
  return table;
}
