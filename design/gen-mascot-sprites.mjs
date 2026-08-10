// 工作流页「看板娘」三套逐帧动画（见 src/components/MascotStage.tsx）。
//
//   handover  桌后双手前伸摊开 —— 拖卡片时的「交给我」提示
//   forge     双手在桌面法阵上方，闭眼专注 —— 出片过程中循环播
//   forged    捧起成形的发光卡牌笑开 —— 本段炼成的那一下
//
// 用法（仓库根目录，需要 .env.local 里的 ARK_API_KEY）：
//   IMGTOOLS=<装了 sharp/ffmpeg-static 的目录> node design/gen-mascot-sprites.mjs . [handover,forge]
// 产物：public/mascot/{pose}.webp + 中间件缓存 design/mascot-src/（不入仓）
//
// ★ 与 public/perch/ 那六张 Q 版是两套东西，不要合并：
//   perch 是 50px 图标上的挂件（Q 版、单格 160px），这三张是屏幕中央 260px 的演出，
//   Q 版放大到那个尺寸就是一团糊。这里走 gen-create-covers.mjs 同一套 CHAR/STYLE
//   与同一张定妆照（design/character-ref.jpg），所以和 /create 三张封面是同一个人。
//
// 流水线照抄 public/perch/README.md 那套（它是量出来的，别凭感觉改）：
//   ① Seedream 出 A/B 两个端点姿势（B 以 A 为参考图，否则两端会是两个人）
//   ② Seedance 首尾帧模式生成 3 秒视频 —— **不是帧插值**：插值会让手臂"融化"着平移，
//      视频模型才会给出合理的运动弧线（手臂沿弧线抬起、头发跟着甩）
//   ③ 抽 8 帧 → 绿幕抠图 → 所有帧包围盒的**并集**做统一裁切框 → 缩放 → 横向拼接 → WebP
//
// ★ 统一裁切框是硬要求：逐帧各自 trim 的话，手张开那几帧包围盒更大，
//   缩到同一格宽后角色会一帧大一帧小，看着就是在抖。
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.argv[2] ?? ".";
const TOOLS = process.env.IMGTOOLS;
if (!TOOLS) {
  console.error("需要 IMGTOOLS=<装了 sharp 与 ffmpeg-static 的目录>（一次性工具，刻意不进项目依赖）");
  process.exit(1);
}
const req = createRequire(resolve(TOOLS, "package.json"));
const sharp = req("sharp");
const FFMPEG = req("ffmpeg-static");

const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

// ── 角色与画风：与 design/gen-create-covers.mjs 逐字一致 ────────────────────
// ★ 一个字都不要改。改了这里，这三张动画里的人就和 /create 三张封面不是同一个人了。
const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";

const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";

/** 三套动画共用的取景与绿幕要求。
 *  ★ 绿幕、居中、不变形这三条必须每张都写：漏一条抠出来就是废片（README 有记录）。 */
const STAGE =
  "构图：正方形画幅，半身入镜（到腰部），人物在画面正中且占据画面高度约七成；" +
  "画面下方四分之一是一张深色胡桃木长桌的桌沿，横贯整个画面宽度，桌上左右各一座黄铜烛台点着蜡烛；" +
  "人物在桌子后方，桌沿遮住她的腰部以下。" +
  "背景（人物与桌子以外的一切）是纯正绿色 #00FF00 的纯色背景，绝对均匀，无渐变、无阴影、无图案、无任何物体。" +
  "重要：双眼形状左右对称，不要眨眼。无任何文字、字母、数字、水印、UI 元素、边框。";

/** 视频段共用的镜头约束。不写这些，模型会自己加推拉摇移，抽出来的帧角色忽大忽小。 */
const SHOT =
  "镜头完全静止不动，没有任何推拉摇移与变焦；角色始终保持在画面正中，大小与位置完全不变；" +
  "桌子与烛台完全静止；背景始终是纯正绿色 #00FF00，绝对不变。只有描述中提到的部位在动。";

// ── Q 版：素材按钮上的那颗小人（40px 的圆钮，不是屏幕中央的正片）────────────
// ★ 这一张刻意走 Q 版而不是上面的正片画风：按钮里能给的净高只有 ~34px，
//   正片的脸缩到那个尺寸就是一团糊（perch 那六张当年也是为此才画成 Q 版的）。
//   身份靠**传 perch 的现成帧当参考图**锁住——纯文字复述"同一个人"必然漂。
const Q_STYLE =
  "Q版卡通贴纸风格，二头身比例，大头小身，干净的线条与赛璐璐上色，柔和的边缘光，色彩通透明亮，作画精致。";
const Q_STAGE =
  "构图：正方形画幅，角色连同手里的卡牌一起居中，占画面高度约八成，半身入镜（到腰部，不画腿）。" +
  // ★ 这三句是第二版补的。第一版只说了"躲在牌后面"，模型就把牌画成了一整块挡板：
  //   躯干和双臂整个消失，手退化成两个圆球贴在牌沿上，缩到 42px 只剩一张白牌。
  //   卡牌尺寸、可见部位、手指、服装四件事都得逐条写死，模型不会自己补。
  "卡牌是小尺寸的塔罗牌，宽度只有角色肩宽的一半左右，绝不能遮住她的肩膀与手臂；" +
  "必须完整画出上半身与两条手臂，双手要画出清晰可辨的五根手指握住牌缘，绝对不要把手画成圆球或省略手指；" +
  "服装细节必须清晰：深蓝色立领短披风搭在肩上、披风领口正中一枚金色圆扣、内搭白色衬衫的立领与袖口、浅灰色百褶裙；" +
  "背景是纯正绿色 #00FF00 的纯色背景，绝对均匀，无渐变、无阴影、无图案、无任何其他物体。" +
  "重要：双眼形状左右对称。无任何文字、字母、数字、水印、UI 元素、边框。";

const POSES = [
  {
    // 素材按钮：一张图两个末态——正播 = 展开素材库，倒播 = 收起（见 MaterialButtonArt）。
    // 所以 A 必须是"收起态"、B 必须是"展开态"，顺序不能反。
    key: "cardbtn",
    q: true,
    cell: 180,
    style: Q_STYLE,
    stage: Q_STAGE,
    a:
      "她双手在身前捧着一张竖立的小塔罗牌，把牌举到自己下半张脸的高度当挡脸用，" +
      "十根手指分别扣在牌的左右两侧边缘、清晰可见；肩膀、深蓝色短披风、白色衬衫立领与两条手臂全都露在牌的外面；" +
      "只有鼻子以下被牌挡住，一双圆圆的大眼睛从牌的上沿探出来好奇地望着观众。",
    b:
      "她把那张小塔罗牌换到右手，五指捏着牌缘高高举到自己脸的右侧展示给观众，左手握拳叉在腰上；" +
      "整个上半身、深蓝色立领短披风与金色圆扣、白色衬衫、浅灰百褶裙全部完整可见；" +
      "她仰着头得意地开怀大笑，眼睛笑成弯月。",
    motion:
      "她把挡在脸前的小塔罗牌向右上方移开并举到脸侧展示，另一只手收到腰间叉腰，" +
      "表情从好奇张望逐渐变成得意的开怀大笑；两条手臂与手指全程清晰可见。",
  },
  // ── 拖拽交卡的三段式。★ 后两段的起点直接复用 handover 的终点图（aFrom），
  //    三段接起来才是同一个人同一个姿势的连续动作；各自重出 A 帧必然对不上。
  //    帧数给到 16：8 帧摊在 2 秒里只有 4fps，真机上看就是一格一格地跳。
  //    「呼吸与手臂浮动」不靠帧数，交给 CSS transform 做 60fps（见 MascotStage 的 breathe）。
  {
    key: "handover",
    frames: 16,
    // 与 /create/studio.jpg 那张封面同一个意思：摊开双手，示意「把牌交给我」
    a: "她双手轻放在桌面上，微微含笑看向正前方的观众，神情温和期待。",
    b: "她双手向前伸出、掌心向上完全摊开，做出接取东西的手势，身体略微前倾，笑意更明显，眼神看着自己摊开的掌心上方。",
    motion: "她的双手从桌面缓缓向前伸出并摊开成掌心向上的接取姿势，上半身随之极轻微地前倾，笑容逐渐展开。",
  },
  {
    // 卡片拖到落点上方时切这一段：姿势不动，只是表情从期待变成开心鼓励
    key: "handover-glad",
    frames: 16,
    aFrom: "handover",
    b:
      "她保持双手向前伸出、掌心向上完全摊开的同一个姿势完全不变，只有表情变了：" +
      "眼睛笑成弯月，嘴角大大扬起露出开心的笑容，脸颊泛起淡淡红晕，像是在鼓励对方「对，就放这儿」。",
    motion:
      "她的双手保持向前摊开的姿势原地不动，只有面部表情在变化：从温和期待逐渐变成眼睛弯起、嘴角上扬的开心笑容，" +
      "同时极轻微地点了一下头表示肯定。手的位置与形状全程不要改变。",
  },
  {
    // 松手之后：把牌收回来捧在胸前，非常高兴
    key: "receive",
    frames: 16,
    aFrom: "handover",
    b:
      "她把一张塔罗牌双手捧在胸前抱住，低头看着牌，笑得非常开心，眼睛弯成月牙，" +
      "牌的边缘透出淡淡的青蓝色光，周围飘着几点金色光尘。",
    motion:
      "她把摊开的双手向内收回到胸前，手中出现一张塔罗牌并被双手捧住抱在胸口，" +
      "上半身微微低头看向怀里的牌，表情从期待转为非常开心；动作连贯自然，像真的接住了递过来的东西。",
  },
  {
    key: "forge",
    a: "她双手悬在桌面上方一掌高处、掌心向下相对，闭着眼睛，神情极为专注，掌心之间浮着一小团青蓝色的微光。",
    b: "她双手向左右两侧缓缓张开到肩宽，掌心仍然向下，依旧闭着眼睛专注着，双掌之间升起一道旋转的金色符文光环与青蓝色光尘。",
    motion:
      "她的双手在桌面上方缓缓向左右两侧张开，掌心之间的青蓝色光团随之扩散成一道缓缓旋转的金色符文光环，光尘向上飘起；她全程闭着眼睛保持专注。",
  },
  {
    key: "forged",
    a: "她刚刚睁开眼睛，双手在胸前捧着一张刚成形的、边缘发着青蓝光的塔罗牌，表情是惊喜。",
    b: "她双手把那张发光的塔罗牌高高举到脸侧，仰起头开怀大笑，眼睛弯成月牙，周围散开金色的光点。",
    motion:
      "她双手把捧着的发光塔罗牌向上举到脸侧，表情从惊喜转为开怀大笑，头微微仰起，周围金色光点向外散开。",
  },
];

/** 单格宽度。屏幕中央实际显示约 260px，取 1.6 倍 —— 再大 8 帧一张图就奔着 1MB 去了，
 *  而这是要打进 APK 的。实测 420 下脸部细节与发丝高光都还在。 */
const CELL_W = 420;
const VIDEO_SEC = 3;

// ── 方舟 ────────────────────────────────────────────────────────────────
async function ark(path, body, timeoutMs = 180_000) {
  const res = await fetch(`https://ark.cn-beijing.volces.com/api/v3${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j;
}

/** Seedream。size 取正方形且总像素 ≥3,686,400（方舟下限，见 arkClient.ts 的实测注释） */
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

async function download(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`下载失败 ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── 绿幕抠图 ────────────────────────────────────────────────────────────
// 判定用「绿色优势度」dom = g - max(r,b)，不是「颜色接近纯绿」——
// AI 出的背景常有轻微明暗不匀，卡死一个 RGB 值会留一圈杂边。
//
// ★ 阈值是量出来的，不是抄 perch 那套。这三张的 dom 直方图（每档 30，从 -40 起）：
//     handover 714590,241528,23398,9340,13913,39448,824948,206435,0
//     forge    772986,262549,23304,10679,16802,44720,942436,124,0
//     forged   730847,257787,24234,9135,12089,16959,38912,952650,30987
//   角色本体全在 ≤50（薄荷挑染最高 ~26），背景峰在 ≥140，中间 50~140 是
//   H.264 色度二次采样在高对比边缘糊出来的**宏块**——perch 那次是静态图没有这层。
//   第一版照抄 130/50，那些宏块拿到 alpha 64~159，成品上就是发丝周围一圈方格状白渣。
//   收到 85/35 后它们整块归零，而 ≤35 的角色本体一根头发都没少。
const DOM_BG = 85;
const DOM_FG = 35;

/**
 * 只保留够大的连通块。
 * ★ 光靠 dom 阈值杀不干净：编码器还会在角落糊出**灰白色**的宏块，它们 dom≈0，
 *   在颜色判据下是彻头彻尾的"前景"。但角色+桌子是一整块连通域（桌沿横贯全幅，
 *   烛台立在桌上），孤立的小块必然是脏东西 —— 按连通块面积筛比调颜色阈值稳得多。
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
async function keyGreen(buf) {
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
  //   随后的抬阈把最淡的那 25% 削掉，顺带收掉一点光晕的外沿。
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
const outDir = resolve(ROOT, "public/mascot");
const srcDir = resolve(ROOT, "design/mascot-src");
mkdirSync(outDir, { recursive: true });
mkdirSync(srcDir, { recursive: true });
// 中间产物（A/B 帧、mp4、抽帧）几十 MB，缓存下来是为了重跑不重复烧钱，但不入仓
writeFileSync(join(srcDir, ".gitignore"), "*\n!.gitignore\n");

const refPath = resolve(ROOT, "design/character-ref.jpg");
if (!existsSync(refPath)) {
  console.error("缺 design/character-ref.jpg（定妆照）——先跑一次 design/gen-create-covers.mjs");
  process.exit(1);
}
// 参考图走 base64：方舟返回的 URL 有时效
const refDataUrl = `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;

/**
 * Q 版参考图：直接从 `public/perch/save.webp` 抠一帧出来当定妆照。
 * ★ 不另外画一张 Q 版定妆照，是为了让按钮上这颗小人和右侧栏/底栏那六个挂件
 *   长得一模一样——那六张已经是这个角色的 Q 版权威形象了，再生成一版必然是第二个人。
 *   取最后一帧（save 那套结尾是睁眼），铺白底后当参考图（绿底会污染新图的背景判断）。
 */
async function qRef() {
  const p = join(srcDir, "q-ref.jpg");
  if (existsSync(p)) return `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;
  const sheet = resolve(ROOT, "public/perch/save.webp");
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

const only = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);
const todo = only?.length ? POSES.filter((p) => only.includes(p.key)) : POSES;
if (!todo.length) {
  console.error(`没有匹配的姿势（可选 ${POSES.map((p) => p.key).join(" / ")}）`);
  process.exit(1);
}

/** 缓存包装：同名文件已在就直接用，重跑不重复花钱 */
async function cached(name, make) {
  const p = join(srcDir, name);
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
  const style = pose.style ?? STYLE;
  const stage = pose.stage ?? STAGE;
  const cellW = pose.cell ?? CELL_W;
  const baseRef = pose.q ? await qRef() : refDataUrl;

  console.log(pose.aFrom ? `① A 端点：复用 ${pose.aFrom} 的 B 帧（保证两段接得上）` : "① A 端点姿势…");
  const aBuf = pose.aFrom
    ? readFileSync(join(srcDir, `${pose.aFrom}-b.jpg`))
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
  const frameDir = join(srcDir, `${pose.key}-frames`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const mp4Path = join(srcDir, `${pose.key}.mp4`);
  writeFileSync(mp4Path, mp4);
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", mp4Path, join(frameDir, "f%04d.png")]);
  const all = readdirSync(frameDir).filter((f) => f.endsWith(".png")).sort();
  // 掐头去尾各一帧：首尾两帧常带编码器的过渡糊边
  const pool = all.slice(1, -1);
  const FRAMES = pose.frames ?? 8;
  const picked = Array.from({ length: FRAMES }, (_, i) =>
    join(frameDir, pool[Math.round((i * (pool.length - 1)) / (FRAMES - 1))]),
  );
  console.log(`   共 ${all.length} 帧，等距取 ${FRAMES} 帧`);

  console.log("⑤ 抠图 + 统一裁切框…");
  const keyed = [];
  for (const f of picked) keyed.push(await keyGreen(readFileSync(f)));
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
  writeFileSync(join(outDir, `${pose.key}.webp`), sheet);
  console.log(`   ✓ public/mascot/${pose.key}.webp  ${Math.round(sheet.length / 1024)}KB`);
  table.push({ pose: pose.key, w: cellW, h: cellH, frames: FRAMES, kb: Math.round(sheet.length / 1024) });
}

console.log("\n把这张表抄进 src/components/MascotStage.tsx 的 SHEET：");
for (const t of table) console.log(`  ${t.pose}: { w: ${t.w}, h: ${t.h}, frames: ${t.frames} },   // ${t.kb}KB`);
