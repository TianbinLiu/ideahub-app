// 创意工坊「从市场添加」那 18 张种子卡的**真实卡面**。
//
// 用法（仓库根目录，需要 .env.local 里的 ARK_API_KEY）：
//   IMGTOOLS=<装了 sharp 的目录> node design/gen-market-cards.mjs . [赛博侦探·凛,雨夜霓虹街]
// 产物：public/cards/market/mkt_<i>.webp（512×768，与 TarotCard 的 2:3 对齐）
//
// ★ 卡表不在这里重抄一份，而是**从 src/mock/ai.ts 的 MARKET_DEFS 现读**：
//   卡面要跟卡的名字与简介对得上，两处各存一份卡表，迟早会出现"图是剑修、字是侦探"。
//   文件名按下标 mkt_<i>，与 marketAll() 里 `id: mkt_${i}` 是同一个下标。
//   ⚠ 所以【不要往 MARKET_DEFS 中间插卡】——插一张，后面所有卡的图都会错位。
//     要加卡就往数组末尾追加，然后只跑新增的那几张。
//
// 画风与 /create 三张封面、工坊 NPC 保持同一个世界观，但**不出现看板娘本人**：
// 这些是素材卡，画的是卡上那个角色/场景/道具，不是她。
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.argv[2] ?? ".";
const TOOLS = process.env.IMGTOOLS;
if (!TOOLS) {
  console.error("需要 IMGTOOLS=<装了 sharp 的目录>（一次性工具，刻意不进项目依赖）");
  process.exit(1);
}
const sharp = createRequire(resolve(TOOLS, "package.json"))("sharp");

const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

// ── 从 src/mock/ai.ts 现读卡表 ──────────────────────────────────────────
function loadDefs() {
  const src = readFileSync(resolve(ROOT, "src/mock/ai.ts"), "utf8");
  const m = src.match(/const MARKET_DEFS[^=]*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("没在 src/mock/ai.ts 里找到 MARKET_DEFS —— 卡表结构变了，先看一眼再改这里");
  // 我们自己仓库里的字面量数组，键是合法标识符、值全是字面量，直接求值即可
  return new Function(`return ${m[1]}`)();
}

/** 各卡种的画面主体怎么摆——五种卡讲的根本不是同一种东西 */
const BY_TYPE = {
  character: "画面主体是这个角色的半身立绘，正面或四分之三侧面，居中站位，五官清晰，眼神有戏。",
  scene: "画面主体是这处场景本身的全景，有纵深与前中后景层次，不要出现任何人物。",
  background: "画面是一整片只讲氛围与色调的空镜，极简，几乎没有具体物体，靠光与色说话，不要出现任何人物。",
  prop: "画面主体是这件道具的特写静物，居中陈列，材质与磨损细节清晰，背景虚化，不要出现任何人物。",
  style: "画面是一幅能一眼说明这种画风的示意图，主体简单，重点在笔触、质感与色彩语言本身，不要出现任何人物。",
};

const STYLE =
  "日系动画电影质感，干净的线条与大色块上色，柔和的边缘光与轻微镜头光晕，色彩通透，画面精致，作画质量极高。";
const FRAME =
  "竖版 2:3 构图，主体完整入镜且居中，四周留出一点余量（卡面外沿会被 UI 叠一圈金色描边，主体不要顶到画面边缘）。" +
  "画面干净，无任何文字、字母、数字、水印、边框、UI 元素、签名。";

async function seedream(prompt) {
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    // 1568×2352 = 3,687,936 ≥ 方舟的 3,686,400 下限，且正好是 2:3
    body: JSON.stringify({
      model: "doubao-seedream-5-0-260128",
      prompt,
      size: "1568x2352",
      response_format: "url",
      watermark: false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  return j.data[0].url;
}

/** 并发跑但限流：方舟对同账号并发出图会 429，3 路是 real.ts 里用了很久的稳妥值 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

const defs = loadDefs();
const outDir = resolve(ROOT, "public/cards/market");
mkdirSync(outDir, { recursive: true });

const only = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);
const todo = defs
  .map((d, i) => ({ ...d, i }))
  .filter((d) => (only?.length ? only.includes(d.name) : !existsSync(join(outDir, `mkt_${d.i}.webp`))));

if (todo.length === 0) {
  console.log("没有要出的卡（已有的都在 public/cards/market/，要重出就先删掉对应文件或用第二个参数点名）");
  process.exit(0);
}
console.log(`共 ${defs.length} 张，本次出 ${todo.length} 张…`);

let done = 0;
const results = await mapLimit(todo, 3, async (d) => {
  const prompt =
    `一张卡牌游戏的卡面插画。${BY_TYPE[d.type]}` +
    `卡面内容：「${d.name}」——${d.summary}` +
    `关键词：${(d.tags ?? []).join("、")}。${STYLE}${FRAME}`;
  try {
    const url = await seedream(prompt);
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    // 512×768 足够：卡面在素材库里只有 76px 宽，详情页也就 200px 出头。
    // 出图是 1568 宽，原样入包 18 张就是 3MB+，而这是要打进 APK 的
    const webp = await sharp(buf).resize(512, 768, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    writeFileSync(join(outDir, `mkt_${d.i}.webp`), webp);
    done++;
    console.log(`   [${done}/${todo.length}] mkt_${d.i} ${d.name} · ${Math.round(webp.length / 1024)}KB`);
    return { ok: true, name: d.name, kb: Math.round(webp.length / 1024) };
  } catch (e) {
    console.log(`   ✗ mkt_${d.i} ${d.name}: ${e.message}`);
    return { ok: false, name: d.name, err: e.message };
  }
});

const bad = results.filter((r) => !r.ok);
const total = results.filter((r) => r.ok).reduce((s, r) => s + r.kb, 0);
console.log(`\n成功 ${results.length - bad.length}/${results.length}，合计 ${total}KB`);
if (bad.length) console.log("失败（重跑本脚本会自动只补这几张）：", bad.map((b) => b.name).join("、"));
