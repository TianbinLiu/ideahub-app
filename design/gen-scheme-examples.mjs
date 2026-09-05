// 「自己传图做卡片」方案小窗四张**真实 AI 生成**的示例图（仓库主人 2026-08-28 点名）。
//
// 用法（仓库根目录，需要 .env.local 里的 ARK_API_KEY）：
//   IMGTOOLS=<装了 sharp 的目录> node design/gen-scheme-examples.mjs . [clean,faceless]
// 产物：public/schemes/{clean,faceless,specsheet,realface}.webp（600×800，3:4，与小窗牌面对齐）
//
// ★★ 前三张用的是**方案里真实的图位提示词**（scheme_clean / scheme_faceless /
//   scheme_specsheet 的主图位），只是把「参考图中人物」换成一个固定示例主体 ——
//   示例图必须是"这套方案真会产出的东西"，不是美工示意。为了防两处漂移，
//   本脚本会对 src/data/promptSchemes.ts 做**子串断言**：方案提示词改了而这里没改，
//   脚本当场报错，而不是安静地出一批过时示例。
// ★ 第四张（真人素材扫脸认证）**刻意不用火山控制台那张官方人像**：那是火山的版权素材，
//   打进我们的 APK 属于搬运（CLAUDE.md 版权那几条）。主人 2026-08-28 二次点名：
//   这张也不要放真人（哪怕是 AI 编的写实脸，看着也像在展示某个真实的人）——
//   改成**看板娘本人** + 扫脸识别框。角色一致性沿用 gen-cardtype-covers.mjs 那套：
//   CHAR 逐字复用 + design/character-ref.jpg（定妆照）当 Seedream 参考图。
// ★ 前三张的示例主体仍是一个虚构角色（银发星星发饰的少女——与看板娘同世界观但不是她本人），
//   三张共用同一主体，用户一眼能对比"同一个人三种方案产出什么"。刻意不用看板娘：
//   方案示例是"你的素材会被做成什么"，放官方吉祥物反而让人以为产出会长她那样。
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

/** 固定示例主体（前三张共用，方便对比方案差异；不是看板娘，理由见文件头） */
const SUBJECT =
  "一位银白色长发、佩戴金色星星发饰的动漫少女，蓝绿色眼睛，深蓝色学院风短披风与白色衬衫";

// ↓↓↓ 与 design/gen-create-covers.mjs / gen-cardtype-covers.mjs 逐字一致，不要各改各的 ↓↓↓
const CHAR =
  "同一位少女：约十六岁，银白色及腰长直发，左侧一缕挑染成薄荷青色，发间别一枚小小的金色六芒星发夹；" +
  "瞳色是通透的青蓝，眼型偏圆略上挑，睫毛纤长；身穿深蓝色立领短披风，内搭白色衬衫与浅灰百褶裙，" +
  "披风领口有一枚金色纽扣；身形纤细，皮肤白皙。";

const STYLE =
  "日系赛璐璐动画电影风格，干净的线条与大色块上色，柔和的边缘光与轻微的镜头光晕，" +
  "空气中有细小的光尘颗粒，色彩通透明亮，画面精致，作画质量极高。";
// ↑↑↑ 与 design/gen-create-covers.mjs / gen-cardtype-covers.mjs 逐字一致 ↑↑↑

/**
 * 方案主图位的真实提示词（从 promptSchemes 抄来，下面 assertInSource 钉防漂移）。
 * 「参考图中人物」在这里换成固定示例主体（示例图是 t2i，没有参考图可指）。
 */
// 2026-09-04 与 promptSchemes.FULL_BODY_PROMPT 同步（只有头肩参考时也要出全身，理由见那里）
const CLEAN_BODY =
  "的全身立绘：远景，从头顶到鞋底完整入镜，双脚和鞋子清晰可见，头顶上方与脚下各留出空白，" +
  "身体任何部位都不裁切；纯白色背景，无任何背景元素与文字；站姿自然，正面朝向镜头";
const CLEAN_FACE = "的面部特写肖像：纯白色背景，无任何背景元素与文字；头肩构图，五官清晰";
const FACELESS_TRIVIEW =
  "的标准站姿三视图横向并排：正面全身、侧面全身、背面全身；" +
  "头部均为无面部特征的纯白色人台模型，服装完整穿着，浅灰白底加等距网格辅助线，专业服装设计稿风格";
const SPECSHEET =
  "专业角色设计规格说明图（Character Design Spec Sheet），浅灰白色背景与网格辅助线：" +
  "左栏为角色头部铅笔素描线稿（正面 + 侧面 45°两图并排，精细面部结构线条，无上色）；" +
  "中栏为色彩参考色板横排（发色、眼色、肤色、服装主色与配色）；" +
  "右栏为服装局部细节特写三图。整体冷色调专业设计感排版";

function assertInSource() {
  const src = readFileSync(resolve(ROOT, "src/data/promptSchemes.ts"), "utf8");
  for (const [name, frag] of [
    ["clean 全身", CLEAN_BODY],
    ["clean 特写", CLEAN_FACE],
    ["faceless 三视图", FACELESS_TRIVIEW.slice(1)],
    ["specsheet", SPECSHEET],
  ]) {
    // 源文件里提示词是跨行字符串拼接，把两边的引号拼接痕迹去掉后按包含判
    const flat = src.replace(/["'] \+\s*\n\s*["']/g, "").replace(/" \+\n\s+"/g, "");
    if (!flat.includes(frag)) {
      throw new Error(`方案提示词已变（${name}）——先同步本脚本再出图，别出一批过时示例`);
    }
  }
}

const JOBS = [
  {
    file: "clean",
    prompt: `${SUBJECT}${CLEAN_BODY}。画面右下角以小图叠放同一角色${CLEAN_FACE}。二次元厚涂插画风，高细节。`,
  },
  {
    file: "faceless",
    prompt: `${SUBJECT}${FACELESS_TRIVIEW}。`,
  },
  {
    file: "specsheet",
    prompt: `${SPECSHEET}。角色为${SUBJECT}。`,
  },
  {
    file: "realface",
    // 自绘"扫脸认证"示意：**看板娘本人** + 识别框（主人点名不放真人，也不搬火山素材）。
    // 用定妆照当参考图（ref），脸才与工坊铸卡师/卡种封面是同一个人
    ref: true,
    prompt:
      `${CHAR}她此刻正面朝向观众的头肩特写肖像：免冠、直视镜头、神情自然放松带一点点笑意；纯浅色干净背景。` +
      `面部叠加半透明的青色人脸识别扫描框：四角对焦括号、几道横向扫描线与稀疏的面部特征点，` +
      `科技感生物识别界面风格。无文字无水印。${STYLE}`,
  },
];

async function seedream(prompt, ref) {
  // 1764×2352 = 4,148,928 ≥ 5.0 的 3,686,400 下限，且正好 3:4（小窗牌面比例）
  const body = {
    model: "doubao-seedream-5-0-260128",
    prompt,
    size: "1764x2352",
    response_format: "url",
    watermark: false,
  };
  if (ref) body.image = ref;
  const res = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.data?.[0]?.url) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 240)}`);
  return j.data[0].url;
}

// 看板娘定妆照（gen-create-covers.mjs 产出）。走 base64 dataURL：方舟返回的 URL 有时效
const refPath = resolve(ROOT, "design/character-ref.jpg");
function refDataUrl() {
  if (!existsSync(refPath)) throw new Error("缺少定妆照 design/character-ref.jpg——先跑 node design/gen-create-covers.mjs .");
  return `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;
}

assertInSource();
const outDir = resolve(ROOT, "public/schemes");
mkdirSync(outDir, { recursive: true });
const only = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);
const todo = JOBS.filter((d) => (only?.length ? only.includes(d.file) : !existsSync(join(outDir, `${d.file}.webp`))));
if (todo.length === 0) {
  console.log("没有要出的图（都已存在；要重出就删掉对应文件或用第二个参数点名）");
  process.exit(0);
}
console.log(`本次出 ${todo.length} 张…`);
for (const d of todo) {
  try {
    const url = await seedream(d.prompt, d.ref ? refDataUrl() : undefined);
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const buf = Buffer.from(await r.arrayBuffer());
    // 600×800 足够：小窗牌面半屏宽（~170px），2× 屏也就 340px
    const webp = await sharp(buf).resize(600, 800, { fit: "cover" }).webp({ quality: 84 }).toBuffer();
    writeFileSync(join(outDir, `${d.file}.webp`), webp);
    console.log(`   ✓ ${d.file}.webp · ${Math.round(webp.length / 1024)}KB`);
  } catch (e) {
    console.log(`   ✗ ${d.file}: ${e.message}`);
  }
}
