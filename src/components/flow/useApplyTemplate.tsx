// 「套用模板」的入口守卫 —— **唯一实现**，模板市场/我的模板（TemplateShelf）与模板详情页共用。
//
// ★★ 为什么必须有（2026-08-21 第三轮验证顺出来的一条真丢钱的路）：`applyTemplate` /
//   `applyTemplateGroup` 都是**整表覆盖** `nodes`。而这两条入口此前一个都不判在途流水线，
//   于是用户在「我的模板」点一下「用它出片」，正在做的那条流水线连同已经花钱炼出来的段
//   当场消失 —— 没有确认、没有提示。
//   更狠的是第二拍：`workDraftId` 没断，新流水线炼成第一段时自动存盘会**原地覆盖**
//   原来那条草稿（那正是那些付费段唯一的备份，见 FlowPage 的 doneCount effect）。
//   于是"还能从草稿捞回来"这条退路也被踩掉，钱真没了。
// ★ 两件事一起做：① 脏了就先摆确认卡（与创作入口、工坊法阵**同一个** DiscardFlowDialog，
//   那张卡会如实说清哪些已经存进草稿、哪些丢了要重花钱）；② 真套用之前 `newWorkDraft()`
//   断开与旧草稿的关联 —— 这一步与 CreatePage 里换模式那三条路是同一个理由，别漏。
import { useState } from "react";
import { useNavigate } from "react-router";
import DiscardFlowDialog from "./DiscardFlowDialog";
import { flowDirty } from "../../studio/flowStore";
import { useStudio } from "../../studio/studioStore";

export function useApplyTemplate() {
  const nav = useNavigate();
  /** 等用户点头的那次套用。用函数包一层是因为 useState 会把裸函数当成惰性初始化 */
  const [pending, setPending] = useState<{ run: () => boolean } | null>(null);

  /**
   * 真正落地。★★ **套成了才断开旧草稿**（第五轮验证抓到）：`applyTemplate` /
   *   `applyTemplateGroup` 整句拒绝是常态（档位闸没开、模板视频不合方舟窗口、分段组凑不齐），
   *   而拒绝时 `nodes` 一个字没改 —— 先断的话，流水线原封不动却已经和它那条草稿脱钩：
   *   下一次自动存盘会**另存一条新草稿**，而确认卡从此把"其实存住了的段"报成"没存上，
   *   丢了要重花钱"（savedDoneCount 也被清零）。顺序反过来就都对了。
   */
  function commit(apply: () => boolean) {
    if (apply()) useStudio.getState().newWorkDraft();
  }

  /** 调用方把"套用 + 套用之后要做什么"整个交进来（返回真 = 真的套上了）；脏了就先问 */
  function guard(apply: () => boolean) {
    if (flowDirty()) {
      setPending({ run: apply });
      return;
    }
    commit(apply);
  }

  const dialog = pending ? (
    <DiscardFlowDialog
      discardLabel="套用这个模板（丢弃上面那条）"
      onResume={() => {
        setPending(null);
        nav("/flow"); // 「回去接着炼」：回到那条流水线，模板不套了
      }}
      onDiscard={() => {
        const p = pending;
        setPending(null);
        commit(p.run);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { guard, dialog };
}
