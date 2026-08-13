import type { Difficulty, WorkScore } from "../types"
import { bankOf } from "../data/poems"
import { guessKeywords, hashStr } from "../utils/keywords"

// 打分（mock）：确定性规则打底，让"同一首永远同分"（排行榜可回归、不可玄学）。
// 真实实现换豆包 chat 按 rubric 打分——两条铁规矩先立在这：
// ① chat 必须显式 thinking:{type:"disabled"}，否则一次请求 52s（实测）；
// ② 打分维度、满分、评语口径由这份 rubric 单方面定义，LLM 只填数——
//    模型换代分数口径不能漂，不然排行榜前后不可比。
// 另：自定义（free）不打分不进榜——没有主题与难度约束的作品之间没有可比性，
// 硬排只会教会孩子"堆辞藻刷分"。这是产品规则，收口在 scoreWork 的入口处。

const IMAGERY_CHARS = "月星夜霜山河海水波桥雨风云虹日花叶树草鸟燕鹅鱼楼舟灯雪"

export function scoreWork(lines: string[], difficulty: Difficulty, theme?: string): WorkScore | undefined {
  if (difficulty === "free") return undefined

  const all = lines.join("")
  const seed = hashStr(all)

  // 切题（30）：句子里的意象词有多少落在主题词库里
  const bank = theme ? bankOf(theme) : undefined
  let onTopic = 15
  if (bank) {
    const bankChars = new Set((bank.imagery.join("") + bank.verbs.join("")).split(""))
    const hits = [...new Set(all.split(""))].filter((c) => bankChars.has(c)).length
    onTopic = Math.min(30, 12 + hits * 3)
  }

  // 意象（30）：出现多少种不同的画面元素（复用占位画面的词表，口径一致）
  const imgs = new Set(lines.flatMap((l) => guessKeywords(l)))
  const wildHits = [...all].filter((c) => IMAGERY_CHARS.includes(c)).length
  const imagery = Math.min(30, 10 + imgs.size * 4 + Math.min(6, wildHits))

  // 韵律（20）：字数齐整（全 5 或全 7）+ 四句成篇
  const lens = new Set(lines.map((l) => l.length))
  let rhythm = 8
  if (lens.size === 1 && (lines[0].length === 5 || lines[0].length === 7)) rhythm += 8
  if (lines.length === 4) rhythm += 4
  rhythm = Math.min(20, rhythm)

  // 心意（20）：确定性伪随机兜底——mock 里没有语义理解，真实现由 LLM 评"有没有自己的表达"
  const heart = 12 + (seed % 7)

  const dims: WorkScore["dims"] = [
    { name: "切题", score: onTopic, max: 30, comment: commentFor(onTopic / 30, "写的都在主题里", "有几句离主题有点远") },
    { name: "意象", score: imagery, max: 30, comment: commentFor(imagery / 30, "画面感很足，一句一景", "再多写点看得见的东西") },
    { name: "韵律", score: rhythm, max: 20, comment: commentFor(rhythm / 20, "字数齐整，读起来顺口", "每句字数一样会更好听") },
    { name: "心意", score: heart, max: 20, comment: commentFor(heart / 20, "有自己的小心思", "写写你自己的感觉") },
  ]
  return { total: dims.reduce((a, d) => a + d.score, 0), dims }
}

const commentFor = (ratio: number, good: string, meh: string): string => (ratio >= 0.75 ? good : meh)
