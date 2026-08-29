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

/**
 * MMD 刚体辅助骨模拟（Bullet/ammo.js）的总开关。**默认关**。
 *
 * 为什么要从画质档里拆出来：画质档量的是**贴图分辨率与下载体积**（1K/2K/4K，
 * 三档面数相同），和"跑不跑得动一套刚体物理"是两个毫不相干的轴。以前用
 * `getQuality() === "high"` 当刚体的开关，在"画质要用户手动选"的年代还算凑合
 * ——没人会误开。改成按机型自动定档之后，任何一块像样的显卡都会落 high，
 * 于是这条路径被**静默打开**，而它是坏的：NPC 的双马尾会横着飞出去、
 * 领结从领口翘起来抽动（2026-08-09 用户报，A/B 复现：high 坏 / mid 好）。
 *
 * 在把刚体调稳之前，它只由这个显式开关控制，与画质彻底解绑。
 * 调试：localStorage.setItem("ideahub-app.rigidBones","on") 后刷新。
 */
export function rigidBonesEnabled(): boolean {
  try {
    return localStorage.getItem("ideahub-app.rigidBones") === "on";
  } catch {
    return false; // 隐私模式下 localStorage 会抛
  }
}

/** 用户到底有没有自己定过档。**不能拿 getQuality() === "mid" 当"没设过"**——
 *  那是缺省值，用户主动选了均衡也是 "mid"，两者必须分得开，否则每次进工坊
 *  都会把用户手动挑的档位当成"还没定"再自动改一遍。 */
export function qualityChosen(): boolean {
  const v = localStorage.getItem(KEY);
  return v === "low" || v === "mid" || v === "high";
}

export function getQuality(): Quality {
  const v = localStorage.getItem(KEY);
  return v === "low" || v === "high" ? v : "mid";
}
// ★ 这里原来有一行「原生端把 high 封顶到 mid」：那时候极致档的大文件在出包时被裁掉了，
//   App 里请求它必然 404。2026-08-11 起 4K 素材随包发布（scripts/prune-app-assets.mjs），
//   封顶随之取消 —— 留着它的话，用户在设置里点「极致」会重载一次、回来还是均衡，
//   看着就像按钮坏了（这个死循环真出现过，见 SettingsPage 里 blocked 那段的原注释）。

// ── 首次进工坊：按机型自动定档 ────────────────────────────────
//
// 为什么要自动定档：三档的差别全在贴图分辨率（4K / 2K / 1K，13.6 / 7.6 / 4.0MB），
// 差的是**显存和首屏下载**，不是帧率。低端机拿到 4K 贴图的表现是"加载半天然后
// 上下文丢失、画面白掉"，而用户根本不知道有画质这回事——默认给 mid 对红米是灾难、
// 对旗舰又是白白牺牲。所以第一次进来先猜一次，之后用户在设置里改了就永远听用户的。
//
// 判据按**可靠性**排序，命中即止：
//   1. GPU 型号（WebGL UNMASKED_RENDERER_WEBGL）——最准，直接对应显存带宽
//   2. deviceMemory ——安卓 Chrome 都有，iOS Safari 恒为 undefined
//   3. hardwareConcurrency ——最后的粗筛，只能分出"极弱"
// 全都问不出来就落 mid（现有默认），宁可保守。

/** 取 GPU 名称。隐私模式/新版浏览器可能打码或直接不给扩展，返回 "" */
function gpuName(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const n = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : "";
    // 用完即毁：留着一个额外的 WebGL 上下文，安卓上很容易顶掉主画布的那个
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return (n || "").toLowerCase();
  } catch {
    return "";
  }
}

/** 按机型猜一个档位。纯函数式判断，可在 DEV 控制台直接调用核对 */
export function detectQuality(): { q: Quality; why: string } {
  const g = gpuName();
  if (g) {
    // 桌面独显先判：web 版也会在电脑上跑，而 RTX/RX/Arc 这类卡走到下面的
    // 移动 GPU 名单里一个都不命中，会白白落回 mid。实测本机 renderer 串是
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0) Direct3D11…)"
    if (/geforce|radeon (rx|pro)|intel\(r\) arc|quadro|apple m\d/.test(g)) return { q: "high", why: `GPU=${g}` };
    // Adreno 7xx/8xx、Mali-G7xx/G8xx（Immortalis）、Apple A15 以后：吃得下 4K
    if (/adreno \(tm\) (7|8)\d\d|adreno (7|8)\d\d|immortalis|mali-g7\d\d|mali-g8\d\d|apple a1[5-9]/.test(g))
      return { q: "high", why: `GPU=${g}` };
    // Adreno 5xx 及以下、Mali-G5x/T 系列、PowerVR：1K 贴图都嫌吃力
    if (/adreno \(tm\) [1-5]\d\d|adreno [1-5]\d\d|mali-t\d|mali-g5|mali-g3|powervr|swiftshader|llvmpipe/.test(g))
      return { q: "low", why: `GPU=${g}` };
    return { q: "mid", why: `GPU=${g}（未在名单内）` };
  }
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof mem === "number") {
    if (mem >= 8) return { q: "high", why: `deviceMemory=${mem}GB` };
    if (mem <= 3) return { q: "low", why: `deviceMemory=${mem}GB` };
    return { q: "mid", why: `deviceMemory=${mem}GB` };
  }
  const cores = navigator.hardwareConcurrency;
  // 只用来抓"极弱"：核心数和 GPU 能力相关性很弱，多核低端机比比皆是，
  // 所以这一层**只往下调**，不敢往上调
  if (typeof cores === "number" && cores <= 4) return { q: "low", why: `hardwareConcurrency=${cores}` };
  return { q: "mid", why: "问不出机型，落保守默认" };
}

/**
 * 首次进工坊时定档。**只在用户从没设过的时候动手**，设过就一个字不改。
 * 返回自动选中的档位（已经设过则返回 null，调用方据此决定要不要提示）。
 * 注意不走 setQuality()——那个函数会 location.reload()，而这里是在工坊挂载时
 * 调用的，重载一次等于把刚进来的用户又踢回加载页。写进 localStorage 就够了：
 * 模型 URL 是在渲染时按 getQuality() 现取的，本次进入就已经是新档位。
 */
export function autoQualityOnFirstVisit(): Quality | null {
  if (qualityChosen()) return null;
  const { q, why } = detectQuality();
  localStorage.setItem(KEY, q);
  console.info(`[quality] 首次进工坊自动定档 ${q}（${why}）`);
  return q;
}

export function setQuality(q: Quality) {
  localStorage.setItem(KEY, q);
  // 模型经 useLoader 按 URL 缓存且骨骼/材质已实例化——整页重载最干净
  location.reload();
}

// 模型 URL 表：?v= 版本号用于重烘后破缓存（升版本时三档都要动）
const NPC_VER = "lean17";
// think5：player-f 换成 v2 重制模型（二游设定稿重建 + 迁移现网骨架，见
// assets-private/playerf-v2/README.md）。★ 不顶这个数，老用户的浏览器/WebView
// 拿的还是缓存里那份旧模型 —— 全程零报错，只是没生效。
const PLAYER_VER = "think5";

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

// 文案照实写 —— 这一段 2026-08-22 全量重量过一遍，因为**旧文案有三处不实**：
//   ① 说"三档差别全在贴图分辨率、面数一样"：那条只对 NPC（make-lod 那条路，
//      不能减面是因为会毁形键）成立；**玩家形象的三档一直是连面数一起降的**。
//   ② 说 low 是"1K 贴图"：实测旧 player-f/-m 的 low 档都是 **2048**，不是 1K。
//   ③ 报的体积（2.4/3.3/25.5MB）在 f 换成 v2 重制模型之后全部作废。
//
// ★ 现在的实测值（`node` 逐文件读 GLB 头量的，不是估）：
//     她 f（v2 重制）  流畅 0.85MB/4.0万面/1K ｜ 均衡 1.45MB/8.0万面/2K ｜ 极致 1.69MB/15.0万面/2K
//     他 m（仍是旧模型）流畅 3.10MB/45.1万面/2K ｜ 均衡 4.23MB/67.6万面/2K ｜ 极致 35.54MB/90.2万面/4K
//   两个形象差这么多，是因为 f 已经走过"二游设定稿重建 + 迁移骨架 + 降面"那条流水线，
//   m 还没有（见 assets-private/playerf-v2/README.md）。**所以文案里不能再写死单一数字**，
//   两个形象各报各的。
// ★ f 没有"4K 档"：重制模型的源贴图上限就是 2048，硬放大出来的 4K 是假的，不写。
// ★ 画质**只影响玩家形象这一个模型**：默认铸卡师是委托定制的 milltina，单文件、不分档
//   （npcModelUrl 那三档只服务 `?npc=witch` 调试变体，出包时全裁）。
// ★ 2026-08-11 起三档在 App 里都能用：素材随包发布，不再是"点不动的灰选项"。
//   所以这里说的是**加载耗时与显存**，不是下载流量 —— 文件就在本机。
export const QUALITY_LABELS: Record<Quality, { name: string; desc: string }> = {
  low: { name: "流畅", desc: "最小贴图与面数 · 加载最快（她 0.9MB／他 3.1MB）· 老手机选它" },
  mid: { name: "均衡", desc: "2K 贴图 · 中等面数（推荐；她 1.5MB／他 4.2MB）" },
  high: { name: "极致", desc: "最高贴图与面数 · 最清楚但吃显存（她 1.7MB／他 35.5MB）" },
};
