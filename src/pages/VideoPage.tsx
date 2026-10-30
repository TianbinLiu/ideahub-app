// 视频详情页（2026-10-26 视频详情页 P0 重排，对标 B 站 / 抖音的作品页；设计与量数在 docs/video-detail-redesign-2026-10.md）：
// 顶栏（分享 · ⋯）→ 满宽播放器（倍速 / 弹幕 / 全屏）→ 弹幕条 → 横幅 → 标题统计徽标 → 作者条（关注 / 编辑）→ 动作条（赞 · 评 · 藏 · 分享 · 举报）
// → 选集 / 互动结构 → 评论预览卡 → 做你自己的版本（components/video/RemakeCard）→ 相关区（RelatedWorks）；吸底栏（VideoDock）是全页唯一的实心主键「做同款」。
// ★ 评论只有 CommentSheet 一份（原来页内还平铺了一份评论区和输入框，与抽屉各写一套）；做同款只有 hooks/useRemake 一份；全屏只有 hooks/useImmersive 一份。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import Warn from "../components/Warn";
import Spinner from "../components/Spinner";
import PageHeader from "../components/PageHeader";
import { takedownReasonText } from "../api/admin";
import { getUser } from "../api/users";
import AigcBadge, { isAigcWork } from "../components/AigcBadge";
import SeedBadge from "../components/SeedBadge";
import Icon from "../components/Icon";
import { CloseButton, IconTapButton } from "../components/IconTapButton";
import BranchPlayer from "../components/BranchPlayer";
import SegmentPlayer from "../components/SegmentPlayer";
import { PORTRAIT_MAX_VH, type PlayerOverlay } from "../components/playerFrame";
import Avatar from "../components/Avatar";
import MentionText from "../components/MentionText";
import ShareSheet from "../components/ShareSheet";
import DownloadSheet from "../components/DownloadSheet";
import ReportButton, { canReport } from "../components/ReportButton";
import FeedActionSheet, { type FeedSpeed } from "../components/FeedActionSheet";
import CommentSheet from "../components/CommentSheet";
import DanmakuLayer from "../components/DanmakuLayer";
import DanmakuInput from "../components/DanmakuInput";
import DanmakuGlyph from "../components/DanmakuGlyph";
import RemakeCard from "../components/video/RemakeCard";
import RelatedWorks from "../components/video/RelatedWorks";
import VideoDock from "../components/video/VideoDock";
import { hasPurchased, isCollected, isFollowing, purchasePart, setCollect, setFollow, walletOf } from "../data/account";
import { fmtTokens, priceTag } from "../data/economy";
import {
  addPlay,
  authorAvatarOf,
  authorDisplayName,
  commentAvatarOf,
  commentCountOf,
  commentsStatus,
  fetchVideoById,
  getVideo,
  isLiked,
  isMyVideo,
  isSeedWork,
  partsOf,
  profileHref,
  remoteOn,
  retryComments,
  setLike,
  type VideoLookup,
} from "../data/videos";
import {
  danmakuFetched,
  danmakuTotal,
  danmakuNeedsLogin,
  danmakuOf,
  danmakuOn,
  danmakuSessionPending,
  danmakuVersion,
  isTruncated,
  setDanmakuOn,
  subscribeDanmaku,
} from "../data/danmaku";
import { markNotificationRead } from "../data/notifications";
import { showToast } from "../data/toast";
import { downloadSupport, planDownload } from "../data/videoDownload";
import { useAccountVersion, useAuthState, useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import { useBackOr } from "../hooks/useBackOr";
import { useRemake } from "../hooks/useRemake";
import { useImmersive } from "../hooks/useImmersive";
import { aspectCss, formatPlays, relativeTime, revisionLabel, videoCategoryLabel, type VideoAspect } from "../types";

/**
 * 路由那一层按 id 重挂（2026-10-26 视频详情页 P0-4，审核）：从 /video/A 点进 /video/B（相关区、同款署名）时还是同一个组件实例 ——
 * 点赞 / 播放数会取两条里较大的那个、选集 / 横幅 / 分支走向原样带过去、两边都是第 1 集时播放器接着 A 的进度往下播。按 id 重挂就一样都不带。
 */
export function VideoRoute() {
  const { id } = useParams<{ id: string }>();
  return <VideoPage key={id ?? ""} />;
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const loc = useLocation();
  // ★ 返回键：有上一页就回去（个人页 / 分区 / 通知点进来的回原处，原来一律 navigate("/")），
  //   分享链接冷启动没有上一页才退回首页；「不存在」那一屏的返回也是这一份，别再手抄 history.state.idx
  const back = useBackOr("/");
  const user = useCurrentUser();
  const auth = useAuthState();
  const { t } = useLingui();
  // 订阅作品库：远端模式下 getVideo() 会在后台补一次详情接口（列表不带 comments），
  // 回填是原地改同一个对象，不订阅就永远渲染不出来。
  const version = useVideosVersion();
  const video = useMemo(() => (id ? getVideo(id) : null), [id, version]);
  // ★★ 「我赞没赞过」的唯一真相是 `videos.isLiked`（2026-08-31 修）。恒从 false 起的后果：进已赞过的作品显示空心（数字里含着自己那票），
  //   点一下撞上 `videos.setLike` 里的幂等短路 —— 不发请求、数字纹丝不动，只有图标变红；再点一下**把自己的赞取消了**。全程零报错。
  // ⚠ 不能照抄 FeedPage 的 lazy 初值：这条路上挂载时 `video` 还是 null、远端模式下 `likedIds` 也要等 `loadDetail` 回包才填 —— 真正的同步点在下面那个回填 effect。
  const [liked, setLiked] = useState(() => (id ? isLiked(id) : false));
  const [likes, setLikes] = useState(video?.likes ?? 0);
  const [plays, setPlays] = useState(video?.plays ?? 0);
  // 多 P：老作品 partsOf 归一成单 P，pi 越界（编辑删 P 后）自动夹回
  const parts = useMemo(() => (video ? partsOf(video) : []), [video, version]);
  const [pi, setPi] = useState(0);
  const piSafe = Math.min(pi, Math.max(0, parts.length - 1));
  const part = parts[piSafe] ?? null;
  // 付费墙：本 P 定价 > 0 且 观众≠作者 且 未购 → 用封面顶住播放器，解锁后放行
  useAccountVersion(); // 购买/余额变化即时反映
  const partPrice = video?.pricing?.mode === "paid" ? (video.pricing.partPrices[piSafe] ?? 0) : 0;
  // ★★ 按 **userId** 判本人（isMyVideo），不是按展示名（isMyAuthor）：展示名允许重名、也能随手改成作者的昵称，而这一格是**付费墙** ——
  //   判错的方向是白看付费内容。同一条闸还传导给「保存到本地」（videoDownload.planDownload 的 ① 明写靠这里）。
  const locked = !!video && partPrice > 0 && !isMyVideo(video) && !hasPurchased(video.id, piSafe);
  // 做同款 = 第八条整表覆盖入口：照**当前这一 P** 的分段剧本铺（hooks/useRemake，与首页同一份；守卫、付费没解锁不给、被拒那句话自清都在里面）
  const { canRemake, remake, err: remakeErr, dialog: remakeDialog } = useRemake(video, part?.segments ?? video?.segments ?? [], locked);
  // 做同款的键在吸底栏上，而那句被拒的话画在页中间的 RemakeCard 里（多半不在屏上）：另用轻提示说一遍（2026-10-29 发版前复核）
  useEffect(() => {
    if (remakeErr) showToast(remakeErr);
  }, [remakeErr]);
  const [payErr, setPayErr] = useState("");
  /** 分享面板（与首页右侧栏那颗共用 ShareSheet 一份实现） */
  const [shareOpen, setShareOpen] = useState(false);
  /** 「保存到本地」面板。★ 关掉它**不停**下载（队列在 data/videoDownload 里，胶囊接管） */
  const [dlOpen, setDlOpen] = useState(false);
  /** 被 planDownload 就地拒时那句整句话（画在横幅那一带） */
  const [dlBlocked, setDlBlocked] = useState("");
  /** 观众刚看的那条走向（互动作品）。BranchPlayer 报上来，「只存刚看的走向」按它取段，弹幕挂不挂也看它在不在开场段上。
   *  ★ 线性作品恒空数组 */
  const [branchPath, setBranchPath] = useState<string[]>([]);
  /** 顶栏 ⋯ 打开的「更多操作」（倍速 / 全屏 / 保存 / 举报 / 拉黑，与首页长按那一份共用 FeedActionSheet） */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 倍速：这一页自己持有，不落盘（与首页同一个口径：下次打开回到 1×，免得人忘了自己调过） */
  const [speed, setSpeed] = useState<FeedSpeed>(1);
  /** 评论抽屉：null = 关着；autoFocus = 从吸底栏「说点什么…」点进来（要写），从动作条 / 评论卡点进来（先看）为 false */
  const [cmt, setCmt] = useState<{ autoFocus: boolean } | null>(null);
  /** 弹幕输入条 */
  const [dmOpen, setDmOpen] = useState(false);
  // 弹幕开关与条数：订阅弹幕库（远端到货 / 开关一拨都要重画）
  useSyncExternalStore(subscribeDanmaku, danmakuVersion, () => 0);
  const dmOn = danmakuOn();
  /** 播放器报上来的全片秒数（弹幕输入条按它落点；取值函数读 ref，别被闭包定在打开那一瞬间） */
  const timeRef = useRef(0);
  /** 标题区展开了没有（两行折叠 → 全文 + 话题） */
  const [expanded, setExpanded] = useState(false);
  /** 正文那个标题滚出视口之后，顶栏才写标题 */
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleOff, setTitleOff] = useState(false);
  /** 作者粉丝数（lazy 取；没回来 / 老服务端不画，不编数） */
  const [fans, setFans] = useState<number | null>(null);
  const [followErr, setFollowErr] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [saved, setSaved] = useState(() => (id ? isCollected(id) : false));
  const [saveErr, setSaveErr] = useState("");
  /** 播放器外框（沉浸 / 全屏态挂在它身上）。画幅取这一 P 第一段（互动作品取开场段） */
  const playerRef = useRef<HTMLDivElement>(null);
  const aspect: VideoAspect = (part?.branchTree ? part.branchTree.nodes[part.branchTree.rootId]?.segment.aspect : part?.segments[0]?.aspect) ?? "landscape";
  const { immersive, enter: enterFull, exit: exitFull } = useImmersive(playerRef, aspect);

  // 详情回填晚于首帧渲染：把服务端那份同步进来。本地已有的乐观值（刚点的赞）取较大的一边，别被回包覆盖掉。
  // ★ 只在同一条作品之内取较大值：路由层按 id 重挂（VideoRoute），换作品不会把上一条的数带过来
  // 点赞没记上时 data 层回滚并 emit（videos.setLike）：跟着 version 重读，心退回去（2026-10-30）
  useEffect(() => {
    if (video) setLiked(isLiked(video.id));
  }, [version, video?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!video) return;
    setLiked(isLiked(video.id)); // 回填晚于首帧：远端模式下 liked 由详情回包填进 likedIds
    setLikes((v) => Math.max(v, video.likes));
    setPlays((v) => Math.max(v, video.plays));
    setSaved(isCollected(video.id));
  }, [video, version]);

  // per-id 去重：StrictMode 双跑 effect 也只 +1，并把新计数渲染出来
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (id && video && counted.current !== id) {
      counted.current = id;
      setPlays(addPlay(id));
    }
  }, [id, video]);

  // 新进一条作品回到页顶（路由层按 id 重挂；从相关区点进来时滚动位置还停在页底）
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "start" });
  }, []);

  /**
   * 内存里没有这一条时**去问服务端**。
   * ★★ 内存 cache 只有推荐流的前 30 条，而进到这一页的路（通知里的 @、别人主页的作品墙、分享出去的链接）指向的作品**基本都不在里面**。
   * ★ 结果分四档（见 data/videos.VideoLookup）：查证之前一律显示"正在打开"，只有服务端真的说了"没有"才敢说不存在；超时/断网说的是"没打开"。
   */
  const [lookup, setLookup] = useState<VideoLookup | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLookup(null);
    void fetchVideoById(id).then((r) => {
      if (alive) setLookup(r);
    });
    return () => {
      alive = false;
    };
  }, [id, retry]);

  /**
   * 从通知点进来的那一条：**打开成功了才标已读**（这一跳可能落在「不存在」上：用户既没看到内容、红点也没了，唯一的入口就这么消失了）。
   */
  const readMarked = useRef<string | null>(null);
  const fromNotification = (loc.state as { fromNotification?: string } | null)?.fromNotification;
  /** 从别的页带过来的一句成功话（现在只有"回炉替换成功"用它）。进本页那一拍取一次就够（lazy 初值：每次渲染读 loc.state 的话关不掉） */
  const [navBanner, setNavBanner] = useState<string>(() => (loc.state as { banner?: string } | null)?.banner ?? "");
  useEffect(() => {
    if (!video || !fromNotification || readMarked.current === fromNotification) return;
    readMarked.current = fromNotification;
    void markNotificationRead(fromNotification);
  }, [video, fromNotification]);

  // 顶栏标题：正文那个标题滚出视口才写（首屏已经有一个大标题，顶栏再写一遍是重复）
  const hasVideo = !!video;
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => setTitleOff(es.every((e) => !e.isIntersecting)), { rootMargin: "-60px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasVideo]);

  // 作者粉丝数：远端模式、知道作者 id 时问一次；老服务端 / 没回来就不画（不编数）
  const remoteLive = remoteOn();
  const authorId = video?.authorId ?? "";
  useEffect(() => {
    if (!remoteLive || !authorId) return;
    let alive = true;
    void getUser(authorId).then((r) => {
      if (alive && r.status === "ok" && typeof r.user.followerCount === "number") setFans(r.user.followerCount);
    });
    return () => {
      alive = false;
    };
  }, [remoteLive, authorId]);

  // 上一次进来详情没问到（commentsState = failed）：getVideo 不再自己重问（那会在失败时死循环），进页那一拍问一次
  useEffect(() => {
    if (remoteLive && hasVideo && id && commentsStatus(id) === "failed") retryComments(id);
  }, [remoteLive, hasVideo, id]);

  if (!video) {
    // ★ 还没问出结果：不下任何结论。转圈比一句错的结论好
    if (!lookup) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
          <Spinner size="lg" />
          <div className="text-xs"><Trans>正在打开这条作品…</Trans></div>
        </div>
      );
    }
    const failErr = lookup.status === "failed" ? lookup.error : "";
    const text =
      lookup.status === "missing"
        ? t`这条作品不存在，或已被作者删除`
        : lookup.status === "offline"
          ? t`这台设备上没有这条作品 · 当前是离线模式`
          : t`没能打开这条作品：${failErr}`;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-slate-400">
        <div className={lookup.status === "failed" ? "text-sm text-danger-300" : "text-sm"}>{text}</div>
        {lookup.status === "failed" && (
          <>
            {/* 失败可以，但要能自己重试 —— 而且这一条**没被标已读**，消息页那个红点还在 */}
            <button
              onClick={() => setRetry((n) => n + 1)}
              className="rounded-xl bg-panel px-5 py-2.5 text-sm font-semibold text-slate-100 ring-1 ring-slate-700"
            >
              <Trans>重试</Trans>
            </button>
            <p className="text-[11px] leading-relaxed text-slate-400">
              <Trans>内容可能还在，只是这次没取到（网络或服务器的问题）</Trans>
            </p>
          </>
        )}
        {/* ★ 这一屏没有顶栏，所以「回去」必须自己给一个 */}
        <div className="flex items-center gap-4">
          <button onClick={back} className="text-slate-300">
            <Trans>返回</Trans>
          </button>
          <Link to="/" className="text-brand">
            <Trans>返回首页</Trans>
          </Link>
        </div>
      </div>
    );
  }

  // 「能不能保存到本地」的判据只有 `data/videoDownload.planDownload` 一处 —— 这里只是把它的答案画出来。
  const dlSupported = downloadSupport().ok;
  // ★ 门禁问的是「这条作品能不能存」，与"观众刚看到哪儿"无关，所以用 `scope: "all"` 问（用 "path" 问首帧那一拍 branchPath 还是 []，互动作品会被判成没有成片）
  const dlCheck = planDownload(video, piSafe, { scope: "all", branchPath });
  const dlBlockedNow = dlCheck.ok ? null : dlCheck.blocked;
  const openSave = () => {
    setDlBlocked("");
    if (dlBlockedNow) setDlBlocked(dlBlockedNow);
    else setDlOpen(true);
  };
  const tree = part?.branchTree ?? null;
  const branchPoints = tree ? Object.values(tree.nodes).filter((n) => n.choices.length > 1).length : 0;
  const endings = tree ? Object.values(tree.nodes).filter((n) => n.choices.length === 0).length : 0;
  const mine = isMyVideo(video);
  /** 现在正放开场那一段（弹幕只挂在开场段上，与首页同一个时间轴）。线性作品恒为真 */
  const onRoot = !tree || branchPath.length === 0 || branchPath[branchPath.length - 1] === tree.rootId;
  /** 弹幕摆不摆：解锁了、多 P 老作品只在第 1 集（弹幕是挂在作品上的全片秒，不分集） */
  const dmHere = !locked && piSafe === 0;
  const dmFetched = danmakuFetched(video.id);
  // 条数：服务端给了总数（2026-10-29 起）就写总数（拉黑的人不算，与列表同一个过滤）；老服务端退回手上的条数、截断过写「n+」
  const dmTotal = danmakuTotal(video.id);
  const dmCount = dmTotal ?? danmakuOf(video.id).length;
  const dmTrunc = dmTotal === null && isTruncated(video.id);
  const lanes = aspect === "landscape" ? 3 : 4;
  const overlay: PlayerOverlay =
    dmHere && dmOn
      ? (c) => {
          timeRef.current = c.time;
          return c.onRoot ? <DanmakuLayer videoId={video.id} time={c.time} paused={c.paused} top="8px" lanes={lanes} /> : null;
        }
      : dmHere
        ? (c) => {
            timeRef.current = c.time;
            return null;
          }
        : null;
  const frame = immersive ? "full" : "bleed";
  const onFull = locked ? null : () => void enterFull();
  /** 评论卡上那一条：第一条顶层评论（服务端按 createdAt 倒序） */
  const firstComment = video.comments.find((c) => !c.parentId) ?? null;
  const cStatus = commentsStatus(video.id);
  const cCount = commentCountOf(video);
  /** 动作条第五格：能举报就是举报（canReport 与 ReportButton 那道闸同一个判据），否则原生壳里放「保存」，都不行就四格 */
  const reportCell = canReport({ mine, targetId: video.id });
  const saveCell = !reportCell && dlSupported;

  function toggleLike() {
    if (!video) return;
    const on = !liked;
    setLiked(on);
    setLikes(setLike(video.id, on));
  }

  async function follow() {
    if (!video || followBusy) return;
    if (auth === "pending") return;
    if (auth === "out") {
      navigate(`/login?next=/video/${video.id}`);
      return;
    }
    setFollowErr("");
    setFollowBusy(true);
    const on = !isFollowing(video.author);
    const why = await setFollow(video.author, on);
    setFollowBusy(false);
    if (why) setFollowErr(on ? t`关注没成功：${why}` : t`取消关注没成功：${why}`);
    // 粉丝数是进页时问的那一份：成了就跟着 ±1（不再问一次服务器）
    else setFans((n) => (n === null ? n : Math.max(0, n + (on ? 1 : -1))));
  }

  async function collect() {
    if (!video) return;
    // 收藏要认人：未登录先去登录；但"还不知道"不算未登录 —— 那一段先等着，别把登录着的人弹去登录页
    if (auth === "pending") return;
    if (auth === "out") {
      navigate(`/login?next=/video/${video.id}`);
      return;
    }
    setSaveErr("");
    const on = !saved;
    setSaved(on);
    const why = await setCollect(video.id, on);
    if (why) {
      setSaved(!on);
      setSaveErr(on ? t`收藏没成功：${why}` : t`取消收藏没成功：${why}`);
    }
  }

  function openDanmaku() {
    if (!video) return;
    // 与首页同一个口径：还不知道登没登录先等着；没登录（远端模式要账号）去登录
    if (danmakuSessionPending()) return;
    if (danmakuNeedsLogin()) {
      navigate(`/login?next=/video/${video.id}`);
      return;
    }
    setDmOpen(true);
  }

  const following = isFollowing(video.author);
  const authorName = authorDisplayName(video.author, video.authorId);
  const cell = "flex min-h-[52px] flex-col items-center justify-center gap-0.5 active:opacity-60";

  return (
    <div ref={rootRef} className="min-h-full pb-28">
      {/* ★ safe-top 挂在 header 自己身上（PageHeader 里）：header 是 sticky top-0，安全区留白必须在它内部 */}
      <PageHeader
        sticky
        onBack={back}
        title={titleOff ? video.title : ""}
        titleClassName="text-sm font-normal text-slate-300"
        right={
          <>
            {/* ★★ 分享入口：发布成功之后落到的就是这一页，App 里也没有地址栏 —— 刚发完片的人只有这一个门把它给别人看 */}
            <IconTapButton icon="share" label={t`分享或保存这条作品`} size={20} onClick={() => setShareOpen(true)} />
            <IconTapButton icon="ellipsis" label={t`更多操作`} size={20} align="end" onClick={() => setMenuOpen(true)} />
          </>
        }
      />

      <main className="mx-auto max-w-5xl">
        {/* ── 播放器：满宽、不圆角（详情页的外框 bleed）；沉浸 / 全屏态铺满（full）──
            ★ 沉浸态里也要有「AI 生成」标识（生成侧那一顶帽子：起始画面 + 播放周边，data/aigcLabel；全屏里播放周边只剩画面本身） */}
        <div
          ref={playerRef}
          className={immersive ? "fixed inset-0 z-[80] flex items-center justify-center bg-black" : "relative"}
        >
          {part &&
            (locked ? (
              // 付费墙：封面 + 解锁按钮（满宽、不圆角，按作品画幅占位 —— 解锁前后高度不跳）
              <div className="relative overflow-hidden bg-black" style={{ aspectRatio: aspectCss(aspect), maxHeight: aspect === "portrait" ? `${PORTRAIT_MAX_VH}vh` : undefined }}>
                <img src={video.cover} alt={video.title} className="h-full w-full object-cover blur-[2px] brightness-50" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                  <Icon name="lock" size={24} className="text-slate-200" />
                  <div className="text-sm font-semibold text-slate-100">
                    <Trans>本 P 为付费内容 · <span className="tabular-nums text-gold">{fmtTokens(partPrice)} token</span></Trans>
                  </div>
                  <button
                    onClick={() => {
                      setPayErr("");
                      // ★ 会话还没结论时别把人弹去登录页：这一步是**花钱**的，"我明明登录着却被要求重新登录"最像被骗
                      if (auth === "pending") {
                        setPayErr(t`正在确认登录状态，稍等一下再点。`);
                        return;
                      }
                      if (!user) {
                        navigate(`/login?next=/video/${video.id}`);
                        return;
                      }
                      if (!purchasePart(video.id, piSafe, partPrice, video.author)) {
                        const w = walletOf();
                        const have = fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0));
                        setPayErr(t`余额不足（现有 ${have}）——去「我的」页充值`);
                      }
                    }}
                    className="rounded-full bg-gold px-5 py-2 text-sm font-bold text-ink active:scale-95"
                  >
                    {priceTag(partPrice)} <Trans>解锁观看</Trans>
                  </button>
                  {payErr && (
                    <Link to="/me" className="text-xs text-danger-300 underline underline-offset-2">
                      {payErr}
                    </Link>
                  )}
                  <span className="text-[10px] text-slate-400"><Trans>解锁后永久可看</Trans></span>
                </div>
              </div>
            ) : tree ? (
              <BranchPlayer key={`b${pi}`} tree={tree} cover={video.cover} onPathChange={setBranchPath} frame={frame} rate={speed} overlay={overlay} onFull={immersive ? null : onFull} />
            ) : (
              <SegmentPlayer key={`s${pi}`} segments={part.segments} cover={video.cover} frame={frame} rate={speed} overlay={overlay} onFull={immersive ? null : onFull} />
            ))}
          {immersive && (
            <>
              <div className="safe-top absolute left-2 top-2 z-10">
                <CloseButton chip="md" size={16} label={t`退出全屏`} onClick={exitFull} />
              </div>
              {isAigcWork(video) && (
                <span className="safe-top absolute right-3 top-3 z-10">
                  <AigcBadge tone="overlay" />
                </span>
              )}
            </>
          )}
        </div>

        {/* ── 弹幕条：只在解锁了的第 1 集上 ── */}
        {dmHere && (
          <div className="flex h-10 items-center gap-2 border-b border-slate-700/60 px-4">
            {/* 条数在服务端那一份回来之前不写（「弹幕 0」是一句可能是错的话，danmakuFetched 一处判）；被服务端截断过写「n+」 */}
            <span className="min-w-0 flex-1 text-xs tabular-nums text-slate-400">
              {!dmFetched ? <Trans>弹幕</Trans> : dmTrunc ? <Trans>弹幕 {dmCount}+</Trans> : <Trans>弹幕 {dmCount}</Trans>}
            </span>
            <button
              onClick={() => setDanmakuOn(!dmOn)}
              aria-pressed={dmOn}
              aria-label={t`显示弹幕`}
              className={`flex-none p-1 ${dmOn ? "text-slate-200" : "text-slate-500"}`}
            >
              <DanmakuGlyph size={20} pen={false} off={!dmOn} />
            </button>
            {onRoot ? (
              <button onClick={openDanmaku} className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-400">
                <Trans>发条弹幕…</Trans>
              </button>
            ) : (
              // 互动作品进了分支：弹幕只挂在开场那一段上（与首页只播开场段同一个时间轴），不摆点不动的键
              <span className="flex-none text-[11px] text-slate-400">
                <Trans>弹幕只挂在开场那一段上</Trans>
              </span>
            )}
          </div>
        )}

        {/* ── 横幅带（下架 / 回炉成功 / 保存被拒）── */}
        <div className="space-y-3 px-4 empty:hidden [&:not(:empty)]:pt-3">
          {/* ★★ 被平台下架的横幅。**只有作者自己会走到这里** —— 别人的接口回包里根本没有这条作品。不给他一个字的解释，他最可能的下一步就是原样重发 */}
          {video.takedown && (
            <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 p-3">
              <p className="text-sm font-semibold text-danger-200"><Trans>这条作品已被平台下架</Trans></p>
              <p className="mt-1 text-xs leading-relaxed text-danger-100/80">
                {takedownReasonText(video.takedown.reason) || t`（管理员没有填写原因）`}
              </p>
              <p className="mt-1.5 text-[11px] text-slate-400">
                <Trans>只有你自己看得到它。把可见性改回公开也没用 —— 这是平台的开关，不是你的那一个。</Trans>
              </p>
            </div>
          )}
          {/* 回炉替换成功之后从发布页带过来的那句话。★ 可关：它是**事件**不是常驻状态 */}
          {navBanner && (
            <div className="flex items-start gap-2 rounded-xl border border-ok-500/40 bg-ok-500/10 px-3 py-2">
              <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ok-200">{navBanner}</p>
              <CloseButton chip="sm" size={13} align="end" label={t`知道了`} onClick={() => setNavBanner("")} />
            </div>
          )}
          {dlBlocked && (
            <div className="rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2">
              <Warn>{dlBlocked}</Warn>
            </div>
          )}
        </div>

        {/* ── 标题区 ── */}
        <div className="px-4 pt-3">
          <div className="flex items-start gap-2">
            <h1 ref={titleRef} className={`min-w-0 flex-1 text-base font-bold text-slate-100 ${expanded ? "" : "line-clamp-2"}`}>
              {video.title}
            </h1>
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? t`收起简介` : t`展开简介`}
              className="-m-2 flex-none p-2 text-slate-400"
            >
              <Icon name="chevron" size={18} className={`transition-transform ${expanded ? "-rotate-90" : "rotate-90"}`} />
            </button>
          </div>
          {/* 统计行：播放 · 发布时间（· 重新剪辑过）。中文整句用占位符，别在 relativeTime 后面拼中文（CLAUDE.md 那条） */}
          <p className="mt-1 text-xs tabular-nums text-slate-400">
            <span className="inline-flex items-center gap-0.5 align-middle">
              <Icon name="play" size={11} filled />
              {formatPlays(plays)}
            </span>
            {" · "}
            {relativeTime(video.createdAt)}
            {!!video.revisedAt &&
              (revisionLabel(video.revision) ? (
                <>
                  {" · "}
                  <Trans>{relativeTime(video.revisedAt)}重新剪辑过 · {revisionLabel(video.revision)}</Trans>
                </>
              ) : (
                <>
                  {" · "}
                  <Trans>{relativeTime(video.revisedAt)}重新剪辑过</Trans>
                </>
              ))}
          </p>
          {/* 徽标行：永远不折 —— 「AI 生成」是法定的「播放周边」标识，必须在首屏（components/AigcBadge 的 ★★） */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isAigcWork(video) && <AigcBadge />}
            {/* 「示例 · 离线」：没连上服务器时铺的演示作品（见 components/SeedBadge） */}
            {isSeedWork(video) && <SeedBadge />}
            {video.category && (
              <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300">{videoCategoryLabel(video.category)}</span>
            )}
            {tree && (
              <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] text-brand">
                <Trans>互动 · {branchPoints} 个分支点</Trans>
              </span>
            )}
          </div>
          {/* 简介只在展开后出现（照 B 站作品页）：折叠时也摆两行的话，竖屏作品在真机上（状态栏 41px、手势条）把动作条挤到吸底栏底下 ——
              量数在 components/playerFrame.PORTRAIT_MAX_VH 上 */}
          {expanded && video.description && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{video.description}</p>}
          {/* 话题标签（展开后）。★ 可点：点了带着词去 /discover（那一页与服务端的搜索都已经把 tags 算进去了） */}
          {expanded && (video.tags ?? []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(video.tags ?? []).map((tag) => (
                <button key={tag} onClick={() => navigate("/discover", { state: { q: tag } })} className="rounded-full bg-brand/15 px-2.5 py-1 text-xs text-brand">
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── 作者条 ── */}
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Link to={profileHref({ id: video.authorId, name: video.author })} className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60">
            {/* 名字只翻 app 自己填的那几个（判据见 videos.authorDisplayName）；跳转、Avatar 的 name（取色）认的仍是 video.author 原值 */}
            <Avatar name={video.author} label={authorName} src={authorAvatarOf(video)} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-100">{authorName}</span>
              {fans !== null && (
                <span className="block text-[11px] tabular-nums text-slate-400">
                  <Trans>{formatPlays(fans)} 粉丝</Trans>
                </span>
              )}
            </span>
          </Link>
          {mine ? (
            // ★ 这里原来对「合并发布的成片」单独走一条"不可修改"的分支 —— 一视同仁给编辑入口；能不能回炉由编辑页按六条判据说，这里不预判
            <Link to={`/edit/${video.id}`} className="inline-flex flex-none items-center gap-1 rounded-full bg-panel px-3.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-700">
              <Icon name="pen" size={13} />
              <Trans>编辑</Trans>
            </Link>
          ) : auth !== "pending" ? (
            <button
              onClick={() => void follow()}
              disabled={followBusy}
              aria-pressed={following}
              className={`flex-none rounded-full px-3.5 py-1.5 text-xs disabled:opacity-40 ${
                following ? "bg-panel text-slate-400" : "bg-brand/15 font-semibold text-brand"
              }`}
            >
              {following ? <Trans>已关注</Trans> : <Trans>+ 关注</Trans>}
            </button>
          ) : null}
        </div>
        {followErr && <p className="-mt-1 px-4 pb-1 text-right text-[11px] text-danger-300">{followErr}</p>}

        {/* ── 动作条：点赞 · 评论 · 收藏 · 分享 · 举报（自己的作品 / 离线时第五格换成「保存」，都不行就四格）──
            ★ 类名写成字面量分支：Tailwind 扫不到拼出来的字符串 */}
        <div className={`grid border-y border-slate-700/60 py-1.5 ${reportCell || saveCell ? "grid-cols-5" : "grid-cols-4"}`}>
          {/* 切换键的两件事读屏才听得见（WCAG 2.2 · 4.1.2）：aria-pressed 说点过没有，名字只说这是哪颗键、**不随状态变**；数字留在名字里 */}
          <button onClick={toggleLike} aria-pressed={liked} aria-label={t`点赞 · ${likes}`} className={cell}>
            <Icon name="heart" size={22} filled={liked} className={liked ? "text-danger-500" : "text-slate-300"} />
            <span className="text-[11px] tabular-nums text-slate-300">{formatPlays(likes)}</span>
          </button>
          <button onClick={() => setCmt({ autoFocus: false })} aria-label={t`评论 · ${cCount}`} className={cell}>
            <Icon name="comment" size={22} className="text-slate-300" />
            <span className="text-[11px] tabular-nums text-slate-300">{formatPlays(cCount)}</span>
          </button>
          {/* ★★ 收藏**不显示数字**（服务端 BranchCollect 2026-08-31 写明不做计数：零成本动作是最便宜的刷量燃料，显示骗人的数比不显示更糟） */}
          <button onClick={() => void collect()} aria-pressed={saved} className={cell}>
            <Icon name="star" size={22} filled={saved} className={saved ? "text-gold" : "text-slate-300"} />
            <span className="text-[11px] text-slate-300">
              <Trans>收藏</Trans>
            </span>
          </button>
          <button onClick={() => setShareOpen(true)} className={cell}>
            <Icon name="share" size={22} className="text-slate-300" />
            <span className="text-[11px] text-slate-300">
              <Trans>分享</Trans>
            </span>
          </button>
          {reportCell ? (
            // ★ 传整条作品的 id（还没落库的乐观条目 v_* 没有 authorId，只能靠 mine 认出是本人的）
            <ReportButton cell targetType="video" targetId={video.id} videoId={video.id} mine={mine} />
          ) : saveCell ? (
            <button onClick={openSave} className={cell}>
              <Icon name="download" size={22} className="text-slate-300" />
              <span className="text-[11px] text-slate-300">
                <Trans>保存</Trans>
              </span>
            </button>
          ) : null}
        </div>
        {saveErr && <p className="px-4 pt-1 text-right text-[11px] text-danger-300">{saveErr}</p>}

        {/* ── 选集卡（多 P 老作品才有）── */}
        {parts.length > 1 && (
          <section className="mx-4 mt-4 rounded-xl border border-slate-700/70 bg-panel p-3">
            <h2 className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>选集（{parts.length}）</Trans>
            </h2>
            <div className="flex gap-2 no-scrollbar overflow-x-auto">
              {parts.map((p, i) => {
                const price = video.pricing?.mode === "paid" ? (video.pricing.partPrices[i] ?? 0) : 0;
                const lockedHere = price > 0 && !mine && !hasPurchased(video.id, i);
                return (
                  <button
                    key={i}
                    onClick={() => setPi(i)}
                    className={`inline-flex flex-none items-center gap-1 rounded-full px-3.5 py-1.5 text-xs ${
                      i === piSafe ? "bg-brand font-semibold text-ink" : "bg-ink text-slate-300"
                    }`}
                  >
                    {lockedHere && <Icon name="lock" size={12} />}
                    {p.name || `P${i + 1}`}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 互动结构卡 ── */}
        {tree && (
          <section className="mx-4 mt-4 rounded-xl border border-slate-700/70 bg-panel p-3 text-xs text-slate-300">
            <Trans>互动视频 · {branchPoints} 个分支点 · {endings} 个结局</Trans>
          </section>
        )}

        {/* ── 评论预览卡（整卡一颗键，点了开评论抽屉）—— 页内那份平铺评论区与输入框收掉了：评论只有 CommentSheet 一份 ── */}
        <button onClick={() => setCmt({ autoFocus: false })} className="mx-4 mt-4 block w-[calc(100%-2rem)] rounded-xl border border-slate-700/70 bg-panel p-3 text-left">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 text-sm font-semibold text-slate-300">
              <Trans>评论 {cCount}</Trans>
            </span>
            <Icon name="chevron" size={16} className="text-slate-400" />
          </div>
          {firstComment ? (
            <div className="mt-2 flex gap-2">
              <Avatar name={firstComment.author} label={authorDisplayName(firstComment.author, firstComment.authorId)} src={commentAvatarOf(firstComment)} size={24} />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-slate-300">{authorDisplayName(firstComment.author, firstComment.authorId)}</span>
                <div className="line-clamp-2 text-sm text-slate-200">
                  <MentionText text={firstComment.text} mentions={firstComment.mentions} />
                </div>
              </div>
            </div>
          ) : cStatus === "pending" && cCount > 0 ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Spinner size="xs" />
              <Trans>正在取评论…</Trans>
            </div>
          ) : cStatus === "failed" ? (
            <p className="mt-2 text-xs text-danger-300">
              <Trans>没取到评论，点开重试</Trans>
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              <Trans>还没有评论，抢个沙发</Trans>
            </p>
          )}
        </button>

        {/* ── 做你自己的版本（参数 / 同款署名 / 卡组 / 制作过程）── */}
        {(canRemake || (video.deck?.cards.length ?? 0) > 0 || (video.recipePublic && !locked) || !!video.remixOf) && (
          <RemakeCard
            video={video}
            segments={part?.segments ?? video.segments}
            locked={locked}
            auth={auth}
            remakeErr={remakeErr}
            onGoStudio={() => navigate("/studio")}
          />
        )}
        {remakeDialog}

        {/* ── 相关区：TA 的更多作品 + 同分区（进视口才问）── */}
        <RelatedWorks video={video} />
      </main>

      {!immersive && <VideoDock onComment={() => setCmt({ autoFocus: true })} onRemake={canRemake ? remake : null} />}

      {menuOpen && (
        <FeedActionSheet
          video={video}
          mine={mine}
          speed={speed}
          onSpeed={(s) => {
            setSpeed(s);
            setMenuOpen(false);
          }}
          immersive={immersive || locked}
          landscape={aspect === "landscape"}
          onClearScreen={() => void enterFull()}
          onClose={() => setMenuOpen(false)}
          host="detail"
          onSaveLocal={dlSupported ? openSave : null}
          block={video.authorId ? { userId: video.authorId, userName: video.author } : null}
          // 详情页不摆「不感兴趣」：人是点进来看的，藏掉正在看的这一条还得替他退出去；首页那一格才是它的位置（2026-10-30）
          onNotInterested={null}
        />
      )}
      {cmt && <CommentSheet video={video} onClose={() => setCmt(null)} autoFocus={cmt.autoFocus} />}
      {dmOpen && <DanmakuInput videoId={video.id} getTime={() => timeRef.current} onClose={() => setDmOpen(false)} />}
      {shareOpen && (
        <ShareSheet
          video={video}
          onClose={() => setShareOpen(false)}
          saveLocal={
            dlSupported
              ? {
                  blocked: dlBlockedNow,
                  // 先关分享面板再开下载面板：两层弹层永不叠加
                  onTap: () => {
                    setShareOpen(false);
                    setDlBlocked("");
                    setDlOpen(true);
                  },
                }
              : null
          }
        />
      )}
      {dlOpen && <DownloadSheet video={video} partIndex={piSafe} branchPath={branchPath} onClose={() => setDlOpen(false)} />}
    </div>
  );
}
