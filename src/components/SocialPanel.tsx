// 详情页通用互动区：浏览量 / 点赞 / 收藏 / 评论。卡片、卡组、模板三种详情页共用。
//
// 与首页的 CommentSheet 分开的理由：那个是覆盖在播放器上的抽屉（要拦手势、要留出
// 上半屏继续看视频），详情页是普通滚动页面，评论直接铺在页尾更顺——硬套抽屉反而
// 多一层遮罩和一次点击。两者共享的是数据语义而不是布局。
import { useState, useSyncExternalStore } from "react";
import {
  SocialKind,
  addComment,
  addView,
  isCollected,
  isLiked,
  socialVersion,
  statsOf,
  subscribeSocial,
  toggleCollect,
  toggleLike,
} from "../data/social";
import { useCurrentUser } from "../hooks/useAccount";
import { relativeTime } from "../types";
import Icon from "./Icon";

export function useSocialVersion(): number {
  return useSyncExternalStore(subscribeSocial, socialVersion, () => 0);
}

/** 进详情页记一次浏览。放在组件里而不是页面里，三个页面不会各写一遍也不会漏 */
export function useCountView(kind: SocialKind, id: string | undefined) {
  const [done] = useState(() => {
    if (id) addView(kind, id);
    return true;
  });
  return done;
}

function fmt(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}

export default function SocialPanel({ kind, id }: { kind: SocialKind; id: string }) {
  useSocialVersion();
  const user = useCurrentUser();
  const [draft, setDraft] = useState("");
  const [tip, setTip] = useState("");
  const s = statsOf(kind, id);
  const liked = isLiked(kind, id);
  const collected = isCollected(kind, id);

  function need(): boolean {
    if (user) return false;
    setTip("登录后才能互动");
    setTimeout(() => setTip(""), 1800);
    return true;
  }

  return (
    <div className="mt-5">
      {/* 计数条 */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-panel p-1.5">
        <div className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-slate-400">
          <Icon name="play" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(s.views)}</span>
        </div>
        <button
          onClick={() => !need() && toggleLike(kind, id)}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors ${liked ? "text-rose-400" : "text-slate-400"}`}
        >
          <Icon name="heart" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(s.likedBy.length)}</span>
        </button>
        <button
          onClick={() => !need() && toggleCollect(kind, id)}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors ${collected ? "text-gold" : "text-slate-400"}`}
        >
          <Icon name="bookmark" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(s.collectedBy.length)}</span>
        </button>
        <div className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-slate-400">
          <Icon name="comment" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(s.comments.length)}</span>
        </div>
      </div>
      {tip && <p className="mt-1.5 text-center text-[11px] text-amber-400">{tip}</p>}

      {/* 评论区 */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold text-slate-300">评论 {s.comments.length > 0 && `· ${s.comments.length}`}</div>
        <div className="mb-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              if (need()) return;
              if (addComment(kind, id, draft)) setDraft("");
            }}
            placeholder="说点什么"
            className="min-w-0 flex-1 rounded-full border border-slate-700 bg-black/30 px-4 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={() => {
              if (need()) return;
              if (addComment(kind, id, draft)) setDraft("");
            }}
            disabled={!draft.trim()}
            className="flex-none rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            发送
          </button>
        </div>
        <div className="space-y-3.5">
          {s.comments.map((c) => (
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
          {s.comments.length === 0 && <div className="py-8 text-center text-sm text-slate-500">还没有评论，抢个沙发</div>}
        </div>
      </div>
    </div>
  );
}
