// 分区页：分类网格 + 搜索（视频标题/简介/作者/分类）。
import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import { Link } from "react-router";
import { listVideos } from "../data/videos";
import { VIDEO_CATEGORIES, formatDuration, formatPlays } from "../types";

const CAT_STYLE: Record<string, { icon: string; from: string }> = {
  剧情: { icon: "🎭", from: "from-rose-500/30" },
  科幻: { icon: "🛸", from: "from-cyan-500/30" },
  古风: { icon: "🏯", from: "from-amber-500/30" },
  搞笑: { icon: "😂", from: "from-lime-500/30" },
  动画: { icon: "🎨", from: "from-fuchsia-500/30" },
  其他: { icon: "✨", from: "from-slate-500/30" },
};

export default function DiscoverPage() {
  const [videos] = useState(() => listVideos());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);

  const results = useMemo(() => {
    const key = q.trim();
    return videos.filter(
      (v) =>
        (!cat || v.category === cat) &&
        (!key ||
          v.title.includes(key) ||
          v.description.includes(key) ||
          v.author.includes(key) ||
          v.category.includes(key)),
    );
  }, [videos, q, cat]);

  const searching = !!q.trim() || !!cat;

  return (
    <div className="safe-top min-h-full px-4 pt-3">
      <div className="mb-4 flex items-center gap-2 rounded-full border border-slate-700 bg-panel px-4 py-2.5">
        <Icon name="search" size={17} className="text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索视频 / 作者 / 分区"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        {q && (
          <button onClick={() => setQ("")} className="text-slate-500">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      {!searching && (
        <>
          <h2 className="mb-2.5 text-sm font-semibold text-slate-300">浏览分区</h2>
          {/* 一行排开的圆形入口。用 overflow-x-auto 而不是 grid：
              以后加分区也不会换行挤成两排，窄屏上自然变成横滑。
              -mx-4 px-4 让滑动区贴到屏幕边缘，最后一个不会卡在 padding 里。 */}
          <div
            className="mb-6 -mx-4 flex justify-between gap-1 overflow-x-auto px-4 pb-1"
            style={{ scrollbarWidth: "none" }}
          >
            {VIDEO_CATEGORIES.map((c) => {
              const st = CAT_STYLE[c] ?? CAT_STYLE.其他;
              return (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className="flex w-12 flex-none flex-col items-center gap-1.5 transition active:scale-95"
                >
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br ${st.from} to-panel text-xl`}
                  >
                    {st.icon}
                  </span>
                  <span className="w-full truncate text-center text-[11px] text-slate-300">{c}</span>
                </button>
              );
            })}
          </div>
          <h2 className="mb-2.5 text-sm font-semibold text-slate-300">最新作品</h2>
        </>
      )}

      {searching && (
        <div className="mb-3 flex items-center gap-2">
          {cat && (
            <button
              onClick={() => setCat(null)}
              className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-ink"
            >
              {cat}
              <Icon name="close" size={13} className="ml-1 inline-block align-[-2px]" />
            </button>
          )}
          <span className="text-xs text-slate-500">{results.length} 个结果</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 pb-4">
        {results.map((v) => (
          <Link key={v.id} to={`/video/${v.id}`} className="group">
            <div className="relative overflow-hidden rounded-xl">
              <img src={v.cover} alt={v.title} className="aspect-[3/4] w-full object-cover" />
              <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-slate-200">
                {formatDuration(v.segments.reduce((s, x) => s + x.durationSec, 0))}
              </span>
              {v.branchTree && (
                <span className="absolute left-1.5 top-1.5 rounded bg-brand/85 px-1.5 py-0.5 text-[9px] font-semibold text-ink">
                  互动
                </span>
              )}
            </div>
            <div className="mt-1.5 line-clamp-2 text-xs font-medium text-slate-200">{v.title}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {v.author} · {formatPlays(v.plays)}播放
            </div>
          </Link>
        ))}
      </div>
      {results.length === 0 && <div className="py-16 text-center text-sm text-slate-500">没有找到相关作品</div>}
    </div>
  );
}
