// 短视频 App 式底栏：首页 / 分区 / ➕创作 / 创意工坊 / 我的。
// 中间 ➕ 进创作岔路口（未登录先去登录页）：工坊 / 工作流 / 简约三种方式差别足够大
// ——工坊要摆卡推演剧情，简约是一句话出片——直接把人扔进其中一种都是错的默认。
// （main 上曾是「➕ 直达卡片工坊、不做选择面板」，三模式落地后那个前提不再成立）
import { NavLink, useLocation, useNavigate } from "react-router";
import { useCurrentUser } from "../hooks/useAccount";
import Icon, { type IconName } from "./Icon";
import CharacterPerch, { usePerchBurst, type PerchPose } from "./CharacterPerch";
import CreatePerch, { useCreateBurst } from "./CreatePerch";

// pose 决定激活时角色的姿势【和】动效（见 CharacterPerch）。
// 每个 Tab 各不相同：挥手 / 张望 / 欢呼 / 托下巴 ——
// 四个 Tab 共用一套的话，切 Tab 的反馈就完全分不出切到了哪。
const TABS: ReadonlyArray<{ to: string; icon: IconName; label: string; pose: PerchPose } | null> = [
  { to: "/", icon: "home", label: "首页", pose: "home" },
  { to: "/discover", icon: "compass", label: "分区", pose: "explore" },
  null, // 中间 ➕ 占位
  { to: "/workshop", icon: "cards", label: "创意工坊", pose: "studio" },
  { to: "/me", icon: "user", label: "我的", pose: "mine" },
];

type Tab = NonNullable<(typeof TABS)[number]>;

/** 单个 Tab 的内容。
 *  ★ 必须拆成独立组件：usePerchBurst 是 Hook，而 NavLink 的 children 是
 *    render prop（每次渲染都是新调用），在里面调 Hook 违反 Hook 规则。 */
function TabInner({ tab, isActive }: { tab: Tab; isActive: boolean }) {
  // 切【到】这个 Tab 的那一下演一次；停在这个 Tab 上不会一直杵着（见 usePerchBurst）。
  // ref 初值取当前值，所以应用启动时停在首页也不会平白演一遍。
  const perchOn = usePerchBurst(isActive);
  return (
    <>
      {/* relative 只包图标：角色相对【图标】定位，包住文字会偏高。
          isolate：角色用负 z-index 沉到图标下面，需要独立层叠上下文兜住。 */}
      <span className="relative isolate flex items-center justify-center">
        {/* key={perchOn}：快速来回切 Tab 时若不换 key，元素不重挂载，动画不会重播 */}
        {perchOn > 0 && <CharacterPerch key={perchOn} pose={tab.pose} size={23} />}
        <Icon name={tab.icon} size={23} filled={isActive} />
      </span>
      <span>{tab.label}</span>
    </>
  );
}

export default function TabBar() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const path = useLocation().pathname;
  // 首页是全出血视频，底栏浮在渐变上而不是压一条实心板（对标抖音/TikTok/Reels）
  const onFeed = path === "/";
  // ➕ 上的看板娘：每换一个 Tab 随机抽一套演一遍（见 CreatePerch）。
  // ★ TabLayout 是常驻布局，切 Tab 时 TabBar 不重挂载——所以这个 hook 看得见路径变化。
  //   （若哪天把 TabBar 挪进各个页面里，每次切换都会重挂载，"上一次是哪一页"就丢了，
  //     首次挂载不演的判断随之失效，变成进任何页面都蹦一下。）
  const { token: createBurst, pose: createPose } = useCreateBurst(path);

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
              {({ isActive }) => <TabInner tab={t} isActive={isActive} />}
            </NavLink>
          ) : (
            <button
              key="create"
              onClick={() => navigate(user ? "/create" : "/login?next=/create")}
              className="flex min-h-[44px] flex-1 items-center justify-center"
              aria-label="创作"
            >
              {/* relative 只包圆钮：角色相对【按钮】定位。
                  isolate：角色用负 z-index 沉到按钮下面（"从按钮后面探出来"），
                  不给独立层叠上下文兜住的话，负 z-index 会一路穿到整条底栏背后。 */}
              <span className="relative isolate flex items-center justify-center">
                {/* key={createBurst}：连着切两次 Tab 时若不换 key，元素不重挂载，动画不会重播 */}
                {createBurst > 0 && <CreatePerch key={createBurst} pose={createPose} size={48} />}
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan-400 text-ink shadow-lg shadow-brand/30 transition active:scale-95">
                  <Icon name="plus" size={26} strokeWidth={2.75} />
                </span>
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
