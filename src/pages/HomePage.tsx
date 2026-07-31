// 视频首页：搜索 + 分类 + 视频网格 + 创作入口
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listVideos } from "../data/videos";
import { VIDEO_CATEGORIES, formatDuration, formatPlays, relativeTime } from "../types";

export default function HomePage() {
  const [videos] = useState(() => listVideos());
  const [cat, setCat] = useState("全部");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      videos.filter(
        (v) =>
          (cat === "全部" || v.category === cat) &&
          (!q.trim() || v.title.includes(q.trim()) || v.description.includes(q.trim()) || v.author.includes(q.trim()))
      ),
    [videos, cat, q]
  );

  return (
    <div className="min-h-full">
      {/* 顶栏 */}
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎬</span>
            <span className="text-lg font-bold text-slate-100">分支视频</span>
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs text-brand">Beta</span>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 max-w-md items-center gap-2 rounded-full border border-slate-700 bg-panel px-4 py-2">
            <span className="text-slate-500">🔍</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索视频 / 作者"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
          <Link
            to="/studio"
            className="flex-none rounded-full bg-brand px-4 py-2 text-sm font-bold text-ink hover:brightness-110"
          >
            🎴 卡片创作
          </Link>
        </div>
        {/* 分类 */}
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3">
          {["全部", ...VIDEO_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`flex-none rounded-full px-3.5 py-1.5 text-sm ${
                cat === c ? "bg-brand text-ink font-semibold" : "bg-panel text-slate-300 hover:bg-slate-700"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </header>

      {/* 视频网格 */}
      <main className="mx-auto max-w-6xl px-4 py-5">
        {filtered.length === 0 ? (
          <div className="py-24 text-center text-slate-500">
            没有找到相关视频——去<Link to="/studio" className="text-brand">卡片工坊</Link>创作第一支吧
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((v) => (
              <Link key={v.id} to={`/video/${v.id}`} className="group">
                <div className="relative overflow-hidden rounded-xl">
                  <img
                    src={v.cover}
                    alt={v.title}
                    className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs text-slate-200">
                    {formatDuration(v.segments.reduce((s, x) => s + x.durationSec, 0))}
                  </span>
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {v.segments.length} 节点
                  </span>
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-medium text-slate-200 group-hover:text-brand">{v.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {v.author} · {formatPlays(v.plays)}播放 · {relativeTime(v.createdAt)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* 移动端悬浮创作按钮 */}
      <Link
        to="/studio"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl shadow-xl shadow-brand/30 sm:hidden"
      >
        🎴
      </Link>
    </div>
  );
}
