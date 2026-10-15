// 「删除本段」的**唯一**实现：门禁在 store（flowStore.removeNode 只挡"只剩一段"），
// 而「已出片的段要不要二次确认」这条规则住在这里 —— 画布与线性视图共用它。
//
// ★★ 为什么抽出来（2026-08-21 对抗评审确认）：画布那份加了两段式确认、线性那份是一点就删，
//   同一个 store 动作、同一段真金白银炼出来的成片，两处两套规矩，而**没确认的那边恰恰是
//   默认视图**。更糟的是这条规则那时只长在画布一侧 —— 下次调整"什么时候要确认"必然只改一边
//   （CLAUDE.md「同一条规则各写一份」的同族）。
// ★ 组件只管"要不要点两下"与那句话；能不能删仍然只问 store。
// ★ 「删 + 给撤销」也只有一份（下面的 removeNodeWithUndo）：三个宿主（画布编辑窗 / FlowPage 单段 UI / 工坊投影窗）
//   都调它，各自只管删成之后关不关窗。
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { showToast } from "../../data/toast";
import { useFlow } from "../../studio/flowStore";

/**
 * 删一段并在轻提示上给「撤销」—— **唯一实现**。回「段是不是真的没了」（store 整句拒时回 false，原因在 store.err，
 * 由各面自己的错误条画出来；这里不另说）。
 *
 * ★ 为什么是"先删、再给撤销"而不是先问（2026-10-15 教材人格评审 norman-interaction-5，口径同 10-14 删草稿 / CLAUDE.md 轻提示那条）：
 *   没花钱的段原来一点就没（写好的要求 / 分镜 / 挂的卡 / 临时参考图一起没了），确认卡人人点「确定」、拦不住手滑，
 *   撤销才真能拿回来。花过钱的段（done / derived）那 3 秒二次点按**照旧**：撤销那 6 秒人未必看见，花过钱的东西两道都在。
 * ★ 为什么住在这个文件里：三个宿主删的是同一个 store 动作，那句话与那颗键各写一份必然分叉（这个文件抽出来的理由就是这个）。
 * ★ 6 秒是带键的提示的下限（CLAUDE.md：带键的提示至少给 6 秒 —— 人得来得及看见、点到；焦点落上去时计时会停，见 data/toast）。
 * ★ 不是组件，所以文案走 i18n._(msg) 而不是 useLingui（调用那一拍才翻，切语言不受影响）。
 */
export function removeNodeWithUndo(id: string): boolean {
  const before = useFlow.getState();
  const n = before.nodes.findIndex((x) => x.id === id) + 1; // 段号按删之前的位置说（删完它就不在表里了）
  if (n <= 0) return false;
  before.removeNode(id);
  if (useFlow.getState().nodes.some((x) => x.id === id)) return false; // 被 store 整句拒了（原因在 err）
  showToast(i18n._(msg`已删掉第 ${n} 段`), 6000, {
    label: i18n._(msg`撤销`),
    run: () => {
      // 放不回去（这期间有段开炼了 / 流水线换过了）要说出来，别让人以为点了没反应
      if (!useFlow.getState().restoreNode()) showToast(useFlow.getState().err || i18n._(msg`没能恢复这一段`));
    },
  });
  return true;
}

export default function DeleteSegBtn({
  done,
  derived,
  disabled,
  onConfirm,
  className = "",
}: {
  /** 这一段已经出片（有成片）—— 删了那笔钱就白花了，要点两下 */
  done: boolean;
  /**
   * 这一段推演过三套方案（flowStore.nodeDerived）—— 没出片也花过钱，同样点两下。
   * ★ 必填（2026-09-18 发版复核抓到「删掉唯一一段没出片的段只要点一下，推演花的钱一起没了」）：
   *   漏传就是零症状地退回「一点就删」。
   */
  derived: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  // ★ 定时器要在卸载时清掉：删完这一段，宿主多半会把面板一起收起（卸载），
  //   而 3 秒后那次 setState 落在已卸载的组件上
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      onClick={() => {
        if ((done || derived) && !armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        window.clearTimeout(timer.current);
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
      disabled={disabled}
      className={`${className} ${armed ? "bg-rose-500 font-bold text-white" : ""}`}
    >
      {armed ? (
        done ? (
          <Trans>真的删？这段成片会没</Trans>
        ) : (
          <Trans>真的删？推演出的方案会没（花过的 token 不退）</Trans>
        )
      ) : (
        <Trans>🗑 删除本段</Trans>
      )}
    </button>
  );
}
