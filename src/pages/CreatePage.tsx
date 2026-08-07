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
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import { useFlow } from "../studio/flowStore";

interface Mode {
  key: string;
  emoji: string;
  title: string;
  tag: string;
  desc: string;
  bullets: string[];
  /** 卡面渐变 + 边框 */
  skin: string;
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
    skin: "from-amber-400/30 via-amber-500/10 to-transparent border-amber-400/45",
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
    skin: "from-cyan-400/30 via-cyan-500/10 to-transparent border-cyan-400/45",
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
    skin: "from-fuchsia-400/30 via-fuchsia-500/10 to-transparent border-fuchsia-400/45",
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
        {/* 直接回首页而不是 navigate(-1)：这一页常从登录重定向落地（历史里
            上一条是登录页），也可能是首个历史记录，后退会退出应用而不是回首页 */}
        <button onClick={() => navigate("/")} className="flex items-center gap-1 text-slate-300">
          <Icon name="back" size={20} />
        </button>
        <span className="font-bold text-slate-100">开始创作</span>
        <span className="flex-1 text-right text-xs text-slate-500">左右滑动挑一种</span>
      </header>

      {/* 横向卡片轨：一屏一张，松手吸附 */}
      <div
        ref={railRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {MODES.map((m) => (
          <div key={m.key} className="flex h-full w-full flex-none snap-center items-stretch px-4 pb-3">
            <div className={`flex w-full flex-col rounded-3xl border bg-gradient-to-b p-5 ${m.skin}`}>
              <div className="text-5xl">{m.emoji}</div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-2xl font-bold text-slate-50">{m.title}</span>
                <span className="rounded-full bg-black/35 px-2 py-0.5 text-[10px] text-slate-300">{m.tag}</span>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-200">{m.desc}</p>
              <ul className="mt-4 space-y-2">
                {m.bullets.map((b) => (
                  <li key={b} className="flex gap-2 text-xs leading-relaxed text-slate-300">
                    <span className="flex-none text-slate-500">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="flex-1" />
              <button
                onClick={() => m.go(navigate)}
                className="w-full rounded-2xl bg-white/90 py-3 text-sm font-bold text-ink transition active:scale-[0.98]"
              >
                {m.cta} ›
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 页点 + 左右翻页 */}
      <div className="safe-bottom flex flex-none items-center justify-center gap-4 py-3">
        <button
          onClick={() => scrollTo(Math.max(0, at - 1))}
          disabled={at === 0}
          className="text-slate-400 disabled:opacity-25"
          aria-label="上一个"
        >
          <Icon name="back" size={20} />
        </button>
        <div className="flex items-center gap-2">
          {MODES.map((m, i) => (
            <button
              key={m.key}
              onClick={() => scrollTo(i)}
              aria-label={m.title}
              className={`h-2 rounded-full transition-all ${i === at ? "w-6 bg-brand" : "w-2 bg-slate-600"}`}
            />
          ))}
        </div>
        <button
          onClick={() => scrollTo(Math.min(MODES.length - 1, at + 1))}
          disabled={at === MODES.length - 1}
          className="text-slate-400 disabled:opacity-25"
          aria-label="下一个"
        >
          <Icon name="chevron" size={20} />
        </button>
      </div>
    </div>
  );
}
