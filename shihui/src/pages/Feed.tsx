import { useEffect, useRef, useState } from "react"
import { InkPlaceholder } from "../components/InkPlaceholder"
import { ParentGate } from "../components/ParentGate"
import { VerseOverlay } from "../components/VerseOverlay"
import { useVideoUrl } from "../data/blobStore"
import { useShihui } from "../data/store"
import { MY_AUTHOR_ID, realClip, type PoemWork } from "../types"

// 广场：排行榜（有分才有名次）+ 最新。播放 = 逐句水墨画面 + 作者朗诵音频。
// mock 段没有真实时长，先按固定 3.2s/句 翻页；接真视频后改成 video ended 事件驱动，
// 音画同步的正确做法见 docs/IDEA-REVIEW.md「朗诵音频与视频的对齐」。

const MOCK_CLIP_SEC = 3.2

export function Feed() {
  const works = useShihui((s) => s.works)
  const likedIds = useShihui((s) => s.likedIds)
  const toggleLike = useShihui((s) => s.toggleLike)
  const claimShare = useShihui((s) => s.claimShare)
  const [tab, setTab] = useState<"rank" | "new">("rank")
  const [playing, setPlaying] = useState<PoemWork | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  /** 分享挂家长门（门禁矩阵见 docs/PARENT-GATE.md）：待分享的作品 */
  const [gateFor, setGateFor] = useState<PoemWork | null>(null)

  const published = works.filter((w) => w.published)
  const ranked = published
    .filter((w) => w.score)
    .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
  const latest = [...published].sort((a, b) => b.createdAt - a.createdAt)
  const list = tab === "rank" ? ranked : latest

  const share = async (w: PoemWork) => {
    const text = `《${w.title}》\n${w.lines.map((l) => l.text).join("\n")}\n—— 来自「诗绘」`
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 剪贴板被拒也照常给积分提示，分享文案已在屏幕上 */
    }
    const gained = claimShare()
    setToast(gained > 0 ? `已复制分享文案 +${gained} 积分` : "已复制分享文案（今天的分享奖励领过啦）")
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 px-5 pb-3 pt-6">
        <h1 className="font-kai text-2xl">广场</h1>
        <div className="ml-auto flex rounded-full bg-ink/5 p-1 text-sm">
          {(["rank", "new"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1 ${tab === t ? "bg-cinnabar text-paper" : "text-mist"}`}
            >
              {t === "rank" ? "排行榜" : "最新"}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-20">
        {list.length === 0 && <p className="pt-10 text-center text-sm text-mist">还没有作品，去创作页写第一首吧</p>}
        {list.map((w, i) => {
          const liked = likedIds.includes(w.id)
          return (
            <div key={w.id} className="rounded-2xl border border-ink/10 bg-white/40 p-3">
              <button onClick={() => setPlaying(w)} className="flex w-full items-center gap-3 text-left">
                {tab === "rank" && (
                  <span className={`w-7 shrink-0 text-center font-kai text-xl ${i < 3 ? "text-cinnabar" : "text-mist"}`}>
                    {i + 1}
                  </span>
                )}
                <InkPlaceholder text={w.lines[0]?.text ?? w.title} animate={false} className="h-20 w-14 shrink-0 rounded-lg" />
                <div className="flex-1">
                  <div className="font-kai text-lg">《{w.title}》</div>
                  <div className="text-sm text-mist">
                    {w.authorName} · {w.lines.length} 句{w.recitationUrl ? " · 🎙 有朗诵" : ""}
                  </div>
                </div>
                {w.score && (
                  <div className="shrink-0 text-right">
                    <span className="font-kai text-2xl text-cinnabar">{w.score.total}</span>
                    <span className="text-xs text-mist"> 分</span>
                  </div>
                )}
              </button>
              <div className="mt-2 flex items-center gap-4 border-t border-ink/5 pt-2 text-sm text-mist">
                <button onClick={() => toggleLike(w.id)} className={liked ? "text-cinnabar" : ""}>
                  {liked ? "♥" : "♡"} {w.likes}
                </button>
                <button onClick={() => setGateFor(w)}>↗ 分享</button>
                <span className="ml-auto text-xs">{w.theme ? `主题「${w.theme}」` : "自由创作"}</span>
              </div>
            </div>
          )
        })}
      </div>

      {toast && (
        <div className="absolute bottom-20 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm text-paper">
          {toast}
        </div>
      )}

      {playing && <Player work={playing} onClose={() => setPlaying(null)} />}

      {gateFor && (
        <ParentGate
          req={{ action: "分享作品", detail: `分享《${gateFor.title}》`, consentAction: "share", allowSession: true }}
          onPass={() => {
            const w = gateFor
            setGateFor(null)
            void share(w)
          }}
          onCancel={() => setGateFor(null)}
        />
      )}
    </div>
  )
}

function Player({ work, onClose }: { work: PoemWork; onClose: () => void }) {
  const [idx, setIdx] = useState(0)
  /** 本次播放里已判定"播不了"的句子（解码失败/blob 解析超时），退占位走定时翻页 */
  const [broken, setBroken] = useState<Record<number, boolean>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const line = work.lines[idx]
  const last = idx === work.lines.length - 1
  const isReal = realClip(line.clip) && !broken[idx]
  // 真片（idb: 指针）异步解析成 ObjectURL；mock/坏段传 undefined 直接走占位
  const src = useVideoUrl(isReal ? line.clip.videoUrl : undefined)

  // 三层兜底，保证播放器在任何坏状态下都不会卡死在一句上（评审确认过三种卡法）：
  // ① mock/坏段：固定时长翻页；
  // ② 真片 blob 解析超 6s（库被清了/IndexedDB 抽风）：标坏退占位；
  // ③ 真片在播但 ended 迟迟不来（autoplay 被拒、解码停摆）：12s 看门狗强制翻页
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    if (!isReal) {
      if (last) return
      t = setTimeout(() => setIdx(idx + 1), MOCK_CLIP_SEC * 1000)
    } else if (!src) {
      t = setTimeout(() => setBroken((b) => ({ ...b, [idx]: true })), 6000)
    } else {
      if (last) return
      t = setTimeout(() => setIdx(idx + 1), 12_000)
    }
    return () => clearTimeout(t)
  }, [idx, last, isReal, src])

  return (
    <div className="absolute inset-0 z-50 bg-paper">
      <button onClick={() => setIdx(last ? idx : idx + 1)} className="absolute inset-0 h-full w-full">
        <div key={idx} className="ink-appear h-full w-full">
          {src ? (
            <div className="relative h-full w-full overflow-hidden bg-paper">
              {/* muted：段本身无声（generate_audio:false），朗诵走独立 <audio>；静音同时保住 autoplay */}
              <video
                src={src}
                autoPlay
                muted
                playsInline
                onEnded={() => !last && setIdx(idx + 1)}
                onError={() => setBroken((b) => ({ ...b, [idx]: true }))}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <VerseOverlay text={line.text} />
            </div>
          ) : (
            <InkPlaceholder text={line.text} className="h-full w-full" />
          )}
        </div>
      </button>
      <header className="pointer-events-none absolute left-0 right-0 top-0 flex items-center gap-3 px-4 pt-5">
        <button onClick={onClose} className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full bg-paper/80 text-lg">
          ✕
        </button>
        <div className="rounded-full bg-paper/80 px-3 py-1 text-sm">
          《{work.title}》 {work.authorName} · {idx + 1}/{work.lines.length}
        </div>
      </header>
      {work.recitationUrl ? (
        <audio ref={audioRef} src={work.recitationUrl} autoPlay className="hidden" />
      ) : (
        <div className="pointer-events-none absolute bottom-6 left-0 right-0 text-center text-xs text-mist">
          {work.authorId === MY_AUTHOR_ID ? "这首没有保存朗诵音频" : "示例作品 · 无朗诵音频"}
        </div>
      )}
    </div>
  )
}
