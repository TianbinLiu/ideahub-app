import { useEffect, useRef, useState } from "react"
import { genLineClip } from "../ai"
import { scoreWork } from "../ai/score"
import { InkPlaceholder } from "../components/InkPlaceholder"
import { bankOf } from "../data/poems"
import { canAddLine, useShihui } from "../data/store"
import { nav } from "../router"
import { realClip } from "../types"

// 创作会话：写一句 → 生成这一句的画面 → 才能写下一句（承接门禁在 store.canAddLine，唯一实现）。
// 三个小阶段：write（逐句写）→ finish（起名 + 朗诵录音）→ result（打分 + 发布）。

type Stage = "write" | "finish" | "result"
const MAX_LINES = 8
const MAX_CHARS = 9

export function ComposeSession({ workId }: { workId: string }) {
  const work = useShihui((s) => s.works.find((w) => w.id === workId))
  const spendGeneration = useShihui((s) => s.spendGeneration)
  const refundGeneration = useShihui((s) => s.refundGeneration)
  const appendLine = useShihui((s) => s.appendLine)
  const setLineClip = useShihui((s) => s.setLineClip)
  const finishWork = useShihui((s) => s.finishWork)
  const publishWork = useShihui((s) => s.publishWork)

  const [stage, setStage] = useState<Stage>("write")
  const [draft, setDraft] = useState("")
  const [err, setErr] = useState<string | null>(null)
  /** 每句的生成进度文案（真生成一句要 60-90s，必须让孩子知道炉子没熄） */
  const [progress, setProgress] = useState<Record<number, string>>({})
  const [title, setTitle] = useState("")
  const [recState, setRecState] = useState<"idle" | "recording" | "done">("idle")
  const [recUrl, setRecUrl] = useState<string | null>(null)
  const [published, setPublished] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(
    () => () => {
      const rec = recorderRef.current
      if (rec && rec.state !== "inactive") rec.stop()
      rec?.stream.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  if (!work) {
    nav("/compose")
    return null
  }
  const bank = work.theme ? bankOf(work.theme) : undefined
  const ready = canAddLine(work)

  const onGenerate = () => {
    const text = draft.trim()
    if (!text) return
    const spend = spendGeneration()
    if (!spend.ok) {
      setErr(spend.reason ?? "暂时不能生成")
      return
    }
    setErr(null)
    const lineIdx = work.lines.length
    appendLine(work.id, text)
    setDraft("")
    const prevTail = work.lines[lineIdx - 1]?.clip.tailFrame
    genLineClip(text, prevTail, (msg) => setProgress((p) => ({ ...p, [lineIdx]: msg })))
      .then((clip) => setLineClip(work.id, lineIdx, clip))
      .catch((e: unknown) => {
        // 失败要响且局部：这一句标失败给重试按钮，不整页崩。
        // real.ts 的翻译层保证 e.message 已是童向文案，这里原样展示，别再包一层；
        // 失败退费（敏感词必败也照扣、重试再扣，是评审确认的双重收费）
        refundGeneration()
        setLineClip(work.id, lineIdx, { status: "failed", videoUrl: "" })
        setErr(e instanceof Error ? e.message : "这一句的画面没画出来，点那一句上的「重画」再试")
      })
  }

  const onRetry = (lineIdx: number) => {
    const spend = spendGeneration()
    if (!spend.ok) {
      setErr(spend.reason ?? "暂时不能生成")
      return
    }
    setErr(null)
    setLineClip(work.id, lineIdx, { status: "generating", videoUrl: "" })
    genLineClip(work.lines[lineIdx].text, work.lines[lineIdx - 1]?.clip.tailFrame, (msg) =>
      setProgress((p) => ({ ...p, [lineIdx]: msg })),
    )
      .then((clip) => setLineClip(work.id, lineIdx, clip))
      .catch((e: unknown) => {
        refundGeneration()
        setLineClip(work.id, lineIdx, { status: "failed", videoUrl: "" })
        setErr(e instanceof Error ? e.message : "还是没画出来，稍后再试试")
      })
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => chunksRef.current.push(e.data)
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType })
        setRecUrl(URL.createObjectURL(blob))
        setRecState("done")
        stream.getTracks().forEach((t) => t.stop())
      }
      recorderRef.current = rec
      rec.start()
      setRecState("recording")
      setErr(null)
    } catch {
      setErr("没拿到麦克风权限——可以先跳过朗诵，直接完成")
    }
  }

  const onFinish = () => {
    finishWork(work.id, {
      title: title.trim() || "无题",
      recitationUrl: recUrl ?? undefined,
      score: scoreWork(
        work.lines.map((l) => l.text),
        work.difficulty,
        work.theme,
      ),
    })
    setStage("result")
  }

  const header = (
    <header className="flex items-center gap-3 px-4 pb-3 pt-5">
      <button onClick={() => nav("/compose")} className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-lg">
        ←
      </button>
      <div className="font-kai text-lg">{work.theme ? `主题「${work.theme}」` : "自由创作"}</div>
      <div className="ml-auto text-xs text-mist">{work.lines.length}/{MAX_LINES} 句</div>
    </header>
  )

  // —— 阶段三:打分与发布 ——
  if (stage === "result") {
    const w = useShihui.getState().works.find((x) => x.id === workId)
    const score = w?.score
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-20">
          <div className="text-center font-kai text-2xl">《{w?.title}》</div>
          {score ? (
            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
              <div className="text-center">
                <span className="font-kai text-5xl text-cinnabar">{score.total}</span>
                <span className="text-mist"> / 100</span>
              </div>
              <div className="mt-3 space-y-2">
                {score.dims.map((d) => (
                  <div key={d.name} className="flex items-baseline gap-2 text-sm">
                    <span className="w-10 shrink-0 font-medium">{d.name}</span>
                    <span className="w-12 shrink-0 text-cinnabar">
                      {d.score}/{d.max}
                    </span>
                    <span className="text-mist">{d.comment}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-ink/10 bg-white/50 p-4 text-center text-sm text-mist">
              自由创作不打分、不进排行榜——没有同一把尺子，比出来的名次没有意义
            </div>
          )}
          {published ? (
            <div className="text-center text-cinnabar">已发布到广场 ✓</div>
          ) : (
            <button
              onClick={() => {
                publishWork(work.id)
                setPublished(true)
                nav("/feed")
              }}
              className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper"
            >
              发布到广场
            </button>
          )}
          <button onClick={() => nav("/compose")} className="w-full py-2 text-sm text-mist">
            先存着，回创作页
          </button>
          <p className="text-center text-xs text-mist">
            骨架提示：真实产品发布前必须过「家长确认 + 内容审核」两道门（孩子的声音是敏感个人信息）
          </p>
        </div>
      </div>
    )
  }

  // —— 阶段二:起名 + 朗诵 ——
  if (stage === "finish") {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-20">
          <div className="rounded-2xl border border-ink/10 bg-white/50 p-4">
            {work.lines.map((l, i) => (
              <div key={i} className="py-0.5 text-center font-kai text-xl">
                {l.text}
              </div>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={8}
            placeholder="给这首诗起个名字"
            className="w-full rounded-xl border border-ink/15 bg-white/60 px-4 py-3 text-center font-kai text-lg outline-none focus:border-cinnabar"
          />
          <div className="rounded-2xl border border-ink/10 bg-white/50 p-4 text-center">
            <div className="pb-2 text-sm text-mist">朗诵一遍，让别人边听边看你的诗（可以跳过）</div>
            {recState === "recording" ? (
              <button onClick={() => recorderRef.current?.stop()} className="rounded-full bg-cinnabar px-6 py-2.5 text-paper">
                ⏹ 念完了
              </button>
            ) : (
              <div className="space-y-2">
                {recUrl && <audio controls src={recUrl} className="mx-auto w-full" />}
                <button onClick={startRecording} className="rounded-full border border-cinnabar px-6 py-2.5 text-cinnabar">
                  🎤 {recUrl ? "重新朗诵" : "开始朗诵"}
                </button>
              </div>
            )}
          </div>
          {err && <div className="text-center text-sm text-cinnabar">{err}</div>}
          <button onClick={onFinish} className="w-full rounded-full bg-cinnabar py-3.5 text-lg text-paper">
            {work.difficulty === "free" ? "完成 →" : "完成，看打分 →"}
          </button>
        </div>
      </div>
    )
  }

  // —— 阶段一:逐句写 ——
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-20">
        {work.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-white/40 p-2.5">
            {/* 真片有捕获的尾帧就当缩略图（真实画面）；mock/无尾帧退回水墨占位 */}
            {realClip(l.clip) && l.clip.tailFrame ? (
              <img src={l.clip.tailFrame} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <InkPlaceholder
                text={l.text}
                animate={i === work.lines.length - 1 && l.clip.status === "ready"}
                className="h-24 w-16 shrink-0 rounded-lg"
              />
            )}
            <div className="flex-1">
              <div className="font-kai text-lg">{l.text}</div>
              {l.clip.status === "generating" && (
                <div className="animate-pulse text-sm text-mist">🖌️ {progress[i] ?? "这一句的画面生成中…"}</div>
              )}
              {l.clip.status === "failed" && (
                <button onClick={() => onRetry(i)} className="text-sm text-cinnabar underline underline-offset-2">
                  没画出来 · 重画
                </button>
              )}
            </div>
          </div>
        ))}

        {/* ★ 报错必须画在编辑器块外面：生成失败时 ready=false、编辑器整块隐藏，
            报错写在里面就是"设了 err 却永远看不见"（评审的反驳者自己挖出来的） */}
        {err && <p className="text-center text-sm text-cinnabar">{err}</p>}

        {!ready && work.lines.length > 0 && (
          <p className="text-center text-xs text-mist">上一句的画面好了才能写下一句——每段画面要接着上一段的结尾画</p>
        )}

        {ready && work.lines.length < MAX_LINES && (
          <div className="rounded-2xl border border-cinnabar/40 bg-white/60 p-4">
            <div className="pb-2 text-sm text-mist">第 {work.lines.length + 1} 句</div>
            {bank && work.difficulty === "assemble" ? (
              <>
                <div className="min-h-11 rounded-lg bg-paper px-3 py-2 font-kai text-xl">
                  {draft || <span className="text-base text-mist">点下面的词语拼一句（5~7 个字最好）</span>}
                </div>
                <div className="flex justify-end gap-3 py-2 text-sm text-mist">
                  <button onClick={() => setDraft(draft.slice(0, -1))}>⌫ 退一字</button>
                  <button onClick={() => setDraft("")}>清空</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[...bank.imagery, ...bank.verbs].map((wd) => (
                    <button
                      key={wd}
                      onClick={() => draft.length + wd.length <= MAX_CHARS && setDraft(draft + wd)}
                      className="rounded-full bg-ink/5 px-3 py-1.5 font-kai active:bg-cinnabar/15"
                    >
                      {wd}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
                placeholder={work.theme ? `写一句关于「${work.theme}」的诗` : "写你想写的一句"}
                className="w-full rounded-lg border border-ink/15 bg-paper px-3 py-2.5 font-kai text-xl outline-none focus:border-cinnabar"
              />
            )}
            <button
              onClick={onGenerate}
              disabled={!draft.trim()}
              className="mt-3 w-full rounded-full bg-cinnabar py-3 text-paper disabled:opacity-40"
            >
              🖌️ 画出这一句
            </button>
          </div>
        )}

        {ready && work.lines.length >= 2 && (
          <button onClick={() => setStage("finish")} className="w-full rounded-full border-2 border-cinnabar py-3 text-lg text-cinnabar">
            这首诗写完了 →
          </button>
        )}
      </div>
    </div>
  )
}
