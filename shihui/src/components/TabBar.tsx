import { nav } from "../router"

const TABS = [
  { path: "/", icon: "📖", label: "学诗" },
  { path: "/compose", icon: "✍️", label: "创作" },
  { path: "/feed", icon: "🏮", label: "广场" },
  { path: "/me", icon: "👤", label: "我的" },
]

export function TabBar({ route }: { route: string }) {
  const activeOf = (p: string) => (p === "/" ? route === "/" : route.startsWith(p))
  return (
    <nav className="absolute bottom-0 left-0 right-0 z-40 flex h-14 border-t border-ink/10 bg-paper/95">
      {TABS.map((t) => {
        const active = activeOf(t.path)
        return (
          <button
            key={t.path}
            onClick={() => nav(t.path)}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs ${
              active ? "text-cinnabar" : "text-mist"
            }`}
          >
            <span className="text-lg leading-none">{t.icon}</span>
            <span className={active ? "font-medium" : ""}>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
