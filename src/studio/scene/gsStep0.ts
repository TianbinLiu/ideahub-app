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
// 页面里想临时对尺度就再加 `gsScale=3.2&gsYaw=-37&gsTilt=0&gsX=0&gsY=0&gsZ=0`，五个数分别覆盖下面那组落位参数）。
import { useSyncExternalStore } from "react";
import { Euler, Vector3 } from "three";
import type { WebGLRenderer } from "three";

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

// ── 落位（splat 世界 → 游戏世界）────────────────────────────────────────────
// 推导与实测见 docs/gs-step1-splat-log.md。这里只留结论与"为什么"，以及**与上一版哪里不同**。
//
// ★★ 这一版的资产换了：上一版（step0）是真人拍 12 个真实机位重出来的房间；这一版是
//    **单图 → Atlas 补 12 视角 → 重建**（输入 `room-master.jpg` 那张「魔女阁楼」概念图）。
//    导出包 `cameras.json` 里 12 个位姿**除 01 之外全是同一个占位值**（`3 2.5 4` + 同一个四元数），
//    所以 step0 那套"拿 12 条视线求最小二乘交点"在这里**用不了**（求出来的是那个占位点）。
//    这一版的定位改走两条腿，读数都抄进台账（§3）：
//    ① **参考渲染对位**：splat 摆成恒等变换、相机放 cameras.json 的 01 位姿（pos (0, 0.8387, 0)、
//       quaternion 只含 36.87° 的 yaw、垂直 fov 36.9°），渲出来与 ZIP 里的 `01-room-master.png`
//       逐处对得上（圆窗 / 壁炉 / 书柜 / 长桌 / 跑表）。⇒ 坐实了 **splat 帧 = 01 相机帧**：
//       U=+Y、F=(-0.6, 0, -0.8)（朝窗）、R=F×U=(0.8, 0, -0.6)（朝右）。
//    ② **点云打射线量锚点**：拿那张参考图上的像素锚点（窗心、桌的近端/远端/左右缘、地板、炉膛…）
//       在 2M 高斯的点云里取前表面，换算成房间坐标 (s=右, d=朝窗, h=高)，读数见下面 ANCHOR。
//
// ① 朝向 **yaw = -36.87°**（= 抵消 01 相机的 yaw）：这一版**不做 step0 那个"再转 90°"**。
//    原因：这间屋子的**长桌是顺着视线方向摆的**（参考图里桌子从画面下沿一路指向圆窗：
//    近端宽 310 px、远端 160 px，是纵向透视），不像 step0 那样横在画面里（长轴 == X）。
//    硬转 90° 会把圆窗推到侧墙 —— 既违背"圆窗在正对面"，也会让我们从**重建从没拍过的那一侧**
//    看这间屋子（单视角重建只有那一个观察方向，侧看就是一堆拉伸的墙）。
//    转 0° 时：圆窗 -z（正前方）、壁炉 -x（左）、书柜 +x（右）—— 与参考图逐处一致。
//    （别用负 scale 去凑朝向：法线/阴影/背面剔除会一起反。）
// ② 尺度 **SCALE = 3.2**：桌面在点云里 1.65 × 0.77 splat 单位（长轴沿 d）⇒ 3.2 之后是
//    **5.28 × 2.46 世界单位**。为什么比上一版（6.6）小这么多：这间屋子的桌子只占房间很小一块
//    （1.65 长的桌子放在 8 单位深的屋子里），而我们的盖板是"整张桌面的替身"。
//    上限卡在**纵向**：桌面纵向 = 1.65 × SCALE，必须整段压进盖板 z∈[-4.5, 4.5]（横屏 9 深）
//    ⇒ **SCALE ≤ 5.45**；取 3.2 留了 41% 余量（下面 ④ 的 tilt 还会把桌面近端抬起来，余量是要的）。
//    横向 ±1.23 远窄于盖板 ±11 —— 盖板两侧的边缘本来就在画框外（近边可见半宽 ±3.7、远边 ±6.4），
//    所以横向不是约束。
// ③ 平移 **TARGET = [0, -1.1, 0]**：桌面顶面中心落到 (0, -1.1, 0)。
//    · Y 低 1.1：让整张桌子（含 ④ 抬起来的近端 0.64 + 那 ±5 cm 噪声尾巴）全部躲在盖板顶面 y=0 以下。
//    · Z = 0：桌子落在盖板正中。
//    ★ 为什么不是"把屋子整体压下去"（上一版那种让让）：压 4.9 确实也能把圆窗拉进画框，但那是连
//      **壁炉一起压到盖板顶面以下**（台面只比桌面高 0.56 splat 单位 = 1.8 世界单位）—— 左边那座
//      雕花炉子就整块没了。这一版改用 ④ 的 tilt：只压远端，近处的壁炉/柜子几乎不动。
// ④ 俯仰 **TILT_DEG = -14°**（这一版新增的第四位，见常量那行的注释）。
const ANCHOR = {
  /** 桌面高度：参考图上"跑表中"处量的 0.577（近端 0.50 / 远端 0.69 —— 参考图本身画得略有起伏） */
  tableTopH: 0.577,
  /** 桌面中心：横向在正中（0.04）；纵向 3.445 = 重建相机到桌心的距离（近端 2.62 / 远端 4.27） */
  tableS: 0.04,
  tableD: 3.445,
  /** 桌面 1.65（沿 d，长轴）× 0.77（沿 s，宽） */
  tableLen: 1.65,
  tableWid: 0.77,
  /** 地板 h=0（重建相机就在地面以上 0.84）；圆窗心 h=2.03、d=7.83 */
  floorH: 0,
  winH: 2.03,
  winD: 7.83,
  /** 壁炉炉膛 (s, d, h)（台面在 h=1.14）—— 火的占位光用它 */
  fire: { s: -1.548, d: 3.94, h: 0.48 },
};
/** ★ 房间坐标 (s=右, d=朝窗, h=高) → splat 帧的 xyz。
 *  为什么要有这一步：CENTER 是喂给 three 旋转矩阵的**splat 帧坐标**；
 *  (s,d,h) 是「房间自己的轴」上那三个数，直接塞进去等于把屋子又转了一次 ——
 *  2026-11-25 踩过：圆窗跑到画面右边、桌子偏到 -x，查了半天以为 yaw 反了。
 *  这一行只做基变换，不含朝向（朝向在 yaw 里）。
 *  ★ 0.8 / -0.6 不是魔数：R=(0.8,0,-0.6)、F=(-0.6,0,-0.8)，正好是 cos/sin 36.87° —— 也就是 01 相机的 yaw。 */
const toSplat = (s: number, d: number, h: number): [number, number, number] => [0.8 * s - 0.6 * d, h, -0.6 * s - 0.8 * d];
/** 桌面顶面中心（splat 帧的 xyz）—— 变换后它落到 TARGET */
const CENTER: [number, number, number] = toSplat(ANCHOR.tableS, ANCHOR.tableD, ANCHOR.tableTopH);
const YAW_DEG = -36.87;
/** ★ 这一版新增的一位：绕**游戏 X 轴**的俯仰（负 = 把房间远端往下压）。
 *  为什么需要：重建相机是**桌面高度平视**（高 0.84，见顶部 ①），而我们的相机在桌面以上 3.9、俯角 30°
 *  （layout.LAND_CAM）—— 同一个房间从高 5 倍的位置看下去，圆窗（比桌面高 1.45 splat 单位 = 4.65 世界单位）
 *  会被顶到画框上方：它在视平线**以上** 11°，而画面顶只到视平线**以下** 5°，根本看不见。
 *  -14° 是量出来的：圆窗心落到视平线下 9.6°（窗在竖墙上、俯视又压扁 ≈0.72），整颗窗落在画面顶
 *  与盖板远边那条可见带里；壁炉台面 y=+0.20、烟囱顶 y=+3.5（都露在盖板之上）。
 *  取法与三条路线的比较见 docs/gs-step1-splat-log.md §3.5。
 *  ★ 代价：墙会略前倾 14°（这间屋子本来就有斜顶斜梁，读不出来）；地板的倾斜被盖板远边整块挡住。 */
const TILT_DEG = -14;
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

/** 挂 splat 的那个 group 的变换（position/rotation/scale 三件一起用，别在别处再乘一次）。
 *  ★ 位置 = TARGET − scale·(R 作用在 CENTER 上)：`CENTER` 那个点（桌面顶面中心）落到 `TARGET`。
 *    上一版是手写 cos/sin 展开的（只有 yaw 时够用），这一版多了 tilt，改成用 Euler 算一遍 ——
 *    以后再加一位不用重新对一遍符号。 */
const rotatedCenter = new Vector3(...CENTER).applyEuler(euler).multiplyScalar(scale);
export const GS_STEP0_TRANSFORM = {
  scale,
  rotation: [euler.x, euler.y, euler.z] as [number, number, number],
  position: [
    devNum("gsX", 0) + TARGET[0] - rotatedCenter.x,
    devNum("gsY", 0) + TARGET[1] - rotatedCenter.y,
    devNum("gsZ", 0) + TARGET[2] - rotatedCenter.z,
  ] as [number, number, number],
};
/** ★★ 火（占位接口，2026-11-25）：**现在不是真火，只是一盏默认关的点光 + 一个坐标**。
 *
 *  为什么先留接口：壁炉是这间屋子最抢眼的陈设（参考图左边那座雕花石炉），真火（体积 shader /
 *  火焰视频面片）要等第 2 步做完桌面切除之后才有地方放 —— 现在炉膛在盖板顶面以下，火看也看不见。
 *  所以这一版只在**壁炉炉膛**的位置放一盏点光：位置由下面的 FIRE 常量经同一个 GS_STEP0_TRANSFORM 现算
 *  （换落位常量时自动跟着走，别在别处再手抄一份坐标）。以后接真火只改 `GsStep0Environment` 里那一段：
 *  把 `{GS_FIRE && <pointLight …/>}` 换成火焰的网格 / shader，位置仍旧读 `GS_FIRE_LIGHT.position`。
 *
 *  ★ 默认关（GS_FIRE = false）：打开它就是多一盏点光 + 一次 draw call；验收时按关/开各截一张。
 *  ★ 量出来的位置：炉膛 (s, d, h) = (-1.548, 3.94, 0.48)（splat 房间坐标），换到游戏世界之后
 *    y ≈ -1.8 —— 比盖板顶面低一大截，所以这盏灯此刻照不到桌面、也不会多出假亮斑。
 *    真火要上桌看得见，得先把桌面从 splat 里切掉（方案 B）或把这间屋子重出一版更深的。 */
export const GS_FIRE = false;
const fireWorld = new Vector3(...toSplat(ANCHOR.fire.s, ANCHOR.fire.d, ANCHOR.fire.h))
  .applyEuler(euler)
  .multiplyScalar(scale)
  .add(new Vector3(...GS_STEP0_TRANSFORM.position));
/** 火那盏点光的参数（位置是算出来的，别手抄） */
export const GS_FIRE_LIGHT = {
  position: fireWorld.toArray() as [number, number, number],
  color: "#ffb066",
  intensity: 14,
  distance: 16,
  decay: 1.8,
};

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
  /** 雾：这间屋子比上一版更深（圆窗在相机前 ~22 世界单位），雾起点推近一点、终点 70 就够 */
  fog: [20, 70] as [number, number],
  /** 主光 = 月光：从**窗那侧（-z）斜上方**打进来（x 偏 -2.5 = 窗外偏左，与参考图里壁炉在左的明暗一致）；
   *  阴影框只框"桌面"那一块（框整间房 = 把有限的阴影像素摊薄，plan §4.4）。 */
  sun: { position: [-2.5, 7, -12] as [number, number, number], intensity: 1.5, color: "#c8d8f5" },
  /** 窗面泛光：位置 = 圆窗在世界里的位置（落位常量算出来的，**别手抄**）；直径 ≈ 6（量出来窗径 6.08）。
   *  不支持阴影 / 只支持 PBR 材质 / 必须先 RectAreaLightUniformsLib.init() */
  window: { position: [0.22, 0.17, -14.72] as [number, number, number], width: 6, height: 6, intensity: 3 },
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

/** 加载预算：8 秒没就绪就当失败（手机上几十 MB 的 splat 也够）；高斯数默认不截断，见下。 */
export const GS_STEP0_BUDGET = {
  timeoutMs: 8000,
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
