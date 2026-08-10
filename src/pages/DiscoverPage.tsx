// 分区页：分区入口 + 搜索（视频标题/简介/作者/分类）+ 作品排序。
//
// ★ 选分区【不改变界面结构】，只有两件事会变：被选中的那个分区放大高亮，
//   以及下面的作品列表跟着筛。
//   老版本一选分区就把「浏览分区」整段收掉、只留一枚 tag —— 于是"再看看别的分区"
//   必须先找到那枚 tag、点掉它、等整段重新长出来。分区入口是这一页的主干，
//   它不该因为你用了它就消失。
//
// ★ 分区图标是 Q 版看板娘 + 该分区的道具，一张精灵图的两端各当一个状态
//   （未选中 = 道具收着、神情安静；选中 = 道具亮出来、表情张扬），
//   与工作流页「生成本段」旁那颗素材按钮是同一套做法（见 components/SpriteToggle）。
import { useMemo, useState } from "react";
import Icon from "../components/Icon";
import SpriteToggle, { type SpriteSheet } from "../components/SpriteToggle";
import { Link } from "react-router";
import { listVideos } from "../data/videos";
import { VIDEO_CATEGORIES, VideoItem, formatDuration, formatPlays } from "../types";

/**
 * 每个分区的看板娘贴图与托盘配色。
 *
 * key 是 ASCII 文件名（中文分区名不能直接当文件名/CSS 类名），两边的对应关系只有这一张表。
 * 单格宽高由 design/gen-discover-icons.mjs 跑完打印，照抄过来 —— 高度写错不报错，
 * 只会把角色拉扁，而这种失真很难一眼看出来。
 */
const CAT_ART: Record<string, { key: string; sheet: SpriteSheet; from: string; ring: string }> = {
  剧情: { key: "drama", sheet: { w: 180, h: 210, frames: 8 }, from: "from-rose-500/35", ring: "ring-rose-400/70" },
  科幻: { key: "scifi", sheet: { w: 180, h: 192, frames: 8 }, from: "from-cyan-500/35", ring: "ring-cyan-400/70" },
  古风: { key: "ancient", sheet: { w: 180, h: 174, frames: 8 }, from: "from-amber-500/35", ring: "ring-amber-400/70" },
  搞笑: { key: "comedy", sheet: { w: 180, h: 209, frames: 8 }, from: "from-lime-500/35", ring: "ring-lime-400/70" },
  动画: { key: "anime", sheet: { w: 180, h: 196, frames: 8 }, from: "from-fuchsia-500/35", ring: "ring-fuchsia-400/70" },
  其他: { key: "other", sheet: { w: 180, h: 195, frames: 8 }, from: "from-slate-500/35", ring: "ring-slate-300/70" },
};

/** 贴图渲染宽度。46px 下 Q 版的眼睛与腮红还认得出（perch 那六张在 40px 上就够）；
 *  再宽六个分区在 375px 的屏上就排不下一行了。 */
const ART_W = 46;
/** 舞台高度 = 最高的那张贴图（剧情 210/180 × 46 ≈ 54）+ 一点余量。
 *  六个分区共用同一个高度，否则一行里的图标会高低不齐。 */
const STAGE_H = 58;

type Sort = "new" | "hot";

/**
 * 排序口径。
 * ★ 「最火」就是**按播放量降序**，并列时看点赞——不搞加权综合分。
 *   综合分的权重（播放 ×1 + 点赞 ×10 + 收藏 ×20 之类）在这个体量下没有任何数据可以校准，
 *   等于拍脑袋，而且用户无法预期"为什么这条排在前面"。一把看得懂的尺子比一把假装
 *   精确的尺子好。真要做热度榜，那是服务端按时间衰减算的事（见 docs/api-contract.md）。
 */
function sortVideos(list: VideoItem[], by: Sort): VideoItem[] {
  if (by === "new") return [...list].sort((a, b) => b.createdAt - a.createdAt);
  return [...list].sort((a, b) => b.plays - a.plays || b.likes - a.likes);
}

export default function DiscoverPage() {
  const [videos] = useState(() => listVideos());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");

  const results = useMemo(() => {
    const key = q.trim();
    const hit = videos.filter(
      (v) =>
        (!cat || v.category === cat) &&
        (!key ||
          v.title.includes(key) ||
          v.description.includes(key) ||
          v.author.includes(key) ||
          v.category.includes(key)),
    );
    return sortVideos(hit, sort);
  }, [videos, q, cat, sort]);

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
          <button onClick={() => setQ("")} aria-label="清空搜索" className="text-slate-500">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-slate-300">浏览分区</h2>
      {/* 一行排开的入口。用 overflow-x-auto 而不是 grid：以后加分区也不会换行挤成两排，
          窄屏上自然变成横滑。-mx-4 px-4 让滑动区贴到屏幕边缘，最后一个不会卡在 padding 里。
          pt-1/pb-1 是给选中那一下的放大留的余量，否则 scale 会被滚动容器裁掉。 */}
      <div
        className="no-scrollbar mb-5 -mx-4 flex justify-between gap-1 overflow-x-auto px-4 pb-1 pt-1"
      >
        {VIDEO_CATEGORIES.map((c) => {
          const art = CAT_ART[c] ?? CAT_ART.其他;
          const on = cat === c;
          return (
            <button
              key={c}
              // 再点一次取消选中：选中态是筛选条件，必须有一条不用去别处找的退路
              onClick={() => setCat(on ? null : c)}
              aria-pressed={on}
              className={`flex w-[52px] flex-none flex-col items-center gap-1 transition-transform duration-200 active:scale-95 ${
                on ? "scale-110" : ""
              }`}
            >
              {/* 舞台：托盘在下、角色站在托盘上（半身，脚下就是托盘边缘）。
                  角色比托盘高出一截是刻意的——"从托盘后面探出来"，与底栏挂件同一套关系。 */}
              <span className="relative flex w-full items-end justify-center" style={{ height: STAGE_H }}>
                <span
                  className={`absolute bottom-0 left-1/2 h-10 w-10 -translate-x-1/2 rounded-full bg-gradient-to-br to-panel transition ${
                    art.from
                  } ${on ? `ring-2 ${art.ring} shadow-lg` : ""}`}
                />
                <SpriteToggle
                  src={`/discover/${art.key}.webp`}
                  sheet={art.sheet}
                  size={ART_W}
                  on={on}
                  className="relative"
                />
              </span>
              <span
                className={`w-full truncate text-center text-[11px] transition-colors ${
                  on ? "font-semibold text-brand" : "text-slate-300"
                }`}
              >
                {c}
              </span>
            </button>
          );
        })}
      </div>

      {/* 标题栏：左边说"在看什么"，右边换排法。
          ★ 选了分区**不在这里另开一枚 tag** —— 分区图标自己已经是高亮的了，
            再显示一遍就是把同一件事说两次，还引出"关掉 tag"和"再点一次图标"两条
            互相矛盾的退路。 */}
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="flex-none text-sm font-semibold text-slate-300">{sort === "new" ? "最新作品" : "最火作品"}</h2>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {cat ? `${cat} · ` : ""}
          {results.length} 个作品
        </span>
        <div className="flex flex-none rounded-full bg-panel p-0.5">
          {([
            ["new", "最新"],
            ["hot", "最火"],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              aria-pressed={sort === k}
              className={`rounded-full px-2.5 py-1 text-[11px] transition ${
                sort === k ? "bg-brand font-semibold text-ink" : "text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

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
      {results.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-500">
          {cat ? `「${cat}」还没有作品` : "没有找到相关作品"}
        </div>
      )}
    </div>
  );
}
