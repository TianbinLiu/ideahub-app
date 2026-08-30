// 「调节首尾帧」小窗（2026-08-30 主人点名）：把示例视频当胶片拖——拖到想要的画面，
// 一键把当前帧设成本段首帧/尾帧，或加为中间帧参考图。
//
// ★ 两个面共用（画布自定义车道 + 工坊铸段向导），谁的帧归谁写：本组件只回调 dataURL，
//   不认识任何 store。
// ★ 直接从可见的 <video> 上截当前帧：本地 objectURL 无跨域问题；远端（Cloudinary）
//   靠 crossOrigin="anonymous"（对端发 CORS 头）。截失败（污染/未就绪）整句说，别静默。
// ★ portal 到 body + z-[60]：宿主各有自己的变换层/滚动容器（CLAUDE.md fixed 那条坑）。
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";

export default function RefFrameSheet({
  videoUrl,
  remote,
  midCount,
  midMax,
  onFirst,
  onLast,
  onAddMid,
  onClose,
}: {
  videoUrl: string;
  /** 远端地址（要 crossOrigin）；本地 objectURL 传 false */
  remote: boolean;
  midCount: number;
  midMax: number;
  onFirst: (dataUrl: string) => void;
  onLast: (dataUrl: string) => void;
  onAddMid: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const vref = useRef<HTMLVideoElement>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  function grab(): string | null {
    const v = vref.current;
    if (!v || v.videoWidth === 0 || v.readyState < 2) {
      setErr("画面还没就绪——等视频出画面再点");
      return null;
    }
    try {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(2, Math.round(v.videoWidth * scale));
      c.height = Math.max(2, Math.round(v.videoHeight * scale));
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      setErr("");
      return c.toDataURL("image/jpeg", 0.88);
    } catch {
      setErr("这段视频的地址不允许截帧（跨域没放行）——重新上传一次再调");
      return null;
    }
  }
  const take = (kind: "first" | "last" | "mid") => {
    const d = grab();
    if (!d) return;
    if (kind === "first") {
      onFirst(d);
      setNote("✓ 已设为首帧");
    } else if (kind === "last") {
      onLast(d);
      setNote("✓ 已设为尾帧");
    } else {
      onAddMid(d);
      setNote("✓ 已加为中间帧");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={onClose}>
      <div className="safe-top flex flex-none items-center gap-2 px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 text-sm font-bold text-slate-100">调节首尾帧</span>
        {note && <span className="flex-none text-[11px] text-emerald-300">{note}</span>}
        <button onClick={onClose} className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-panel text-slate-200">
          <Icon name="close" size={16} />
        </button>
      </div>
      {err && (
        <p className="mx-3 flex-none rounded-lg bg-rose-500/90 px-2.5 py-1.5 text-[11px] text-white" onClick={(e) => e.stopPropagation()}>
          {err}
        </p>
      )}
      <div className="flex min-h-0 flex-1 items-center justify-center px-3" onClick={(e) => e.stopPropagation()}>
        <video
          ref={vref}
          src={videoUrl}
          {...(remote ? { crossOrigin: "anonymous" as const } : {})}
          controls
          muted
          playsInline
          preload="auto"
          className="max-h-full max-w-full rounded-lg"
        />
      </div>
      <div className="flex-none px-3 pb-4 pt-2" onClick={(e) => e.stopPropagation()}>
        <p className="mb-1.5 text-center text-[10px] text-slate-500">拖进度条到想要的画面，再点下面的键</p>
        <div className="flex gap-2">
          <button onClick={() => take("first")} className="flex-1 rounded-xl bg-brand/90 py-2 text-xs font-bold text-ink">
            设为首帧
          </button>
          <button onClick={() => take("last")} className="flex-1 rounded-xl bg-brand/90 py-2 text-xs font-bold text-ink">
            设为尾帧
          </button>
          <button
            onClick={() => take("mid")}
            disabled={midCount >= midMax}
            title={midCount >= midMax ? `中间帧最多 ${midMax} 张` : undefined}
            className="flex-1 rounded-xl border border-slate-500 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"
          >
            ＋中间帧（{midCount}/{midMax}）
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
