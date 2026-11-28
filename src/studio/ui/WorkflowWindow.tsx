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
// 波浪 / 圆扩散只有一份实现（2026-11-28 从这一份抽到 ui/waveReveal，选风格浮层共用同一份）。
// ★ pickCorner 仍从这里转出去：docs/gs-table-light-log.md §13.2 按 `WorkflowWindow.pickCorner` 记的。
import { playWaveReveal, type WaveRevealHandle } from "./waveReveal";
export { pickCorner, WAVE_CLOSE_MS, WAVE_FADE_MS, WAVE_OPEN_MS } from "./waveReveal";

/** 面板离视口的四边内边距（px）：主人给的 16~24 取中段，横屏 852~864 宽时左右各让出 18 */
const PAD = 18;
/** 圆角（px）：上一版 rounded-2xl = 16；全屏面板给大一点才读作"悬浮的卡片" */
const RADIUS = 22;
/** 遮罩暗化（四周那一圈 3D 的压暗量）与面板底的模糊半径 */
const VEIL = "bg-black/30";

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
  const anims = useRef<WaveRevealHandle | null>(null);
  /** 最近一次点击位置：关闭动画与"关→再开"都要用它，而 `origin` 可能在关掉之后被清 */
  const originRef = useRef<[number, number] | null>(origin);

  useLayoutEffect(() => {
    if (origin) originRef.current = origin;
  }, [origin]);

  /** 停掉正在播的（打开一半又关 / 关一半又开）—— 取消之后那一发的 onDone 不会再回调 */
  const stop = () => {
    anims.current?.cancel();
    anims.current = null;
  };

  const play = (opening: boolean, onDone?: () => void) => {
    const panel = panelRef.current;
    const veil = veilRef.current;
    if (!panel || !veil) {
      onDone?.();
      return;
    }
    stop();
    anims.current = playWaveReveal(panel, {
      opening,
      origin: originRef.current,
      veil,
      // 验收读数：`window.__workflowWave`（docs/gs-table-light-log.md §13.2 记着它）
      debugName: "__workflowWave",
      onDone,
    });
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
