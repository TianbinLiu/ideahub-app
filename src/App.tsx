import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import FeedPage from "./pages/FeedPage";
import DiscoverPage from "./pages/DiscoverPage";
import WorkshopPage from "./pages/WorkshopPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
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
    void Promise.all([readyVideos(), readyAccount(), readySocial(), readyTemplates(), readyDrafts()]).then(() =>
      setReady(true),
    );
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
            与 /me 同一个组件——是不是我自己由组件按作者名判断（见 ProfilePage） */}
        <Route path="/u/:author" element={<ProfilePage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      {/* 第三方登录的 web 回程（原生端走自定义 scheme，不经过这条路由） */}
      <Route path="/oauth/callback" element={<OauthCallbackPage />} />
      <Route path="/settings" element={<SettingsPage />} />
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
