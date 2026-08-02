// 短视频 App 式底栏：首页 / 分区 / ➕创作 / 创意工坊 / 我的。
// 中间 ➕ 直达卡片工坊（未登录先去登录页）——这个产品的创作方式只有一种，
// 不照抄抖音「拍摄/相册/直播」那层选择面板，多一层就是纯损耗。
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useCurrentUser } from "../hooks/useAccount";
import Icon, { type IconName } from "./Icon";

const TABS: ReadonlyArray<{ to: string; icon: IconName; label: string } | null> = [
  { to: "/", icon: "home", label: "首页" },
  { to: "/discover", icon: "compass", label: "分区" },
  null, // 中间 ➕ 占位
  { to: "/workshop", icon: "cards", label: "创意工坊" },
  { to: "/me", icon: "user", label: "我的" },
];

export default function TabBar() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  // 首页是全出血视频，底栏浮在渐变上而不是压一条实心板（对标抖音/TikTok/Reels）
  const onFeed = useLocation().pathname === "/";

  return (
    <nav
      className={`safe-bottom fixed inset-x-0 bottom-0 z-40 ${
        onFeed
          ? "bg-gradient-to-t from-black/85 via-black/45 to-transparent"
          : "border-t border-slate-800 bg-ink/95 backdrop-blur"
      }`}
    >
      {/* 固定 h-14：内容区的 padding-bottom 用同一个 --tabbar-h 计算，
          否则底栏（带安全区）比内容让出的高度更高，每页最后一行会被系统手势条盖住 */}
      <div className="mx-auto flex h-14 max-w-lg items-stretch justify-around px-2">
        {TABS.map((t) =>
          t ? (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                // 激活态用「描边→实心」而不是换色：品牌色留给 ➕ 和主 CTA，
                // 否则青蓝同时出现在激活 Tab、关注按钮、互动角标三处，➕ 的视觉权重被稀释
                `flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition ${
                  isActive ? "text-white" : onFeed ? "text-white/70" : "text-slate-500"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={t.icon} size={23} filled={isActive} />
                  <span>{t.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <button
              key="create"
              onClick={() => navigate(user ? "/studio" : "/login?next=/studio")}
              className="flex min-h-[44px] flex-1 items-center justify-center"
              aria-label="创作"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan-400 text-ink shadow-lg shadow-brand/30 transition active:scale-95">
                <Icon name="plus" size={26} strokeWidth={2.75} />
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
