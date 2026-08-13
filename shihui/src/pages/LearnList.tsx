import { useState } from "react"
import { InkPlaceholder } from "../components/InkPlaceholder"
import { useClips } from "../data/clips"
import { POEMS } from "../data/poems"
import { useShihui } from "../data/store"
import { nav } from "../router"
import type { Poem } from "../types"

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
              <PoemThumb poem={p} />
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
          带「真片」角标的诗已有预生成水墨视频（forge 管线产物）
        </p>
      </div>
    </div>
  )
}

/** 列表缩略图：有预生成真片用它的首帧海报图，没有退回水墨占位（hooks 不能进 map，单拆组件） */
function PoemThumb({ poem }: { poem: Poem }) {
  const segs = useClips(poem.id)
  const [imgBroken, setImgBroken] = useState(false)
  // manifest 是磁盘扫描的产物，别信它的形状：空 segments / 海报 404 都退回占位，不崩列表
  if (segs?.[0] && !imgBroken) {
    return (
      <div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-xl">
        <img src={segs[0].poster} alt="" onError={() => setImgBroken(true)} className="h-full w-full object-cover" />
        <span className="absolute bottom-1 right-1 rounded bg-cinnabar px-1 text-[10px] text-paper">真片</span>
      </div>
    )
  }
  return (
    <InkPlaceholder
      text={poem.lines[0].text}
      keywords={poem.lines[0].keywords}
      animate={false}
      className="h-28 w-20 shrink-0 rounded-xl"
    />
  )
}
