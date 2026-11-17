// 快速模式：从一句想法到成片的五步向导（2026-11-16，设计稿 docs/quick-mode-design.md）。
//
// 步骤：① 想法 → 剧本 + 分镜（一次 chat）→ ② 角色（复用 CastPicker：挑已有 / 现做 / 传图做）
// → ③ 场景（挑一张场景卡，可跳过）→ ④ 预览（每段一个节点：首帧 + 便宜档样片，不满意就重抽）
// → ⑤ 成片（勾中的段升到 1080p，然后组稿进剪辑）。
//
// ★ 这一页**不新写任何出片实现**：铺节点走 structuredSkills.shotPlanNodes + flowStore.seed，
//   出片走 flowStore.genNode，组稿走 hooks/useFlowActions.toCut（与工作流、工坊、简约同一份）。
// ★ 状态在 studio/quickDraftStore（剧本与想法是花了钱的，卸载不能丢）；角色在 leadDraftStore
//   （与 B / C / L 同一批人）。
// ★ 铺节点是「整表换掉 nodes」的入口：脏了先摆 DiscardFlowDialog（与套模板同一张卡），
//   成了再断旧草稿（newWorkDraft）—— 三件事缺一不可，见 CLAUDE.md 那条。
import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useNavigate } from "react-router";
import PageHeader from "../components/PageHeader";
import StepDots from "../components/StepDots";
import CastPicker from "../components/flow/CastPicker";
import DiscardFlowDialog from "../components/flow/DiscardFlowDialog";
import { installSharedCard, myCards } from "../data/account";
import { listSharedCards, type ApiSharedCard } from "../api/branch";
import { CHAT_TURN_TOKENS, fmtTokens, priceTag } from "../data/economy";
import { useFlow, flowDirty, nodeCost, nodeDone, chosenOf } from "../studio/flowStore";
import { shotPlanNodes } from "../studio/structuredSkills";
import { useLeadDraft } from "../studio/leadDraftStore";
import { QUICK_STEPS, resetQuick, runIdea, setQuick, useQuickDraft, type QuickStep } from "../studio/quickDraftStore";
import { useFlowActions } from "../hooks/useFlowActions";
import { useStudio } from "../studio/studioStore";
import type { Card } from "../types";

/** 预览用便宜档（480p「草稿」）；定稿用哪一档见页内 FINAL_TIER。 */
const PREVIEW_TIER = "draft";
/** 1080p 那一档（价目表里 1080p 只有电影级 ultra；高清是 720p）。 */
const FINAL_TIER = "ultra";
const STEP_LABEL: Record<QuickStep, MessageDescriptor> = {
  idea: msg`想法`,
  cast: msg`角色`,
  scene: msg`场景`,
  preview: msg`预览`,
  cut: msg`成片`,
};

export default function QuickModePage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const d = useQuickDraft();
  const lead = useLeadDraft();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const busy = useFlow((s) => s.busy);
  const flowErr = useFlow((s) => s.err);
  const { toCut } = useFlowActions();
  const [drawing, setDrawing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** 正在确认重抽的那一段（重抽会覆盖已经出过的那条样片，先问一句） */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [askDiscard, setAskDiscard] = useState(false);
  /** 市场里的公开场景卡（点一下装进自己的库并选中） */
  const [market, setMarket] = useState<ApiSharedCard[] | null>(null);
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketErr, setMarketErr] = useState("");

  // 挂载标记：剧本那一发十几秒，人走了不弹通知（与 songDraftStore 同一条）
  useEffect(() => {
    setQuick({ mounted: true });
    return () => setQuick({ mounted: false });
  }, []);

  const idx = QUICK_STEPS.indexOf(d.step);
  const chars = myCards().filter((c) => c.type === "character");
  const scenes = myCards().filter((c) => c.type === "scene");
  const cast = lead.castIds.map((id) => chars.find((c) => c.id === id)).filter((c): c is Card => !!c);
  const place = scenes.find((c) => c.id === d.placeId) ?? null;
  const plan = d.plan;

  /** 把分镜铺成流水线（整表换 nodes）。脏了先问。 */
  function seedFlow() {
    if (!plan) return;
    const run = () => {
      const materials = [...cast, ...(place ? [place] : [])];
      const list = shotPlanNodes(plan, { tierId: PREVIEW_TIER, aspect: "portrait", materials });
      if (!useFlow.getState().seed(list, { mode: "workflow", origin: "studio" })) {
        setQuick({ err: useFlow.getState().err || t`没铺成：流水线还是那条，先处理掉上面那条错误` });
        return;
      }
      useStudio.getState().newWorkDraft(); // 整表换过 = 与旧草稿脱钩（成了才断）
      setQuick({ step: "preview", err: "" });
    };
    if (flowDirty()) setAskDiscard(true);
    else run();
  }

  /** 逐段出片（同一时刻只能炼一段，所以排队跑）。 */
  async function drawAll() {
    setDrawing(true);
    try {
      for (const n of useFlow.getState().nodes) {
        if (nodeDone(n) || n.status === "generating") continue;
        await useFlow.getState().genNode(n.id);
      }
    } finally {
      setDrawing(false);
    }
  }

  /** 勾中的段升到 1080p：改这一段的档，再按同一份方案重出（画会变，文案不许说「还原」）。 */
  async function upgradePicked() {
    setDrawing(true);
    try {
      for (const n of useFlow.getState().nodes) {
        if (!picked.has(n.id)) continue;
        useFlow.getState().updateNode(n.id, { videoTier: FINAL_TIER });
        await useFlow.getState().genNode(n.id);
      }
    } finally {
      setDrawing(false);
    }
  }

  /** 从创意工坊的公开卡里挑场景卡（只取 type=scene；装上就选中） */
  async function openMarket() {
    setMarketBusy(true);
    setMarketErr("");
    try {
      const all = await listSharedCards("", 40);
      setMarket(all.filter((c) => c.type === "scene"));
    } catch (e) {
      setMarketErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMarketBusy(false);
    }
  }
  async function takeMarketCard(id: string) {
    setMarketErr("");
    try {
      const mine = myCards().find((c) => c.id === id);
      if (mine) {
        setQuick({ placeId: mine.id });
        return;
      }
      const got = await installSharedCard(id);
      if (got) setQuick({ placeId: got.id });
      else setMarketErr(t`这张卡没装成，再试一次`);
    } catch (e) {
      setMarketErr(e instanceof Error ? e.message : String(e));
    }
  }

  const err = d.err || flowErr;
  const allDone = nodes.length > 0 && nodes.every(nodeDone);
  const priceOf = (i: number, tierOverride?: string) => nodeCost(nodes, i, mode, tierOverride);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8">
      <PageHeader
        sticky
        inset
        onBack={() => (idx === 0 ? navigate(-1) : setQuick({ step: QUICK_STEPS[idx - 1] }))}
        title={t`快速模式`}
      />
      <StepDots
        className="mb-4"
        current={idx}
        steps={QUICK_STEPS.map((s) => ({ label: t(STEP_LABEL[s]) }))}
        canPick={(i) => i < idx}
        onPick={(i) => setQuick({ step: QUICK_STEPS[i] })}
      />

      {err && (
        <p className="mb-3 rounded-lg border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-[11px] leading-relaxed text-danger-300">
          {err}
        </p>
      )}

      {/* ① 想法 → 剧本 + 分镜 */}
      {d.step === "idea" && (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-slate-300"><Trans>先说说你想拍什么</Trans></p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>讲清谁、在哪儿、发生了什么、什么调子。AI 会把它拆成几段分镜，每段之后单独出片。</Trans>
          </p>
          <textarea
            value={d.idea}
            onChange={(e) => setQuick({ idea: e.target.value })}
            rows={6}
            maxLength={2000}
            placeholder={t`例：一个女孩在老城区的雨天里找一只走丢的猫，最后在天台找到，天刚好放晴`}
            className="mt-3 w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={() => void runIdea(PREVIEW_TIER)}
            disabled={d.writing || !d.idea.trim()}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
          >
            {d.writing ? t`正在写剧本、拆镜头…` : t`生成剧本与分镜（${priceTag(CHAT_TURN_TOKENS)}）`}
          </button>

          {plan && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] text-slate-400">
                <Trans>拆成 {plan.segments.length} 段 · 可以再改想法重新拆</Trans>
              </div>
              <ol className="space-y-2">
                {plan.segments.map((sg, i) => (
                  <li key={i} className="rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-100">{sg.title}</span>
                      <span className="flex-none text-[10px] text-slate-500">{Math.round(sg.durationSec)}s</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{sg.plot}</p>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => setQuick({ step: "cast" })}
                className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
              >
                <Trans>下一步：定角色 ›</Trans>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ② 角色 */}
      {d.step === "cast" && (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-slate-300"><Trans>这一段里有谁？</Trans></p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>挑已有的角色卡；没有的话在下面现做一个，或去「自己传图做卡片」用照片做（真人要先认证）。</Trans>
          </p>
          <div className="mt-3">
            <CastPicker />
          </div>
          <span className="flex-1" />
          <button
            onClick={() => setQuick({ step: "scene" })}
            disabled={cast.length === 0}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
          >
            <Trans>下一步：定场景 ›</Trans>
          </button>
        </div>
      )}

      {/* ③ 场景 */}
      {d.step === "scene" && (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-slate-300"><Trans>故事发生在哪儿？</Trans></p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>挑一张场景卡（只挑一张）；没有合适的可以跳过，画面按分镜里的文字来。</Trans>
          </p>
          {scenes.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {scenes.map((c) => {
                const on = d.placeId === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setQuick({ placeId: on ? null : c.id })}
                    className={`overflow-hidden rounded-lg border text-left ${on ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-80"}`}
                  >
                    <div className="aspect-square bg-black/40">
                      {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                    </div>
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-slate-700/70 bg-panel p-3 text-[11px] leading-relaxed text-slate-400">
              <Trans>卡片库里还没有场景卡 —— 去创意工坊做一张，或直接跳过。</Trans>
            </p>
          )}
          <button
            onClick={() => navigate("/custom-card")}
            className="mt-2 self-start rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-slate-700"
          >
            <Trans>＋ 用文字 / 图片做一张场景卡</Trans>
          </button>
          <button
            onClick={() => navigate("/workshop")}
            className="mt-1.5 self-start rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-slate-700"
          >
            <Trans>去创意工坊逛公开场景卡</Trans>
          </button>
          {/* 市场里的公开场景卡：点一下装进自己的库并选中（listSharedCards + installSharedCard，都是既有实现） */}
          <button
            onClick={() => (market ? setMarket(null) : void openMarket())}
            disabled={marketBusy}
            className="mt-1.5 self-start rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-300 ring-1 ring-slate-700 disabled:opacity-40"
          >
            {marketBusy ? t`正在取市场里的场景卡…` : market ? t`收起市场` : t`从市场挑一张公开场景卡`}
          </button>
          {marketErr && (
            <p className="mt-2 rounded-lg border border-danger-500/40 bg-danger-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-danger-300">
              {marketErr}
            </p>
          )}
          {market &&
            (market.length ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {market.map((c) => (
                  <button
                    key={c._id ?? c.name}
                    onClick={() => c._id && void takeMarketCard(c._id)}
                    className={`overflow-hidden rounded-lg border text-left ${d.placeId === c._id ? "border-brand ring-1 ring-brand" : "border-slate-700 opacity-85"}`}
                  >
                    <div className="aspect-square bg-black/40">
                      {c.cover && <img src={c.cover} alt="" className="h-full w-full object-cover" draggable={false} />}
                    </div>
                    <div className="truncate px-1 py-0.5 text-[9px] text-slate-200">{c.name}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-[10px] text-slate-500">
                <Trans>市场里还没有公开的场景卡</Trans>
              </p>
            ))}
          <span className="flex-1" />
          <button
            onClick={seedFlow}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
          >
            <Trans>铺好流水线，开始出预览 ›</Trans>
          </button>
          <button onClick={() => setQuick({ placeId: null, step: "preview" })} className="mt-2 text-[11px] text-slate-500">
            <Trans>不用场景卡</Trans>
          </button>
        </div>
      )}

      {/* ④ 预览：逐段出片 / 抽卡；⑤ 勾中的升 1080p */}
      {d.step === "preview" && (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-slate-300"><Trans>逐段看样片，不满意的重抽</Trans></p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>先用便宜档（480p）出样片；勾中的段之后会按 1080p 重出，画面会有变化。</Trans>
          </p>
          <ol className="mt-3 space-y-2">
            {nodes.map((n, i) => {
              const p = chosenOf(n);
              const done = nodeDone(n);
              const on = picked.has(n.id);
              // 首帧 / 样片：首帧是画出来的那一张，样片是便宜档出的视频（mock: 开头的是占位，不能播）
              const poster = p?.firstFrame || "";
              const clip = p?.videoUrl && !p.videoUrl.startsWith("mock:") ? p.videoUrl : "";
              return (
                <li key={n.id} className="rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-none text-[10px] text-slate-500">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">{p?.title || t`第 ${i + 1} 段`}</span>
                    <span className={`flex-none text-[10px] ${done ? "text-brand" : "text-slate-500"}`}>
                      {n.status === "generating" ? t`生成中…` : done ? t`已出样片` : t`未出`}
                    </span>
                  </div>
                  {(poster || clip) && (
                    <div className="mt-1.5 overflow-hidden rounded-lg bg-black/40">
                      {clip ? (
                        <video src={clip} poster={poster || undefined} controls playsInline className="w-full" />
                      ) : (
                        <img src={poster} alt="" className="w-full" draggable={false} />
                      )}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    {done && confirming !== n.id && (
                      <button
                        onClick={() => setConfirming(n.id)}
                        disabled={busy || drawing}
                        className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700 disabled:opacity-40"
                      >
                        {t`重抽（${fmtTokens(priceOf(i))}）`}
                      </button>
                    )}
                    {done && confirming === n.id && (
                      <>
                        <button
                          onClick={() => {
                            setConfirming(null);
                            void useFlow.getState().genNode(n.id);
                          }}
                          disabled={busy || drawing}
                          className="rounded-full bg-brand px-3 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-40"
                        >
                          {t`确认重抽（${fmtTokens(priceOf(i))}，覆盖这一条）`}
                        </button>
                        <button onClick={() => setConfirming(null)} className="px-1 text-[11px] text-slate-500">
                          <Trans>取消</Trans>
                        </button>
                      </>
                    )}
                    {!done && (
                      <button
                        onClick={() => void useFlow.getState().genNode(n.id)}
                        disabled={busy || drawing}
                        className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700 disabled:opacity-40"
                      >
                        {t`出片（${fmtTokens(priceOf(i))}）`}
                      </button>
                    )}
                    {done && (
                      <button
                        onClick={() =>
                          setPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(n.id)) next.delete(n.id);
                            else next.add(n.id);
                            return next;
                          })
                        }
                        className={`rounded-full px-3 py-1.5 text-[11px] ring-1 ${on ? "bg-brand text-ink ring-brand" : "bg-panel text-slate-300 ring-slate-700"}`}
                      >
                        {on ? t`✓ 要升级` : t`升级 1080p`}
                        <span className="ml-1 text-[9px] opacity-70">{fmtTokens(priceOf(i, FINAL_TIER))}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <button
            onClick={() => void drawAll()}
            disabled={busy || drawing || allDone}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
          >
            {drawing ? t`正在逐段出片…` : allDone ? t`样片都出好了` : t`全部出样片`}
          </button>
          {picked.size > 0 && (
            <button
              onClick={() => void upgradePicked()}
              disabled={busy || drawing}
              className="mt-2 w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700 disabled:opacity-40"
            >
              {t`把勾中的 ${picked.size} 段升到 1080p`}
            </button>
          )}
          <button
            onClick={() => {
              setQuick({ step: "cut" });
              toCut();
            }}
            disabled={!nodes.some(nodeDone) || busy || drawing}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
          >
            <Trans>去剪辑 ›</Trans>
          </button>
        </div>
      )}

      {askDiscard && (
        <DiscardFlowDialog
          discardLabel={t`丢掉上面的流水线，铺这一条`}
          actionNoun={t({ message: "铺快速模式", context: "丢弃确认卡里「…再回来X」的那个动作" })}
          onResume={() => setAskDiscard(false)}
          onCancel={() => setAskDiscard(false)}
          onDiscard={() => {
            setAskDiscard(false);
            const run = () => {
              const materials = [...cast, ...(place ? [place] : [])];
              const list = shotPlanNodes(plan!, { tierId: PREVIEW_TIER, aspect: "portrait", materials });
              if (!useFlow.getState().seed(list, { mode: "workflow", origin: "studio" })) {
                setQuick({ err: useFlow.getState().err || t`没铺成：先处理掉上面那条错误` });
                return;
              }
              useStudio.getState().newWorkDraft();
              setQuick({ step: "preview", err: "" });
            };
            run();
          }}
        />
      )}

      {d.step === "cut" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-slate-300"><Trans>流水线已经铺好，去剪辑页合成、发布或存到本地。</Trans></p>
          <button onClick={() => toCut()} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
            <Trans>打开剪辑页 ›</Trans>
          </button>
          <button onClick={() => resetQuick()} className="text-[11px] text-slate-500">
            <Trans>再做一个</Trans>
          </button>
        </div>
      )}
    </div>
  );
}
