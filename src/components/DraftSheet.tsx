// 草稿操作单：选模式打开 / 重命名 / 删除。2026-08-29 从 ProfilePage 抽出来共享
// （个人页草稿页签与 /drafts 草稿箱整页用的必须是同一份——两份迟早在守卫上分叉）。
//
// 两个模式都列出来而不是直接进上次那个——用户存的时候在工作流里，再打开时想去桌面上
// 改剧情是很正常的需求；上次用的那个标成「上次」，省得每次都要想。
import { useState } from "react";
import { useNavigate } from "react-router";
import Sheet from "./Sheet";
import { useApplyTemplate } from "./flow/useApplyTemplate";
import { deleteDraft, loadDraft, renameDraft, type DraftMode, type WorkDraftMeta } from "../data/drafts";
import { useStudio } from "../studio/studioStore";
import { relativeTime } from "../types";

export default function DraftSheet({ meta, onClose }: { meta: WorkDraftMeta; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(meta.title);
  /**
   * 删除的第二拍。★★ 2026-08-23 补：这颗「删除」原来是**一拍就删** ——
   * `deleteDraft` 立刻改索引、`idbDel` 抹掉正文，没有确认、没有撤销、没有回收站，
   * 而一条草稿里躺着的 `doneCount` 段全是**已经花过钱**的成片（草稿正是它们唯一的备份，
   * 见 CLAUDE.md「成了再断」那条）。手滑一下就是几十万到几百万 token 蒸发且零提示。
   * ★ 只在这一屏内联问一句，不新起对话框：DiscardFlowDialog 问的是"换掉流水线"，
   *   判据（flowDirty / savedDoneCount）与这里完全不同，套过来会说错话。
   */
  const [confirmDel, setConfirmDel] = useState(false);

  // ★★ **第七条整表换掉 nodes 的入口**（2026-08-21 第七轮扫描的 high）：openWorkDraft 是
  //   彻头彻尾的整表覆盖（有 flow 的走 setState、没有的走 startFlow(force) 或 reset()），
  //   而这一页此前连 flowDirty 都不问 —— 手上那条流水线里已经花钱炼出来的段当场蒸发，
  //   零确认、零报错；简约模式更没有任何备份（它按设计不进草稿库）。
  //   与另外六条走同一处守卫（唯一实现，见 useApplyTemplate 的 ★★）。
  const { guard, dialog } = useApplyTemplate();

  async function open(mode: DraftMode) {
    setBusy("打开中…");
    const full = await loadDraft(meta.id);
    if (!full) {
      // 索引里有、正文没了（配额清理/手动清过库）：把这条索引也清掉，别让用户对着点不开的卡片反复点
      setBusy("这条草稿的内容已丢失，已从列表移除");
      await deleteDraft(meta.id);
      setTimeout(onClose, 1600);
      return;
    }
    // ★ 守卫可能**推迟**执行（脏流水线时先摆确认卡）：那一路要把「打开中…」复位，
    //   否则用户点了「取消」之后两颗模式键恒禁、下面还写着"打开中…"，而什么都没在跑
    //   （第九轮扫描抓到，是这一批新守卫引入的）。
    setBusy("");
    guard(
      () => {
        setBusy("打开中…");
        // ★ 工坊里有一炉在跑时会被整句拒（studioBusyReason）：不看返回值的话，
        //   照旧跳页，而桌面还是上一摊活 —— 用户以为草稿打不开（第十一轮抓到）
        if (!useStudio.getState().openWorkDraft(full, mode)) {
          setBusy(useStudio.getState().studioBusyReason() ?? "现在打不开这条草稿");
          setTimeout(() => setBusy(""), 3200);
          return false;
        }
        navigate(mode === "studio" ? "/studio" : "/flow");
        return true;
      },
      // ★ claim：这一下是**认领**这条草稿（openWorkDraft 自己会把 workDraftId 指过去），
      //   不是覆盖式套用 —— 断开的话下次自动存盘会另存一条重复的，见 commit 的 ★★
      { claim: true, label: "打开这条草稿（丢弃上面那条流水线）", noun: "打开草稿" },
    );
  }

  return (
    <Sheet onClose={onClose}>
      {dialog}
      {renaming ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
          />
          <button
            onClick={() => void renameDraft(meta.id, name).then(() => setRenaming(false))}
            className="rounded-xl bg-brand px-4 text-sm font-bold text-ink"
          >
            改名
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-base font-bold text-slate-100">{meta.title}</h3>
          <button onClick={() => setRenaming(true)} className="flex-none text-xs text-slate-400">
            重命名
          </button>
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        {meta.segCount} 段 · 已出片 {meta.doneCount} · {relativeTime(meta.updatedAt)}改过
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => void open("studio")}
          disabled={!!busy}
          className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-left disabled:opacity-50"
        >
          <div className="text-sm font-bold text-amber-200">🎴 工坊模式</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            3D 桌面摆卡、推演走向{meta.lastMode === "studio" && " · 上次"}
          </div>
        </button>
        <button
          onClick={() => void open("flow")}
          disabled={!!busy}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/10 p-3 text-left disabled:opacity-50"
        >
          <div className="text-sm font-bold text-cyan-200">🧩 工作流模式</div>
          <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            一屏一段、逐段生成{meta.lastMode === "flow" && " · 上次"}
          </div>
        </button>
      </div>
      {busy && <div className="mt-2 text-center text-xs text-slate-400">{busy}</div>}

      {confirmDel ? (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
          {/* ★ 后果只按**已知事实**说（本仓「别往吓人的方向说错」那条）：doneCount 是这条
              草稿里确实已经出片的段数，0 就老实说没有花掉的钱，不要吓唬人。 */}
          <p className="text-[11px] leading-relaxed text-rose-200">
            {meta.doneCount > 0 ? (
              <>
                删掉「{meta.title}」？里面有 <b className="font-bold">{meta.doneCount} 段已经花钱炼出来的成片</b>，
                这条草稿是它们唯一的备份 —— 删了要重新花一次钱才有。
              </>
            ) : (
              <>删掉「{meta.title}」？这条还没有出片的段，不会有钱白花，但写好的分镜找不回来。</>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setConfirmDel(false)}
              className="flex-1 rounded-xl bg-slate-700/70 py-2 text-sm text-slate-200"
            >
              不删
            </button>
            <button
              onClick={() => void deleteDraft(meta.id).then(onClose)}
              className="rounded-xl bg-rose-500/90 px-4 py-2 text-sm font-bold text-ink"
            >
              确认删除
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200">
            取消
          </button>
          <button
            onClick={() => setConfirmDel(true)}
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300"
          >
            删除
          </button>
        </div>
      )}
    </Sheet>
  );
}
