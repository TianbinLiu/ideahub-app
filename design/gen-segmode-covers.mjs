// 工坊「铸段窗第①步」三张模式卡封面：套模板 / 自选卡片 / 自定义。
//
// 用法（仓库根目录）：
//   node design/gen-segmode-covers.mjs .                    全部重跑
//   node design/gen-segmode-covers.mjs . mode-cards.jpg     只重跑一张
// 产物：public/create/mode-{tpl,cards,custom}.jpg
//
// ⚠ 尺寸有下限：Seedream 5.0 要求 ≥3,686,400 像素（1152x1728 会被 400 拒），
// 这里取 1568x2352（2:3 且过线）。
// ★ 与 gen-create-covers.mjs **同一位看板娘、同一套画风**：CHAR/STYLE 逐字照抄，
//   参考图也用同一张定妆照 design/character-ref.jpg。三处封面（创作入口、铸段窗、
//   以后可能还有）散成三个人是最容易发生的事——角色一致靠"同一张参考图"这条腿，
//   不是靠文案描述（同一段描述在三次采样里长出三张脸）。
// ★ 构图与创作入口那三张不同：这里的卡是**横向宽卡**（选项行），人物偏一侧、
//   另一侧留干净区域压字；创作入口那三张是竖版 9:16。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

/** ★ 与 design/gen-create-covers.mjs 逐字相同，改这里就要连那边一起改 */
const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";
const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";

/** 竖版卡面（2:3），人物在上、下方留暗区压字 —— 与 TarotCard 的框同比例 */
const LAYOUT =
  "竖版构图，比例约 2:3，少女位于画面中上部并占据视觉中心，半身入镜，身体不要被下方区域切断；" +
  "画面下方三分之一自然过渡为干净的暗色区域（几乎没有细节），不要出现硬边分界，方便叠加文字。" +
  "无任何文字、字母、数字、水印、UI 元素、边框。";

const JOBS = [
  {
    file: "mode-tpl.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：站在一具与她等高的白色无面人偶旁，一手轻轻扶着人偶的肩，` +
      "另一手把一张发光的角色卡片按向人偶胸口，卡片的光正顺着人偶的轮廓流淌、把它染上颜色；" +
      "她侧头看着这一幕，神情是「看我把它变成谁」的笃定与期待。" +
      "场景：深夜的魔法工坊，身后立着几具同样的白色人偶剪影，地面有一圈淡青色的复刻法阵光环。" +
      `青蓝色魔法辉光为主，少量暖金点缀。${STYLE}${LAYOUT}`,
  },
  {
    file: "mode-cards.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：双手在胸前呈扇形展开三张发光的塔罗牌，正低头在三张牌之间比较挑选，` +
      "眉眼专注，嘴角有一点点犹豫又兴奋的笑；三张牌各自透出不同颜色的微光（青、金、紫）。" +
      "场景：魔法书房的长桌前，桌上散落着更多背面朝上的牌，空气里浮着细小的符文光点。" +
      `暖金烛光与青蓝辉光交织。${STYLE}${LAYOUT}`,
  },
  {
    file: "mode-custom.jpg",
    prompt:
      `${CHAR}她此刻的动作与表情：一手握着一支发光的羽毛笔正在半空中书写，笔尖拖出金色的光带，` +
      "光带在她面前凝成两块悬浮的画框——左边一块已经画好、右边一块还是空的线框；" +
      "她神情认真专注，是「这一段我自己来定」的样子。" +
      "场景：魔法书房，身侧漂浮着几张摊开的分镜草稿纸与一小卷胶片。" +
      `青蓝与暖金交织，画面干净。${STYLE}${LAYOUT}`,
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

const outDir = resolve(ROOT, "public/create");
mkdirSync(outDir, { recursive: true });
const refPath = resolve(ROOT, "design/character-ref.jpg");
if (!existsSync(refPath)) {
  console.error("缺 design/character-ref.jpg（定妆照）——先跑一次 gen-create-covers.mjs");
  process.exit(1);
}
const refDataUrl = `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;

const only = process.argv[3]?.split(",").map((x) => x.trim()).filter(Boolean);
const todo = only?.length ? JOBS.filter((j) => only.includes(j.file)) : JOBS;
console.log(`以定妆照为参考出 ${todo.length} 张模式封面…`);
const results = await Promise.allSettled(
  todo.map(async (job) => {
    const buf = await download(await seedream(job.prompt, "1568x2352", refDataUrl));
    writeFileSync(resolve(outDir, job.file), buf);
    return { file: job.file, kb: Math.round(buf.length / 1024) };
  }),
);
for (const r of results) console.log(r.status === "fulfilled" ? `OK ${r.value.file} ${r.value.kb}KB` : `FAIL ${r.reason.message}`);
