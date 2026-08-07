// 用角色设定铸 3D 模型：Seedream 出"建模参考图" → Seed3D 2.0 出网格。
//
// 用法（仓库根目录）：
//   node design/gen-player-model.mjs .            出参考图 + 出模
//   node design/gen-player-model.mjs . --ref-only 只出参考图（先目检再决定要不要烧 3D 的钱）
//   node design/gen-player-model.mjs . --model-only 复用已有参考图直接出模
// 产物：design/model-ref.jpg（建模参考图）+ design/out/player-girl-raw.glb
//
// ── Seed3D 的能力边界（2026-08-08 实测探参，别再试了）────────────────────────
// · 只吃单张图：content 里放多张会要求每张带 role，而唯一合法的 role 是 `first_frame`
//   （那是 Seedance 视频的角色名，这个共用端点的校验来自视频模型）。没有多视图。
// · 没有精度/面数/纹理参数：resolution 与 output_format 会被明确拒绝，其余猜名
//   （quality/face_count/texture_size/with_normal_map/pbr…）一律被静默忽略。
// · 产物不带法线贴图，也不带骨骼与动画——工坊现有的 NPC/玩家模型出自 Tripo，
//   那边自带法线图与 mixamo 绑骨，这是两者观感差距的主因，不是参数没调对。
// 因此唯一能提升重建质量的旋钮就是**输入图本身**：人物填满画幅、正面平光、
// A 字站姿手臂离开身体（背面/侧面全靠模型脑补，贴身的手臂会和裙摆糊成一坨）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
const FLAGS = process.argv.slice(3);
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

const API = "https://ark.cn-beijing.volces.com/api/v3";
const refPath = resolve(ROOT, "design/character-ref.jpg"); // 定妆照（角色身份来源）
const modelRefPath = resolve(ROOT, "design/model-ref.jpg"); // 建模参考图（喂给 Seed3D）

async function ark(path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, ...(init?.headers ?? {}) },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j;
}

const dataUrl = (p) => `data:image/jpeg;base64,${readFileSync(p).toString("base64")}`;

/** 建模参考图：以定妆照锁定身份，只改站姿/取景/打光 */
const MODEL_REF_PROMPT =
  "参考图中这位少女的 3D 建模参考图。严格保持她的长相、发型发色（银白长直发、左侧一缕薄荷青挑染）、" +
  "金色六芒星发夹、青蓝瞳、深蓝色立领短披风与金色纽扣、白衬衫、浅灰百褶裙——身份与服装一个细节都不要改。" +
  "姿势：标准 A 字站姿，正面朝向镜头，双臂向斜下方张开约 45 度、完全离开身体与裙摆，双手手指自然张开不要握拳，" +
  "两腿微微分开，身体直立不要倾斜。" +
  // 取景要同时说"占满"和"留边"：只说占满会被裁掉小腿以下，出来的模型没有脚
  "取景：全身像，从头顶到鞋底完整入镜，必须画出双脚与鞋子；人物占画面高度约 85%，" +
  "头顶上方与鞋底下方各留出约 7% 的空隙，左右居中，绝对不要裁切头发、手指、小腿或双脚。" +
  "打光：正面均匀平光，没有强烈阴影、没有逆光、没有环境色，服装与皮肤的固有色清晰可辨。" +
  "背景：纯净的中灰色，完全没有杂物、地面、影子。" +
  "画风：日系赛璐璐动画风格，干净的线条与清晰的边界，细节明确。" +
  "无任何文字、水印、UI、边框、多人、分镜格。";

async function seedream(prompt, size, ref) {
  const body = { model: "doubao-seedream-5-0-260128", prompt, size, response_format: "url", watermark: false };
  if (ref) body.image = ref;
  const j = await ark("/images/generations", { method: "POST", body: JSON.stringify(body) });
  const url = j.data?.[0]?.url;
  if (!url) throw new Error("Seedream 未返回图片");
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

// ── ① 建模参考图 ────────────────────────────────────────────────
if (!FLAGS.includes("--model-only")) {
  if (!existsSync(refPath)) {
    console.error("缺少定妆照 design/character-ref.jpg");
    process.exit(1);
  }
  console.log("① 出建模参考图（A 字站姿 / 填满画幅 / 平光）…");
  // 竖版但接近方形：Seed3D 内部会归一化，人物占比越大有效分辨率越高
  const buf = await seedream(MODEL_REF_PROMPT, "1728x2304", dataUrl(refPath));
  writeFileSync(modelRefPath, buf);
  console.log(`   ${Math.round(buf.length / 1024)}KB → design/model-ref.jpg`);
}
if (FLAGS.includes("--ref-only")) {
  console.log("（--ref-only：先目检 design/model-ref.jpg，满意再跑 --model-only）");
  process.exit(0);
}

// ── ② Seed3D 出模 ───────────────────────────────────────────────
if (!existsSync(modelRefPath)) {
  console.error("缺少建模参考图 design/model-ref.jpg（先不带 --model-only 跑一次）");
  process.exit(1);
}
console.log("② 提交 Seed3D 任务…");
const created = await ark("/contents/generations/tasks", {
  method: "POST",
  body: JSON.stringify({
    model: "doubao-seed3d-2-0-260328",
    content: [{ type: "image_url", image_url: { url: dataUrl(modelRefPath) } }],
  }),
});
console.log(`   task ${created.id}`);

console.log("③ 轮询（3-8 分钟）…");
let fileUrl = null;
for (let i = 0; i < 160; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await ark(`/contents/generations/tasks/${created.id}`, { method: "GET" });
  if (i % 6 === 0) console.log(`   ${((i * 5) / 60).toFixed(1)} min · ${st.status}`);
  if (st.status === "succeeded") {
    fileUrl = st.content?.file_url;
    break;
  }
  if (st.status === "failed" || st.status === "cancelled") throw new Error(`任务${st.status}: ${st.error?.message ?? ""}`);
}
if (!fileUrl) throw new Error("任务超时");

console.log("④ 下载并解包…");
const zip = new Uint8Array(await (await fetch(fileUrl)).arrayBuffer());
// 中央目录（PK\x01\x02）里的 size/offset 恒可信；本地头可能用 data descriptor 置零
const u16 = (i) => zip[i] | (zip[i + 1] << 8);
const u32 = (i) => (zip[i] | (zip[i + 1] << 8) | (zip[i + 2] << 16) | (zip[i + 3] << 24)) >>> 0;
let glb = null;
for (let i = 0; i + 46 <= zip.length; i++) {
  if (zip[i] !== 0x50 || zip[i + 1] !== 0x4b || zip[i + 2] !== 0x01 || zip[i + 3] !== 0x02) continue;
  const method = u16(i + 10);
  const compSize = u32(i + 20);
  const nameLen = u16(i + 28);
  const extraLen = u16(i + 30);
  const commentLen = u16(i + 32);
  const localOff = u32(i + 42);
  const name = new TextDecoder().decode(zip.subarray(i + 46, i + 46 + nameLen));
  console.log(`   包内条目: ${name}`);
  if (name.toLowerCase().endsWith(".glb")) {
    const dataStart = localOff + 30 + u16(localOff + 26) + u16(localOff + 28);
    const raw = zip.subarray(dataStart, dataStart + compSize);
    glb =
      method === 0
        ? Buffer.from(raw)
        : Buffer.from(
            await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer(),
          );
  }
  i += 45 + nameLen + extraLen + commentLen;
}
if (!glb) throw new Error("包里没有 .glb");

mkdirSync(resolve(ROOT, "design/out"), { recursive: true });
writeFileSync(resolve(ROOT, "design/out/player-girl-raw.glb"), glb);
console.log(`   GLB ${(glb.length / 1024 / 1024).toFixed(1)}MB → design/out/player-girl-raw.glb`);
