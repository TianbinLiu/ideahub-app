// 竖排诗句 + 朱印 + 白话释义的字幕层。
// 水墨占位（InkPlaceholder）与真视频（LineStage）共用同一份——字幕的排版规则只能有一处实现，
// 否则占位和真片切换时字会"跳一下"。

export function VerseOverlay({ text, gloss }: { text: string; gloss?: string }) {
  return (
    <>
      <div className="pointer-events-none absolute right-5 top-6 flex flex-col items-center gap-3">
        <div className="v-text font-kai text-3xl text-ink drop-shadow-sm" style={{ maxHeight: "70%" }}>
          {text}
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-cinnabar font-kai text-sm text-paper opacity-90">
          诗
        </div>
      </div>
      {gloss && (
        <div className="pointer-events-none absolute bottom-4 left-4 right-16 rounded-lg bg-paper/80 px-3 py-2 text-sm text-mist backdrop-blur-[2px]">
          {gloss}
        </div>
      )}
    </>
  )
}
