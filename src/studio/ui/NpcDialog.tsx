// 铸卡师对话：气泡制。
// · NPC 说话 = 角色旁浮出的漫画对话气泡（rAF 直读 NPC_SCREEN 跟随头顶投影）
// · 「🛒 逛市场 / 📎 添加素材 / 💬 记录」以小气泡选项挂在对话气泡下方
// · 市场模式只在**屏幕上方**放一条搜索栏——桌面摊开的卡再也不会被对话窗挡住
// · 💬 打开历史对话记录窗（含继续对话的输入行）
// · 📎 弹素材表单：文件 + 文字描述一起填好再交给铸卡师，不再直接拉起文件选择器
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studioStore";
import { fileToCover } from "../../mock/frames";
import { MaterialFile } from "../../ai";
import { NPC_SCREEN } from "../scene/cameraOrbit";

export default function NpcDialog() {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const projection = useStudio((s) => s.projection);
  const marketOpen = useStudio((s) => s.market.open);
  // 对话默认隐藏：可见性由 store 的 dialogView 决定，只有点击 3D 里的 NPC 才唤起
  const open = useStudio((s) => s.dialogView);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);

  // 气泡跟随 NPC 头顶投影：rAF 直接写 DOM，不走 React 状态（零重渲 60fps 跟随）
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        el.style.left = `${NPC_SCREEN.x * 100}%`;
        el.style.top = `${NPC_SCREEN.y * 100}%`;
        el.style.opacity = NPC_SCREEN.visible ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 投影窗打开时隐藏对话层，避免遮挡
  if (projection) return null;
  if (!open) return null;

  // 关闭对话 → 相机回第一人称眼位，轨道解除
  function closeAll() {
    const st = useStudio.getState();
    if (st.market.open) st.closeMarket();
    st.setDialogView(false);
    st.setCamera({ kind: "default" });
    useStudio.setState({ orbit: null });
    setHistoryOpen(false);
    setForgeOpen(false);
  }

  const lastNpc = [...messages].reverse().find((m) => m.from === "npc");

  return (
    <>
      {/* ── NPC 对话气泡（跟随角色） ── */}
      <div
        ref={anchorRef}
        className="pointer-events-none absolute z-10 w-[68%] max-w-[340px] -translate-x-1/2 -translate-y-full"
        style={{ left: "50%", top: "30%" }}
      >
        <div className="pointer-events-auto rounded-2xl border border-slate-600/70 bg-panel/95 px-3.5 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
            <span className="text-[11px] font-semibold text-slate-300">铸卡师</span>
            <button onClick={closeAll} className="ml-auto -m-1 p-1 text-xs text-slate-500 hover:text-white" aria-label="结束对话">
              ✕
            </button>
          </div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">
            {busy ? "炉火正旺，卡片成形中…" : lastNpc?.text ?? "……"}
          </div>
        </div>
        {/* 气泡尾巴：指向角色 */}
        <div className="mx-auto h-3 w-3 -translate-y-1.5 rotate-45 border-b border-r border-slate-600/70 bg-panel/95" />
        {/* ── 选项气泡：逛市场 / 添加素材 / 记录 ── */}
        <div className="pointer-events-auto mt-1 flex justify-center gap-2">
          {marketOpen ? (
            <button
              onClick={() => {
                const st = useStudio.getState();
                st.closeMarket();
                st.npcSay("市场先收起来了。还想做点什么？");
              }}
              className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
            >
              ‹ 收起市场
            </button>
          ) : (
            <>
              <button
                onClick={() => void useStudio.getState().openMarket()}
                className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
              >
                🛒 逛市场
              </button>
              <button
                onClick={() => setForgeOpen(true)}
                className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
              >
                📎 添加素材
              </button>
            </>
          )}
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
            title="查看历史对话"
          >
            💬 记录
          </button>
        </div>
      </div>

      {/* ── 市场搜索条：钉在屏幕上方，桌面的卡全程可见 ── */}
      {marketOpen && <MarketTopBar />}

      {historyOpen && <HistorySheet onClose={() => setHistoryOpen(false)} />}
      {forgeOpen && <ForgeForm onClose={() => setForgeOpen(false)} />}
    </>
  );
}

// ── 市场搜索条（屏幕上方） ─────────────────────────────────────
function MarketTopBar() {
  const loading = useStudio((s) => s.market.loading);
  const [q, setQ] = useState("");
  function search() {
    void useStudio.getState().marketSearch(q.trim());
  }
  return (
    <div className="safe-top absolute inset-x-0 top-12 z-10 px-3">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-slate-600/70 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="flex-none text-xs font-semibold text-slate-200">🛒 市场</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) search();
          }}
          placeholder="搜索：古风 / 侦探 / 场景…"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        <button
          onClick={search}
          disabled={loading}
          className="flex-none rounded-full bg-brand/85 px-3 py-1 text-xs font-semibold text-ink disabled:opacity-40"
        >
          {loading ? "…" : "搜索"}
        </button>
      </div>
      <div className="mt-1 text-center text-[10px] text-slate-500">点桌上的卡放大查看 · 喜欢就收进卡组</div>
    </div>
  );
}

// ── 历史对话记录窗 ─────────────────────────────────────────────
function HistorySheet({ onClose }: { onClose: () => void }) {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function send() {
    if (!text.trim()) return;
    void useStudio.getState().sendToNpc(text);
    setText("");
  }

  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div
        className="safe-top absolute inset-x-3 top-12 bottom-[30%] mx-auto flex max-w-md flex-col overflow-hidden rounded-2xl border border-slate-600/70 bg-panel/95 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-700/60 px-3.5 py-2.5">
          <span className="text-sm font-semibold text-slate-100">对话记录</span>
          <span className="text-[11px] text-slate-500">{messages.length} 条</span>
          <button onClick={onClose} className="ml-auto -m-1 p-1 text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
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
        <div className="flex gap-2 border-t border-slate-700/60 p-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder="和铸卡师聊聊…"
            className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="rounded-xl bg-brand/80 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 素材表单：文件 + 文字描述一起交给铸卡师 ────────────────────
function ForgeForm({ onClose }: { onClose: () => void }) {
  const pending = useStudio((s) => s.pendingFiles);
  const busy = useStudio((s) => s.dialog.busy);
  const [desc, setDesc] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  function submit() {
    if (busy || (pending.length === 0 && !desc.trim())) return;
    void useStudio.getState().sendToNpc(desc.trim());
    setDesc("");
    onClose();
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-slate-600/70 bg-panel/95 p-4 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">📎 递给铸卡师的素材</h3>
          <button onClick={onClose} className="-m-1 p-1 text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* 文件区：点击选择，已选文件以 chip 展示 */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-slate-600 py-4 text-slate-400 hover:border-brand hover:text-brand disabled:opacity-40"
        >
          <span className="text-2xl">{reading ? "⏳" : "🖼"}</span>
          <span className="text-xs">{reading ? "读取中…" : "点击选择图片 / 文本文件（最多 6 个，可不选）"}</span>
        </button>
        {pending.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pending.map((f) => (
              <span key={f.name} className="flex items-center gap-1 rounded-full bg-slate-700/70 px-2 py-0.5 text-xs text-slate-200">
                {f.dataUrl ? "🖼" : "📄"} {f.name.length > 14 ? f.name.slice(0, 14) + "…" : f.name}
                <button className="text-slate-400 hover:text-white" onClick={() => useStudio.getState().removeFile(f.name)}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 描述区 */}
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-300">文字描述</div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            maxLength={300}
            placeholder="描述素材或想要的卡片，如：白裙短发的海边少女，人物卡"
            className="w-full resize-none rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        </div>

        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200">
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy || (pending.length === 0 && !desc.trim())}
            className="flex-1 rounded-xl bg-brand/85 py-2 text-sm font-bold text-ink disabled:opacity-40"
          >
            {busy ? "炼卡中…" : "交给铸卡师炼卡"}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.txt,.md"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
