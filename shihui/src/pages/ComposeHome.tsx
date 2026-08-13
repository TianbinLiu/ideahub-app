import { useState } from "react"
import { THEME_BANKS } from "../data/poems"
import { quotaLeft, useShihui } from "../data/store"
import { nav } from "../router"
import { MY_AUTHOR_ID, type Difficulty } from "../types"

const MODES: { key: Difficulty; title: string; badge: string; desc: string }[] = [
  { key: "assemble", title: "词语拼图", badge: "简单", desc: "从主题词语里挑着拼，拼出一句是一句" },
  { key: "theme", title: "主题创作", badge: "进阶", desc: "只给你一个主题，句子自己写" },
  { key: "free", title: "自由创作", badge: "自定义", desc: "想写什么写什么（不打分、不进排行榜）" },
]

export function ComposeHome() {
  const [mode, setMode] = useState<Difficulty>("assemble")
  const [theme, setTheme] = useState(THEME_BANKS[0].theme)
  const startWork = useShihui((s) => s.startWork)
  const works = useShihui((s) => s.works)
  const points = useShihui((s) => s.points)
  const qDate = useShihui((s) => s.quotaDate)
  const qUsed = useShihui((s) => s.quotaUsed)
  const left = quotaLeft({ quotaDate: qDate, quotaUsed: qUsed })

  const drafts = works.filter((w) => w.authorId === MY_AUTHOR_ID && !w.published && w.lines.length > 0)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-1 pt-6">
        <h1 className="font-kai text-2xl">写一首诗</h1>
        <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-mist">
          今日免费画面 {left} 段 · ✨{points}
        </span>
      </header>
      <p className="px-5 pb-4 text-sm text-mist">每写好一句，就为这一句画一段画面。</p>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-20">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`w-full rounded-2xl border p-4 text-left ${
              mode === m.key ? "border-cinnabar bg-cinnabar/5" : "border-ink/10 bg-white/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="font-kai text-lg">{m.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${mode === m.key ? "bg-cinnabar text-paper" : "bg-ink/5 text-mist"}`}>
                {m.badge}
              </span>
            </div>
            <div className="mt-1 text-sm text-mist">{m.desc}</div>
          </button>
        ))}

        {mode !== "free" && (
          <div className="pt-2">
            <div className="pb-2 text-sm text-mist">挑一个主题</div>
            <div className="flex flex-wrap gap-2">
              {THEME_BANKS.map((b) => (
                <button
                  key={b.theme}
                  onClick={() => setTheme(b.theme)}
                  className={`rounded-full px-4 py-1.5 text-sm ${
                    theme === b.theme ? "bg-cinnabar text-paper" : "bg-ink/5 text-ink"
                  }`}
                >
                  {b.theme}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => {
            const id = startWork(mode, mode === "free" ? undefined : theme)
            nav(`/compose/w/${id}`)
          }}
          className="mt-4 w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper active:scale-[0.99]"
        >
          开始写 →
        </button>

        {drafts.length > 0 && (
          <div className="pt-4">
            <div className="pb-2 text-sm text-mist">没写完的</div>
            {drafts.map((d) => (
              <button
                key={d.id}
                onClick={() => nav(`/compose/w/${d.id}`)}
                className="mb-2 flex w-full items-center justify-between rounded-xl border border-ink/10 bg-white/40 px-4 py-3 text-left"
              >
                <span className="font-kai">{d.title || `无题（${d.lines.length} 句）`}</span>
                <span className="text-sm text-cinnabar">继续 →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
