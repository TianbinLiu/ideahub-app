// 创作入口的岔路口：底栏 ➕ 先到这里，再分三条路。
//
// 横向卡片轮播（一屏一张、scroll-snap 吸附）而不是竖排列表：三个选项是"挑一个"
// 而不是"读完全部"，横向翻牌让每张都能占满视野，与产品里到处都是的卡牌语言一致。
//
// 三条路是同一条流水线的不同入口，而不是三套并行实现：
//   工坊模式  —— 3D 铸卡桌面推演三套方案、挑一套炼一段，逐段落地 → 剪辑 → 发布
//   简约模式  —— 单节点，一句话出一条几秒短片 → 剪辑 → 发布（**不进草稿库**，见下）
import { useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import DiscardFlowDialog from "../components/flow/DiscardFlowDialog";
import { SegmentRecoverList } from "../components/flow/SegmentRecoverCards";
import { flowDirty, useFlow } from "../studio/flowStore";
import { useStudio } from "../studio/studioStore";

interface Mode {
  key: string;
  emoji: string;
  title: string;
  tag: string;
  desc: string;
  bullets: string[];
  /** 卡面封面（Seedream 生成，public/create/）：各自贴合该模式的气质 */
  cover: string;
  /** 边框点缀色 */
  skin: string;
  /** 封面本身偏亮：压字层改用白色 + 深色文字，否则"可爱"会被暗层压成"沉闷" */
  light?: boolean;
  cta: string;
  go: (nav: ReturnType<typeof useNavigate>) => void;
  /** true = 这条路会调 seedSolo 整表覆盖工作流，进去前得先问在途进度怎么办 */
  resets?: boolean;
}

const MODES: Mode[] = [
  {
    key: "studio",
    emoji: "🎴",
    title: "工坊模式",
    tag: "完整作品",
    desc: "在 3D 铸卡桌面上摆素材卡，AI 每段推演三套走向，挑一套炼一段，逐段往下铺；顶栏「🧩 工作流画布」把同一条流水线换成画布那一面。",
    bullets: ["用素材卡定人物场景，全片一致", "每段三选一，可回头改", "3D 桌面与工作流画布是同一条流水线的两个面"],
    cover: "/create/studio.jpg",
    skin: "border-amber-400/45",
    cta: "进铸卡桌面",
    go: (nav) => nav("/studio"),
  },
  {
    key: "simple",
    emoji: "⚡",
    title: "简约模式",
    tag: "几秒出片",
    desc: "只有一个节点：写一句话，挑个时长，直接出一条几秒的短视频。不推方案、不存草稿。",
    bullets: ["不用素材卡，直接写", "开头画面 AI 补", "直接发布，不进草稿"],
    cover: "/create/simple.jpg",
    skin: "border-fuchsia-400/45",
    light: true,
    cta: "写一句话出片",
    resets: true,
    go: (nav) => {
      if (!useFlow.getState().seedSolo("simple")) return; // 理由同上
      // 简约模式自己不落草稿（见 studioStore.saveWorkDraft），但仍然要断开与上一条草稿的
      // 关联：不断开的话，用户从简约模式回工坊再点「存草稿」会把之前那条原地覆盖掉
      useStudio.getState().newWorkDraft();
      nav("/simple"); // ★ 2026-08-23 起简约有自己的向导页，不再寄生在 /flow
    },
  },
];

export default function CreatePage() {
  const navigate = useNavigate();
  // 第一次进这一屏强制放一遍引导（看过一次不再自动弹；那颗 ? 随时能重看）
  useAutoGuide("create");
  /**
   * 翻了几次（2026-08-30 加左右滑动后从布尔改成计数）。
   *
   * ★★ 为什么不是 `flipped: boolean`：布尔只知道"现在是哪一面"，不知道**从哪边翻过去** ——
   *   而主人要的正是「翻面方向跟着手指走」。用整数累计之后，向左滑 +1、向右滑 -1，
   *   角度恒等于 `turns * 180`，两个方向的动画天然是反的，连翻两次也不会突然倒转。
   * ★ 奇偶决定当前是哪一面（负数取模要补正，JS 的 % 会给负值）。
   */
  const [turns, setTurns] = useState(0);
  const flipped = ((turns % 2) + 2) % 2 === 1;
  /** 拖动中的位移与卡宽（px，向左为负）。x≠0 = 正在跟手，此时关掉过渡。
   *  ★ 宽度一起放进 state：角度按「拖了卡宽的百分之几」算，写死一个近似值会让
   *    宽屏上转得太快、窄屏上转不动 */
  const [drag, setDrag] = useState({ x: 0, w: 1 });
  const dragRef = useRef<{ x: number; y: number; w: number; moved: boolean } | null>(null);
  /** 这一下是"滑"不是"点"：给 CTA 的 onClick 兜底，别在滑完之后又跳进某个模式 */
  const swipedRef = useRef(false);
  /** 超过这个位移就算一次翻面（与全仓横划阈值同一个数量级；也接受快甩） */
  const SWIPE_MIN = 56;
  // 在途工作流保护：seedSolo 是整表覆盖，直接进会静默抹掉已出片的段（每段真金白银 +
  // 几分钟）与手敲的剧情，而且 origin 会从 "studio" 翻成 "solo"——工作流页的返回键
  // 从此回 /create 而不是工坊，那棵节点树就再也走不回去了。
  const [pending, setPending] = useState<Mode | null>(null);
  const flowNodes = useFlow((s) => s.nodes);
  // 主 CTA 被整句拒时的原因（这一页此前不读它，见下面渲染处的 ★★）
  const flowErr = useFlow((s) => s.err);

  return (
    <div className="fixed inset-0 flex flex-col bg-ink">
      {/* 直接回首页而不是 navigate(-1)：这一页常从登录重定向落地（历史里上一条
            是登录页），也可能本身就是首个历史记录，后退会退出应用而不是回首页 */}
      <PageHeader className="flex-none px-4" onBack={() => navigate("/")} title="开始创作" right={<HelpButton tour="create" />} />

      {/* ★★ 待取回的那几发也摆在创作入口（2026-09-05）：App 被重启后流水线是空的，而取回卡此前
          只长在"有节点的地方"（简约页 / 画布 / 工坊投影窗）—— 空流水线上没有任何一个节点可点，
          凭据就此看不见，24 小时后作废。这里是冷启动后人最先落的一页；取回来会新开一段
          落进流水线（flowStore.placeRescuedSegment），进工坊 / 工作流就能接着剪。 */}
      <SegmentRecoverList className="flex-none px-4 pb-3" />

      {/* ══ 一张卡的正反面（2026-08-30 主人点名：不再是并排两张 + 左右箭头）══
          ★ 为什么是"翻面"而不是"换一张"：工坊与简约是同一件事的两种做法（同一条流水线的
            两个入口），正反面把这层关系画出来了；两张并排读起来像两条不同的产品线。
          ★ 翻面钮贴在卡片右上角外侧：卡面上任何位置都是内容（封面 + 说明 + CTA），
            压在上面必然遮住画；而它必须离卡近 —— 远了就与"这张卡能翻"失去关联。
          ★ transform-3d + backface-hidden：两面都在 DOM 里（各自 absolute 铺满），
            靠父层 rotateY 翻转。**不用两套内容切换**——那样没有中间态，翻面动画就成了闪切。 */}
      <div className="relative min-h-0 flex-1 px-4 pb-3">
        <div
          className="relative h-full touch-none [perspective:1600px]"
          onPointerDown={(e) => {
            // ★★ **这里绝不能 setPointerCapture**（2026-08-30 实测抓到）：一旦在按下这一刻
            //   就抓走指针，浏览器会把随后的 pointerup 与 **click 一起重定向到捕获元素** ——
            //   卡面上那颗 CTA 的 onClick 从此永远不执行，用户点「进铸卡桌面」毫无反应。
            //   捕获挪到"确认是拖动"那一刻（见 pointermove），只有真的在滑时才需要它。
            if (!e.isPrimary) return;
            const el = e.currentTarget;
            dragRef.current = { x: e.clientX, y: e.clientY, w: el.clientWidth || 1, moved: false };
            swipedRef.current = false;
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            // ★ 先判方向再认这一下是拖：竖向手势留给页面（这一屏虽然不滚，但按住卡片
            //   上下微动是常见的"我只是想点"，那时不该让卡转起来）
            if (!d.moved) {
              if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
              d.moved = true;
              // 确认是横滑了才抓指针：这样手指滑出卡面也收得到 move/up，而普通点击
              // （从不进这一支）仍然能把 click 正常送到按钮上
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }
            // 夹在一张卡的宽度内：拖过头也只转到 180°，不出现连翻
            setDrag({ x: Math.max(-d.w, Math.min(d.w, dx)), w: d.w });
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d) return;
            if (d.moved && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
            const dx = e.clientX - d.x;
            setDrag({ x: 0, w: d.w });
            if (!d.moved) return;
            swipedRef.current = true;
            // ★ 方向：**向左滑 = 角度增加**。理由是"跟手" —— rotateY 增大时，正面的右半边
            //   朝画面中心（也就是左）扫过去，正好跟着向左的手指；向右滑反之。
            //   写反的话动画会与手指对着干，比不做跟随更别扭。
            if (Math.abs(dx) >= SWIPE_MIN) setTurns((n) => (dx < 0 ? n + 1 : n - 1));
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            setDrag((s) => ({ x: 0, w: s.w }));
          }}
        >
          <div
            className={`relative h-full [transform-style:preserve-3d] ${drag.x === 0 ? "transition-transform duration-500" : ""}`}
            style={{
              // 拖动中的角度 = 已翻的整圈 + 这一下拖出来的那部分（同一个方向约定）
              transform: `rotateY(${turns * 180 + (-drag.x / drag.w) * 180}deg)`,
            }}
          >
            {MODES.map((m, i) => (
              <div
                key={m.key}
                aria-hidden={i === 1 ? !flipped : flipped}
                className={`absolute inset-0 overflow-hidden rounded-3xl border [backface-visibility:hidden] ${m.skin}`}
                style={i === 1 ? { transform: "rotateY(180deg)" } : undefined}
              >
                <img
                  src={m.cover}
                  alt=""
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
                {/* 压字层：跟着封面明暗走。收敛得快是有意的——底部 38% 压成实底给
                    文字，62% 以上完全透明，画面主体（悬浮塔罗牌/猫）不被糊掉 */}
                <div
                  className={`absolute inset-0 bg-gradient-to-t to-transparent to-62% ${
                    m.light ? "from-[#fdf7fb] from-38% via-[#fdf7fb]/85 via-50%" : "from-ink from-38% via-ink/80 via-50%"
                  }`}
                />
                <div className="relative flex h-full flex-col justify-end p-5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{m.emoji}</span>
                    <span className={`text-2xl font-bold ${m.light ? "text-slate-900" : "text-slate-50"}`}>
                      {m.title}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        m.light ? "bg-black/10 text-slate-700" : "bg-white/15 text-slate-200"
                      }`}
                    >
                      {m.tag}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {m.bullets.map((b) => (
                      <li
                        key={b}
                        className={`flex gap-2 text-xs leading-relaxed ${m.light ? "text-slate-600" : "text-slate-400"}`}
                      >
                        <span className="flex-none">·</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <button
                    {...(i === (flipped ? 1 : 0) ? { "data-guide": "create-cta" } : {})}
                    onClick={() => {
                      // 滑动结束那一拍浏览器仍会派发一次 click（指针没移出按钮时）——
                      // 不挡的话"滑一下换个模式"会变成"滑一下直接进了某个模式"
                      if (swipedRef.current) {
                        swipedRef.current = false;
                        return;
                      }
                      if (m.resets && flowDirty(flowNodes)) setPending(m);
                      else m.go(navigate);
                    }}
                    className={`mt-4 w-full rounded-2xl py-3 text-sm font-bold transition active:scale-[.98] ${
                      m.light ? "bg-ink text-white" : "bg-white/90 text-ink"
                    }`}
                  >
                    {m.cta} ›
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 翻面钮：贴卡片右上角外侧。写出**背面是谁**（"翻到简约模式"）而不是一个
              光秃秃的循环箭头——不写的话用户不知道翻过去会看到什么（ui-copy-grammar 文法④的近亲） */}
          <button
            data-guide="create-dots"
            onClick={() => setTurns((n) => n + 1)}
            aria-label={`翻到${MODES[flipped ? 0 : 1].title}`}
            title={`翻到${MODES[flipped ? 0 : 1].title}`}
            className="absolute -top-2 right-1 z-10 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-2 text-white backdrop-blur transition active:scale-95"
          >
            <Icon name="replay" size={16} />
            <span className="text-[11px] font-semibold">{MODES[flipped ? 0 : 1].title}</span>
          </button>
        </div>
      </div>

      {/* ★★ 这一页也要画 store.err（2026-08-21 第八轮扫描）：主 CTA 现在会被
          `canReplaceNodes` 整句拒（有段在生成中），而这一页此前从头到尾不读 err ——
          点下去没有跳转、没有弹层、一个字都没有，与"按钮坏了"完全一样（铁律八）。 */}
      {flowErr && (
        <div className="absolute inset-x-3 top-14 z-40 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/95 px-2.5 py-2">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-white">{flowErr}</p>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none text-white/90">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* ★ 与工坊法阵**同一个**对话框（components/flow/DiscardFlowDialog）：
          这段话要说清"丢弃会不会烧掉已经花过的钱"，抄成两份必然分叉 —— 而它此前
          正是两份，且两份都在撒谎（见那个组件顶上的 ★★） */}
      {pending && (
        <DiscardFlowDialog
          discardLabel={`开一条新的${pending.title}（丢弃上面那条）`}
          onResume={() => navigate("/flow")}
          onDiscard={() => {
            const m = pending;
            setPending(null);
            m.go(navigate);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
