// 草稿箱整页（/drafts，2026-08-29 主人点名"专门做一个草稿页面"）。
//
// 与个人页「草稿」页签的分工：那边是缩略网格快捷入口（三列小图，塞在七个页签里），
// 这边是完整管理面——大卡片看得清标题与进度、容量条、按上次模式一键续做。
// 操作（选模式打开/重命名/删除）与个人页共用同一份 DraftSheet（铁律六：
// 打开草稿要过"整表覆盖守卫 + 工坊在途闸"两道闸，抄第二份必然漏一道）。
//
// ★ 不设登录墙：草稿是**这台设备**的 IndexedDB（与账号无关），锁在登录后面只会让
//   离线用户找不到自己昨天存的东西。
import { useState } from "react";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import DraftSheet from "../components/DraftSheet";
import { MAX_DRAFTS, type WorkDraftMeta } from "../data/drafts";
import { useDrafts } from "../hooks/useDrafts";
import { useStudio } from "../studio/studioStore";
import { relativeTime } from "../types";

export default function DraftsPage() {
  const nav = useNavigate();
  const drafts = useDrafts();
  const [pick, setPick] = useState<WorkDraftMeta | null>(null);
  // 手上正在做的那条（自动存盘认领的草稿）——标出来，用户才知道"哪条是我现在这摊活"
  const currentId = useStudio((s) => s.workDraftId);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset
        onBack={() => nav(-1)}
        title="草稿箱"
        right={
          <span className="flex-none text-[11px] text-slate-500">
            {drafts.length}/{MAX_DRAFTS}
          </span>
        }
      />
      {/* 容量规则说在明处：超限清最旧不是 bug，是防配额吃满（drafts.MAX_DRAFTS 的 ★）。
          别等用户丢了草稿才在这行字里找答案 */}
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        草稿只存在这台设备上；超过 {MAX_DRAFTS} 条会从最旧的清起。每炼成一段都会自动存进当前草稿。
      </p>

      {drafts.length === 0 ? (
        <EmptyState
          emoji="📝"
          text="还没有草稿——工坊和工作流里做到一半的工程都会存到这里"
          cta={{ label: "去创作", to: "/create", primary: true }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {drafts.map((d) => (
            <button
              key={d.id}
              onClick={() => setPick(d)}
              className={`overflow-hidden rounded-2xl border text-left ${
                d.id === currentId ? "border-brand/70 bg-brand/5" : "border-slate-700/70 bg-panel"
              }`}
            >
              {d.thumb ? (
                <img src={d.thumb} alt="" className="aspect-video w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-slate-800 text-3xl">🎬</div>
              )}
              <div className="p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">{d.title}</span>
                  {d.id === currentId && (
                    <span className="flex-none rounded bg-brand/20 px-1 py-0.5 text-[9px] font-semibold text-brand">
                      当前
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {d.segCount} 段 · 已出片 {d.doneCount} · {relativeTime(d.updatedAt)}改过
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  上次在{d.lastMode === "studio" ? "🎴 工坊" : "🧩 工作流"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {pick && <DraftSheet meta={pick} onClose={() => setPick(null)} />}
    </div>
  );
}
