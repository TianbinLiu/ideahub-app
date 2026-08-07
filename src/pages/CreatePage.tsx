// 创作入口的岔路口：底栏 ➕ 先到这里，再分三条路。
//
// 三条路是同一条流水线的不同入口，而不是三套并行实现：
//   工坊模式  —— 3D 铸卡桌面推演剧情 → 铺成工作流 → 剪辑 → 发布
//   工作流模式 —— 直接在节点流水线上写分镜 → 剪辑 → 发布
//   简约模式  —— 单节点，一句话出一条几秒短片 → 剪辑 → 发布
// 差别只在"前半段怎么攒出节点"，后半段（逐段生成/剪辑/发布）完全共用。
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
  accent: string;
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
    accent: "from-amber-400/25 to-amber-500/5 border-amber-400/40",
    go: (nav) => nav("/studio"),
  },
  {
    key: "workflow",
    emoji: "🧩",
    title: "工作流模式",
    tag: "自己写分镜",
    desc: "一条竖排的节点流水线：每个节点写清楚要拍什么，逐段生成、逐段确认。",
    bullets: ["节点可增删、可换序", "一段一结账，不满意只重炼这一段", "画面上圈物体提要求就能改"],
    accent: "from-cyan-400/25 to-cyan-500/5 border-cyan-400/40",
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
    accent: "from-fuchsia-400/25 to-fuchsia-500/5 border-fuchsia-400/40",
    go: (nav) => {
      useFlow.getState().seedSolo("simple");
      nav("/flow");
    },
  },
];

export default function CreatePage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-full pb-10">
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-slate-400 hover:text-white">
            <Icon name="back" size={18} />
          </button>
          <span className="font-bold text-slate-100">开始创作</span>
          <span className="flex-1 text-right text-xs text-slate-500">选一种方式</span>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-3 px-4 pt-4">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => m.go(navigate)}
            className={`w-full rounded-2xl border bg-gradient-to-br p-4 text-left transition active:scale-[0.99] ${m.accent}`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{m.emoji}</span>
              <span className="text-base font-bold text-slate-50">{m.title}</span>
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-slate-300">{m.tag}</span>
              <span className="flex-1 text-right text-slate-400">
                <Icon name="chevron" size={18} />
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">{m.desc}</p>
            <ul className="mt-2 space-y-0.5">
              {m.bullets.map((b) => (
                <li key={b} className="text-[11px] text-slate-400">
                  · {b}
                </li>
              ))}
            </ul>
          </button>
        ))}
        <p className="pt-1 text-center text-[11px] leading-relaxed text-slate-500">
          三种方式最后都会走到同一个剪辑页与发布页——先挑一个顺手的开始就行。
        </p>
      </main>
    </div>
  );
}
