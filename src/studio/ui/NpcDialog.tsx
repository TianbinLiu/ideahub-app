// 铸卡师对话：竖屏底部抽屉。收起时是一条气泡栏（显示最新 NPC 消息），点开变全宽抽屉。
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studioStore";
import { fileToCover } from "../../mock/frames";
import { MaterialFile } from "../../mock/ai";

export default function NpcDialog() {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const market = useStudio((s) => s.market);
  const pending = useStudio((s) => s.pendingFiles);
  const projection = useStudio((s) => s.projection);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setSeen(messages.length);
  }, [open, messages.length]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, open]);

  // 投影窗打开时隐藏对话层，避免遮挡
  if (projection) return null;

  const last = messages[messages.length - 1];
  const unread = Math.max(0, messages.length - seen);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    const mats: MaterialFile[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const dataUrl = await fileToCover(f);
      let textContent: string | null = null;
      if (!dataUrl && /\.(txt|md)$/i.test(f.name)) {
        try {
          textContent = (await f.text()).slice(0, 500);
        } catch {
          textContent = null;
        }
      }
      mats.push({ name: f.name, dataUrl, text: textContent });
    }
    useStudio.getState().addFiles(mats);
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function send() {
    void useStudio.getState().sendToNpc(text);
    setText("");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 rounded-full border border-slate-700/70 bg-panel/90 px-3.5 py-2.5 text-left backdrop-blur"
      >
        <span className={`h-2.5 w-2.5 flex-none rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
        <span className="flex-none text-sm font-semibold text-slate-100">铸卡师</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
          {busy ? "炼卡中…" : last ? last.text : "把素材交给我，或逛逛市场"}
        </span>
        {unread > 0 && (
          <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-ink">
            {unread}
          </span>
        )}
        <span className="flex-none text-slate-500">▴</span>
      </button>
    );
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-[58%] flex-col rounded-t-2xl border-t border-slate-700/70 bg-panel/95 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-slate-700/60 px-4 py-2.5">
        <span className={`h-2.5 w-2.5 rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
        <span className="font-semibold text-slate-100">铸卡师</span>
        <span className="text-xs text-slate-400">{busy ? "炼卡中…" : market.open ? "市场摊开中" : "在线"}</span>
        <button onClick={() => setOpen(false)} className="ml-auto px-2 text-slate-400 hover:text-white">
          ▾
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
                m.from === "me" ? "bg-brand/20 text-sky-100" : "bg-slate-700/60 text-slate-200"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="pl-1 text-xs text-amber-300/90 pulse-soft">炉火正旺，卡片成形中…</div>}
      </div>

      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-700/60 px-3 py-1.5">
          {pending.map((f) => (
            <span key={f.name} className="flex items-center gap-1 rounded-full bg-slate-700/70 px-2 py-0.5 text-xs text-slate-200">
              {f.dataUrl ? "🖼" : "📄"} {f.name.length > 12 ? f.name.slice(0, 12) + "…" : f.name}
              <button className="text-slate-400" onClick={() => useStudio.getState().removeFile(f.name)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-slate-700/60 px-3 py-2">
        {market.open ? (
          <button
            onClick={() => useStudio.getState().closeMarket()}
            className="rounded-full bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200"
          >
            收起市场
          </button>
        ) : (
          <button
            onClick={() => void useStudio.getState().openMarket()}
            className="rounded-full bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200"
          >
            🛒 逛市场
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={market.open || reading}
          className="rounded-full bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
        >
          {reading ? "读取中…" : "📎 添加素材"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.txt,.md"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>

      <div className="flex gap-2 border-t border-slate-700/60 p-3 pb-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder={market.open ? "搜索市场卡片，如「古风」「侦探」…" : "描述素材或想要的卡片…"}
          className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        <button
          onClick={send}
          disabled={busy}
          className="rounded-xl bg-brand/80 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
  );
}
