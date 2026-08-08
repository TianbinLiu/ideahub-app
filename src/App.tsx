import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import FeedPage from "./pages/FeedPage";
import DiscoverPage from "./pages/DiscoverPage";
import WorkshopPage from "./pages/WorkshopPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
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
import { readyAccount } from "./data/account";
import { useCurrentUser } from "./hooks/useAccount";

/** 带底部 TabBar 的页面骨架（内容区留出底栏高度，含系统手势条） */
function TabLayout() {
  return (
    <div className="min-h-full" style={{ paddingBottom: "var(--tabbar-h)" }}>
      <Outlet />
      <TabBar />
    </div>
  );
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
    void Promise.all([readyVideos(), readyAccount(), readySocial(), readyTemplates()]).then(() => setReady(true));
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
    <Routes>
      <Route element={<TabLayout />}>
        <Route path="/" element={<FeedPage />} />
        <Route path="/discover" element={<DiscoverPage />} />
        {/* 一级 Tab 不做硬登录墙：未登录时页面自己显示软提示（与 /me 一致）。
            硬弹到登录页会让底栏的一个入口变成「点进去就出不来」。 */}
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/me" element={<ProfilePage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
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
  );
}
