// 首页评论抽屉：对标短视频 App——评论在视频下方滑出，视频继续播放，
// 不打断沉浸流（此前评论键直接跳详情页，滑视频的节奏被整个打碎）。
//
// ★ 必须 portal 到 body，不能留在 FeedPage 里靠 z-index 压底栏：FeedPage 的根是
//   `fixed inset-0 z-0`，position+z-index 会**开一个新的层叠上下文**，里面的元素
//   无论写多大的 z 都只能在这个 z-0 的盒子里排，而 TabBar 是它的兄弟节点、z-40。
//   结果就是输入框和「发送」整行都被底栏盖住——实测点下去命中的是底栏的「创作」，
//   直接跳去 /create，评论在手机上根本发不出来（只有回车能提交）。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { addComment } from "../data/videos";
import { VideoComment, VideoItem, relativeTime } from "../types";
import Icon from "./Icon";

export default function CommentSheet({ video, onClose }: { video: VideoItem; onClose: () => void }) {
  // video.comments 由 addComment 原地换新数组，本地 state 拿快照驱动渲染
  const [list, setList] = useState<VideoComment[]>(video.comments);
  const [draft, setDraft] = useState("");
  useEffect(() => setList(video.comments), [video]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    const cmt = addComment(video.id, text);
    if (cmt) setList(video.comments);
    setDraft("");
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
          <span className="text-sm font-semibold text-slate-100">{list.length} 条评论</span>
          <button onClick={onClose} aria-label="关闭评论" className="-m-2 p-2 text-slate-400 hover:text-white">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {list.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-700 text-xs font-bold text-slate-300">
                {c.author.charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="text-xs text-slate-500">
                  {c.author} · {relativeTime(c.at)}
                </div>
                <div className="mt-0.5 text-sm leading-relaxed text-slate-200">{c.text}</div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="py-10 text-center text-sm text-slate-500">还没有评论，抢个沙发</div>}
        </div>
        <div className="flex gap-2 border-t border-slate-700/60 px-4 py-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            }}
            placeholder="发一条友善的评论"
            className="min-w-0 flex-1 rounded-full border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
