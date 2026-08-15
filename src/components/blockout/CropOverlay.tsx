// 画面裁剪框：拖四个角改大小、拖框身整体挪位。坐标一律是**源视频像素**（整数），
// 屏幕坐标只在这一层换算（乘 VideoStage 量出来的 scale）。
//
// ★ 它存在的唯一理由是 F7（2026-08-15 实测）：白模化走方舟 edit，职责是**逐帧复刻**，
//   台标/水印对它而言与场景里的一块招牌没有区别 —— 提示词里写一百遍「不要水印」也去不掉，
//   两发实测都完整保留。裁掉是唯一真解，而且必须在**付费出片之前**裁。
//
// ★★ 手势：必须用 pointer 事件 + `touch-action: none`（Tailwind 的 `touch-none`）。
//   两条都不能少 ——
//     · HTML5 draggable 在 Android WebView 的触摸下根本不触发（MaterialSheet 那条注释里
//       记过），整个功能在真机上会是死的；
//     · 不写 touch-action，浏览器会把"往下拖"接管成页面滚动并给我们发 pointercancel，
//       于是框在真机上时灵时不灵（而在桌面鼠标下一切正常，所以这种 bug 最容易漏过）。
import { useRef, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { clampCropToFrame, type CropRect } from "./arkVideoRules";

/**
 * 拖拽时框的最小边长（**屏幕**像素）。
 * ★ 单位是屏幕不是源像素：手指要还能抓得住这个框。1920 宽的片子在手机上 scale≈0.2，
 *   写"最小 300 源像素"的话框最小也有 60 屏幕像素、看着挺大；而 400 宽的片子 scale≈1，
 *   同一个数就把框卡在了画面的 3/4 处，用户会觉得"这个角拖不动"。
 * ★ 它**不是** F3 的 300 像素门（那条由 selectionIssue 说人话）：这里只保证框不塌成一条线。
 */
const MIN_BOX_PX = 40;

type Mode = "move" | "nw" | "ne" | "sw" | "se";

export interface CropOverlayProps {
  /** 源视频画面尺寸（服务端登记值）。裁剪框永远夹在它里面 */
  natural: { width: number; height: number };
  /** 每 1 源像素占几个显示像素（VideoStage 给的 fit.scale） */
  scale: number;
  value: CropRect;
  onChange: (next: CropRect) => void;
  disabled?: boolean;
}

/** 一次拖拽的结果。★ 从**按下那一刻的框**加总位移算，不从"上一帧的框"累加：
 *  累加会把每一步的取整误差滚起来（拖一趟下来框会偏出去好几个像素），
 *  而这个偏差恰恰发生在我们要靠它裁掉水印的那条边上。 */
function dragCrop(
  mode: Mode,
  base: CropRect,
  dx: number,
  dy: number,
  nat: { width: number; height: number },
  minSrc: number,
): CropRect {
  const W = Math.round(nat.width);
  const H = Math.round(nat.height);
  if (mode === "move") {
    return clampCropToFrame({ ...base, x: base.x + dx, y: base.y + dy }, nat, minSrc);
  }
  let x0 = base.x;
  let y0 = base.y;
  let x1 = base.x + base.w;
  let y1 = base.y + base.h;
  if (mode === "nw" || mode === "sw") x0 = Math.min(x1 - minSrc, Math.max(0, base.x + dx));
  else x1 = Math.max(x0 + minSrc, Math.min(W, x1 + dx));
  if (mode === "nw" || mode === "ne") y0 = Math.min(y1 - minSrc, Math.max(0, base.y + dy));
  else y1 = Math.max(y0 + minSrc, Math.min(H, y1 + dy));
  // ★ 先把四个角各自取整，再相减出宽高 —— 分别对 x 和 w 取整会让 x+w 比画面宽出 1 像素
  //   （0.6 进位 + 0.6 进位），服务端复核那一步会因此整发拒掉，而屏幕上什么都看不出来
  const rx0 = Math.round(x0);
  const ry0 = Math.round(y0);
  return {
    x: rx0,
    y: ry0,
    w: Math.max(1, Math.round(x1) - rx0),
    h: Math.max(1, Math.round(y1) - ry0),
  };
}

export default function CropOverlay({ natural, scale, value, onChange, disabled }: CropOverlayProps) {
  const drag = useRef<{ mode: Mode; x: number; y: number; base: CropRect } | null>(null);
  const minSrc = Math.max(1, Math.round(MIN_BOX_PX / Math.max(scale, 0.0001)));

  const box = {
    left: value.x * scale,
    top: value.y * scale,
    width: value.w * scale,
    height: value.h * scale,
  };

  function down(mode: Mode) {
    return (e: RPointerEvent) => {
      if (disabled) return;
      e.stopPropagation();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件没有有效 pointerId：捕获失败不影响拖拽（只是拖出元素外会断），
           与 FrameAnnotator 同一处理 */
      }
      drag.current = { mode, x: e.clientX, y: e.clientY, base: value };
    };
  }

  function move(e: RPointerEvent) {
    const d = drag.current;
    if (!d) return;
    onChange(dragCrop(d.mode, d.base, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale, natural, minSrc));
  }

  const end = () => {
    drag.current = null;
  };

  /** 角把手。视觉 14px，热区 40px —— 手机上 14px 的方块是抓不住的（拇指接触面 ~45px），
   *  而热区靠 padding 撑大不影响画面上那个角标的位置 */
  const handle = (mode: Exclude<Mode, "move">, style: CSSProperties) => (
    <div
      onPointerDown={down(mode)}
      className="pointer-events-auto absolute flex h-10 w-10 touch-none items-center justify-center"
      style={style}
    >
      <span className="block h-3.5 w-3.5 rounded-[3px] border-2 border-white bg-sky-400/90 shadow" />
    </div>
  );

  return (
    // ★ 外层 `pointer-events-none` + 框与把手各自 `pointer-events-auto`：
    //   宿主可能是一块**能上下滚**的面板（提取器就是个 88vh 的贴底浮层）。整层都吃手势的话，
    //   画面那 300px 就成了滚不动的死区，用户会以为页面卡住了。框外只有一层压暗（box-shadow
    //   画的，不是元素），手指落在那儿照样能滚。
    // ★ 拖拽中的 move/up 仍挂在外层：pointer capture 会把事件派发给把手，而它**照常冒泡**
    //   到这里 —— 所以捕获成功时手指拖出画面也不断线；捕获失败（合成事件没有有效 pointerId）
    //   时至少在画面内可用。
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        onPointerDown={down("move")}
        className="pointer-events-auto absolute touch-none border-2 border-sky-300/90"
        style={{
          ...box,
          // 框外压暗：一个 box-shadow 就够，不再摆四块遮罩 div（四块要各自算位置，
          // 而它们与框的位置必须永远一致——那就是四份同一个判断）
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
      >
        {/* 三分线：只是构图辅助，pointer-events 关掉，别抢把手的手势 */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
          <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
          <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
          <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
        </div>
      </div>
      {handle("nw", { left: box.left, top: box.top, transform: "translate(-50%,-50%)" })}
      {handle("ne", { left: box.left + box.width, top: box.top, transform: "translate(-50%,-50%)" })}
      {handle("sw", { left: box.left, top: box.top + box.height, transform: "translate(-50%,-50%)" })}
      {handle("se", {
        left: box.left + box.width,
        top: box.top + box.height,
        transform: "translate(-50%,-50%)",
      })}
    </div>
  );
}
