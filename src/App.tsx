import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router";
import GuideGate from "./components/guide/GuideGate";
import InfoDialog from "./components/InfoDialog";
import { AGREEMENTS, recordTermsAccepted, termsAccepted, type AgreementId } from "./data/agreements";
import GenerationPill from "./components/GenerationPill";
import AuthPending from "./components/AuthPending";
import FeedPage from "./pages/FeedPage";
import DiscoverPage from "./pages/DiscoverPage";
import WorkshopPage from "./pages/WorkshopPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SettingsProfilePage from "./pages/SettingsProfilePage";
import SettingsVoicePage from "./pages/SettingsVoicePage";
import SettingsQualityPage from "./pages/SettingsQualityPage";
import SettingsStoragePage from "./pages/SettingsStoragePage";
import SettingsDeactivatePage from "./pages/SettingsDeactivatePage";
import AdminPage from "./pages/AdminPage";
import NotificationsPage from "./pages/NotificationsPage";
import LoginPage from "./pages/LoginPage";
import OauthCallbackPage from "./pages/OauthCallbackPage";
import VideoPage from "./pages/VideoPage";
import PublishPage from "./pages/PublishPage";
import EditPage from "./pages/EditPage";
import CardDetailPage from "./pages/CardDetailPage";
import CustomCardPage from "./pages/CustomCardPage";
import DraftsPage from "./pages/DraftsPage";
import DeckDetailPage from "./pages/DeckDetailPage";
import TemplateDetailPage from "./pages/TemplateDetailPage";
import TemplateMarketPage from "./pages/TemplateMarketPage";
import CutPage from "./pages/CutPage";
import VideoEditorPage from "./pages/VideoEditorPage";
import CreatePage from "./pages/CreatePage";
import FlowPage from "./pages/FlowPage";
import SimpleModePage from "./pages/SimpleModePage";
import StudioPage from "./studio/StudioPage";
import TabBar from "./components/TabBar";
import { readyVideos } from "./data/videos";
import { readySocial } from "./data/social";
import { readyDanmaku } from "./data/danmaku";
import { checkUpdateForPrompt, type UpdateInfo } from "./data/appUpdate";
import UpdateSheet from "./components/UpdateSheet";
import { readyTemplates } from "./data/templates";
import { readyDrafts } from "./data/drafts";
import { readyCutSession } from "./data/cutSession";
import { readyAccount } from "./data/account";
import { useAuthState, useCurrentUser } from "./hooks/useAccount";
import useOrientationLock from "./hooks/useOrientationLock";
import { signInWithOauthToken, signOut } from "./data/account";
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

/**
 * 协议补签门（2026-08-28）：已登录、但本机没有当前版本协议同意记录的人，开屏补一次。
 *
 * ★ 为什么不能只靠登录页那道勾选门：已登录的存量用户、QQ 深链自动登录回来的用户
 *   都**不经过登录页**；协议更新（TERMS_UPDATED 变了）后也只有这里能触达他们。
 * ★ 点背景**不关**：这张卡只有两个出口，都得明确表态（同意 / 不同意并退出登录）。
 *   误触背景就把人登出是事故；不同意也只退登录态、不拦浏览——首页本来就能逛。
 * ★ 全文小窗渲染在门后面（同 z 的 portal 后挂载者在上），从卡里点《用户协议》
 *   能在其上层展开，与登录页那张「同意并继续」卡同一套关系。
 */
function TermsGate() {
  const user = useCurrentUser();
  // 同意/退出都不改本组件的 props，靠这个空 bump 让 termsAccepted() 重新求值
  const [, bump] = useState(0);
  const [viewDoc, setViewDoc] = useState<AgreementId | null>(null);
  if (!user || termsAccepted()) return null;
  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-8">
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-ink p-4">
            <h3 className="text-sm font-bold text-slate-100">用户协议与隐私政策</h3>
            <div className="mt-2 text-xs leading-relaxed text-slate-400">
              继续使用前，请阅读并同意
              <button onClick={() => setViewDoc("terms")} className="text-brand">
                《用户协议》
              </button>
              与
              <button onClick={() => setViewDoc("privacy")} className="text-brand">
                《隐私政策》
              </button>
              。
            </div>
            <button
              onClick={() => {
                recordTermsAccepted();
                bump((n) => n + 1);
              }}
              className="mt-4 w-full rounded-xl bg-brand py-2.5 text-xs font-bold text-ink"
            >
              同意并继续
            </button>
            <button
              onClick={() => {
                signOut();
                bump((n) => n + 1);
              }}
              className="mt-2 w-full py-1.5 text-center text-[11px] text-slate-500"
            >
              不同意，退出登录
            </button>
          </div>
        </div>,
        document.body,
      )}
      {viewDoc && (
        <InfoDialog title={AGREEMENTS[viewDoc].title} onClose={() => setViewDoc(null)}>
          {AGREEMENTS[viewDoc].body}
        </InfoDialog>
      )}
    </>
  );
}

/**
 * 需要登录的路由：**确定**没登录才跳登录页并带回跳地址。
 *
 * ★★ 判据是 authState() 的三态，不是 `!user`（2026-08-20 真机报的 bug）：
 *   冷启动后立刻点底栏 ➕ 会弹出登录页，而那个人明明登录着 —— 退出去点「我的」，
 *   头像昵称钱包全在，再点 ➕ 就正常了。原因是那一刻会话还在水合／联网自愈，
 *   `currentUser()` 是 null，而 `!user` 把「还不知道」和「确定没登录」判成了同一件事。
 *   对用户来说那不是一次加载，是**「我被登出了」**。
 * ★ pending 时给加载态而不是放行：放行的话页面会拿着一个空账号库往下跑
 *   （myCards() 返回空、扣费判余额不足…），那是另一种更难懂的坏。
 * ★ 这是全 app **唯一**的一处硬登录墙（铁律六）：底栏 ➕ 那类入口只管 navigate，
 *   不许自己再判一遍 —— 判两遍就必然有一遍先跑。
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuthState();
  const loc = useLocation();
  if (auth === "pending") return <AuthPending />;
  if (auth === "out") return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
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
      // 剪到一半的那条成片（钱已经花在里面了，见 data/cutSession 的 ★★）
      readyCutSession(),
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
      <TermsGate />
      {/* 新手引导的遮罩。★ 必须在 <Routes> **外面**：每一页自己的根容器多半是
          `fixed inset-0`（首页/创作页/剪辑页/工作流页），挂在里面会跟着路由卸载，
          而遮罩要能盖住任何一页。弹哪一份由每一屏自己 useAutoGuide 声明。 */}
      <GuideGate />
      {/* 出片状态胶囊：生成期间人不在 /flow 时显示进度，出完显示"回去继续"的通知。
          与 GuideGate 同一条理由挂在 Routes 外面（要盖住任何一页，不随路由卸载） */}
      <GenerationPill />
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
      {/* 设置系：/settings 只是入口列表，单功能子页各占一条路由（2026-08-27 拆分）。
          ★ 全部套 RequireAuth（2026-08-28 改）：拆分前的老写法是页面自己在 render 里
            navigate 去登录页——而 navigate 本质是 setState，渲染期间调用会被 React
            丢弃，真机实测未登录直开 /settings 就是白屏卡死、hash 不动。
            RequireAuth 用 <Navigate> 声明式跳转没有这个问题，还自带当前路径回跳。 */}
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/settings/profile" element={<RequireAuth><SettingsProfilePage /></RequireAuth>} />
      <Route path="/settings/voice" element={<RequireAuth><SettingsVoicePage /></RequireAuth>} />
      <Route path="/settings/quality" element={<RequireAuth><SettingsQualityPage /></RequireAuth>} />
      <Route path="/settings/storage" element={<RequireAuth><SettingsStoragePage /></RequireAuth>} />
      <Route path="/settings/deactivate" element={<RequireAuth><SettingsDeactivatePage /></RequireAuth>} />
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
      {/* 自己传图做卡片（入口在创意工坊）。★ 路径刻意**不**挂在 /card/ 下面：
          `/card/new` 与 `/card/:id` 只靠路由排序分胜负，哪天有人真铸出一张 id 为
          "new" 的卡就会撞车。全屏推入页，不进 TabLayout（与 /publish 同形态）。
          ★ RequireAuth：这一页的终点是 addCards，而它在没有登录用户时**静默返回空**，
            不拦的话直接输 hash 进来会走到最后一步才发现"卡没了"。 */}
      <Route
        path="/custom-card"
        element={
          <RequireAuth>
            <CustomCardPage />
          </RequireAuth>
        }
      />
      {/* 草稿箱整页（2026-08-29）。不设登录墙：草稿是这台设备的 IndexedDB，与账号无关 */}
      <Route path="/drafts" element={<DraftsPage />} />
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
      {/* 简约模式：一步一屏的向导（2026-08-23 从 /flow 独立出来） */}
      <Route
        path="/simple"
        element={
          <RequireAuth>
            <SimpleModePage />
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
      {/* 视频编辑页（白模 V2）：一个页面两种模式——作者的「选段 + 裁掉水印」与
          套用者的「给人偶挂卡」。全屏推入页，不进 TabLayout（与 /cut 同形态）。
          ★ 入参/出参走 location.state（形状见 VideoEditorPage 顶部注释），页面自己
            按形状验收：拿不到入参时显示一句能读懂的解释 + 回首页，不是白屏。
          ★ RequireAuth：两种模式的终点都要登录才成立——白模化打的是 requireAuth 的
            blockoutize 端点，挂卡读的是**本账号**的素材库（未登录时 myCards 返回空，
            不拦的话直接输 hash 进来会看到一个"我的卡都没了"的空列表）。 */}
      <Route
        path="/video-editor"
        element={
          <RequireAuth>
            <VideoEditorPage />
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
