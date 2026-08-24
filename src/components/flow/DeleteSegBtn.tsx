// 「删除本段」的**唯一**实现：门禁在 store（flowStore.removeNode 只挡"只剩一段"），
// 而「已出片的段要不要二次确认」这条规则住在这里 —— 画布与线性视图共用它。
//
// ★★ 为什么抽出来（2026-08-21 对抗评审确认）：画布那份加了两段式确认、线性那份是一点就删，
//   同一个 store 动作、同一段真金白银炼出来的成片，两处两套规矩，而**没确认的那边恰恰是
//   默认视图**。更糟的是这条规则那时只长在画布一侧 —— 下次调整"什么时候要确认"必然只改一边
//   （CLAUDE.md「同一条规则各写一份」的同族）。
// ★ 组件只管"要不要点两下"与那句话；能不能删仍然只问 store。
import { useEffect, useRef, useState } from "react";

export default function DeleteSegBtn({
  done,
  disabled,
  onConfirm,
  className = "",
}: {
  /** 这一段已经出片（有成片）—— 删了那笔钱就白花了，要点两下 */
  done: boolean;
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
        if (done && !armed) {
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
      {armed ? "真的删？这段成片会没" : "🗑 删除本段"}
    </button>
  );
}
