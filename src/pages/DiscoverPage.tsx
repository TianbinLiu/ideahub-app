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
import EmptyState from "../components/EmptyState";
import AigcBadge, { isAigcWork } from "../components/AigcBadge";
import Icon from "../components/Icon";
import SearchField from "../components/SearchField";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { tourById } from "../components/guide/tours";
import { activeGuide, guideSeen, subscribeGuide } from "../data/guide";
import SpriteToggle, { type SpriteSheet } from "../components/SpriteToggle";
import UserRow from "../components/UserRow";
import VideoTile from "../components/VideoTile";
import { Link, useLocation, useNavigate } from "react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { listVideos, profileHref, remoteOn, searchVideos } from "../data/videos";
import { clearSearchHistory, rememberSearch, searchHistory } from "../data/searchHistory";
import { searchUsers, userDisplayName, type ApiUserLite } from "../api/users";
import { VIDEO_CATEGORIES, VideoItem, formatPlays, videoCategoryLabel } from "../types";

/**
 * 每个分区的看板娘贴图与托盘配色。
 *
 * key 是 ASCII 文件名（中文分区名不能直接当文件名/CSS 类名），两边的对应关系只有这一张表。
 * 单格宽高由 design/gen-discover-icons.mjs 跑完打印，照抄过来 —— 高度写错不报错，
 * 只会把角色拉扁，而这种失真很难一眼看出来。
 */
const CAT_ART: Record<string, { key: string; sheet: SpriteSheet; from: string; ring: string }> = {
  剧情: { key: "drama", sheet: { w: 180, h: 210, frames: 8 }, from: "from-danger-500/35", ring: "ring-danger-400/70" },
  科幻: { key: "scifi", sheet: { w: 180, h: 192, frames: 8 }, from: "from-cyan-500/35", ring: "ring-cyan-400/70" },
  古风: { key: "ancient", sheet: { w: 180, h: 174, frames: 8 }, from: "from-warn-500/35", ring: "ring-warn-400/70" },
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
  // ★ 无条件弹：这一页没有登录墙，谁都能逛
  useAutoGuide("discover", true);
  const { t } = useLingui();
  /**
   * 搜索结果。★★ 2026-08-30 之前这里是 `useState(() => listVideos())` —— 挂载时把本地
   *   cache **快照一份**就再也不问服务端，而远端模式下那份 cache 只有推荐流的 30 条。
   *   于是"搜索"其实是"在最近 30 条里筛"：从通知/别人主页/分享链接进来的作品，
   *   在这一页一律搜不到，而页面画的是「没有找到相关作品」—— 说的是假话。
   *   （同一页的**搜人**那半早就走服务端了，注释里还写着这个坑，视频这半一直没跟上。）
   *   现在走 data 层的 searchVideos 一处：远端就问服务端，离线就筛本地。
   */
  const [videos, setVideos] = useState<VideoItem[]>(() => listVideos());
  const [vidBusy, setVidBusy] = useState(false);
  /** 非空 = 这次没搜成（退回了本地那几条）。空结果与"没搜成"必须分得开（铁律八） */
  const [vidErr, setVidErr] = useState("");
  const vseq = useRef(0);
  // ★ 初始搜索词可以由别处带进来（作品详情页的标签芯片：navigate("/discover", { state: { q } })）。
  //   放在 useState 的初值里而不是 effect 里同步：effect 那种写法会先渲染一屏"全部作品"
  //   再跳成结果，而且用户改完搜索词一返回又被盖回去。
  const nav0 = useLocation();
  const [q, setQ] = useState<string>(() => {
    const s = nav0.state as { q?: unknown } | null;
    return typeof s?.q === "string" ? s.q : "";
  });
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const navigate = useNavigate();

  // ── 搜索框获得焦点、还没输入时：搜索历史 + 近期热播（2026-10-21，docs/ui-benchmark-2026-10.md 第三节）──
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(() => searchHistory());
  // 从首页右上角那颗搜索进来（navigate("/discover", { state: { focusSearch: true } })）：落地就把焦点放进框里。
  // 只认挂载那一拍（ref 记着），返回再进这一页不重复抢焦点。
  // ★ 第一次进这一页时本页的引导会自动弹（useAutoGuide 等 420ms 再开）：这时先不抢焦点，等引导关了再给。
  //   抢了的话键盘顶上来、搜索面板盖住分区那一排，引导第 3、4 步讲「分区图标」时那一排根本不在屏上（浏览器里实测撞到）
  const focusReq = useRef((nav0.state as { focusSearch?: unknown } | null)?.focusSearch === true);
  useEffect(() => {
    if (!focusReq.current) return;
    // ★ 读到就从这条历史记录上摘掉：state 跟着历史条目走，从这里点进作品再按返回，这一页重新挂载又会读到它、又抢一次焦点
    //   （键盘弹起来、面板盖住刚才在看的网格；2026-10-21 评审抓到）。ref 留着，引导没讲完时照样等它讲完再聚焦
    const { focusSearch: _used, ...rest } = (nav0.state ?? {}) as Record<string, unknown>;
    navigate({ pathname: nav0.pathname, search: nav0.search }, { replace: true, state: Object.keys(rest).length ? rest : null });
    const ver = tourById("discover")?.version ?? 1;
    const tryFocus = () => {
      if (!focusReq.current || !guideSeen("discover", ver) || activeGuide()) return;
      focusReq.current = false;
      inputRef.current?.focus();
    };
    tryFocus();
    return subscribeGuide(tryFocus);
  }, []);
  /** 记一条历史（按回车 / 失焦时框里有词 / 点了历史或热播），并刷新那一排 */
  const commit = (term: string) => {
    rememberSearch(term);
    setHistory(searchHistory());
  };

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

  // 搜索词/分区变了就重问一次（防抖与搜人同一个常量）。
  // ★ 竞态用 seq 挡：慢的那一发回来时不许覆盖新结果（与上面搜人那段同款）。
  useEffect(() => {
    const mine = ++vseq.current;
    setVidBusy(true);
    const timer = window.setTimeout(() => {
      void searchVideos({ q: key, category: cat, limit: 50 })
        .then((r) => {
          if (vseq.current !== mine) return;
          setVideos(r.items);
          setVidErr(r.reason ?? "");
        })
        .finally(() => {
          if (vseq.current === mine) setVidBusy(false);
        });
    }, USER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, cat]);

  // ★ 排序只在**这一页拿到的这批**里做（服务端按时间给，"最火"没有服务端口径）。
  //   条数上限 50，够用且不至于把一整页塞满 —— 真要翻页是另一件事。
  const results = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  /**
   * 近期热播：搜索框空着时那一批（最近发布的至多 50 条，选了分区就是那个分区的）里播放最多的八条。
   * ★ 不叫「热榜」：服务端没有按时间衰减的热度（见上面 sortVideos 的 ★），这只是「最近这一批里谁播得多」，
   *   标题照实这么说。0 播放的不进；凑不到 3 条就整块不画 —— 一张两行的「热播」比没有更像坏了。
   */
  const hot = useMemo(
    () => [...videos].filter((v) => v.plays > 0).sort((a, b) => b.plays - a.plays || b.likes - a.likes).slice(0, 8),
    [videos],
  );
  /** 搜索面板（历史 + 热播）开着：框里有焦点、还没打字。开着时下面的分区与作品网格先收起来（抖音 / 快手点进搜索都是整屏换成这一层） */
  const panel = focused && !key;
  /** 选中分区的显示名（取成有名字的变量：翻译目录里才是 {catLabel} 而不是 {0}） */
  const catLabel = cat ? videoCategoryLabel(cat) : "";

  return (
    <div className="min-h-full px-4 pb-10">
      {/* ★ `?` 摆在搜索框同一行的右边：这一页没有标题栏，没有别的地方好放，
          而它必须在**正常流**里 —— absolute 定位会钻到系统状态栏底下去（首页栽过一次）。
          ★ 这一行按 PageHeader 的规格摆（safe-top + 48px 行内居中），和别的页顶栏同一条线 */}
      {/* ★ 搜索这一行钉在顶上（2026-10-21；CLAUDE.md「会滚动的页一律 sticky 顶栏」）：原来随网格一起滚走，滚到第三屏想换个词就得滚回顶。
          -mx-4 px-4 让底色铺满整宽；bg-ink 不透明 —— 不加 backdrop-blur（它会给 position:fixed 的后代造包含块，CLAUDE.md 那格坑）。
          与第一块内容之间 12px（mb-3，PageHeader 那条规矩） */}
      <div className="sticky top-0 z-20 -mx-4 mb-3 bg-ink px-4">
        <div className="safe-top-bar flex items-center gap-2">
          {/* 搜索框是共用的 SearchField（2026-10-23）。clearKeepsFocus：点 ✕ 不让面板收起来再打开一次，清完光标留在框里 ——
              清掉一个词多半是要换一个词（抖音 / B 站的 ✕ 都是这样），框没焦点时清完只剩整页列表，历史那一排还得再点一下框才出来 */}
          <SearchField
            shape="pill"
            guide="discover-search"
            className="flex-1"
            inputRef={inputRef}
            value={q}
            onChange={setQ}
            clearKeepsFocus
            onFocus={() => {
              setFocused(true);
              setHistory(searchHistory());
            }}
            onBlur={() => {
              setFocused(false);
              if (key) commit(key);
            }}
            onKeyDown={(e) => {
              // 回车 = 「就搜这个」：记进历史、收起键盘（结果早已随打字出来了，这一下只是收尾）
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            // ★ 照实写能搜到什么（2026-10-21）：远端只匹配标题 / 简介 / 话题标签（docs/api-contract.md），原来写「分区」是许诺做不到的事
            placeholder={t`搜索作品、话题标签或用户`}
          />
          {focused ? (
            // 搜索态的出口（抖音式「取消」）：只收起键盘与面板，框里的词留着
            <button onClick={() => inputRef.current?.blur()} className="flex-none px-1 text-sm text-slate-300 active:opacity-60">
              <Trans>取消</Trans>
            </button>
          ) : (
            <HelpButton tour="discover" className="flex-none" />
          )}
        </div>
      </div>

      {panel && (
        <section className="pb-6" onPointerDown={(e) => e.preventDefault()}>
          {/* ↑ 整块 onPointerDown preventDefault：点历史芯片 / 热播那一行时别先把输入框的焦点抢走（先失焦，面板就收起来了，点不到） */}
          {history.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center">
                <h2 className="flex-1 text-sm font-semibold text-slate-300">
                  <Trans>搜索历史</Trans>
                </h2>
                <button
                  onClick={() => {
                    clearSearchHistory();
                    setHistory([]);
                  }}
                  className="text-[11px] text-slate-400 underline underline-offset-2 active:opacity-60"
                >
                  <Trans>清空</Trans>
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {history.map((h) => (
                  <button
                    key={h}
                    onClick={() => {
                      setQ(h);
                      commit(h);
                    }}
                    className="max-w-[12rem] truncate rounded-full bg-panel px-3.5 py-1.5 text-xs text-slate-300 active:opacity-60"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
          {hot.length >= 3 && (
            <div>
              <h2 className="mb-0.5 text-sm font-semibold text-slate-300">
                {catLabel ? t`「${catLabel}」近期热播` : t`近期热播`}
              </h2>
              <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
                <Trans>最近发布的作品里播放最多的几条</Trans>
              </p>
              <ol className="space-y-1">
                {hot.map((v, i) => (
                  <li key={v.id}>
                    <button
                      onClick={() => {
                        inputRef.current?.blur();
                        navigate(`/video/${v.id}`);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl px-1 py-1.5 text-left active:opacity-60"
                    >
                      {/* 名次：前三名用金色（看板娘星形发夹那一种金），其余灰 —— 名次是真的先后，不是装饰 */}
                      <span className={`w-5 flex-none text-center text-sm font-bold tabular-nums ${i < 3 ? "text-gold" : "text-slate-400"}`}>{i + 1}</span>
                      <img src={v.cover} alt="" aria-hidden loading="lazy" className="h-12 w-9 flex-none rounded-md object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-sm text-slate-100">{v.title}</span>
                        {/* AI 标识：面板开着时下面那片带角标的网格整个不画，这一排就是此刻屏幕上的「发布内容周边」（AigcBadge 的 ★★，2026-10-21 评审抓到漏了） */}
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          {isAigcWork(v) && <AigcBadge />}
                          <Trans>{formatPlays(v.plays)}播放</Trans>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {history.length === 0 && hot.length < 3 && (
            <EmptyState compact mascot="wonder" text={t`想找什么？输入作品标题、话题标签或用户名`} />
          )}
        </section>
      )}

      {/* 用户结果：只在真的输入了东西时才占位置（没输入时这一页的主干是「浏览分区」）。
          ★ 四种状态都得画出来，少画一种就变成"用户看到空白自己去猜"（与消息页同一条理由，铁律八）：
            离线 / 这台服务器没有这个端点 / 出错 / 真的没这个人。 */}
      {key && (
        <section data-guide="discover-users" className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-300"><Trans>用户</Trans></h2>
          {!canSearchUsers ? (
            // ★ 绝不能画成一个空列表：那等于说"查无此人"，而事实是"根本没查"。
            //   措辞不说死成"这个版本没有服务器"——!remoteOn() 也包括「配了地址但连不上」。
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              <Trans>搜人需要连上服务器 · 当前是离线模式（视频和分区照常能搜）</Trans>
            </p>
          ) : userErr ? (
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-danger-300">
              <Trans>搜人失败：{userErr}</Trans>
            </p>
          ) : !userSupported ? (
            <p className="rounded-xl bg-panel/60 px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              <Trans>搜人功能还没上线 · 之后会有，App 不用重装</Trans>
            </p>
          ) : userBusy ? (
            <p className="px-1 py-2 text-xs text-slate-500"><Trans>正在找人…</Trans></p>
          ) : users.length === 0 ? (
            <p className="px-1 py-2 text-xs leading-relaxed text-slate-500">
              <Trans>没有找到「{key}」这个用户</Trans>
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
                    className="flex items-center gap-3 rounded-xl px-1 py-1.5 active:opacity-60"
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

      {!panel && (
      <>
      <h2 className="mb-2 text-sm font-semibold text-slate-300"><Trans>浏览分区</Trans></h2>
      {/* 一行排开的入口。用 overflow-x-auto 而不是 grid：以后加分区也不会换行挤成两排，
          窄屏上自然变成横滑。-mx-4 px-4 让滑动区贴到屏幕边缘，最后一个不会卡在 padding 里。
          pt-1/pb-1 是给选中那一下的放大留的余量，否则 scale 会被滚动容器裁掉。 */}
      <div
        data-guide="discover-cats"
        // ★ 七格（「全部」+ 六个分区）各 46px：363 宽的屏上内容区 331px，7 × 46 = 322 放得下一行；原来六格各 52px（2026-10-21 量）
        className="no-scrollbar mb-5 -mx-4 flex justify-between gap-0.5 overflow-x-auto px-4 pb-1 pt-1"
      >
        {/* 「全部」（2026-10-21，调研第三节）：原来取消分区只能「再点一次同一个」，没有一个看得见的出口。
            画法与六个分区同一套托盘 + 同一个角色（官方 Q 版头像那张「打招呼」），选中态同样放大 + 色环 */}
        <button
          onClick={() => setCat(null)}
          aria-pressed={cat === null}
          className={`flex w-[46px] flex-none flex-col items-center gap-1 transition-transform duration-200 active:scale-95 ${
            cat === null ? "scale-110" : ""
          }`}
        >
          <span className="relative flex w-full items-end justify-center" style={{ height: STAGE_H }}>
            <span
              className={`absolute bottom-0 left-1/2 h-10 w-10 -translate-x-1/2 rounded-full bg-gradient-to-br from-sky-500/35 to-panel transition ${
                cat === null ? "ring-2 ring-sky-400/70 shadow-lg" : ""
              }`}
            />
            <img src="/avatars/mascot-hi.webp" alt="" aria-hidden className="relative mb-1 h-9 w-9 rounded-full object-cover" />
          </span>
          <span className={`w-full truncate text-center text-[11px] transition-colors ${cat === null ? "font-semibold text-brand" : "text-slate-300"}`}>
            <Trans>全部</Trans>
          </span>
        </button>
        {VIDEO_CATEGORIES.map((c) => {
          // ★ 精灵图与筛选条件都认 id（id 是跨仓契约，见 types.VIDEO_CATEGORIES），屏幕上只画 label
          const art = CAT_ART[c.id] ?? CAT_ART.其他;
          const on = cat === c.id;
          return (
            <button
              key={c.id}
              // 再点一次取消选中：选中态是筛选条件，必须有一条不用去别处找的退路
              onClick={() => setCat(on ? null : c.id)}
              aria-pressed={on}
              className={`flex w-[46px] flex-none flex-col items-center gap-1 transition-transform duration-200 active:scale-95 ${
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
                {c.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* 标题栏：左边说"在看什么"，右边换排法。
          ★ 选了分区**不在这里另开一枚 tag** —— 分区图标自己已经是高亮的了，
            再显示一遍就是把同一件事说两次，还引出"关掉 tag"和"再点一次图标"两条
            互相矛盾的退路。 */}
      <div data-guide="discover-scope" className="mb-2.5 flex items-center gap-2">
        <h2 className="flex-none text-sm font-semibold text-slate-300">{sort === "new" ? t`最新作品` : t`最火作品`}</h2>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {cat ? t`${videoCategoryLabel(cat)} · ${results.length} 个作品` : t`${results.length} 个作品`}
        </span>
        <div className="flex flex-none rounded-full bg-panel p-0.5">
          {([
            ["new", t`最新`],
            ["hot", t`最火`],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              aria-pressed={sort === k}
              className={`rounded-full px-3 py-1 text-[11px] transition ${
                sort === k ? "bg-brand font-semibold text-ink" : "text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ★ 四种结局分开说（与本页搜人那半同一条理由）：在搜 / 没搜成 / 真的没有 / 这个分区没有。
          原来只有最后两种，于是"服务器没搜成"被画成了"没有找到相关作品"。
          ★ 摆在网格**上面**（2026-10-14 UX 课走查）：「没搜成」时下面照样铺着本机那几十条兜底结果，这句原来排在网格之后、
            一屏都滚不到，等于没说 */}
      {vidBusy && results.length === 0 ? (
        <EmptyState loading text={t`正在搜…`} />
      ) : vidErr ? (
        <EmptyState error text={t`没搜成：${vidErr}`} hint={t`下面列的是这台设备上已有的那几条，不是全部结果。`} />
      ) : results.length === 0 ? (
        <EmptyState
          mascot={key ? "wonder" : "nap"}
          text={key ? t`没有找到「${key}」相关的作品` : cat ? t`「${videoCategoryLabel(cat)}」还没有作品` : t`还没有作品`}
          hint={key ? t`换个词试试，或者搜话题标签` : undefined}
          cta={key ? undefined : { label: t`去创作`, to: "/create", primary: true }}
        />
      ) : null}
      {/* 双列卡片（2026-10-21 按 B 站 / 小红书的卡片结构重排，调研第三节）：封面底部一条渐变，左下「▶ 播放量」、右下时长；
          「AI 生成」挪到右上角（合规标识必须在，判据只有 isAigcWork）；封面下面两行标题 + 一行「头像 · 作者 · ♥ 点赞」。 */}
      <div className="grid grid-cols-2 gap-3 pb-4">
        {results.map((v) => (
          <VideoTile key={v.id} video={v} />
        ))}
      </div>
      </>
      )}
    </div>
  );
}
