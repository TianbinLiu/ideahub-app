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
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import SpriteToggle, { type SpriteSheet } from "../components/SpriteToggle";
import UserRow from "../components/UserRow";
import { Link } from "react-router";
import { listVideos, profileHref, remoteOn } from "../data/videos";
import { searchUsers, userDisplayName, type ApiUserLite } from "../api/users";
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

/** 搜人的防抖。300ms：比 @提及补全（250ms）略松一点——这里一次搜的是整屏结果，
 *  用户是"打完一个词看看"，不是"边打边挑人"。不防抖就是每敲一个字一次请求。 */
const USER_DEBOUNCE_MS = 300;
/** 一次列几个人。这一段在分区页顶部，超过 6 行就把「浏览分区」整个挤出首屏 */
const USER_LIMIT = 6;

export default function DiscoverPage() {
  const [videos] = useState(() => listVideos());
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");

  // ── 搜人 ────────────────────────────────────────────────
  // ★ 与视频筛选是**两条独立的路**：视频那份是内存 cache 里同步过一遍，人这份必须问服务端
  //   （本地压根没有用户表）。所以离线时视频照搜不误，人这一段要如实说搜不了。
  const [users, setUsers] = useState<ApiUserLite[]>([]);
  const [userBusy, setUserBusy] = useState(false);
  /** 出错原因，直接显示给用户。全 app 没有任何地方监听 emitApiError，吞掉就是永远空白（铁律八） */
  const [userErr, setUserErr] = useState("");
  /** 这台服务器认不认搜人端点（判响应形状，不是状态码——见 api/users.ts） */
  const [userSupported, setUserSupported] = useState(true);
  const key = q.trim();
  const canSearchUsers = remoteOn();
  // 竞态守门：打字快时后发的请求可能先回来，只认最后那一发
  const seq = useRef(0);

  useEffect(() => {
    if (!canSearchUsers || !key) {
      setUsers([]);
      setUserErr("");
      setUserBusy(false);
      return;
    }
    const mine = ++seq.current;
    setUserBusy(true);
    const timer = window.setTimeout(() => {
      void searchUsers(key, USER_LIMIT)
        .then((r) => {
          if (seq.current !== mine) return;
          setUsers(r.users);
          setUserSupported(r.supported);
          setUserErr("");
        })
        .catch((e) => {
          if (seq.current !== mine) return;
          setUsers([]);
          setUserErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (seq.current === mine) setUserBusy(false);
        });
    }, USER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, canSearchUsers]);

  const results = useMemo(() => {
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
  }, [videos, key, cat, sort]);

  return (
    <div className="safe-top min-h-full px-4 pt-3">
      <div className="mb-4 flex items-center gap-2 rounded-full border border-slate-700 bg-panel px-4 py-2.5">
        <Icon name="search" size={17} className="text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索视频 / 分区 / 用户"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        {q && (
          <button onClick={() => setQ("")} aria-label="清空搜索" className="text-slate-500">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      {/* 用户结果：只在真的输入了东西时才占位置（没输入时这一页的主干是「浏览分区」）。
          ★ 四种状态都得画出来，少画一种就变成"用户看到空白自己去猜"（与消息页同一条理由，铁律八）：
            离线 / 这台服务器没有这个端点 / 出错 / 真的没这个人。 */}
      {key && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">用户</h2>
          {!canSearchUsers ? (
            // ★ 绝不能画成一个空列表：那等于说"查无此人"，而事实是"根本没查"。
            //   措辞不说死成"这个版本没有服务器"——!remoteOn() 也包括「配了地址但连不上」。
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              搜人需要连上服务器 · 当前是离线模式（视频和分区照常能搜）
            </p>
          ) : userErr ? (
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-rose-300">
              搜人失败：{userErr}
            </p>
          ) : !userSupported ? (
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              这台服务器还没有搜人功能 · 服务端升级后即可使用，App 不用重装
            </p>
          ) : userBusy ? (
            <p className="px-1 py-2 text-xs text-slate-500">正在找人…</p>
          ) : users.length === 0 ? (
            <p className="px-1 py-2 text-xs leading-relaxed text-slate-500">
              没有找到「{key}」这个用户
              {/* ★ 这里**不要**再补一句"用户要按账号搜（字母/数字）"：
                  搜人端点是 `$or: [username, displayName]` 的**子串**匹配
                  （users.controller.js 的 searchUsers，tests/userSearch.spec.js S1 钉了
                  "李小明"/"小明" 都搜得到），中文昵称本来就搜得到。
                  在真的查无此人时甩这么一句，等于给用户一个假的失败原因，
                  还会让他从此不再用昵称找人。
                  ⚠ 「@ 的令牌只能是 ASCII」也**不是**理由：那条从来只约束服务端的兜底
                  正则，而补全面板挑人走的是 span，中文 username 照样 @ 得到
                  （见 utils/mention.ts 顶部）。 */}
            </p>
          ) : (
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u._id}>
                  <Link
                    // ★★ 跳转按 **_id**，不是名字：搜出来的人多半**不在**内存那 30 条推荐流里，
                    //   按名字进去的那一页只会拿本地库去筛 —— 筛出 0 条，页面就成了
                    //   「作品 0 / 还没有作品」这种编出来的空状态。而老服务端连 displayName
                    //   都不返回，那时退回的 username 与任何一条缓存作品都对不上，
                    //   点进去甚至是另一个人的主页（都是静默的）。
                    //   带上 name 只是让目标页在问到服务端之前有个名字可显示。
                    to={profileHref({ id: u._id, name: userDisplayName(u) })}
                    className="flex items-center gap-3 rounded-xl px-1 py-1.5 active:opacity-70"
                  >
                    {/* ★ 与 @补全面板**同一个组件**（铁律六）。第二行那个 @username 就是
                        @ 他时要打的那一串，也是补全面板真正插进正文的令牌 ——
                        App 里除了这两处，username 一个字都没露过。 */}
                    <UserRow user={u} size={38} />
                    <Icon name="back" size={16} className="flex-none rotate-180 text-slate-600" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
