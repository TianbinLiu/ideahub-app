// 引导遮罩：**变暗 + 锁住整屏 + 只能点「下一步」**。
//
// ── 三条已经量清楚的坑，各钉一处 ─────────────────────────────────────
// ★★★ ① 必须 `createPortal` 到 `document.body`，**光靠 z 值压不住**。
//   首页根节点是 `fixed inset-0 z-0`、创作页/剪辑页/工作流页根节点是 `fixed inset-0`
//   （position:fixed 本身就开层叠上下文），留在页面里的 `inset-0 z-[90]` 只能在那个盒子里排；
//   另有 MaterialSheet / RoleConfirmSheet / 工坊投影面板等祖先带 `backdrop-blur`，
//   而 backdrop-filter 会给 fixed 后代造**包含块**，`inset-0` 于是只铺满那一小块。
//   CLAUDE.md 已把这条列为已知坑（评论抽屉、首尾帧放大层各栽过一次）。
// ★★ ② portal 之后 DOM 上虽已脱离页面，**React 合成事件仍沿组件树冒泡**。
//   首页上的遮罩若不写 onPointerDown/onPointerUp/onClick 三个 stopPropagation，
//   点遮罩会同时触发 FeedItem 的暂停/解静音/双击点赞（CommentSheet 就是为这个写的）。
// ★★ ③ **安卓物理返回键这一批有意不接管**。全 app 现在没有任何地方监听 backButton，
//   默认行为是 WebView goBack（HashRouter 下退回上一路由）。所以引导开着时按返回，
//   会**直接离开当前页**而不是关掉引导 —— 这是已知行为，不是漏做：要修得挂一个全局
//   backButton 监听，而那一下会同时接管全 app 的返回语义（每页都要补自己的返回行为），
//   属于独立一批的事。`GuideGate` 里"换路由就关引导"那一条兜住了后果（不会留下一个
//   飘在新页面上、关不掉的遮罩）。
//
// ── 为什么没有「跳过」───────────────────────────────────────────────
// 产品要求就是**强制走完**（"用户这时只能点下一步直到步骤走完"）。代价是：一旦用户
// 在没看懂时连点几下过去，那一屏就再也不会自动弹了 —— 所以设置页给了一颗
// 「重看所有新手引导」（data/guide.resetGuidesSeen），每一页角落也常驻那颗 `?`。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { activeGuide, closeGuide, stepGuide } from "../../data/guide";
import { useGuide } from "../../hooks/useGuide";
import { tourById } from "./tours";

/**
 * 引导层的层号。全仓现有天花板是 RoleCastBoard 拖拽跟手卡影的 z-[80]，
 * ★ 收成常量而不是各处手写：z 值目前散在 70+ 处硬编码，再手写一个数只会让
 *   下一个人继续"猜一个更大的"。
 */
export const GUIDE_Z = 90;

/** 高亮圈四周留的余量（px）。太贴会把按钮的圆角/阴影切掉，看起来像画错了 */
const HOLE_PAD = 6;

/**
 * 压暗的底色。**两个分支共用这一个值**（挖洞那层用它当 box-shadow，没有锚点时用它铺满）——
 * 分开写会漂成"有圈的那一步暗、没圈的那一步更暗"，而那看起来像 bug 不像设计。
 *
 * ★★ 为什么是写死的 rgba 而不是 `bg-black/78` 这类 Tailwind 类（2026-08-17 实测踩到）：
 *   这套 Tailwind 只生成**5 的倍数**的透明度档（25/35/45/70/85 都在，78 **不在**），
 *   而没生成的类不会报错、不会警告，只是**静默退成全透明** —— 遮罩看起来完全消失，
 *   但它仍然吃掉所有点击。也就是说屏幕看着能点、点哪儿都没反应，正是本仓最讨厌的
 *   那种"零报错的坏"。写死一个 rgba 就没有这一层可以静默失败的东西。
 */
const DIM = "rgba(0,0,0,0.78)";
/**
 * 找锚点的重试次数（每帧一次）。
 * ★ 为什么要重试而不是一次找不到就放弃：自动弹那一路发生在刚换路由时，目标元素可能
 *   还没挂上（列表要等数据、抽屉要等动画）。找不到**不是错误** —— 这一步就退成
 *   居中卡片、不画圈，照样能读（见下面 rect=null 的分支）。
 */
const FIND_TRIES = 30;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(anchor: string): Rect | null {
  const el = document.querySelector(`[data-guide="${CSS.escape(anchor)}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // 宽高为 0 = 还没布局好 / 被隐藏了：当作没找到（画一个 0×0 的圈只会是个怪点）
  if (r.width <= 0 || r.height <= 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export default function GuideOverlay() {
  useGuide();
  const act = activeGuide();
  const tour = act ? tourById(act.id) : null;
  const step = tour && act ? tour.steps[act.step] : null;

  const [rect, setRect] = useState<Rect | null>(null);
  const tries = useRef(0);
  const raf = useRef(0);

  const anchor = step?.anchor ?? "";

  /** 量一次锚点位置。量不到就每帧重试，最多 FIND_TRIES 帧，之后退成居中卡片 */
  const measure = useCallback(() => {
    if (!anchor) {
      setRect(null);
      return;
    }
    const got = rectOf(anchor);
    if (got) {
      setRect(got);
      return;
    }
    if (tries.current < FIND_TRIES) {
      tries.current += 1;
      raf.current = window.requestAnimationFrame(measure);
    } else {
      setRect(null);
    }
  }, [anchor]);

  useLayoutEffect(() => {
    tries.current = 0;
    window.cancelAnimationFrame(raf.current);
    // ★★ 换步先把圈**清掉**再去找（2026-08-17 修）：新一步的锚点常要等几帧才挂上
    //   （列表等数据、抽屉等动画，所以才有 FIND_TRIES 那圈重试），而重试期间 rect 若留着
    //   上一步的值，这半秒里高亮圈会稳稳地**指着上一步那个元素** —— 用户会照着圈去看一个
    //   错的东西。宁可短暂无圈（那一步本来就有"退成居中卡片"的兜底），也不要短暂指错。
    // ★ 不会因此闪一下：这两次 setState 在同一个 layout effect 里同步发出，React 批到
    //   一次渲染，锚点当场就找得到的步骤只会看到最终那个 rect（清空那一拍不落屏）。
    setRect(null);
    measure();
    return () => window.cancelAnimationFrame(raf.current);
  }, [measure]);

  // 转屏 / 键盘弹起 / 页面滚动都会让圈画歪。★ scroll 用捕获：目标多半在某个内层滚动容器里，
  // 只监听 window 的冒泡阶段收不到内层滚动
  useEffect(() => {
    if (!anchor) return;
    const on = () => {
      const got = rectOf(anchor);
      if (got) setRect(got);
    };
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [anchor]);

  if (!tour || !act || !step) return null;

  const last = act.step >= tour.steps.length - 1;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  /**
   * 卡片摆哪儿 —— 按**圈上下各剩多少空隙**算，不是按圈在屏幕上半还是下半。
   *
   * ★★ 第一版写的是「圈的底沿在屏幕 55% 以上就摆下面」，再拿一个
   *   `Math.min(innerHeight - 200, ...)` 去钳位。那个钳位是拍脑袋的：它钳的是
   *   `bottom`，而**卡片有多高根本没参与计算**。实测首页第 2 步（圈住整条右侧栏，
   *   高 432px）当场把卡片顶出屏幕上沿（top = -10.8），第一行被切掉。
   * ★ 现在的判据是可验证的：两边空隙各算一遍，去大的那边，并把 `maxHeight` 设成
   *   那条空隙 —— 卡片再长也只会**在自己内部滚**，永远不会跑出视口。
   * ★ 两边都塞不下（圈太大，比如整条侧栏）时**退回居中**并允许盖住圈：一张读不了的
   *   窄条比"圈被盖住一部分"糟得多，而圈的描边仍然露在外面。
   */
  const GAP = 12;
  const EDGE = 16;
  /** 上下空隙小于这个数就别硬塞了（一张卡至少要能显示标题 + 两行正文 + 按钮） */
  const MIN_CARD_H = 190;
  const vh = window.innerHeight;
  const gapAbove = rect ? rect.top - HOLE_PAD - GAP - EDGE : 0;
  const gapBelow = rect ? vh - (rect.top + rect.height + HOLE_PAD) - GAP - EDGE : 0;
  const below = gapBelow >= gapAbove;
  const gap = Math.max(gapAbove, gapBelow);
  const anchored = !!rect && gap >= MIN_CARD_H;
  const cardStyle: React.CSSProperties = anchored
    ? below
      ? { top: rect.top + rect.height + HOLE_PAD + GAP, maxHeight: gap, overflowY: "auto" }
      : { bottom: vh - rect.top + HOLE_PAD + GAP, maxHeight: gap, overflowY: "auto" }
    : { top: "50%", transform: "translateY(-50%)", maxHeight: "70vh", overflowY: "auto" };

  return createPortal(
    <div
      // ★★ 整层吃掉所有手势 = "锁住点击互动"这件事本身。三个 stopPropagation 见文件头 ②
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: GUIDE_Z }}
      role="dialog"
      aria-modal="true"
      aria-label={`${tour.title} 使用引导`}
    >
      {/* 变暗：有锚点时用「圈 + 一圈超大 box-shadow」挖洞（不需要 SVG mask，
          也不会像两层 div 那样在圈边留出接缝）；没锚点就整屏均匀压暗 */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-brand"
          style={{
            top: rect.top - HOLE_PAD,
            left: rect.left - HOLE_PAD,
            width: rect.width + HOLE_PAD * 2,
            height: rect.height + HOLE_PAD * 2,
            boxShadow: `0 0 0 9999px ${DIM}`,
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0" style={{ background: DIM }} />
      )}

      {/* 说明卡。★ 用 absolute 定位而不是 flex 居中：有锚点时要贴着圈放 */}
      <div className="absolute inset-x-4 rounded-2xl border border-slate-600 bg-panel p-4 shadow-2xl" style={cardStyle}>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-full bg-brand/20 px-2 py-0.5 text-[10px] font-bold text-brand">
            {act.step + 1}/{tour.steps.length}
          </span>
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100">{step.title}</h2>
        </div>
        <div className="text-[12px] leading-relaxed text-slate-300">{step.body}</div>
        <button
          onClick={() => (last ? closeGuide() : stepGuide())}
          className="mt-3.5 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
        >
          {last ? "知道了" : "下一步"}
        </button>
      </div>
    </div>,
    document.body,
  );
}
