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
// 探针的转轴要过相机位置：机位只有一处（layout.GS_CAM / LAND_CAM），别在这里手抄坐标
import { GS_CAM, setGsSceneMetric } from "./layout";

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
// ★★ 2026-11-26（`feat/gs-table-fire`）：**尺度从 3.2 改成 1.0 —— 1 世界单位 = 1 米**。
//
//   为什么必须改（主人反馈"桌子大小不对、桌面也不对"）：上一版为了让 22×9 的桌面盖板把 splat
//   里的桌面盖住，把房间放大到 SCALE=3.2 —— 量出来纵深 7.96 m 的屋子变成 **25 世界单位深**，
//   而铸卡师（TripoNpc，真人比例 1.7 m）还是 1.7 世界单位高。于是上一版验收图里她像个
//   1/10 大小的手办站在一张 8×3.7 的"平台"上 —— 桌子相对人、相对房间**同时**大了 3.2 倍。
//   现在反过来：**以房间为基准**（量出来的 7.96×4.31×3.84 就是米），SCALE=1，
//   桌子 2.50×1.17、桌面高 0.765 —— 桌长 ≈ 1.47 个 NPC 身高、桌高 ≈ 她腰、房深 ≈ 4.7 个她。
//   "桌子在画面里占多大"改由**相机位置**调（layout.GS_CAM），不再靠缩放场景。
//
// ① 房间基（由点云自己量出来，不靠参考图的像素对应）：见 FLOOR 常量。
//    · **地板不是 y=0**（上一版是）：`y = -0.02313·d + 0.03890·s + 0.19252`（残差 std 0.035）——
//      即地板在房间中线处 y≈0.07，整块板对世界 y 倾斜 1.4°。地板的 tilt 是重建时 Atlas 把
//      "canonicalize 到第一帧相机"留下的（那台相机 pitch -1.24°），不是拍歪了；
//      这一点**不纠正**（要纠就得多一位 roll；桌面/窗按 yaw 定位后肉眼无差，见 ④ 为什么删了 tilt）。
//    · 用两面侧墙（s≈-3.33 壁炉墙 / s≈+0.70 书柜墙）的法线叉乘得"上"= (-0.012, 0.9999, -0.0007)，
//      与 +y 只差 0.7° ⇒ 下面照旧只写 yaw 一位，不引 roll。
//    · 房间尺寸：**纵深 d 7.96 × 宽 s 4.31 × 高 3.84（m）**。
//    · 圆窗在**远墙**（d≈6.85）正中：中心 (s -1.30, d 6.83, y 1.52)、直径 0.90。
//    · 长桌顺视线摆：桌面顶面中心 (s -1.27, d 3.20, y 0.835)、**2.50（沿 d）× 1.17（沿 s）**，
//      桌面比脚底（该处地板 y=0.070）高 **0.765**。
//    · 屋子、桌子、窗**都在同一条中线 s=-1.28 上** ⇒ 朝向只剩一个 yaw。
// ② 朝向 **yaw = +20.15°**：房间"朝窗"方向 F = +e1 = (0.3446, 0, -0.9387)。
//    `R_y(20.15°)·F = (0,0,-1)` ⇒ 圆窗落在 **-z（正对面）**、壁炉墙在 **-x（左）**、书柜墙在 **+x（右）**，
//    与 11 张参考图逐张一致（不要为了凑对称去转 90°：这间屋子的窗与桌长轴同向，转 90° 就是把窗甩到侧墙）。
//    与上一版（-36.87°）差这么多，是因为两版重建的**世界坐标系是各自估出来的**（都以第一帧相机为原点）。
// ③ 尺度 **SCALE = 1.0**（米）。桌面 2.50 × 1.17、桌面顶面中心落到 TARGET 之后：
//    桌角在世界 x=±0.585、z=±1.25；地板 y=-0.775；圆窗心 y≈0.68（只比桌面高 0.68 m）。
//    ★ 与 splat 里烘死的那张桌子的关系：**同向同寸**（长轴 z）。网格桌面把 splat 桌面整个盖住
//      （TARGET.y 取 -0.01 ⇒ splat 桌面在网格毡面下 1.4 cm，点云 ±5 cm 噪声尾部会零星透出来，
//      这是方案 A 的已知残留，见 docs/gs-table-light-log.md 风险 1 —— 别用"把桌面抬高 30 cm"去盖，
//      那会让桌高从 0.78 变成 1.08，与 NPC 的腰线对不上）。
// ④ 俯仰 **TILT = 0°**（上一版 -6°）。为什么这版不能有 tilt：桌面要**贴住 splat 里那张桌子**，
//    一俯仰，网格桌面与 splat 桌面就上下错开 2.5·sin(tilt)，两侧会露出"第二张桌子"或穿模。
//    上一版能压是因为整张桌面被 22×9 的盖板盖住了（盖板比桌面高 1.1 世界单位）。
//    删掉 tilt 之后圆窗还在画面里吗？在：米制机位（GS_CAM）俯角 20°、窗心只比桌面高 0.68 m、
//    在相机前 5.8 m ⇒ 窗心在视野轴上方 ~15°，50° 垂直视野（半角 25°）装得下（截图见 docs）。
// ⑤ 平移 **TARGET = [0, -0.01, 0]**：桌面顶面中心落到 (0,-0.01,0)。
//    Y=-0.01 是让 splat 桌面沉到网格毡面下 1.4 cm（毡面在 y=+0.004）——再高会与毡面 z-fighting，
//    再低桌子相对地板就更高（桌高 = 0.775 - TARGET.y）。Z=0 / X=0：桌子落在正中（屋子中线就是 x=0）。
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
  /** 壁炉（左墙 s≈-3.33）：★★ 2026-11-26 第 2 版（`feat/gs-layout-fix`）按**炉膛内木柴堆的上表面**
   *  重新定位。上一版 (s -2.72, d 3.10, y 0.62) 是世界 (-1.45, -0.27, +0.10) —— 离墙 0.6 m，
   *  火焰**浮在壁炉前面**（验收图里火苗贴着地面、在炉口右侧）。
   *  这一版 (s -3.229, d 3.099, y 0.396) = 世界 **(-1.949, -0.500, +0.101)**：
   *  比墙 (-2.06) 凹进去 0.11 m、落在炉膛内的柴堆上表面（离地 0.285 m）。
   *  量法：从两个已知机位（正对炉口 / 斜上方俯看炉膛）各截一张，按像素反投影三角定位，
   *  残差 ~3 cm；火/点光/光晕/光池四样都读这一个点，别再手抄坐标。 */
  fire: { s: -3.229, d: 3.099, y: 0.396 },
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
/** ★ 0：桌面必须贴住 splat 里那张桌子（理由见 ④），这一位不许再随手加 */
const TILT_DEG = 0;
/** ★★ 侧倾 1.203°（2026-11-26 从点云量出来的，**不是**凑对称）：splat 桌面那层点云对世界的
 *  法线是 (-0.0212, 0.9998, 0.0005) —— 绕世界 z 轴歪 1.2°（房间的 s 轴方向）。
 *  不纠的话，2.5 m 长的桌面远端会高出近端 2.5·sin1.2° ≈ 5.2 cm，网格毡面压不住它：
 *  验收截图里"桌面远半截变成 splat 的灰桌面"就是这么来的（只在远端露）。
 *  纠完之后桌面法线与 +y 差 0.03°、点云残差 std 0.94 cm ⇒ 网格毡面抬高 2.4 cm 就够盖住。
 *  ★ 代价：整间屋子绕视线轴侧倾 1.2°（窗心横移 ~12 cm），肉眼看不出来。
 *  这是这一版唯一新增的旋转位；上一位 tilt 仍是 0（理由见 ④）。 */
const ROLL_DEG = 1.203;
const SCALE = 1;
const TARGET: [number, number, number] = [0, -0.02, 0];

/** dev 的 ?gsXxx 覆盖（生产构建里一律走常量） */
function devNum(name: string, fallback: number): number {
  if (!import.meta.env.DEV || typeof location === "undefined") return fallback;
  const raw = new URLSearchParams(location.search).get(name);
  if (raw === null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

const scale = devNum("gsScale", SCALE);
/** 基础旋转 = Rz(roll)·Rx(tilt)·Ry(yaw)（先朝窗、再俯仰、最后侧倾纠桌面）。
 *  改成四元数链而不是 Euler：这一版多了一位 roll，Euler 的 XYZ 顺序与"先 yaw 后 roll"
 *  的复合顺序容易对反（对反的表现就是桌面歪向另一边，看起来像"点云噪了"）。 */
const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (devNum("gsYaw", YAW_DEG) * Math.PI) / 180);
const qTilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (devNum("gsTilt", TILT_DEG) * Math.PI) / 180);
const qRoll = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (devNum("gsRoll", ROLL_DEG) * Math.PI) / 180);
const qBase = qRoll.clone().multiply(qTilt).multiply(qYaw);

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
 *  ★ 旋转 = 探针（绕相机竖轴）· 基础（yaw；tilt 这一版恒 0）。探针为 0 时这一层是恒等。 */
const rotatedCenter = new Vector3(...CENTER).applyQuaternion(qBase).multiplyScalar(scale);
const basePos = new Vector3(
  devNum("gsX", 0) + TARGET[0] - rotatedCenter.x,
  devNum("gsY", 0) + TARGET[1] - rotatedCenter.y,
  devNum("gsZ", 0) + TARGET[2] - rotatedCenter.z,
);
/** 探针的转轴（过相机位置的一条竖线；相机机位只读 layout.GS_CAM，别手抄坐标） */
const probeAxis = new Vector3(GS_CAM.pos[0], 0, GS_CAM.pos[2]);

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
// ★ DEV 读数（验收/调机位时在控制台一眼看到四个关键落点；生产构建里这几行不存在）
if (import.meta.env.DEV) {
  console.log(
    `[gs] transform scale=${scale} pos=${GS_STEP0_TRANSFORM.position.map((n) => n.toFixed(3)).join(",")} ` +
      `rot=${GS_STEP0_TRANSFORM.rotation.map((n) => ((n * 180) / Math.PI).toFixed(2)).join(",")}° yaw=${YAW_DEG} roll=${ROLL_DEG}`,
  );
}
/** splat 帧的 xyz → 游戏世界（火/窗这些"跟着房间走"的点用它，别各自再拼一遍） */
const toWorld = (p: [number, number, number]): Vector3 =>
  new Vector3(...p).multiplyScalar(scale).applyQuaternion(qTotal).add(totalPos);
/** 探针角（度）—— 角标上要写出来，截图本身就带着"这是不是 ±6° 那一张"的证据 */
export function gsYawProbe(): number {
  return probeDeg;
}
/** ★★ 火（2026-11-26，`feat/gs-table-fire`；**锚点第 2 版** `feat/gs-layout-fix`）：**现在是真火** ——
 *  壁炉炉膛一盏闪烁点光 + `HearthFire.tsx` 的程序化火焰着色器 + 炉前假光池。
 *
 *  ★ 位置由下面的 ANCHOR.fire 经同一个 GS_STEP0_TRANSFORM 现算（换落位常量时自动跟着走，
 *    别在别处再手抄一份坐标）。米制之后的世界落点 ≈ **(-1.95, -0.50, +0.10)**：
 *    墙在 x≈-2.06，火在**炉膛里**、离地 0.285 m（木柴堆上表面）、离桌面远沿 0.86 m。
 *  ★ 这个点现在是**火焰的底边**（不是火焰片中心）：HearthFire 从这里往上长 0.42 m，
 *    所以火的包围盒 ≈ x∈[-1.95±0.08]、y∈[-0.50, -0.08]、z∈[0.10±0.15]（朝相机的片，厚度 0）。
 *  ★ 这盏点光**只照 mesh**（桌子 / NPC / 卡牌 / 法阵）：splat 是 ShaderMaterial，不吃灯 ——
 *    所以墙不会因为"火了"就变暖，地面变暖靠 HearthFire 的假光池，桌面变暖靠光毯。
 *  ★ 数值是米制的（点光 1/d² 衰减）：intensity 7 / distance 5.5 / decay 2 ⇒
 *    桌沿 ≈ 5 lux、NPC 左肩 ≈ 1.2 lux，与窗光（白色 1.5 方向光）亮度差一档，火只当"第二光源"。
 *    验收时按"火开 / 火关"各截一张看真实增益（读数在 docs/gs-table-light-log.md §4）。 */
export const GS_FIRE = true;
const fireWorld = toWorld(toSplat(ANCHOR.fire.s, ANCHOR.fire.d, ANCHOR.fire.y));
/** 火那盏点光的参数（位置是算出来的，别手抄） */
export const GS_FIRE_LIGHT = {
  position: fireWorld.toArray() as [number, number, number],
  color: "#ff9a4a",
  intensity: 7,
  distance: 5.5,
  decay: 2,
};
/** 圆窗在世界里的位置（同样是算出来的）：窗面泛光与"窗光从哪来"都读它。
 *  ★ 米制之后：直径 0.90 m（世界单位），窗心 y≈0.68（只比桌面高 0.68 m）、在相机前 ≈5.8 m。 */
const windowWorld = toWorld(toSplat(ANCHOR.win.s, ANCHOR.win.d, ANCHOR.win.y));

/** 一档灯（方案 A 的光只照网格桌面与卡牌 —— splat 不吃灯，见 docs/gs-step0-plan.md §4.4）。
 *
 *  ★★ 2026-11-25 版是「月光」：深蓝紫、圆窗在 -z、房间整体冷暗。**这一版沿用色温，数值按米制重调**：
 *  场景尺度从 3.2 换成 1 之后，同样 intensity 的灯照在离得近 3 倍的物体上会亮 9 倍 ——
 *  下面每个数都在米制场景里重新量过（截图 A/B：火开/关、补光开/关），换算方法写在每一条后面。 */
export const GS_DAY = {
  /** 背景色：只在 splat 没盖住的缝隙里露出来 —— 取房间自己的暗蓝灰，接缝处看不出边界 */
  bg: "#171b22",
  /** 雾：米制之后房间纵深 7.96 m、圆窗在相机前 ≈5.8 m ⇒ 雾从窗那一带之后起（7 m），
   *  窗前 7 m 不吃雾（否则圆窗会被雾压灰，那是这一档最亮的东西）。 */
  fog: [7, 22] as [number, number],
  /** 主光 = 月光：从**窗那侧（-z）斜上方**打进来（x 偏 -1.2 = 窗外偏左，与壁炉在左的明暗一致）。
   *  ★ 方向光的强度与距离无关，只与"照度"有关：米制之后桌面离窗近了 3 倍，但方向光不看距离 ——
   *    0.9（上一版 1.5）是照着 splat 墙面的亮度校的：再高桌面比 splat 桌面亮一档，接缝就显形。
   *  阴影框按米制桌+人那个范围给（±2.2 × ±1.6），2048² 的阴影图全落在桌面这一块，窗棂影才不糊。 */
  sun: { position: [-1.2, 3.2, -6] as [number, number, number], intensity: 0.9, color: "#c8d8f5" },
  /** 窗面泛光：位置 = 圆窗在世界里的位置（落位常量算出来的，**别手抄**）；宽高 = 窗径 0.90 m。
   *  ★ RectAreaLight 的亮度按**立体角**算：面积从 3×3 缩到 0.9×0.9（1/11），
   *    同样的 intensity 会暗一个档，所以从 4 提到 26（≈ 4 × 11 / 1.7，再按现场观感收一点）。
   *  不支持阴影 / 只支持 PBR 材质 / 必须先 RectAreaLightUniformsLib.init()。 */
  window: { position: windowWorld.toArray() as [number, number, number], width: 0.9, height: 0.9, intensity: 12 },
  /**
   * ★ NPC 补光（2026-11-25 加，米制后重调；**第 2 版换到 +x 这一侧**）。
   *  为什么需要：NPC 站在桌子对面（−x）、**面朝 +x**（玩家）—— 窗光从她左后（−z）打进来，
   *  她的脸与躯干正面只剩环境光，在手机屏上就是一块剪影。
   *
   * 为什么是"玩家这一侧（+x）、略高于桌面"的方向光：
   *  · 相机在 (1.72, 1.16, 0.08)（GS_CAM），NPC 面朝 +x ⇒ 从 +x 打过来正好照亮她的脸与躯干正面；
   *  · 仰角 atan(1.6/3.4) ≈ 25°，比相机俯角高几度：差着这点角度，脸上才有从上到下的过渡；
   *  · z 偏 +0.6 是给鼻梁/脸颊留一点侧向明暗，同时不抢窗光"从 −z 来"的方向感；
   *  · 用**方向光**而不是点光/聚光：补光要均匀兜住整张脸 + 上身，点光离得近会在脸上留一块
   *    过曝圆斑与一条桌面上的假高光；方向光没有距离衰减，且默认不投影 ⇒ 不会多出第二条影子。
   * ★ 强度 0.9：与主光同档，正好把她的正面从剪影提到"看得清表情"；桌面只被提亮约 +5%
   *  （量法：同机位 nofill=1 A/B，见 gsFillOn）。
   * ★ 对照档：dev 的 `?gs=1&nofill=1` 不挂这盏灯（gsFillOn()）。 */
  fill: { position: [3.4, 1.6, 0.4] as [number, number, number], intensity: 0.9, color: "#eef2f7" },
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
/** ★ 米制场景的开关（layout.setGsSceneMetric）：loading/ready 时整个桌面布局换成 1 单位 = 1 米
 *  那一套（见 layout.GS_TABLE/GS_CAM）。failed 必须退回 false —— 回退到今天的书房时，
 *  桌面/机位/卡位要跟今天那套**逐字节相同**，不能留在米制坐标上（那会是"房子换了、桌子没换"）。
 *  初值在模块加载时就写一次：dev 的 ?gs=1 不走 setGsPhase，靠这一行。 */
const metricOf = (p: GsPhase): boolean => p === "loading" || p === "ready";
setGsSceneMetric(metricOf(phase));
const listeners = new Set<() => void>();

export function setGsPhase(next: GsPhase): void {
  if (next === phase) return;
  phase = next;
  setGsSceneMetric(metricOf(next));
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
