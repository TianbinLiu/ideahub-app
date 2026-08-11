// 视频详情页：播放器（多 P 可切换）+ 信息 + 分段剧情 + 评论区
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { Link, useNavigate, useParams } from "react-router";
import BranchPlayer from "../components/BranchPlayer";
import SegmentPlayer from "../components/SegmentPlayer";
import Avatar from "../components/Avatar";
import { addCards, hasPurchased, myCards, purchasePart, walletOf } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { fmtTokens } from "../data/economy";
import { addComment, addPlay, getVideo, isMyAuthor, partsOf, setLike } from "../data/videos";
import { useCurrentUser } from "../hooks/useAccount";
import { useVideosVersion } from "../hooks/useVideos";
import { useStudio } from "../studio/studioStore";
import TarotCard from "../components/TarotCard";
import { CARD_TYPE_LABELS, VideoComment, formatPlays, relativeTime } from "../types";

/** 本片卡组：卡片横滑条 + 收入/去创作。收入 = 卡片拷进观众账号；
 *  去创作 = 顺手并进工坊桌面卡组并跳工坊（工坊卡组是会话态，必须显式合并） */
function VideoDeckSection({ video, loggedIn, onGo }: { video: NonNullable<ReturnType<typeof getVideo>>; loggedIn: boolean; onGo: () => void }) {
  const deck = video.deck!;
  const [got, setGot] = useState(() => {
    const mine = new Set(myCards().map((c) => c.id));
    return deck.cards.every((c) => mine.has(c.id));
  });

  function collect(): boolean {
    if (!loggedIn) return false;
    addCards(deck.cards);
    setGot(true);
    return true;
  }

  return (
    <section className="mt-6">
      <h2 className="mb-3 text-base font-bold text-slate-200">
        本片卡组
        <span className="ml-2 text-xs font-normal text-slate-500">
          {deck.name || `${deck.cards.length} 张`} · 收入后可用同款素材生成相似视频
        </span>
      </h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {deck.cards.map((c) => (
          // 点卡看详情：不在观众账号库里的卡经路由 state 带过去（详情页优先查账号库）
          <Link key={c.id} to={`/card/${c.id}`} state={{ card: c }} className="w-24 flex-none">
            <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
          </Link>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={collect}
          disabled={got}
          className="rounded-xl bg-panel px-4 py-2 text-sm text-slate-200 ring-1 ring-slate-700 disabled:opacity-50"
          title={loggedIn ? "" : "登录后可收入卡组"}
        >
          {got ? "✓ 已在我的卡组" : "收入我的卡组"}
        </button>
        <button
          onClick={() => {
            collect(); // 未登录时静默跳过（/studio 的登录墙会接手，登录后卡组仍在会话里）
            // 并进工坊桌面（去重），进门就能直接拖卡铸节点
            useStudio.setState((s) => ({
              deck: [...s.deck, ...deck.cards.filter((c) => !s.deck.some((d) => d.id === c.id))],
            }));
            onGo();
          }}
          className="flex-1 rounded-xl bg-brand/90 px-4 py-2 text-sm font-bold text-ink"
        >
          🎴 用这套卡去创作
        </button>
      </div>
    </section>
  );
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useCurrentUser();
  // 订阅作品库：远端模式下 getVideo() 会在后台补一次详情接口（列表不带 comments），
  // 回填是原地改同一个对象，不订阅就永远渲染不出来。
  const version = useVideosVersion();
  const video = useMemo(() => (id ? getVideo(id) : null), [id, version]);
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(video?.likes ?? 0);
  const [plays, setPlays] = useState(video?.plays ?? 0);
  const [comments, setComments] = useState<VideoComment[]>(video?.comments ?? []);
  const [draft, setDraft] = useState("");
  // 多 P：老作品 partsOf 归一成单 P，pi 越界（编辑删 P 后）自动夹回
  const parts = useMemo(() => (video ? partsOf(video) : []), [video, version]);
  const [pi, setPi] = useState(0);
  const piSafe = Math.min(pi, Math.max(0, parts.length - 1));
  const part = parts[piSafe] ?? null;
  // 付费墙：本 P 定价 > 0 且 观众≠作者 且 未购 → 用封面顶住播放器，解锁后放行
  useAccountVersion(); // 购买/余额变化即时反映
  const partPrice = video?.pricing?.mode === "paid" ? (video.pricing.partPrices[piSafe] ?? 0) : 0;
  const locked = !!video && partPrice > 0 && !isMyAuthor(video.author) && !hasPurchased(video.id, piSafe);
  const [payErr, setPayErr] = useState("");

  // 详情回填晚于首帧渲染：把服务端那份同步进来。
  // 本地已有的乐观值（刚点的赞、刚发的评论）取较大/较长的一边，别被回包覆盖掉。
  useEffect(() => {
    if (!video) return;
    setLikes((v) => Math.max(v, video.likes));
    setPlays((v) => Math.max(v, video.plays));
    setComments((cs) => (video.comments.length > cs.length ? video.comments : cs));
  }, [video, version]);

  // per-id 去重：StrictMode 双跑 effect 也只 +1，并把新计数渲染出来
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (id && video && counted.current !== id) {
      counted.current = id;
      setPlays(addPlay(id));
    }
  }, [id, video]);

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
      {/* ★ safe-top 挂在 header 自己身上、不挂页面根：header 是 sticky top-0，
          安全区留白必须【在它内部】，否则它会滑到状态栏底下（ProfilePage 那条注释同理）。
          原来这三页压根没挂，顶栏文案直接压在状态栏上。 */}
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="text-slate-400 hover:text-white">
            <Icon name="back" size={20} />
          </Link>
          <span className="truncate text-sm text-slate-300">{video.title}</span>
          {isMyAuthor(video.author) && video.merged ? (
            // 合并发布的成片不可修改：只能用同款卡组回工坊重新生成
            <Link
              to="/studio"
              title="合并发布的成片不可修改，可用同款卡组重新生成"
              className="ml-auto flex-none rounded-full bg-slate-700/60 px-3 py-1.5 text-xs text-slate-300"
            >
              🔒 成片已定 · 用卡组再创作
            </Link>
          ) : isMyAuthor(video.author) ? (
            <Link
              to={`/edit/${video.id}`}
              className="ml-auto flex-none rounded-full bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300"
            >
              ✏️ 编辑
            </Link>
          ) : (
            <Link to="/studio" className="ml-auto flex-none rounded-full bg-brand/15 px-3 py-1.5 text-xs text-brand">
              🎴 我也要创作
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        {/* 多 P 选集：单 P 不显示（绝大多数作品），有分集才占这一行 */}
        {parts.length > 1 && (
          <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5">
            {parts.map((p, i) => (
              <button
                key={i}
                onClick={() => setPi(i)}
                className={`flex-none rounded-lg px-3 py-1.5 text-xs ${
                  i === Math.min(pi, parts.length - 1)
                    ? "bg-brand font-semibold text-ink"
                    : "bg-panel text-slate-300 hover:bg-slate-700"
                }`}
              >
                {p.name || `P${i + 1}`}
              </button>
            ))}
          </div>
        )}
        {part &&
          (locked ? (
            // 付费墙：封面 + 解锁按钮。解锁扣观众 token（先套餐后 add-on），创作者分成进 add-on
            <div className="relative overflow-hidden rounded-xl">
              <img src={video.cover} alt={video.title} className="aspect-video w-full object-cover blur-[2px] brightness-50" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5">
                <span className="text-2xl">🔒</span>
                <div className="text-sm font-semibold text-slate-100">
                  本 P 为付费内容 · <span className="tabular-nums text-gold">{fmtTokens(partPrice)} token</span>
                </div>
                <button
                  onClick={() => {
                    setPayErr("");
                    if (!user) {
                      navigate(`/login?next=/video/${video.id}`);
                      return;
                    }
                    if (!purchasePart(video.id, piSafe, partPrice, video.author)) {
                      const w = walletOf();
                      setPayErr(
                        `余额不足（现有 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))}）——去「我的」页充值`,
                      );
                    }
                  }}
                  className="rounded-full bg-gold px-5 py-2 text-sm font-bold text-ink active:scale-95"
                >
                  ⚡ 解锁观看
                </button>
                {payErr && (
                  <Link to="/me" className="text-xs text-rose-300 underline">
                    {payErr}
                  </Link>
                )}
                <span className="text-[10px] text-slate-400">解锁后永久可看 · 收益归创作者（平台抽成 30%）</span>
              </div>
            </div>
          ) : part.branchTree ? (
            <BranchPlayer key={`b${pi}`} tree={part.branchTree} cover={video.cover} />
          ) : (
            <SegmentPlayer key={`s${pi}`} segments={part.segments} cover={video.cover} />
          ))}

        <h1 className="mt-4 text-xl font-bold text-slate-100">{video.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
          {/* 作者可点：从详情页也要能走到创作者主页，否则「看看 TA 还发过什么」
              只有首页头像一条路 */}
          <Link
            to={isMyAuthor(video.author) ? "/me" : `/u/${encodeURIComponent(video.author)}`}
            className="flex items-center gap-2 active:opacity-70"
          >
            <Avatar name={video.author} size={32} />
            <span className="text-slate-200">{video.author}</span>
          </Link>
          <span>{formatPlays(plays)}播放</span>
          <span>{relativeTime(video.createdAt)}</span>
          <span className="rounded-full bg-panel px-2.5 py-0.5 text-xs">{video.category}</span>
          {part?.branchTree && (
            <span className="rounded-full bg-purple-500/15 px-2.5 py-0.5 text-xs text-purple-300">
              互动视频 · {Object.values(part.branchTree.nodes).filter((n) => n.choices.length > 1).length} 个分支点
            </span>
          )}
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

        {/* 本片卡组：作者生成本片所用素材卡的快照。观众收入后用同一套素材
            进工坊，就能生成相似走向的视频——创作的可复刻性是卡片生态的闭环 */}
        {video.deck && video.deck.cards.length > 0 && <VideoDeckSection video={video} loggedIn={!!user} onGo={() => navigate("/studio")} />}

        {/* 这里原来有一段「分段剧情 · N 个节点」：逐段列首尾帧 + 小说体剧情。
            移除的理由是它把成片又用图文复述了一遍——观众已经看完视频了，
            而首尾帧属于创作侧的中间产物（要看去工坊/剪辑页）。 */}

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
