// 视频详情页：播放器（多 P 可切换）+ 信息 + 分段剧情 + 评论区
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import BranchPlayer from "../components/BranchPlayer";
import SegmentPlayer from "../components/SegmentPlayer";
import Avatar from "../components/Avatar";
import { addCards, hasPurchased, myCards, purchasePart, walletOf } from "../data/account";
import { useAccountVersion } from "../hooks/useAccount";
import { fmtTokens } from "../data/economy";
import {
  addComment,
  addPlay,
  authorAvatarOf,
  fetchVideoById,
  getVideo,
  isMyAuthor,
  partsOf,
  profileHref,
  setLike,
  type VideoLookup,
} from "../data/videos";
import { markNotificationRead } from "../data/notifications";
import type { MentionPick } from "../utils/mention";
import CommentDelete from "../components/CommentDelete";
import MentionInput from "../components/MentionInput";
import MentionText from "../components/MentionText";
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
  const loc = useLocation();
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
  /** 从补全面板挑过的人。★ 只攒不算位置——理由与 CommentSheet 同一条（见那里） */
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [busyComment, setBusyComment] = useState(false);
  const [commentErr, setCommentErr] = useState("");
  /** 评论发出去了、但有几个 @ 服务端没认下来。黄字：评论本身是成功的 */
  const [mentionWarn, setMentionWarn] = useState("");
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

  /**
   * 内存里没有这一条时**去问服务端**。
   *
   * ★★ 这是本页最要紧的一段：内存 cache 只有推荐流的前 30 条，而进到这一页的路
   *   （通知里的 @、别人主页的作品墙、分享出去的链接）指向的作品**基本都不在里面**。
   *   原来这里直接画「视频不存在或已删除」—— 服务端从来没被问过，那句话是编的。
   * ★ 结果分四档（见 data/videos.VideoLookup）：查证之前一律显示"正在打开"，
   *   只有服务端真的说了"没有"才敢说不存在；超时/断网说的是"没打开"，不是"已删除"。
   */
  const [lookup, setLookup] = useState<VideoLookup | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLookup(null);
    void fetchVideoById(id).then((r) => {
      if (alive) setLookup(r);
    });
    return () => {
      alive = false;
    };
  }, [id, retry]);

  /**
   * 从通知点进来的那一条：**打开成功了才标已读**。
   *
   * ★★ 原来是在消息页点下去的那一瞬间就标已读的。可这一跳很可能落在
   *   「视频不存在」上（就是上面在修的那个 bug），于是用户既没看到内容、
   *   红点也没了 —— 唯一的入口就这么消失了。已读的含义是"这条我处理过了"，
   *   在真的把人送到目标之前不该先把它划掉。
   * ★ 反过来也要**保证会标**：这里跑到了就说明内容真的展示出来了。
   */
  const readMarked = useRef<string | null>(null);
  const fromNotification = (loc.state as { fromNotification?: string } | null)?.fromNotification;
  useEffect(() => {
    if (!video || !fromNotification || readMarked.current === fromNotification) return;
    readMarked.current = fromNotification;
    void markNotificationRead(fromNotification);
  }, [video, fromNotification]);

  if (!video) {
    // ★ 还没问出结果：不下任何结论。转圈比一句错的结论好
    if (!lookup) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
          <div className="text-xs">正在打开这条作品…</div>
        </div>
      );
    }
    const text =
      lookup.status === "missing"
        ? "这条作品不存在，或已被作者删除"
        : lookup.status === "offline"
          ? "这台设备上没有这条作品 · 当前是离线模式"
          : `没能打开这条作品：${lookup.status === "failed" ? lookup.error : ""}`;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-slate-400">
        <div className={lookup.status === "failed" ? "text-sm text-rose-300" : "text-sm"}>{text}</div>
        {lookup.status === "failed" && (
          <>
            {/* 失败可以，但要能自己重试 —— 而且这一条**没被标已读**，消息页那个红点还在 */}
            <button
              onClick={() => setRetry((n) => n + 1)}
              className="rounded-full bg-panel px-5 py-2 text-sm font-semibold text-slate-100 ring-1 ring-slate-700"
            >
              重试
            </button>
            <p className="text-[11px] leading-relaxed text-slate-600">
              内容可能还在，只是这次没取到（网络或服务器的问题）
            </p>
          </>
        )}
        {/* ★ 这一屏没有顶栏，所以「回去」必须自己给一个：从消息页点进来的人
            最想做的就是退回去再点一次，而不是被扔回首页从头找。 */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
              if (idx > 0) navigate(-1);
              else navigate("/");
            }}
            className="text-slate-300"
          >
            返回
          </button>
          <Link to="/" className="text-brand">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  function toggleLike() {
    if (!video) return;
    const on = !liked;
    setLiked(on);
    setLikes(setLike(video.id, on));
  }

  /**
   * ★ 真等回包再清空输入框，口径与 CommentSheet / DanmakuInput 一致：
   *   评论会失败（限流 / 登录过期 / 作品还没同步上去），而全 app 没有任何地方监听
   *   emitApiError —— 清空了输入框又不说原因，用户打的字就凭空没了（铁律八）。
   */
  async function submitComment() {
    if (!video || busyComment || !draft.trim()) return;
    setBusyComment(true);
    setCommentErr("");
    setMentionWarn("");
    try {
      const posted = await addComment(video.id, draft.trim(), picks);
      if (posted) setComments((cs) => [posted.comment, ...cs]);
      setDraft("");
      setPicks([]);
      // ★★ 与 CommentSheet 同一条口径：@ 没落地必须说出来，否则就是"@ 了、对方永远
      //   收不到"的静默失败（老服务端会把 mentions 整个 strip 掉，且不报错）。
      if (posted && posted.droppedMentions > 0) {
        setMentionWarn(`有 ${posted.droppedMentions} 个 @ 没能送达（对方不会收到通知）`);
      }
    } catch (e) {
      setCommentErr(e instanceof Error ? e.message : "评论没发出去，请重试");
    } finally {
      setBusyComment(false);
    }
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
          {/* ★ 这里原来对「合并发布的成片」（video.merged）单独走一条"不可修改"的分支，
              把作者挡在编辑页外面 —— 连改个标题、把作品设成仅自己可见都做不到。
              现在**所有**作品的成片都不可修改（发布即定稿），编辑页本身就只改壳，
              这个特例没有存在意义了，一视同仁给编辑入口。 */}
          {isMyAuthor(video.author) ? (
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
            // 有 authorId 就按 id 跳（名字会变、会重名，见 profileHref）
            to={profileHref({ id: video.authorId, name: video.author })}
            className="flex items-center gap-2 active:opacity-70"
          >
            <Avatar name={video.author} src={authorAvatarOf(video)} size={32} />
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
            {/* @提及补全与首页评论抽屉是**同一份实现**（铁律六）：分叉了就会出现
                "抽屉里能 @ 出来、这里 @ 不出来"这种只有用户才发现得了的差异 */}
            <MentionInput
              value={draft}
              onChange={setDraft}
              onPick={(p) => setPicks((ps) => [...ps, p])}
              onEnter={() => void submitComment()}
              placeholder="说点什么，@ 可以叫上别人"
              className="rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <button
              onClick={() => void submitComment()}
              disabled={!draft.trim() || busyComment}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {busyComment ? "发布中…" : "发布"}
            </button>
          </div>
          {/* 失败就地说清楚，并且**不清空输入框**——用户打的字还在，改一下就能再发 */}
          {commentErr && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{commentErr}</p>}
          {mentionWarn && <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300/90">{mentionWarn}</p>}
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
                  {/* 解析到人的 @ 才是链接，打错的留成普通文字（见 MentionText 顶部） */}
                  <div className="mt-0.5 text-sm text-slate-200">
                    <MentionText text={c.text} mentions={c.mentions} />
                  </div>
                  {/* 删除入口与首页评论抽屉共用同一份实现（铁律六）。
                      ★ 本页的 comments 是 video.comments 的**快照**，data 层删完要把
                        快照换掉，否则那条评论还留在屏幕上（下次 version 变了才消失）。 */}
                  <CommentDelete videoId={video.id} comment={c} onDeleted={() => setComments([...video.comments])} />
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
