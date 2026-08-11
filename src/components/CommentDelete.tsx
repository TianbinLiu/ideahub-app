// 评论的删除入口。**CommentSheet 与 VideoPage 共用这一份**（铁律六）：
// "谁能删 / 要不要二次确认 / 失败怎么说" 这三条一旦分叉，就会出现"抽屉里删得掉、
// 详情页删不掉"或者"一边有确认一边没有"这种只有用户才发现得了的差异。
//
// ★ 不用 window.confirm —— Capacitor 的 WebView 里它是个系统弹窗，样式与整个 app
//   割裂，而且在部分机型上会被当成"网页弹窗"直接拦掉（EditPage 删作品那处同款做法）。
//   就地展开成「确认删除 / 取消」两个键，两下才删得掉。
//
// ★★ 失败必须**看得见**：删除是个后果不可撤销的动作，而它失败是常态（无权、
//   老服务端没有这个端点、限流、断网）。全 app 没有任何地方监听 emitApiError，
//   在这里 catch 之后不响 = 用户点了没反应，只会一直点（铁律八）。
import { useState } from "react";
import { canDeleteComment, removeComment } from "../data/videos";
import type { VideoComment } from "../types";

export default function CommentDelete({
  videoId,
  comment,
  onDeleted,
}: {
  videoId: string;
  comment: VideoComment;
  /** 删成功后通知父组件把自己那份列表快照换掉（data 层已经改了 video.comments） */
  onDeleted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // ★ 能不能删由 data 层一处说了算（与服务端同一条规则：评论作者本人或作品作者）。
  //   不满足就**什么都不画** —— 摆一个点了必然失败的按钮比不摆更糟。
  if (!canDeleteComment(videoId, comment)) return null;

  async function del() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      await removeComment(videoId, comment.id);
      onDeleted?.();
      // 成功之后这个组件多半已经随那条评论一起卸载了，不必复位状态
    } catch (e) {
      // 失败**保留确认态**：用户看得到原因，也还站在"想删"这一步上，改完网络能直接重试
      setErr(e instanceof Error ? e.message : "没能删掉，请重试");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => {
          setErr("");
          setConfirming(true);
        }}
        className="mt-1 text-[11px] text-slate-500 active:opacity-60"
      >
        删除
      </button>
    );
  }

  return (
    <span className="mt-1 inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => void del()}
        disabled={busy}
        className="text-[11px] font-semibold text-rose-400 active:opacity-60 disabled:opacity-40"
      >
        {busy ? "删除中…" : "确认删除"}
      </button>
      <button
        onClick={() => {
          setConfirming(false);
          setErr("");
        }}
        className="text-[11px] text-slate-500 active:opacity-60"
      >
        取消
      </button>
      {/* 连回复一起删：说在前面，别让用户删完才发现楼里少了几层 */}
      <span className="text-[10px] text-slate-600">（它下面的回复会一起删掉）</span>
      {err && <span className="w-full text-[11px] leading-relaxed text-rose-300">{err}</span>}
    </span>
  );
}
