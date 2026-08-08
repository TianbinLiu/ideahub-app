// 创作入口的岔路口：底栏 ➕ 先到这里，再分三条路。
//
// 横向卡片轮播（一屏一张、scroll-snap 吸附）而不是竖排列表：三个选项是"挑一个"
// 而不是"读完全部"，横向翻牌让每张都能占满视野，与产品里到处都是的卡牌语言一致。
//
// 三条路是同一条流水线的不同入口，而不是三套并行实现：
//   工坊模式  —— 3D 铸卡桌面推演剧情 → 工作流逐段生成 → 剪辑 → 发布
//   工作流模式 —— 直接在节点卡上写分镜（也能让 AI 就地推演三种走向）→ 剪辑 → 发布
//   简约模式  —— 单节点，一句话出一条几秒短片 → 剪辑 → 发布
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
import { useFlow } from "../studio/flowStore";

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
}

const MODES: Mode[] = [
  {
    key: "studio",
    emoji: "🎴",
    title: "工坊模式",
    tag: "完整作品",
    desc: "在 3D 铸卡桌面上摆素材卡，AI 每段推演三种走向，你挑着往下铺剧情。",
    bullets: ["素材卡组驱动，人物场景全片一致", "每段三选一，可分叉可回溯", "成片自动派生卡组，观众能复刻"],
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
    desc: "一屏一张节点卡：左右翻页换段落，上下翻页换走向，逐段生成、逐段确认。",
    bullets: ["节点卡就是工坊的节点卡，只是没有 3D 桌面", "一段一结账，不满意只重炼这一段", "也能让 AI 就地推演三种走向"],
    cover: "/create/workflow.jpg",
    skin: "border-cyan-400/45",
    cta: "开一条工作流",
    go: (nav) => {
      useFlow.getState().seedSolo("workflow");
      nav("/flow");
    },
  },
  {
    key: "simple",
    emoji: "⚡",
    title: "简约模式",
    tag: "几秒出片",
    desc: "只有一个节点：写一句话，挑个时长，直接出一条几秒的短视频。",
    bullets: ["无需素材卡，开箱即用", "起拍画面 AI 代笔", "满意就发布，不满意就重炼"],
    cover: "/create/simple.jpg",
    skin: "border-fuchsia-400/45",
    light: true,
    cta: "写一句话出片",
    go: (nav) => {
      useFlow.getState().seedSolo("simple");
      nav("/flow");
    },
  },
];

export default function CreatePage() {
  const navigate = useNavigate();
  const railRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

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
      </header>

      {/* 卡片轨 + 贴左右边缘垂直居中的翻页箭头 */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={railRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: "none" }}
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
                    onClick={() => m.go(navigate)}
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
      <div className="safe-bottom flex flex-none items-center justify-center gap-2 py-3">
        {MODES.map((m, i) => (
          <button
            key={m.key}
            onClick={() => scrollTo(i)}
            aria-label={m.title}
            className={`h-2 rounded-full transition-all ${i === at ? "w-6 bg-brand" : "w-2 bg-slate-600"}`}
          />
        ))}
      </div>
    </div>
  );
}
