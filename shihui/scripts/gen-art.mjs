// 生成 App 图标与官网封面（水墨风格）。产物落 assets-art/，由 pack-icons.mjs 切成
// 各密度 mipmap；封面图供官网下载页用。
//
// 用法：node scripts/gen-art.mjs [--only icon|cover]
//
// ★ 图标不是插画：48dp 下只剩一个轮廓，细节全糊。所以提示词刻意要求
//   「极简、大块面、主体占画面 60% 以上、纯色背景」——生成一张漂亮的山水画很容易，
//   生成一张 48dp 下还认得出的图标很难，这里优化的是后者。
// ★ 一律禁止画面出现文字：Seedream 爱题字且十有八九是错字（内容库踩过，见 forge.mjs）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "assets-art");
const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const MODEL = "doubao-seedream-5-0-260128";

const NO_TEXT = "画面中绝对不要出现任何文字、汉字、书法、落款、题字、印章文字、水印。";
const INK = "中国传统水墨画风格，宣纸质感底色，淡墨渲染，少量赭石与花青淡彩，意境清雅。";

/** 图标候选：都走「极简大块面」，构图各不相同，出图后人眼挑一张 */
const ICONS = [
  {
    id: "icon-moon-mountain",
    size: "2048x2048",
    prompt:
      `${INK} 正方形图标设计，构图极简：画面下方三分之一是一道浓淡相间的水墨远山剪影，` +
      `上方是一轮清晰的圆月，月色留白，山月之间大片宣纸留白。主体占满画面，四周不留白边。` +
      `色彩克制：墨色、米白、一点点朱砂红。适合作为手机应用图标，缩小到很小仍能一眼辨认。${NO_TEXT}`,
  },
  {
    id: "icon-brush-scroll",
    size: "2048x2048",
    prompt:
      `${INK} 正方形图标设计，构图极简：一支斜置的毛笔笔尖蘸墨，笔尖下方一笔浓墨横扫化作远山，` +
      `背景是温润的宣纸米色。主体大而居中，形状简洁有力，四周不留白边。` +
      `适合作为手机应用图标，缩小到很小仍能一眼辨认。${NO_TEXT}`,
  },
  {
    id: "icon-plum-moon",
    size: "2048x2048",
    prompt:
      `${INK} 正方形图标设计，构图极简：一轮朱砂色圆月居中偏上，一枝墨色梅花斜斜穿过月轮，` +
      `梅花只有寥寥数笔与三两点花瓣，背景宣纸米白。主体大而清晰，四周不留白边。` +
      `适合作为手机应用图标，缩小到很小仍能一眼辨认。${NO_TEXT}`,
  },
];

/** 官网下载页的横幅封面：可以复杂，是给人看的插画不是图标 */
const COVER = {
  id: "cover-banner",
  size: "2560x1440",
  prompt:
    `${INK} 横幅插画：右侧是层叠远山与一轮明月，山下小小的古亭与几笔松枝；` +
    `左侧大片宣纸留白，云雾自左向右流过，意境安静悠远，适合作为诗词教育应用的官网封面。` +
    `色调温润，以墨色与米白为主，点缀少量朱砂。${NO_TEXT}`,
};

async function arkKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  const env = await readFile(path.join(ROOT, ".env.local"), "utf8").catch(() => "");
  const m = /^ARK_API_KEY=(.+)$/m.exec(env);
  if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  throw new Error("没有 ARK_API_KEY：配在 shihui/.env.local 或环境变量里");
}

let KEY = "";
async function genImage({ id, prompt, size }) {
  const res = await fetch(`${ARK}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, prompt, size, response_format: "url", watermark: false }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Seedream ${res.status}: ${text.slice(0, 200)}`);
  const url = JSON.parse(text).data?.[0]?.url;
  if (!url) throw new Error("未返回图片");
  const bin = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  await writeFile(path.join(OUT, `${id}.jpg`), Buffer.from(await bin.arrayBuffer()));
  console.log(`✓ ${id}.jpg`);
}

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
await mkdir(OUT, { recursive: true });
KEY = await arkKey();

const jobs = [...(only === "cover" ? [] : ICONS), ...(only === "icon" ? [] : [COVER])];
// 串行：三张图各 20-25s，并发只会撞限流，没必要
for (const job of jobs) {
  try {
    await genImage(job);
  } catch (e) {
    console.error(`✗ ${job.id}: ${e.message}`);
  }
}
console.log(`\n产物在 ${OUT}（图标候选人眼挑一张后跑 pack-icons.mjs）`);
