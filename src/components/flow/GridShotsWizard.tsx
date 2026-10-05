// 跟着做 C「九宫格分镜」的向导 —— 工坊铸段窗与画布「＋ 加一段」**共用的唯一实现**（2026-10-05 第三期，
// 方案 docs/guided-modes-design.md §二 C、§七；主人 10-05「用组图，做第三期 C」）。
//
// 五步：① 人物和场景（与 B 同一批人，可再挑一张场景卡）→ ② 写这场戏，AI 写成 4~9 格分镜（景别 / 画面 / 动作 / 画面里有谁，逐格可改）
//   → ③ 一次画出整组画面（组图，摆成九宫格；单格可重画）→ ④ 按顺序挑几格 → ⑤ 每格变成一段：那一格的画面当开头帧，逐段出片。
// ★ 状态全在 studio/gridDraftStore（人物在 leadDraftStore），这里只画。落段与出片由宿主做（onFinish）：
//   工坊走 studioStore.layGridNodes + genNodeVideo，画布走 flowStore.appendSpecs + genNode —— 两面原有的出片入口，不另写一份。
// ★ 报价由宿主给（quote）：宿主拿 flowStore.appendSpecsQuote 照着「真会落下的那几段」逐段算（gridAppendSpecs 拼的同一份），
//   与 genNode 真扣同一把尺。画面那一笔（组图 / 单格重画）按张，价钱在 gridDraftStore 一处。
// ★ 只出第一段：每段都有自己的开头画面，但「炼出本段才开下一段」照旧（flowStore 的顺序门禁）—— 第一段人物就不对的话，后面几段不用花钱。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { AI_REAL, groupsAvailable } from "../../ai";
import { myCards } from "../../data/account";
import { CHAT_TURN_TOKENS, clampDuration, durationChoices, fmtTokens, realFaceIssue, tierOf } from "../../data/economy";
import { GRID_DEFAULT_SEC, GRID_SHOTS_MAX, GRID_SHOTS_MIN, shotKey, type GridNote } from "../../data/gridShots";
import { LEAD_CAST_MAX, SCENE_MAX, SCENE_MIN } from "../../data/sceneShots";
import { useAccountVersion } from "../../hooks/useAccount";
import type { AppendSpec } from "../../studio/flowStore";
import {
  GRID_STEPS,
  PANEL_REDRAW_TOKENS,
  addShot,
  drawGroup,
  editShot,
  gridAppendSpecs,
  groupQuote,
  parkedGroupOf,
  redrawPanel,
  refetchPanel,
  removeShot,
  resumeGroup,
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
  /** 这台机器出得了组图吗（打包看服务端的能力位）；null = 还在问 */
  const [canDraw, setCanDraw] = useState<boolean | null>(null);
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
    void groupsAvailable().then((ok) => live && setCanDraw(ok));
    return () => {
      live = false;
    };
  }, []);
  // 上一次受理过、还没取回来的那一组（App 被回收 / 重开过）：一打开就接着等。只接一次（StrictMode 下 effect 会跑两遍）
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const s = useGridDraft.getState();
    if (!s.drawing && !s.groupId && parkedGroupOf()) void resumeGroup();
  }, []);

  const tier = tierOf(tierId);
  const all = myCards();
  const chars = all.filter((c) => c.type === "character");
  const scenes = all.filter((c) => c.type === "scene");
  /** 选中的人（与 B 同一批，按选的先后）；卡片库里已经删掉的不算 */
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const place = scenes.find((c) => c.id === d.placeId) ?? null;
  const full = cast.length >= LEAD_CAST_MAX;
  // 每一格都带画面帧（那一格的画面当开头帧）：真人卡在带帧的请求里会被整发拒（economy.realFaceIssue 的 framed）
  const faceNote = realFaceIssue(cast, tierId, { framed: true });
  const aspect = d.aspect ?? defaultAspect;
  const dur = clampDuration(d.durationSec ?? GRID_DEFAULT_SEC, tierId);
  /** 按钮上印的价（演示构建写「演示」）：先取成值再进句子 */
  const price = (n: number) => (AI_REAL ? fmtTokens(n) : t`演示`);
  const writePrice = price(CHAT_TURN_TOKENS);
  const shotN = d.shots.length;
  const groupPrice = price(groupQuote(shotN));
  const redrawPrice = price(PANEL_REDRAW_TOKENS);
  const drawn = d.panels.filter((p) => !!p?.image).length;
  const anyPanel = d.panels.some((p) => !!p);
  const stepIdx = GRID_STEPS.indexOf(d.step);
  const go = (step: GridStep) => setGrid({ step, ...(step === "draw" && !d.aspect ? { aspect: defaultAspect } : {}) });
  const sep = t({ message: "、", comment: "列举几个名字时的分隔符" });
  const specs = d.step === "spec" ? gridAppendSpecs(d, { cast, place, tierId, aspect, durationSec: dur }) : [];
  const costs = specs.length ? quote(specs) : [];
  const firstPrice = price(costs[0] ?? 0);
  const total = costs.reduce((a, b) => a + b, 0);
  const totalPrice = price(total);
  const segN = specs.length;
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
    return t`「${names}」不在你选的人物里，没算进画面里的人（画面照写）`;
  };

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

      {/* 这台服务器出不了组图（服务端还没更新）：第①步就说，别让人写完分镜才在第③步撞上一颗灰键 */}
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
                          disabled={!!d.drawing || shotN <= 1}
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
                  disabled={d.writing || !!d.drawing || d.scene.trim().length < SCENE_MIN}
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

          <div className={`grid gap-1.5 ${aspect === "landscape" ? "grid-cols-2" : "grid-cols-3"}`}>
            {d.shots.map((s, i) => {
              const p = d.panels[i] ?? null;
              const stale = !!p?.image && p.key !== shotKey(s);
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
                </button>
              );
            })}
          </div>

          {focus !== null && d.shots[focus] && (
            <div className="space-y-2 rounded-xl border border-slate-700/70 bg-panel p-3">
              <div className="text-xs font-semibold text-slate-300">
                <Trans>第 {focusN} 格</Trans>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                {d.shots[focus].size ? `${d.shots[focus].size} · ` : ""}
                {d.shots[focus].picture}
              </p>
              {d.panels[focus]?.image && d.panels[focus]?.key !== shotKey(d.shots[focus]) && (
                <p className="text-[10px] leading-relaxed text-amber-200">
                  <Trans>这一格的分镜在画好之后改过：画面还是按原来那版画的，重画一下才对得上。</Trans>
                </p>
              )}
              {d.panels[focus]?.err && <p className="text-[11px] leading-relaxed text-rose-300">{d.panels[focus]?.err}</p>}
              {d.panels[focus]?.err && d.panels[focus]?.url && !d.panels[focus]?.image ? (
                <button
                  onClick={() => void refetchPanel(focus)}
                  disabled={!!d.panels[focus]?.busy}
                  className="w-full rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200 disabled:opacity-40"
                >
                  <Trans>重新取这一张（不再收钱）</Trans>
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
                  <button
                    onClick={() => void redrawPanel(focus, { cast, place, ask })}
                    disabled={!!d.drawing || !!d.panels[focus]?.busy || !canDraw}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand/90 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    {d.panels[focus]?.busy === "redraw" ? <Spinner size="xs" /> : null}
                    {d.panels[focus]?.image ? <Trans>🖌 重画这一格（{redrawPrice}）</Trans> : <Trans>🖌 单独画这一格（{redrawPrice}）</Trans>}
                  </button>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    <Trans>单独画一张：只带这一格里的人的卡图（没有人就只带场景卡），与整组的画风尽量一致，但不保证一模一样。</Trans>
                  </p>
                </>
              )}
            </div>
          )}

          {canDraw === false && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
              <Trans>这台服务器还不能一次出一组画面（服务端更新之后就有）。</Trans>
            </p>
          )}
          {/* ↑ 第③步那一句就是开头那一条的同一句话：这一步的键灰着，得在键旁边再说一次 */}
          {d.drawing && (
            <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-slate-300">
              <Spinner size="xs" />
              <span>{d.drawing}</span>
            </p>
          )}
          {d.drawErr && <p className="text-[11px] leading-relaxed text-rose-300">{d.drawErr}</p>}
          {d.drawNote && !d.drawing && <p className="text-[10px] leading-relaxed text-slate-400">{d.drawNote}</p>}
          <button
            onClick={() => void drawGroup({ cast, place })}
            disabled={!!d.drawing || d.writing || !shotN || !canDraw}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            {anyPanel ? (
              <Trans>🔄 整组重出（{shotN} 格，最多 {groupPrice}，会换掉现在这几格）</Trans>
            ) : (
              <Trans>🎞 画出这一组（{shotN} 格，最多 {groupPrice}）</Trans>
            )}
          </button>
          <p className="text-[10px] leading-relaxed text-slate-500">
            <Trans>一次画出整组：人物与光线前后一致。按实际画出来的张数收钱，没画出来的那几格不收。一组要几分钟，可以先离开，画好了会提醒你。</Trans>
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
          <p className="text-[11px] leading-relaxed text-slate-400">
            {tier.refImg ? (
              <Trans>{segN} 段 · 每段拿那一格的画面当开头，画面里的人的图一起给视频模型；不接上一段的结尾（每一格本来就是新的镜头）</Trans>
            ) : (
              <Trans>{segN} 段 · 每段拿那一格的画面当首帧；这一档收不了人物图，人像全看那一格画面</Trans>
            )}
          </p>
          {faceNote && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">{faceNote}</p>
          )}
          <TokenCost tokens={costs[0] ?? 0} />
          {segN > 1 && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>
                {segN} 段一共约 {totalPrice}。只先出第 1 段：后面几段在流水线上按顺序一段一段出，每段出之前会再报一次价 —— 第 1 段看着不对，后面的就不用花钱。
              </Trans>
            </p>
          )}
          {err && <p className="text-[11px] leading-relaxed text-rose-300">{err}</p>}
          {busy && (
            <p className="text-[10px] leading-relaxed text-slate-500">
              <Trans>有一段正在生成中，等它跑完再出（可以先铺成这几段）。</Trans>
            </p>
          )}
          <div className="flex gap-2">
            {backBtn(() => go("pick"))}
            <button
              onClick={() => onFinish(specs, true)}
              disabled={busy || !segN}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {segN > 1 ? <Trans>⚡ 铺成 {segN} 段，先出第 1 段（{firstPrice}）</Trans> : <Trans>⚡ 生成这一段（{firstPrice}）</Trans>}
            </button>
          </div>
          <button
            onClick={() => onFinish(specs, false)}
            disabled={!segN}
            className="text-[11px] text-slate-500 underline underline-offset-2 disabled:opacity-40"
          >
            {segN > 1 ? <Trans>只铺成这 {segN} 段，先不出片</Trans> : <Trans>只铺成这一段，先不出片</Trans>}
          </button>
        </>
      )}
    </div>
  );
}
