// 工作流小窗（2026-11-26，`feat/gs-framing-orbit-panel`，主人第 3 条）。
//
// 为什么是**小窗**而不是整页：GS 档的 3D 桌面是这一屏的主角，点生成键只是"把流水线换一种看法"。
// 原来那张画布是 z-40 全屏浮层（`FlowCanvas` 自己的壳），整屏盖住桌面 —— 用户读起来就是"跳页了"，
// 而 3D 只剩在背后空跑（工坊现在的做法是 `frameloop="never"` 停帧，至少不空跑；这一版进一步
// 让桌面**看得见**）。
//
// 三件事都在这一个文件里：
//   ① 尺寸/位置：屏幕的 66% × 68%，中心偏右（x=60%）—— 主人要的"约 62%~70%、居中偏右"取中段；
//      底边停在 78%，右下角那个 GS 角标（gsHud，`z-index:9999`）刚好露在小窗下面。
//   ② 波浪式开关：圆形 `clip-path: circle()` 从**点击位置**扩散到盖住整个小窗，关闭反向收缩。
//      时长 460 / 420 ms（主人给的 380~520 中段）、ease-out；同时给遮罩做 0→1 的透明度动画。
//   ③ reduced-motion：`prefers-reduced-motion: reduce` 时不播 clip-path，直接 180 ms 淡入淡出。
//
// ★ 谁来管"还在不在 DOM 里"：`open` 变 false 时不能立刻卸载 —— 收缩动画要画在还挂着的节点上。
//   所以这里自己留一个 `present`，播完收缩才卸载（`FlowCanvas` 卸载后草稿/卡位都还在 store 里，
//   关掉再开原样恢复；3D 那边压根没卸过）。重复开关用 `gen` 计数作废上一发的 onDone 回调。
// ★ clip-path 用 WAAPI（element.animate）而不是 CSS transition：要在"关掉 → 再开"的竞态里
//   随时 cancel 重来，transition 做这件事要手工清 class + 强制 reflow，反而更脆。
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 小窗占视口的百分比（与主人要的"屏幕 62%~70%"同口径）：66% × 68%，中心 (60%, 44%) */
const PANEL = { left: 27, top: 10, width: 66, height: 68 } as const;
/** 波浪时长（ms）：380~520 中段取 460；关闭略快（收缩比扩散"急"一点更自然） */
const OPEN_MS = 460;
const CLOSE_MS = 420;
/** reduced-motion 的淡入淡出时长 */
const FADE_MS = 180;
/** 没有点击坐标时的缺省圆心（视口比例）：正面机位上生成键的大致落点 */
const FALLBACK = { x: 0.74, y: 0.72 };

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
  /** 从哪儿扩散（viewport CSS px；生成键点下去那一下的坐标）。null = 缺省位置 */
  origin: [number, number] | null;
  /** 小窗内容（GS 档传 `<FlowCanvas embedded />`） */
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const veilRef = useRef<HTMLDivElement | null>(null);
  const anims = useRef<Animation[]>([]);
  /** 最近一次点击位置：关闭动画与"关→再开"都要用它，而 `origin` 可能在关掉之后被清 */
  const originRef = useRef<[number, number] | null>(origin);
  /** 每一发动画的代次：关掉时挂的 onDone 不能把后来重新打开的小窗卸掉 */
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
      // 圆心取"点击位置相对小窗左上角"，夹进小窗范围（点在窗外的角上时也不会算出负半径）
      const rect = panel.getBoundingClientRect();
      const o = originRef.current;
      const px = o ? o[0] : window.innerWidth * FALLBACK.x;
      const py = o ? o[1] : window.innerHeight * FALLBACK.y;
      const ox = Math.min(Math.max(px - rect.left, 0), rect.width);
      const oy = Math.min(Math.max(py - rect.top, 0), rect.height);
      // 半径 = 圆心到最远那个角 + 8px 余量（四舍五入的误差也不露边）
      const r = Math.hypot(Math.max(ox, rect.width - ox), Math.max(oy, rect.height - oy)) + 8;
      const from = `circle(0px at ${ox}px ${oy}px)`;
      const to = `circle(${r}px at ${ox}px ${oy}px)`;
      list.push(
        panel.animate([{ clipPath: opening ? from : to }, { clipPath: opening ? to : from }], {
          duration: dur,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)", // ease-out：先快后慢
          fill: "forwards",
        }),
        veil.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: dur,
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    }
    anims.current = list;
    const all = Promise.all(list.map((a) => a.finished.catch(() => {})));
    if (onDone) {
      // 兜底计时器：个别 WebView 在动画被系统打断时 finished 可能不 settle，别把小窗卡在屏上
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
      {/* 遮罩：暗化 + 背景模糊（主人第 3 条）。z-40 与画布浮层原来那层同档；小窗本体在它上面。 */}
      <div
        ref={veilRef}
        data-workflow-veil="1"
        className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
        aria-hidden
      />
      {/* 小窗本体：位置/尺寸在 PANEL（%），圆角 + 内阴影 + overflow-hidden 让 clip-path 的圆边干净 */}
      <div
        ref={panelRef}
        data-workflow-window="1"
        className="fixed z-40 overflow-hidden rounded-2xl bg-ink shadow-2xl ring-1 ring-white/15"
        style={{
          left: `${PANEL.left}%`,
          top: `${PANEL.top}%`,
          width: `${PANEL.width}%`,
          height: `${PANEL.height}%`,
          willChange: "clip-path",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
