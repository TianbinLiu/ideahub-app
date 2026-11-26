// ★★ 高斯泼溅第 0 步（2026-11-25）：开发期开关 + splat 落位参数 + 加载阶段。
//
// 施工单：docs/gs-step0-plan.md（方案 A：一块 PBR 盖板压在 splat 桌面之上）。
// 资产台账与这一段量出来的数：docs/gs-step0-splat-log.md。
//
// 三条纪律（都是拿"回退没被写死"的教训换的）：
//   ① **默认关**。开关是常量 `GS_STEP0`；关着的时候 TableScene 那一棵树与今天逐字节相同
//      （房间/灯组/桌面全走今天那套代码），正式体验一个字都不变。
//   ② **splat 只负责环境**。桌面/卡牌/法阵永远是 mesh —— splat 里的颜色在训练时就把光乘进去了，
//      换不了面、点不中、也淡不进去（docs/gaussian-splatting-workshop.md §9.1）。
//   ③ **拿不到就回退，不许黑屏**。8 秒超时 / 加载失败 / WebGL 能力不足 → `failed` →
//      `GsStep0Environment` 原样画回今天的程序化书房（见该文件）。
//
// 开发期免改代码开法：`npm run dev` 之后给地址加 `?gs=1`（`import.meta.env.DEV` 恒假的生产构建里永远关着；
// 页面里想临时对尺度就再加 `gsScale=3.2&gsYaw=20.15&gsTilt=-6&gsX=0&gsY=0&gsZ=0`，五个数分别覆盖下面那组落位参数；
// 两档高斯用 `?quality=draft` 切（真机上不用重出包，见 gsQuality 的注释）。
import { useSyncExternalStore } from "react";
import { Euler, Quaternion, Vector3 } from "three";
import type { WebGLRenderer } from "three";
// 探针的转轴要过相机位置：机位只有一处（layout.LAND_CAM），别在这里手抄坐标
import { LAND_CAM } from "./layout";

/** ★ 开关。要验收/试效果时改成 true（或在 dev 地址上加 ?gs=1），提交前保持 false。 */
export const GS_STEP0 = false;

const devOn = (): boolean => {
  if (!import.meta.env.DEV || typeof location === "undefined") return false;
  return new URLSearchParams(location.search).get("gs") === "1";
};

// ── 实验入口：真机（release 包）怎么打开这一档 ────────────────────────────────
// ★★ 为什么不能只靠 ?gs=1（2026-11-25 真机验收）：devOn() 读的是 `import.meta.env.DEV`，
//    release 包里那一位恒假 —— 手机上无论地址写什么都不可能打开这一档。
//    但这一档也**不能默认开**（普通用户不该看见实验画面）。所以多一个**默认关**的本机开关：
//    设置 → 这台设备 → 高斯场景（实验），值存 localStorage。它不是产品功能，
//    只是把 `gsStep0On()` 的第三个条件打开；打开后走的就是同一条 splat 路径。
const EXP_KEY = "gsStep0Experiment";
/** 高斯数量上限（同一行里 `全部` / 80 万两档：真机 A/B 帧率用；缺省 0 = 全画不截断） */
const MAX_KEY = "gsStep0MaxSplats";
const MIN_CAP = 10_000;

function lsRead(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return ""; // 隐私模式 / 存储被禁：当作没开（回退今天的房间，别崩）
  }
}
function lsWrite(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不下就只在这一次会话里生效（下面两个模块级变量已经写了） */
  }
}

/** 设置里那一行开关的状态（默认关；读一次冷启动值） */
let expOn = lsRead(EXP_KEY) === "1";
/** 设置里选的高斯上限；0 = 全部（不截断） */
let expMax = Number(lsRead(MAX_KEY)) || 0;

/** 这一档此刻到底开没开（`GS_STEP0` 常量 / dev 的 ?gs=1 / 设置里的本机开关；三者任一） */
export const gsStep0On = (): boolean => GS_STEP0 || devOn() || expOn;

/** 设置页那一行读它 */
export function gsExperimentOn(): boolean {
  return expOn;
}

/**
 * 设置页那一行写它（真机验收用）。不刷新页面也能生效：
 * 阶段是模块级单例 —— 打开时从 off 回到 loading（TableScene 会挂上 splat 子树），关掉时置 off。
 * ★ dev 的 ?gs=1 是另一路开关：开着它时这一行不把正在看的场景摘掉（只影响下次冷启动）。
 */
export function setGsExperiment(on: boolean): void {
  if (on === expOn) return;
  expOn = on;
  lsWrite(EXP_KEY, on ? "1" : "0");
  if (!devOn()) setGsPhase(on ? "loading" : "off");
}

/** 这一档实际用几个高斯：dev 的 ?max= 覆盖 > 设置里选的档 > 0（= 全画，不截断）
 *  ★ 0 不是"用 0 个"，是"不截断"：Spark 的 maxSplats 选项实测不截断（见 GS_STEP0_BUDGET）。 */
export function gsMaxSplats(): number {
  if (import.meta.env.DEV && typeof location !== "undefined") {
    const raw = Number(new URLSearchParams(location.search).get("max"));
    if (Number.isFinite(raw) && raw >= MIN_CAP) return Math.round(raw);
  }
  return expMax >= MIN_CAP ? Math.round(expMax) : 0;
}

/** 设置页那一行显示的当前档（0 = 全部） */
export function gsMaxSplatsSetting(): number {
  return expMax >= MIN_CAP ? Math.round(expMax) : 0;
}

/** 设置页那一行写它（0 = 全部不截断） */
export function setGsMaxSplats(n: number): void {
  if (!Number.isFinite(n) || n < 0) return;
  if (n > 0 && n < MIN_CAP) return;
  expMax = Math.round(n);
  lsWrite(MAX_KEY, String(expMax));
}

/**
 * NPC 补光开不开（见 GsStep0Environment.DayLights 的 fill）。
 * 对照档只在 dev 认：`?gs=1&nofill=1` 时不挂那盏灯，同机位截两张做 A/B。
 * 正式包（release）里这一位恒为 true —— 主人真机上看到的就是带补光的那一版。
 */
export function gsFillOn(): boolean {
  if (!import.meta.env.DEV || typeof location === "undefined") return true;
  return new URLSearchParams(location.search).get("nofill") !== "1";
}

// ── 加载耗时（真机验收：从进入工坊到 splat 出现）────────────────────────────
// ★ 每次进工坊重新计时（离开再回来 spz 已在 HTTP 缓存里，读数会明显变快）；
//   真机报告里取**冷启动第一次**那个数，别拿二次进工坊的数当验收读数。
const GS_LOAD = { entered: 0, ready: 0 };

/** 进入工坊（TableScene 挂载、且这一档开着）时调 */
export function gsMarkEntered(): void {
  GS_LOAD.entered = performance.now();
  GS_LOAD.ready = 0;
}

/** splat 初始化完成（第一次真正能看见它）时调 */
export function gsMarkReady(): void {
  if (!GS_LOAD.ready) GS_LOAD.ready = performance.now();
}

/** 首进加载耗时（毫秒；没量到 = 0） */
export function gsLoadMs(): number {
  return GS_LOAD.ready > 0 && GS_LOAD.entered > 0 ? Math.round(GS_LOAD.ready - GS_LOAD.entered) : 0;
}

/** splat 资产：**不进仓库**（见 .gitignore 的 `public/models/study/gs/`）。开启前把导出的 spz 放到这里。 */
export const GS_STEP0_ASSET = "/models/study/gs/workshop-step0.spz";

// ── 画质档（2026-11-26 第 2 版资产）：refined 2M / draft 524k ──────────────────
// ★ 同一套 11 视角、同一份位姿，Atlas 给了两档：draft 500 credits（41 s）、refined 5000（18.5 min）。
//   两档的**内容**是一样的（同一批输入、同一套位姿），差别只是高斯数（524,288 / 2,000,000）。
//   留这个开关是为了真机 A/B：draft 档量"填充率是不是瓶颈"，refined 档量"画质值不值这 4 倍"。
//   验收与两档读数见 docs/gs-step2-splat-log.md §4。
// ★ 默认 refined。生产构建里也可以是 draft（改这一个常量即可，不用碰路径）；
//   真机临时对照不用重新出包：设置里的实验档之外再给两个覆盖口子（dev 的 ?quality= / localStorage），
//   与 `gsMaxSplats` 同一种做法 —— 换档要重新进工坊才会重新建 SplatMesh。
export const GS_QUALITY: "refined" | "draft" = "refined";
const QUALITY_KEY = "gsStep0Quality";
/** 这一档此刻用哪个文件（覆盖顺序：dev 的 ?quality= > localStorage > GS_QUALITY） */
export function gsQuality(): "refined" | "draft" {
  if (import.meta.env.DEV && typeof location !== "undefined") {
    const q = new URLSearchParams(location.search).get("quality");
    if (q === "draft" || q === "refined") return q;
  }
  return lsRead(QUALITY_KEY) === "draft" ? "draft" : GS_QUALITY;
}
/** refined / draft 两个文件的名字都写在这里（路径是同一个目录，改名只改这一处） */
export const GS_STEP0_ASSETS = {
  refined: GS_STEP0_ASSET,
  draft: "/models/study/gs/workshop-step0-draft.spz",
} as const;
/** 当前档的 URL —— GsStep0Room 建 SplatMesh 时读它（每次建 mesh 现读，所以换档后重进工坊生效） */
export function gsAssetUrl(): string {
  return GS_STEP0_ASSETS[gsQuality()];
}

// ── 落位（splat 世界 → 游戏世界）────────────────────────────────────────────
// 推导、量法与三张验收截图见 docs/gs-step2-splat-log.md（上一版（单图重建）的推导在
// docs/gs-step1-splat-log.md，两版的房间基、尺度、俯仰没有一位是抄来的）。这里只留结论与"为什么"。
//
// ★★ 这一版的资产又换了（2026-11-26，`feat/gs-step2-splat`）：同一间「魔女阁楼」，输入从**一张图**
//    换成 **11 张伪多视角**（`design/atlas-prep-views.py` 归一，view-11 那张 18mm 剔掉），走 Atlas
//    `images2PosedRGBD` **估出 11 个真位姿**（不再是上一版那个"11 个占位位姿"），再 `posedImages2Splats`
//    出 refined 2M 高斯。⇒ 上一版"参考图对位 + 单条视线打射线"的定位法在这里能升级成**点云几何量测**：
//    因为位姿是真的，点云在估计出的世界坐标系里是一个连续的房间，不再是一条视线推出来的平板。
//
// ① 房间基（由点云自己量出来，不靠参考图的像素对应）：见 FLOOR 常量。
//    · **地板不是 y=0**（上一版是）：`y = -0.02313·d + 0.03890·s + 0.19252`（残差 std 0.035）——
//      即地板在房间中线处 y≈0.07，整块板对世界 y 倾斜 1.4°。地板的 tilt 是重建时 Atlas 把
//      "canonicalize 到第一帧相机"留下的（那台相机 pitch -1.24°），不是拍歪了；
//      这一点**不纠正**（要纠就得多一位 roll，而墙本来就要被 ④ 的 tilt 前倾 6°）。
//    · 用两面侧墙（s≈-3.33 壁炉墙 / s≈+0.70 书柜墙）的法线叉乘得"上"= (-0.012, 0.9999, -0.0007)，
//      与 +y 只差 0.7° ⇒ 下面照旧只写 yaw + tilt 两位，不再引入 roll。
//    · 房间尺寸：**纵深 d 7.96 × 宽 s 4.31 × 高 3.84**（上一版 4×8×3，同一间屋子的另一种画法）。
//    · 圆窗在**远墙**（d≈6.85）正中：中心 (s -1.30, d 6.83, y 1.52)、直径 0.90。
//    · 长桌顺视线摆：桌面顶面中心 (s -1.27, d 3.20, y 0.835)、**2.50（沿 d）× 1.17（沿 s）**，
//      桌面比脚底（该处地板 y=0.070）高 **0.765**。
//    · 屋子、桌子、窗**都在同一条中线 s=-1.28 上** ⇒ 朝向只剩一个 yaw。
// ② 朝向 **yaw = +20.15°**：房间"朝窗"方向 F = +e1 = (0.3446, 0, -0.9387)。
//    `R_y(20.15°)·F = (0,0,-1)` ⇒ 圆窗落在 **-z（正对面）**、壁炉墙在 **-x（左）**、书柜墙在 **+x（右）**，
//    与 11 张参考图逐张一致（不要为了凑对称去转 90°：这间屋子的窗与桌长轴同向，转 90° 就是把窗甩到侧墙）。
//    与上一版（-36.87°）差这么多，是因为两版重建的**世界坐标系是各自估出来的**（都以第一帧相机为原点）。
// ③ 尺度 **SCALE = 3.2**（沿用上一版，好处是两版的观感差只是重建质量差，不是尺度差）：
//    桌面 2.50 × 1.17 → **8.00 × 3.74** 世界单位；桌面中心落到 TARGET=(0,-1.1,0) 之后，整张桌子在
//    世界 z ∈ [-3.98, +3.98]、y ∈ [-1.52, -0.68]（盖板是 22×9 ⇒ z∈[-4.52,+4.52]，**两侧各 0.54 余量**）。
//    上限卡在纵深：桌面 2.50·SCALE ≤ 9 ⇒ **SCALE ≤ 3.60**；取 3.2 留了 11% 余量（④ 的 tilt 会把远端
//    再往前压 0.09）。横向 ±1.87 远窄于盖板 ±11 —— 横向不是约束（同上一版）。
//    ★ 别再往上抬到"桌子露出盖板"：一露就与 22×9 的网格桌面叠成两张桌子（上一版 §5 风险 5 同一条）。
// ④ 俯仰 **TILT_DEG = -6°**（绕游戏 X，负 = 把房间远端往下压）。
//    为什么需要（这一版比上一版小得多）：窗口中心只比桌面高 0.77 splat 单位 = 2.46 世界单位，
//    相机却在桌面上方 5.0（LAND_CAM pos y=3.9、桌面顶 -1.1）。不压的话窗心在视平线上方一点点，
//    而画面顶只到视平线下 5°（fov 50、俯角 30°）—— 窗会被画面顶裁掉一截。
//    -6° 是量出来的（把点云按候选落位投进 LAND_CAM，取窗口亮点的像素包围盒）：
//    **窗在屏幕 y 46~171 px 之间**，可见带是 y 0~197（盖板远边那条线），上方留 46 px、下方留 26 px；
//    俯仰再少（-3°）窗顶就摸到 y=19；再多（-8°）窗底压到 187、快贴上盖板远边。
//    ★ 代价照旧认下来：墙会前倾 6°（上一版 14°）。这一版**没有**上一版那种"沉屋子保壁炉"的两难 ——
//    壁炉台在 y≈1.5（世界）远在盖板之上，怎么压都在。
// ⑤ 平移 **TARGET = [0, -1.1, 0]**：桌面顶面中心落到 (0,-1.1,0)。
//    Y=-1.1 与上一版相同：tilt 把桌面近端抬起 4.0·sin6° ≈ 0.42 ⇒ 桌面最高点 y≈-0.68，
//    整张桌面躲在盖板顶面 y=0 以下；盖板盒往下包 0.5，连桌沿都在盒子里。
//    Z=0 / X=0：桌子落在盖板正中（屋子中线就是 x=0）。
const ANCHOR = {
  /** 桌面顶面中心（splat 帧的房间坐标 s=右 / d=朝窗 / y=**绝对高度**，不是相对地板） */
  tableS: -1.27,
  tableD: 3.2,
  tableTopY: 0.835,
  /** 桌面 2.50（沿 d，长轴）× 1.17（沿 s，宽） */
  tableLen: 2.5,
  tableWid: 1.17,
  /** 圆窗（远墙正中）：直径 0.90，中心 y 1.52 */
  win: { s: -1.303, d: 6.83, y: 1.515, dia: 0.9 },
  /** 壁炉（左墙 s≈-3.33）：只给"火"的占位光用，**炉膛位置是估的**（h≈0.5 那一层点被家具挡住，量不准，
   *  取与上一版同高）。火本身默认关（GS_FIRE），真火要等桌面切除之后才看得见。 */
  fire: { s: -3.18, d: 4.8, y: 0.5 },
};
/** 地板平面（同一份点云的拟合结果，y = a·d + b·s + c；见 ①）。只用来把"相对地板高"换算成绝对 y。 */
export const GS_FLOOR = { a: -0.02313, b: 0.0389, c: 0.19252 };
/** ★ 房间坐标 (s=右, d=朝窗, y=高) → splat 帧的 xyz。
 *  为什么要有这一步：CENTER 是喂给 three 旋转矩阵的**splat 帧坐标**；
 *  (s,d,y) 是「房间自己的轴」上那三个数，直接塞进去等于把屋子又转了一次 ——
 *  2026-11-25 上一版踩过：圆窗跑到画面右边、桌子偏到 -x，查了半天以为 yaw 反了。
 *  这一行只做基变换，不含朝向（朝向在 yaw 里）。
 *  ★ 0.9387 / 0.3446 = cos/sin(69.84°)：房间 s 轴（右）= (0.9387,0,0.3446)、d 轴（朝窗）=(0.3446,0,-0.9387)，
 *    由两侧墙法线 + 远墙法线量出来（`basis.py`），不是从参考图猜的。 */
const toSplat = (s: number, d: number, y: number): [number, number, number] => [0.9387 * s + 0.3446 * d, y, 0.3446 * s - 0.9387 * d];
/** 桌面顶面中心（splat 帧的 xyz）—— 变换后它落到 TARGET */
const CENTER: [number, number, number] = toSplat(ANCHOR.tableS, ANCHOR.tableD, ANCHOR.tableTopY);
const YAW_DEG = 20.15;
const TILT_DEG = -6;
const SCALE = 3.2;
const TARGET: [number, number, number] = [0, -1.1, 0];

/** dev 的 ?gsXxx 覆盖（生产构建里一律走常量） */
function devNum(name: string, fallback: number): number {
  if (!import.meta.env.DEV || typeof location === "undefined") return fallback;
  const raw = new URLSearchParams(location.search).get(name);
  if (raw === null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

const scale = devNum("gsScale", SCALE);
/** R = Rx(tilt)·Ry(yaw)（three 的 XYZ 顺序：先 yaw 再绕世界 X 俯仰） */
const euler = new Euler(
  (devNum("gsTilt", TILT_DEG) * Math.PI) / 180,
  (devNum("gsYaw", YAW_DEG) * Math.PI) / 180,
  0,
  "XYZ",
);

// ── 验收钩子：±6° 平移视角（localStorage `gsStep0YawProbe`，单位度；缺省 0 = 完全不生效）──
// ★ 为什么要在落位常量这一层做：App 的相机是**固定机位**（CameraRig 那套归演出，不接受这一档去动它），
//   而"伪多视角重建在偏离原始视锥之后会不会重影/拉伸"只能靠**平移视角**去验。把 splat 绕
//   **相机所在的竖轴**转 θ，等于房间相对相机原地转 θ —— 与"相机原地转头 θ"逐像素等价（纯旋转）。
//   盖板 / NPC / 卡牌是网格，**不参与**这次旋转（截图里只看房间那一条带，见 docs/gs-step2-splat-log.md §4）。
// ★ 只给验收用：默认 0；真机上用 WebView 调试口写 localStorage 再刷新（不必重出包）。
const PROBE_KEY = "gsStep0YawProbe";
/** 探针角（度）：读一次冷启动值，夹在 ±30° 里（写错也不至于把屋子转飞） */
const probeDeg = Math.max(-30, Math.min(30, Number(lsRead(PROBE_KEY)) || 0));

/** 挂 splat 的那个 group 的变换（position/rotation/scale 三件一起用，别在别处再乘一次）。
 *  ★ 位置 = TARGET − scale·(R 作用在 CENTER 上)：`CENTER` 那个点（桌面顶面中心）落到 `TARGET`。
 *    上一版是手写 cos/sin 展开的（只有 yaw 时够用），这一版多了 tilt，改成用 Euler 算一遍 ——
 *    以后再加一位不用重新对一遍符号。
 *  ★ 旋转 = 探针（绕相机竖轴）· 基础（tilt·yaw）。探针为 0 时这一层是恒等，与没有它逐字节相同。 */
const rotatedCenter = new Vector3(...CENTER).applyEuler(euler).multiplyScalar(scale);
const basePos = new Vector3(
  devNum("gsX", 0) + TARGET[0] - rotatedCenter.x,
  devNum("gsY", 0) + TARGET[1] - rotatedCenter.y,
  devNum("gsZ", 0) + TARGET[2] - rotatedCenter.z,
);
/** 探针的转轴（过相机位置的一条竖线；相机机位只读 layout，别手抄坐标） */
const probeAxis = new Vector3(LAND_CAM.pos[0], 0, LAND_CAM.pos[2]);
const qBase = new Quaternion().setFromEuler(euler);
const qProbe = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (probeDeg * Math.PI) / 180);
const qTotal = qProbe.clone().multiply(qBase);
const totalEuler = new Euler().setFromQuaternion(qTotal, "XYZ");
const totalPos = basePos.clone().sub(probeAxis).applyQuaternion(qProbe).add(probeAxis);
/** 落位钩子对外只剩这三个数（GsStep0Room 挂 primitive 用；换落位/探针都只改上面那一处） */
export const GS_STEP0_TRANSFORM = {
  scale,
  rotation: [totalEuler.x, totalEuler.y, totalEuler.z] as [number, number, number],
  position: totalPos.toArray() as [number, number, number],
};
/** splat 帧的 xyz → 游戏世界（火/窗这些"跟着房间走"的点用它，别各自再拼一遍） */
const toWorld = (p: [number, number, number]): Vector3 =>
  new Vector3(...p).multiplyScalar(scale).applyQuaternion(qTotal).add(totalPos);
/** 探针角（度）—— 角标上要写出来，截图本身就带着"这是不是 ±6° 那一张"的证据 */
export function gsYawProbe(): number {
  return probeDeg;
}
/** ★★ 火（占位接口，2026-11-25）：**现在不是真火，只是一盏默认关的点光 + 一个坐标**。
 *
 *  为什么先留接口：壁炉是这间屋子最抢眼的陈设（参考图左边那座雕花石炉），真火（体积 shader /
 *  火焰视频面片）要等第 2 步做完桌面切除之后才有地方放 —— 现在炉膛在盖板顶面以下，火看也看不见。
 *  所以这一版只在**壁炉炉膛**的位置放一盏点光：位置由下面的 FIRE 常量经同一个 GS_STEP0_TRANSFORM 现算
 *  （换落位常量时自动跟着走，别在别处再手抄一份坐标）。以后接真火只改 `GsStep0Environment` 里那一段：
 *  把 `{GS_FIRE && <pointLight …/>}` 换成火焰的网格 / shader，位置仍旧读 `GS_FIRE_LIGHT.position`。
 *
 *  ★ 默认关（GS_FIRE = false）：打开它就是多一盏点光 + 一次 draw call；验收时按关/开各截一张。
 *  ★ 这一版量出来的位置：炉膛 ≈ (s, d, y) = (-3.18, 4.80, 0.50)（splat 房间坐标；左墙 s≈-3.33），
 *    换到游戏世界之后 y ≈ **-2.70** —— 比盖板顶面低 2.7，所以这盏灯此刻照不到桌面、也不会多出假亮斑。
 *    真火要上桌看得见，得先把桌面从 splat 里切掉（方案 B）或把这间屋子重出一版更深的。 */
export const GS_FIRE = false;
const fireWorld = toWorld(toSplat(ANCHOR.fire.s, ANCHOR.fire.d, ANCHOR.fire.y));
/** 火那盏点光的参数（位置是算出来的，别手抄） */
export const GS_FIRE_LIGHT = {
  position: fireWorld.toArray() as [number, number, number],
  color: "#ffb066",
  intensity: 14,
  distance: 16,
  decay: 1.8,
};
/** 圆窗在世界里的位置（同样是算出来的）：窗面泛光与"窗光从哪来"都读它。
 *  ★ 这一版窗比上一版小得多（直径 0.90 splat × 3.2 = 2.88 世界单位，上一版 6.08），
 *    所以在世界里的落点要靠 ANCHOR.win 现算，别手抄那几个数。 */
const windowWorld = toWorld(toSplat(ANCHOR.win.s, ANCHOR.win.d, ANCHOR.win.y));

/** 一档灯（方案 A 的光只照网格桌面与卡牌 —— splat 不吃灯，见 docs/gs-step0-plan.md §4.4）。
 *
 *  ★★ 2026-11-25（step1 新场景）：**从「白天暖窗光」改成「月光」**。上一版那间屋子是白天、暖光、
 *  窗在正前方；这一版的概念图是**晚上**：深蓝紫的月光从正前方的圆窗进来，房间整体冷、暗。
 *  所以这里三样都换了（数值不是拍的，是照参考图的色温/亮度对着调的，取值与对照见台账 §4）：
 *    · bg / fog 换成房间自己的暗蓝灰（原来那个暖灰 #2b2a28 在接缝处会露一撮暖色）；
 *    · 主光从 #fff2df / 2.4 换成冷月白 / 1.5，方向仍是**从窗那边（-z）斜上方**打进来；
 *    · 窗面泛光挪到**圆窗在世界里的位置**（按落位现算，见 GS_DAY.window 的注释），色温也转冷。
 *  fill（NPC 顺光）**原样保留** —— 它跟这一版房间朝向无关，是给她的脸兜底的。 */
export const GS_DAY = {
  /** 背景色：只在 splat 没盖住的缝隙里露出来 —— 取房间自己的暗蓝灰，接缝处看不出边界 */
  bg: "#171b22",
  /** 雾：这一版屋子比上一版更深（圆窗在相机前 ~18.3 世界单位，房间纵深 7.96×3.2=25.5），
   *  起点放到窗那一带（20）之后 —— 雾在 20 之前不起作用，窗与近处的墙都不吃雾。 */
  fog: [20, 70] as [number, number],
  /** 主光 = 月光：从**窗那侧（-z）斜上方**打进来（x 偏 -2.5 = 窗外偏左，与参考图里壁炉在左的明暗一致）；
   *  阴影框只框"桌面"那一块（框整间房 = 把有限的阴影像素摊薄，plan §4.4）。 */
  sun: { position: [-2.5, 7, -12] as [number, number, number], intensity: 1.5, color: "#c8d8f5" },
  /** 窗面泛光：位置 = 圆窗在世界里的位置（落位常量算出来的，**别手抄**）；直径 = 窗径 0.90×3.2 ≈ 2.88。
   *  ★ 2026-11-26：这一版窗心只比桌面高 0.77 splat 单位 ⇒ 世界高度比上一版低得多
   *    （圆窗世界 y ≈ -0.15，上一版 +0.17 —— 看着差不多，但这一版是"低到盖板顶面以下一点点"），
   *    宽度也跟着从 6 降到 3 —— 面积小了 4 倍，同样的 intensity 会显得暗，所以比上一版抬了一点。
   *  不支持阴影 / 只支持 PBR 材质 / 必须先 RectAreaLightUniformsLib.init() */
  window: { position: windowWorld.toArray() as [number, number, number], width: 3, height: 3, intensity: 4 },
  /**
   * ★ NPC 补光（2026-11-25）。为什么需要：这一档的窗墙在 -z（正前方、窗光漂亮），
   * 而 NPC 站在桌子对面、**面朝 +z**（玩家）—— 窗光从她背后打进来，她的脸与躯干正面
   * 只剩环境光，在手机屏上就是一块剪影（见 docs/gs-step0-splat-log.md §5 已知风险 1）。
   *
   * 为什么是"相机这一侧（+z）、略高于桌面"的方向光：
   *  · 相机在 +z（layout.LAND_CAM pos z=7.4，俯角 30°），NPC 面朝 +z ⇒ 从 +z 打过来正好
   *    照亮她的脸与躯干正面，而不动窗光在她身后/侧面的塑形；
   *  · 仰角 atan(2.6 / 7.6) ≈ 18.9°，比相机俯角低 11°：差着这点角度，脸上才有从上到下的
   *    过渡；完全同角会拍成一张平脸（影棚里的"机位灯"就是这么丢立体感的）；
   *  · x 偏 +0.8（相机右侧）是给鼻梁/脸颊留一点侧向明暗，同时不抢窗光"从 -z 来"的方向感；
   *  · 用**方向光**而不是点光/聚光：补光要均匀兜住整张脸 + 上身，点光离得近会在脸上留一块
   *    过曝圆斑与一条桌面上的假高光；方向光没有距离衰减，且默认不投影 ⇒ 不会多出第二条影子。
   *  · 颜色比窗光（#fff2df）冷一点：补光在摄影里本来就更接近冷色环境光，也不把她的皮肤
   *    和暖色窗光染成同一条色带。
   *
   * ★ 强度为什么是 0.9（2026-11-25 量的，不是拍的）：主光 sun = 2.4 ⇒ 补光 ≈ 主光的 1/2.7。
   *   在浏览器同机位截 A/B 两张，量 NPC 那一块的平均亮度：补光 0.75 时脸 +22%、0.9 时 +27%
   *   （不补光时她的躯干正面只剩环境光，整块接近剪影）；桌面只被提亮 +4% / +5%。
   *   再往上（≥1.0）桌板朝向相机那一侧会开始比 splat 里的桌面更亮 —— splat 不响应灯光（本文件头 ②），
   *   **网格与 splat 的接缝**就是从那里开始显形的，所以取 0.9 不再往上。
   * ★ 对照档：dev 的 `?gs=1&nofill=1` 不挂这盏灯（gsFillOn()），同机位 A/B。
   */
  fill: { position: [0.8, 2.6, 7.6] as [number, number, number], intensity: 0.9, color: "#eef2f7" },
  /** 环境：程序化的"月夜窗光"等距柱状图 → PMREM（真 HDR 以后换，见 GsStep0Room 的注释） */
  envIntensity: 0.5,
};

/** 加载预算：没就绪就当失败（回退程序化书房，不黑屏）。
 *  ★ 2026-11-26：12 秒（上一版 8 秒）。资产从 31.3 MiB 涨到 38.0 MB（仍是 2M 高斯，字段更满），
 *    加上 Spark chunk 的冷启动，8 秒在模拟器上贴得太近（读数见 docs/gs-step2-splat-log.md §4）。
 *    高斯数默认不截断，见下。 */
export const GS_STEP0_BUDGET = {
  timeoutMs: 12000,
  /**
   * ★ 0 = 不截断（2,000,000 个全画）。这个数原来写的是 1_200_000，但 2026-11-25 实测：
   *   Spark 的 `maxSplats` 选项只是**生成器分配容量**，不是渲染上限 —— 传 120 万照样画
   *   200 万（HUD 与 tris 都对得上）。真正的截断是渲染期改 `splat.splats.numSplats`
   *   （见 GsStep0Room）；它保留打包数组的**前半段**，房间会缺一块 —— 只配当
   *   "成本对照档"（真机 A/B 帧率），不能当画质档，所以默认 0。
   */
  maxSplats: 0,
};

// ── 加载阶段（一个模块级的极小 store，TableScene 与两处环境切换都读它）──
// 为什么不是 prop：盖板要替换 `<Table />`、房间要替换 `<MagicStudy />`，两处在 TableScene 的不同行，
// 中间隔着 NPC/法阵/卡组十几行 —— 层层传 prop 会把这张表搅得更难读。
export type GsPhase = "off" | "loading" | "ready" | "failed";

let phase: GsPhase = gsStep0On() ? "loading" : "off";
const listeners = new Set<() => void>();

export function setGsPhase(next: GsPhase): void {
  if (next === phase) return;
  phase = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 读当前阶段（TableScene 用它决定挂盖板还是今天的 `<Table />`） */
export function useGsPhase(): GsPhase {
  // 本仓 React 19，没有 SSR；subscribe/getSnapshot 都指向这一份模块级状态
  return useSyncExternalStore(subscribe, () => phase);
}

/** WebGL 能力：splat 的累加缓冲是浮点纹理；缺这个的话 Spark 起不来（不如提前判、回退干净） */
export function gsCapability(gl: WebGLRenderer): { ok: boolean; missing: string[] } {
  const ctx = gl.getContext() as WebGL2RenderingContext | null;
  if (!ctx) return { ok: false, missing: ["webgl2"] };
  const missing = ["EXT_color_buffer_float", "OES_texture_float_linear"].filter((n) => !ctx.getExtension(n));
  return { ok: missing.length === 0, missing };
}
