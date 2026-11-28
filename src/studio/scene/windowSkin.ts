// ★★ 窗景的两套装扮（2026-11-27，`feat/gs-window-daynight`）：**白天=明亮海天、夜里=月**，
//   按**设备本地时间**自动切，切换带 0.6~1.0 s 交叉淡入。
//
// 为什么这个判定必须只有一处：
//   · 边界（几点算白天）、覆盖口子（`?winskin=` / localStorage）、淡入时长三样东西，
//     窗内贴图、墙面亮晕、窗光颜色/强度、夜空底色**四处**都要读同一份 —— 各判一次就一定会
//     "贴图切了但灯没切"（看起来像贴图在发光，不是窗在发光）。
//   · 所以这里只放**纯函数 + 一个 hook**，一个 THREE 对象都不碰：`windowSkin.ts` 在
//     `src/studio/scene/` 下，但谁 import 它都不会把 three 拖进来（构建里 check-import-direction 不拦这个，
//     但体积上必须能单独被测试/脚本引）。
//
// ★ 为什么用 07:00–18:59 这一刀：
//   主人给的默认值（`dayStart 7`、`dayEnd 19`）就是"起床之后到入夜之前"。它不是天文日出日落，
//   是**室内观感**的边界：19 点天还亮着，但那扇窗在屋里是"屋内唯一亮处"的主光源，天一黑就该是月亮。
//   改这个数只改 `WINSKIN_HOURS` 一处（验收截图之外的日常体验都用它）。
//
// ★ 覆盖口子的优先级（验收要能一键切到任意一档）：
//   `?winskin=day|night`  >  `localStorage["ideahub.winskin"]`  >  设备本地时间。
//   地址栏排最前是因为**一次截图/一次真机看**就是它：不必先进设置改、退出去再进。
//   localStorage 排在时间之前，是为了让"这台机器上我要一直看白天"能跨刷新成立（演示/录屏）。
//   两者都只接受 exactly `day` / `night`：写错就当没写（回到下一条），不猜。
import { useEffect, useRef, useState } from "react";

/** 日/夜的窗口时间桶：`dayStart` 起、`dayEnd` 止（左闭右开，按**小时**判，不看分钟）。 */
export const WINSKIN_HOURS = {
  /** 几点开始算白天（含） */
  dayStart: 7,
  /** 几点开始算夜里（不含；也就是 18:59 还是白天） */
  dayEnd: 19,
} as const;

export type WindowSkinName = "day" | "night";

/** 交叉淡入时长（ms）。主人给的范围 0.6~1.0 s，取中位 0.8 s：
 *  0.6 s 在 30 fps 的真机上只有 18 帧，海天→月光这种大面积换色能看出"跳"；
 *  1.0 s 又会让"?winskin="验收截图的等待变长（每次都要等一整秒才稳定）。 */
export const WINSKIN_FADE_MS = 800;

/** localStorage 的键（带前缀：这个 App 在同一个 origin 上还有别的键）。 */
export const WINSKIN_STORAGE_KEY = "ideahub.winskin";

/** 覆盖地址栏参数名（`?winskin=day` / `?winskin=night`）。 */
export const WINSKIN_QUERY_KEY = "winskin";

/** 小时 → 白天还是夜里。纯函数，边界只有一处。`h` 允许小数（12.5 = 12:30）。 */
export function skinFromHour(h: number): WindowSkinName {
  // 时间读出来可能是 NaN（测试/伪造的 Date）：不当白天，落夜里 —— 现在的默认观感是月窗
  if (!Number.isFinite(h)) return "night";
  const hour = ((h % 24) + 24) % 24;
  return hour >= WINSKIN_HOURS.dayStart && hour < WINSKIN_HOURS.dayEnd ? "day" : "night";
}

/** 把任意字符串收成合法的装扮名；不是 `day` / `night` 就返回 null（调用点继续往下一条问）。 */
export function asSkinName(raw: unknown): WindowSkinName | null {
  return raw === "day" || raw === "night" ? raw : null;
}

/** 读一次覆盖口子（地址栏 > localStorage）。都没有就返回 null，由调用方回落到时间。 */
export function readSkinOverride(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): WindowSkinName | null {
  const fromQuery = asSkinName(new URLSearchParams(search).get(WINSKIN_QUERY_KEY));
  if (fromQuery) return fromQuery;
  try {
    return asSkinName(storage?.getItem(WINSKIN_STORAGE_KEY));
  } catch {
    // 隐私模式 / 被策略掐掉的 localStorage：读会抛，当作没有覆盖
    return null;
  }
}

/** 写一次覆盖（`null` = 清掉，回到设备时间）。验收脚本与设置页共用这一处。 */
export function writeSkinOverride(value: WindowSkinName | null): void {
  try {
    if (value) localStorage.setItem(WINSKIN_STORAGE_KEY, value);
    else localStorage.removeItem(WINSKIN_STORAGE_KEY);
  } catch {
    // 写不进去就算了：这只是"记住偏好"，不该把调用点弄崩
  }
}

/** 解析"这一刻该是哪一套"：覆盖口子优先，否则按设备本地时间。 */
export function resolveWindowSkin(now: Date = new Date()): WindowSkinName {
  return readSkinOverride() ?? skinFromHour(now.getHours() + now.getMinutes() / 60);
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 每隔多久复查一次"现在该是哪一档"（ms）。
 *  60 s 是"跨过 07:00 / 19:00 那一分钟最多晚 1 分钟换装"与"每秒读一次 localStorage 太浪费"的折中；
 *  窗口在后台时 rAF/计时器会被节流，反正没人看那一帧。 */
const REVEAL_MS = 60_000;

/** 当前该用哪一套窗景（会自动跨过 07:00 / 19:00 翻档）。 */
export function useWindowSkin(): WindowSkinName {
  const [skin, setSkin] = useState<WindowSkinName>(() => resolveWindowSkin());
  useEffect(() => {
    const tick = () => {
      const next = resolveWindowSkin();
      setSkin((prev) => (prev === next ? prev : next));
    };
    tick(); // 挂载后立刻对齐一次（首帧可能是在 SSR/预渲染里算的）
    const id = window.setInterval(tick, REVEAL_MS);
    // 同一台设备上别的标签页改了 localStorage（验收脚本用得上）
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === WINSKIN_STORAGE_KEY) tick();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return skin;
}

/** 0 = 完全夜里、1 = 完全白天。切换时按 `WINSKIN_FADE_MS` 线性推进，
 *  `smoothstep` 在 `skinWeight` 里做（线性推到一半时人眼看面积，smoothstep 更稳）。 */
export function useSkinFade(skin: WindowSkinName): number {
  const target = skin === "day" ? 1 : 0;
  // 初值 = 目标：**首次挂载不淡入**（开机/进工坊的第一帧就该是正确那一套，
  // 从"夜里慢慢变白天"会让验收截图在 t<0.8 s 时拍到半成品）
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);
  useEffect(() => {
    if (value === target) return;
    const start = performance.now();
    const begin = value;
    from.current = begin;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / WINSKIN_FADE_MS);
      const next = begin + (target - begin) * t;
      setValue(t >= 1 ? target : next);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // value 故意不进依赖：它是被这个 effect 推进的那一格，进来会每帧重启动画
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

/** 淡入曲线的真正用法：`t` 是线性 0..1，画面上用它之前过一道 smoothstep。 */
export function skinWeight(linear: number): number {
  const t = Math.min(1, Math.max(0, linear));
  return t * t * (3 - 2 * t);
}

/** 窗内那盏灯的两套参数（`color` / `intensity` / `distance`）。
 *  ★ 只照 mesh：splat 不吃灯（三个文件都写过这条）—— 所以"day 的窗光"在墙上**不是**这盏灯做的，
 *    是 `WallGlow` 那块加色面做的（见 WindowSkin.tsx）。这盏灯负责桌面 / 卡牌 / NPC 那一池光。 */
export const WINSKIN_LIGHT = {
  /** 夜里：冷蓝月光，参数就是 `MoonWindow` 里原来那一盏（一个数没动） */
  night: { color: "#dfe9ff", intensity: 2.4, distance: 7, decay: 2 },
  /** 白天：窗户把正午的日照带进屋 —— 色温偏暖白（#fff3e0 的 R:G:B ≈ 1 : 0.953 : 0.878）、
   *  强度 5.6（≈ 夜里的 2.33 倍，照度上"白天进屋的光是夜里月光的 2~3 倍"）。
   *  没有取更狠的 8：灯只照 mesh，桌子比 splat 的墙亮太多会立刻显成"贴上去的一块"。 */
  day: { color: "#fff3e0", intensity: 5.6, distance: 8, decay: 2 },
} as const;

/** 窗洞外那圈假晕的两套颜色/强度（加色混合，`WallGlow` 用它）。
 *  ★ 只能假晕：splat 把所有受光烘死在点云里，灯照不动它。 */
export const WINSKIN_GLOW = {
  /** 夜里不画亮晕 —— 现有的月窗本来就是"窗洞是唯一亮处"，再加一圈亮晕会把夜间观感洗掉。
   *  夜里那圈是**暗**的（`SURROUND` 环压住烘死的磨砂亮边），见 WindowSkin.tsx 的 SKIN_LOOK。 */
  night: { color: "#8fb4ff", intensity: 0 },
  /** 白天：#ffcf94 的暖白（偏橙一点：加色叠在 splat 那种冷蓝墙上，纯白会直接饱和成"霓虹圈"，
   *  偏橙才读得出是"暖光落在冷墙上"）。强度 0.5，再高窗框外就成了一圈白雾 ——
   *  0.85 那一版在 1024² 的验收图上峰值 240/255，窗框边缘直接糊掉。 */
  day: { color: "#ffcf94", intensity: 0.5 },
} as const;

/** 窗外的方向光（`gsStep0.GS_DAY.sun`）在白天的两套参数 —— 白天的屋子该更亮、更暖。
 *  夜里的值就是 `GS_DAY.sun` 现有的（月光），这里只在白天那一档覆盖。 */
export const WINSKIN_SUN = {
  day: { color: "#fff2dc", intensityScale: 1.75 },
} as const;
