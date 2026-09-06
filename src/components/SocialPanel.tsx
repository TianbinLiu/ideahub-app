// 详情页通用互动区：浏览量 / 点赞 / 收藏 / 评论。卡片、卡组、模板三种详情页共用。
//
// 与首页的 CommentSheet 分开的理由：那个是覆盖在播放器上的抽屉（要拦手势、要留出
// 上半屏继续看视频），详情页是普通滚动页面，评论直接铺在页尾更顺——硬套抽屉反而
// 多一层遮罩和一次点击。两者共享的是数据语义而不是布局。
import { useEffect, useState, useSyncExternalStore } from "react";
import Avatar from "./Avatar";
import {
  SocialKind,
  addComment,
  addView,
  readSocial,
  socialVersion,
  statsOf,
  subscribeSocial,
  toggleCollect,
  toggleLike,
} from "../data/social";
import { useAuthState, useCurrentUser } from "../hooks/useAccount";
import { relativeTime } from "../types";
import Icon from "./Icon";

export function useSocialVersion(): number {
  return useSyncExternalStore(subscribeSocial, socialVersion, () => 0);
}

/**
 * 进详情页记一次浏览。放在组件里而不是页面里，三个页面不会各写一遍也不会漏。
 *
 * ★★ 必须在 **effect** 里记，不能写成 `useState(() => addView(...))`。
 *   那种写法是在**渲染期间**调 addView，而 addView 会 emit ——
 *   emit 同步通知到同一棵树里 SocialPanel 的 useSyncExternalStore，
 *   于是「在 DeckDetailPage 渲染过程中给 SocialPanel setState」，React 直接报
 *   "Cannot update a component while rendering a different component"，
 *   并且**可能把这次更新丢掉**：表现就是浏览量涨了、页面上那个数字不动，
 *   要划走再回来才对得上。（2026-08-11 控制台实测到这条报错。）
 * ★ StrictMode 下 effect 会跑两遍，但 addView 自己按会话去重（sessionStorage），
 *   所以不会多记一次；这也是为什么这里不需要再加一个 ref 守卫。
 */
export function useCountView(kind: SocialKind, id: string | undefined) {
  useEffect(() => {
    if (id) addView(kind, id);
  }, [kind, id]);
}

function fmt(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}

export default function SocialPanel({ kind, id }: { kind: SocialKind; id: string }) {
  useSocialVersion();
  const user = useCurrentUser();
  const auth = useAuthState();
  const [draft, setDraft] = useState("");
  const [tip, setTip] = useState("");
  // ★★ 四个计数与上方那个「社区热度」**必须来自同一个宇宙**：都走 readSocial。
  //   以前这一行读的是 statsOf()（纯本机），于是同屏出现"服务端算的全局热度"
  //   和"只有这台设备见过的点赞数"，还没有任何字说明后者是本机的 —— 用户没法
  //   理解为什么热度是 300 而点赞是 0。source 由下面那行标签如实写出来。
  const r = readSocial(kind, id);
  const comments = statsOf(kind, id).comments;

  function need(): boolean {
    if (user) return false;
    // ★ "登录后才能互动"是个结论，会话还没水合完时说它就是错的（见 useAuthState）：
    //   冷启动后立刻点赞的人是登录着的，只是还没认领上。如实说在等什么。
    setTip(auth === "pending" ? "正在确认登录状态…" : "登录后才能互动");
    setTimeout(() => setTip(""), 1800);
    return true;
  }

  return (
    <div className="mt-5">
      {/* 计数条 */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-700/70 bg-panel p-1.5">
        <div className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-slate-400">
          <Icon name="play" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(r.views)}</span>
        </div>
        <button
          onClick={() => !need() && toggleLike(kind, id)}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors ${r.liked ? "text-rose-400" : "text-slate-400"}`}
        >
          <Icon name="heart" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(r.likes)}</span>
        </button>
        <button
          onClick={() => !need() && toggleCollect(kind, id)}
          className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 transition-colors ${r.collected ? "text-gold" : "text-slate-400"}`}
        >
          <Icon name="bookmark" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(r.bookmarks)}</span>
        </button>
        <div className="flex flex-1 flex-col items-center gap-0.5 py-1.5 text-slate-400">
          <Icon name="comment" size={16} />
          <span className="text-[11px] tabular-nums">{fmt(comments.length)}</span>
        </div>
      </div>
      {/* 这几个数字是哪来的，必须说清楚。措辞与热度那一行的「本机计数」对齐 */}
      <p className="mt-1 text-center text-[10px] text-slate-600">
        {r.source === "server"
          ? "浏览 / 点赞 / 收藏为社区计数；评论只存在这台设备上"
          : "本机计数：只统计了这台设备上的互动"}
      </p>
      {tip && <p className="mt-1.5 text-center text-[11px] text-amber-400">{tip}</p>}

      {/* 评论区 */}
      <div className="mt-4">
        <div className="mb-2 text-xs font-semibold text-slate-300">评论 {comments.length > 0 && `· ${comments.length}`}</div>
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
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar name={c.author} size={32} className="flex-none" />
              <div className="min-w-0">
                <div className="text-xs text-slate-500">
                  {c.author} · {relativeTime(c.at)}
                </div>
                <div className="mt-0.5 text-sm leading-relaxed text-slate-200">{c.text}</div>
              </div>
            </div>
          ))}
          {comments.length === 0 && <div className="py-8 text-center text-sm text-slate-500">还没有评论，抢个沙发</div>}
        </div>
      </div>
    </div>
  );
}
