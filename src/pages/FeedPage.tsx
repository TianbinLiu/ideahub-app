// 首页：TikTok 式全屏上下滑视频流。每屏一支，进入视口自动播放、离开暂停。
// 互动视频（带 branchTree）在流里播开场段，点"进入互动"跳详情页做分支选择。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addPlay, isLiked, isMyAuthor, listVideos, setLike } from "../data/videos";
import { isCollected, isFollowing, toggleCollect, toggleFollow } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import Avatar from "../components/Avatar";
import CommentSheet from "../components/CommentSheet";
import Icon, { type IconName } from "../components/Icon";
import { VideoItem, formatPlays } from "../types";

/** 声音开关全流共享：一条视频上解除静音，后面每条都该有声（对标抖音/TikTok） */
let soundOn = typeof sessionStorage !== "undefined" && sessionStorage.getItem("feed.sound") === "1";

/** 右侧操作栏单键。固定 28×28 的 SVG + 至少 56px 高，间距由盒模型保证——
 *  原来用 emoji 时三个字形高度各不相同（🤍 方、💬 带气泡尾、▶️ 带彩色底板），
 *  所以怎么调 gap 都对不齐。 */
function RailBtn({
  icon,
  filled,
  tint,
  label,
  onClick,
}: {
  icon: IconName;
  filled?: boolean;
  tint?: string;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[56px] w-14 flex-col items-center justify-center gap-1 transition active:scale-90"
    >
      <Icon
        name={icon}
        size={28}
        filled={filled}
        className={filled && tint ? tint : "text-white"}
        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
      />
      {label !== undefined && (
        <span className="text-[11px] tabular-nums text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">{label}</span>
      )}
    </button>
  );
}

function FeedItem({ video, active, dist }: { video: VideoItem; active: boolean; dist: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // 初值从库里取：划走再划回来时点赞态不该丢（isLiked 之前一直没人调用）
  const [liked, setLiked] = useState(() => isLiked(video.id));
  const [likes, setLikes] = useState(video.likes);
  // 收藏挂账号库：此前是组件本地假状态——划走即丢、也谈不上"取消收藏"
  const [saved, setSaved] = useState(() => isCollected(video.id));
  const [cmtOpen, setCmtOpen] = useState(false);
  const [following, setFollowing] = useState(() => isFollowing(video.author));
  const [paused, setPaused] = useState(false);
  const [burst, setBurst] = useState<{ x: number; y: number; k: number } | null>(null);
  const [muted, setMuted] = useState(!soundOn);
  const countedRef = useRef(false);
  const tapRef = useRef<{ x: number; y: number; t: number; last: number }>({ x: 0, y: 0, t: 0, last: 0 });
  const user = useCurrentUser();
  const navigate = useNavigate();
  const seg = video.segments[0];
  const isInteractive = !!video.branchTree;
  const mine = isMyAuthor(video.author);

  // 只有当前屏和相邻一屏挂 src：全部同时挂会在首屏并发拉 N 条流，
  // 而且 Android WebView 的硬解码器通常只有 4-8 个，超了直接黑屏。
  const wantSrc = dist <= 1;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      setPaused(false);
      void v.play().catch(() => {});
      if (!countedRef.current) {
        countedRef.current = true;
        addPlay(video.id);
      }
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [active, video.id]);

  function likeOn() {
    if (liked) return; // 双击只加不减：连点两下绝不该变成取消
    setLiked(true);
    setLikes(setLike(video.id, true));
    navigator.vibrate?.(10);
  }

  function toggleLike() {
    const on = !liked;
    setLiked(on);
    setLikes(setLike(video.id, on));
    navigator.vibrate?.(10);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }

  // 用 pointer 事件而不是 onClick：onClick 会和 snap 滚动的惯性抢事件
  function onDown(e: React.PointerEvent) {
    tapRef.current = { ...tapRef.current, x: e.clientX, y: e.clientY, t: Date.now() };
  }
  function onUp(e: React.PointerEvent) {
    const r = tapRef.current;
    const dt = Date.now() - r.t;
    const moved = Math.hypot(e.clientX - r.x, e.clientY - r.y);
    if (dt > 250 || moved > 10) return; // 是滑动不是点击
    const now = Date.now();
    if (now - r.last < 260) {
      // 双击点赞
      tapRef.current.last = 0;
      likeOn();
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setBurst({ x: e.clientX - box.left, y: e.clientY - box.top, k: now });
      setTimeout(() => setBurst((b) => (b && b.k === now ? null : b)), 620);
      return;
    }
    tapRef.current.last = now;
    // 首次单击只解除静音——正好满足浏览器"必须有用户手势"的解锁要求
    if (muted && !soundOn) {
      soundOn = true;
      sessionStorage.setItem("feed.sound", "1");
      setMuted(false);
      return;
    }
    togglePlay();
  }

  function share() {
    const url = `${location.origin}${location.pathname}#/video/${video.id}`;
    if (navigator.share) void navigator.share({ title: video.title, url }).catch(() => {});
    else void navigator.clipboard?.writeText(url);
  }

  return (
    <section
      className="relative h-full w-full snap-start snap-always overflow-hidden bg-black"
      onPointerDown={onDown}
      onPointerUp={onUp}
    >
      {/* 画面：有真实视频用 video，否则封面兜底。远处的屏只放封面图，不挂视频源 */}
      {seg?.videoUrl && wantSrc ? (
        <video
          ref={videoRef}
          src={seg.videoUrl}
          poster={video.cover}
          className="absolute inset-0 h-full w-full object-cover"
          loop
          muted={muted}
          playsInline
          preload={active ? "auto" : "metadata"}
        />
      ) : (
        <img src={video.cover} alt={video.title} className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* 上下定高遮罩：只压住文字所在的两条带，中间画面保持干净 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/55 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {/* 暂停指示 */}
      {paused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Icon name="play" size={72} filled className="text-white/75 drop-shadow-lg" />
        </div>
      )}

      {/* 双击点赞的心 */}
      {burst && (
        <Icon
          name="heart"
          size={96}
          filled
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 text-rose-500 heart-burst"
          style={{ left: burst.x, top: burst.y }}
        />
      )}

      {/* 静音提示：解除之前明确告诉用户点一下有声 */}
      {active && muted && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white/90 backdrop-blur">
          点击开启声音
        </div>
      )}

      {/* 右侧竖排操作：赞 / 评论 / 收藏 / 分享 —— 播放量下沉到信息区。
          pointer 事件在这里截住：点操作键不该同时触发画面的暂停/解静音/双击点赞 */}
      <div
        className="absolute right-2 z-10 flex flex-col items-center gap-4"
        style={{ bottom: "calc(var(--tabbar-h) + 1.25rem)" }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <RailBtn icon="heart" filled={liked} tint="text-rose-500" label={String(likes)} onClick={toggleLike} />
        {/* 评论就地滑出抽屉（对标短视频 App），不再跳详情页打断刷视频的节奏 */}
        <RailBtn icon="comment" label={String(video.comments.length)} onClick={() => setCmtOpen(true)} />
        <RailBtn
          icon="bookmark"
          filled={saved}
          tint="text-gold"
          label={saved ? "已收藏" : "收藏"}
          onClick={() => {
            if (!user) {
              navigate("/login?next=/");
              return;
            }
            setSaved(toggleCollect(video.id));
          }}
        />
        <RailBtn icon="share" label="分享" onClick={share} />
      </div>

      {cmtOpen && <CommentSheet video={video} onClose={() => setCmtOpen(false)} />}

      {/* 左下信息 */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 pl-4 pr-20"
        style={{ paddingBottom: "calc(var(--tabbar-h) + 0.75rem)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <Avatar name={video.author} src={mine ? user?.avatar : undefined} size={36} />
          <span className="text-sm font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
            @{video.author}
          </span>
          {user && !mine && (
            <button
              onClick={() => setFollowing(toggleFollow(video.author))}
              className={`min-h-[28px] rounded-full px-3 text-[12px] font-medium transition active:scale-95 ${
                following ? "bg-white/20 text-white" : "bg-brand text-ink"
              }`}
            >
              {following ? "已关注" : "关注"}
            </button>
          )}
        </div>
        <div className="mb-1 text-base font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.7)]">{video.title}</div>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {video.description}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/80">
          <span className="rounded-full bg-white/15 px-2 py-0.5">#{video.category}</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Icon name="play" size={11} filled />
            {formatPlays(video.plays)}
          </span>
          {isInteractive && (
            <button
              onClick={() => navigate(`/video/${video.id}`)}
              className="ml-auto inline-flex min-h-[28px] items-center gap-1 rounded-full bg-gold/90 px-3 font-semibold text-ink active:scale-95"
            >
              <Icon name="branch" size={13} strokeWidth={2.25} />
              互动 · 你来选
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function FeedPage() {
  const user = useCurrentUser();
  const version = useVideosVersion();
  const [feed, setFeed] = useState<"recommend" | "following">("recommend");
  const all = useMemo(() => listVideos(), [version]);
  const videos = useMemo(() => {
    if (feed !== "following") return all;
    const set = new Set(user?.following ?? []);
    return all.filter((v) => set.has(v.author));
  }, [all, feed, user?.following]);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  // 切流后回到顶部并重置当前屏（首次挂载不算切流，否则会覆盖掉恢复的位置）
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    wrapRef.current?.scrollTo({ top: 0 });
    setActiveIdx(0);
  }, [feed]);

  // 判定当前屏：IntersectionObserver 多阈值取占比最大的一条；
  // 单阈值在快速甩动时会整批漏判（表现为划过去了新视频不播、旧的还在响），
  // 再用 scrollend 兜一次底。
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        let best = -1;
        let bestRatio = 0.5;
        for (const e of entries) {
          if (e.intersectionRatio > bestRatio) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) {
              best = idx;
              bestRatio = e.intersectionRatio;
            }
          }
        }
        if (best >= 0) setActiveIdx(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll("[data-idx]").forEach((el) => io.observe(el));
    const onScrollEnd = () => {
      if (root.clientHeight > 0) setActiveIdx(Math.round(root.scrollTop / root.clientHeight));
    };
    root.addEventListener("scrollend", onScrollEnd);
    return () => {
      io.disconnect();
      root.removeEventListener("scrollend", onScrollEnd);
    };
  }, [videos.length]);

  const tabs = (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pt-2">
      {/* 纯文字 + 下划线：胶囊底色在全出血画面上会切出一个实心矩形，
          抖音/TikTok/小红书四家一致用的是文字态 */}
      <div className="pointer-events-auto flex items-center gap-6">
        {(["following", "recommend"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFeed(f)}
            className={`relative min-h-[36px] px-1 text-[15px] transition ${
              feed === f ? "font-semibold text-white" : "text-white/65"
            } [text-shadow:0_1px_3px_rgba(0,0,0,.6)]`}
          >
            {f === "following" ? "关注" : "推荐"}
            {feed === f && (
              <span className="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-white" />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  if (videos.length === 0) {
    return (
      <div className="fixed inset-0 bg-black">
        {tabs}
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
          <Icon name={feed === "following" ? "user" : "play"} size={40} className="text-slate-600" />
          <p className="text-sm">
            {feed === "following"
              ? user
                ? "关注的创作者还没有新作品"
                : "登录后可以关注喜欢的创作者"
              : "还没有作品"}
          </p>
          {feed === "following" ? (
            <button onClick={() => setFeed("recommend")} className="rounded-full bg-panel px-4 py-2 text-sm text-slate-300">
              去推荐流看看
            </button>
          ) : (
            <Link to="/studio" className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-ink">
              去卡片工坊创作
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    // fixed inset-0 而不是 h-[calc(100vh-4rem)]：视频要全出血到屏幕边缘（底栏浮在渐变上），
    // 同时绕开 100vh 在 WebView 地址栏伸缩时导致 snap 错位的老问题
    <div className="fixed inset-0 z-0 bg-black">
      {tabs}
      <div
        ref={wrapRef}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "none" }}
      >
        {videos.map((v, i) => {
          const dist = Math.abs(i - activeIdx);
          return (
            <div key={v.id} data-idx={i} className="h-full w-full">
              {/* 远处的屏保留同样的 data-idx 和高度（snap 与 IO 都依赖它），只是不渲染内容 */}
              {dist <= 2 ? <FeedItem video={v} active={i === activeIdx} dist={dist} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
