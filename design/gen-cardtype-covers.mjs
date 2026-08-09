// 五种卡片类型的"看板娘导览"封面：炼卡第一步让用户挑卡种时，每一种都由看板娘
// 亲自比划着推销一次。
//
// 用法（在仓库根目录）：
//   node design/gen-cardtype-covers.mjs .                    全部重跑
//   node design/gen-cardtype-covers.mjs . prop.webp          只重跑指定的
//   node design/gen-cardtype-covers.mjs . prop.webp --notext 用"无文字"备选构图重跑
// 产物：public/cardtype/{character,scene,background,prop,style}.webp（640×960）
//
// 角色一致性沿用 gen-create-covers.mjs 那套：CHAR/STYLE 逐字复用 + 拿
// design/character-ref.jpg（定妆照）当 Seedream 的参考图。**CHAR 一个字都不要改**——
// 她已经是 app 的看板娘（创作入口三张封面、工坊里的铸卡师 NPC 都是同一个人），
// 改了这里就等于全线换人。
//
// 关于画面里的中文字：道具卡的构图是"捧着发光的『道具』二字推销"。文生图写汉字
// 是出了名的不稳（缺笔、多笔、镜像）。所以每张都有两套提示词：
//   主案 withText —— 画面里带发光大字，最贴用户想要的"推销员"感
//   备案 noText   —— 同样的姿势，但手里捧的是发光的空白牌/光球，字交给 UI 层压上去
// 出完**必须逐张看图验字**，哪张字崩了就用 --notext 单独重跑那一张。
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("用法: node design/gen-cardtype-covers.mjs <仓库根目录> [文件名,...] [--notext]");
  process.exit(1);
}
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

// ↓↓↓ 与 design/gen-create-covers.mjs 逐字一致，不要各改各的 ↓↓↓
const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";

const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";
// ↑↑↑ 与 design/gen-create-covers.mjs 逐字一致 ↑↑↑

/**
 * 卡面构图：竖版 2:3（与 TarotCard 的 aspect-[2/3] 一致，否则 object-cover 会裁掉手）。
 * 人物**半身入镜**——五张都是"她在给你介绍这一类卡"，手势是主角，全身像会把手缩得太小。
 * 底部留一条干净的暗区：TarotCard 会在 87% 处压一条题名渐变条，那儿有细节就糊成一团。
 */
const LAYOUT =
  "竖版构图 2:3，少女半身入镜、位于画面中上部，手部动作清晰完整不被裁切；" +
  "画面底部八分之一自然过渡为干净的深色区域（几乎没有细节），不要出现硬边分界，方便叠加题名。" +
  "无水印、无 UI 元素、无边框、无英文字母与数字。";

/** 只在"主案"里出现的发光汉字。备案把它换成不带字的发光物件 */
const glow = (word) =>
  `她双手捧着一块悬浮的发光牌，牌面上是两个笔画工整、清晰可辨的中文楷体大字「${word}」，` +
  `字体发着暖金色的光。**只允许出现这两个汉字「${word}」，不要出现任何其它文字、字母或数字，字形必须完全正确。**`;

const noGlow =
  "她双手捧着一块悬浮的发光空白牌，牌面是纯净的暖金色光晕，上面没有任何文字或图案。";

const JOBS = [
  {
    file: "character.webp",
    // 用户点名要的：指着自己 + 骄傲
    withText: "她此刻的动作与表情：右手食指俏皮地指着自己的脸颊，下巴微微上抬，得意又自信地笑着，眉眼弯弯，像在说「这一类就交给我」；左手叉腰。她身后浮着三道半透明的人物剪影光影。",
    noText: null, // 这张本来就不含字
    scene: "背景是柔和的樱粉色光晕，几点星尘。",
  },
  {
    file: "scene.webp",
    withText: "她此刻的动作与表情：侧身面向观众，右臂向身后方大幅摊开，像导游那样引着你看，神情明朗带笑，另一手轻扶披风。她身后一幅风景画卷正徐徐展开：远山、屋檐与街灯在光里浮现。",
    noText: null,
    scene: "背景是青蓝色的空间感光带，画卷边缘有金色符文流光。",
  },
  {
    file: "background.webp",
    withText: "她此刻的动作与表情：双手在胸前托起一团缓缓流转的色彩光晕（暖橙、冷青、深紫在其中交融），微微低头看着它，神情温柔专注，睫毛上映着光。",
    noText: null,
    scene: "背景是一整片柔和的渐变色幕，从暖金过渡到深紫，没有具体景物。",
  },
  {
    file: "prop.webp",
    // 用户点名要的：捧着发光的「道具」二字，像推销员
    withText: `她此刻的动作与表情：像热情的推销员那样把双手向观众递出，${glow("道具")}她笑得神采飞扬，微微前倾，眼睛亮亮的。`,
    noText: `她此刻的动作与表情：像热情的推销员那样把双手向观众递出，${noGlow}她笑得神采飞扬，微微前倾，眼睛亮亮的。她身侧漂浮着一柄小钥匙、一枚罗盘和一只怀表，都镀着金光。`,
    scene: "背景是温暖的琥珀色光晕，几枚金色光斑。",
  },
  {
    file: "style.webp",
    withText: "她此刻的动作与表情：右手执一支细画笔举在身侧，左手托着一块沾着颜料的木质调色盘，歪头看着观众，眼神俏皮像在问「想要哪种画风」。",
    noText: null,
    scene: "背景被一道柔和的斜向分界分成两半：左半是水墨留白，右半是霓虹像素方块，两侧都不喧宾夺主。",
  },
];

async function seedream(prompt, size, ref) {
  const body = { model: "doubao-seedream-5-0-260128", prompt, size, response_format: "url", watermark: false };
  if (ref) body.image = ref;
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  return j.data[0].url;
}

const download = async (url) => Buffer.from(await (await fetch(url)).arrayBuffer());

const refPath = resolve(ROOT, "design/character-ref.jpg");
if (!existsSync(refPath)) {
  console.error("缺少定妆照 design/character-ref.jpg——先跑 node design/gen-create-covers.mjs .");
  process.exit(1);
}
// 参考图走 base64 dataURL：方舟返回的 URL 有时效，且跨账号取图不保证可达
const refDataUrl = `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;

const args = process.argv.slice(3);
const noText = args.includes("--notext");
const only = args.filter((a) => !a.startsWith("--")).flatMap((a) => a.split(",").map((x) => x.trim())).filter(Boolean);
const todo = only.length ? JOBS.filter((j) => only.includes(j.file)) : JOBS;
if (todo.length === 0) {
  console.error(`没有匹配的封面（可选 ${JOBS.map((j) => j.file).join(" / ")}）`);
  process.exit(1);
}

const outDir = resolve(ROOT, "public/cardtype");
mkdirSync(outDir, { recursive: true });

console.log(`以定妆照为参考出 ${todo.length} 张卡种封面${noText ? "（无文字备案）" : ""}…`);
const results = await Promise.allSettled(
  todo.map(async (job) => {
    const act = (noText && job.noText) || job.withText;
    const prompt = `${CHAR}${act}${job.scene}${STYLE}${LAYOUT}`;
    // 1568×2352 = 3,687,936 像素，刚过 Seedream 的下限。实测这个下限是硬的：
    // 1536×2304（3,538,944）会被 400 掉，报 "image size must be at least 3686400 pixels"。
    // 想保 2:3 又要过线，1568×2352 是最小的那一组（1568/2352 正好 = 2/3）。
    const url = await seedream(prompt, "1568x2352", refDataUrl);
    const buf = await download(url);
    // 出图是 2K（方舟的下限逼的），但这五张只在选卡种的网格里当缩略图用——
    // 竖屏 375px 三列，每格约 110px 宽，3 倍屏也只要 330px。直接把 2K JPEG 塞进
    // public 是 1.7MB 的白付流量；压到 640×960 webp 后五张合计不到 260KB。
    // 想要大图重跑脚本即可，原图不留（与 gen-create-covers.mjs 不保留中间产物同理）。
    const info = await sharp(buf).resize(640, 960, { fit: "cover" }).webp({ quality: 82 }).toFile(resolve(outDir, job.file));
    return { file: job.file, kb: Math.round(info.size / 1024) };
  }),
);
for (const r of results) {
  console.log(r.status === "fulfilled" ? `   OK ${r.value.file} ${r.value.kb}KB` : `   FAIL ${r.reason.message}`);
}
console.log("\n⚠ 出完请逐张看图：道具卡那两个汉字容易崩，崩了就 --notext 单独重跑那一张。");
