import { useState } from "react"
import type { ClipSeg } from "../data/clips"
import { InkPlaceholder } from "./InkPlaceholder"
import { VerseOverlay } from "./VerseOverlay"

// 一句诗的"舞台"：有真视频段就放真片，没有（或播放失败）就退回水墨占位。
// ★ 真片字幕层在视频上面叠 VerseOverlay——真视频里没有烧字，字幕永远由 App 渲染：
//   将来做跟读逐字高亮、调字号、换语言，都不用重炼视频。
//
// video 属性的取舍：
// - muted：管线 generate_audio:false，段本来就无声；muted 同时保证 autoplay 不被浏览器拦。
// - loop：孩子跟读一句的时长不定，段放完就循环，直到念对翻页。
// - 不 await 任何媒体事件（主仓铁律：后台标签页里它们永不到达）——
//   poster 先顶住画面，onError 才切占位，中间状态无需 JS 参与。

interface Props {
  text: string
  keywords?: string[]
  gloss?: string
  seg?: ClipSeg | null
  className?: string
}

export function LineStage({ text, keywords, gloss, seg, className = "" }: Props) {
  const [broken, setBroken] = useState(false)
  if (!seg || broken) {
    return <InkPlaceholder text={text} keywords={keywords} gloss={gloss} className={className} />
  }
  return (
    <div className={`relative overflow-hidden bg-paper ${className}`}>
      <video
        src={seg.video}
        poster={seg.poster}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setBroken(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <VerseOverlay text={text} gloss={gloss} />
    </div>
  )
}
