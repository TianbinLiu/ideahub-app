// 短视频 App 式底栏：首页 / 分区 / ➕创作 / 创意工坊 / 我的。
// 中间 ➕ 直接进 /create，**登录与否由路由那层的 RequireAuth 一处说了算**：
// 这里原来写的是 `navigate(user ? "/create" : "/login?next=/create")`，等于把同一道
// 登录门禁判了两遍，而这一遍还判得更早 —— 冷启动后会话还在水合时 `user` 是 null，
// 于是登录着的用户被弹去登录页，读起来就是"我被登出了"（2026-08-20 真机）。
// RequireAuth 未登录时同样带 next=/create 回跳，用户看到的东西一点没少（铁律六）。
// 创作岔路口：工坊 / 工作流 / 简约三种方式差别足够大
// ——工坊要摆卡推演剧情，简约是一句话出片——直接把人扔进其中一种都是错的默认。
// （main 上曾是「➕ 直达卡片工坊、不做选择面板」，三模式落地后那个前提不再成立）
import { NavLink, useLocation, useNavigate } from "react-router";
import Icon, { type IconName } from "./Icon";
import CharacterPerch, { usePerchBurst, type PerchPose } from "./CharacterPerch";
import CreatePerch from "./CreatePerch";

// pose 决定激活时角色的姿势【和】动效（见 CharacterPerch）。
// 每个 Tab 各不相同：挥手 / 张望 / 欢呼 / 托下巴 ——
// 四个 Tab 共用一套的话，切 Tab 的反馈就完全分不出切到了哪。
const TABS: ReadonlyArray<{ to: string; icon: IconName; label: string; pose: PerchPose } | null> = [
  { to: "/", icon: "home", label: "首页", pose: "home" },
  { to: "/discover", icon: "compass", label: "分区", pose: "explore" },
  null, // 中间 ➕ 占位
  { to: "/workshop", icon: "cards", label: "工坊", pose: "studio" },
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
  const path = useLocation().pathname;
  // 首页是全出血视频，底栏浮在渐变上而不是压一条实心板（对标抖音/TikTok/Reels）
  const onFeed = path === "/";
  // ➕ 上那只宠物的动作由它自己的定时器驱动（见 CreatePerch），这里只把当前路径递给它
  // ——切 Tab 时立刻演一个。
  // ★ TabLayout 是常驻布局，切 Tab 时 TabBar 不重挂载，所以宠物的定时器不会被打断。
  //   （若哪天把 TabBar 挪进各个页面里，每次切换都会重挂载，自发动作的节奏就没了，
  //     而且"上一次在哪一页"也会丢，变成进任何页面都演一遍。）

  return (
    <nav
      /* data-tabbar：首页进沉浸/全屏时 body[data-immersive] 靠它把底栏一并收掉
         （见 index.css）。底栏不归 FeedPage 渲染，只能这样跨层通知 */
      data-tabbar
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
              onClick={() => navigate("/create")}
              className="flex min-h-[44px] flex-1 items-center justify-center"
              aria-label="创作"
            >
              {/* ★★ 她和按钮是**并排**，不再是"她站在按钮背后、手搭在按钮上沿"。
                  改的原因是实测出来的一个硬伤：叠着放时她要从按钮上沿再往上探出一截，
                  整只角色的顶沿落在离屏幕底约 98px 处，而首页的进度条在 50px、
                  时长文字在 72–86px —— 她**正好压在进度条和时长上**，
                  看视频时被一个装饰挡住播放进度，代价远大于那点萌感。
                  并排之后整组高 40px，完整收在 56px 的底栏里，一点都不往上戳。

                  isolate 仍然要：她用负 z-index 沉到按钮下面（并排也留了一点重叠，
                  见 -mr-2），不给独立层叠上下文兜住的话负 z-index 会一路穿到整条底栏背后。
                  items-end：两者底沿对齐，读作"站在同一层地板上"。 */}
              <span className="relative isolate flex items-end">
                {/* ★ 她需要一个**属于自己的定位盒**，不能直接用 left/right 贴到按钮边上：
                    CreatePerch 内部是 left-1/2 + translateX(-50%) 居中的，而
                    index.css 的 prefers-reduced-motion 分支把 `.perch-pop` 的
                    transform 写死成了 translateX(-50%) —— 换成贴边定位，
                    开了"减少动态效果"的机器上她会整体右移半个身位。
                    盒子高 40px = 38 × (209/200)，取 idle 那张最高的贴图，
                    换成矮一点的姿势（cheer 195）时她仍然站在同一条地板线上。 */}
                <span className="relative -mr-2 block h-10 w-[38px]">
                  {/* 常驻宠物：一直轻轻呼吸，每隔几秒自己演一个动作，切 Tab 也立刻演一个。
                      -mr-2（8px）的重叠是量的：她的手画在贴图横向 35%–65% 处，
                      38px 宽下就是 13–25px。重叠 8px 时按钮左沿落在 30px，
                      刚好压住她的右袖口 —— 有接触感，又没把手盖掉。
                      再多（≥14px）按钮就骑到手上，等于退回"藏在按钮后面"那一版。 */}
                  <CreatePerch pathKey={path} width={38} bottom={0} />
                </span>
                {/* ★ 按钮本身按工坊主题重画：品牌青渐变 + 一圈金色符文环 + 青色辉光。
                    原来是一颗纯青蓝的实心圆钮（安卓 FAB 的默认长相），和 app 里
                    "魔法书房 / 金色符文法阵 / 塔罗牌"那套视觉没有任何关系。
                    34 → 28 是这次再缩的一档：并排之后两者横向要一起塞进
                    五分之一条底栏（390px 屏上约 75px），38 + 28 − 8 = 58px 正好；
                    加号仍是矢量，15px 下依然锐利。 */}
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand to-cyan-400 text-ink shadow-[0_0_14px_rgba(34,211,238,0.5)] ring-1 ring-gold/70 transition active:scale-90">
                  {/* 内圈高光：让实心圆读成"一枚有厚度的印记"，而不是一块色卡 */}
                  <span className="pointer-events-none absolute inset-[2px] rounded-full bg-gradient-to-b from-white/35 to-transparent" />
                  <Icon name="plus" size={15} strokeWidth={3} className="relative" />
                </span>
              </span>
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
