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

const DEV_AVATAR_URLS: Record<string, string> = {
  rin: "/models/protected/rin-player-opt.glbx?v=p3",
  gratia: "/models/protected/gratia-player-opt.glbx?v=p3",
  tsumire: "/models/protected/tsumire-player.glbx?v=t1",
};

export function playerModelUrl(avatar: PlayerAvatar): string {
  if (avatar in DEV_AVATAR_URLS) return DEV_AVATAR_URLS[avatar];
  const q = getQuality();
  const suffix = q === "high" ? "think" : q === "mid" ? "think-mid" : "think-opt";
  return `/models/preview/player-${avatar}-${suffix}.glb?v=${PLAYER_VER}`;
}

export const QUALITY_LABELS: Record<Quality, { name: string; desc: string }> = {
  low: { name: "流畅", desc: "低面数 · 压缩贴图 · 加载最快" },
  mid: { name: "均衡", desc: "中等面数 · 2K 贴图（推荐）" },
  high: { name: "极致", desc: "全精度网格 · 原始贴图 · 体积大加载慢" },
};
