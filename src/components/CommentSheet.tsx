// 首页评论抽屉：对标短视频 App——评论在视频下方滑出，视频继续播放，
// 不打断沉浸流（此前评论键直接跳详情页，滑视频的节奏被整个打碎）。
//
// ★ 必须 portal 到 body，不能留在 FeedPage 里靠 z-index 压底栏：FeedPage 的根是
//   `fixed inset-0 z-0`，position+z-index 会**开一个新的层叠上下文**，里面的元素
//   无论写多大的 z 都只能在这个 z-0 的盒子里排，而 TabBar 是它的兄弟节点、z-40。
//   结果就是输入框和「发送」整行都被底栏盖住——实测点下去命中的是底栏的「创作」，
//   直接跳去 /create，评论在手机上根本发不出来（只有回车能提交）。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addReply, commentCountOf, commentPending, ensureComments, isMyAuthor, setCommentLike } from "../data/videos";
import { VideoComment, VideoItem, relativeTime } from "../types";
import type { MentionPick } from "../utils/mention";
import { useVideosVersion } from "../hooks/useVideos";
import CommentDelete from "./CommentDelete";
import Icon from "./Icon";
import ReportButton from "./ReportButton";
import MentionInput from "./MentionInput";
import MentionText from "./MentionText";

/** 顶层评论 + 挂在它下面的回复。渲染前分一次组，不在 JSX 里现算 */
interface Thread {
  top: VideoComment;
  replies: VideoComment[];
}

/**
 * 扁平的评论列表 → 两层楼。
 *
 * ★ 判「这条是不是回复」看 parentId 的**有无**，不和任何哨兵值比：这三个字段是后加的，
 *   老服务端返回的评论、离线库里的种子评论读出来都是 undefined。写成等值判会把
 *   存量评论整批归到某一类里去 —— 而且一个错都不报，只是评论区忽然少了一半。
 * ★ 找不到父的回复（父被删了 / 父不在这一页里）**必须提到顶层**，不能丢：
 *   静默吞掉一条用户发出去的评论是最坏的失败。
 */
function buildThreads(list: VideoComment[]): Thread[] {
  const tops: Thread[] = [];
  const byId = new Map<string, Thread>();
  for (const c of list) {
    if (!c.parentId) {
      const t: Thread = { top: c, replies: [] };
      tops.push(t);
      byId.set(c.id, t);
    }
  }
  for (const c of list) {
    if (!c.parentId) continue;
    const parent = byId.get(c.parentId);
    if (parent) parent.replies.push(c);
    else tops.push({ top: c, replies: [] }); // 孤儿回复：宁可位置不对，也不能不见
  }
  // 顶层按时间倒序（新的在上），楼中楼按正序（对话读起来是从上往下）
  tops.sort((a, b) => b.top.at - a.top.at);
  for (const t of tops) t.replies.sort((a, b) => a.at - b.at);
  return tops;
}

export default function CommentSheet({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  // video.comments 由 addReply 原地换新数组，本地 state 拿快照驱动渲染
  const [list, setList] = useState<VideoComment[]>(video.comments);
  /**
   * ★★ 首页的列表接口**不带 comments**，只有详情接口才带。
   *   不在这里补一次的话，凡是没点进过详情页的作品，点开评论永远是"还没有评论"——
   *   而标题那一行（用的是服务端的 commentCount）却明明写着「1 条评论」，自相矛盾。
   *   ensureComments 内部按 detailed 去重，重复打开抽屉不会重复请求。
   */
  const version = useVideosVersion();
  useEffect(() => {
    ensureComments(video.id);
  }, [video.id]);
  // 详情到货后 data 层是**原地**换掉 video.comments 这个数组引用并 emit，
  // 所以这里跟着 version 把快照同步过来（引用没变就不动，避免多余渲染）
  useEffect(() => {
    setList((prev) => (prev === video.comments ? prev : video.comments));
  }, [version, video.comments]);
  const [draft, setDraft] = useState("");
  /**
   * 这一条草稿里从补全面板挑过的人（userId + 当时插进去的名字）。
   *
   * ★ 只攒不算：正文还会被继续编辑，位置要等**按下发送那一刻**由 data 层按最终正文
   *   重新定位（utils/mention.resolveMentionSpans 写了为什么）。挑了之后又把那段字
   *   删掉的，定位时自然找不到、自动丢弃 —— 这里不必费心清理。
   */
  const [picks, setPicks] = useState<MentionPick[]>([]);
  /** 正在回复谁（null = 发顶层评论）。存整条是为了在输入区显示"回复 @某某" */
  const [replyTo, setReplyTo] = useState<VideoComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /** 评论发出去了、但有几个 @ 服务端没认下来（老服务端 / 核对没过）。黄字，不是红字 */
  const [warn, setWarn] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setList(video.comments);
    setReplyTo(null);
    setErr("");
    setWarn("");
    setPicks([]);
  }, [video]);

  const threads = useMemo(() => buildThreads(list), [list]);

  /**
   * ★★ 真等服务端的结果再清空输入框，口径与 DanmakuInput.submit 完全一致
   *   （那边的注释写了为什么）。失败时**不清空、不关窗**，把原因就地写成红字：
   *   评论发不出去是常态（20/分钟限流、登录过期、断网），而全 app 没有任何地方
   *   监听 emitApiError —— 悄悄把用户刚打的字删掉是最坏的失败（铁律八）。
   */
  async function submit() {
    if (busy) return;
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    setErr("");
    setWarn("");
    try {
      const posted = await addReply(video.id, replyTo?.parentId || replyTo?.id || null, text, picks);
      setList([...video.comments]);
      setDraft("");
      setPicks([]);
      setReplyTo(null);
      // ★★ 评论发出去了、@ 却一个都没落地时**必须说出来**：老服务端会把 mentions 整个
      //   strip 掉（不报错），核对没过的也会被丢掉。不说的话就是"@ 了、对方永远收不到"
      //   的静默失败（铁律八）。这是黄字不是红字 —— 评论本身是成功的。
      if (posted && posted.droppedMentions > 0) {
        setWarn(`有 ${posted.droppedMentions} 个 @ 没能送达（对方不会收到通知）`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "评论没发出去，请重试");
    } finally {
      setBusy(false);
    }
  }

  function toggleLike(c: VideoComment) {
    setCommentLike(video.id, c.id, !c.liked);
    setList([...video.comments]); // 计数是原地改的，换个数组引用把渲染顶出去
    navigator.vibrate?.(8);
  }

  function startReply(c: VideoComment) {
    // ★ 还没拿到服务端 id 的评论不能当父楼：它的 id 是本地的 `cmt_*`，
    //   发上去会被服务端判否，整条回复 400。与其让用户打完字再失败，
    //   不如当场说清楚为什么点不动（按钮那边是灰的，这里补一句原因）。
    if (commentPending(c)) {
      setErr("这条评论还在发送中，等它发出去之后才能回复");
      return;
    }
    setErr("");
    setReplyTo(c);
    // 手机上不聚焦的话用户得再点一次输入框，中间那一下很容易点到别的评论上
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function row(c: VideoComment, indented: boolean) {
    const pending = commentPending(c);
    return (
      <div key={c.id} className={`flex gap-2.5 ${indented ? "pl-10" : ""}`}>
        <span
          className={`flex flex-none items-center justify-center rounded-full bg-slate-700 font-bold text-slate-300 ${
            indented ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs"
          }`}
        >
          {c.author.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">
            {c.author} · {relativeTime(c.at)}
          </div>
          {/* ★ 只有服务端确认解析到人的那几个 @ 会变成链接，打错的原样留成白字 ——
              用户据此看得出自己那一 @ 到底有没有落地（见 MentionText 顶部）。
              点提及要先把抽屉关掉，否则跳过去主页上还盖着这一层 */}
          <div className="mt-0.5 text-sm leading-relaxed text-slate-200">
            <MentionText text={c.text} mentions={c.mentions} onNavigate={onClose} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => startReply(c)}
              disabled={pending}
              className="mt-1 text-[11px] text-slate-500 active:opacity-60 disabled:opacity-40"
            >
              {pending ? "发送中…" : "回复"}
            </button>
            {/* 删除入口与详情页共用同一份实现（能不能删、二次确认、失败红字都在里面） */}
            <CommentDelete videoId={video.id} comment={c} onDeleted={() => setList([...video.comments])} />
            {/* 举报入口同样是共用的那一份（理由表、重复举报的说法、失败红字都在里面）。
                mine 传 isMyAuthor：自己的评论该删不该举报，传了就整块不渲染 */}
            <ReportButton targetType="comment" targetId={c.id} videoId={video.id} mine={isMyAuthor(c.author)} />
          </div>
        </div>
        {/* 心 + 数字。热区给到 32px 宽——评论行密，小了会点到隔壁那条 */}
        <button
          onClick={() => toggleLike(c)}
          aria-label={c.liked ? "取消点赞" : "点赞"}
          aria-pressed={c.liked === true}
          className={`-my-1 flex w-8 flex-none flex-col items-center justify-start gap-0.5 py-1 ${
            c.liked ? "text-rose-500" : "text-slate-500"
          } active:opacity-60`}
        >
          <Icon name="heart" size={16} filled={c.liked === true} />
          {/* 0 不显示数字：一列 0 只是噪音 */}
          {(c.likes ?? 0) > 0 && <span className="text-[10px] tabular-nums">{c.likes}</span>}
        </button>
      </div>
    );
  }

  return createPortal(
    // 整层拦截 pointer/click：抽屉内的滑动与点击不能落到底下的播放器手势上。
    // portal 之后 DOM 上已经不在播放器里了，但 React 合成事件仍沿**组件树**冒泡到
    // FeedItem 的 onPointerDown/onPointerUp，所以这三个 stopPropagation 照旧需要。
    <div
      className="fixed inset-0 z-50"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 上半留给视频（点击关闭抽屉），下半是评论面板 */}
      <div className="absolute inset-x-0 top-0 h-[38%]" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 flex h-[62%] flex-col rounded-t-2xl bg-panel shadow-[0_-8px_30px_rgba(0,0,0,.5)]">
        <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
          {/* ★ 与首页那一栏同一个口径（commentCountOf）：服务端的总数优先。
              读 list.length 的话，详情还没补回来时标题会先写「0 条评论」——
              而下面可能马上就渲染出好几条，自相矛盾。 */}
          <span className="text-sm font-semibold text-slate-100">{commentCountOf(video)} 条评论</span>
          <button onClick={onClose} aria-label="关闭评论" className="-m-2 p-2 text-slate-400 hover:text-white">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {threads.map((t) => (
            <div key={t.top.id} className="space-y-3">
              {row(t.top, false)}
              {t.replies.map((r) => row(r, true))}
            </div>
          ))}
          {list.length === 0 && <div className="py-10 text-center text-sm text-slate-500">还没有评论，抢个沙发</div>}
        </div>
        <div
          className="border-t border-slate-700/60 px-4 py-3"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {replyTo && (
            // 正在回复谁必须**看得见**：不显示的话用户以为自己在发顶层评论，
            // 发出去才发现缩进到了别人楼里
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
              <span className="min-w-0 truncate">回复 @{replyTo.author}</span>
              <button onClick={() => setReplyTo(null)} className="-m-1 p-1 text-slate-500" aria-label="取消回复">
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {/* 失败就地说清楚，并且**不清空输入框**——用户打的字还在，改一下就能再发 */}
          {err && <p className="mb-1.5 text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {warn && <p className="mb-1.5 text-[11px] leading-relaxed text-amber-300/90">{warn}</p>}
          <div className="flex gap-2">
            {/* isComposing / 回车提交这些细节都在 MentionInput 里（两个评论口共用一份，
                铁律六）。placeholder 里那个「回复 @昵称」是**说明文字**，不是提及令牌 ——
                真正的提及要从补全面板里选（插进正文的是对方的显示名，身份走 picks） */}
            <MentionInput
              inputRef={inputRef}
              value={draft}
              onChange={setDraft}
              onPick={(p) => setPicks((ps) => [...ps, p])}
              onEnter={() => void submit()}
              placeholder={replyTo ? `回复 @${replyTo.author}` : "说点什么，@ 可以叫上别人"}
              className="rounded-full border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <button
              onClick={() => void submit()}
              disabled={!draft.trim() || busy}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {busy ? "发送中…" : "发送"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
