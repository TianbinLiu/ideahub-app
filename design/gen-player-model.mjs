// 用定妆照（design/character-ref.jpg）铸一个 3D 模型：Seed3D 2.0，约 2.4 元/次、3-8 分钟。
//
// 用法（仓库根目录）：node design/gen-player-model.mjs .
// 产物：design/out/player-girl-raw.glb（Seed3D 原始网格，未做任何优化）
//
// 注意：Seed3D 出的是**静态网格**——没有骨架也没有动画。工坊的玩家形象要的是带
// mixamo 骨骼 + 烘好的 think/settle 动画的绑骨模型（见 src/studio/scene/PlayerArms.tsx），
// 所以这个产物不能直接当玩家模型用，还要过一道绑骨。脚本只负责把网格拿到手。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.argv[2];
const env = readFileSync(resolve(ROOT, ".env.local"), "utf8");
const KEY = (env.match(/^ARK_API_KEY=(.*)$/m) || [])[1]?.trim();
if (!KEY) {
  console.error("ARK_API_KEY 未配置");
  process.exit(1);
}

const API = "https://ark.cn-beijing.volces.com/api/v3";
const refPath = resolve(ROOT, "design/character-ref.jpg");
if (!existsSync(refPath)) {
  console.error("缺少定妆照 design/character-ref.jpg");
  process.exit(1);
}
const refDataUrl = `data:image/jpeg;base64,${readFileSync(refPath).toString("base64")}`;

async function ark(path, init) {
  const res = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, ...(init?.headers ?? {}) },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(j.error ?? j).slice(0, 300)}`);
  return j;
}

console.log("① 提交 Seed3D 任务…");
const created = await ark("/contents/generations/tasks", {
  method: "POST",
  body: JSON.stringify({
    model: "doubao-seed3d-2-0-260328",
    content: [{ type: "image_url", image_url: { url: refDataUrl } }],
  }),
});
const taskId = created.id;
console.log(`   task ${taskId}`);

console.log("② 轮询（3-8 分钟）…");
let fileUrl = null;
for (let i = 0; i < 160; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await ark(`/contents/generations/tasks/${taskId}`, { method: "GET" });
  if (i % 6 === 0) console.log(`   ${((i * 5) / 60).toFixed(1)} min · ${st.status}`);
  if (st.status === "succeeded") {
    fileUrl = st.content?.file_url;
    break;
  }
  if (st.status === "failed" || st.status === "cancelled") {
    throw new Error(`任务${st.status}: ${st.error?.message ?? ""}`);
  }
}
if (!fileUrl) throw new Error("任务超时");

console.log("③ 下载并解包…");
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
const out = resolve(ROOT, "design/out/player-girl-raw.glb");
writeFileSync(out, glb);
console.log(`   GLB ${(glb.length / 1024 / 1024).toFixed(1)}MB → design/out/player-girl-raw.glb`);
