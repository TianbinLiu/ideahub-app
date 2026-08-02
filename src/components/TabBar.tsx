// 短视频 App 式底栏：首页 / 分区 / ➕创作 / 创意工坊 / 我的。
// 中间 ➕ 直达卡片工坊（未登录先去登录页）。
import { NavLink, useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useAccount";

const TABS = [
  { to: "/", icon: "🏠", label: "首页" },
  { to: "/discover", icon: "🧭", label: "分区" },
  null, // 中间 ➕ 占位
  { to: "/workshop", icon: "🎴", label: "创意工坊" },
  { to: "/me", icon: "👤", label: "我的" },
] as const;

export default function TabBar() {
  const navigate = useNavigate();
  const user = useCurrentUser();

  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-ink/95 backdrop-blur">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5">
        {TABS.map((t) =>
          t ? (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] transition ${
                  isActive ? "text-brand" : "text-slate-500"
                }`
              }
            >
              <span className="text-lg leading-none">{t.icon}</span>
              <span>{t.label}</span>
            </NavLink>
          ) : (
            <button
              key="create"
              onClick={() => navigate(user ? "/studio" : "/login?next=/studio")}
              className="flex flex-1 items-center justify-center py-1"
              aria-label="创作"
            >
              <span className="flex h-9 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-cyan-400 text-xl font-bold text-ink shadow-lg shadow-brand/25">
                ＋
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
