// App 出包前裁剪 dist：开发源模型与"极致"档大文件不进 APK（包体从 ~250MB 降到 ~60MB）。
// 极致档在 App 内禁用（QualityPicker 有对应提示）；后续可改为按需下载。
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const modelsDir = path.join(root, "dist", "models");

const PRUNE = [
  // 开发源模型（重烘管线的输入，运行时从不加载）
  "preview/npc-full-rigged.glb",
  "preview/npc-full-hd-rigged.glb",
  "preview/player-m-rigged.glb",
  "preview/player-f-rigged.glb",
  "preview/player-m-rigged-opt.glb",
  "preview/player-f-rigged-opt.glb",
  "preview/player-m.glb",
  "preview/player-f.glb",
  "preview/tripo-v3-rigged.glb",
  "preview/npc-full-face.glb", // 极致档（36MB）
  "preview/player-m-think.glb", // 极致档（37MB）
  "preview/player-f-think.glb", // 极致档（26MB）
  // 默认形象的极致档（13.6MB）。原生端 getQuality() 硬把 high 封顶到 mid，
  // 这个文件在 App 里永远不会被请求；mid(7.6MB)/low(4.1MB) 两档留在包里
  "protected/tsumire-player.glbx",
  // 烘焙/试验遗留，src 全局零引用（web 端也不加载，仅占仓库）
  "preview/tripo-v3.glb",
  "preview/tripo-v25.glb",
  "preview/tripo-v25-rigged.glb",
  "preview/npc-full.glb",
  "preview/tripo-bust-opt.glb",
  "preview/npc-full-rigged-opt.glb",
  // ?npc= URL 调试变体专用（App 内没有地址栏，永不可达；web 调试不受影响）
  "preview/tripo-v3-rigged-opt.glb", // ?npc=tripo
  "npc/card-forger.vrm", // ?npc=vrm
  "preview/npc-full-face-mid.glb", // ?npc=witch
  "preview/npc-full-face-opt.glb", // ?npc=witch
  // 本地开发试穿档（第三方移植模型，仅限本机 DEV；授权不含分发——绝不允许入包）
  "protected/rin-player-opt.glbx",
  "protected/rin-sword-opt.glbx",
  "protected/gratia-player-opt.glbx",
  "protected/gratia-rapier-opt.glbx",
  "protected/rin-preview.webp",
  "protected/gratia-preview.webp",
];

let saved = 0;
for (const f of PRUNE) {
  const p = path.join(modelsDir, f);
  if (fs.existsSync(p)) {
    saved += fs.statSync(p).size;
    fs.rmSync(p);
    console.log("裁剪:", f);
  }
}
console.log(`App 包体减少 ${(saved / 1048576).toFixed(1)}MB`);
