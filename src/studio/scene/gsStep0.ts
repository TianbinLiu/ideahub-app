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
// 页面里想临时对尺度就再加 `gsScale=6.5&gsYaw=-120&gsX=0&gsY=0&gsZ=0`，四个数分别覆盖下面那组落位参数）。
import { useSyncExternalStore } from "react";
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
// 推导与实测见 docs/gs-step0-splat-log.md，这里只留结论与"为什么":
// ① 朝向：Atlas 的相机位姿是 `rub`（右-上-后，看向 -Z）、Y 朝上。12 个相机的视线最小二乘交点是
//    **C = (2.8177, 0.6917, 4.1024)** —— 生成输入里"看向桌面中心"那个点。
//    把 C 按帧 01（南/入口端）对着 +z 转，得到的是**这间屋子的原朝向**：壁炉 -z、窗 -x、工具板 +x
//    （与施工单 §1.1 的机位表逐帧对得上，是没镜像的证据 —— 别用负 scale 去凑，法线/阴影/背面剔除会一起反）。
//    ★ 但**桌子的长轴在这间屋子里是 z**（view-01 是站在短端顺着桌长看进去的），而本仓桌面是
//    16×7（长轴 x）。施工单 §4.1-3 要的正是"桌长轴 = X ⇒ 再转 90°"，所以最终 **yaw = 142.5°**：
//    桌子长轴对上 X、窗墙落到 **-z**（正前方），壁炉与入口分别落到 +x / -x。
//    代价（写在这里防以后发现"怎么和机位表对不上"）：转了这 90° 之后，窗墙不再是 -x 了 —— 白天那盏
//    DirectionalLight 必须跟着挪到 -z（见 GS_DAY.sun），否则"窗光"与窗的位置对不上。
// ② 尺度：01–08 距桌心 3.4 m、11/12 距 2.1 m，与重建距离做最小二乘得 splat 单位/米 ≈ 1.061 ⇒ 1 米 ≈ 1.06 splat 单位。
//    本仓桌面口径 16 单位 ≈ 2 m（8 单位/米）。**但这间屋子的桌子比 2 m 长**：点云量出来桌面 2.1×1.0 splat 单位，
//    按 8.49 就是 18×8.7 世界单位 —— 横屏盖板（22×9）勉强吃住，竖屏（16×7）会露出来。
//    所以最终 **scale = 6.6**：桌面 ≈ 14×6.8 世界单位，横竖两套盖板都盖得住（量法与读数见台账）。
// ③ 平移：把 C 落到 (0, -0.3, 0)。盖板顶面 y=0、厚 0.5；交汇点再往下 0.15（合计 -0.3）是因为
//    2M 高斯的桌面有 ±5 cm 的噪声尾巴，只按 -0.15 放会有几点从盖板顶面戳出来（截图见台账）。
//    另外桌面中心在 splat 里比 C 偏 +z 1.28 世界单位（点云量出来的），再用 SHIFT 推回盖板正下方。
const CENTER: [number, number, number] = [2.8177, 0.6917, 4.1024];
const YAW_DEG = 142.5;
const SCALE = 6.6;
const TARGET: [number, number, number] = [0, -0.3, 0];
const SHIFT: [number, number, number] = [0, 0, -1.28];

/** dev 的 ?gsXxx 覆盖（生产构建里一律走常量） */
function devNum(name: string, fallback: number): number {
  if (!import.meta.env.DEV || typeof location === "undefined") return fallback;
  const raw = new URLSearchParams(location.search).get(name);
  if (raw === null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

const yaw = ((devNum("gsYaw", YAW_DEG) * Math.PI) / 180);
const scale = devNum("gsScale", SCALE);
const cos = Math.cos(yaw);
const sin = Math.sin(yaw);

/** 挂 splat 的那个 group 的变换（position/rotation/scale 三件一起用，别在别处再乘一次） */
export const GS_STEP0_TRANSFORM = {
  scale,
  rotation: [0, yaw, 0] as [number, number, number],
  position: [
    devNum("gsX", 0) + TARGET[0] + SHIFT[0] - scale * (CENTER[0] * cos + CENTER[2] * sin),
    devNum("gsY", 0) + TARGET[1] + SHIFT[1] - scale * CENTER[1],
    devNum("gsZ", 0) + TARGET[2] + SHIFT[2] - scale * (-CENTER[0] * sin + CENTER[2] * cos),
  ] as [number, number, number],
};

/** 白天一档（方案 A 的光只照网格桌面与卡牌 —— splat 不吃灯，见 docs/gs-step0-plan.md §4.4） */
export const GS_DAY = {
  /** 背景色：白天房间里只在 splat 没盖住的缝隙里露出来，暖灰 */
  bg: "#2b2a28",
  /** 雾：房间比书房大，雾要推远，不然 splat 也被糊掉 */
  fog: [26, 90] as [number, number],
  /** 窗墙在 -z（见上面 ① 的 90°）：方向光从窗外斜上方打进来；阴影框只框"窗 + 桌面"那一块
   *  （框整间房 = 把有限的阴影像素摊薄，窗棂的影就没了，plan §4.4） */
  sun: { position: [-3, 8, -12] as [number, number, number], intensity: 2.4, color: "#fff2df" },
  /** 窗面泛光：不支持阴影 / 只支持 PBR 材质 / 必须先 RectAreaLightUniformsLib.init() */
  window: { position: [-2, 3.2, -7.8] as [number, number, number], width: 6, height: 3, intensity: 4 },
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
  /** 环境：程序化的"白天窗光"等距柱状图 → PMREM（真 HDR 以后换，见 GsStep0Room 的注释） */
  envIntensity: 0.45,
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
