import { useEffect, type ReactNode } from "react"
import { AI_REAL } from "./ai"
import { loadClips } from "./data/clips"
import { TabBar } from "./components/TabBar"
import { ComposeHome } from "./pages/ComposeHome"
import { ComposeSession } from "./pages/ComposeSession"
import { Feed } from "./pages/Feed"
import { LearnList } from "./pages/LearnList"
import { LearnPlayer } from "./pages/LearnPlayer"
import { Me } from "./pages/Me"
import { useHashRoute } from "./router"

export function App() {
  const route = useHashRoute()
  const seg = route.split("/").filter(Boolean)
  // 内容库真片清单：启动拉一次，到货后各页面经 useClips 自动切到真视频
  useEffect(loadClips, [])

  let page: ReactNode
  let immersive = false // 沉浸页（学诗播放器/创作会话）不显示底栏
  if (seg[0] === "learn" && seg[1]) {
    page = <LearnPlayer poemId={seg[1]} key={seg[1]} />
    immersive = true
  } else if (seg[0] === "compose" && seg[1] === "w" && seg[2]) {
    page = <ComposeSession workId={seg[2]} key={seg[2]} />
    immersive = true
  } else if (seg[0] === "compose") {
    page = <ComposeHome />
  } else if (seg[0] === "feed") {
    page = <Feed />
  } else if (seg[0] === "me") {
    page = <Me />
  } else {
    page = <LearnList />
  }

  return (
    // 手机形态的演示容器：桌面浏览器里也收在一个"手机屏"宽度里看
    <div className="relative mx-auto h-full max-w-md overflow-hidden bg-paper shadow-2xl">
      {/* mock 是静默的（ideahub 教训）：没接真 AI 必须让每个人一眼看见 */}
      {!AI_REAL && (
        <div className="pointer-events-none absolute right-2 top-2 z-50 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] text-paper">
          演示模式 · 创作生成未接线
        </div>
      )}
      <main className="h-full">{page}</main>
      {!immersive && <TabBar route={route} />}
    </div>
  )
}
