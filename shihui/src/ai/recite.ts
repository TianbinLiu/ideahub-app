// 朗诵：范读（TTS）+ 跟读识别（ASR）+ 判定。
//
// 骨架用 Web Speech API 演示闭环。真实产品必须换火山 openspeech 流式识别：
// ① Chrome 的识别走 Google 服务，国内真机大概率不可用；② WebView 里权限与实现都不稳。
// 所以 ASR 从第一天就要设计成"可降级"：识别不可用/不匹配 3 次 → 亮「我念完了」手动放行。
// 学习产品里卡住孩子一次，比放过一次假朗诵伤害大得多——判定从宽是产品决策不是技术妥协。

// lib.dom 没有 SpeechRecognition 类型，声明够用的最小面
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}

const recognitionCtor = (): (new () => SpeechRecognitionLike) | undefined => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined
}

export const reciteSupported = (): boolean => !!recognitionCtor()

export interface ReciteSession {
  stop: () => void
}

/**
 * 开始听孩子念。onHeard 每次拿到"到目前为止听到的全部内容"（含中间结果），
 * 由调用方拿去 reciteMatch 判定；onEnd 在识别自然结束/出错时回调（出错也要响，不静默）。
 */
export function startRecite(
  onHeard: (heard: string) => void,
  onEnd: (error?: string) => void,
): ReciteSession | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = "zh-CN"
  rec.continuous = true
  rec.interimResults = true
  let full = ""
  let stopped = false
  rec.onresult = (e) => {
    let interim = ""
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) full += r[0].transcript
      else interim += r[0].transcript
    }
    onHeard(full + interim)
  }
  rec.onerror = (e) => {
    if (!stopped) onEnd(e.error ?? "recognition-error")
  }
  rec.onend = () => {
    if (!stopped) onEnd()
  }
  try {
    rec.start()
  } catch {
    return null
  }
  return {
    stop: () => {
      stopped = true
      try {
        rec.stop()
      } catch {
        /* 已停 */
      }
    },
  }
}

/**
 * 朗诵判定：目标句与听到的内容做多重集字符匹配，返回命中率 0~1。
 * 不用编辑距离：同音字误识（"霜"→"双"）在孩子的语速下非常常见，
 * 严格顺序匹配会把真念对的判错。0.6 阈值 = "念了大半"，宁松勿严。
 */
export function reciteMatch(target: string, heard: string): number {
  const clean = (s: string) => s.replace(/[^一-鿿]/g, "")
  const t = clean(target)
  const h = clean(heard)
  if (!t) return 0
  const pool = new Map<string, number>()
  for (const c of h) pool.set(c, (pool.get(c) ?? 0) + 1)
  let hit = 0
  for (const c of t) {
    const n = pool.get(c) ?? 0
    if (n > 0) {
      hit++
      pool.set(c, n - 1)
    }
  }
  return hit / t.length
}

export const MATCH_THRESHOLD = 0.6

// ---- 范读（TTS）----
// 真实产品换火山 openspeech TTS（注意：方舟没有 TTS，是另一条产品线另配凭证）。
// 已知坑（ideahub 踩过）：浏览器的语音表在进程启动时枚举一次，系统没装中文语音包
// 就是"嘴动没声"，装完必须完全退出浏览器再开。
export const ttsSupported = (): boolean => "speechSynthesis" in window

export function speakLine(text: string, onDone?: () => void): void {
  if (!ttsSupported()) {
    onDone?.()
    return
  }
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = "zh-CN"
  u.rate = 0.75 // 给孩子跟读留出口型时间，量过 1.0 明显太快
  const zh = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith("zh"))
  if (zh) u.voice = zh
  if (onDone) {
    u.onend = onDone
    u.onerror = onDone
  }
  speechSynthesis.speak(u)
}
