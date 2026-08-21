// 创作入口的岔路口：底栏 ➕ 先到这里，再分三条路。
//
// 横向卡片轮播（一屏一张、scroll-snap 吸附）而不是竖排列表：三个选项是"挑一个"
// 而不是"读完全部"，横向翻牌让每张都能占满视野，与产品里到处都是的卡牌语言一致。
//
// 三条路是同一条流水线的不同入口，而不是三套并行实现：
//   工坊模式  —— 3D 铸卡桌面推演三套方案、挑一套炼一段，逐段落地 → 剪辑 → 发布
//   工作流模式 —— 一屏一段：写要求 → 三套方案摊开挑一套 → 炼这一段 → 下一段 → 剪辑 → 发布
//   简约模式  —— 单节点，一句话出一条几秒短片 → 剪辑 → 发布（**不进草稿库**，见下）
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import DiscardFlowDialog from "../components/flow/DiscardFlowDialog";
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
    desc: "在 3D 铸卡桌面上摆素材卡，AI 每段推演三套走向，挑一套炼一段，逐段往下铺。",
    bullets: ["素材卡组驱动，人物场景全片一致", "每段三选一，可分叉可回溯", "本段炼出来才开下一张卡，坏了立刻止损"],
    cover: "/create/studio.jpg",
    skin: "border-amber-400/45",
    cta: "进铸卡桌面",
    go: (nav) => nav("/studio"),
  },
  {
    key: "workflow",
    emoji: "🧩",
    title: "工作流模式",
    tag: "自己写分镜",
    desc: "一屏一段：写一句要求，AI 先给三套方案（各带首尾帧预览），挑定一套再炼视频。",
    bullets: [
      "三套方案摊在屏幕上挑，选中的那套可换首尾帧、改剧情",
      "一段一结账，不满意只重炼这一段",
      "节点卡就是工坊的节点卡，只是没有 3D 桌面",
    ],
    cover: "/create/workflow.jpg",
    skin: "border-cyan-400/45",
    cta: "开一条工作流",
    resets: true,
    go: (nav) => {
      useFlow.getState().seedSolo("workflow");
      // 这是"另起一摊活"：断开与上一条草稿的关联，否则在新工作流里点保存会把
      // 之前那条草稿原地覆盖掉
      useStudio.getState().newWorkDraft();
      nav("/flow");
    },
  },
  {
    key: "simple",
    emoji: "⚡",
    title: "简约模式",
    tag: "几秒出片",
    desc: "只有一个节点：写一句话，挑个时长，直接出一条几秒的短视频。不推方案、不存草稿。",
    bullets: ["无需素材卡，开箱即用", "起拍画面 AI 代笔", "一次性直通发布，不占草稿库"],
    cover: "/create/simple.jpg",
    skin: "border-fuchsia-400/45",
    light: true,
    cta: "写一句话出片",
    resets: true,
    go: (nav) => {
      useFlow.getState().seedSolo("simple");
      // 简约模式自己不落草稿（见 studioStore.saveWorkDraft），但仍然要断开与上一条草稿的
      // 关联：不断开的话，用户从简约模式回工坊再点「存草稿」会把之前那条原地覆盖掉
      useStudio.getState().newWorkDraft();
      nav("/flow");
    },
  },
];

export default function CreatePage() {
  const navigate = useNavigate();
  // 第一次进这一屏强制放一遍引导（看过一次不再自动弹；那颗 ? 随时能重看）
  useAutoGuide("create");
  const railRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // 在途工作流保护：seedSolo 是整表覆盖，直接进会静默抹掉已出片的段（每段真金白银 +
  // 几分钟）与手敲的剧情，而且 origin 会从 "studio" 翻成 "solo"——工作流页的返回键
  // 从此回 /create 而不是工坊，那棵节点树就再也走不回去了。
  const [pending, setPending] = useState<Mode | null>(null);
  const flowNodes = useFlow((s) => s.nodes);

  function scrollTo(i: number) {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: i * rail.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-ink">
      <header className="safe-top flex flex-none items-center gap-3 px-4 py-3">
        {/* 直接回首页而不是 navigate(-1)：这一页常从登录重定向落地（历史里上一条
            是登录页），也可能本身就是首个历史记录，后退会退出应用而不是回首页 */}
        <button onClick={() => navigate("/")} className="flex items-center gap-1 text-slate-300">
          <Icon name="back" size={20} />
        </button>
        <span className="font-bold text-slate-100">开始创作</span>
        <span className="flex-1 text-right text-xs text-slate-500">左右滑动挑一种</span>
        <HelpButton tour="create" />
      </header>

      {/* 卡片轨 + 贴左右边缘垂直居中的翻页箭头 */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={railRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        >
          {MODES.map((m, i) => (
            <div key={m.key} className="flex h-full w-full flex-none snap-center items-stretch px-4 pb-3">
              <div className={`relative w-full overflow-hidden rounded-3xl border ${m.skin}`}>
                <img
                  src={m.cover}
                  alt=""
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
                {/* 压字层：跟着封面明暗走。收敛得快是有意的——底部 38% 压成实底给
                    文字，62% 以上完全透明，画面主体（悬浮塔罗牌/全息面板/猫）不被糊掉 */}
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
                  <p className={`mt-2.5 text-sm leading-relaxed ${m.light ? "text-slate-700" : "text-slate-200"}`}>
                    {m.desc}
                  </p>
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
                    // 引导高亮只挂在**当前这一张**上：轮播是三张并排、靠 scroll 吸附，
                    // 非当前那两张仍在 DOM 里且 getBoundingClientRect 返回非零宽高（只是
                    // 在视口外），写死 i === 0 会在用户已划到第二张时把圈画到屏幕外，而
                    // 「找不到锚点就退成居中卡片」的兜底判的是元素存在与否，根本不会触发。
                    {...(i === at ? { "data-guide": "create-cta" } : {})}
                    onClick={() => (m.resets && flowDirty(flowNodes) ? setPending(m) : m.go(navigate))}
                    className={`mt-4 w-full rounded-2xl py-3 text-sm font-bold transition active:scale-[0.98] ${
                      m.light ? "bg-ink text-white" : "bg-white/90 text-ink"
                    }`}
                  >
                    {m.cta} ›
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => scrollTo(Math.max(0, at - 1))}
          disabled={at === 0}
          className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition disabled:pointer-events-none disabled:opacity-0"
          aria-label="上一个"
        >
          <Icon name="back" size={22} />
        </button>
        <button
          onClick={() => scrollTo(Math.min(MODES.length - 1, at + 1))}
          disabled={at === MODES.length - 1}
          className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition disabled:pointer-events-none disabled:opacity-0"
          aria-label="下一个"
        >
          <Icon name="chevron" size={22} />
        </button>
      </div>

      {/* 页点：翻页箭头已经贴在轨道两侧，这里只留位置指示 */}
      <div data-guide="create-dots" className="safe-bottom flex flex-none items-center justify-center gap-2 py-3">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            onClick={() => scrollTo(i)}
            aria-label={m.title}
            className={`h-2 rounded-full transition-all ${i === at ? "w-6 bg-brand" : "w-2 bg-slate-600"}`}
          />
        ))}
      </div>

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
