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
//   那张卡会如实说清哪些已经存进草稿、哪些丢了要重花钱）；② **套成了**再 `newWorkDraft()`
//   断开与旧草稿的关联 —— 这一步与 CreatePage 换模式、工坊法阵重铺是同一个理由，别漏。
//   （顺序见 commit 的 ★★：先断后套的话，套用被拒时流水线没变却已经和草稿脱钩。）
import { useState } from "react";
import { useNavigate } from "react-router";
import DiscardFlowDialog from "./DiscardFlowDialog";
import { flowDirty } from "../../studio/flowStore";
import { useStudio } from "../../studio/studioStore";

export function useApplyTemplate() {
  const nav = useNavigate();
  /** 等用户点头的那次套用（连同**这一下在这里叫什么**）。用对象包一层是因为
   *  useState 会把裸函数当成惰性初始化。
   *  ★ 措辞按次传（第七轮扫描）：同一个 hook 实例会服务好几个动作 —— 工作流页那颗
   *    「不用」做的是**清掉模板铺一条空的**，而红键上却印着「套用这个模板」，
   *    正文还劝他「再回来套模板」（他刚点的正是"不要模板"）。 */
  const [pending, setPending] = useState<{ run: () => boolean; label: string; noun: string; claim: boolean } | null>(
    null,
  );

  /**
   * 真正落地。★★ **套成了才断开旧草稿**（第五轮验证抓到）：`applyTemplate` /
   *   `applyTemplateGroup` 整句拒绝是常态（档位闸没开、模板视频不合方舟窗口、分段组凑不齐），
   *   而拒绝时 `nodes` 一个字没改 —— 先断的话，流水线原封不动却已经和它那条草稿脱钩：
   *   下一次自动存盘会**另存一条新草稿**，而确认卡从此把"其实存住了的段"报成"没存上，
   *   丢了要重花钱"（savedDoneCount 也被清零）。顺序反过来就都对了。
   */
  function commit(apply: () => boolean, claim: boolean) {
    if (!apply()) return;
    // ★★ **认领式的入口不许断**（2026-08-21 第八轮验证判成回归，是我上一版引入的 high）：
    //   「打开草稿」这一下已经由 openWorkDraft 把 workDraftId 认到那条草稿上了，
    //   紧接着 newWorkDraft() 就把它当场脱钩 —— 之后自动存盘会**另存一条重复草稿**
    //   （库里两条各带 1MB 级的帧，20 条上限会挤掉最旧那条的正文），而确认卡按
    //   savedDoneCount=0 反过来说「N 段出片后还没进草稿，丢了要重花 token」，
    //   那 N 段就在刚打开的这条草稿里躺着。
    //   覆盖式入口（套模板/换模式/重铺）才需要断：它们把 nodes 换成了与旧草稿无关的内容。
    if (!claim) useStudio.getState().newWorkDraft();
  }

  /** 调用方把"套用 + 套用之后要做什么"整个交进来（返回真 = 真的套上了）；脏了就先问 */
  /**
   * @param words 这一下在这里叫什么（红键上的字、以及出路那句里的动词）。
   * @param words.claim true = **认领**一条既有草稿（打开草稿），不要断开与它的关联；
   *   缺省 false = 覆盖式（套模板/换模式/重铺），成功后断。见 commit 的 ★★。
   */
  function guard(apply: () => boolean, words?: { label?: string; noun?: string; claim?: boolean }) {
    const claim = words?.claim ?? false;
    if (flowDirty()) {
      setPending({
        run: apply,
        label: words?.label ?? "套用这个模板（丢弃上面那条）",
        noun: words?.noun ?? "套模板",
        claim,
      });
      return;
    }
    commit(apply, claim);
  }

  const dialog = pending ? (
    <DiscardFlowDialog
      discardLabel={pending.label}
      actionNoun={pending.noun}
      onResume={() => {
        setPending(null);
        nav("/flow"); // 「回去接着炼」：回到那条流水线，模板不套了
      }}
      onDiscard={() => {
        const p = pending;
        setPending(null);
        commit(p.run, p.claim);
      }}
      onCancel={() => setPending(null)}
    />
  ) : null;

  return { guard, dialog };
}
