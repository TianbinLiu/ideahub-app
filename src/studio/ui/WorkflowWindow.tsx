// 工作流「全屏小窗」（2026-11-26，`feat/gs-fullscreen-fire`，主人第 1 条）。
//
// 上一版（`feat/gs-framing-orbit-panel`）是 66%×68% 的居中浮层，波浪圆心是**点击位置**。
// 这一版按主人两条改动：
//   ① **全屏覆盖**，但四周留一圈内边距 —— 读作"悬浮在全屏上的面板"，而不是"跳了一页"：
//      永远能看见 3D 舞台的一圈边缘（桌沿、炉火的光晕、HUD 角标）。
//   ② **波浪从屏幕角落扩散到全屏**（默认右下角）：半径 0 → 覆盖整个屏幕对角线（`hypot(W,H)`），
//      关闭时反向收缩回**同一个**角落。
//
// 三件事都在这一个文件里：
//   ① 尺寸/位置：`inset: PAD`（18 px）—— 占满整个 3D 舞台只差一圈边；圆角 + 外阴影 + 半透明模糊底
//      （`bg-ink/88 + backdrop-blur-md`），四周那一圈仍能看见 3D。
//   ② 波浪式开关：圆形 `clip-path: circle()`，圆心 = **屏幕角落**，半径 0 → `hypot(W,H)`；
//      打开 520 ms / 关闭 460 ms、ease-out（主人给的数）。**选角**见 `pickCorner`。
//   ③ reduced-motion：`prefers-reduced-motion: reduce` 时不播 clip-path，只 180 ms 淡入淡出。
//
// ★ 谁来管"还在不在 DOM 里"：`open` 变 false 时不能立刻卸载 —— 收缩动画要画在还挂着的节点上。
//   所以这里自己留一个 `present`，播完收缩才卸载（`FlowCanvas` 卸载后草稿/卡位都还在 store 里，
//   关掉再开原样恢复；3D 那边压根没卸过）。重复开关用 `gen` 计数作废上一发的 onDone 回调。
// ★ clip-path 用 WAAPI（element.animate）而不是 CSS transition：要在"关掉 → 再开"的竞态里
//   随时 cancel 重来，transition 做这件事要手工清 class + 强制 reflow，反而更脆。
// ★★ 圆心为什么是**视口角落**而不是面板角落：面板有内边距，两个角差 18 px；而主人要的是
//   "从屏幕角落往外铺"。坐标换算到面板本地（`getBoundingClientRect`）之后，右下角恰好落在
//   面板自己的右下角（`W - PAD - left = width`），左半边那两角则略在面板之外（−18 px）——
//   两者的半径都用视口对角线，四角都能一次铺满。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 面板离视口的四边内边距（px）：主人给的 16~24 取中段，横屏 852~864 宽时左右各让出 18 */
const PAD = 18;
/** 圆角（px）：上一版 rounded-2xl = 16；全屏面板给大一点才读作"悬浮的卡片" */
const RADIUS = 22;
/** 波浪时长（ms）：主人给的 520 / 460 */
const OPEN_MS = 520;
const CLOSE_MS = 460;
/** reduced-motion 的淡入淡出时长 */
const FADE_MS = 180;
/** 遮罩暗化（四周那一圈 3D 的压暗量）与面板底的模糊半径 */
const VEIL = "bg-black/30";

/** 面板角落的代号（验收/报告用它说"这一发从哪长出来"） */
type Corner = "rb" | "lb" | "lt" | "rt";

/**
 * 选角逻辑（主人第 1 条的原话：「默认取右下角；如果生成键在屏幕另一侧（左半边），
 * 圆心改用离它最近的角落」）。
 *
 * - 没有点击坐标 / 键在**右半边** → 一律 `rb`（右下角，这是"家"）。
 *   右半边不再按上下分：3D 生成键在桌面右下角，而顶栏 🧩 在右上角 —— 两者离右下角都近，
 *   从右下角铺满全场是这一屏的默认动效。
 * - 键在**左半边** → 取左边两个角里**竖直方向更近**的那个（`lt` / `lb`）：波浪从离手指最近的
 *   角落长出来，视线不用横跨半个屏幕去追。左半边一般就是顶栏左侧的键（`lt`）与桌面左下的卡组
 *   箭头那一侧（`lb`）。
 * ★ 返回的是**视口 CSS px**（不是比例）：半径与圆心要用同一把尺子（`hypot(W,H)` 也是 px）。
 */
export function pickCorner(origin: [number, number] | null, w: number, h: number): [Corner, [number, number]] {
  if (!origin || origin[0] >= w / 2) return ["rb", [w, h]];
  return origin[1] < h / 2 ? ["lt", [0, 0]] : ["lb", [0, h]];
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function WorkflowWindow({
  open,
  origin,
  children,
}: {
  /** 开着没有（studioStore.canvasOpen）。false → 播收缩、播完卸载 */
  open: boolean;
  /** 生成键点下去那一下的 viewport CSS px（只用来挑角落，不再是圆心）。null = 缺省（右下角） */
  origin: [number, number] | null;
  /** 面板内容（GS 档传 `<FlowCanvas embedded />`） */
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
  const anims = useRef<Animation[]>([]);
  /** 最近一次点击位置：关闭动画与"关→再开"都要用它，而 `origin` 可能在关掉之后被清 */
  const originRef = useRef<[number, number] | null>(origin);
  /** 每一发动画的代次：关掉时挂的 onDone 不能把后来重新打开的面板卸掉 */
  const gen = useRef(0);

  useLayoutEffect(() => {
    if (origin) originRef.current = origin;
  }, [origin]);

  /** 停掉正在播的（打开一半又关 / 关一半又开） */
  const stop = () => {
    for (const a of anims.current) {
      try {
        a.cancel();
      } catch {
        /* 已经结束的动画 cancel 会抛（部分 WebView）：忽略 */
      }
    }
    anims.current = [];
  };

  const play = (opening: boolean, onDone?: () => void) => {
    const panel = panelRef.current;
    const veil = veilRef.current;
    if (!panel || !veil) {
      onDone?.();
      return;
    }
    stop();
    const my = ++gen.current;
    const dur = opening ? OPEN_MS : CLOSE_MS;
    const list: Animation[] = [];
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (prefersReducedMotion()) {
      // 尊重 prefers-reduced-motion：不播圆形扩散，只淡入淡出
      list.push(
        panel.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: FADE_MS,
          easing: "ease-out",
          fill: "forwards",
        }),
        veil.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: FADE_MS,
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    } else {
      // 圆心 = 挑出来的**视口角落**，换算进面板本地坐标（面板 inset 了 PAD，所以右下角正好是
      // 面板自己的右下角，左半边那两角在面板外 18 px —— 圆心在窗外也没关系，clip 只画圆内）
      const rect = panel.getBoundingClientRect();
      const [corner, pt] = pickCorner(originRef.current, w, h);
      const ox = pt[0] - rect.left;
      const oy = pt[1] - rect.top;
      // ★ 半径 = 屏幕对角线（主人给的 `hypot(W,H)`）：从角落出发，铺满整屏（面板只是它的子集，
      //   多出来那点半径落在内边距之外，看不见；这样四角不论哪一发都一定覆盖整块面板）
      const r = Math.hypot(w, h);
      // 验收/报告要的那几个数（生产里没人读；留着是为了"波浪参数"有据可查，别在文档里手抄）
      panel.dataset.waveCorner = corner;
      panel.dataset.waveCx = ox.toFixed(1);
      panel.dataset.waveCy = oy.toFixed(1);
      panel.dataset.waveR = r.toFixed(0);
      (window as unknown as Record<string, unknown>).__workflowWave = {
        corner,
        cornerViewport: pt,
        originInPanel: [+ox.toFixed(1), +oy.toFixed(1)],
        radius: Math.round(r),
        viewport: [w, h],
        openMs: OPEN_MS,
        closeMs: CLOSE_MS,
        reduced: false,
      };
      const from = `circle(0px at ${ox}px ${oy}px)`;
      const to = `circle(${r}px at ${ox}px ${oy}px)`;
      list.push(
        panel.animate([{ clipPath: opening ? from : to }, { clipPath: opening ? to : from }], {
          duration: dur,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)", // ease-out：先快后慢
          fill: "forwards",
        }),
        // 遮罩比圆形早一点到位（0.55×）：面板还在铺的时候四角的 3D 先暗下去，边缘不会"亮一下"
        veil.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: Math.round(dur * 0.55),
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    }
    anims.current = list;
    const all = Promise.all(list.map((a) => a.finished.catch(() => {})));
    if (onDone) {
      // 兜底计时器：个别 WebView 在动画被系统打断时 finished 可能不 settle，别把面板卡在屏上
      const d = () => {
        if (my !== gen.current) return;
        onDone();
      };
      void all.then(d);
      window.setTimeout(d, dur + 150);
    } else if (opening) {
      // 打开播完就把 clip 清掉：之后转屏/改尺寸不会被一个按旧尺寸算出来的圆裁掉
      void all.then(() => {
        if (my !== gen.current) return;
        panel.style.clipPath = "";
        anims.current = [];
      });
    }
  };

  useLayoutEffect(() => {
    if (open) {
      if (!present) {
        setPresent(true); // 挂上；下一轮 layout effect 播张开
      } else {
        play(true);
      }
    } else if (present) {
      play(false, () => setPresent(false));
    }
    // play 只用 ref 与稳定函数，不随渲染变化；这里按 open/present 两态驱动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, present]);

  useLayoutEffect(() => stop, []);

  if (!present) return null;
  return createPortal(
    <>
      {/* 遮罩：只暗化（**不做 backdrop-filter**：全屏再来一层模糊，中端机上每帧多一次整屏采样，
          而面板自己已经磨砂了，这层只需把四周的 3D 压暗一档让它退到后面去） */}
      <div ref={veilRef} data-workflow-veil="1" className={`fixed inset-0 z-40 ${VEIL}`} aria-hidden />
      {/* 面板本体：四边 inset PAD、圆角 RADIUS、半透明磨砂底 + 外阴影；overflow-hidden 让 clip-path 的圆边干净 */}
      <div
        ref={panelRef}
        data-workflow-window="1"
        data-workflow-pad={PAD}
        className="fixed z-40 overflow-hidden bg-ink/88 shadow-[0_18px_60px_-12px_rgba(0,0,0,0.75)] ring-1 ring-white/10 backdrop-blur-md"
        style={{
          left: PAD,
          right: PAD,
          top: PAD,
          bottom: PAD,
          borderRadius: RADIUS,
          willChange: "clip-path",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
