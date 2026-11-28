// ★★ 高斯点的"变大 / 拉成椭圆"（2026-11-27，`feat/gs-tunnel-depth`；主人第 3 条）—— 参数与 shader 的唯一出处。
//
// 为什么是**运行时**改尺度（而不是离线改 PLY/SPZ 的 scale 字段）：
//   · ml-sharp 那份资产同时服务**大厅的窗**（离窗 1.6 m、1372×785 上窗洞 ~500 px）与**穿行**（点在眼前）。
//     离线放大是全局的：大厅那扇窗会一起变糊；而大厅的观感是已经拍过板的那一版，不能陪着穿行改。
//   · 运行时用 Spark 的 `SplatMesh.objectModifier`（dyno，逐 splat 在 shader 里算）：
//     大厅里 `amount = 0` ⇒ 输出**逐字节等于原值**；转场里 `amount = 1`。一份资产两种观感。
//   · 不新增 / 不替换任何 spz：APK 不多 3 MB，`maxSplats` 也不受影响（只改每颗的 scale/rot）。
//
// ★★ 尺寸语义（调研结论，数字与出处见 docs/gs-tunnel-log.md §3）：
//   ml-sharp 出的是 INRIA 3DGS 的 PLY：`scale_0/1/2 = ln(σ)`（米，各向同性/异向的**线性**标准差取 log），
//   `opacity = logit(α)`，`rot_0..3 = 单位四元数`，颜色是 0 阶球谐 DC。
//   实测这份资产：σ 中位 0.6 mm（x/y）、0.17 mm（法向 z），α 中位 0.89，四元数**几乎都是单位**（|w| p50 0.99）。
//   ⇒ 它不是"圆点"，本来就是**很薄的小椭圆盘**（x:y:z ≈ 3.5:2.4:1），只是屏幕上 < 1 px。
//   放大要沿**切向**（splat 局部 x/y，也就是窗面平面）乘 k，**法向**（局部 z）乘一个更小的数，
//   否则会变成"小球"而不是"盘子"。椭圆比 r = 切向 x : 切向 y。
//
// ★ 屏幕尺寸换算（fov 50、1024²、离窗 1.6 m 的大厅机位）：1 mm ≈ 0.69 px。
//   原 σ 中位 0.6 mm ⇒ 每颗 0.4 px（这就是"碎成黑白麻点"的来源）；k=2.5 ⇒ ~1 px，k=4 ⇒ ~1.6 px。
//
// ★ 为什么还要"随机自转"：只放大不转，所有椭圆的长轴都朝同一个方向（局部 x 轴），
//   屏幕上会读成一层**方向一致的笔触**；每颗按自己的 hash 绕法向转一个角，才是视频里那种"散开的椭圆"。
//   转的是四元数（quatQuat），不动物理位置，所以点云形状不变。
//
// ★ 不做什么：不改位置（点云几何是第 2 条的事）、不改颜色、不改 alpha（除非调 ALPHA_K）。放大后
//   覆盖面积 ×k²，α 若不动、叠上来会更"实"——背景会不会被糊住由 ALPHA_K 单独控制（见 §3 的对比组）。
import { dyno } from "@sparkjsdev/spark";
import * as THREE from "three";

/** 一组"点长什么样"的参数（4 组对比就是 4 份这个；验收口子 `?gsdot=k,ratio,normalK,alphaK,spin`） */
export interface SplatLook {
  /** 切向放大倍率（x/y 都乘） */
  k: number;
  /** 切向椭圆比 x:y（1 = 圆；2 = 2:1；4 = 4:1） */
  ratio: number;
  /** 法向（splat 局部 z = 窗面法线）乘数。1 = 保持原来的"薄盘" */
  normalK: number;
  /** 不透明度乘数（放大后想把背景透出来就 <1） */
  alphaK: number;
  /** 每颗绕法向随机自转（0 = 不转，1 = 满 0..2π） */
  spin: number;
}

/** 默认值：**最终选中的那一组**（报告 §3 说为什么选它）：
 *  切向 ×2.5、椭圆 1.8:1、法向 ×1.5（薄盘放大后侧看会变细针，加厚一点才像"点"）、绕法向随机自转。 */
export const SPLAT_LOOK_DEFAULT: SplatLook = { k: 2.5, ratio: 1.8, normalK: 1.5, alphaK: 1.0, spin: 1 };

/** 运行时可变的那一份（URL 覆盖 / DEV 的 `__gsDot.set` 都改它） */
export const SPLAT_LOOK_LIVE: SplatLook = { ...SPLAT_LOOK_DEFAULT };

/** 4 组对比（截图用；`?gsdot=` 的简写名也能直接给名字） */
export const SPLAT_LOOK_GROUPS: Record<string, SplatLook> = {
  a: { k: 1.5, ratio: 1, normalK: 1, alphaK: 1, spin: 1 },
  b: { k: 2.5, ratio: 1, normalK: 1, alphaK: 1, spin: 1 },
  c: { k: 2.5, ratio: 2, normalK: 1, alphaK: 1, spin: 1 },
  d: { k: 4, ratio: 4, normalK: 1, alphaK: 1, spin: 1 },
  /** 候选"最终版"：放大 + 轻椭圆 + 加厚法向（薄盘放大后侧看会变成细针） */
  e: { k: 2.5, ratio: 1.8, normalK: 1.5, alphaK: 1, spin: 1 },
};

/** 解析 `?gsdot=`：名字（a/b/c/d）或 `k,ratio,normalK,alphaK,spin`。DEV / `gsAcceptDebug=1` 才认。 */
function readLookOverride(): SplatLook | null {
  if (typeof window === "undefined") return null;
  const dev = import.meta.env.DEV || (() => {
    try {
      return localStorage.getItem("gsAcceptDebug") === "1";
    } catch {
      return false;
    }
  })();
  if (!dev) return null;
  const raw = new URLSearchParams(window.location.search).get("gsdot");
  if (!raw) return null;
  const named = SPLAT_LOOK_GROUPS[raw.trim().toLowerCase()];
  if (named) return named;
  const n = raw.split(",").map(Number);
  if (n.length !== 5 || !n.every((v) => Number.isFinite(v))) return null;
  return {
    k: Math.max(0.1, Math.min(12, n[0])),
    ratio: Math.max(0.1, Math.min(12, n[1])),
    normalK: Math.max(0.1, Math.min(12, n[2])),
    alphaK: Math.max(0.05, Math.min(4, n[3])),
    spin: Math.max(0, Math.min(1, n[4])),
  };
}

export const SPLAT_LOOK: SplatLook = readLookOverride() ?? SPLAT_LOOK_DEFAULT;
Object.assign(SPLAT_LOOK_LIVE, SPLAT_LOOK);

/** shader 里那几个 uniform（dyno 对象；构造一次、每帧只写 .value） */
export interface SplatLookUniforms {
  /** 切向尺度乘数 (k·ratio, k, normalK) */
  k: dyno.DynoVec3<THREE.Vector3, string>;
  alpha: dyno.DynoFloat<string>;
  spin: dyno.DynoFloat<string>;
}

/** `dyno.dynoFloat` 的返回类型（DynoFloat<string>；别写 `dyno.DynoFloat`——那是 `"value"` 那个默认键） */
export type LookFloat = ReturnType<typeof dyno.dynoFloat>;

/** 已经建出来的 uniform（DEV 的 `__gsDot.set` 要就地改它们 —— 不重建 mesh、不重载页面） */
const liveUniforms = new Set<SplatLookUniforms>();
/** 已经装上这个修饰器的 mesh（vec3 uniform 只在重建 generator 时读一次，所以改参数后要叫它们重编） */
const liveMeshes = new Set<{ updateGenerator(): void }>();

export function registerSplatLookMesh(mesh: { updateGenerator(): void }): void {
  liveMeshes.add(mesh);
}

export function makeSplatLookUniforms(): SplatLookUniforms {
  const u: SplatLookUniforms = {
    k: dyno.dynoVec3(new THREE.Vector3(SPLAT_LOOK_LIVE.k * SPLAT_LOOK_LIVE.ratio, SPLAT_LOOK_LIVE.k, SPLAT_LOOK_LIVE.normalK)),
    alpha: dyno.dynoFloat(SPLAT_LOOK_LIVE.alphaK),
    spin: dyno.dynoFloat(SPLAT_LOOK_LIVE.spin),
  };
  liveUniforms.add(u);
  return u;
}

/** DEV / 对比截图：就地改"点长什么样"（4 组对比不用重载页面）。
 *  ★ 必须 `updateGenerator()`：Spark 的 vec3 uniform（k 那几个）是在**建 generator 时**读进去的，
 *    只改 `.value` 不会生效（float 那几个每帧读，所以 alpha 能立刻变 —— 2026-11-27 排查到的坑）。 */
export function setSplatLook(patch: Partial<SplatLook>): SplatLook {
  Object.assign(SPLAT_LOOK_LIVE, patch);
  for (const u of liveUniforms) {
    u.k.value.set(SPLAT_LOOK_LIVE.k * SPLAT_LOOK_LIVE.ratio, SPLAT_LOOK_LIVE.k, SPLAT_LOOK_LIVE.normalK);
    u.alpha.value = SPLAT_LOOK_LIVE.alphaK;
    u.spin.value = SPLAT_LOOK_LIVE.spin;
  }
  for (const m of liveMeshes) m.updateGenerator();
  return { ...SPLAT_LOOK_LIVE };
}

/**
 * "点长什么样"的 dyno 变换（可直接嵌进别的 block）：
 * `amount` 0 = 原样（大厅），1 = 全量（转场）。
 *
 * 变换（px/py/pz 是 splat 局部轴：x 右、y 下、z = 窗面法线）：
 *   scales *= vec3(1 + (k·ratio − 1)·amount, 1 + (k − 1)·amount, 1 + (normalK − 1)·amount)
 *   quat    = quatZ(hash·2π·spin·amount) ⊗ quat      （绕法向随机自转，椭圆长短轴随之转向）
 *   opacity *= 1 + (alphaK − 1)·amount
 * 让"长轴"落在 x 上（乘 ratio），这样 r=2 就是 2:1 的横向椭圆；随机自转把它铺成各个方向。
 */
export function applySplatLook(
  gsplat: dyno.DynoVal<typeof dyno.Gsplat>,
  amount: dyno.DynoVal<"float">,
  u: SplatLookUniforms,
): dyno.DynoVal<typeof dyno.Gsplat> {
  const g = dyno.splitGsplat(gsplat).outputs;
  const one = dyno.dynoConst("float", 1);
  // 每颗自己的角：hashFloat(center) ∈ [0,1) —— 与"化点"那套同一个 hash（稳定、不占额外 attribute）
  const rnd = dyno.hashFloat(g.center);
  const ang = dyno.mul(dyno.mul(rnd, dyno.dynoConst("float", Math.PI * 2)), dyno.mul(u.spin, amount));
  const half = dyno.mul(ang, dyno.dynoConst("float", 0.5));
  // quatZ(half) = vec4(0, 0, sin, cos)；用两个常量基向量拼，避免动态 vec4 构造
  const qz = dyno.add(
    dyno.mul(dyno.dynoConst("vec4", [0, 0, 1, 0]), dyno.sin(half)),
    dyno.mul(dyno.dynoConst("vec4", [0, 0, 0, 1]), dyno.cos(half)),
  );
  const quat = dyno.transformQuat(g.quaternion, { rotate: qz });
  const scaleMix = dyno.mix(dyno.dynoConst("vec3", [1, 1, 1]), u.k, amount);
  const scales = dyno.mul(g.scales, scaleMix);
  const a = dyno.mix(one, u.alpha, amount);
  return dyno.combineGsplat({
    gsplat,
    quaternion: quat,
    scales,
    opacity: dyno.mul(g.opacity, a),
  });
}

/** 只做"点长什么样"的独立修饰器（点云廊用：走廊只在转场里出现，`amount` 恒 1） */
export function makeSplatLookModifier(amount: dyno.DynoVal<"float">, u: SplatLookUniforms) {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error("no gsplat input");
    return { gsplat: applySplatLook(gsplat, amount, u) };
  });
}

// ── DEV / 对比截图钩子（`?gsdot=` 要重载页面；这个就地改，同一次飞行的同机位直接 A/B）──
const acceptOn =
  import.meta.env.DEV ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gsDot = {
    look: () => ({ ...SPLAT_LOOK_LIVE }),
    set: setSplatLook,
    groups: SPLAT_LOOK_GROUPS,
  };
}
