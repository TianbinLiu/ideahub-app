// 工程标题（Google 文档式就地改名，2026-08-29 主人点名）：工作流画布顶栏与工坊顶栏
// 共用这一枚——点标题变输入框，回车/失焦提交。
//
// 标题的**唯一真身在草稿库**（WorkDraftMeta.title / renameDraft），这里不另存一份：
//   · 已认领草稿（studioStore.workDraftId 非空）→ 显示那条草稿的标题，改名走 renameDraft；
//   · 还没存过草稿 → 显示占位「未命名工程」，提交改名时**顺手把草稿建出来**
//     （saveWorkDraft({title})）——"给它起名字"本身就是"我要留着它"的表态，
//     这正是 Google 文档的语义（命名即持久化）。
//   · 建不出来（空白桌面/流水线，或写盘失败）→ 整句说出来，不静默吞掉（铁律八）。
//
// ★ 自动存盘不会冲掉用户起的名：saveWorkDraft 对已认领草稿传 undefined title，
//   drafts.saveDraft 落库时 `input.title ?? prev.title`——那条既有纪律正是这枚组件
//   能薄成这样的原因。
import { useEffect, useState } from "react";
import { renameDraft } from "../data/drafts";
import { useDrafts } from "../hooks/useDrafts";
import { useStudio } from "../studio/studioStore";
import type { DraftMode } from "../data/drafts";

export default function DraftTitle({ from, className = "" }: { from: DraftMode; className?: string }) {
  const draftId = useStudio((s) => s.workDraftId);
  const drafts = useDrafts();
  const title = (draftId && drafts.find((d) => d.id === draftId)?.title) || "";
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(title);
  const [msg, setMsg] = useState("");

  // 打开输入框那一刻取当前标题；外部改名（草稿箱里改的）也要跟上
  useEffect(() => {
    if (!editing) setVal(title);
  }, [title, editing]);

  async function commit() {
    setEditing(false);
    const t = val.trim().slice(0, 40);
    if (!t || t === title) return;
    if (draftId) {
      await renameDraft(draftId, t);
      return;
    }
    // 还没有草稿：起名即建档。失败要说话——这一下用户明确表达了"想留住"，
    // 静默丢掉名字比一开始不给输入框更糟
    const meta = await useStudio.getState().saveWorkDraft({ title: t, from });
    if (!meta) {
      setMsg("还存不了草稿（空白工程或写盘失败）");
      setTimeout(() => setMsg(""), 2600);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        maxLength={40}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="给这条工程起个名"
        className={`min-w-0 rounded-lg border border-brand/60 bg-black/40 px-2 py-1 text-sm font-bold text-slate-100 outline-none ${className}`}
      />
    );
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="点击重命名"
      className={`flex min-w-0 items-center gap-1 text-left ${className}`}
    >
      <span className={`truncate text-sm font-bold ${title ? "text-slate-100" : "text-slate-500"}`}>
        {msg || title || "未命名工程"}
      </span>
      <span aria-hidden className="flex-none text-[10px] text-slate-500">
        ✎
      </span>
    </button>
  );
}
