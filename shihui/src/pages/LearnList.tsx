import { InkPlaceholder } from "../components/InkPlaceholder"
import { POEMS } from "../data/poems"
import { useShihui } from "../data/store"
import { nav } from "../router"

export function LearnList() {
  const learn = useShihui((s) => s.learn)
  const points = useShihui((s) => s.points)

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-5 pb-3 pt-6">
        <h1 className="font-kai text-2xl">学诗</h1>
        <span className="rounded-full bg-ink/5 px-3 py-1 text-sm text-mist">✨ {points} 积分</span>
      </header>
      <p className="px-5 pb-3 text-sm text-mist">每句诗一段画面，念出这一句，就走进下一句。</p>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-20">
        {POEMS.map((p) => {
          const prog = learn[p.id]
          const done = !!prog?.completedAt
          return (
            <button
              key={p.id}
              onClick={() => nav(`/learn/${p.id}`)}
              className="flex w-full items-stretch gap-4 rounded-2xl border border-ink/10 bg-white/40 p-3 text-left active:scale-[0.99]"
            >
              <InkPlaceholder
                text={p.lines[0].text}
                keywords={p.lines[0].keywords}
                animate={false}
                className="h-28 w-20 shrink-0 rounded-xl"
              />
              <div className="flex flex-1 flex-col justify-between py-1">
                <div>
                  <div className="font-kai text-xl">{p.title}</div>
                  <div className="mt-0.5 text-sm text-mist">
                    {p.dynasty} · {p.author}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-mist">{p.theme}</span>
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-mist">{p.grade} 年级</span>
                  {done ? (
                    <span className="ml-auto text-cinnabar">已学完 ✓</span>
                  ) : prog?.lineIdx ? (
                    <span className="ml-auto text-mist">学到第 {prog.lineIdx + 1} 句</span>
                  ) : null}
                </div>
              </div>
            </button>
          )
        })}
        <p className="pb-2 pt-1 text-center text-xs text-mist">
          骨架版内置 4 首 · 完整内容库见 docs/IDEA-REVIEW.md
        </p>
      </div>
    </div>
  )
}
