// 视频详情页：播放器（多 P 可切换）+ 信息 + 分段剧情 + 评论区
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon";
import { Link, useNavigate, useParams } from "react-router-dom";
import BranchPlayer from "../components/BranchPlayer";
import SegmentPlayer from "../components/SegmentPlayer";
import { addCards, myCards } from "../data/account";
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
          <div key={c.id} className="w-24 flex-none">
            <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
          </div>
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
  const part = parts[Math.min(pi, Math.max(0, parts.length - 1))] ?? null;

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
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="text-slate-400 hover:text-white">
            <Icon name="back" size={20} />
          </Link>
          <span className="truncate text-sm text-slate-300">{video.title}</span>
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
          (part.branchTree ? (
            <BranchPlayer key={`b${pi}`} tree={part.branchTree} cover={video.cover} />
          ) : (
            <SegmentPlayer key={`s${pi}`} segments={part.segments} cover={video.cover} />
          ))}

        <h1 className="mt-4 text-xl font-bold text-slate-100">{video.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/25 font-bold text-brand">
              {video.author.charAt(0)}
            </span>
            <span className="text-slate-200">{video.author}</span>
          </span>
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

        {/* 分段剧情（跟随当前选中的 P） */}
        <section className="mt-6">
          <h2 className="mb-3 text-base font-bold text-slate-200">
            {parts.length > 1 ? `${part?.name ?? ""} · ` : ""}分段剧情 · {part?.segments.length ?? 0} 个节点
          </h2>
          <div className="space-y-3">
            {(part?.segments ?? []).map((seg, i) => (
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
