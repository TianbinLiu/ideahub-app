// App 出包前裁剪 dist：开发源模型与"极致"档大文件不进 APK（包体从 ~250MB 降到 ~60MB）。
// 极致档在 App 内禁用（QualityPicker 有对应提示）；后续可改为按需下载。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const previewDir = path.join(root, "dist", "models", "preview");

const PRUNE = [
  // 开发源模型（重烘管线的输入，运行时从不加载）
  "npc-full-rigged.glb",
  "npc-full-hd-rigged.glb",
  "player-m-rigged.glb",
  "player-f-rigged.glb",
  "player-m-rigged-opt.glb",
  "player-f-rigged-opt.glb",
  "player-m.glb",
  "player-f.glb",
  "tripo-v3-rigged.glb",
  "npc-full-face.glb", // 极致档（36MB）
  "player-m-think.glb", // 极致档（37MB）
  "player-f-think.glb", // 极致档（26MB）
];

let saved = 0;
for (const f of PRUNE) {
  const p = path.join(previewDir, f);
  if (fs.existsSync(p)) {
    saved += fs.statSync(p).size;
    fs.rmSync(p);
    console.log("裁剪:", f);
  }
}
console.log(`App 包体减少 ${(saved / 1048576).toFixed(1)}MB`);
