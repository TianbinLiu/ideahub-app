// 波浪式展开（2026-11-28）—— 工作流全屏小窗与对局「选视频风格」浮层的**同一份**圆扩散动画。
//
// 从 `ui/WorkflowWindow` 里抽出来的：原来那是小窗的私有实现，而这一轮主人点名选风格浮层要
// "复用工作流那套：波浪/淡入"。抄一份进 StylePick 的话，圆心/半径/时长/缓动里错一个数就变成
// "一处快一处慢"，而且这段几何本来就最容易改错 —— 面板 inset 了 18 px，视口角落换算进面板
// 本地坐标之后差一截（见下面 pickCorner 的 ★）。
//
// 口径（主人 2026-11-26 给的数，原样搬自 ui/WorkflowWindow）：
//   · 圆形 clip-path：圆心 = **视口角落**，半径 0 → `hypot(视口宽, 视口高)`，四角都能一次铺满；
//   · 开 520 ms / 收 460 ms，ease-out（cubic-bezier(0.22, 1, 0.36, 1)）；
//   · 遮罩比圆形早一点到位（0.55×）：面板还在铺的时候四角先暗下去，边缘不会"亮一下"；
//   · prefers-reduced-motion: reduce → 不播 clip-path，只 180 ms 淡入淡出。
//
// ★ 为什么用 WAAPI（element.animate）而不是 CSS transition：关→再开的竞态里要能随时 cancel
//   重来；transition 做这件事要手工清 class + 强制 reflow，更脆。
// ★ 纯 DOM、零 React：宿主（小窗 / 风格浮层）各自决定什么时候挂、什么时候卸；这一份只负责
//   "把给定的 panel（与可选的 veil）从圆心铺开 / 收回"，并把 cancel 句柄交回去。
// ★ 生产里没有验收钩子：`debugName` 只在宿主显式传的时候挂一个 window 读数对象；两个宿主都
//   挂在 `gsAcceptDebug`/DEV 之下（调用点判，见各自的 ★）。

/** 打开时长（ms）：主人给的 520 */
export const WAVE_OPEN_MS = 520;
/** 关闭时长（ms）：主人给的 460 */
export const WAVE_CLOSE_MS = 460;
/** reduced-motion 的淡入淡出时长（ms） */
export const WAVE_FADE_MS = 180;

/** 面板角落的代号（验收/报告用它说"这一发从哪长出来"） */
export type WaveCorner = "rb" | "lb" | "lt" | "rt";

/**
 * 选角逻辑（主人第 1 条的原话：「默认取右下角；如果生成键在屏幕另一侧（左半边），
 * 圆心改用离它最近的角落」）。
 *
 * - 没有点击坐标 / 键在**右半边** → 一律 `rb`（右下角，这是"家"）。
 *   右半边不再按上下分：3D 生成键在桌面右下角，而顶栏 🧩 在右上角 —— 两者离右下角都近。
 * - 键在**左半边** → 取左边两个角里**竖直方向更近**的那个（`lt` / `lb`）。
 * ★ 返回的是**视口 CSS px**（不是比例）：半径与圆心要用同一把尺子（`hypot(W,H)` 也是 px）。
 */
export function pickCorner(origin: [number, number] | null, w: number, h: number): [WaveCorner, [number, number]] {
  if (!origin || origin[0] >= w / 2) return ["rb", [w, h]];
  return origin[1] < h / 2 ? ["lt", [0, 0]] : ["lb", [0, h]];
}

/** 系统"减少动态效果"开关（WebView 里 matchMedia 个别版本会抛，吞掉当关着） */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface WaveRevealOptions {
  /** true = 张开，false = 收回 */
  opening: boolean;
  /** 触发位置（viewport CSS px）；null = 缺省右下角 */
  origin: [number, number] | null;
  /** 可选遮罩：跟着面板一起淡入/淡出（圆扩散期间先到位，见文件头） */
  veil?: HTMLElement | null;
  /** 传了就在 window 上挂一个读数对象（验收用；生产里没人传 = 不存在） */
  debugName?: string;
  /** 收回播完之后的通知（宿主用它卸载）；cancel 之后不会再调 */
  onDone?: () => void;
}

export interface WaveRevealHandle {
  /** 立刻停掉（打开一半又关 / 关一半又开 / 宿主卸载）：取消动画、不再回调 onDone */
  cancel(): void;
}

/**
 * 给 `panel`（与可选 `veil`）播一次波浪。
 * ★ 调用方每次开/关先 cancel 上一发（宿主自己记句柄），这里**不**维护全局单例 ——
 *   两个宿主可以同时各播各的（虽然现实里不会）。
 * ★ 打开播完之后把 clip-path 清掉：之后转屏 / 改尺寸不会被一个按旧尺寸算出来的圆裁掉。
 */
export function playWaveReveal(panel: HTMLElement, opts: WaveRevealOptions): WaveRevealHandle {
  const { opening, origin, veil = null, debugName, onDone } = opts;
  const anims: Animation[] = [];
  let cancelled = false;
  let timer: number | undefined;

  const stop = () => {
    for (const a of anims) {
      try {
        a.cancel();
      } catch {
        /* 已经结束的动画 cancel 会抛（部分 WebView）：忽略 */
      }
    }
    anims.length = 0;
  };

  const finish = (fn?: () => void) => {
    if (cancelled) return;
    fn?.();
  };

  const dur = opening ? WAVE_OPEN_MS : WAVE_CLOSE_MS;
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (prefersReducedMotion()) {
    // 尊重 prefers-reduced-motion：不播圆形扩散，只淡入淡出
    anims.push(
      panel.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
        duration: WAVE_FADE_MS,
        easing: "ease-out",
        fill: "forwards",
      }),
    );
    if (veil) {
      anims.push(
        veil.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: WAVE_FADE_MS,
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    }
  } else {
    // 圆心 = 挑出来的**视口角落**，换算进面板本地坐标（面板可能 inset 了一圈，所以角落差一截）
    const rect = panel.getBoundingClientRect();
    const [corner, pt] = pickCorner(origin, w, h);
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
    if (debugName) {
      (window as unknown as Record<string, unknown>)[debugName] = {
        corner,
        cornerViewport: pt,
        originInPanel: [+ox.toFixed(1), +oy.toFixed(1)],
        radius: Math.round(r),
        viewport: [w, h],
        openMs: WAVE_OPEN_MS,
        closeMs: WAVE_CLOSE_MS,
        reduced: false,
      };
    }
    const from = `circle(0px at ${ox}px ${oy}px)`;
    const to = `circle(${r}px at ${ox}px ${oy}px)`;
    anims.push(
      panel.animate([{ clipPath: opening ? from : to }, { clipPath: opening ? to : from }], {
        duration: dur,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)", // ease-out：先快后慢
        fill: "forwards",
      }),
    );
    if (veil) {
      // 遮罩比圆形早一点到位（0.55×）：面板还在铺的时候四角的 3D 先暗下去，边缘不会"亮一下"
      anims.push(
        veil.animate([{ opacity: opening ? 0 : 1 }, { opacity: opening ? 1 : 0 }], {
          duration: Math.round(dur * 0.55),
          easing: "ease-out",
          fill: "forwards",
        }),
      );
    }
  }

  const all = Promise.all(
    anims.map((a) =>
      a.finished.catch(() => {
        /* cancel 掉的那一发 finished 会 reject：由 cancelled 兜着，不当异常 */
      }),
    ),
  );
  if (onDone) {
    // 兜底计时器：个别 WebView 在动画被系统打断时 finished 可能不 settle，别把面板卡在屏上
    void all.then(() => finish(onDone));
    timer = window.setTimeout(() => finish(onDone), dur + 150);
  } else if (opening) {
    // 打开播完就把 clip 清掉：之后转屏/改尺寸不会被一个按旧尺寸算出来的圆裁掉。
    // ★ 必须 cancel 掉那一发，不能只清内联样式：WAAPI 的 `fill: "forwards"` 会一直压着
    //   `panel.style.clipPath`（动画来源的优先级高于内联样式），原来 WorkflowWindow 里
    //   "panel.style.clipPath = ''" 那一行其实没生效 —— 2026-11-28 抽出来时一并修掉。
    void all.then(() => {
      if (cancelled) return;
      for (const a of anims) {
        try {
          a.cancel();
        } catch {
          /* 已经结束的动画 cancel 会抛（部分 WebView）：忽略 */
        }
      }
      anims.length = 0;
      panel.style.clipPath = "";
      panel.style.opacity = "";
    });
  }

  return {
    cancel() {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      stop();
    },
  };
}
