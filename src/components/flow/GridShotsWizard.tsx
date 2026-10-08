// 跟着做 C「九宫格分镜」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-05 第三期，
// 方案 docs/guided-modes-design.md §二 C、§七；主人 10-05「用组图，做第三期 C」）。
//
// 五步：① 人物和场景（与 B 同一批人，可再挑一张场景卡）→ ② 写这场戏，AI 写成 4~9 格分镜（景别 / 画面 / 动作 / 画面里有谁，逐格可改）
//   → ③ 一次画出整组画面（组图，摆成九宫格；单格可重画）→ ④ 按顺序挑几格 → ⑤ 每格变成一段：那一格的画面当开头帧，逐段出片。
// ★ 状态全在 studio/gridDraftStore（人物在 leadDraftStore），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layWizardNodes + genNodeVideo，画布走 flowStore.appendSpecs + genNode —— 两面原有的出片入口，不另写一份。
// ★ 报价由宿主给（quote）：宿主拿 flowStore.appendSpecsQuote 照着「真会落下的那几段」逐段算（gridAppendSpecs 拼的同一份），
//   与 genNode 真扣同一把尺。画面那一笔（组图 / 单格重画）按张，价钱在 gridDraftStore 一处。
// ★ 只出第一段：每段都有自己的开头画面，但「炼出本段才开下一段」照旧（flowStore 的顺序门禁）—— 第一段人物就不对的话，后面几段不用花钱。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { AI_REAL, groupsAvailable } from "../../ai";
import { myCards, realFaceIssue } from "../../data/account";
import { CHAT_TURN_TOKENS, clampDuration, durationChoices, fmtTokens, tierOf } from "../../data/economy";
import { GRID_DEFAULT_SEC, GRID_SHOTS_MAX, GRID_SHOTS_MIN, namedOutside, type GridNote, type PanelIssue } from "../../data/gridShots";
import { LEAD_CAST_MAX, SCENE_MAX, SCENE_MIN } from "../../data/sceneShots";
import { useAccountVersion } from "../../hooks/useAccount";
import type { AppendSpec } from "../../studio/flowStore";
import {
  GRID_STEPS,
  PANEL_CHECK_TOKENS,
  PANEL_REDRAW_TOKENS,
  addShot,
  discardParkedGroup,
  drawGroup,
  editShot,
  gridAppendSpecs,
  gridCastIssue,
  gridStaleIssue,
  groupQuote,
  panelStale,
  parkedGroupOf,
  pickedShots,
  redrawPanel,
  refetchPanel,
  refetchWillCheck,
  removeShot,
  resumeGroup,
  resumeReplacesDraft,
  setGrid,
  togglePick,
  togglePlace,
  useGridDraft,
  writeShots,
  writeShotsByHand,
  type GridStep,
} from "../../studio/gridDraftStore";
import { setLead, useLeadDraft } from "../../studio/leadDraftStore";
import { VIDEO_ASPECTS, type Card, type VideoAspect } from "../../types";
import ConfirmDialog from "../ConfirmDialog";
import Spinner from "../Spinner";
import TokenCost from "../TokenCost";
import CastPicker from "./CastPicker";

const STEP_LABEL: Record<GridStep, MessageDescriptor> = {
  cast: msg`人物`,
  shots: msg`分镜`,
  draw: msg`出画面`,
  pick: msg`挑格子`,
  spec: msg`出片`,
};

export default function GridShotsWizard({
  tierId,
  defaultAspect,
  quote,
  onBack,
  onFinish,
  err,
  busy,
}: {
  /** 选法屏上选定的出片档位（C 不在真人档上，判据 data/guidedModes.modeBlock） */
  tierId: string;
  /** 画面的缺省画幅（接上一段的；画之前可以换，画好之后就跟着画面走） */
  defaultAspect: VideoAspect;
  /** 照这几份落几段、每段出片各要多少（宿主用 flowStore.appendSpecsQuote，与真扣同一把尺） */
  quote: (specs: AppendSpec[]) => number[];
  /** 第①步再往回退：回选法屏 */
  onBack: () => void;
  /** 落成几段；generate = 落完接着出第一段 */
  onFinish: (specs: AppendSpec[], generate: boolean) => void;
  /** 宿主那边的整句拒绝（落段被门禁拒了的原因）—— 向导盖在宿主的错误条上面，自己画一份 */
  err?: string;
  /** 有一段正在生成（同一时刻只炼一段） */
  busy?: boolean;
}) {
  const { t } = useLingui();
  useAccountVersion();
  const d = useGridDraft();
  const lead = useLeadDraft();
  /** 第③步点开的那一格（下面摆它的分镜、补一句要求、重画）；null = 没点 */
  const [focus, setFocus] = useState<number | null>(null);
  const [ask, setAsk] = useState("");
  /** 「放弃上一组」的确认卡开着没有（钱上的话在卡里当面说） */
  const [discardAsk, setDiscardAsk] = useState(false);
  /**
   * 这台机器出得了组图吗（打包看服务端的能力位）：true / false / null = 这一刻没问到（断网 / 5xx / 429）；"asking" = 第一次还在问。
   * ★ null 不是 false（2.62 发版评审抓到）：原来没问到也说「服务端更新之后就有」、键灰到关掉重开为止。现在 null 时说「没问到」、
   *   每 31 秒再问一次（data/serverCaps 失败后 30 秒内不重探），并照 serverCaps 的口径**放行**：服务端真不支持时受理那一发会直接说、不扣钱
   */
  const [canDraw, setCanDraw] = useState<boolean | null | "asking">("asking");
  // 挂没挂着（两张后台任务票 —— 出画面、现做主角 —— 据此决定要不要弹通知）。★ 挂载时置回 true：StrictMode 下 effect 会 mount → unmount → mount
  useEffect(() => {
    setGrid({ mounted: true });
    setLead({ mounted: true });
    return () => {
      setGrid({ mounted: false });
      setLead({ mounted: false });
    };
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () =>
      void groupsAvailable().then((ok) => {
        if (!live) return;
        setCanDraw(ok);
        if (ok === null) timer = setTimeout(ask, 31_000);
      });
    ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  // 上一次受理过、还没取回来的那一组（App 被回收 / 重开过、或这一进程里轮询断了）：一打开就接着等。只接一次（StrictMode 下 effect 会跑两遍）
  // ★ 只在不会换掉向导里现在的分镜时自动接（resumeReplacesDraft）：人在接回失败之后改过分镜的话，由他点那颗写明「会换回去」的键
  // ★ 只在前三步自动接（第三轮评审抓到）：接回失败之后 groupId 清了，这一进程里关了抽屉再打开也会走到这里 —— 人已经拿着画好的那几格
  //   走到第④⑤步时，resumeGroup 会把他拽回第③步，第⑤步落段（resetGridScene 换掉整份向导）的同时还会往格子里写图。
  //   想接就回第③步点那颗键；第⑤步出片键旁边那句（parkedAtLay）也是这么说的
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const s = useGridDraft.getState();
    const early = s.step === "cast" || s.step === "shots" || s.step === "draw";
    if (early && !s.drawing && !s.groupId && parkedGroupOf() && !resumeReplacesDraft()) void resumeGroup();
  }, []);

  const tier = tierOf(tierId);
  const all = myCards();
  const chars = all.filter((c) => c.type === "character");
  const scenes = all.filter((c) => c.type === "scene");
  /** 选中的人（与 B 同一批，按选的先后）；卡片库里已经删掉的不算 */
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const place = scenes.find((c) => c.id === d.placeId) ?? null;
  /** 挑过的场景卡已经不在卡片库里了（被删了）：重画与出片都带不上它 —— 说一句，不拦 */
  const placeLost = !!d.placeId && !place;
  // 分镜里点到、却不在选上的人物里的人（判据与拦截都在 gridDraftStore.gridCastIssue，这里只画出来、把键灰掉）
  const drawCastIssue = d.step === "draw" ? gridCastIssue(d.shots, cast) : null;
  const focusCastIssue = d.step === "draw" && focus !== null && d.shots[focus] ? gridCastIssue([d.shots[focus]], cast) : null;
  const layCastIssue = d.step === "spec" ? gridCastIssue(pickedShots(d), cast) : null;
  // 挑中的格子里有画面过期的（分镜在画好之后改过）：gridAppendSpecs 一段都不落（判据在 gridDraftStore.gridStaleIssue），这里画出来
  const layStaleIssue = d.step === "spec" ? gridStaleIssue(d) : null;
  /** 落段被拦下的那一句（人没选上 / 画面过期）；null = 能落 */
  const layIssue = layCastIssue ?? layStaleIssue;
  /**
   * 还有一组受理过、没取回来（落盘记录在）：第③步那颗主键换成「接着等上一组」—— 不再开新的一组（gridDraftStore.drawGroup 同一条规矩的兜底）。
   * 读 localStorage，所以在画的时候不问（那时键本来就灰着）
   */
  const parked = d.step === "draw" && !d.drawing ? parkedGroupOf() : null;
  /** 接着等会把向导里现在的分镜换回画那一组时的那一版（人在接回失败之后改过分镜） */
  const parkedReplaces = !!parked && resumeReplacesDraft();
  /** 有一格正在单独画 / 取图：接着等会把那一格清掉、两头抢同一格 —— 那颗键灰着（gridDraftStore.resumeGroup 同一道闸） */
  const panelBusy = d.panels.some((p) => !!p?.busy);
  /**
   * 点开的这一格在上一组里（服务端受理过、同一版分镜、还没画面）：单独画之前先说一句 —— 那一组里这一格的图照样按张结算，
   * 现在单独画就是同一格付两次、上一组那张用不上（第二轮评审抓到）。任务号空着的那种不知道服务端画没画，不说
   */
  const focusInParked =
    !!parked?.id &&
    !parkedReplaces &&
    focus !== null &&
    !d.panels[focus]?.image &&
    // 组图已经报了这一格失败（审核没过之类）：接着等也等不来，那一格自己的报错写着单独重画 —— 别再指人去等（第三轮评审）
    !d.panels[focus]?.err &&
    (parked.cells ?? parked.shots.map((_, i) => i)).includes(focus);
  /**
   * 第⑤步：还有一组没取回来（落盘记录在）。铺成之后 resetGridScene 会撤掉它 —— 出片键旁边先当面说「铺成之后就不再取回」，
   * 想要那几张就先回第③步接着等
   */
  const parkedAtLay = d.step === "spec" ? parkedGroupOf() : null;
  const full = cast.length >= LEAD_CAST_MAX;
  // 每一格都带画面帧（那一格的画面当开头帧）：真人卡在带帧的请求里会被整发拒（account.realFaceIssue 的 framed）
  const faceNote = realFaceIssue(cast, tierId, { framed: true });
  const aspect = d.aspect ?? defaultAspect;
  const dur = clampDuration(d.durationSec ?? GRID_DEFAULT_SEC, tierId);
  /** 按钮上印的价（演示构建写「演示」）：先取成值再进句子 */
  const price = (n: number) => (AI_REAL ? fmtTokens(n) : t`演示`);
  const writePrice = price(CHAT_TURN_TOKENS);
  const shotN = d.shots.length;
  const groupPrice = price(groupQuote(shotN));
  const redrawPrice = price(PANEL_REDRAW_TOKENS);
  const checkPrice = price(PANEL_CHECK_TOKENS);
  const drawn = d.panels.filter((p) => !!p?.image).length;
  const anyPanel = d.panels.some((p) => !!p);
  const stepIdx = GRID_STEPS.indexOf(d.step);
  const go = (step: GridStep) => setGrid({ step, ...(step === "draw" && !d.aspect ? { aspect: defaultAspect } : {}) });
  const sep = t({ message: "、", comment: "列举几个名字时的分隔符" });
  const specs = d.step === "spec" ? gridAppendSpecs(d, { cast, place, tierId, aspect, durationSec: dur }) : [];
  const costs = specs.length ? quote(specs) : [];
  /** 真能落下几段（被 gridCastIssue / gridStaleIssue 拦下时是 0：出片键灰着） */
  const canLay = specs.length > 0;
  // 被拦下时键上照挑的格数说、价钱写「—」：写成「生成这一段（0）」像是不要钱、又数错了段数
  const firstPrice = layIssue ? "—" : price(costs[0] ?? 0);
  const total = costs.reduce((a, b) => a + b, 0);
  const totalPrice = price(total);
  const segN = canLay ? specs.length : layIssue ? d.picks.length : 0;
  /** 句子里的数先取成值再进句子（Lingui 的占位符按名字认） */
  const focusN = (focus ?? 0) + 1;
  const pickN = d.picks.length;
  const leadLine = d.lead;
  const noteText = (n: GridNote): string => {
    if (n.kind === "dropped") {
      const count = n.count;
      return t`模型多写了 ${count} 格，一组最多 ${GRID_SHOTS_MAX} 格，多的没收`;
    }
    if (n.kind === "empty") {
      const count = n.count;
      return t`有 ${count} 格没写画面，没收`;
    }
    const names = n.names.join(sep);
    if (n.kind === "named") return t`有几格的画面写到了「${names}」，已把他们算进那几格画面里的人（不想让他们入镜，就改掉画面里的名字）`;
    return t`「${names}」不在你选的人物里，没算进画面里的人（画面照写）`;
  };
  /** 看一遍发现的问题（gridShots.panelIssues）→ 一句人话 */
  const issueText = (x: PanelIssue): string => {
    if (x.kind === "panels") {
      const got = x.got;
      return t`画成了 ${got} 格拼图`;
    }
    if (x.kind === "duplicate") return t`同一个人出现了两次`;
    const got = x.got;
    const want = x.want;
    return want === 0 ? t`画面里有 ${got} 个人（这一格应该没有人）` : t`画面里有 ${got} 个人（这一格应该是 ${want} 个）`;
  };
  /** 单独摆出来的那一句首字母大写（英文的问题句是按「接在逗号后面」写的小写开头；中文不受影响） */
  const capFirst = (x: string): string => x.charAt(0).toUpperCase() + x.slice(1);
  /** 看出问题的那几格（第几格，从 1 起） */
  const flagged = d.panels.flatMap((p, i) => (p?.image && p.check?.state === "done" && p.check.issues.length ? [i + 1] : []));
  const flaggedList = flagged.join(sep);

  const backBtn = (to: () => void) => (
    <button onClick={to} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
      <Trans>‹ 上一步</Trans>
    </button>
  );
  const tileAspect = aspect === "landscape" ? "aspect-video" : "aspect-[9/16]";

  return (
    <div className="space-y-3">
      {/* 步骤条：与铸段窗「1 选式 › 2 内容 › 3 规格」同一个样子 */}
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
        <span className="mr-1 text-xs font-bold text-slate-100">
          <Trans>🎞 九宫格分镜</Trans>
        </span>
        {GRID_STEPS.map((s, i) => (
          <span key={s} className={i === stepIdx ? "font-bold text-brand" : ""}>
            {i > 0 && <span className="pr-1 text-slate-600">›</span>}
            {i + 1} {t(STEP_LABEL[s])}
          </span>
        ))}
      </div>

      {/* 这台服务器出不了组图（服务端明说没有这一位）：第①步就说，别让人写完分镜才在第③步撞上一颗灰键。没问到（null）不在这里说 */}
      {canDraw === false && d.step !== "draw" && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
          <Trans>这台服务器还不能一次出一组画面（服务端更新之后就有）。</Trans>
        </p>
      )}

      {d.step === "cast" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>选 1~{LEAD_CAST_MAX} 个会出场的人，可以再挑一张场景卡当地点。画面会照着卡上的图画，每一格只画分镜里写到的人。</Trans>
          </p>
          <CastPicker leadBadge={false}>
            {full && (
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>已经选满 {LEAD_CAST_MAX} 个人：官方说一张图里超过 4 个人不稳。</Trans>
              </p>
            )}
            {faceNote && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
            )}
          </CastPicker>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>场景卡（选填，只挑一张）</Trans>
            </div>
            {scenes.length > 0 ? (
              <div className="no-scrollbar flex gap-2 overflow-x-auto">
                {scenes.map((c) => {
                  const on = c.id === d.placeId;
                  return (
                    <button
                      key={c.id}
                      onClick={() => togglePlace(c.id)}
                      className={`w-20 flex-none overflow-hidden rounded-lg border text-left ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                    >
                      <div className="aspect-[3/4] bg-black/40">
                        {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                      </div>
                      <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>卡片库里没有场景卡 —— 不挑也行，地点写进这场戏里。</Trans>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200">
              <Trans>‹ 选法</Trans>
            </button>
            <button
              onClick={() => go("shots")}
              disabled={cast.length === 0}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：写分镜 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "shots" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>这场戏</Trans>
            </div>
            <textarea
              value={d.scene}
              onChange={(e) => setGrid({ scene: e.target.value })}
              maxLength={SCENE_MAX}
              rows={3}
              disabled={d.writing || !!d.drawing}
              placeholder={t`例：清晨的海边灯塔，林夏来给沈舟送一封旧信；沈舟读完信，两人一起看日出`}
              className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
            />
          </div>
          {!shotN ? (
            <div className="space-y-2">
              <button
                onClick={() => void writeShots({ cast: cast.map((c) => c.name), place: place?.name ?? "" })}
                disabled={d.writing || d.scene.trim().length < SCENE_MIN}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {d.writing ? (
                  <>
                    <Spinner size="xs" />
                    <Trans>正在写分镜…</Trans>
                  </>
                ) : (
                  <Trans>✨ AI 写成分镜（{writePrice}）</Trans>
                )}
              </button>
              <p className="text-[10px] leading-relaxed text-slate-500">
                <Trans>
                  写成 {GRID_SHOTS_MIN}~{GRID_SHOTS_MAX} 格：每格写景别、画面（一个瞬间，给画面用）、动作（接下来几秒发生什么，给视频用）和画面里有谁。写完逐格可改、可删。
                </Trans>
              </p>
              <button
                onClick={writeShotsByHand}
                disabled={d.writing || !d.scene.trim()}
                className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
              >
                <Trans>不用 AI，自己一格一格写</Trans>
              </button>
            </div>
          ) : (
            <>
              {d.shotsDemo && (
                <p className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-sky-200">
                  <Trans>演示：这是本地按句号切的，不是模型写的（这台机器没接上 AI）。</Trans>
                </p>
              )}
              {d.shotsAi && d.shotsScene !== d.scene && (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
                  <Trans>这场戏改过了，下面的分镜还是按原来那句写的 —— 点「重新写」按新的写，或者直接在下面改。</Trans>
                </p>
              )}
              {d.notes.map((n, i) => (
                <p key={i} className="text-[10px] leading-relaxed text-slate-500">
                  {noteText(n)}
                </p>
              ))}
              {d.lead && (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  <Trans>整体交代：{leadLine}</Trans>
                </p>
              )}
              <div className="space-y-2">
                {d.shots.map((s, i) => {
                  const n = i + 1;
                  // 画面里写到了名字、「画面里有」却没选的人：模型照着画面画人（10-07 付费验证四遍四遍），who 只决定带谁的卡图
                  const outside = namedOutside(s, cast.map((c) => c.name)).join(sep);
                  return (
                    <div key={i} className="space-y-1.5 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="flex-none rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] font-bold text-slate-200">{n}</span>
                        <input
                          value={s.size}
                          onChange={(e) => editShot(i, { size: e.target.value })}
                          maxLength={8}
                          disabled={!!d.drawing}
                          placeholder={t`景别`}
                          className="w-20 rounded-lg border border-slate-700 bg-black/30 px-2 py-1 text-[11px] text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
                        />
                        <span className="flex-1" />
                        <button
                          onClick={() => removeShot(i)}
                          // 有一格正在单独画时不许删格：写回按格号落，删了前面一格那一格就落到隔壁（gridDraftStore.panelsBusy）
                          disabled={!!d.drawing || panelBusy || shotN <= 1}
                          aria-label={t`删掉这一格`}
                          className="rounded-full px-2 py-0.5 text-[11px] text-slate-500 disabled:opacity-40"
                        >
                          ✕
                        </button>
                      </div>
                      <textarea
                        value={s.picture}
                        onChange={(e) => editShot(i, { picture: e.target.value })}
                        maxLength={80}
                        rows={2}
                        disabled={!!d.drawing}
                        placeholder={t`画面：一个瞬间，谁在哪、什么姿势和表情`}
                        className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
                      />
                      <input
                        value={s.action}
                        onChange={(e) => editShot(i, { action: e.target.value })}
                        maxLength={60}
                        disabled={!!d.drawing}
                        placeholder={t`动作：接下来几秒发生什么（空着的话这一段多半是一张不动的图）`}
                        className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">
                          <Trans>画面里有：</Trans>
                        </span>
                        {cast.map((c) => {
                          const on = s.who.includes(c.name);
                          return (
                            <button
                              key={c.id}
                              onClick={() => editShot(i, { who: on ? s.who.filter((w) => w !== c.name) : [...s.who, c.name] })}
                              disabled={!!d.drawing}
                              className={`rounded-full px-2 py-0.5 text-[10px] disabled:opacity-40 ${on ? "bg-brand font-semibold text-ink" : "bg-black/30 text-slate-400"}`}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                        {s.who.length === 0 && (
                          <span className="text-[10px] text-slate-500">
                            <Trans>（没有人）</Trans>
                          </span>
                        )}
                      </div>
                      {outside && (
                        <p className="text-[10px] leading-relaxed text-amber-200">
                          <Trans>
                            画面里写到了「{outside}」，上面却没选：画的时候多半会把他们画进去、还带不上卡图 —— 要他们入镜就点上，不要就把名字改成「画外的人」。
                          </Trans>
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={addShot}
                  disabled={!!d.drawing || shotN >= GRID_SHOTS_MAX}
                  className="rounded-full bg-slate-700/60 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  <Trans>＋ 加一格</Trans>
                </button>
                <button
                  onClick={() => void writeShots({ cast: cast.map((c) => c.name), place: place?.name ?? "" })}
                  disabled={d.writing || !!d.drawing || panelBusy || d.scene.trim().length < SCENE_MIN}
                  className="flex items-center gap-1.5 rounded-full bg-slate-700/60 px-3 py-1 text-[11px] text-slate-200 disabled:opacity-40"
                >
                  {d.writing ? <Spinner size="xs" /> : null}
                  {anyPanel ? (
                    <Trans>🔄 重新写（{writePrice}，会换掉上面的分镜和已经画好的画面）</Trans>
                  ) : d.shotsAi ? (
                    <Trans>🔄 重新写（{writePrice}，会换掉上面的分镜）</Trans>
                  ) : (
                    <Trans>✨ 让 AI 写（{writePrice}，会换掉上面的分镜）</Trans>
                  )}
                </button>
              </div>
            </>
          )}
          {d.writeErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.writeErr}</p>}
          <div className="flex gap-2">
            {backBtn(() => go("cast"))}
            <button
              onClick={() => go("draw")}
              disabled={!shotN || d.writing || d.shots.some((s) => !s.picture.trim())}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：出画面 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "draw" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>画幅</Trans>
            </div>
            <div className="flex gap-1.5">
              {VIDEO_ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setGrid({ aspect: a.id })}
                  disabled={!!d.drawing || anyPanel}
                  className={`rounded-full px-3 py-1 text-[11px] disabled:opacity-40 ${a.id === aspect ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            {anyPanel && (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                <Trans>画面已经按这个画幅画了（每一格之后就是那一段的开头画面）；要换画幅得整组重出。</Trans>
              </p>
            )}
          </div>

          {/* 分镜里写到的人没选上（App 重开前画的那一组没记下人 / 卡被删了 / 第 1 步取下了谁）：整组重出与那几格的重画都灰着，这里说为什么 */}
          {drawCastIssue && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{drawCastIssue}</p>
          )}
          {placeLost && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>原来挑的那张场景卡已经不在卡片库里了：重画和出片都不再带它。</Trans>
            </p>
          )}

          <div className={`grid gap-1.5 ${aspect === "landscape" ? "grid-cols-2" : "grid-cols-3"}`}>
            {d.shots.map((s, i) => {
              const p = d.panels[i] ?? null;
              const stale = panelStale(p, s);
              const n = i + 1;
              return (
                <button
                  key={i}
                  onClick={() => {
                    setFocus(focus === i ? null : i);
                    setAsk("");
                  }}
                  className={`relative overflow-hidden rounded-lg border bg-black/40 text-left ${tileAspect} ${focus === i ? "border-brand ring-1 ring-brand" : "border-slate-700"}`}
                >
                  {p?.image ? (
                    <img src={p.image} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1.5 text-center">
                      {p?.busy || (d.drawing && !p?.err) ? <Spinner size="xs" /> : null}
                      <span className={`line-clamp-4 text-[9px] leading-snug ${p?.err ? "text-rose-300" : "text-slate-500"}`}>{p?.err ?? s.picture}</span>
                    </div>
                  )}
                  {p?.busy === "redraw" && p.image && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Spinner size="sm" />
                    </span>
                  )}
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-slate-100">{n}</span>
                  {stale && (
                    <span className="absolute bottom-1 left-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                      <Trans>分镜改过</Trans>
                    </span>
                  )}
                  {/* 看一遍发现了问题（人数不对 / 同一个人两次 / 拼图）：点开这一格看原因，要不要重画由人定 */}
                  {!!p?.image && p.check?.state === "done" && p.check.issues.length > 0 && (
                    <span className="absolute right-1 top-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-ink" aria-label={t`这一格可能有问题`}>
                      ⚠
                    </span>
                  )}
                  {!!p?.image && p.check?.state === "running" && (
                    <span className="absolute right-1 top-1">
                      <Spinner size="xs" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 看完一遍的汇总：有问题的格子编号（每格的原因点开看） */}
          {flagged.length > 0 && !d.drawing && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              <Trans>AI 看了一遍画面：第 {flaggedList} 格可能和分镜不一样（点开那一格看原因）。要重画就点开、补一句要求再重画；不重画也能接着往下走。</Trans>
            </p>
          )}

          {focus !== null && d.shots[focus] && (
            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-panel p-3">
              <div className="text-xs font-semibold text-slate-300">
                <Trans>第 {focusN} 格</Trans>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                {d.shots[focus].size ? `${d.shots[focus].size} · ` : ""}
                {d.shots[focus].picture}
              </p>
              {panelStale(d.panels[focus], d.shots[focus]) && (
                <p className="text-[10px] leading-relaxed text-amber-200">
                  <Trans>这一格的分镜在画好之后改过：画面还是按原来那版画的，重画一下才对得上。</Trans>
                </p>
              )}
              {d.panels[focus]?.err && <p className="text-[11px] leading-relaxed text-rose-300">{d.panels[focus]?.err}</p>}
              {/* 看一遍的结论（gridDraftStore.checkPanel）：有问题逐条说；没核对上就说一声（钱上的那句跟着） */}
              {(() => {
                const c = d.panels[focus]?.image ? d.panels[focus]?.check : undefined;
                if (c?.state === "done" && c.issues.length)
                  return (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
                      {capFirst(c.issues.map(issueText).join(sep))}
                    </p>
                  );
                if (c?.state === "failed")
                  return (
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      <Trans>这一格没核对上（AI 没看成），要看就自己看一眼。</Trans>
                      {c.why ? ` ${c.why}` : ""}
                    </p>
                  );
                return null;
              })()}
              {d.panels[focus]?.err && d.panels[focus]?.url && !d.panels[focus]?.image ? (
                <button
                  onClick={() => void refetchPanel(focus)}
                  disabled={!!d.panels[focus]?.busy}
                  className="w-full rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200 disabled:opacity-40"
                >
                  {/* ★ 图付过钱了，取回来之后 AI 还要看一遍（一次对话，gridDraftStore.checkPanel）：别写成「不再收钱」（2.62 发版评审抓到）。
                      这一张之前已经看过的（结论留在这一格 / 落盘记录里）取回来不再看，才是真的不再收钱（refetchWillCheck）。演示构建不看 */}
                  {AI_REAL && refetchWillCheck(focus) ? (
                    <Trans>重新取这一张（图不再收钱；取回后 AI 看一遍 {checkPrice}）</Trans>
                  ) : (
                    <Trans>重新取这一张（不再收钱）</Trans>
                  )}
                </button>
              ) : (
                <>
                  <input
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                    maxLength={60}
                    disabled={!!d.drawing || !!d.panels[focus]?.busy}
                    placeholder={t`补一句要求（选填）：例「沈舟只出现一次」「门是蓝色的」`}
                    className="w-full rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
                  />
                  {focusInParked && (
                    <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
                      <Trans>
                        这一格在上一组里（那一组按画出来的张数结算）：先点下面「接着等上一组」把它取回来，不满意再重画。现在单独画的话，上一组里这一格的图就用不上了。
                      </Trans>
                    </p>
                  )}
                  <button
                    onClick={() => void redrawPanel(focus, { cast, place, ask })}
                    // ★ 不看 canDraw：单画一格走单张出图（drawGridPanel），与服务端能不能出组图无关
                    disabled={!!d.drawing || !!d.panels[focus]?.busy || !!focusCastIssue}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    {d.panels[focus]?.busy === "redraw" ? <Spinner size="xs" /> : null}
                    {d.panels[focus]?.image ? <Trans>🖌 重画这一格（{redrawPrice}）</Trans> : <Trans>🖌 单独画这一格（{redrawPrice}）</Trans>}
                  </button>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    <Trans>
                      单独画一张：只带这一格里的人的卡图；没有人的格子拿这一组里另一格定画风、一张人物图都不带。与整组的画风尽量一致，但不保证一模一样。画完 AI 会看一遍（价钱里含这一次）。
                    </Trans>
                  </p>
                </>
              )}
            </div>
          )}

          {canDraw === false && !parked && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              <Trans>这台服务器还不能一次出一组画面（服务端更新之后就有）。</Trans>
            </p>
          )}
          {/* ↑ 第③步那一句就是开头那一条的同一句话：这一步的键灰着，得在键旁边再说一次。↓ 没问到（null）≠ 没有：照 serverCaps 的口径放行，只说一声 */}
          {canDraw === null && !parked && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>暂时没问到服务器能不能一次出一组画面（网络不稳），过一会儿会再问；也可以直接点，服务器不支持会直接说。</Trans>
            </p>
          )}
          {d.drawing && (
            <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-slate-300">
              <Spinner size="xs" />
              <span>{d.drawing}</span>
            </p>
          )}
          {d.drawErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.drawErr}</p>}
          {d.drawNote && !d.drawing && <p className="text-[10px] leading-relaxed text-slate-400">{d.drawNote}</p>}
          {parked ? (
            <>
              {/* 还有一组受理过、没取回来：不开新的一组（那一组按张付过钱），先接回来 —— 规矩在 gridDraftStore.drawGroup / resumeGroup */}
              <button
                onClick={() => void resumeGroup()}
                disabled={!!d.drawing || d.writing || panelBusy}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                <Trans>⏳ 接着等上一组（图不再收钱）</Trans>
              </button>
              <p className="text-[10px] leading-relaxed text-slate-500">
                {parked.id ? (
                  <Trans>上一组服务端受理过、画面还没取回来：服务端照样在画，画好的图留 24 小时。先接回来，再决定要不要整组重出。</Trans>
                ) : (
                  <Trans>上一组发出去没收到回包，还不知道服务端收没收到：先问一下（不收钱），收到了就接着取回来，没收到就可以重新画。</Trans>
                )}
                {parkedReplaces ? (
                  <>
                    {" "}
                    <Trans>接回来会换回画那一组时的分镜：之后改过的分镜和单独画的格子会被换掉。</Trans>
                  </>
                ) : null}
                {panelBusy ? (
                  <>
                    {" "}
                    <Trans>有一格正在画，画完再接。</Trans>
                  </>
                ) : null}
              </p>
              {/* ★ 出口（第二轮评审抓到）：只有「接着等」一条路的话，人重写过的分镜只能被换回去，问不到服务端的那种还会把出一组挡上 23 小时 */}
              <button
                onClick={() => setDiscardAsk(true)}
                disabled={!!d.drawing || d.writing}
                className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
              >
                <Trans>放弃上一组，按现在的分镜重新画</Trans>
              </button>
              {discardAsk && (
                <ConfirmDialog
                  title={t`放弃上一组画面？`}
                  confirmLabel={t`放弃`}
                  danger
                  onConfirm={() => {
                    discardParkedGroup();
                    setDiscardAsk(false);
                  }}
                  onClose={() => setDiscardAsk(false)}
                >
                  {parked.id ? (
                    <Trans>
                      上一组服务端受理过：它照样会画完，照样按画出来的张数收钱（不退）。放弃之后这里就不再取回那几张图。之后可以按现在的分镜重新画一组（另外收钱）；上一组还没画完的话，要等它画完才能开新的一组。
                    </Trans>
                  ) : (
                    <Trans>
                      上一组发出去没收到回包：要是服务端其实收到了，它照样会画完，照样按画出来的张数收钱（不退）。放弃之后这里就不再去问、也不再取回。之后可以按现在的分镜重新画一组（另外收钱）；服务端那一组还在画的话，要等它画完才能开新的一组。
                    </Trans>
                  )}
                </ConfirmDialog>
              )}
            </>
          ) : (
            <button
              onClick={() => void drawGroup({ cast, place })}
              disabled={!!d.drawing || d.writing || panelBusy || !shotN || canDraw === false || canDraw === "asking" || !!drawCastIssue}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {anyPanel ? (
                <Trans>🔄 整组重出（{shotN} 格，最多 {groupPrice}，会换掉现在这几格）</Trans>
              ) : (
                <Trans>🎞 画出这一组（{shotN} 格，最多 {groupPrice}）</Trans>
              )}
            </button>
          )}
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>
              一次画出整组：人物与光线前后一致。没有人的格子和特写不放进这一组（放进去容易画进别人），整组画完再一格一格单独画。每画好一格，AI
              会看一遍几个人、有没有画重、是不是拼图，有问题的格子会标出来，由你决定要不要重画。按实际画出来的张数收钱，没画出来的那几格不收。一组要几分钟，可以先离开，画好了会提醒你。
            </Trans>
          </p>
          <div className="flex gap-2">
            {backBtn(() => go("shots"))}
            <button
              onClick={() => go("pick")}
              disabled={!drawn || !!d.drawing}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：挑格子 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "pick" && (
        <>
          <p className="text-[11px] leading-relaxed text-slate-400">
            <Trans>按顺序点要拍的格子：点的先后就是成段的先后。每一格变成一段，那一格的画面当这一段的开头。</Trans>
          </p>
          <div className={`grid gap-1.5 ${aspect === "landscape" ? "grid-cols-2" : "grid-cols-3"}`}>
            {d.shots.map((s, i) => {
              const p = d.panels[i] ?? null;
              const at = d.picks.indexOf(i);
              const n = i + 1;
              const order = at + 1;
              // 与第③步、落段的闸同一个判据（gridDraftStore.panelStale）：画面是按改之前那版分镜画的（挑上了也落不了段，gridStaleIssue）
              const stale = panelStale(p, s);
              return (
                <button
                  key={i}
                  onClick={() => togglePick(i)}
                  disabled={!p?.image}
                  className={`relative overflow-hidden rounded-lg border bg-black/40 disabled:opacity-30 ${tileAspect} ${at >= 0 ? "border-brand ring-2 ring-brand" : "border-slate-700"}`}
                >
                  {p?.image ? (
                    <img src={p.image} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center p-1 text-center text-[9px] text-slate-500">{s.picture}</span>
                  )}
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-slate-100">{n}</span>
                  {at >= 0 && (
                    <span className="absolute right-1 top-1 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-ink">
                      <Trans>第 {order} 段</Trans>
                    </span>
                  )}
                  {stale && (
                    <span className="absolute bottom-1 left-1 rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-bold text-ink">
                      <Trans>分镜改过</Trans>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="flex-1">
              {pickN ? <Trans>已挑 {pickN} 格</Trans> : <Trans>还没挑</Trans>}
            </span>
            {d.picks.length > 0 && (
              <button onClick={() => setGrid({ picks: [] })} className="text-[11px] text-slate-500 underline underline-offset-2">
                <Trans>清空</Trans>
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {backBtn(() => go("draw"))}
            <button
              onClick={() => go("spec")}
              disabled={!d.picks.length}
              className="flex-1 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              <Trans>下一步：出片 ›</Trans>
            </button>
          </div>
        </>
      )}

      {d.step === "spec" && (
        <>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-slate-300">
              <Trans>每段时长</Trans>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {durationChoices(tierId)
                .filter((sec) => sec >= tier.minSec)
                .map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setGrid({ durationSec: sec })}
                    className={`rounded-full px-3 py-1 text-[11px] ${sec === dur ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {sec}s
                  </button>
                ))}
            </div>
          </div>
          {/* 挑中的格子里有人没选上 / 画面过期：gridAppendSpecs 一段都不落（出片键因此灰着），这里说为什么 */}
          {layIssue ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{layIssue}</p>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-400">
              {tier.refImg ? (
                <Trans>{segN} 段 · 每段拿那一格的画面当开头，画面里的人的图一起给视频模型；不接上一段的结尾（每一格本来就是新的镜头）</Trans>
              ) : (
                <Trans>{segN} 段 · 每段拿那一格的画面当首帧；这一档收不了人物图，人像全看那一格画面</Trans>
              )}
            </p>
          )}
          {placeLost && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>原来挑的那张场景卡已经不在卡片库里了：重画和出片都不再带它。</Trans>
            </p>
          )}
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          {canLay && <TokenCost tokens={costs[0] ?? 0} />}
          {canLay && segN > 1 && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>
                {segN} 段一共约 {totalPrice}。只先出第 1 段：后面几段在流水线上按顺序一段一段出，每段出之前会再报一次价 —— 第 1 段看着不对，后面的就不用花钱。
              </Trans>
            </p>
          )}
          {/* 还有一组没取回来：铺成之后就撤掉它（gridDraftStore.resetGridScene），先当面说 —— 那一组的钱照样按画出来的张数结算 */}
          {parkedAtLay && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              {parkedAtLay.id ? (
                <Trans>上一组画面还没取回来（服务端按画出来的张数结算）：铺成之后就不再取回了。想要那几张，先回第 3 步点「接着等上一组」。</Trans>
              ) : (
                <Trans>
                  上一组发出去没收到回包、还没问到服务端收没收到：铺成之后就不再去问了（服务端要是收到了，照样按画出来的张数结算）。想先问一下，回第 3 步点「接着等上一组」。
                </Trans>
              )}
            </p>
          )}
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {/* ★ 别说「可以先铺成」：只铺成也要过 flowStore.appendIssue，它拒的正是同一个 busy（同一时刻只炼一段），所以下面那颗也灰掉（2.62 发版评审抓到） */}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn(() => go("pick"))}
            <button
              onClick={() => onFinish(specs, true)}
              disabled={busy || !canLay}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {segN > 1 ? <Trans>⚡ 铺成 {segN} 段，先出第 1 段（{firstPrice}）</Trans> : <Trans>⚡ 生成这一段（{firstPrice}）</Trans>}
            </button>
          </div>
          <button
            onClick={() => onFinish(specs, false)}
            disabled={busy || !canLay}
            className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
          >
            {segN > 1 ? <Trans>只铺成这 {segN} 段，先不出片</Trans> : <Trans>只铺成这一段，先不出片</Trans>}
          </button>
        </>
      )}
    </div>
  );
}
