// 「启梦」App 图标：Q 版看板娘抬头 + 头顶亮着的电灯泡。
//
// 用法（仓库根目录，需要 .env.local 的 ARK_API_KEY）：
//   IMGTOOLS=<装了 sharp 的目录> node design/gen-app-icon.mjs .        出图并切全部尺寸
//   IMGTOOLS=... node design/gen-app-icon.mjs . --cut                  跳过出图，只用已有原图重切
// 产物：
//   design/app-icon-src.png                     1920² 原图（缓存，重切时复用）
//   public/icon.png                             512² 网页/商店用
//   android/app/src/main/res/mipmap-*/ic_launcher.png / _round.png / _foreground.png
//
// ★ 自适应图标（Android 8+）的安全区只有中间 66%：外面那圈随时会被厂商的
//   圆形/水滴形/方形遮罩切掉。所以 foreground 必须把主体缩到 ~66% 再居中放到透明画布上，
//   直接拿满幅图当 foreground 的话，一加/小米的圆形遮罩会把灯泡和头顶整个啃掉。
// ★ 传 perch 的现成帧当参考图锁 Q 版形象——与 cardbtn 同一套做法，
//   纯文字复述"同一个角色"必然漂成另一个人。
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.argv[2] ?? ".";
const CUT_ONLY = process.argv.includes("--cut");
const TOOLS = process.env.IMGTOOLS;
if (!TOOLS) {
  console.error("需要 IMGTOOLS=<装了 sharp 的目录>");
  process.exit(1);
}
const sharp = createRequire(resolve(TOOLS, "package.json"))("sharp");

const SRC = resolve(ROOT, "design/app-icon-src.png");

async function generate() {
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
  const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
  if (!KEY) throw new Error("ARK_API_KEY 未配置");

  // Q 版参考图：从 perch/save.webp 抠一帧铺白底（与 gen-mascot-sprites 的 qRef 同源）
  const sheet = resolve(ROOT, "public/perch/save.webp");
  const meta = await sharp(sheet).metadata();
  const cell = Math.round(meta.width / 8);
  const refBuf = await sharp(sheet)
    .extract({ left: cell * 7, top: 0, width: cell, height: meta.height })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(1024, null, { kernel: "lanczos3" })
    .jpeg({ quality: 95 })
    .toBuffer();

  const prompt =
    "App 图标插画。Q版卡通贴纸风格，二头身比例，大头小身，干净的线条与赛璐璐上色，柔和边缘光，色彩通透明亮，作画精致。" +
    "画面主体：保持参考图中角色的外观与服装不变——银白色长发、左侧一缕薄荷青挑染、发间金色星形发饰、通透的青蓝色大眼、" +
    "深蓝色立领短披风搭配金色圆扣与白色衬衫立领。" +
    "她仰起头向上看，眼睛睁得大大的、闪着光，张嘴笑出来，是那种「突然想到一个好主意」的惊喜与兴奋；双手在胸前握拳，" +
    "整个人透着雀跃。" +
    "她的头顶正上方悬浮着一枚同样 Q 版风格的电灯泡，灯泡正亮着——玻璃泡里是暖金色的光，" +
    "灯泡周围有一圈短短的放射状光线和几点飘散的金色光尘，把她的发顶与脸颊照出暖光。" +
    "构图：正方形画幅，人物与灯泡作为一个整体居中，占画面中间约三分之二的面积，四周留出充足余量" +
    "（图标会被裁成圆形，边缘的东西会被切掉）。" +
    "背景：干净的深蓝紫色径向渐变，从中心的亮青蓝过渡到四角的深靛蓝，除了细小的星点光尘外没有任何其他物体。" +
    "无任何文字、字母、数字、水印、边框、UI 元素。";

  console.log("① Seedream 出图（1920²）…");
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: "doubao-seedream-5-0-260128",
      prompt,
      size: "1920x1920",
      response_format: "url",
      watermark: false,
      image: `data:image/jpeg;base64,${refBuf.toString("base64")}`,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  const buf = Buffer.from(await (await fetch(j.data[0].url, { signal: AbortSignal.timeout(120_000) })).arrayBuffer());
  writeFileSync(SRC, await sharp(buf).png().toBuffer());
  console.log(`   → design/app-icon-src.png (${Math.round(buf.length / 1024)}KB)`);
}

if (!CUT_ONLY || !existsSync(SRC)) await generate();
else console.log("① 复用 design/app-icon-src.png");

// ── 切图 ────────────────────────────────────────────────────────────────
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const resDir = resolve(ROOT, "android/app/src/main/res");

console.log("② 切各密度启动图标…");
for (const [d, px] of Object.entries(DENSITIES)) {
  const dir = join(resDir, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });

  // 方形（旧版启动器直接用这张）
  await sharp(SRC).resize(px, px).png().toFile(join(dir, "ic_launcher.png"));

  // 圆形（round 变体：自己带圆形遮罩，四角透明）
  const circle = Buffer.from(
    `<svg width="${px}" height="${px}"><circle cx="${px / 2}" cy="${px / 2}" r="${px / 2}" fill="#fff"/></svg>`,
  );
  await sharp(SRC)
    .resize(px, px)
    .composite([{ input: circle, blend: "dest-in" }])
    .png()
    .toFile(join(dir, "ic_launcher_round.png"));

  // 自适应图标前景：108dp 画布，主体只占中间 66%（安全区），其余透明
  const fg = Math.round(px * (108 / 48));
  const inner = Math.round(fg * 0.66);
  const pad = Math.round((fg - inner) / 2);
  const art = await sharp(SRC).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: fg, height: fg, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: pad, top: pad }])
    .png()
    .toFile(join(dir, "ic_launcher_foreground.png"));
}

// 网页 / 商店用
mkdirSync(resolve(ROOT, "public"), { recursive: true });
await sharp(SRC).resize(512, 512).png().toFile(resolve(ROOT, "public/icon.png"));

// 自适应图标的底色取原图四角的平均色——前景是圆的、底色是方的，
// 两者对不上时圆形遮罩外会露出一圈突兀的色边
const { data } = await sharp(SRC).resize(8, 8).raw().toBuffer({ resolveWithObject: true });
const corners = [0, 7, 56, 63].map((i) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
const avg = corners.reduce((a, c) => a.map((v, k) => v + c[k]), [0, 0, 0]).map((v) => Math.round(v / 4));
const hex = "#" + avg.map((v) => v.toString(16).padStart(2, "0")).join("");
const colorsPath = join(resDir, "values", "ic_launcher_background.xml");
mkdirSync(join(resDir, "values"), { recursive: true });
writeFileSync(
  colorsPath,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <!-- 自适应图标底色：取自图标原图四角的平均色，见 design/gen-app-icon.mjs -->\n    <color name="ic_launcher_background">${hex}</color>\n</resources>\n`,
);

console.log(`③ 完成。自适应底色 ${hex}`);
console.log("   public/icon.png 512² · mipmap-{m,h,xh,xxh,xxxh}dpi 各 3 张");
