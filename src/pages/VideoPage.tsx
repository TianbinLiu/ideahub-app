// 视频详情页：播放器 + 信息 + 分段剧情 + 评论区
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import SegmentPlayer from "../components/SegmentPlayer";
import { addComment, addPlay, getVideo, setLike } from "../data/videos";
import { VideoComment, formatPlays, relativeTime } from "../types";

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const video = useMemo(() => (id ? getVideo(id) : null), [id]);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(video?.likes ?? 0);
  const [comments, setComments] = useState<VideoComment[]>(video?.comments ?? []);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (id && video) addPlay(id);
    // 仅进入页面时 +1
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!video) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <div>视频不存在或已删除</div>
        <Link to="/" className="text-brand">
          返回首页
        </Link>
      </div>
    );
  }

  function toggleLike() {
    if (!video) return;
    const on = !liked;
    setLiked(on);
    setLikes(setLike(video.id, on));
  }

  function submitComment() {
    if (!video || !draft.trim()) return;
    const cmt = addComment(video.id, draft.trim());
    if (cmt) setComments((cs) => [cmt, ...cs]);
    setDraft("");
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="text-slate-400 hover:text-white">
            ←
          </Link>
          <span className="truncate text-sm text-slate-300">{video.title}</span>
          <Link to="/studio" className="ml-auto flex-none rounded-full bg-brand/15 px-3 py-1.5 text-xs text-brand">
            🎴 我也要创作
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <SegmentPlayer segments={video.segments} cover={video.cover} />

        <h1 className="mt-4 text-xl font-bold text-slate-100">{video.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/25 font-bold text-brand">
              {video.author.charAt(0)}
            </span>
            <span className="text-slate-200">{video.author}</span>
          </span>
          <span>{formatPlays(video.plays)}播放</span>
          <span>{relativeTime(video.createdAt)}</span>
          <span className="rounded-full bg-panel px-2.5 py-0.5 text-xs">{video.category}</span>
          <span className="rounded-full bg-purple-500/15 px-2.5 py-0.5 text-xs text-purple-300">互动分支 · 敬请期待</span>
          <button
            onClick={toggleLike}
            className={`ml-auto rounded-full px-3.5 py-1.5 text-sm ${
              liked ? "bg-pink-500/20 text-pink-300" : "bg-panel text-slate-300 hover:bg-slate-700"
            }`}
          >
            {liked ? "❤" : "🤍"} {likes}
          </button>
        </div>

        {video.description && (
          <p className="mt-3 whitespace-pre-wrap rounded-xl bg-panel/60 p-3 text-sm leading-relaxed text-slate-300">
            {video.description}
          </p>
        )}

        {/* 分段剧情 */}
        <section className="mt-6">
          <h2 className="mb-3 text-base font-bold text-slate-200">分段剧情 · {video.segments.length} 个节点</h2>
          <div className="space-y-3">
            {video.segments.map((seg, i) => (
              <div key={i} className="flex gap-3 rounded-xl bg-panel/60 p-3">
                <div className="flex w-40 flex-none flex-col gap-1.5">
                  <img src={seg.firstFrame} alt="首帧" className="aspect-video w-full rounded-lg object-cover" />
                  <img src={seg.lastFrame} alt="尾帧" className="aspect-video w-full rounded-lg object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-brand">{seg.title}</span>
                    <span className="text-xs text-slate-500">{seg.durationSec}s</span>
                  </div>
                  <p className="novel-text mt-1.5 text-sm text-slate-300">{seg.plot}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 评论区 */}
        <section className="mt-6 pb-16">
          <h2 className="mb-3 text-base font-bold text-slate-200">评论 {comments.length}</h2>
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitComment();
              }}
              placeholder="发一条友善的评论"
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <button
              onClick={submitComment}
              disabled={!draft.trim()}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              发布
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-slate-700 text-sm font-bold text-slate-300">
                  {c.author.charAt(0)}
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">
                    {c.author} · {relativeTime(c.at)}
                  </div>
                  <div className="mt-0.5 text-sm text-slate-200">{c.text}</div>
                </div>
              </div>
            ))}
            {comments.length === 0 && <div className="py-8 text-center text-sm text-slate-500">还没有评论，抢个沙发</div>}
          </div>
        </section>
      </main>
    </div>
  );
}
