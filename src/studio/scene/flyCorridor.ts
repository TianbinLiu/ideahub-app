// ★★ 点云廊（2026-11-27，`feat/gs-tunnel-depth`）—— 主人第 2 条"把穿行可用的深度做够"。
//
// 为什么需要它：窗景 splat 是 ml-sharp 单图重建的，夜档窗外内容只有 **0.22 m** 深（z 1.67~1.82 m），
//   相机一穿出窗面就只剩一片空。昼档底表有真纵深（海天 z 到 120 m），可以用它；夜档没有，只能复制。
//
// ★★ 这一版与上一版（6 层 × 12 万 = 71.9 万）的差别：
//   ① **层数 12（夜）/ 9（昼）**，层距 ~0.62 m，nearly 连续地铺满"窗面 → 终点 +1.4 m"；
//   ② **z 方向拉伸**：源云自己的 0.16 m 深盒按 `zStretch` 拉开（夜 2.6 ⇒ 0.42 m 厚），
//      与层距互补 —— 单独用层会有"一层一层"的呼吸感，单独拉伸则点会沿线挤成一根根（见 §2 的取舍）；
//   ③ **每层保留比例递减**（夜 0.60 → 0.24）：越远越稀，走廊最后几层**自然把背景透出来**，
//      不需要运行时再逐层淡出（背景在 `flyBackdrop.ts`，摆在终点前方 2.4 m）；
//   ④ 夜档接回 **`window-moon-deep.spz`**（6.3 万点、24 m 深空副本，上一版被裁掉没接线），
//      压到终点前 0.9~2.3 m 当"远处的点云"；
//   ⑤ 昼档**不加副本**：底表（256,148 点）自己的海天纵深就是足够的远场，
//      在 `WindowSplat` 的修饰器里按**局部 z** 把近场那一层（会糊屏的密点）在穿行时剔掉，
//      远景留着 ⇒ 昼档只要 9 层走廊。
//
// ★ `maxSplats` 预算（Spark 的 splat 纹理容量上限 983,040，见 docs/gs-flythrough-log.md §9）：
//   夜 260,000（底表）+ 630,000（12 层，含递减）+ 63,375（深空）= 953,375 ✓
//   昼 256,148（底表）+ 497,000（9 层） = 753,148 ✓
//   点数在 `buildCloud` 里现算并打印；`flyCloudStats()` 把"底表 + 走廊 + 深空"一起报出来。
//
// ★ 为什么还是"烘一份 packed 数组 + 一个 SplatMesh"：验收给了新增 draw call ≤ 4。
//   Spark 每个 SplatMesh 每帧一次 accumulate；12 层分 12 个 mesh 就是 +12。烘成一份 = +1，
//   另加光尘 +1（背景平面是普通 mesh，+1，但它只在转场里可见）。合计 +3。
import * as THREE from "three";
import { PackedSplats, SplatMesh, dyno, fromHalf, toHalf } from "@sparkjsdev/spark";
import { FLY_U } from "./flyTimeline";
import { WINDOW, flyDir, pagePose } from "./moonGeometry";
import { applySplatLook, makeSplatLookUniforms, registerSplatLookMesh } from "./splatLook";

/** 一档的点云廊参数（改只改这里；夜/昼各自一套 —— 主人第 2 条的"分档策略"） */
export interface FlyCloudPlan {
  /** 复制几层 */
  layers: number;
  /** 第一层离**窗面**多远（m，窗外为正） */
  firstZ: number;
  /** 层距（m） */
  spacing: number;
  /** 每层 z 的额外随机（±m） */
  zJitter: number;
  /** 源云 z 方向拉伸（>1 = 把那 0.16 m 的深盒拉开；实测 2.6 时层间不再有空档，也不会读成"竖条"） */
  zStretch: number;
  /** 第 l 层的横向放大：scaleBase + scalePerLayer·l */
  scaleBase: number;
  scalePerLayer: number;
  /** 每层横向错开（±m） */
  offsetXY: number;
  /** 每个点再抖开多少（±m，三轴）—— 打散"这是同一张图"的可辨识度 */
  pointJitter: number;
  /** 每层自转（±rad） */
  rotatePerLayer: number;
  /** 每层保留源点的比例（越远越稀 ⇒ 背景透出来）。长度必须 = layers */
  keep: readonly number[];
  /** 走廊整体不透明度：夜 0.45 / 昼 0.22 —— 昼档的点是"奶油云 + 青绿海"的亮色，
   *  同样的 alpha 会在亮背景上糊成一片粉白；夜里 0.45 才看得见"点"。 */
  alpha: number;
}

export const FLY_CLOUD = {
  night: {
    layers: 12,
    firstZ: 0.10,
    spacing: 0.62,
    zJitter: 0.05,
    zStretch: 2.6,
    scaleBase: 1.45,
    scalePerLayer: 0.26,
    offsetXY: 0.42,
    pointJitter: 0.85,
    rotatePerLayer: 0.5,
    keep: [0.6, 0.58, 0.55, 0.52, 0.49, 0.46, 0.43, 0.4, 0.36, 0.32, 0.28, 0.24],
    alpha: 0.45,
  },
  day: {
    layers: 9,
    firstZ: 0.10,
    // 层距 0.82（夜 0.62）：昼档只复制 9 层（底表自带纵深，见文件头），但要铺到**终点之后**
    //   —— 最后一层在 z_out 6.66 = 终点（5.7）前方 0.96 m，验收的"终点前 1 m 内不为 0"才成立。
    spacing: 0.82,
    zJitter: 0.06,
    zStretch: 2.2,
    scaleBase: 1.5,
    scalePerLayer: 0.3,
    offsetXY: 0.45,
    pointJitter: 0.95,
    rotatePerLayer: 0.5,
    keep: [0.62, 0.58, 0.54, 0.5, 0.46, 0.42, 0.38, 0.34, 0.3],
    alpha: 0.22,
  },
  /** 夜档的深空副本（`window-moon-deep.spz`，24 m 外同一张窗景、6.3 万点）。改这里就是改"远处那片点" */
  deep: {
    /** 压到离窗面（z_out）多远：落在终点（5.7 m）前方 1.1~2.9 m，背景（8.1 m）之前 */
    z0: 6.8,
    z1: 8.6,
    /** 横向放大（那 6.4~8.5 m 的宽幅按 2.2 倍摊开才铺得到 fov） */
    scaleXY: 2.2,
    /** 单颗高斯乘数（源 σ 中位 19.5 mm；不缩的话 2 m 处一颗就 20 px，6.3 万颗叠起来是一层灰纱） */
    splatScale: 0.6,
    /** 不透明度乘数（它是"远处的回声"，不能和底表一样实） */
    alpha: 0.18,
    /** 每层自转（±rad） */
    rotate: 0.35,
  },
  /** 每层高斯尺寸乘数（1 = 原样）—— 走廊离相机近、放大后单颗会糊成大团 ⇒ 收到 0.5；
   *  最终屏幕上还有 `splatLook` 的 k 倍率，两者相乘。 */
  splatSize: 0.5,
  /** 走廊整体不透明度（第 3 条"点变大之后背景会不会被糊住"的答案：会 —— 69 万颗放大后叠起来
   *  在 1200~1500 ms 那一帧把整屏糊成一层蓝灰。所以**每档一个 alpha**（见 FlyCloudPlan.alpha）：
   *  夜 0.45 / 昼 0.22。这一位在 `buildCloud` 里按档盖进 `CORRIDOR_TUNE.alpha`。
   *  ★ 只作用于走廊（`splatLook` 的 alphaK 对窗景底表保持 1，化点段不能变透明）。 */
  alpha: 0.45,
  /** "离镜头太近的点"淡出区间（m）：走廊每 0.62 m 就有一层从镜头里穿过去，放大后那些点会糊满整屏。
   *  0.3 → 0.9：0.9 m 内的点不要（近处那颗会占掉半个屏幕），0.9~2 m 的点正好是屏幕上 2~4 px 的"大点"。 */
  nearFade: { inner: 0.3, outer: 0.9 },
  /** 光尘点数 */
  dustCount: 420,
} as const satisfies {
  night: FlyCloudPlan;
  day: FlyCloudPlan;
  deep: { z0: number; z1: number; scaleXY: number; splatScale: number; alpha: number; rotate: number };
  splatSize: number;
  alpha: number;
  nearFade: { inner: number; outer: number };
  dustCount: number;
};

/** 窗景底表（整图）各档点数：只用于预算读数（`noteCorridorSkin` 会把真数传进来覆盖它） */
const BASE_SPLATS_FALLBACK = { night: 260_000, day: 256_148 } as const;
/** Spark 的 splat 纹理容量（上一版实测的上限，见文档 §9） */
export const SPLAT_CAP = 983_040;

const CORRIDOR_SPZ = {
  night: { near: "/models/study/gs/window-moon.spz", deep: "/models/study/gs/window-moon-deep.spz" },
  day: { near: "/models/study/gs/window-sea.spz", deep: null },
} as const;
export type CorridorSkin = keyof typeof CORRIDOR_SPZ;
/** 大厅这一轮是哪一档（夜/昼）—— `WindowSplat` 就绪时告诉这里 */
let skin: CorridorSkin | null = null;
/** 底表点数（`WindowSplat` 就绪时报进来，预算用） */
let baseSplats = 0;
/** 正在加载的那一份源（避免两次点击重复请求） */
let sourceLoad: Promise<{ near: PackedSplats | null; deep: PackedSplats | null } | null> | null = null;
/** 加载源用的临时 SplatMesh（只读它的 packedSplats；建完就 dispose，不进场景、不占 draw call） */
let sourceMeshes: SplatMesh[] = [];

let built: FlyCloud | null = null;
let buildTimer: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeFlyCloud(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 当前这一份点云廊（没建好 = null） */
export function getFlyCloud(): FlyCloud | null {
  return built;
}

/** 窗景 splat 就绪时调（`WindowSplat`）：告诉点云廊这一轮用哪一档皮肤、底表有多少点，并开始加载走廊源。 */
export function noteCorridorSkin(next: CorridorSkin, baseCount?: number): void {
  if (baseCount && baseCount > 0) baseSplats = baseCount;
  if (skin === next) return;
  skin = next;
  // 换装扮（用户在大厅里跨过 19:00 / 07:00 或设置里切了）时走廊要跟着换：已经建好的先扔掉
  if (built) disposeFlyCloud();
  sourceLoad = null;
  if (!buildTimer) {
    buildTimer = window.setTimeout(() => {
      buildTimer = null;
      void ensureFlyCloudAsync();
    }, 250);
  }
}

/** 加载一份 spz（不建在场景里，只拿它的 packedSplats）。失败回 null（老包 / 被裁过的包）。 */
function loadOne(mesh: SplatMesh, url: string): Promise<PackedSplats | null> {
  return new Promise<PackedSplats | null>((resolve) => {
    mesh.initialized
      .then(() => {
        const packed = mesh.packedSplats ?? null;
        console.log(`[gsfly] 走廊源就绪 ${url}: ${packed?.numSplats ?? 0} 个高斯`);
        resolve(packed);
      })
      .catch((err: unknown) => {
        console.warn(`[gsfly] 走廊源 ${url} 没加载成功 → 这一档少一层`, err);
        resolve(null);
      });
  });
}

function loadSources(): Promise<{ near: PackedSplats | null; deep: PackedSplats | null } | null> {
  if (sourceLoad) return sourceLoad;
  const plan = CORRIDOR_SPZ[skin ?? "night"];
  sourceLoad = (async () => {
    const nearMesh = new SplatMesh({ url: plan.near, raycastable: false });
    sourceMeshes.push(nearMesh);
    const near = await loadOne(nearMesh, plan.near);
    let deep: PackedSplats | null = null;
    if (plan.deep) {
      const deepMesh = new SplatMesh({ url: plan.deep, raycastable: false });
      sourceMeshes.push(deepMesh);
      deep = await loadOne(deepMesh, plan.deep);
    }
    return { near, deep };
  })();
  return sourceLoad;
}

/** 异步兜底：点「匹配」时源还在路上就先 await（建好大约 40~120 ms，来得及接在化点之后）。 */
async function ensureFlyCloudAsync(): Promise<FlyCloud | null> {
  if (built) return built;
  if (!skin) return null;
  const src = await loadSources();
  if (built || !src || !src.near || !src.near.packedArray || src.near.numSplats <= 0) return built;
  built = buildCloud(src.near, src.deep, skin);
  // 源只是"数据模板"：复制完就 dispose 掉临时 mesh（不进场景，只省显存）
  for (const m of sourceMeshes) m.dispose();
  sourceMeshes = [];
  notify();
  return built;
}

/** 立即建（点「匹配」时兜底：触发加载，建好会 notify；没就绪就先返回 null）。 */
export function ensureFlyCloud(): FlyCloud | null {
  if (built) return built;
  void ensureFlyCloudAsync();
  return built;
}

/** dispose（`FlyCloud` 组件卸载时调；大厅 → 房间那一拍跟着整棵酒店场景一起没） */
export function disposeFlyCloud(): void {
  if (buildTimer !== null) {
    window.clearTimeout(buildTimer);
    buildTimer = null;
  }
  if (skin == null) return;
  if (built) {
    const { mesh, dust } = built;
    built = null;
    dust.parent?.remove(dust);
    dust.geometry.dispose();
    const mat = dust.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
    // SplatMesh.dispose() 会把它自己的 packedSplats 一起 dispose
    mesh.parent?.remove(mesh);
    mesh.dispose();
  }
  for (const m of sourceMeshes) m.dispose();
  sourceMeshes = [];
  sourceLoad = null;
  notify();
}

/** 一份点云廊（`mesh` 与 `dust` 一起建、一起放） */
export interface FlyCloud {
  mesh: SplatMesh;
  dust: THREE.Points;
  /** 建它时用的源（只用于"哪一份窗景"的排查；数据已经复制，源 dispose 不影响这一份） */
  source: PackedSplats;
  /** 走廊本体（不含深空副本）点数 */
  corridorSplats: number;
  /** 深空副本点数（夜档；昼档 0） */
  deepSplats: number;
  /** 相机位置 uniform（"离镜头太近的点淡掉"，见 `makeCorridorModifier`） */
  camPos: dyno.DynoVec3<THREE.Vector3, string>;
  /** 走廊三个可现调的旋钮（DEV `__gsFly.tune`）：近处淡出内/外半径、整体 alpha */
  tune: { nearInner: ReturnType<typeof dyno.dynoFloat>; nearOuter: ReturnType<typeof dyno.dynoFloat>; alpha: ReturnType<typeof dyno.dynoFloat> };
}

/** 走廊的"近处淡出 / 整体压暗"三个旋钮（DEV 可现调；`__gsFly.tune()`） */
const CORRIDOR_TUNE: { nearInner: number; nearOuter: number; alpha: number } = {
  nearInner: FLY_CLOUD.nearFade.inner,
  nearOuter: FLY_CLOUD.nearFade.outer,
  alpha: FLY_CLOUD.alpha,
};

/** 走廊的修饰器：点长什么样（splatLook）+ **离镜头太近的点淡掉** + **整体压暗**。
 *  ★ 为什么要有后两样：12 层每 0.62 m 就有一层从镜头**里面**穿过去，放大 2~3 倍后那些点会糊满整屏
 *    （第一版截图 t=1500ms 是一片奶白）。0.25~0.7 m 内淡掉 = 镜头周围留一圈"干净空腔"，
 *    0.7~2 m 的点正好是屏幕上 2~4 px 的"大点"；`alpha` 则是"69 万颗叠起来"的补偿（见 FLY_CLOUD.alpha）。 */
function makeCorridorModifier(
  amount: dyno.DynoVal<"float">,
  look: ReturnType<typeof makeSplatLookUniforms>,
  camPos: dyno.DynoVec3<THREE.Vector3, string>,
  tune: { nearInner: ReturnType<typeof dyno.dynoFloat>; nearOuter: ReturnType<typeof dyno.dynoFloat>; alpha: ReturnType<typeof dyno.dynoFloat> },
) {
  return dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => {
    if (!gsplat) throw new Error("no gsplat input");
    const g = dyno.splitGsplat(gsplat).outputs;
    const dist = dyno.length(dyno.sub(camPos, g.center));
    const near = dyno.smoothstep(tune.nearInner, tune.nearOuter, dist);
    const out = dyno.combineGsplat({ gsplat, opacity: dyno.mul(dyno.mul(g.opacity, near), tune.alpha) });
    return { gsplat: applySplatLook(out, amount, look) };
  });
}

/** DEV / 验收读数 */
export function flyCloudStats(): {
  skin: CorridorSkin | null;
  layers: number;
  splats: number;
  corridorSplats: number;
  deepSplats: number;
  baseSplats: number;
  total: number;
  cap: number;
  ready: boolean;
  buildMs: number;
  drawCost: number;
} {
  const plan = skin ? FLY_CLOUD[skin] : FLY_CLOUD.night;
  const corridor = built?.corridorSplats ?? 0;
  const deep = built?.deepSplats ?? 0;
  const base = baseSplats || (skin ? BASE_SPLATS_FALLBACK[skin] : 0);
  return {
    skin,
    layers: plan.layers,
    splats: built ? (built.mesh.packedSplats?.numSplats ?? 0) : 0,
    corridorSplats: corridor,
    deepSplats: deep,
    baseSplats: base,
    total: base + corridor + deep,
    cap: SPLAT_CAP,
    ready: !!built,
    buildMs: BUILD_MS,
    drawCost: built ? 2 : 0,
  };
}

let BUILD_MS = 0;

// ── 建 ────────────────────────────────────────────────────────────────────

/** 确定性随机数（建出来的点云廊每次一致，验收截图可复现） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 源云 z 的中位数（按 z 排序取中，避免被少数远景拉偏） */
function medianZ(packed: PackedSplats): number {
  const n = packed.numSplats;
  const arr = packed.packedArray as Uint32Array;
  const zs = new Float32Array(n);
  for (let i = 0; i < n; i++) zs[i] = fromHalf(arr[i * 4 + 2] & 0xffff);
  zs.sort();
  return zs[n >> 1] ?? 1.4;
}

function buildCloud(near: PackedSplats, deep: PackedSplats | null, planSkin: CorridorSkin): FlyCloud {
  const t0 = performance.now();
  const cfg: FlyCloudPlan = FLY_CLOUD[planSkin];
  // 世界 z：窗面 = WINDOW.center[2]；"zOut" 一律按**离窗面多远**算（窗外为正）。
  // ★ 2026-11-27 修：上一版这里用了 `windowViewOrigin`（拍摄机位、比窗面靠室内 1.6 m）再自己减 zRef，
  //   少减了一次 ⇒ 12 层整体往室内缩了 1.42 m，镜头飞到终点时前面早就没有层了（点密度在 s=7.5 归零）。
  const [, , wz] = WINDOW.center;
  const [cx, cy] = WINDOW.center;
  const rnd = lcg(0x5eed1234);
  const arr = near.packedArray as Uint32Array;
  const n = near.numSplats;
  const zRef = medianZ(near);
  const srcBytes = arr.subarray(0, n * 4);
  const shrink = Math.round(Math.log(FLY_CLOUD.splatSize) * (254 / 21));

  const perLayer = cfg.keep.map((k) => Math.max(1, Math.min(n, Math.floor(n * k))));
  const corridorSplats = perLayer.reduce((a, b) => a + b, 0);

  // 深空副本：先扫出它的局部 z 范围（用来把 24 m 深的东西压到 z0~z1）
  let deepCount = 0;
  let deepArr: Uint32Array | null = null;
  let deepZmin = 0;
  let deepZmax = 1;
  let deepXmid = 0;
  let deepYmid = 0;
  if (deep && deep.packedArray && deep.numSplats > 0) {
    deepArr = deep.packedArray as Uint32Array;
    deepCount = deep.numSplats;
    let zmin = Infinity;
    let zmax = -Infinity;
    let xmin = Infinity;
    let xmax = -Infinity;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i < deepCount; i++) {
      const w1 = deepArr[i * 4 + 1];
      const w2 = deepArr[i * 4 + 2];
      const x = fromHalf(w1 & 0xffff);
      const y = fromHalf(w1 >>> 16);
      const z = fromHalf(w2 & 0xffff);
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
    }
    deepZmin = zmin;
    deepZmax = Math.max(zmin + 1e-3, zmax);
    deepXmid = (xmin + xmax) / 2;
    deepYmid = (ymin + ymax) / 2;
  }

  const out = new Uint32Array((corridorSplats + deepCount) * 4);
  let o = 0;

  for (let l = 0; l < cfg.layers; l++) {
    const keepN = perLayer[l];
    // 每层的常数变换：z 偏移 + 放大 + 自转（绕窗心·z 轴）
    const dz = cfg.firstZ + l * cfg.spacing + (rnd() - 0.5) * 2 * cfg.zJitter;
    // 横向放大：越远越大（点散开在四周）。★ 最后两层**收束**（scale < 1.2）：
    //   镜头飞到终点时，最后两层离它 0.4~1.0 m；如果还按 4 倍铺开，那点全飞到画面外 ——
    //   验收的"终点前 1 m 内点密度不为 0"就是被这一步补上的（点收在飞行轴附近）。
    const last = cfg.layers - 1;
    const sc =
      l === last ? 0.9 : l === last - 1 ? 1.1 : cfg.scaleBase + cfg.scalePerLayer * l;
    const offX = (rnd() - 0.5) * 2 * cfg.offsetXY;
    const offY = (rnd() - 0.5) * 2 * cfg.offsetXY;
    const ang = (rnd() - 0.5) * 2 * cfg.rotatePerLayer;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const jitter = cfg.pointJitter;
    for (let i = 0; i < keepN; i++) {
      // 等间隔抽稀（源点按图像/空间顺序排 ⇒ 等间隔抽样在画面上也是均匀的）
      const si = Math.min(n - 1, Math.floor((i * n) / keepN));
      // ★★ **颜色与位置解耦**（2026-11-27，第 3 条逼出来的）：颜色改从**另一个**源点取（7919 与 120000
      //   互质，是一个置换）。不这么做的话，这一层仍是一张"窗景"：dots 一放大，月亮/云就重新读得出来
      //   （第一版 k=2.5 的截图里，整个屏幕是一轮放大的月亮）。解耦之后只剩"窗景的调色板 + 一团点"。
      const ci = (si * 7919 + 104729) % n;
      const s = si * 4;
      const cs = ci * 4;
      const w0 = srcBytes[cs];
      const w1 = srcBytes[s + 1];
      const w2 = srcBytes[s + 2];
      const w3 = srcBytes[s + 3];
      // 局部（OpenCV：x 右 / y 下 / z 前）→ 世界（见 moonGeometry.windowSplatToWorld）
      const lx = fromHalf(w1 & 0xffff);
      const ly = fromHalf(w1 >>> 16);
      const lz = fromHalf(w2 & 0xffff);
      const dx = lx;
      const dy = -ly;
      // 绕窗心自转 + 放大 + 横向错开 + 每点抖动（打散"同一张图复制"的可辨识度）
      const rx = cx + offX + (dx * cos - dy * sin) * sc + (rnd() - 0.5) * jitter;
      const ry = cy + offY + (dx * sin + dy * cos) * sc + (rnd() - 0.5) * jitter;
      // z：源云的深盒按 zStretch 拉开、沿窗外铺开；再叠每点抖动
      const zOut = dz + (lz - zRef) * cfg.zStretch + (rnd() - 0.5) * jitter;
      const rz = wz - zOut;
      const b = o * 4;
      out[b] = w0; // 颜色 / alpha 原样
      out[b + 1] = toHalf(rx) | (toHalf(ry) << 16);
      out[b + 2] = (w2 & 0xffff0000) | toHalf(rz);
      // 高斯尺寸：三颗 scale 字节各减一个常数（对数尺度；不动四元数那个字节）
      const sx = Math.max(1, Math.min(255, (w3 & 0xff) + shrink));
      const sy = Math.max(1, Math.min(255, ((w3 >>> 8) & 0xff) + shrink));
      const sz = Math.max(1, Math.min(255, ((w3 >>> 16) & 0xff) + shrink));
      out[b + 3] = sx | (sy << 8) | (sz << 16) | (w3 & 0xff000000);
      o += 1;
    }
  }

  // 深空副本（夜档）：24 m 外同一张窗景压到 z0~z1，横向摊开、单颗放大、压暗
  if (deepArr && deepCount > 0) {
    const d = FLY_CLOUD.deep;
    const ang = (rnd() - 0.5) * 2 * d.rotate;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const dShrink = Math.round(Math.log(d.splatScale) * (254 / 21));
    for (let i = 0; i < deepCount; i++) {
      const s = i * 4;
      // 深空副本也把颜色与位置解耦（同一张图在 1~2 m 处会被放大到整屏，月亮会"复读"）
      const cs = ((i * 4099 + 777) % deepCount) * 4;
      const w0 = deepArr[cs];
      const w1 = deepArr[s + 1];
      const w2 = deepArr[s + 2];
      const w3 = deepArr[s + 3];
      const lx = fromHalf(w1 & 0xffff) - deepXmid;
      const ly = fromHalf(w1 >>> 16) - deepYmid;
      const lz = fromHalf(w2 & 0xffff);
      const t = Math.max(0, Math.min(1, (lz - deepZmin) / (deepZmax - deepZmin)));
      const zOut = d.z0 + t * (d.z1 - d.z0);
      const dx = lx * d.scaleXY;
      const dy = -ly * d.scaleXY;
      const rx = cx + (dx * cos - dy * sin);
      const ry = cy + (dx * sin + dy * cos);
      const rz = wz - zOut;
      const b = o * 4;
      // alpha 乘 d.alpha（packed 的 alpha 就是 0..1 线性，字节直接缩放）
      const a0 = (w0 >>> 24) & 0xff;
      out[b] = (w0 & 0x00ffffff) | (Math.max(0, Math.min(255, Math.round(a0 * d.alpha))) << 24);
      out[b + 1] = toHalf(rx) | (toHalf(ry) << 16);
      out[b + 2] = (w2 & 0xffff0000) | toHalf(rz);
      const sx = Math.max(1, Math.min(255, (w3 & 0xff) + dShrink));
      const sy = Math.max(1, Math.min(255, ((w3 >>> 8) & 0xff) + dShrink));
      const sz = Math.max(1, Math.min(255, ((w3 >>> 16) & 0xff) + dShrink));
      out[b + 3] = sx | (sy << 8) | (sz << 16) | (w3 & 0xff000000);
      o += 1;
    }
  }

  // ★ 不传 SH：ml-sharp 是 0 阶 SH（`hasRgbDir()` 假），窗景 spz 里没有 sh1/2/3。
  const packed = new PackedSplats({
    packedArray: out,
    numSplats: o,
    splatEncoding: near.splatEncoding,
  });
  const mesh = new SplatMesh({ packedSplats: packed, raycastable: false });
  mesh.userData.gsSplat = "fly-cloud";
  // ★ 第 3 条：点变大 / 拉成椭圆（dyno，逐 splat）。走廊只在转场里出现 ⇒ amount 恒 1；
  //   另加"离镜头太近的点淡掉"（见 makeCorridorModifier）。
  const look = makeSplatLookUniforms();
  const amount = dyno.dynoFloat(1);
  const camPos = dyno.dynoVec3(new THREE.Vector3(0, 0, 0));
  // 按档盖一次（夜 0.45 / 昼 0.22；DEV `__gsFly.tune()` 还能现调）
  CORRIDOR_TUNE.alpha = cfg.alpha;
  const tune = {
    nearInner: dyno.dynoFloat(CORRIDOR_TUNE.nearInner),
    nearOuter: dyno.dynoFloat(CORRIDOR_TUNE.nearOuter),
    alpha: dyno.dynoFloat(CORRIDOR_TUNE.alpha),
  };
  mesh.objectModifier = makeCorridorModifier(amount, look, camPos, tune);
  mesh.updateGenerator();
  registerSplatLookMesh(mesh);
  mesh.opacity = 0;
  mesh.visible = false;
  const dust = makeDust();
  BUILD_MS = Math.round(performance.now() - t0);
  const total = (baseSplats || BASE_SPLATS_FALLBACK[planSkin]) + o;
  console.log(
    `[gsfly] 点云廊就绪：${cfg.layers} 层 × 递减抽稀 = ${corridorSplats} 点` +
      (deepCount ? ` + 深空副本 ${deepCount}` : "") +
      ` = ${o} 点，${((o * 16) / 1048576).toFixed(1)} MB，建 ${BUILD_MS} ms；` +
      `与底表合计 ${total.toLocaleString("en-US")} / ${SPLAT_CAP.toLocaleString("en-US")}`,
  );
  if (total > SPLAT_CAP) {
    console.warn(`[gsfly] ⚠ 总点数 ${total} 超过 Spark 容量 ${SPLAT_CAP}（要减层或降底表）`);
  }
  return { mesh, dust, source: near, corridorSplats, deepSplats: deepCount, camPos, tune };
}

/** 加色"光尘"：沿穿行路线撒一圈很小很亮的点，穿过时读作空气里的尘埃。 */
function makeDust(): THREE.Points {
  const N = FLY_CLOUD.dustCount;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const rnd = lcg(0xd0571234);
  const [cx, cy] = WINDOW.center;
  const [, , cz] = WINDOW.center;
  for (let i = 0; i < N; i++) {
    const t = rnd();
    const z = cz - (0.2 + t * 7.6);
    const a = rnd() * Math.PI * 2;
    const r = 0.18 + Math.sqrt(rnd()) * 1.45;
    pos[i * 3] = cx + Math.cos(a) * r;
    pos[i * 3 + 1] = cy + Math.sin(a) * r * 0.82;
    pos[i * 3 + 2] = z;
    const warm = rnd() < 0.22;
    const k = 0.45 + rnd() * 0.55;
    col[i * 3] = (warm ? 1.0 : 0.72) * k;
    col[i * 3 + 1] = (warm ? 0.86 : 0.84) * k;
    col[i * 3 + 2] = (warm ? 0.62 : 1.0) * k;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.045,
    map: makeDustSprite(),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = "gs-fly-dust";
  pts.frustumCulled = false;
  pts.visible = false;
  return pts;
}

/** 圆形柔光贴图（64²）：加色混合下的尘埃，边缘必须自己软掉，否则是方块。 */
function makeDustSprite(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** 每帧驱动（`FlyCloud` 组件调；单独放这里方便 DEV 读数）──────────────────── */
/** 把相机位置写给走廊的修饰器（"离镜头太近的点淡掉"用；走廊的 packed 数据就是世界坐标） */
export function setFlyCloudCamera(x: number, y: number, z: number): void {
  const f = built;
  if (!f) return;
  f.camPos.value.set(x, y, z);
  // 三个旋钮每帧写一遍（DEV 现调时不用重建 generator）
  f.tune.nearInner.value = CORRIDOR_TUNE.nearInner;
  f.tune.nearOuter.value = CORRIDOR_TUNE.nearOuter;
  f.tune.alpha.value = CORRIDOR_TUNE.alpha;
}

/** DEV：现调走廊的"近处淡出 / 整体压暗"（float uniform 每帧读 ⇒ 立刻生效） */
export function tuneFlyCloud(patch: Partial<typeof CORRIDOR_TUNE>): typeof CORRIDOR_TUNE {
  Object.assign(CORRIDOR_TUNE, patch);
  return { ...CORRIDOR_TUNE };
}

/** 把共享 uniform 的值写到 mesh / Points 上。
 *  `warm` = 预热帧：以 0.001 的不透明度**画一帧**（看不见，但 Spark 会为这份数据编译 program /
 *  上传显存）—— 否则第一次真正出现会在 0.6 s 那一拍卡一下。
 *  返回这一帧谁在画（验收读数用）。 */
export function driveFlyCloud(warm = false): { corridor: boolean; dust: boolean } {
  if (!built) return { corridor: false, dust: false };
  if (warm) {
    built.mesh.visible = true;
    built.mesh.opacity = 0.001;
    built.dust.visible = false;
    return { corridor: true, dust: false };
  }
  const c = FLY_U.corridor.value;
  built.mesh.visible = c > 0.002;
  if (built.mesh.visible) built.mesh.opacity = c;
  const d = FLY_U.dust.value;
  built.dust.visible = d > 0.002;
  if (built.dust.visible) (built.dust.material as THREE.PointsMaterial).opacity = d * 0.9;
  return { corridor: built.mesh.visible, dust: built.dust.visible };
}

// ── 飞行轴点密度（验收读数；DEV / gsAcceptDebug）──────────────────────────────
/** 每一站：相机沿飞行轴走 0.5 m，统计 fov 50°、1024² 方形视锥内的点数与像素覆盖率（128² 网格估算）。 */
export interface DensityRow {
  /** 从匹配页机位算起沿飞行方向的距离（m） */
  s: number;
  /** 相机相对窗面的位置（m，窗外为正） */
  zOut: number;
  /** 视锥内点数（走廊 + 深空） */
  points: number;
  /** 估算的像素覆盖率 0..1（128² 网格，投影足迹按 2σ 直径算） */
  coverage: number;
}

export function flyCloudDensity(step = 0.5, endS = 8.5, grid = 128): DensityRow[] {
  if (!built || !built.mesh.packedSplats) return [];
  const p = pagePose().pos;
  const d = flyDir();
  const right: [number, number, number] = [d[1] * 0 - d[2] * 1, d[2] * 0 - d[0] * 0, d[0] * 1 - d[1] * 0];
  const rl = Math.hypot(...right) || 1;
  const r3 = [right[0] / rl, right[1] / rl, right[2] / rl];
  const up: [number, number, number] = [
    r3[1] * d[2] - r3[2] * d[1],
    r3[2] * d[0] - r3[0] * d[2],
    r3[0] * d[1] - r3[1] * d[0],
  ];
  const f = 1 / (2 * Math.tan((50 * Math.PI) / 360)); // 1024² 上的焦距（px）
  const arr = built.mesh.packedSplats.packedArray as Uint32Array;
  const num = built.mesh.packedSplats.numSplats;
  const [, , winZ] = WINDOW.center;
  const rows: DensityRow[] = [];
  for (let s = 0; s <= endS + 1e-6; s += step) {
    const cam: [number, number, number] = [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
    let points = 0;
    const mask = new Uint8Array(grid * grid);
    for (let i = 0; i < num; i++) {
      const b = i * 4;
      const w1 = arr[b + 1];
      const w2 = arr[b + 2];
      const w3 = arr[b + 3];
      const px = fromHalf(w1 & 0xffff) - cam[0];
      const py = fromHalf(w1 >>> 16) - cam[1];
      const pz = fromHalf(w2 & 0xffff) - cam[2];
      const vx = px * r3[0] + py * r3[1] + pz * r3[2];
      const vy = px * up[0] + py * up[1] + pz * up[2];
      const vz = px * d[0] + py * d[1] + pz * d[2];
      if (vz <= 0.06) continue;
      const tanV = Math.tan((50 * Math.PI) / 360);
      if (Math.abs(vy) > vz * tanV || Math.abs(vx) > vz * tanV) continue;
      points += 1;
      // 投影足迹：屏幕像素半径 ≈ 2σ·f/z（σ 取三轴最大；覆盖率只用来读"有没有铺满"）
      const ln = (w3 & 0xff) / 16 - 10; // 与 SPZ v2 的 scale 编码一致（b/16−10）
      const sig = Math.exp(ln);
      const rpx = (2 * sig * f) / vz;
      const gx = Math.round(vx / (vz * tanV) * 0.5 * grid + grid / 2);
      const gy = Math.round(vy / (vz * tanV) * 0.5 * grid + grid / 2);
      const rr = Math.max(0, Math.min(grid / 2, Math.ceil(rpx / 1024 * grid)));
      for (let yy = -rr; yy <= rr; yy++) {
        for (let xx = -rr; xx <= rr; xx++) {
          if (xx * xx + yy * yy > rr * rr) continue;
          const x2 = gx + xx;
          const y2 = gy + yy;
          if (x2 < 0 || y2 < 0 || x2 >= grid || y2 >= grid) continue;
          mask[y2 * grid + x2] = 1;
        }
      }
    }
    let hit = 0;
    for (let i = 0; i < mask.length; i++) hit += mask[i];
    rows.push({ s: +s.toFixed(2), zOut: +(winZ - cam[2]).toFixed(2), points, coverage: hit / mask.length });
  }
  return rows;
}

// ── DEV 验收钩子（与 `__gsSplit` / `__matchCam` 同一条约定：DEV 或 localStorage gsAcceptDebug=1）──
const acceptOn =
  import.meta.env.DEV ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gsFly = {
    stats: flyCloudStats,
    density: flyCloudDensity,
    tune: tuneFlyCloud,
    get skin() {
      return skin;
    },
    /** 点云廊是否在画（验收要确认穿行段不是"只有窗景 splat"） */
    get visible() {
      return built ? built.mesh.visible : false;
    },
    get opacity() {
      return built ? built.mesh.opacity : 0;
    },
    get splatCount() {
      return built ? (built.mesh.packedSplats?.numSplats ?? 0) : 0;
    },
  };
}
