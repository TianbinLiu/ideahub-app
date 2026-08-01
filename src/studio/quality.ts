// 画面质量分级：控制 3D 模型精细度（面数/贴图压缩档位）。
// low = 强减面+webp1k（首版压缩产物，弱机/省流量）
// mid = 减面 0.6~0.75+webp2k（默认）
// high = 原始烘焙产物不压缩（Tripo v3 直出全精度网格+原贴图，体积大加载慢）
export type Quality = "low" | "mid" | "high";

const KEY = "ideahub-app.quality";

export function getQuality(): Quality {
  const v = localStorage.getItem(KEY);
  return v === "low" || v === "high" ? v : "mid";
}

export function setQuality(q: Quality) {
  localStorage.setItem(KEY, q);
  // 模型经 useLoader 按 URL 缓存且骨骼/材质已实例化——整页重载最干净
  location.reload();
}

// 模型 URL 表：?v= 版本号用于重烘后破缓存（升版本时三档都要动）
const NPC_VER = "lean16";
const PLAYER_VER = "think4";

export function npcModelUrl(): string {
  const q = getQuality();
  const file =
    q === "high" ? "npc-full-face.glb" : q === "mid" ? "npc-full-face-mid.glb" : "npc-full-face-opt.glb";
  return `/models/preview/${file}?v=${NPC_VER}`;
}

export function playerModelUrl(avatar: "m" | "f"): string {
  const q = getQuality();
  const suffix = q === "high" ? "think" : q === "mid" ? "think-mid" : "think-opt";
  return `/models/preview/player-${avatar}-${suffix}.glb?v=${PLAYER_VER}`;
}

export const QUALITY_LABELS: Record<Quality, { name: string; desc: string }> = {
  low: { name: "流畅", desc: "低面数 · 压缩贴图 · 加载最快" },
  mid: { name: "均衡", desc: "中等面数 · 2K 贴图（推荐）" },
  high: { name: "极致", desc: "全精度网格 · 原始贴图 · 体积大加载慢" },
};
