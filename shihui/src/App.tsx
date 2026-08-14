import { useEffect, useState, type ReactNode } from "react"
import { AI_REAL } from "./ai"
import { UpdateSheet } from "./components/UpdateSheet"
import { checkUpdateForPrompt, type UpdateInfo } from "./data/appUpdate"
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
      <RestReminder />
      <UpdatePrompt />
    </div>
  )
}

/** 启动 3 秒后查一次新版（避开首屏抢带宽；浏览器/未配清单地址时整个功能静默关闭） */
function UpdatePrompt() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      void checkUpdateForPrompt().then(setInfo)
    }, 3000)
    return () => clearTimeout(t)
  }, [])
  if (!info || closed) return null
  return <UpdateSheet info={info} onClose={() => setClosed(true)} />
}

/**
 * 时长提醒（薄版）：连续使用满 30 分钟弹全屏休息提示。
 * ★ 时序是上架门槛不是增强项（设计评审确认）：未保法第 74 条对儿童向音视频/社交服务
 *   要求时间管理能力，必须与广场同批上线。精细化（家长可调时长、宵禁）在家长中心后续接。
 */
function RestReminder() {
  const [minutes, setMinutes] = useState(0)
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setInterval(() => {
      // 只数看得见的时间：后台挂着不算"在用"
      if (document.visibilityState === "visible") setMinutes((m) => m + 1)
    }, 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (minutes >= 30) {
      setShow(true)
      setMinutes(0)
    }
  }, [minutes])
  if (!show) return null
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-paper px-8 text-center">
      <div className="text-5xl">🌙</div>
      <div className="font-kai text-2xl">看了好一会儿啦</div>
      <p className="text-sm text-mist">闭上眼睛数十下，看看窗外远处的树，让眼睛休息一下吧。</p>
      <button onClick={() => setShow(false)} className="mt-2 rounded-full bg-cinnabar px-8 py-3 text-paper">
        好，休息过啦
      </button>
    </div>
  )
}
