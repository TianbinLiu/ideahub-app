// 对手条（G3）：同桌其他人的血量与出局状态，贴在 HUD 下面一行。
//
// ★ 为什么必须有（施工单「有淘汰要显眼提示」的一半）：§2.5 的胜负是"最后两人胜出"，
//   而扣血的缩放（20/15/10/5）按存活人数变 —— 不看对手血量，玩家根本判断不出自己现在是第几名、
//   下一期会被扣多少。HUD 只够放"我"的读数，对手挪这一行。
// ★ 单机：数据来自 view.opponentsOf（问 rules 的血量 / 卡数），这里只画。
// ★ 联机（2026-11-24）：同桌对手是**服务端房间成员**（不是本机那几个 AI 座位），血量来自房间快照 /
//   最近一次结算（服务端是真相）；名字用服务端昵称。本机那几个 AI 座位在联机局里根本不参与，
//   拿它们的血量画出来就是另一桌人的数。
import { useLingui } from "@lingui/react/macro";
import { useGame } from "../store";
import { useRounds } from "../roundsStore";
import { playerName } from "../labels";
import { opponentsOf } from "../view";

export default function OpponentStrip() {
  const { t } = useLingui();
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const online = useGame((s) => s.online);
  const session = useRounds((s) => s.session);
  const settlement = useRounds((s) => s.settlement);
  const memberHp = useRounds((s) => s.memberHp);
  if (!state) return null;

  // ── 联机：同桌 = 服务端房间成员（扣除我自己） ──
  if (online && session) {
    const opponents = session.members
      .filter((member) => member.userId !== session.myUserId)
      .map((member) => {
        const row = settlement?.ranking.find((candidate) => candidate.userId === member.userId);
        // hp 优先读结算行，其次读跨回合记录（开局房间快照 + 历次结算），最后才是成员快照
        const hp = row?.hp ?? memberHp[member.userId] ?? member.hp;
        return {
          userId: member.userId,
          name: row?.name ?? member.name,
          hp,
          eliminated: row?.eliminated ?? hp <= 0,
        };
      });
    if (opponents.length === 0) return null;
    return (
      <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+6.1rem)] flex justify-center px-2">
        <div className="flex items-center gap-2.5 overflow-x-auto whitespace-nowrap rounded-full bg-panel/70 px-2.5 py-0.5 text-[10px] text-slate-300 ring-1 ring-white/10 backdrop-blur">
          {opponents.map((opponent) => (
            <span key={opponent.userId} className={opponent.eliminated ? "text-slate-500" : ""}>
              <span className="font-semibold text-slate-200">{opponent.name}</span>
              {opponent.eliminated ? " " + t`· 出局` : " " + t`· ❤ ${opponent.hp}`}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ── 单机：原样 ──
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
