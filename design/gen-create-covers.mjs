// 创作入口三张模式卡封面：同一个二次元美少女、同一套画风，只换主题与她的动作表情。
//
// 用法（在仓库根目录）：
//   node design/gen-create-covers.mjs .                 全部重跑
//   node design/gen-create-covers.mjs . simple.jpg      只重跑指定的封面
// 产物：public/create/{studio,workflow,simple}.jpg + design/character-ref.jpg（定妆照）
//
// 一致性靠两条腿：
//   ① 角色设定写死成一段固定文案（CHAR），三张提示词逐字复用；
//   ② 先出一张定妆照，再把它作为 Seedream 的参考图（image 字段）喂给三张场景图。
// 只靠文案的话，同一段描述在三次独立采样里仍会长出三张不同的脸。
//
// 要改画风/主题就改 STYLE / JOBS 再重跑，角色不会跟着漂移；要换角色则改 CHAR
// 并删掉 design/character-ref.jpg 让定妆照重出。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

/** 固定角色：三张封面逐字复用，不许改一个字 */
const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";

/** 统一画风：三张共用 */
const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";

/**
 * 统一构图：竖版，人物在中上部，下方留出干净的留白区压字。
 * tone 必须与 CreatePage 里那张卡的压字层同色系——暗卡留暗区、亮卡留亮区。
 * 反了的话（亮卡配暗底）白色压字层盖不住，会在文字上方留一条突兀的深色带。
 * 另外要明确"自然过渡"，否则模型会画出一条硬边把人物拦腰截断。
 */
const layout = (tone) =>
  "竖版构图 9:16，少女位于画面中上部并占据视觉中心，半身或膝上入镜，身体不要被下方区域切断；" +
  (tone === "light"
    ? "画面下方三分之一自然过渡为干净的浅色留白（同色系的淡雅底色，几乎没有细节），不要出现深色块或硬边分界；"
    : "画面下方三分之一自然过渡为干净的暗色区域（几乎没有细节），不要出现硬边分界；") +
  "方便叠加文字。无任何文字、字母、数字、水印、UI 元素、边框。";

const CHAR_SHEET =
  `二次元美少女角色定妆照，单人正面站立，中性表情，双手自然垂下。${CHAR}${STYLE}` +
  "背景是纯净的深灰蓝渐变，无杂物。竖版全身像，人物完整入镜，五官清晰可辨。无文字无水印。";

const JOBS = [
  {
    file: "studio.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：站在魔法工坊的长桌前，双手向上摊开托举，四张发光的塔罗牌被金色符文光带牵引着围绕她缓缓旋转，` +
      "她微微仰头看着悬浮的牌，嘴角带着惊喜又专注的笑意，眼里映着牌面的青蓝辉光。" +
      "场景：深夜的魔法书房，身后是高耸的哥特木质书柜与彩绘玻璃窗，桌上有黄铜烛台、燃着的蜡烛与摊开的羊皮卷轴。" +
      `暖金色烛光与青蓝色魔法辉光交织。${STYLE}${layout("dark")}`,
  },
  {
    file: "workflow.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：坐在剪辑工作台前侧身面向观众，右手食指伸出正点向身旁悬浮的一块全息分镜面板，` +
      "神情专注冷静，眉眼微敛，是内行人审片的样子，左手边放着触控笔。" +
      "场景：一排横向展开的青色半透明全息分镜面板环绕在她身侧，面板之间有细密的虚线数据连线，" +
      `深色哑光金属桌面，一副耳机搁在桌上。冷青与深蓝为主调，边缘有精准的发光刻度线。${STYLE}${layout("dark")}`,
  },
  {
    file: "simple.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：轻松地半蹲下来，一手比出俏皮的胜利手势举在脸侧，另一手抱着一只圆滚滚的白色小猫，` +
      "笑得眼睛弯成月牙，脸颊有淡淡的红晕，整个人轻盈可爱。" +
      "场景：极简的浅粉与奶白渐变空间，身旁飘着一颗小星星和一小片云，" +
      `大量留白，没有多余杂物。柔和的粉紫色调，柔光。${STYLE}${layout("light")}`,
  },
];

async function seedream(prompt, size, ref) {
  const body = {
    model: "doubao-seedream-5-0-260128",
    prompt,
    size,
    response_format: "url",
    watermark: false,
  };
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

async function download(url) {
  const r = await fetch(url);
  return Buffer.from(await r.arrayBuffer());
}

const outDir = resolve(ROOT, "public/create");
mkdirSync(outDir, { recursive: true });
const refPath = resolve(ROOT, "design/character-ref.jpg");

// 定妆照存在就复用——重跑单张封面时绝不能顺手换掉角色，那等于三张又散了
let sheetBuf;
if (existsSync(refPath)) {
  sheetBuf = readFileSync(refPath);
  console.log("① 沿用已有定妆照 design/character-ref.jpg");
} else {
  console.log("① 出角色定妆照…");
  sheetBuf = await download(await seedream(CHAR_SHEET, "1440x2560"));
  writeFileSync(refPath, sheetBuf);
  console.log(`   定妆照 ${Math.round(sheetBuf.length / 1024)}KB → design/character-ref.jpg`);
}
// 参考图走 base64 dataURL：方舟返回的 URL 有时效，且跨账号取图不保证可达
const refDataUrl = `data:image/jpeg;base64,${sheetBuf.toString("base64")}`;

const only = process.argv[3]?.split(",").map((x) => x.trim()).filter(Boolean);
const todo = only?.length ? JOBS.filter((j) => only.includes(j.file)) : JOBS;
if (todo.length === 0) {
  console.error(`没有匹配的封面：${only?.join(",")}（可选 ${JOBS.map((j) => j.file).join(" / ")}）`);
  process.exit(1);
}

console.log(`② 以定妆照为参考出 ${todo.length} 张封面…`);
const results = await Promise.allSettled(
  todo.map(async (job) => {
    const url = await seedream(job.prompt, "1440x2560", refDataUrl);
    const buf = await download(url);
    writeFileSync(resolve(outDir, job.file), buf);
    return { file: job.file, kb: Math.round(buf.length / 1024) };
  }),
);
for (const r of results) console.log(r.status === "fulfilled" ? `   OK ${r.value.file} ${r.value.kb}KB` : `   FAIL ${r.reason.message}`);
