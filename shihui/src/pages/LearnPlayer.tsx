import { useEffect, useRef, useState } from "react"
import { MATCH_THRESHOLD, reciteMatch, reciteSupported, speakLine, startRecite, type ReciteSession } from "../ai/recite"
import { LineStage } from "../components/LineStage"
import { MicConsent } from "../components/MicConsent"
import { useClips } from "../data/clips"
import { hasVoiceCaptureConsent, useGuardian } from "../data/guardian"
import { poemById } from "../data/poems"
import { useShihui } from "../data/store"
import { nav } from "../router"

// 学诗核心页：一句 = 一段画面。范读 → 跟读 → 念对了画面翻到下一句。
// 「我念完了」的手动放行常驻可见：ASR 不可用（骨架用 Web Speech，国内真机基本没有）
// 或识别不准时，孩子不能被卡死在一句上——学习产品里"卡住"比"放水"伤害大。

type Phase = "idle" | "listening" | "matched" | "done"

export function LearnPlayer({ poemId }: { poemId: string }) {
  const poem = poemById(poemId)
  const segs = useClips(poemId)
  const setLearnLine = useShihui((s) => s.setLearnLine)
  const completeLearn = useShihui((s) => s.completeLearn)

  // 学完过的重进从头读；没学完的接着上次的句子
  const [idx, setIdx] = useState(() => {
    const st = useShihui.getState().learn[poemId]
    return st?.completedAt ? 0 : (st?.lineIdx ?? 0)
  })
  const [phase, setPhase] = useState<Phase>("idle")
  const [heard, setHeard] = useState("")
  const [hint, setHint] = useState<string | null>(null)
  const [gained, setGained] = useState(0)
  const [micAsk, setMicAsk] = useState(false)
  const sessionRef = useRef<ReciteSession | null>(null)
  const phaseRef = useRef<Phase>("idle")
  phaseRef.current = phase

  useEffect(
    () => () => {
      sessionRef.current?.stop()
      if ("speechSynthesis" in window) speechSynthesis.cancel()
    },
    [],
  )

  if (!poem) {
    nav("/")
    return null
  }
  const line = poem.lines[idx]
  const last = idx === poem.lines.length - 1

  const stopListening = () => {
    sessionRef.current?.stop()
    sessionRef.current = null
  }

  const advance = () => {
    stopListening()
    setHeard("")
    setHint(null)
    if (last) {
      setGained(completeLearn(poem.id))
      setPhase("done")
    } else {
      setIdx(idx + 1)
      setLearnLine(poem.id, idx + 1)
      setPhase("idle")
    }
  }

  // 念对后停 900ms 再翻页：让孩子看见"念对啦"的反馈，立刻翻会像 bug
  useEffect(() => {
    if (phase !== "matched") return
    const t = setTimeout(advance, 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const startListening = () => {
    // 首次开麦的采集侧同意（义务在首次采集不在首次发布，见 MicConsent 头注释）。
    // ★ 读实时 state 而不是订阅值：onAllow 同步回调进来时订阅闭包还是旧值，会无限弹页
    if (!hasVoiceCaptureConsent(useGuardian.getState().consents)) {
      setMicAsk(true)
      return
    }
    setHint(null)
    setHeard("")
    const session = startRecite(
      (h) => {
        setHeard(h)
        if (phaseRef.current === "listening" && reciteMatch(line.text, h) >= MATCH_THRESHOLD) {
          stopListening()
          setPhase("matched")
        }
      },
      (err) => {
        if (phaseRef.current !== "listening") return
        setPhase("idle")
        setHint(err ? "没听清楚，再试一次，或点下面的「我念完了」" : "再念一次试试？或点「我念完了」")
      },
    )
    if (!session) {
      setHint("这台设备用不了语音识别，念完后点「我念完了」就行")
      return
    }
    sessionRef.current = session
    setPhase("listening")
  }

  if (phase === "done") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="text-5xl">🎉</div>
        <div className="font-kai text-2xl">学完了《{poem.title}》</div>
        {gained > 0 && <div className="text-cinnabar">小任务完成 +{gained} 积分</div>}
        <div className="mt-4 flex w-full flex-col gap-3">
          <button
            onClick={() => {
              setIdx(0)
              setPhase("idle")
            }}
            className="rounded-full border border-ink/15 py-3"
          >
            再读一遍
          </button>
          <button onClick={() => nav("/compose")} className="rounded-full bg-cinnabar py-3 text-paper">
            去写一首「{poem.theme}」的诗 →
          </button>
          <button onClick={() => nav("/")} className="py-2 text-sm text-mist">
            回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {/* key=idx：换句时重挂载，走一遍 ink-appear 入场——真片模式下这 0.9s 恰好盖住
          video 首帧解码的空窗（poster 先顶着），弱机上不至于闪白 */}
      <div key={idx} className="ink-appear absolute inset-0">
        <LineStage text={line.text} keywords={line.keywords} gloss={line.gloss} seg={segs?.[idx]} className="h-full w-full" />
      </div>
      {/* 预载下一段：跟读判定平均要十几秒，足够悄悄拉完下一段的 5s 视频 */}
      {segs?.[idx + 1] && <video src={segs[idx + 1].video} preload="auto" muted className="hidden" />}

      <header className="absolute left-0 right-0 top-0 flex items-center gap-3 px-4 pt-5">
        <button onClick={() => nav("/")} className="flex h-9 w-9 items-center justify-center rounded-full bg-paper/80 text-lg">
          ←
        </button>
        <div className="rounded-full bg-paper/80 px-3 py-1 text-sm">
          《{poem.title}》 {idx + 1}/{poem.lines.length}
        </div>
      </header>

      {micAsk && (
        <MicConsent
          purpose="跟读识别"
          onAllow={() => {
            setMicAsk(false)
            startListening()
          }}
          onDeny={() => {
            setMicAsk(false)
            setHint("不用麦克风也行：念完点下面的「我念完了」")
          }}
        />
      )}

      {phase === "matched" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="ink-appear rounded-2xl bg-paper/90 px-8 py-5 font-kai text-2xl text-cinnabar shadow-lg">
            ✨ 念对啦！
          </div>
        </div>
      )}

      <footer className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-paper via-paper/90 to-transparent px-5 pb-5 pt-10">
        <div className="mb-3 flex justify-center gap-2">
          {poem.lines.map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i < idx ? "bg-cinnabar" : i === idx ? "border border-cinnabar bg-transparent" : "bg-ink/15"}`}
            />
          ))}
        </div>

        {phase === "listening" ? (
          <div className="space-y-3 text-center">
            <div className="text-sm text-cinnabar">🎤 正在听你念这一句…</div>
            <div className="min-h-6 font-kai text-lg text-mist">{heard || "……"}</div>
            <button onClick={() => { stopListening(); setPhase("idle") }} className="rounded-full border border-ink/15 px-6 py-2 text-sm">
              先不念了
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {hint && <div className="text-center text-sm text-cinnabar">{hint}</div>}
            <div className="flex gap-3">
              <button
                onClick={() => speakLine(line.text)}
                className="flex-1 rounded-full border border-ink/20 bg-white/50 py-3 text-lg"
              >
                🔊 听范读
              </button>
              <button onClick={startListening} className="flex-1 rounded-full bg-cinnabar py-3 text-lg text-paper">
                🎤 我来念
              </button>
            </div>
            <button onClick={advance} className="w-full py-1 text-center text-sm text-mist underline underline-offset-4">
              我念完了{reciteSupported() ? "（不用麦克风）" : ""} · {last ? "完成" : "下一句"}
            </button>
          </div>
        )}
      </footer>
    </div>
  )
}
