// App 出包前裁剪 dist：**开发源模型**与不可分发的第三方素材不进 APK。
//
// ★★ 2026-08-11 起「极致」档（4K 贴图）**留在包里**了。
//   原来它也被裁掉，于是 App 里那一档是灰的、点不动，设置页只能写一句
//   "App 安装包不含 4K 贴图" —— 用户看到的是一个摆在那里但永远不能用的选项。
//   代价是包体从 56MB 涨到 94MB（两个自产的玩家形象：f 25.5 + m 35.5，压缩后约 38MB）。
//   ⚠️ 不含 NPC —— 默认铸卡师是委托定制的 milltina，单文件、不分画质；
//   npc-full-face 那三档只服务 `?npc=witch` 调试变体，仍然全裁。
//   评估过"按需下载"（本文件原来的注释就是这么写的），选了直接装进包：
//   自更新是整包替换，按需下载省下的那份流量，在每次更新时又以另一种形式还回去了，
//   而且多一条会失败的网络路径。
//
// ★ 仍然裁掉的两类，判据不同，别混：
//   ① 开发源模型 / 重烘管线的输入 —— 运行时**从来不加载**，纯占地方；
//   ② **第三方版权素材** —— 授权不含分发，绝不允许入包。
//      protected/ 下的 rin（远坂凛，含卡牌全息那份 rin-opt.glbx）、gratia、tsumire 都属此列。
//
// ★★ milltina **不在**上面第二类里 —— 它是**委托定制、我们自有**的模型，
//   是工坊里默认的铸卡师，**必须随包发布**。别看它也在 protected/ 下就顺手裁掉：
//   那个目录装的是"要加密的"，不是"不能发的"，两件事。裁错的后果是进工坊看不到人，
//   而且不报任何错（2026-08-11 就这么发出去过一版）。
//   出包后请确认：`ls dist/models/protected/` 里有 milltina-opt.glbx。
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
  // ★ 这里原来还裁掉两个**真正在用**的「极致」档模型（player-f-think 25.5MB /
  //   player-m-think 35.5MB）。2026-08-11 起不再裁，见文件头的说明 ——
  //   裁了它们，App 里的「极致」就是一个永远点不动的灰选项。
  // ⚠️ npc-full-face.glb（34.9MB）**仍然裁掉**，别看它名字像正主：
  //   默认铸卡师是委托定制的 milltina（单文件、不分画质，随包发布），
  //   npcModelUrl() 只喂 `?npc=witch` 这个调试变体，而 App 里没有地址栏、永不可达。
  //   它的 -mid/-opt 两档也在下面的调试变体那一组里裁着，三档要留一起留。
  // 默认形象的极致档（13.6MB）：tsumire 是 BOOTH 购入的第三方模型、DEV-only，
  // 授权不含分发，永远不入包（下面"本地开发试穿档"那一组是同一个理由）
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
  "preview/npc-full-face.glb", // ?npc=witch 的极致档（34.9MB）
  "preview/npc-full-face-mid.glb", // ?npc=witch
  "preview/npc-full-face-opt.glb", // ?npc=witch
  // ★ 卡牌全息用的凛（远坂凛）：**有版权，不能分发**。
  //   .glbx 的加密拦不住这件事 —— 解密密钥就在同一个包里，发出去的仍然是那个模型。
  //   同名的明文 cards/rin-opt.glb 已经从仓库里删掉了，CARD_MODELS 里那一条也去掉了。
  "protected/rin-opt.glbx",
  // 本地开发试穿档（第三方版权模型，仅限本机 DEV；绝不允许入包）
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
