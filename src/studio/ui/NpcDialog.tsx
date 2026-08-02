// 铸卡师对话：竖屏底部抽屉。
// 流程：点气泡栏打开 → 先出「🛒 逛市场 / 📎 添加素材」左右两大选项（悬浮放大高亮、
// 另一侧缩小），点击后选项消失进入对应界面；镜头同时切到俯视 NPC 半场。
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studioStore";
import { fileToCover } from "../../mock/frames";
import { MaterialFile } from "../../ai";
import { NPC_CAM } from "../scene/layout";

type SheetMode = "choose" | "market" | "forge";

export default function NpcDialog() {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const pending = useStudio((s) => s.pendingFiles);
  const projection = useStudio((s) => s.projection);
  // 对话框默认隐藏：可见性由 store 的 dialogView 决定，只有点击 3D 里的 NPC 才唤起
  const open = useStudio((s) => s.dialogView);
  const [mode, setMode] = useState<SheetMode>("choose");
  const [hov, setHov] = useState<"market" | "forge" | null>(null);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy, open, mode]);

  // 投影窗打开时隐藏对话层，避免遮挡
  if (projection) return null;


  // 关闭对话 → 相机回第一人称眼位，轨道解除
  function closeSheet() {
    const st = useStudio.getState();
    st.setDialogView(false);
    st.setCamera({ kind: "default" });
    useStudio.setState({ orbit: null });
    setMode("choose");
    setHov(null);
  }
  function chooseMarket() {
    setMode("market");
    void useStudio.getState().openMarket();
  }
  function chooseForge() {
    setMode("forge");
    fileRef.current?.click();
  }
  function backToChoose() {
    const st = useStudio.getState();
    if (st.market.open) st.closeMarket();
    // 回到对话选项页 → 恢复第一人称对坐视角
    st.setCamera({ kind: "pos", pos: NPC_CAM.pos, look: NPC_CAM.look });
    setHov(null);
    setMode("choose");
  }

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

  // 默认隐藏：不再有常驻气泡栏，点击 3D 里的铸卡师才唤起（用户定稿）
  if (!open) return null;

  // ── 选项态：两大选项占据窗口左右 ──────────────────────────────
  if (mode === "choose") {
    return (
      <div className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex h-[30%] flex-col rounded-t-2xl border-t border-slate-700/70 bg-panel/95 backdrop-blur">
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold text-slate-100">铸卡师</span>
          <span className="text-xs text-slate-400">想做点什么？</span>
          <button onClick={closeSheet} className="ml-auto px-2 text-slate-400 hover:text-white">
            ▾
          </button>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 px-4 pb-4">
          {(
            [
              { key: "market", icon: "🛒", label: "逛市场", desc: "摊开社区热卡，挑几张收进卡组", onClick: chooseMarket },
              { key: "forge", icon: "📎", label: "添加素材", desc: "上传图片 / 文本，炼成你的专属卡", onClick: chooseForge },
            ] as const
          ).map((opt) => {
            const active = hov === opt.key;
            const dimmed = hov != null && !active;
            return (
              <button
                key={opt.key}
                onMouseEnter={() => setHov(opt.key)}
                onMouseLeave={() => setHov(null)}
                onClick={opt.onClick}
                style={{ flexGrow: active ? 1.7 : dimmed ? 0.65 : 1 }}
                className={`flex basis-0 flex-col items-center justify-center gap-1.5 rounded-2xl border transition-all duration-300 ${
                  active
                    ? "border-brand bg-brand/10 shadow-[0_0_28px_rgba(56,189,248,0.35)]"
                    : dimmed
                      ? "scale-95 border-slate-700 opacity-55"
                      : "border-slate-600/70 bg-ink/40"
                }`}
              >
                <span className={`transition-all duration-300 ${active ? "text-5xl" : "text-4xl"}`}>{opt.icon}</span>
                <span className={`font-bold ${active ? "text-lg text-brand" : "text-base text-slate-100"}`}>{opt.label}</span>
                <span className="px-2 text-center text-[11px] leading-4 text-slate-400">{opt.desc}</span>
              </button>
            );
          })}
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
    );
  }

  // ── 市场 / 炼卡态 ────────────────────────────────────────────
  return (
    <div className="safe-bottom absolute inset-x-0 bottom-0 z-10 flex h-[42%] flex-col rounded-t-2xl border-t border-slate-700/70 bg-panel/95 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-slate-700/60 px-3 py-2">
        <button onClick={backToChoose} className="px-1 text-slate-400 hover:text-white">
          ‹
        </button>
        <span className={`h-2.5 w-2.5 rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
        <span className="text-sm font-semibold text-slate-100">铸卡师 · {mode === "market" ? "市场" : "炼卡"}</span>
        <span className="text-xs text-slate-400">
          {busy ? "炼卡中…" : mode === "market" ? "点桌上的卡放大查看" : "补充说明后发送"}
        </span>
        <button onClick={closeSheet} className="ml-auto px-2 text-slate-400 hover:text-white">
          ▾
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {messages.slice(-30).map((m) => (
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

      {mode === "forge" && pending.length > 0 && (
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

      <div className="flex gap-2 border-t border-slate-700/60 p-3 pb-4">
        {mode === "forge" && (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="flex-none rounded-xl bg-slate-700/70 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
            title="继续添加素材"
          >
            {reading ? "…" : "📎"}
          </button>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder={mode === "market" ? "搜索市场卡片，如「古风」「侦探」…" : "描述素材或想要的卡片…"}
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

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.txt,.md"
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />
    </div>
  );
}
