// 对手条（G3）：同桌其他人的血量与出局状态。
//
// ★ 为什么必须有（施工单「有淘汰要显眼提示」的一半）：§2.5 的胜负是"最后两人胜出"，
//   而扣血的缩放（20/15/10/5）按存活人数变 —— 不看对手血量，玩家根本判断不出自己现在是第几名、
//   下一期会被扣多少。
// ★ 2026-11-28（feat/ui-game-hud-a）：从"顶栏下面单独一行药丸"改成**顶栏中间那一格** ——
//   设计稿 A 案的顶栏是一条横带（左：阶段/回合/计时，右：金币），中间正好是空的；
//   而底部新底带把屏幕下沿占掉了，再给对手条单独一行就会压到创作面板上（真机 363 高，
//   顶栏 44 + HUD 46 + 创作面板 94 + 底带 90 已经差不多满了）。所以它现在**进流**，
//   由 GameHud 摆在左组与金币之间（见 GameHud 的 center 参数），自己不再 absolute。
//   窄屏上放不下就整行截断（名字 truncate），不缩字号 —— 缩到 7px 就读不出了。
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

  /** 顶栏中间那一格：一排名字 + 血量，无底板（A 案：只靠字号与一条淡铜线分层） */
  const row = (rows: Array<{ key: string; name: string; hp: number; eliminated: boolean }>) => {
    if (rows.length === 0) return null;
    return (
      <div
        data-game-opponents
        className="pointer-events-none flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-[8.5px] leading-none tracking-[0.04em] text-[#a08a66]"
      >
        {rows.map((row) => (
          <span key={row.key} className={`flex items-baseline gap-1 ${row.eliminated ? "opacity-45" : ""}`}>
            <span className="truncate text-[#d9c9a8]">{row.name}</span>
            <span aria-hidden className="text-[#d79a8c]">
              {row.eliminated ? t`出局` : `❤ ${row.hp}`}
            </span>
          </span>
        ))}
      </div>
    );
  };

  // ── 联机：同桌 = 服务端房间成员（扣除我自己） ──
  if (online && session) {
    const opponents = session.members
      .filter((member) => member.userId !== session.myUserId)
      .map((member) => {
        const prediction = settlement?.ranking.find((candidate) => candidate.userId === member.userId);
        // hp 优先读结算行，其次读跨回合记录（开局房间快照 + 历次结算），最后才是成员快照
        const hp = prediction?.hp ?? memberHp[member.userId] ?? member.hp;
        return {
          key: member.userId,
          name: prediction?.name ?? member.name,
          hp,
          eliminated: prediction?.eliminated ?? hp <= 0,
        };
      });
    return row(opponents);
  }

  // ── 单机：原样 ──
  return row(
    opponentsOf(state, meId).map((opponent) => ({
      key: opponent.id,
      name: playerName(opponent.id),
      hp: opponent.hp,
      eliminated: opponent.eliminated,
    })),
  );
}
