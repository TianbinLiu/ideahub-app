// 创作者主页（对标 TikTok 个人页）。一套实现同时服务三个入口：
//
//   /me           我的主页 —— 多出 设置 / 钱包 / 草稿 / 卡片 / 卡组 / 收藏
//   /user/:userId 别人的主页（**正路**）—— 关注 + 分享主页
//   /u/:author    别人的主页（老路径，按展示名）—— 分享出去的链接、老包缓存、
//                 已经发出去的评论里都还带着它，必须继续能开
//
// ★★ 别人的主页**要真的去问服务端**（getUser + fetchAuthorWorks），不能只拿
//   `listVideos()` 去筛。远端模式下那份 cache 只有推荐流的前 30 条 —— 从搜索结果
//   点一个陌生人进来，筛出来必然是 0 条，页面就会显示「作品 0 / 获赞 0 / 播放 0」
//   加一句「TA 还没有发布作品」。那是**编出来的空状态**：真相是"App 从来没问过
//   服务器这个人的事"（铁律八）。所以下面把「在问」「问不到」「真的没有」画成
//   三种不同的样子，一种都不能省。
//
// ★ 不拆成两个组件：版式、统计口径、作品栅格三样必须永远一致（铁律六）。
//   拆开之后「获赞怎么算」「封面上放什么」就会各写一遍，改一处漏一处。
//
// 版式抄 TikTok 那套竖排居中：头像 → @账号 → 三连统计 → 动作按钮 → 简介 →
// 图标页签 → 3 列贴边栅格。旧版是左对齐的资料卡 + 文字页签，与首页的
// 短视频形态完全不搭，而且首页压根没有入口能走到"别人"的主页。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import Icon, { type IconName } from "../components/Icon";
import DeckCard from "../components/DeckCard";
import Avatar from "../components/Avatar";
import AvatarPicker from "../components/AvatarPicker";
import {
  authorIdOfName,
  dropPendingPublish,
  fetchAuthorWorks,
  isMyAuthor,
  listVideos,
  pendingPublishes,
  profileHref,
  publishUploadStatus,
  rememberAuthorId,
  remoteOn,
  retryPendingPublishes,
  type AuthorWorks,
} from "../data/videos";
import { getUser, userDisplayName, type ApiUserProfile } from "../api/users";
import { deleteDraft, loadDraft, renameDraft, type DraftMode, type WorkDraftMeta } from "../data/drafts";
import { useDrafts } from "../hooks/useDrafts";
import { useStudio } from "../studio/studioStore";
import {
  billingExempt,
  buyPlan,
  deckCoverOf,
  isFollowing,
  myCards,
  myDecks,
  rechargeAddon,
  refreshRemoteWallet,
  toggleFollow,
  walletOf,
  type RechargeResult,
} from "../data/account";
import { fetchOrder, fetchPayConfig } from "../api/wallet";
import { API_ON } from "../api/client";
import { PLANS, RECHARGE_PACKS, fmtTokens } from "../data/economy";
import { notificationsState, refreshUnreadCount, subscribeNotifications } from "../data/notifications";
import { useAccountVersion, useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import { CARD_TYPE_COLORS, CARD_TYPE_LABELS, VideoItem, formatPlays, relativeTime } from "../types";

type TabKey = "works" | "drafts" | "cards" | "decks" | "collects";

/** 顶栏内容高度。页签要 sticky 到它下面，两处必须用同一个数，所以提成常量 */
const HEADER_H = "2.75rem"; // h-11 = 44px，移动端热区下限

/** 陌生人主页的远端状态。★ 四件事分开记，页面才画得出四种不同的样子 */
interface Stranger {
  /** 还在问（问出结果之前不许下任何结论） */
  loading: boolean;
  profile: ApiUserProfile | null;
  /** 服务端明确说没有这个人（注销/id 不对） */
  missing: boolean;
  /** 这台服务器没有这个端点（判的是响应形状，不是状态码） */
  unsupported: boolean;
  /** 没问出结果的原因，直接给用户看；空串 = 没出错 */
  error: string;
  /** 他的作品（含"服务端认没认 author 参数"），null = 这一趟没问 */
  works: AuthorWorks | null;
}

const STRANGER_IDLE: Stranger = {
  loading: false,
  profile: null,
  missing: false,
  unsupported: false,
  error: "",
  works: null,
};

/**
 * 去服务端把这个人和他的作品取回来。
 *
 * ★ 资料与作品**一起发、分开判**：作品拉挂了不该把整页判成"查无此人"，
 *   反过来也一样。两条各有各的降级说法。
 * ★ 拿到资料就把「展示名 → userId」登记进去：关注打的是 /api/users/:id/follow，
 *   而本地 following 存的是作者名，不登记的话在陌生人主页点关注只会在本地亮一下
 *   （见 data/videos.rememberAuthorId）。
 */
function useStranger(userId: string | null, reloadKey: number): Stranger {
  const [s, setS] = useState<Stranger>(STRANGER_IDLE);
  useEffect(() => {
    if (!userId || !remoteOn()) {
      setS(STRANGER_IDLE);
      return;
    }
    let alive = true;
    setS({ ...STRANGER_IDLE, loading: true });
    void Promise.all([getUser(userId), fetchAuthorWorks(userId)]).then(([p, w]) => {
      if (!alive) return;
      if (p.status === "ok") rememberAuthorId(userDisplayName(p.user), p.user._id);
      setS({
        loading: false,
        profile: p.status === "ok" ? p.user : null,
        missing: p.status === "missing",
        unsupported: p.status === "unsupported",
        error: p.status === "failed" ? p.error : "",
        works: w,
      });
    });
    return () => {
      alive = false;
    };
  }, [userId, reloadKey]);
  return s;
}

export default function ProfilePage() {
  const { author: routeAuthor, userId: routeUserId } = useParams<{ author?: string; userId?: string }>();
  const [searchParams] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  // 版本号订阅要在最前面：关注/收藏/钱包都是原地改对象，不订阅拿不到变更
  const accV = useAccountVersion();
  const videoV = useVideosVersion();
  const user = useCurrentUser();
  const drafts = useDrafts();

  const [tab, setTab] = useState<TabKey>("works");
  const [pickDraft, setPickDraft] = useState<WorkDraftMeta | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [followListOpen, setFollowListOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  // /u/<我自己>、/user/<我自己的 id> 也走「我的」那套：同一个人不该因为从哪个入口
  // 进来就少半页功能。未登录时一律按"别人"处理，否则会把陌生人的主页顶成登录墙。
  const self =
    (!routeAuthor && !routeUserId) ||
    (!!user && ((!!routeUserId && routeUserId === user.id) || (!!routeAuthor && isMyAuthor(routeAuthor))));

  /**
   * 这个陌生人的 userId。
   * ★ 老路径 `/u/:展示名` 进来时先去登记处反查一次（列表映射时登记的）：查得到就
   *   升级成 id 那条路，于是老链接也能享受"真的去问服务端"。查不到只能按名字尽力而为
   *   —— 那种情况下页面必须说清楚"没能确认这是谁"，绝不假装作品是 0。
   */
  const strangerId = self ? null : (routeUserId ?? (routeAuthor ? authorIdOfName(routeAuthor) : null));
  /** 重试计数：远端失败时用户点「重试」，靠它重跑那个 effect */
  const [reloadKey, setReloadKey] = useState(0);
  const stranger = useStranger(strangerId, reloadKey);

  /** 链接里带过来的名字（profileHref 的 `?name=`）：只用来在问到服务端之前有个东西可显示 */
  const nameHint = searchParams.get("name") ?? routeAuthor ?? "";
  const display = self
    ? (user?.name ?? "")
    : stranger.profile
      ? userDisplayName(stranger.profile)
      : nameHint;
  const handle = self ? (user?.account ?? "") : (stranger.profile?.username ?? nameHint);

  const videos = useMemo(() => listVideos(), [videoV]);
  /** 本地库里名字对得上的那些。远端问到了就不用它，问不到时它至少不是空白 */
  const localWorks = useMemo(
    () => videos.filter((v) => (self ? isMyAuthor(v.author) : !!display && v.author === display)),
    [videos, self, display],
  );
  /** 远端那份到手了没（partial = 服务端没认 author 参数，只能算"刷到的那些"） */
  const remoteWorks =
    stranger.works && (stranger.works.status === "ok" || stranger.works.status === "partial")
      ? stranger.works.items
      : null;
  // ★ 服务端说了"这就是全部"（ok）时**以它为准**，哪怕是空的 —— 那才是事实。
  //   只有在没问到 / 问到的不完整（partial 且一条都没筛出来）时才退回本地那份，
  //   总比一片空白强，代价是页面必须说清楚"这不是全部"（见 StrangerWorks）。
  const works = self
    ? localWorks
    : stranger.works?.status === "ok"
      ? stranger.works.items
      : remoteWorks && remoteWorks.length > 0
        ? remoteWorks
        : localWorks;
  /**
   * 这份作品列表**是不是权威的**。
   * ★ 只有它为真时，页面才敢说「TA 还没有发布作品」「获赞 0」这类话 ——
   *   否则那些数字是"我们没问到"，不是"他没有"。
   * ★ 离线模式也算权威：那时本地库就是这台设备的全部世界（也压根走不到一个
   *   "本地没有他任何作品"的陌生人主页——入口都是从本地那几条作品点进来的）。
   *   在那儿显示「—」只会把一个本来准确的数字变成问号。
   */
  const worksKnown = self || !remoteOn() || stranger.works?.status === "ok";
  // accV 是必需的依赖，不是保险：collects 是原地 push/splice 的同一个数组，
  // 只写 user?.collects 的话取消收藏后这份 memo 永远不会重算
  const collects = useMemo(() => {
    const ids = new Set(user?.collects ?? []);
    return ids.size ? videos.filter((v) => ids.has(v.id)) : [];
  }, [videos, user, accV]);
  // 别人的「卡组」页签：他发布的作品里随片带的素材卡组（VideoDeck 挂在作品上，
  // 不在账号库里，所以点开去的是那支作品——收卡的按钮在详情页）
  const workDecks = useMemo(
    () => works.filter((v) => v.deck && v.deck.cards.length > 0),
    [works],
  );

  // 换个人看时页签回到「作品」：停在上一个人的「卡组」上会让人以为这人只发过卡组。
  // ★ 依赖是**路由上的身份**而不是 display：display 会在资料到货那一拍从"链接里带的名字"
  //   变成"服务端的名字"，跟着它复位会把用户刚点开的页签又弹回去。
  useEffect(() => setTab("works"), [strangerId, routeAuthor, self]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // 铃铛上的红点。★ 不做 setInterval 轮询：后台/最小化的 WebView 会把定时器节流到
  //   几乎不跑，轮询既不生效又白耗电。改成"每次进这一页 + 每次 App 恢复"各问一次，
  //   而且 hidden 时直接不问（那一发看不见结果，还可能被推迟到恢复之后才真正发出）。
  const notif = useSyncExternalStore(subscribeNotifications, notificationsState);
  useEffect(() => {
    if (!self) return;
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      void refreshUnreadCount();
    };
    // ★ 首次进页面**不看可见性**（与 NotificationsPage 同一条理由）：那一次不是轮询，
    //   是用户刚打开这一页。罩上 guard 的话，窗口恰好被判 hidden 时红点就不出现，
    //   而且要等到下一次 visibilitychange 才补 —— 用户看到的是"有人赞了我却没提示"。
    void refreshUnreadCount();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnreadCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
    // ★ 依赖写 user?.id 而不是 user：currentUser() 是**原地改**的同一个对象，
    //   但换个人登录时 id 会变，那时必须重问一次（否则红点还挂着上一个人的未读数）
  }, [self, user?.id]);
  const unread = self ? notif.unread : 0;

  function flash(msg: string) {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  }

  if (self && !user) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6">
        <Icon name="user" size={44} className="text-slate-700" />
        <p className="text-center text-sm text-slate-400">登录后可以创作视频、收藏卡片、管理卡组</p>
        <Link to="/login?next=/me" className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-ink">
          登录 / 注册
        </Link>
      </div>
    );
  }

  const cards = self ? myCards() : [];
  const decks = self ? myDecks() : [];
  const wallet = self ? walletOf() : null;
  const following = !self && isFollowing(display);
  const totalLikes = works.reduce((s, v) => s + v.likes, 0);
  const totalPlays = works.reduce((s, v) => s + v.plays, 0);

  // ★★ 数不出来的时候写「—」，**不写 0**。
  //   0 是一个结论（"这个人没有作品/没人赞过他"），而我们这一趟可能压根没问出结果 ——
  //   一个 48213 播放的创作者显示「获赞 0」不是克制，是骗人（铁律八）。
  const num = (n: number) => (worksKnown ? formatPlays(n) : "—");
  // ★ 「粉丝」这一栏原来是没有的：那时本地只能算出"我关注了没"这 0/1 两种值。
  //   现在 GET /api/users/:id 真的回了 followerCount，就照实显示；老服务端不返回时
  //   这一栏整个不出现（而不是显示 0）。
  const followers = stranger.profile?.followerCount;
  const stats: Array<{ label: string; value: string; onTap?: () => void }> = self
    ? [
        { label: "关注", value: String(user!.following.length), onTap: () => setFollowListOpen(true) },
        { label: "获赞", value: formatPlays(totalLikes) },
        { label: "播放", value: formatPlays(totalPlays) },
      ]
    : [
        ...(typeof followers === "number" ? [{ label: "粉丝", value: formatPlays(followers) }] : []),
        { label: "作品", value: worksKnown ? String(works.length) : "—" },
        { label: "获赞", value: num(totalLikes) },
        { label: "播放", value: num(totalPlays) },
      ];

  const TAB_META: Record<TabKey, { icon: IconName; label: string; n: number }> = {
    works: { icon: "grid", label: "作品", n: works.length },
    drafts: { icon: "lock", label: "草稿", n: drafts.length },
    cards: { icon: "card", label: "卡片", n: cards.length },
    decks: { icon: "cards", label: "卡组", n: self ? decks.length : workDecks.length },
    collects: { icon: "bookmark", label: "收藏", n: collects.length },
  };
  // 我的页五个页签全列（空的那几个是创作入口，本身就有用）；
  // 别人的页只列真有东西的，否则点进去是个死胡同
  const tabKeys: TabKey[] = self
    ? ["works", "drafts", "cards", "decks", "collects"]
    : (["works", "decks"] as TabKey[]).filter((k) => k === "works" || TAB_META[k].n > 0);
  const activeTab = tabKeys.includes(tab) ? tab : "works";

  /**
   * 这一页**对外**的地址（分享 / 登录后回跳都用它）。
   * ★ 拿得到 userId 就发 id 那条：名字会改，改完之后老链接指向的是"一个叫这个名字的人"，
   *   而不是"这个人"。名字仍带在 `?name=` 里，只为让打开的人在问到服务端之前有东西可看。
   */
  const publicHref = (() => {
    const id = self ? user?.id : strangerId;
    if (id) return `/user/${encodeURIComponent(id)}${display ? `?name=${encodeURIComponent(display)}` : ""}`;
    return `/u/${encodeURIComponent(display)}`;
  })();

  function shareProfile() {
    const url = `${location.origin}${location.pathname}#${publicHref}`;
    if (navigator.share) {
      void navigator.share({ title: `${display} 的主页`, url }).catch(() => {});
      return;
    }
    // 复制成功要给回执：没有提示的话"点了没反应"和"复制失败"在用户看来是同一件事
    void navigator.clipboard
      ?.writeText(url)
      .then(() => flash("已复制主页链接"))
      .catch(() => flash("复制失败，请手动分享"));
  }

  function onFollow() {
    if (!user) {
      // 回跳回**这一页**（含 ?name=），不是回一个按名字拼出来的地址
      navigate(`/login?next=${encodeURIComponent(`${loc.pathname}${loc.search}`)}`);
      return;
    }
    toggleFollow(display);
    navigator.vibrate?.(10);
  }

  return (
    <div className="min-h-full">
      {/* 顶栏：sticky 而不是随内容滚走——作品墙可以很长，返回和设置得一直够得着。
          safe-top 放在这里而不是页面根上，否则 sticky 会顶到刘海底下 */}
      <header className="safe-top sticky top-0 z-20 bg-ink">
        <div className="flex h-11 items-center px-2">
          {self ? (
            <span className="h-11 w-11" />
          ) : (
            <button
              onClick={() => {
                // 分享出去的主页链接被人直接点开时，history 里没有"上一页"——
                // 这时候 navigate(-1) 是退出 App（Capacitor 的 WebView 里就是白屏），
                // 得退回首页。react-router 把自己的历史下标存在 history.state.idx
                const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
                if (idx > 0) navigate(-1);
                else navigate("/");
              }}
              aria-label="返回"
              className="flex h-11 w-11 items-center justify-center text-slate-300"
            >
              <Icon name="back" size={22} />
            </button>
          )}
          {/* ★ 自己的主页顶栏不再写 @账号：底下的资料区已经把名字和 @账号都列了一遍，
              顶栏那一行等于把同一个信息说两遍，还把整页最贵的那条视觉带占满了。
              别人的主页保留 —— 作品墙一长就滚到看不见头像，那时候顶栏是唯一还能
              回答"这是谁的主页"的地方。 */}
          {self ? (
            <span className="flex-1" />
          ) : (
            <span className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold text-slate-100">
              @{handle}
            </span>
          )}
          {self ? (
            <div className="flex items-center">
              {/* 通知入口。★ 放这儿而不是底栏加一格：TabBar 是五格，底缘那 100px 的
                  几何是承重的（CLAUDE.md「动了首页底缘任何一个元素」那条）。 */}
              <Link
                to="/notifications"
                className="relative flex h-11 w-11 items-center justify-center text-slate-300"
                aria-label={unread > 0 ? `消息（${unread} 条未读）` : "消息"}
              >
                <Icon name="bell" size={21} filled={unread > 0} />
                {unread > 0 && (
                  // 只画一个点不写数字：未读上到两位数时数字会把 44px 热区撑破，
                  // 而"有几条"进了页面第一眼就看得到
                  <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-ink" />
                )}
              </Link>
              <Link
                to="/settings"
                /* 44px 是移动端热区下限，原来的 h-9 w-9（36px）在手机上要点两三次才中 */
                className="flex h-11 w-11 items-center justify-center text-slate-300"
                aria-label="设置"
              >
                <Icon name="settings" size={21} />
              </Link>
            </div>
          ) : (
            <button
              onClick={shareProfile}
              aria-label="分享主页"
              className="flex h-11 w-11 items-center justify-center text-slate-300"
            >
              <Icon name="share" size={21} />
            </button>
          )}
        </div>
      </header>

      {/* ── 资料区（居中竖排，TikTok 同构）────────────────────────────── */}
      <div className="flex flex-col items-center px-5 pt-1">
        <div className="relative">
          {self ? (
            // 点头像直接换：不用先钻进设置页。开的是选择器（官方看板娘 + 自定义），
            // 不再是直接弹系统相册 —— 新用户手里往往没有合适的图
            <button
              onClick={() => setAvatarOpen(true)}
              className="block rounded-full transition active:scale-95"
              aria-label="更换头像"
            >
              <Avatar name={display} src={user!.avatar} size={92} />
              <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-brand text-ink">
                <Icon name="plus" size={15} strokeWidth={2.5} />
              </span>
            </button>
          ) : (
            <>
              {/* ★ 用他**真的头像**。原来这里死写 `<Avatar name={display} />`（不传 src），
                  于是搜索结果里明明刚显示过他的头像，点进来却退回一个字母底 ——
                  头像在 Link 的那一跳里被丢掉了，用户会怀疑是不是进错了人。 */}
              <Avatar name={display} src={stranger.profile?.avatarUrl} size={92} />
              {/* 未关注时头像下挂一个 + —— 与首页右侧栏的关注反馈同款，
                  从头像点进来的人不用再去找按钮 */}
              {!following && (
                <button
                  onClick={onFollow}
                  aria-label="关注"
                  className="absolute -bottom-2 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border-2 border-ink bg-rose-500 text-white transition active:scale-90"
                >
                  <Icon name="plus" size={14} strokeWidth={3} />
                </button>
              )}
            </>
          )}
        </div>

        {/* ★ 名字还没问到时（老链接里连名字都没带）显示一个占位，别显示空白 —— 空白
            会让人以为页面坏了。真名到货后这一行会自己变成他的名字。 */}
        <div className="mt-3.5 max-w-full truncate text-lg font-bold text-slate-100">
          {display || (stranger.loading ? "加载中…" : stranger.missing ? "这个用户不存在" : "未知用户")}
        </div>
        {/* ★★ 这一行**一律是 username**（句柄），自己的主页和别人的主页同一条口径。
            上一版这里对自己人显示的是**昵称**、对别人显示的是 username —— 同一个位置
            两种含义，而且用户在别人主页上学到的"@ 他要打这一串"，回到自己主页就不成立了
            （仓库主人点名的那处不一致）。
            ⚠ 这里曾经反复过一轮：2026-08-11 有用户反馈"改完昵称，名字底下还挂着旧名字"，
            当时的结论是"这个 app 没有可公开展示的 handle 概念，摆着只会制造困惑"，
            于是换成了昵称。现在 handle 概念**真的有了**（@ 的令牌就是 username，
            见 utils/mention.ts），所以那句话的前提不再成立 —— 这一行现在回答的是
            "别人要怎么 @ 我"，不是"我叫什么"（我叫什么写在上面那一行，加粗那个）。
            ★ `handle` 自己的主页取 user.account（远端登录时它就是 username，
            见 data/account.toLocalUser），别人的取服务端那份 username；两边都问不到时
            才退回展示名 —— 不编。 */}
        <div className="mt-0.5 max-w-full truncate text-xs text-slate-500">@{handle || display}</div>

        {/* 统计：竖线分隔，数字大、标签小（TikTok 同款视觉层级）。
            ★ 别人的主页可能有四栏（多一个「粉丝」），每格得从 84px 收到 70px ——
              4×84=336 已经超过 375px 屏减去两侧 px-5 之后的 335px，会把最后一栏挤出屏幕。 */}
        <div className="mt-3.5 flex items-stretch">
          {stats.map((s, i) => {
            const cell = stats.length > 3 ? "min-w-[70px]" : "min-w-[84px]";
            const body = (
              <>
                <span className="text-[17px] font-bold tabular-nums text-slate-100">{s.value}</span>
                <span className="mt-0.5 text-[11px] text-slate-500">{s.label}</span>
              </>
            );
            return (
              <div key={s.label} className="flex items-center">
                {i > 0 && <span className="h-6 w-px bg-slate-700/70" />}
                {s.onTap ? (
                  <button onClick={s.onTap} className={`flex ${cell} flex-col items-center px-2 active:opacity-70`}>
                    {body}
                  </button>
                ) : (
                  <span className={`flex ${cell} flex-col items-center px-2`}>{body}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* 动作按钮。只放真能用的两个：TikTok 那颗「▾」在我们这没有任何可放的项，
            摆一个点了没反应的下拉比少一颗按钮更糟 */}
        <div className="mt-4 flex w-full max-w-[340px] gap-2">
          {self ? (
            <>
              <Link
                to="/settings"
                className="flex h-10 flex-1 items-center justify-center rounded-full bg-panel text-sm font-semibold text-slate-100 ring-1 ring-slate-700 active:scale-[.98]"
              >
                编辑资料
              </Link>
              <button
                onClick={shareProfile}
                className="flex h-10 flex-1 items-center justify-center rounded-full bg-panel text-sm font-semibold text-slate-100 ring-1 ring-slate-700 active:scale-[.98]"
              >
                分享主页
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onFollow}
                className={`flex h-10 flex-[1.4] items-center justify-center gap-1 rounded-full text-sm font-bold transition active:scale-[.98] ${
                  following ? "bg-panel text-slate-300 ring-1 ring-slate-700" : "bg-brand text-ink"
                }`}
              >
                {following && <Icon name="check" size={15} strokeWidth={2.5} />}
                {following ? "已关注" : "关注"}
              </button>
              <button
                onClick={shareProfile}
                className="flex h-10 flex-1 items-center justify-center rounded-full bg-panel text-sm font-semibold text-slate-100 ring-1 ring-slate-700 active:scale-[.98]"
              >
                分享主页
              </button>
            </>
          )}
        </div>

        {/* 简介。★ 别人的 bio 现在**真的问得到**了（GET /api/users/:id 就带着它），
            不用再拿"从作品里算得出来的东西"去填那片空白。问不到（老服务端 / 没设过）
            时才退回那句从作品算出来的概览 —— 它是真的，只是没那么有用。 */}
        {self ? (
          <p className="mt-3.5 whitespace-pre-wrap text-center text-sm leading-relaxed text-slate-300">
            {user!.bio || <span className="text-slate-600">还没有简介——去设置里写一句吧</span>}
          </p>
        ) : stranger.profile?.bio ? (
          <p className="mt-3.5 whitespace-pre-wrap text-center text-sm leading-relaxed text-slate-300">
            {stranger.profile.bio}
          </p>
        ) : (
          works.length > 0 && (
            <p className="mt-3.5 text-center text-xs text-slate-500">
              {[...new Set(works.map((w) => w.category))].slice(0, 3).join(" · ")} · 最近更新{" "}
              {relativeTime(works[0].createdAt)}
            </p>
          )
        )}

        {/* token 钱包：生成视频/解锁付费内容的通货。套餐额度优先扣，add-on 直充/创作收益不过期。
            ★ 入口按 `self` 显示而**不是** `wallet &&`：远端模式下 walletOf() 在
              /api/me/wallet 那一发请求失败时就一直是 null（refreshRemoteWallet 把错误吞进
              无人监听的 emitApiError），于是弱网下冷启动一次失败 = 整个会话看不到余额、
              也点不到充值，界面上还看不出出过错。而唯一的重试入口恰恰在抽屉里，
              抽屉又因为 wallet 为 null 挂载不了——死锁。
              现在余额读不到时按钮照样在，点开就会重新拉一次（WalletSheet 的 effect）。 */}
        {self && (
          <button
            onClick={() => setWalletOpen(true)}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-slate-700/60 bg-panel px-3.5 py-2.5 text-left"
          >
            <span className="text-xl">⚡</span>
            <div className="min-w-0 flex-1">
              {billingExempt() ? (
                /* ★★ 管理员不摆余额数字：服务端对 admin 不扣费（wallet.debit 放行），
                     镜像里的数字不会因为他用 AI 而动，摆出来等于暗示"这是一份会消耗的
                     真额度"。∞ 也不许是另一个方向的谎 —— 下面那行小字必须把
                     「免扣费 + 用量照记（admin_free 流水）」如实说全（铁律五、八）。
                     判据只用 data/account 的 billingExempt() 这一处（铁律六）；
                     它缺省为 false，老服务端/离线模式下这里就是普通用户那支，不崩（铁律七）。 */
                <>
                  <div className="text-sm font-bold text-slate-100">
                    ∞ <span className="text-xs font-normal text-slate-500">token</span>
                    {/* 套餐名的位置给「管理员」：他没有套餐档位，留着"免费版"三个字
                        反而是错的（他既不是免费版，也不受任何档位门禁约束） */}
                    <span className="ml-1.5 rounded bg-brand/20 px-1.5 py-0.5 text-[9px] font-normal text-brand">
                      管理员
                    </span>
                  </div>
                  {/* 「无需充值」写在这行，正好挨着右边那颗充值按钮 —— 入口照常保留
                      （测支付流程要用），但必须说清点它不是为了给自己续费 */}
                  <div className="text-[11px] leading-relaxed text-slate-500">
                    AI 生成走免扣费通道，无需充值；真实用量服务端照记（admin_free 流水）
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm font-bold tabular-nums text-slate-100">
                    {wallet ? (
                      <>
                        {fmtTokens(wallet.plan + wallet.addon)}{" "}
                        <span className="text-xs font-normal text-slate-500">token</span>
                      </>
                    ) : (
                      "余额读取中…"
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {wallet ? (
                      <>
                        套餐 {fmtTokens(wallet.plan)} · 直充 {fmtTokens(wallet.addon)} ·{" "}
                        {PLANS.find((p) => p.id === wallet.planId)?.name ?? "免费版"}
                      </>
                    ) : (
                      "点开重试"
                    )}
                  </div>
                </>
              )}
            </div>
            <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink">充值 / 套餐</span>
          </button>
        )}
      </div>

      {/* ── 页签：只有图标 + 计数（TikTok 同款），sticky 在顶栏正下方 ────── */}
      <div
        className="sticky z-10 mt-4 flex border-b border-slate-800 bg-ink"
        style={{ top: `calc(env(safe-area-inset-top, 0px) + ${HEADER_H})` }}
      >
        {tabKeys.map((k) => {
          const m = TAB_META[k];
          const on = k === activeTab;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-label={m.label}
              title={m.label}
              className={`relative flex min-h-[44px] flex-1 items-center justify-center gap-1 transition ${
                on ? "text-slate-100" : "text-slate-500"
              }`}
            >
              <Icon name={m.icon} size={20} filled={on && k === "collects"} />
              {m.n > 0 && <span className="text-[11px] tabular-nums">{m.n}</span>}
              {on && <span className="absolute inset-x-[28%] bottom-0 h-0.5 rounded-full bg-slate-100" />}
            </button>
          );
        })}
      </div>

      <div className="pb-6">
        {/* ★ 没传上去的作品必须在这儿露头。远端模式下 videos 的 save() 直接 return
            （作品只活在内存里），发布失败又只进了一个看不见的队列 —— 于是用户的表现是
            「辛苦几十分钟的作品过一会儿自己没了」。失败可以，但要响且局部（铁律八）。 */}
        {activeTab === "works" && self && <PendingBanner />}
        {activeTab === "works" &&
          (self ? (
            works.length ? (
              <WorkGrid items={works} />
            ) : (
              <Empty text="还没有发布作品" cta="去创作" to="/create" />
            )
          ) : (
            <StrangerWorks
              stranger={stranger}
              works={works}
              worksKnown={worksKnown}
              hasId={!!strangerId}
              onRetry={() => setReloadKey((n) => n + 1)}
            />
          ))}

        {/* 草稿：还没发布的半成品。点一张先问用哪个模式打开——同一份内容，
            工坊是 3D 桌面上的节点树，工作流是逐段流水线，两个入口都能接着干 */}
        {activeTab === "drafts" &&
          (drafts.length ? (
            <div className="grid grid-cols-3 gap-[2px]">
              {drafts.map((d) => (
                <button key={d.id} onClick={() => setPickDraft(d)} className="relative block bg-panel text-left">
                  {d.thumb ? (
                    <img src={d.thumb} alt="" className="aspect-[3/4] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-[3/4] w-full items-center justify-center bg-slate-800 text-2xl">🎬</div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-5">
                    {/* 草稿必须带标题：它们常常共用同一批帧，只看封面分不出是哪条 */}
                    <div className="truncate text-[11px] font-medium text-white">{d.title}</div>
                    <div className="text-[10px] text-slate-300">
                      已出片 {d.doneCount}/{d.segCount}
                    </div>
                  </div>
                  {/* ★ 这里原来写的是「仅自己可见」——和已发布作品的可见性设置**是同一个词**，
                      于是用户以为自己有一条设成私密的作品，跑去找哪儿能改（真事，2026-08-10）。
                      草稿的"没人看得到"是它还没发布，不是一个可切换的选项，用词必须分开。 */}
                  <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-black/65 px-1 py-0.5 text-[9px] text-white">
                    <Icon name="lock" size={9} strokeWidth={2.5} />
                    未发布
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <Empty text="还没有草稿——工坊和工作流里都能存" cta="去创作" to="/create" />
          ))}

        {/* 卡片 / 卡组不贴边也不去圆角：它们本身是有边框的实体卡，
            套进作品墙那种 2px 无缝栅格会糊成一片 */}
        {activeTab === "cards" &&
          (cards.length ? (
            <div className="grid grid-cols-3 gap-2 px-3 pt-3">
              {cards.map((c) => (
                <Link
                  key={c.id}
                  to={`/card/${c.id}`}
                  className="relative block overflow-hidden rounded-lg border border-slate-700/60"
                >
                  {c.cover ? (
                    <img src={c.cover} alt={c.name} className="aspect-[3/4] w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center bg-slate-800 text-2xl">🎴</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5">
                    <div className="truncate text-[10px] text-slate-100">{c.name}</div>
                    <span className="text-[8px]" style={{ color: CARD_TYPE_COLORS[c.type] }}>
                      {CARD_TYPE_LABELS[c.type]}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Empty text="还没有卡片" cta="去创意工坊" to="/workshop" />
          ))}

        {/* 卡组按"一叠牌"呈现（与 3D 工坊选卡组同一套视觉），不再是文件夹行。
            右侧留一点余量给卡背的错位偏移，免得贴着栅格边被裁掉 */}
        {activeTab === "decks" &&
          (self ? (
            decks.length ? (
              <div className="grid grid-cols-3 gap-x-3.5 gap-y-4 px-3 pr-4 pt-3">
                {decks.map((d) => (
                  <Link key={d.id} to={`/deck/${d.id}`} className="block">
                    <DeckCard name={d.name} count={d.cardIds.length} cover={deckCoverOf(d)?.cover ?? null} />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty text="还没有卡组" cta="去创意工坊" to="/workshop" />
            )
          ) : (
            // 别人的卡组随作品走：点开去那支作品，收卡的按钮在详情页
            <div className="grid grid-cols-3 gap-x-3.5 gap-y-4 px-3 pr-4 pt-3">
              {workDecks.map((v) => (
                <Link key={v.id} to={`/video/${v.id}`} className="block">
                  <DeckCard
                    name={v.deck!.name || v.title}
                    count={v.deck!.cards.length}
                    cover={v.deck!.cards[0]?.cover ?? null}
                  />
                </Link>
              ))}
            </div>
          ))}

        {activeTab === "collects" &&
          (collects.length ? (
            <WorkGrid items={collects} />
          ) : (
            <Empty text="还没有收藏——首页右侧的书签键收进来" cta="去首页逛逛" to="/" />
          ))}
      </div>

      {avatarOpen && user && (
        <AvatarPicker name={display} current={user.avatar} onClose={() => setAvatarOpen(false)} onError={flash} />
      )}
      {pickDraft && <DraftSheet meta={pickDraft} onClose={() => setPickDraft(null)} />}
      {walletOpen && <WalletSheet onClose={() => setWalletOpen(false)} />}
      {followListOpen && user && (
        <FollowingSheet names={user.following} videos={videos} onClose={() => setFollowListOpen(false)} />
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 z-50 flex justify-center" style={{ bottom: "calc(var(--tabbar-h) + 1rem)" }}>
          <span className="rounded-full bg-black/80 px-4 py-2 text-xs text-white">{toast}</span>
        </div>
      )}
    </div>
  );
}

/**
 * 作品栅格（TikTok 同款：3 列、贴屏幕边、无圆角）。
 * 缝取 2px 而不是 0：种子作品里好几张是夜景封面，全黑挨着全黑看不出分界。
 * 不写标题只写播放量 —— 标题在这个尺寸下只能显示四五个字，
 * 反倒把封面压掉一条；要看标题点进去就有。
 */
/**
 * 「有作品没传上去」的横幅。
 *
 * ★ 为什么非要有它：发布走的是「同步返回乐观条目 + 后台打 API」，而远端模式下
 *   本地不落盘。后台那一步失败时，作品只剩内存里一份，重启就没了 —— 用户看到的是
 *   "作品自己消失"，没有任何提示可循。队列本来就存着，缺的只是一个入口。
 * ★ 必须给「不要了」这条出路：一条永远传不上去的作品（比如体积超了网关上限）
 *   会把这条横幅永久钉在这儿。
 */
function PendingBanner() {
  useVideosVersion();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const list = pendingPublishes();
  const up = publishUploadStatus();
  if (list.length === 0 && !up) return null;
  const first = list[0];

  // 正在传：只显示进度，别把失败原因和进度混在一起说
  if (up) {
    return (
      <div className="mx-3 mt-3 rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-3">
        <div className="text-xs font-semibold text-cyan-200">
          正在上传「{up.title}」 {up.done}/{up.total}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/30">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${Math.round((up.done / Math.max(1, up.total)) * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[10px] text-slate-400">{up.label} · 成片和画面要逐个传上去，别人才看得到</p>
      </div>
    );
  }
  if (!first) return null;
  return (
    <div className="mx-3 mt-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-none text-sm">⚠️</span>
        <span className="min-w-0 flex-1 text-xs font-semibold text-amber-200">
          {list.length} 条作品还没传到服务器
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">
        「{first.draft.title}」{first.error}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
        内容还在这台设备上，没有丢。修好网络或服务器后点重试即可。
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => {
            setBusy(true);
            setNote("");
            void retryPendingPublishes()
              .then((left) => setNote(left === 0 ? "全部上传成功" : `还剩 ${left} 条没成功`))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="flex-1 rounded-lg bg-amber-400/90 py-2 text-xs font-bold text-ink disabled:opacity-50"
        >
          {busy ? "重试中…" : "立即重试"}
        </button>
        <button
          onClick={() => void dropPendingPublish(first.draft.clientId ?? "")}
          className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300"
        >
          不要了
        </button>
      </div>
      {note && <div className="mt-1.5 text-center text-[11px] text-amber-200">{note}</div>}
    </div>
  );
}

/**
 * 别人主页的「作品」页签。
 *
 * ★★ 这里的每一支都对应一件**不同的事实**，一支都不能省着不画（铁律八）：
 *     正在问        → 转圈。还没问出结果之前不下任何结论。
 *     查无此人      → 说人话。别拿"没有作品"去暗示"这人不存在"。
 *     问不出结果    → 红字 + 重试。网络故障不是"他没发过作品"。
 *     这台服务器不支持按作者取 → 说明白只能显示"刷到的那些"，不是全部。
 *     链接里只有名字 → 说明白没能确认这是谁 —— 这条是老 `/u/:名字` 链接遇上
 *                      "这个人没在本次会话里出现过"时的实情。
 *     离线          → 说明白要连服务器。
 *     真的一条都没有 → 这时候才敢说「TA 还没有发布作品」。
 *   原来这一整块只有最后那一句，于是上面每一种情况都被显示成"这个创作者什么都没发过"。
 */
function StrangerWorks({
  stranger,
  works,
  worksKnown,
  hasId,
  onRetry,
}: {
  stranger: Stranger;
  works: VideoItem[];
  worksKnown: boolean;
  hasId: boolean;
  onRetry: () => void;
}) {
  if (stranger.loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
        <span className="text-xs">正在打开 TA 的主页…</span>
      </div>
    );
  }
  if (stranger.missing) {
    return <Empty text="找不到这个用户 —— 可能已经注销了" />;
  }
  const worksErr = stranger.works?.status === "failed" ? stranger.works.error : "";
  const err = stranger.error || worksErr;
  if (err && works.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="px-8 text-sm leading-relaxed text-rose-300">没打开 TA 的主页：{err}</p>
        <p className="mt-1 px-8 text-[11px] text-slate-600">这不代表 TA 没有作品，只是这次没取到</p>
        <button
          onClick={onRetry}
          className="mt-4 rounded-full bg-panel px-5 py-2 text-sm font-semibold text-slate-100 ring-1 ring-slate-700"
        >
          重试
        </button>
      </div>
    );
  }
  // 拿到了一些、但不完整：先把有的摆出来，再在下面挑明"这不是全部"
  const note = worksKnown
    ? ""
    : stranger.unsupported
      ? "这台服务器还没有用户主页接口 · 服务端升级后即可看到完整资料"
      : stranger.works?.status === "partial"
        ? "这台服务器还不支持按作者取作品 · 下面只是本次刷到的那些，不是全部"
        : stranger.works?.status === "offline"
          ? "TA 的作品需要连上服务器 · 当前是离线模式"
          : !hasId
            ? "这个链接里只有名字，没法向服务器确认是谁 · 下面只是本次刷到的那些"
            : "";
  if (works.length === 0) {
    return <Empty text={worksKnown ? "TA 还没有发布作品" : note || "没能取到 TA 的作品"} />;
  }
  return (
    <>
      <WorkGrid items={works} />
      {note && <p className="px-4 pt-3 text-center text-[11px] leading-relaxed text-slate-500">{note}</p>}
    </>
  );
}

function WorkGrid({ items }: { items: VideoItem[] }) {
  return (
    <div className="grid grid-cols-3 gap-[2px]">
      {items.map((v) => {
        const paid = v.pricing?.mode === "paid" && v.pricing.partPrices.some((p) => p > 0);
        return (
          <Link key={v.id} to={`/video/${v.id}`} className="relative block bg-black">
            <img src={v.cover} alt={v.title} className="aspect-[3/4] w-full object-cover" loading="lazy" />
            {/* 底缘压暗：浅色封面上白字播放量本来读不出来 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="absolute bottom-1 left-1.5 flex items-center gap-1 text-[11px] font-medium tabular-nums text-white [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">
              <Icon name="play" size={12} filled />
              {formatPlays(v.plays)}
            </span>
            {/* 私密作品要在墙上一眼认得出来：否则作者只会看到"这条怎么没人看"，
                而它压根就没出现在任何人的首页里。改回公开在作品编辑页 */}
            {/* ★★ 下架排在私密**前面**：两者可以同时成立，而"被平台下架"是作者更需要知道的
                那一个 —— 私密是他自己设的，下架不是。只显示"仅自己可见"会让他以为是自己
                手滑设错了，改回公开之后发现还是没人看，再也找不到原因。
                这一栏只有作者自己看得到（别人的接口回包里根本没有这条作品）。 */}
            {v.takedown ? (
              <span
                className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-rose-600/90 px-1 py-0.5 text-[9px] font-semibold text-white"
                title={v.takedown.reason ? `下架原因：${v.takedown.reason}` : undefined}
              >
                已下架
              </span>
            ) : v.visibility === "private" ? (
              <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">
                <Icon name="lock" size={9} strokeWidth={2.5} />
                仅自己可见
              </span>
            ) : v.branchTree ? (
              <span className="absolute left-1 top-1 rounded bg-brand/90 px-1 py-0.5 text-[9px] font-semibold text-ink">
                互动
              </span>
            ) : null}
            {paid && (
              <span className="absolute right-1 top-1 rounded bg-gold/90 px-1 py-0.5 text-[9px] font-bold text-ink">
                付费
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 底部抽屉外壳，三个弹层共用。
 *
 * ★ 必须 createPortal 到 body（与 CommentSheet 同因）：TabBar 是 z-40，
 *   而抽屉留在页面里时和它是【兄弟节点】——DOM 顺序上 TabBar 在后面，
 *   同层级下后来者居上，抽屉底部那排按钮会被底栏盖住点不到。
 *   钱包抽屉之前就压在底栏下面（"取消/删除"那一行要滑一下才够得着）。
 */
function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        // pb-8 + safe-bottom 会打架（两条都是 padding-bottom，后写的赢）——直接算成一个值
        style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** 关注列表。原来是个页签，挪到「关注」这一栏数字上——TikTok 就是点数字进列表，
 *  页签的位置留给作品/卡片这些"内容"更值 */
function FollowingSheet({
  names,
  videos,
  onClose,
}: {
  names: string[];
  videos: VideoItem[];
  onClose: () => void;
}) {
  useAccountVersion(); // 就地取消关注后这一列要立刻变灰
  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-100">关注 {names.length}</h3>
        <button onClick={onClose} className="text-slate-400" aria-label="关闭">
          <Icon name="close" size={20} />
        </button>
      </div>
      {names.length === 0 && <p className="py-10 text-center text-sm text-slate-500">还没有关注任何创作者</p>}
      <div className="space-y-1">
        {names.map((a) => (
          <div key={a} className="flex items-center gap-3 rounded-xl p-2">
            {/* 关注列表里存的是**作者名**（本地模型的历史包袱）。能反查到 id 就按 id 跳，
                反查不到才退回名字 —— 规则仍然只有 profileHref 那一处 */}
            <Link
              to={profileHref({ id: authorIdOfName(a), name: a })}
              onClick={onClose}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <Avatar name={a} size={40} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-100">{a}</span>
                <span className="block text-[11px] text-slate-500">
                  {videos.filter((v) => v.author === a).length} 支作品
                </span>
              </span>
            </Link>
            <button
              onClick={() => toggleFollow(a)}
              className={`flex-none rounded-full px-3 py-1.5 text-xs ${
                isFollowing(a) ? "bg-slate-700 text-slate-300" : "bg-brand font-bold text-ink"
              }`}
            >
              {isFollowing(a) ? "已关注" : "关注"}
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

/**
 * 草稿操作单：选模式打开 / 重命名 / 删除。
 * 两个模式都列出来而不是直接进上次那个——用户存的时候在工作流里，再打开时想去桌面上
 * 改剧情是很正常的需求；上次用的那个标成「上次」，省得每次都要想。
 */
function DraftSheet({ meta, onClose }: { meta: WorkDraftMeta; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(meta.title);

  async function open(mode: DraftMode) {
    setBusy("打开中…");
    const full = await loadDraft(meta.id);
    if (!full) {
      // 索引里有、正文没了（配额清理/手动清过库）：把这条索引也清掉，别让用户对着点不开的卡片反复点
      setBusy("这条草稿的内容已丢失，已从列表移除");
      await deleteDraft(meta.id);
      setTimeout(onClose, 1600);
      return;
    }
    useStudio.getState().openWorkDraft(full, mode);
    navigate(mode === "studio" ? "/studio" : "/flow");
  }

  return (
    <Sheet onClose={onClose}>
      {renaming ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
          />
          <button
            onClick={() => void renameDraft(meta.id, name).then(() => setRenaming(false))}
            className="rounded-xl bg-brand px-4 text-sm font-bold text-ink"
          >
            改名
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-bold text-slate-100">{meta.title}</h3>
          <button onClick={() => setRenaming(true)} className="flex-none text-xs text-slate-400">
            重命名
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        {meta.segCount} 段 · 已出片 {meta.doneCount} · {relativeTime(meta.updatedAt)}改过
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => void open("studio")}
          disabled={!!busy}
          className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-left disabled:opacity-50"
        >
          <div className="text-sm font-bold text-amber-200">🎴 工坊模式</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            3D 桌面摆卡、推演走向{meta.lastMode === "studio" && " · 上次"}
          </div>
        </button>
        <button
          onClick={() => void open("flow")}
          disabled={!!busy}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-3 text-left disabled:opacity-50"
        >
          <div className="text-sm font-bold text-cyan-200">🧩 工作流模式</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            一屏一段、逐段生成{meta.lastMode === "flow" && " · 上次"}
          </div>
        </button>
      </div>
      {busy && <div className="mt-2 text-center text-xs text-slate-400">{busy}</div>}

      <div className="mt-3 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200">
          取消
        </button>
        <button
          onClick={() => void deleteDraft(meta.id).then(onClose)}
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300"
        >
          删除
        </button>
      </div>
    </Sheet>
  );
}

/** 钱包抽屉：余额 + 套餐订阅 + 直充包。
 *
 *  ★ 余额的权威值在服务端（2026-08 把钱包从 IndexedDB 搬过去了）。打开抽屉时主动拉一次：
 *    平时靠每个 /api/ark 响应头顺带同步就够了，但"换台设备充了值"这种情况没有响应头
 *    可搭便车，不主动拉就会一直显示旧数字。
 *
 *  ★★ 买东西**不再是点一下就到账**。远端模式下按钮只负责下单，真正发币发生在
 *    支付渠道回调服务端之后。而且现在一个渠道都没接，所以正常路径就是
 *    「下单成功 + 没法付款」—— 这话必须原样说给用户，不能拿个 200 冒充充值成功。 */
function WalletSheet({ onClose }: { onClose: () => void }) {
  useAccountVersion();
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<{ text: string; orderNo?: string; tone: "ok" | "warn" | "bad" } | null>(
    null,
  );
  // 服务端有没有可用的支付渠道。null = 还没问到（离线模式问不到，按"能买"处理，
  // 因为离线模式的加数是本地行为，本来就立即生效）
  const [payable, setPayable] = useState<boolean | null>(null);
  /** 正在盯的订单号（下完单就开始轮询，结算/失败/超时都会停） */
  const [watching, setWatching] = useState<string | null>(null);

  useEffect(() => {
    void refreshRemoteWallet();
    if (!API_ON) return;
    void fetchPayConfig()
      .then((c) => setPayable(c.payable))
      .catch(() => setPayable(null)); // 问不到就不下结论，别误报成"不能买"
  }, []);

  /**
   * 盯着订单等结算。
   *
   * ★ 为什么必须有：付款发生在**别的地方**（渠道的收银台、甚至另一台设备），
   *   回到 app 时没有任何东西会通知我们。不轮询的话余额要等到下次打开钱包
   *   （或下一次 /api/ark 响应捎回 X-Wallet-* 头）才更新 —— 用户付完钱回来一看
   *   余额没变，只会以为钱丢了。
   * ★ 4 秒一次、最多 2 分钟：再久就不是"刚付完"而是异步补单了，那种情况下次进
   *   钱包自然会看到。定时器在依赖变化和卸载时都清掉，抽屉关了不留后台轮询。
   */
  useEffect(() => {
    if (!watching) return;
    let stop = false;
    let n = 0;
    const timer = window.setInterval(() => {
      if (stop) return;
      n += 1;
      if (n > 30) {
        window.clearInterval(timer);
        return;
      }
      void fetchOrder(watching)
        .then(async (r) => {
          if (stop) return;
          if (r.order.status === "settled") {
            window.clearInterval(timer);
            setWatching(null);
            await refreshRemoteWallet();
            setOrder({ text: `已到账 ${fmtTokens(r.order.grantedTokens)} token`, tone: "ok" });
          } else if (r.order.status === "failed" || r.order.status === "closed") {
            window.clearInterval(timer);
            setWatching(null);
            setOrder({
              text: r.order.status === "failed" ? "支付未成功，额度未到账" : "订单已关闭",
              orderNo: r.order.orderNo,
              tone: "bad",
            });
          }
        })
        .catch(() => {
          /* 单次查单失败不结束轮询：网络抖一下不该让用户以为充值失败了 */
        });
    }, 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [watching]);

  /** 下单并把结果如实显示出来。到账了才刷新余额 */
  async function submit(run: () => Promise<RechargeResult>) {
    setBusy(true);
    setOrder(null);
    try {
      const r = await run();
      if (!r.ok) {
        setOrder({ text: r.message, tone: "bad" });
      } else if (r.credited) {
        setOrder({ text: "已到账", tone: "ok" });
      } else {
        setOrder({
          text: r.payable
            ? `${r.message}。付款完成后额度会自动到账，这里的余额也会跟着更新。`
            : "订单已创建，但本服务还没接入支付渠道，暂时无法完成付款——额度不会到账。",
          orderNo: r.orderNo,
          tone: r.payable ? "warn" : "bad",
        });
        if (r.payable === false) setPayable(false);
        // 能付的才值得盯：一个渠道都没接时轮询到天荒地老也不会变
        if (r.payable && r.orderNo) setWatching(r.orderNo);
      }
      await refreshRemoteWallet();
    } finally {
      setBusy(false);
    }
  }

  const wallet = walletOf();
  // 远端模式下镜像可能还在路上。★ 不能 return null —— 那会表现成"点了钱包没反应"，
  // 而用户完全没法区分"在加载"和"坏了"
  if (!wallet)
    return (
      <Sheet onClose={onClose}>
        <div className="py-10 text-center text-sm text-slate-500">正在读取余额…</div>
      </Sheet>
    );
  return (
    <Sheet onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-100">⚡ Token 钱包</h3>
        <button onClick={onClose} className="text-slate-400" aria-label="关闭">
          <Icon name="close" size={20} />
        </button>
      </div>

      {/* ★ 管理员在「我的」页看到的是 ∞，这里却是镜像里的真实数字 —— 不把两边的关系
          说清楚，看起来就像其中一边坏了。数字照常显示（它是服务端的真值，不藏），
          下单按钮也照常能点：入口保留是为了测支付流程，不是给自己续费。 */}
      {billingExempt() && (
        <div className="mb-3 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-[11px] leading-relaxed text-slate-300">
          管理员账号无需充值：AI 生成走免扣费通道，不从下面的余额里扣。余额与下单入口保留，仅用于测试支付流程。
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-panel p-3">
          <div className="text-lg font-bold tabular-nums text-slate-100">{fmtTokens(wallet.plan)}</div>
          <div className="text-[11px] text-slate-500">套餐 token · 优先扣减</div>
        </div>
        <div className="rounded-xl bg-panel p-3">
          <div className="text-lg font-bold tabular-nums text-gold">{fmtTokens(wallet.addon)}</div>
          <div className="text-[11px] text-slate-500">add-on token · 直充/创作收益</div>
        </div>
      </div>

      {/* ★ 下单结果必须如实显示。远端模式下点这些按钮**只是下单**，钱一分没付、
          余额一分没变；而且现在服务端一个支付渠道都没接，这单根本付不了。
          原来这里写的是"额度立即发放，演示模拟支付"、点完就刷新余额 ——
          接了真订单之后那句话就成了谎话（铁律八：宁可难看，不要骗人）。 */}
      {order && (
        <div
          className={`mb-3 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed ${
            order.tone === "warn"
              ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
              : order.tone === "bad"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                : "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {order.text}
          {order.orderNo && <div className="mt-1 font-mono text-[10px] opacity-70">订单号 {order.orderNo}</div>}
        </div>
      )}

      <div className="mb-1.5 text-xs font-semibold text-slate-300">订阅套餐</div>
      <div className="mb-4 space-y-2">
        {PLANS.map((p) => {
          const current = wallet.planId === p.id;
          return (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-panel p-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-slate-100">
                  {p.name}
                  {current && <span className="ml-1.5 rounded bg-brand/20 px-1.5 py-0.5 text-[9px] text-brand">当前</span>}
                </div>
                <div className="text-[11px] text-slate-500">
                  {fmtTokens(p.monthlyTokens)} token/月 · {p.desc}
                </div>
              </div>
              <button
                onClick={() => void submit(() => buyPlan(p.id))}
                disabled={busy || (p.price === 0 && current)}
                className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
              >
                {p.price === 0 ? (current ? "已领取" : "领取") : `¥${p.price}/月`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mb-1.5 text-xs font-semibold text-slate-300">直充 add-on（永不过期，套餐扣完才用它）</div>
      <div className="grid grid-cols-3 gap-2">
        {RECHARGE_PACKS.map((pk) => (
          <button
            key={pk.tokens}
            onClick={() => void submit(() => rechargeAddon(pk.tokens))}
            disabled={busy}
            className="rounded-xl border border-slate-700/60 bg-panel p-3 text-center disabled:opacity-50"
          >
            <div className="text-sm font-bold tabular-nums text-slate-100">{fmtTokens(pk.tokens)}</div>
            <div className="mt-0.5 text-[11px] text-gold">¥{pk.price}</div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-600">
        {payable === false
          ? "本服务尚未接入支付渠道，下单后无法完成付款"
          : "付款成功后额度自动到账；若长时间未到账请在订单里核对"}
      </p>
    </Sheet>
  );
}

function Empty({ text, cta, to }: { text: string; cta?: string; to?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <p className="text-sm text-slate-500">{text}</p>
      {cta && to && (
        <Link to={to} className="rounded-full bg-panel px-4 py-2 text-xs text-slate-300">
          {cta}
        </Link>
      )}
    </div>
  );
}
