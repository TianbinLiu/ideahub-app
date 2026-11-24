// 对局界面的那一层（G2 第二块起的覆盖层；G3 把回合循环的五屏接上；G4 第 3 步接摆卡与出片）。
//
// ★ 挂在工坊舞台（StudioPage 中间那一层）里，只在横屏且对局已开局时挂载（见 StudioPage 的 isLand &&）。
//   `pointer-events-none` 包一层、只有面板自己 `pointer-events-auto` —— 中间那块桌面照样能拖能转，
//   对局 UI 是"盖在桌上的仪表盘"，不是另一页。
// ★ 失败原因**只有这一处**说：rejection 是 store 从 rules 原样留下来的 RuleFailure，话由
//   reasons.ruleFailureText 统一翻（施工单"走 rules 的失败原因，别自己编话"）。
// ★ 阶段与挂哪个面板是一一对应的（§2.0）：商店 = 商店 + 背包 + 右侧道具栏（G4 §3）；
//   创作 = CreatePanel（出片小窗也长在里面）；展映 = ScreeningPanel；投票 = VotingPanel；
//   事件 = EventPanel；结算 / 结束 = RoundResultPanel。每一屏下面都有 PhaseBar 那颗"进下一阶段"的键。
// ★ 道具栏（右侧）与背包条（下方）**一直在**（只要对局开着）：商店阶段买完卡就地摆/装备，
//   创作阶段出片前也可以改 —— 摆卡与装备这两件事两阶段都允许（rules.PLACE_PHASES）。
// ★ 商店栏在**屏幕上方**（G4 §2 第 2 条）：商店一开相机就贴着铸卡师，桌面上那 5 个卡位全在镜头背后，
//   商店栏占顶部那一条，两边不叠；商店开着时 HUD 与对手条让位（理由见第 2 步的 ★）。
// ★ 这里没有任何 import 自 rules 的规则函数：一个数都从 view 来（view.ts 去问 rules），
//   一个动作都递回 store（store 去问 rules / phases）。3D 场景只按 drag / hover 高亮（scene/ 只读）。
import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { ruleFailureText } from "../reasons";
import { roundsNoteText } from "../roundsReasons";
import { useRounds } from "../roundsStore";
import { useGame, type GameNotice } from "../store";
import { gameViewOf } from "../view";
// 相机归工坊（studioStore）管，对局这一层**只按商店开没开来敲它的门**（enterShopCam/exitShopCam）。
// ★ 别把这两个动作塞进 game/store：那一层的纪律是"只转发规则"（文件头 ★★），而相机不是规则。
import { useStudio } from "../../studioStore";
import BagBar from "./BagBar";
import CreatePanel from "./CreatePanel";
import EventPanel from "./EventPanel";
import GameDragLayer from "./GameDragLayer";
import GenPreview from "./GenPreview";
import GameHud from "./GameHud";
import ItemRail from "./ItemRail";
import OnlineEventPanel from "./OnlineEventPanel";
import OnlineScreeningPanel from "./OnlineScreeningPanel";
import OnlineVotingPanel from "./OnlineVotingPanel";
import OpponentStrip from "./OpponentStrip";
import PhaseBar from "./PhaseBar";
import RoundResultPanel from "./RoundResultPanel";
import ScreeningPanel from "./ScreeningPanel";
import ShopPanel from "./ShopPanel";
import StylePick from "./StylePick";
import { useOnlineRounds } from "./useOnlineRounds";
import VotingPanel from "./VotingPanel";

export default function GameLayer() {
  const state = useGame((s) => s.state);
  const meId = useGame((s) => s.meId);
  const shopOpen = useGame((s) => s.shopOpen);
  const rejection = useGame((s) => s.rejection);
  const notice = useGame((s) => s.notice);
  const previewOpen = useGame((s) => s.previewOpen);
  const online = useGame((s) => s.online);
  const onlineLocalEvents = useGame((s) => s.onlineLocalEvents);
  const roundsNote = useRounds((s) => s.note);
  const { t } = useLingui();
  // 联机回合的轮询与对账（**唯一一处**定时器；单机局里这个 hook 什么都不做）
  useOnlineRounds();

  // 轻提示 2.8 秒后自己消失（与 StudioPage 的 Toast 同一种做法：状态留在 store，显示由本地计时器管）
  const [shownNotice, setShownNotice] = useState<GameNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  // 商店栏开着没有：挂不挂商店那一屏、要不要把相机交过去，都只看这一个值。
  // ★ 算在早退之前：下面有 `if (!state) return null` 之类的早退，hook 不能排在它们后面。
  const shopVisible = state?.phase === "shop" && shopOpen;
  /** 这一层的根（只有面板自己带 pointer-events-auto）。点外面收起商店时靠它判"点在不在对局 UI 上" */
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * 商店机位 + 点外面收起（G4 施工单 §2 第 1/4 条）。
   * ★ 进/出成对写在一个 effect 里：商店一开就 enterShopCam（相机走近铸卡师、绕行限正面 180°），
   *   收起 / 换阶段 / 组件卸载（转竖屏、结束对局、离开工坊）一律 exitShopCam 把进店前那台放回去。
   * ★ 收起的两条路都通：再点商店键（BagBar 那颗 toggle）与**点商店栏外面** ——
   *   后者是这里那对 window 监听，判据三条：位移小于 8px（拖动绕镜头不算点）、
   *   落点不在这一层的 DOM 里（商店栏 / 背包条 / 状态栏 / 阶段条都算"里面"）。
   *   ★ 拖动中（drag 非空）不算"点外面"：从背包条往桌面拖卡的那一下会穿过这一层，松手不该把商店收掉。
   *   捕获阶段监听：R3F 的 pointer 事件挂在 canvas 上，冒泡阶段可能已经被它处理过一轮。
   */
  useEffect(() => {
    if (!shopVisible) return;
    useStudio.getState().enterShopCam();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start) return;
      if (useGame.getState().drag) return; // 正在拖卡：这一下是拖拽，不是点
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return; // 拖 = 绕镜头，不是点
      const el = e.target as Node | null;
      if (el && rootRef.current?.contains(el)) return; // 点在商店栏/背包条上
      useGame.getState().toggleShop(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      useStudio.getState().exitShopCam();
    };
  }, [shopVisible]);

  if (!state) return null;
  const view = gameViewOf(state, meId);
  if (!view) return null;
  // 还没选风格：整屏都是风格卡（选完 beginRound 才开第一回合商店）
  if (state.phase === "style") return <StylePick view={view} />;

  const inShop = state.phase === "shop";
  /**
   * 事件屏（G4 施工单 §5）：这一屏是一次决策，不是"桌上再加一块面板"。
   * ★ 为什么 HUD / 对手条 / 道具栏 / 背包条要在这一个阶段让位：真机横屏只有 363 CSS px 高，
   *   背包条 67 + 阶段条 22 一占，再给"图标 + 标题 + 一行收益 + 花费 + 确认键"的三张卡只剩 ~115px ——
   *   图标和收益都被挤没了，而那三样正是施工单点名的。让位之后三张卡有 ~140px 起（卡高 clamp）。
   * ★ 事件阶段这一屏里能点的只有卡与确认/跳过：卖卡、买卡、摆卡、拖道具在 rules 里全是 wrong-phase，
   *   商店键打开的那个面板也只在商店阶段挂 —— 所以让位不拿走任何还能用的操作。
   * ★ 血量 / 金币 / 回合不跟着没：它们由事件面板自己念（数还是从同一份 view 来，见 EventPanel）。
   * ★ 阶段条**留着**：它在这一阶段写的是「三选一，拿不准可以跳过 · AI 已经选好了」。
   */
  const inEvent = state.phase === "event";
  /**
   * 结算 / 对局结束那一屏（G4 收尾）：结算面板是**满宽**的（`w-full max-w-[48rem]`，真机 776px），
   * 它一立起来就把右侧道具栏吃掉一半——真机 800×363 上表现为"🧹 拆除"那颗键被面板上沿切掉，
   * 看着像坏了。而那一栏在这一阶段**没有一个能用的动作**（装备/卸下只在商店与创作两个阶段，
   * rules.PLACE_PHASES），所以干脆收起来，下一个阶段原样回来。
   * ★ 只收道具栏：背包条与阶段条在结算面板**下面**，没有被压住（施工单：结算屏只修遮挡/溢出）。
   */
  const inResult = state.phase === "round-end" || state.phase === "over";

  /** 动作成功的那一句（种类在 store，话在这里；两条都带数字时数字来自 store 记的 rules 值） */
  const noticeText = (n: GameNotice): string => {
    switch (n.kind) {
      case "bought":
        return t`买好了`;
      case "sold":
        return t`卖掉了，+${n.gold ?? 0} 金`;
      case "placed":
        return t`摆到桌面上了`;
      case "returned":
        return t`收回背包了`;
      case "equipped":
        return t`装备好了`;
      case "unequipped":
        return t`卸下了，道具回到背包`;
      case "refreshed":
        return t`商店刷新了`;
      case "locked":
        return t`商店已锁定：下一回合不会自动刷新（手动刷新照样可以）`;
      case "unlocked":
        return t`商店解锁了`;
      case "entry-saved":
        return t`这一期交片了（占位片）——可以开始展映`;
      case "generated":
        return t`这一期交片了——真出片的那一条`;
      case "liked":
        return t`点了个赞`;
      case "voted":
        return t`票投出去了`;
      case "abstained":
        return t`这一期弃权了`;
      case "online-submitted":
        return t`已交片，等其他人`;
    }
  };

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-30">
      {/* 纯预览的工作流面板（施工单 §2 第三条）：整屏盖住，只让看不让改 */}
      {previewOpen && <GenPreview />}

      {/* ★ 商店开着时 HUD 与对手条让位（理由见文件头那段 ★）；事件阶段也一起让位（见 inEvent） */}
      {!shopVisible && !inEvent && <GameHud hud={view.hud} />}
      {!shopVisible && !inEvent && <OpponentStrip />}
      {/* ── 商店栏：**屏幕上方**（施工单 §2 第 2 条） ── */}
      {shopVisible && (
        <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top,0px)+0.5rem)] flex justify-center px-1.5">
          <ShopPanel view={view} />
        </div>
      )}

      {/* ── 右侧道具栏（施工单 §3 第三条）：道具卡 + 拆除工具 ──
          位置在屏幕右侧、竖直正中偏下：横屏真机（800×363）上桌面卡位在中间那一带，
          右侧这一列避开它们、也不压 HUD 与背包条。
          ★ 事件屏与结算屏两个阶段收起来（见 inEvent / inResult）：那两屏的面板都是满宽的，
            它会有一半被面板压住（拆除工具被切掉半颗），而它在这两个阶段没有一个能用的动作。 */}
      {!shopVisible && !inEvent && !inResult && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          <ItemRail view={view} />
        </div>
      )}

      {/* ★ 这一层挂在 StudioPage 的**舞台那一层**里，所以 `inset-x-0` 的宽度就是舞台宽度（G4 删掉左右常驻条之后 = 整窗）。
          面板一律用 `w-full max-w-[…]`，**不许**写 `96vw` 这种按视口的宽度 —— 2026-11-23 真机实测：
          创作面板按 96vw 算出来比舞台还宽，右边伸进右栏底下，那半边的「🎬 拍好了」点了没反应
          （不报错、不提交，看起来像卡住了）。桌面浏览器窗口更宽，看不出来。 */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1.5 p-1.5">
        {/* ── 状态栏：一次只显示一件事，优先级 = 失败 > 刚做完的那一下 ── */}
        {rejection ? (
          <div
            role="alert"
            className="pointer-events-auto flex max-w-[40rem] items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/15 px-2 py-1 text-[10px] leading-snug text-danger-100"
          >
            <span className="font-semibold" aria-hidden>
              !
            </span>
            <span>{ruleFailureText(rejection.failure)}</span>
            <button
              type="button"
              onClick={() => useGame.getState().clearRejection()}
              aria-label={t`关掉这条提示`}
              className="ml-auto flex-none rounded px-1 text-danger-200 active:bg-white/10"
            >
              ✕
            </button>
          </div>
        ) : roundsNote ? (
          // 联机回合那一句：退回单机 / 这一拍没连上 / 服务端拒了这一步。**必须看得见**（铁律八），
          // 与 rejection 同一行、同一优先级位置；点了 ✕ 才收掉（2 秒轮询不会把它冲掉）。
          <div
            role="status"
            className={`pointer-events-auto flex max-w-[40rem] items-start gap-1.5 rounded-lg border px-2 py-1 text-[10px] leading-snug ${
              roundsNote.kind === "fallback"
                ? "border-danger/40 bg-danger/15 text-danger-100"
                : "border-gold/40 bg-gold/10 text-gold-100"
            }`}
          >
            <span className="font-semibold" aria-hidden>
              ↻
            </span>
            <span>{roundsNoteText(roundsNote)}</span>
            <button
              type="button"
              onClick={() => useRounds.getState().clearNote()}
              aria-label={t`关掉这条提示`}
              className="ml-auto flex-none rounded px-1 text-slate-300 active:bg-white/10"
            >
              ✕
            </button>
          </div>
        ) : shownNotice ? (
          <div className="pointer-events-none rounded-lg bg-black/65 px-2.5 py-1 text-[10px] leading-snug text-slate-100">
            {noticeText(shownNotice)}
          </div>
        ) : null}

        {/* ── 阶段对应的那一屏（商店那一屏在顶部，见上面） ── */}
        {state.phase === "create" && <CreatePanel view={view} />}
        {!inShop && state.phase === "screening" && (online ? <OnlineScreeningPanel /> : <ScreeningPanel />)}
        {!inShop && state.phase === "voting" && (online ? <OnlineVotingPanel /> : <VotingPanel />)}
        {/* ★ 事件屏两块牌子：服务端出题时渲染服务端那一份（OnlineEventPanel，[id] 同一张卡）；
            退回本机事件（能力位为假 / 接口不可用）时才用单机那一屏，并由它写明「事件只在本机生效」。 */}
        {!inShop &&
          state.phase === "event" &&
          (online && !onlineLocalEvents ? <OnlineEventPanel /> : <EventPanel view={view} />)}
        {!inShop && (state.phase === "round-end" || state.phase === "over") && <RoundResultPanel />}

        {/* 背包条 + 商店键：商店阶段 = 买完就地摆；创作阶段出片前还能改摆法（见 rules.PLACE_PHASES）。
            ★ 事件阶段让位（见 inEvent）：那一条在这一阶段没有一个能用的动作，却要占掉 67px。 */}
        {!inEvent && <BagBar view={view} />}

        <PhaseBar view={view} />
      </div>

      {/* 拖动中的那张卡 + 落点判定（起点是背包条 / 右侧栏 / 桌面卡位，落点是 3D 卡位的屏投影）。
          常驻挂载：它自带 window 监听，只在 drag 非空时真的做事情。 */}
      <GameDragLayer />
    </div>
  );
}
