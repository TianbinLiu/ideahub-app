// 首页：TikTok 式全屏上下滑视频流。每屏一支，进入视口自动播放、离开暂停。
// 互动视频（带 branchTree）在流里播开场段，点"进入互动"跳详情页做分支选择。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { addPlay, isLiked, isMyAuthor, isSaved, listVideos, setLike, setSave } from "../data/videos";
import { isFollowing, toggleFollow } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import Avatar from "../components/Avatar";
import Icon, { type IconName } from "../components/Icon";
import CharacterPerch from "../components/CharacterPerch";
import { VideoItem } from "../types";

/** 声音开关全流共享：一条视频上解除静音，后面每条都该有声（对标抖音/TikTok） */
let soundOn = typeof sessionStorage !== "undefined" && sessionStorage.getItem("feed.sound") === "1";

/** 右侧操作栏单键。固定 28×28 的 SVG + 至少 56px 高，间距由盒模型保证——
 *  原来用 emoji 时三个字形高度各不相同（🤍 方、💬 带气泡尾、▶️ 带彩色底板），
 *  所以怎么调 gap 都对不齐。
 *
 *  激活态会有个角色小人跳上来坐在图标上（见 CharacterPerch）。只在激活时出现，
 *  平时保持干净——首页是全出血视频，常驻装饰都在跟内容抢注意力。 */
function RailBtn({
  icon,
  filled,
  tint,
  label,
  perch,
  onClick,
}: {
  icon: IconName;
  filled?: boolean;
  tint?: string;
  label?: string;
  /** true 时，激活（filled）状态会有角色跳上来坐在图标上 */
  perch?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[56px] w-14 flex-col items-center justify-center gap-1 transition active:scale-90"
    >
      {/* relative 容器只包图标：小人要相对【图标】定位，包住文字的话会偏高 */}
      <span className="relative flex items-center justify-center">
        {perch && filled && <CharacterPerch size={28} />}
        <Icon
          name={icon}
          size={28}
          filled={filled}
          className={filled && tint ? tint : "text-white"}
          style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))" }}
        />
      </span>
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
  // 初值从库里取：划走再划回来时收藏态不该丢（与点赞同理）
  const [saved, setSaved] = useState(() => isSaved(video.id));
  const [saves, setSaves] = useState(video.saves ?? 0);
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

      {/* 右侧竖排操作：头像+关注 / 赞 / 评论 / 收藏 / 分享。
          对齐 TikTok：头像带 + 号在最上方（原来在左下角），四个按钮一律显示【数字】而非文字标签——
          「收藏」「分享」这种字在一列数字里会打断竖向的节奏，也说不出量级。
          播放量下沉：TikTok 不在视频上显示播放量，它属于作者后台而非观众决策信息。 */}
      <div
        /* gap-10 而不是更紧凑的 gap-4：激活态的角色会从图标顶沿向上探出约 45px，
           gap-4（16px）时它正好压住【上一个按钮的计数数字】——实测收藏后评论数「3」
           整个消失。计数是信息，装饰盖掉信息就是回退。
           取值靠量：gap-9（36px）时仍有 1px 重叠，gap-10（40px）后归零。
           换角色贴图（改高度）时要重新量一遍，别照抄这个数。 */
        className="absolute right-2 z-10 flex flex-col items-center gap-10"
        style={{ bottom: "calc(var(--tabbar-h) + 1.25rem)" }}
      >
        {/* 头像 + 关注：未关注时下挂一个 + 号，点了变对勾后淡出（TikTok 同款反馈） */}
        <div className="relative mb-1">
          <button onClick={() => navigate(`/video/${video.id}`)} className="block active:scale-95">
            <span className="block rounded-full ring-2 ring-white/90">
              <Avatar name={video.author} src={mine ? user?.avatar : undefined} size={44} />
            </span>
          </button>
          {user && !mine && !following && (
            <button
              onClick={() => setFollowing(toggleFollow(video.author))}
              aria-label="关注"
              className="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-rose-500 text-white transition active:scale-90"
            >
              <Icon name="plus" size={12} strokeWidth={3} />
            </button>
          )}
        </div>

        <RailBtn icon="heart" filled={liked} tint="text-rose-500" label={String(likes)} perch onClick={toggleLike} />
        <RailBtn icon="comment" label={String(video.comments.length)} onClick={() => navigate(`/video/${video.id}`)} />
        <RailBtn
          icon="bookmark"
          filled={saved}
          tint="text-gold"
          label={String(saves)}
          perch
          onClick={() => {
            const on = !saved;
            setSaved(on);
            setSaves(setSave(video.id, on));
            navigator.vibrate?.(10);
          }}
        />
        <RailBtn icon="share" label={String(video.shares ?? 0)} onClick={share} />
      </div>

      {/* 左下信息：作者名 + 标题 + 简介。
          按 TikTok 精简掉了三样——头像/关注（移到右侧栏顶部）、#分类胶囊、▶播放量。
          分类不再单独做胶囊：TikTok 把话题写进描述文字里（#fyp #messy），
          单独的胶囊在全出血画面上会切出一个突兀的实心块。 */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 pl-4 pr-20"
        style={{ paddingBottom: "calc(var(--tabbar-h) + 0.75rem)" }}
      >
        <div className="mb-1.5 text-sm font-semibold text-white [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          @{video.author}
        </div>
        <div className="mb-1 text-base font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.7)]">{video.title}</div>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
          {video.description} <span className="text-white/70">#{video.category}</span>
        </p>
        {isInteractive && (
          <button
            onClick={() => navigate(`/video/${video.id}`)}
            className="mt-2 inline-flex min-h-[28px] items-center gap-1 rounded-full bg-gold/90 px-3 text-[11px] font-semibold text-ink active:scale-95"
          >
            <Icon name="branch" size={13} strokeWidth={2.25} />
            互动 · 你来选
          </button>
        )}
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
