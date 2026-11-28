// ★★ 点云廊（2026-11-27，`feat/gs-flythrough-dissolve`）—— 主人第 2 条的"四周全是高斯点"。
//
// 为什么需要它：窗景 splat 是 ml-sharp 单图重建的，深度盒只有 **0.22 m**（见 WindowSplat 头注释）。
//   相机一穿出窗面就只剩一片空 —— 旧版正是这样"碎成黑白麻点、背景透明"。
//   所以在穿行段（0.6~2.0 s）要凭空铺一条"点云廊"：**同一份窗景 splat 的点复制 6 层**，
//   沿窗外（-z）每隔 ~1.35 m 铺一层，每层随机 z 偏移 / 轻微缩放 / 自转、颜色照抄原点。
//   相机一路穿过去，就一直在点里（近处被甩到两侧、远处还在前面）。
//
// ★ 为什么是"复制成一份新的 packed 数组"而不是 6 个 SplatMesh：
//   验收给了 **新增 draw call ≤ 4**。Spark 每个 SplatMesh 每帧要一次 accumulate（一次 draw call），
//   6 个副本 = +6。把六层**烘进同一个 PackedSplats**、只建**一个** SplatMesh ⇒ 只 +1 次 accumulate；
//   光尘那 1 个 `THREE.Points` 再 +1。合计 **+2**（点云廊 1 + 光尘 1）。
//   代价是显存：12 万点 × 6 层 × 16 B/点 ≈ 11.5 MB（房间那份 1.6M 是 ~25 MB，这一档在大厅里
//   没有房间，PSS 上仍在上一轮拆场景省下的 87 MB 之内）。
//
// ★ 为什么可以"烘"（CPU 改 packed 数组）而不是在 shader 里按层算：
//   每一层的变换（z 偏移 / 缩放 / 自转）是**每层一个**常数，烘一次就完事；packed 的 center 是
//   3 个 half（`toHalf` 就是 Float32Array/Uint16Array 视图互转，实测 12 万点 × 6 层 ~26 ms，
//   在 Node 里量的），比 6 个 SplatMesh 每帧各跑一遍 accumulate 便宜得多。
//   ★ 这**不是**每帧 CPU 遍历：只在窗景 splat 就绪之后建一次（大厅空闲时），飞行中一个字节都不改。
//
// ★ 层数 / 间距 / 缩放全是常量（下面 FLY_CLOUD），主人以后要调只改这里。
// ★ 不新建任何资产：数据来自已经进包的 `window-*.spz`（同一份 PackedSplats）。
import * as THREE from "three";
import { PackedSplats, SplatMesh, fromHalf, toHalf } from "@sparkjsdev/spark";
import { FLY_U } from "./flyTimeline";
import { WINDOW, windowViewOrigin } from "./moonGeometry";

/** 点云廊的旋钮（改只改这里） */
export const FLY_CLOUD = {
  /** 复制几层（主人给的 6~10；取 6 = 显存与"处处有点"的平衡） */
  layers: 6,
  /** 第一层离线心多远（m）—— 比窗景 splat 自己的最远端（0.38 m）略远，不与之重合 */
  firstZ: 0.25,
  /** 层距（m）：6 层铺到 ~7 m，相机穿行 6.4 + 渐黑 0.9 正好穿完 */
  spacing: 1.25,
  /** 每层 z 的随机偏移（±m）—— 避免读成"一排等距的纸片" */
  zJitter: 0.16,
  /** 每层放大：第 l 层 × (base + perLayer*l)。
   *  ★ 2026-11-27 真机前的一次调参：原来 1 + 0.18*l（最大 1.9）时，相机从层中心穿过去，
   *    0.7 m 外那层就糊满整屏、读成"一张被放大的图"；放到 1.5~4.25 倍之后点散开在四周。 */
  scaleBase: 1.5,
  scalePerLayer: 0.55,
  /** 每层横向错开（±m）：让相机不是每次正对圆心 —— 点才会"围"过来而不是糊一墙 */
  offsetXY: 0.45,
  /** 每层 z 的额外随机（±m，逐层一个） */
  jitterPerPoint: 0.4,
  /** 每个点再抖开多少（±m，三轴）—— 打散"这是同一张图"的可辨识度 */
  pointJitter: 1.5,
  /** 高斯尺寸乘数（1 = 原样）。点云廊离相机近、放大后单颗会糊成大团 ⇒ 收到 0.6 */
  splatSize: 0.5,
  /** 每层自转角（±rad） */
  rotatePerLayer: 0.45,
  /** 光尘点数 */
  dustCount: 420,
} as const;

/** 一份点云廊（`mesh` 与 `dust` 一起建、一起放） */
export interface FlyCloud {
  mesh: SplatMesh;
  dust: THREE.Points;
  /** 建它时用的源（只用于"哪一份窗景"的排查；数据已经复制，源 dispose 不影响这一份） */
  source: PackedSplats;
}

/**
 * 点云廊的**源**：旧的"只含窗洞内容"那两份 12 万点 spz。
 * ★★ 2026-11-27（agent-63 的整图底表上线之后）：大厅/匹配页现在挂的是
 *   `window-moon-full.spz` / `window-sea-full.spz`（26 万点，**整张图：墙 + 窗框 + 窗外**）。
 *   把它复制 6 层 = 6 面墙的隧道，而且每层只放大 18%、深度 +1.35 m，投影一路缩小 —— 不能当走廊。
 *   所以走廊**单独**加载旧的两份（12 万点、0.22 m 深、正好是窗洞那一圈画面），
 *   与整图那份的窗洞区域颜色同源（同一张原图），只是点更集中在窗洞里。
 * ★ 两份旧 spz 仍在仓库/包里（.gitignore 的白名单里，2.5 MB），它们现在是"点云廊专用资产"。
 *   **出包不能裁掉**：裁了夜档穿出去就是空的（夜档整图深度只到 1.8 m，见 docs/gs-flythrough-log.md）。
 */
const CORRIDOR_SPZ = {
  night: "/models/study/gs/window-moon.spz",
  day: "/models/study/gs/window-sea.spz",
} as const;
export type CorridorSkin = keyof typeof CORRIDOR_SPZ;
/** 大厅这一轮是哪一档（夜/昼）—— `WindowSplat` 就绪时告诉这里 */
let skin: CorridorSkin | null = null;
/** 正在加载的那一份源（避免两次点击重复请求） */
let sourceLoad: Promise<PackedSplats | null> | null = null;
/** 加载源用的临时 SplatMesh（只读它的 packedSplats；建完就 dispose，不进场景、不占 draw call） */
let sourceMesh: SplatMesh | null = null;

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

/** 窗景 splat 就绪时调（`WindowSplat`）：告诉点云廊这一轮用哪一档皮肤，并开始加载走廊源。 */
export function noteCorridorSkin(next: CorridorSkin): void {
  if (skin === next) return;
  skin = next;
  // 换装扮（用户在大厅里跨过 19:00 / 07:00 或设置里切了）时走廊要跟着换：已经建好的先扔掉
  if (built) disposeFlyCloud();
  if (!buildTimer) {
    buildTimer = window.setTimeout(() => {
      buildTimer = null;
      void ensureFlyCloudAsync();
    }, 250);
  }
}

/** 加载"只含窗洞内容"的旧 spz（12 万点，~1.3 MB）。不建在场景里，只拿它的 packedSplats。 */
function loadSource(): Promise<PackedSplats | null> {
  if (sourceLoad) return sourceLoad;
  const url = CORRIDOR_SPZ[skin ?? "night"];
  sourceLoad = new Promise<PackedSplats | null>((resolve) => {
    const mesh = new SplatMesh({ url, raycastable: false });
    sourceMesh = mesh;
    mesh.initialized
      .then(() => {
        const packed = mesh.packedSplats ?? null;
        console.log(
          `[gsfly] 走廊源就绪 ${url}: ${packed?.numSplats ?? 0} 个高斯（单层 0.22 m 深度盒）`,
        );
        resolve(packed);
      })
      .catch((err: unknown) => {
        // 老包 / 被裁过的包：走廊源拿不到 —— 走廊不建（窗景 splat 照旧），打一行日志不抛
        console.warn(`[gsfly] 走廊源 ${url} 没加载成功 → 这一档没有点云廊`, err);
        resolve(null);
      });
  });
  return sourceLoad;
}

/** 异步兜底：点「匹配」时源还在路上就先 await（建好大约 30~80 ms，来得及接在化点之后）。 */
async function ensureFlyCloudAsync(): Promise<FlyCloud | null> {
  if (built) return built;
  if (!skin) return null;
  const packed = await loadSource();
  if (built || !packed || !packed.packedArray || packed.numSplats <= 0) return built;
  // 源只是"数据模板"：复制完就 dispose 掉临时 mesh（不进场景，只省一份 12 万点的显存/纹理）
  built = buildCloud(packed);
  if (sourceMesh) {
    sourceMesh.dispose();
    sourceMesh = null;
  }
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
  if (!built) return;
  const { mesh, dust } = built;
  built = null;
  dust.parent?.remove(dust);
  dust.geometry.dispose();
  const mat = dust.material as THREE.PointsMaterial;
  mat.map?.dispose();
  mat.dispose();
  // SplatMesh.dispose() 会把它自己的 packedSplats 一起 dispose（见 spark 的 SplatMesh.dispose）
  mesh.parent?.remove(mesh);
  mesh.dispose();
  notify();
}

/** DEV / 验收读数 */
export function flyCloudStats(): {
  layers: number;
  splats: number;
  ready: boolean;
  buildMs: number;
  drawCost: number;
} {
  return {
    layers: FLY_CLOUD.layers,
    splats: built ? (built.mesh.packedSplats?.numSplats ?? 0) : 0,
    ready: !!built,
    buildMs: BUILD_MS,
    drawCost: built ? 2 : 0,
  };
}

let BUILD_MS = 0;

// ── 建 ────────────────────────────────────────────────────────────────────

/** 一层一个确定性随机数（建出来的点云廊每次一致，验收截图可复现） */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildCloud(src: PackedSplats): FlyCloud {
  const t0 = performance.now();
  const n = src.numSplats;
  const arr = src.packedArray as Uint32Array;
  const L = FLY_CLOUD.layers;
  const out = new Uint32Array(n * 4 * L);
  const [, , oz] = windowViewOrigin();
  const [cx, cy] = WINDOW.center;
  const rnd = lcg(0x5eed1234);
  const srcBytes = arr.subarray(0, n * 4);
  for (let l = 0; l < L; l++) {
    const base = l * n * 4;
    // 先整段照抄（颜色 / 不透明度 / 四元数 / 尺寸全继承原 splat）
    out.set(srcBytes, base);
    // 每层的常数变换：z 偏移 + 放大 + 自转（绕窗心·z 轴）
    const dz = FLY_CLOUD.firstZ + l * FLY_CLOUD.spacing + (rnd() - 0.5) * 2 * FLY_CLOUD.zJitter + (rnd() - 0.5) * 2 * FLY_CLOUD.jitterPerPoint;
    const sc = FLY_CLOUD.scaleBase + FLY_CLOUD.scalePerLayer * l;
    const offX = (rnd() - 0.5) * 2 * FLY_CLOUD.offsetXY;
    const offY = (rnd() - 0.5) * 2 * FLY_CLOUD.offsetXY;
    const ang = (rnd() - 0.5) * 2 * FLY_CLOUD.rotatePerLayer;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    // 高斯尺寸收一个固定的乘数（对数尺度上加一个常数：见 setPackedSplat 的编码）
    const shrink = Math.round(Math.log(FLY_CLOUD.splatSize) * (254 / 21));
    const jitter = FLY_CLOUD.pointJitter;
    for (let i = 0; i < n; i++) {
      const o = base + i * 4;
      const w1 = out[o + 1];
      const w2 = out[o + 2];
      // 局部（OpenCV）→ 世界（见 moonGeometry.windowSplatToWorld 的推导）
      const lx = fromHalf(w1 & 0xffff);
      const ly = fromHalf(w1 >>> 16);
      const lz = fromHalf(w2 & 0xffff);
      const dx = lx; // 世界 x 相对窗心 = 局部 x
      const dy = -ly; // 世界 y 相对窗心 = −局部 y
      // 绕窗心自转 + 放大 + 横向错开 + 每点抖动（打散"同一张图复制"的可辨识度）
      const rx = cx + offX + (dx * cos - dy * sin) * sc + (rnd() - 0.5) * jitter;
      const ry = cy + offY + (dx * sin + dy * cos) * sc + (rnd() - 0.5) * jitter;
      // 世界 z：原点（拍摄机位）− 局部深度（窗外），再往外推 dz
      const rz = oz - lz - dz + (rnd() - 0.5) * jitter;
      out[o + 1] = toHalf(rx) | (toHalf(ry) << 16);
      out[o + 2] = (w2 & 0xffff0000) | toHalf(rz);
      // 高斯尺寸乘 splatSize：三颗 scale 字节各减一个常数（不动四元数那个字节）
      const w3 = out[o + 3];
      const sx = Math.max(1, Math.min(255, (w3 & 0xff) + shrink));
      const sy = Math.max(1, Math.min(255, ((w3 >>> 8) & 0xff) + shrink));
      const sz = Math.max(1, Math.min(255, ((w3 >>> 16) & 0xff) + shrink));
      out[o + 3] = sx | (sy << 8) | (sz << 16) | (w3 & 0xff000000);
    }
  }
  // ★ 不传 SH：ml-sharp 是 0 阶 SH（`hasRgbDir()` 假），窗景 spz 里没有 sh1/2/3。
  const packed = new PackedSplats({
    packedArray: out,
    numSplats: n * L,
    splatEncoding: src.splatEncoding,
  });
  const mesh = new SplatMesh({ packedSplats: packed, raycastable: false });
  mesh.userData.gsSplat = "fly-cloud";
  mesh.opacity = 0;
  mesh.visible = false;
  const dust = makeDust();
  BUILD_MS = Math.round(performance.now() - t0);
  console.log(
    `[gsfly] 点云廊就绪：${L} 层 × ${n} = ${n * L} 点，${(n * L * 16 / 1048576).toFixed(1)} MB，` +
      `建 ${BUILD_MS} ms（新增 draw call = 2：点云廊 1 + 光尘 1）`,
  );
  return { mesh, dust, source: src };
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
    // t 越大越远（窗外）；半径按 sqrt 分布，近轴处稀、外圈密一点
    const t = rnd();
    const z = cz - (0.2 + t * 7.6);
    const a = rnd() * Math.PI * 2;
    const r = 0.18 + Math.sqrt(rnd()) * 1.45;
    pos[i * 3] = cx + Math.cos(a) * r;
    pos[i * 3 + 1] = cy + Math.sin(a) * r * 0.82;
    pos[i * 3 + 2] = z;
    // 冷暖两色随机（月光的冷白 + 一点点炉火的暖）
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

// ── 每帧驱动（`FlyCloud` 组件调；单独放这里方便 DEV 读数）────────────────────
/** 把共享 uniform 的值写到 mesh / Points 上。
 *  `warm` = 预热帧：以 0.001 的不透明度**画一帧**（看不见，但 Spark 会为这份数据编译 program /
 *  上传 11.5 MB 纹理）—— 否则第一次真正出现会在 0.6 s 那一拍卡一下。
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

// ── DEV 验收钩子（与 `__gsSplit` / `__matchCam` 同一条约定：DEV 或 localStorage gsAcceptDebug=1）──
const acceptOn =
  import.meta.env.DEV ||
  (typeof localStorage !== "undefined" && localStorage.getItem("gsAcceptDebug") === "1");
if (acceptOn && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__gsFly = {
    stats: flyCloudStats,
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
