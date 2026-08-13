import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import FeedPage from "./pages/FeedPage";
import DiscoverPage from "./pages/DiscoverPage";
import WorkshopPage from "./pages/WorkshopPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import AdminPage from "./pages/AdminPage";
import NotificationsPage from "./pages/NotificationsPage";
import LoginPage from "./pages/LoginPage";
import OauthCallbackPage from "./pages/OauthCallbackPage";
import VideoPage from "./pages/VideoPage";
import PublishPage from "./pages/PublishPage";
import EditPage from "./pages/EditPage";
import CardDetailPage from "./pages/CardDetailPage";
import DeckDetailPage from "./pages/DeckDetailPage";
import TemplateDetailPage from "./pages/TemplateDetailPage";
import TemplateMarketPage from "./pages/TemplateMarketPage";
import CutPage from "./pages/CutPage";
import CreatePage from "./pages/CreatePage";
import FlowPage from "./pages/FlowPage";
import StudioPage from "./studio/StudioPage";
import TabBar from "./components/TabBar";
import { readyVideos } from "./data/videos";
import { readySocial } from "./data/social";
import { readyDanmaku } from "./data/danmaku";
import { checkUpdateForPrompt, type UpdateInfo } from "./data/appUpdate";
import UpdateSheet from "./components/UpdateSheet";
import { readyTemplates } from "./data/templates";
import { readyDrafts } from "./data/drafts";
import { readyAccount } from "./data/account";
import { useCurrentUser } from "./hooks/useAccount";
import useOrientationLock from "./hooks/useOrientationLock";
import { signInWithOauthToken } from "./data/account";
import { initOauthDeepLink, onOauthResult } from "./utils/oauth";

/**
 * 第三方登录的深链回程收口（只在原生壳里有事做）。
 *
 * ★ 必须挂在【路由顶层】而不是登录页里：用户跳去系统浏览器授权那几十秒里，
 *   Android 随时可能回收 App 进程；授权完深链回来是**冷启动**，登录页早已不在，
 *   挂在它身上的监听器自然也不在——token 就被静默丢掉了，用户回到 App 仍是未登录
 *   且没有任何提示。（真机实测过：深链能把 App 拉起来，但 JS 侧收不到东西。）
 */
function OauthDeepLinkBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    void initOauthDeepLink();
    return onOauthResult((r) => {
      if (r.token) {
        void signInWithOauthToken(r.token)
          .then(() => navigate("/", { replace: true }))
          .catch((e) => navigate(`/login?err=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`, { replace: true }));
      } else if (r.error) {
        navigate(`/login?err=${encodeURIComponent(r.error)}`, { replace: true });
      }
    });
  }, [navigate]);
  return null;
}

/** 带底部 TabBar 的页面骨架（内容区留出底栏高度，含系统手势条） */
function TabLayout() {
  return (
    <div className="min-h-full" style={{ paddingBottom: "var(--tabbar-h)" }}>
      <Outlet />
      <TabBar />
    </div>
  );
}

/** 屏幕方向看门人：除工坊外全锁竖屏（逻辑在 hooks/useOrientationLock） */
function OrientationGuard() {
  useOrientationLock();
  return null;
}

/**
 * 启动时查一次有没有新版（只在自己发出去的侧载包里，见 data/appUpdate）。
 *
 * ★ 延后 3 秒再查：开屏那几秒 CPU 和网络都在抢着装作品库、拉首页第一条视频的流，
 *   这时候插一发下载清单只会让首屏更慢；而"有新版"这件事晚三秒说完全不影响。
 * ★ 查不到一律安静收场（没网、清单还没发都会走到这儿）。手动检查那条路
 *   （设置页）才会把失败原因显示出来 —— 两种场景对"安静"的容忍度不一样。
 */
function UpdateGate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      void checkUpdateForPrompt().then(setInfo);
    }, 3000);
    return () => clearTimeout(t);
  }, []);
  if (!info || closed) return null;
  return <UpdateSheet info={info} onClose={() => setClosed(true)} />;
}

/** 需要登录的路由：未登录跳登录页并带回跳地址 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const loc = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  // 数据层是 IndexedDB（异步）：装载完成前不渲染路由，避免各页读到空库
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void Promise.all([
      readyVideos(),
      readyAccount(),
      readySocial(),
      readyTemplates(),
      readyDrafts(),
      readyDanmaku(),
    ]).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
          <span className="text-xs">正在打开作品库…</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 挂在路由树里（需要 useNavigate / useLocation），但不渲染任何东西 */}
      <OauthDeepLinkBridge />
      <OrientationGuard />
      <UpdateGate />
      <Routes>
      <Route element={<TabLayout />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        {/* 一级 Tab 不做硬登录墙：未登录时页面自己显示软提示（与 /me 一致）。
            硬弹到登录页会让底栏的一个入口变成「点进去就出不来」。 */}
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/me" element={<ProfilePage />} />
        {/* 创作者主页（首页点头像进的就是它）。放在 TabLayout 里而不是全屏页：
            短视频 App 的个人页都留着底栏，逛完一个作者能直接切回首页继续刷。
            与 /me 同一个组件——是不是我自己由组件判断（见 ProfilePage）。

            ★★ 两条路由指向同一个组件，**身份以 id 那条为准**：
              /user/:id  新路径。展示名可变、可重名，拿它当身份必然出错（两个同名的人
                         只能进到其中一个；老服务端不返回 displayName 时退回的 username
                         与任何一条缓存作品都对不上，于是静默进错人的主页）。
              /u/:author 老路径，**必须留着**：分享出去的链接、老包缓存、已经发出去的
                         评论里都还带着它。ProfilePage 会先拿名字去登记处反查 id，
                         查得到就当 id 那条用。 */}
        <Route path="/user/:userId" element={<ProfilePage />} />
        <Route path="/u/:author" element={<ProfilePage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      {/* 第三方登录的 web 回程（原生端走自定义 scheme，不经过这条路由） */}
      <Route path="/oauth/callback" element={<OauthCallbackPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      {/* 管理后台。全屏推入页，入口在设置页（非管理员看不见那一行）。
          ★★ 两道门缺一不可：RequireAuth 管"没登录"（带 next 回跳），
            AdminPage 自己管"登录了但不是管理员" —— 直接输 hash 进来会看到一句
            能读懂的解释 + 返回首页，**不是白屏、也不是不声不响地跳走**。
          ★ 真正的门在服务端（requireRole("admin")）；这两道只决定看不看得见。 */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        }
      />
      {/* 通知：与 /settings 一样是**全屏推入**页，不进 TabLayout。
          ★ 刻意不给底栏加第六格：TabBar 是五格，而底缘那 100px 里进度条 / 时长文字 /
            右侧栏 / 看板娘的位置是互相咬着算出来的（CLAUDE.md 有整段说明），
            动底栏等于把那几个数全部重算。入口放在个人页顶栏的铃铛上。 */}
      <Route
        path="/notifications"
        element={
          <RequireAuth>
            <NotificationsPage />
          </RequireAuth>
        }
      />
      <Route path="/video/:id" element={<VideoPage />} />
      <Route path="/card/:id" element={<CardDetailPage />} />
      <Route path="/deck/:id" element={<DeckDetailPage />} />
      <Route path="/template/:id" element={<TemplateDetailPage />} />
      <Route path="/templates" element={<TemplateMarketPage />} />
      <Route
        path="/create"
        element={
          <RequireAuth>
            <CreatePage />
          </RequireAuth>
        }
      />
      <Route
        path="/studio"
        element={
          <RequireAuth>
            <StudioPage />
          </RequireAuth>
        }
      />
      <Route
        path="/flow"
        element={
          <RequireAuth>
            <FlowPage />
          </RequireAuth>
        }
      />
      <Route
        path="/cut"
        element={
          <RequireAuth>
            <CutPage />
          </RequireAuth>
        }
      />
      <Route
        path="/publish"
        element={
          <RequireAuth>
            <PublishPage />
          </RequireAuth>
        }
      />
      <Route
        path="/edit/:id"
        element={
          <RequireAuth>
            <EditPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
