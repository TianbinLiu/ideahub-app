// 对手条（G3）：三个 AI 陪玩各自的血量与出局状态，贴在 HUD 下面一行。
//
// ★ 为什么必须有（施工单「有淘汰要显眼提示」的一半）：§2.5 的胜负是"最后两人胜出"，
//   而扣血的缩放（20/15/10/5）按存活人数变 —— 不看对手血量，玩家根本判断不出自己现在是第几名、
//   下一期会被扣多少。HUD 只够放"我"的读数，对手挪这一行。
// ★ 数据全部来自 view.opponentsOf（它问 rules.ownedCards / 血量），这里只画。
import { useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { playerName } from "../labels";
import { opponentsOf } from "../view";

export default function OpponentStrip() {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  if (!state) return null;
  const opponents = opponentsOf(state, meId);
  if (opponents.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+6.1rem)] flex justify-center px-2">
      <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap rounded-full bg-panel/70 px-2.5 py-0.5 text-[10px] text-slate-300 ring-1 ring-white/10 backdrop-blur">
        {opponents.map((opponent) => {
          const name = playerName(opponent.id);
          return (
            <span key={opponent.id} className={opponent.eliminated ? "text-slate-500" : ""}>
              <span className="font-semibold text-slate-200">{name}</span>
              {opponent.eliminated
                ? " " + t`· 出局`
                : " " + t`· ❤ ${opponent.hp} · ${opponent.cards} 卡`}
            </span>
          );
        })}
      </div>
    </div>
  );
}
