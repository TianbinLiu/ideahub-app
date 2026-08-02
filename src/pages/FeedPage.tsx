// 首页：TikTok 式全屏上下滑视频流。每屏一支，进入视口自动播放、离开暂停。
// 互动视频（带 branchTree）在流里播开场段，点"进入互动"跳详情页做分支选择。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addPlay, isMyAuthor, listVideos, setLike } from "../data/videos";
import { isFollowing, toggleFollow } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { VideoItem, formatPlays } from "../types";

function FeedItem({ video, active }: { video: VideoItem; active: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(video.likes);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(() => isFollowing(video.author));
  const countedRef = useRef(false);
  const user = useCurrentUser();
  const navigate = useNavigate();
  const seg = video.segments[0];
  const isInteractive = !!video.branchTree;
  const mine = isMyAuthor(video.author);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
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

  return (
    <section className="relative h-full w-full snap-start snap-always overflow-hidden bg-black">
      {/* 画面：有真实视频用 video，否则首尾帧渐变兜底 */}
      {seg?.videoUrl ? (
        <video
          ref={videoRef}
          src={seg.videoUrl}
          poster={video.cover}
          className="absolute inset-0 h-full w-full object-cover"
          loop
          muted
          playsInline
        />
      ) : (
        <img src={video.cover} alt={video.title} className="absolute inset-0 h-full w-full object-cover" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />

      {/* 右侧竖排操作 */}
      <div className="absolute bottom-24 right-3 flex flex-col items-center gap-5">
        <button
          onClick={() => {
            const on = !liked;
            setLiked(on);
            setLikes(setLike(video.id, on));
          }}
          className="flex flex-col items-center gap-1"
        >
          <span className={`text-3xl transition ${liked ? "scale-110" : ""}`}>{liked ? "❤️" : "🤍"}</span>
          <span className="text-[11px] text-slate-200">{likes}</span>
        </button>
        <Link to={`/video/${video.id}`} className="flex flex-col items-center gap-1">
          <span className="text-3xl">💬</span>
          <span className="text-[11px] text-slate-200">{video.comments.length}</span>
        </Link>
        <div className="flex flex-col items-center gap-1">
          <span className="text-3xl">▶️</span>
          <span className="text-[11px] text-slate-200">{formatPlays(video.plays)}</span>
        </div>
      </div>

      {/* 左下信息 */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-6">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-panel text-lg">
            {mine ? user?.avatar ?? "🎴" : "🎬"}
          </span>
          <span className="text-sm font-semibold text-slate-100">@{video.author}</span>
          {user && !mine && (
            <button
              onClick={() => setFollowing(toggleFollow(video.author))}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                following ? "bg-slate-700 text-slate-300" : "bg-brand text-ink"
              }`}
            >
              {following ? "已关注" : "关注"}
            </button>
          )}
        </div>
        <div className="mb-1 text-base font-bold text-white">{video.title}</div>
        <button onClick={() => setExpanded((v) => !v)} className="text-left">
          <p className={`text-xs leading-relaxed text-slate-300 ${expanded ? "" : "line-clamp-2"}`}>
            {video.description}
          </p>
        </button>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-slate-200">#{video.category}</span>
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-slate-200">
            {video.segments.length} 段
          </span>
          {isInteractive && (
            <button
              onClick={() => navigate(`/video/${video.id}`)}
              className="rounded-full bg-brand/90 px-2.5 py-0.5 text-[10px] font-semibold text-ink"
            >
              ⤳ 互动视频 · 进入选择
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function FeedPage() {
  const user = useCurrentUser();
  const [feed, setFeed] = useState<"recommend" | "following">("recommend");
  const all = useMemo(() => listVideos(), []);
  const videos = useMemo(() => {
    if (feed !== "following") return all;
    const set = new Set(user?.following ?? []);
    return all.filter((v) => set.has(v.author));
  }, [all, feed, user?.following]);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 切流后回到顶部并重置当前屏（否则会停在上一流的滚动位置）
  useEffect(() => {
    wrapRef.current?.scrollTo({ top: 0 });
    setActiveIdx(0);
  }, [feed]);

  // 用 IntersectionObserver 判定当前屏（比 scroll 计算更稳，也不依赖固定高度）
  useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) setActiveIdx(idx);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-idx]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [videos.length]);

  const tabs = (
    <div className="safe-top pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center pt-2">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/45 p-1 backdrop-blur">
        {(["following", "recommend"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFeed(f)}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              feed === f ? "bg-white/90 font-semibold text-ink" : "text-slate-200"
            }`}
          >
            {f === "following" ? "关注" : "推荐"}
          </button>
        ))}
      </div>
    </div>
  );

  if (videos.length === 0) {
    return (
      <div className="relative h-[calc(100vh-4rem)]">
        {tabs}
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
          <span className="text-4xl">{feed === "following" ? "👀" : "🎬"}</span>
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
    <div className="relative h-[calc(100vh-4rem)]">
      {tabs}
      <div
        ref={wrapRef}
        className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        style={{ scrollbarWidth: "none" }}
      >
        {videos.map((v, i) => (
          <div key={v.id} data-idx={i} className="h-full w-full">
            <FeedItem video={v} active={i === activeIdx} />
          </div>
        ))}
      </div>
    </div>
  );
}
