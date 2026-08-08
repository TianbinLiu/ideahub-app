// 画面质量分级：控制 3D 模型精细度（面数/贴图压缩档位）。
// low = 强减面+webp1k（首版压缩产物，弱机/省流量）
// mid = 减面 0.6~0.75+webp2k（默认）
// high = 原始烘焙产物不压缩（Tripo v3 直出全精度网格+原贴图，体积大加载慢）
export type Quality = "low" | "mid" | "high";

const KEY = "ideahub-app.quality";

/** 原生 App 壳内运行（Capacitor 注入全局） */
export function isNativeApp(): boolean {
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

export function getQuality(): Quality {
  const v = localStorage.getItem(KEY);
  const q: Quality = v === "low" || v === "high" ? v : "mid";
  // App 包体不含极致档大文件（出包时裁剪），原生端封顶到均衡
  return q === "high" && isNativeApp() ? "mid" : q;
}

export function setQuality(q: Quality) {
  localStorage.setItem(KEY, q);
  // 模型经 useLoader 按 URL 缓存且骨骼/材质已实例化——整页重载最干净
  location.reload();
}

// 模型 URL 表：?v= 版本号用于重烘后破缓存（升版本时三档都要动）
const NPC_VER = "lean17";
const PLAYER_VER = "think4";

export function npcModelUrl(): string {
  const q = getQuality();
  const file =
    q === "high" ? "npc-full-face.glb" : q === "mid" ? "npc-full-face-mid.glb" : "npc-full-face-opt.glb";
  return `/models/preview/${file}?v=${NPC_VER}`;
}

/** 玩家形象：m/f=自产 Tripo 模型（三档画质）；其余=本地开发试穿档（DEV-only，
 *  加密 glbx 走 gitignore 目录、release 出包裁剪——第三方移植模型永不进仓/进分发包）。
 *  tsumire 是 BOOTH 购入的 VRChat 角色（银发猫耳），FBX→GLB 后把骨名改成了 mixamo 规范，
 *  因此走的是与自产模型完全相同的取骨路径（见 design/README-tsumire.md）。 */
export type PlayerAvatar = "m" | "f" | "rin" | "gratia" | "tsumire";

/** 移植档的三档产物。**给全三档的才写成数组**，只有一个文件的写字符串——
 *  rin/gratia 当初只烘了 opt 一档，硬编个"三档同文件"只会让人以为调了画质有用。
 *  三档顺序 = [low, mid, high]，与 Quality 的档位一一对应。 */
const DEV_AVATAR_URLS: Record<string, string | [string, string, string]> = {
  rin: "/models/protected/rin-player-opt.glbx?v=p3",
  gratia: "/models/protected/gratia-player-opt.glbx?v=p3",
  // Tsumire 是默认形象，三档齐全（见 design/make-lod.mjs）。实测体积：
  // 13.62MB → mid 7.58MB（贴图 4096²→2048²）→ low 4.01MB（贴图 1024² + 裁掉
  // 94 个表情系统用不上的形键）。**不减面**：减面会让形键失效，表情系统就没了。
  tsumire: [
    "/models/protected/tsumire-player-low.glbx?v=t3",
    "/models/protected/tsumire-player-mid.glbx?v=t3",
    "/models/protected/tsumire-player.glbx?v=t2",
  ],
};

export function playerModelUrl(avatar: PlayerAvatar): string {
  const q = getQuality();
  const dev = DEV_AVATAR_URLS[avatar];
  if (dev) return typeof dev === "string" ? dev : dev[q === "low" ? 0 : q === "mid" ? 1 : 2];
  const suffix = q === "high" ? "think" : q === "mid" ? "think-mid" : "think-opt";
  return `/models/preview/player-${avatar}-${suffix}.glb?v=${PLAYER_VER}`;
}

// 文案照实写。默认形象 Tsumire 的三档实测：4.0MB / 7.6MB / 13.6MB，差别全在贴图
// 分辨率——**面数三档相同**（减面会让形键失效，表情就没了，见 design/make-lod.mjs）。
// 旧文案写"低面数/中等面数"是自产 Tripo 模型的口径，套到移植档上是不实的。
export const QUALITY_LABELS: Record<Quality, { name: string; desc: string }> = {
  low: { name: "流畅", desc: "1K 贴图 · 精简表情 · 加载最快（≈4MB）" },
  mid: { name: "均衡", desc: "2K 贴图 · 完整表情（推荐，≈8MB）" },
  high: { name: "极致", desc: "4K 原始贴图 · 完整表情 · 加载慢（≈14MB）" },
};
