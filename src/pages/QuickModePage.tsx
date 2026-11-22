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
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLocation, useNavigate } from "react-router";
import PageHeader from "../components/PageHeader";
import Warn from "../components/Warn";
import StepDots from "../components/StepDots";
import CastPicker from "../components/flow/CastPicker";
import DiscardFlowDialog from "../components/flow/DiscardFlowDialog";
import { installSharedCard, myCards, tierOffered, tierOfPreferred } from "../data/account";
import { listSharedCards, type ApiSharedCard } from "../api/branch";
import { CHAT_TURN_TOKENS, fmtTokens, priceTag, providerOf, tierOf } from "../data/economy";
import { useFlow, flowDirty, nodeCost, nodeDone, chosenOf } from "../studio/flowStore";
import { shotPlanNodes } from "../studio/structuredSkills";
import { useLeadDraft, toggleCast } from "../studio/leadDraftStore";
import { saveVoice, subscribeVoices, voiceOf, voicesVersion, VOICE_MAX_SEC, VOICE_MIN_SEC } from "../data/cardVoice";
import { audioFileToVoice } from "../utils/wav";
import { LEAD_CAST_MAX } from "../data/sceneShots";
import { QUICK_STEPS, resetQuick, runIdea, setQuick, useQuickDraft, type QuickStep } from "../studio/quickDraftStore";
import { useFlowActions } from "../hooks/useFlowActions";
import { dropCutSession } from "../data/cutSession";
import { useStudio } from "../studio/studioStore";
import type { Card } from "../types";

/**
 * 预览用便宜档（480p「草稿」）。
 * ★ 2026-11-19 真机实测：同一张**自动画出来的写实人像首帧**，Seedance 视频侧按
 *   `reference_image` 判「真人照片」整发拒；MiniMax H3 Lite 同一条走通了，而且更便宜
 *   （5s 竖屏 82.7k vs 103.7k）。所以预览**优先走 MiniMax 草稿**，这台机器没有
 *   MiniMax 那几档时回落 Seedance 草稿。
 */
const PREVIEW_TIER_BASE = "draft";
function previewTierId(): string {
  const base = tierOf(PREVIEW_TIER_BASE);
  const mm = tierOfPreferred(base, "minimax");
  return tierOffered(mm) ? mm.id : base.id;
}
/**
 * 定稿档（原来写死 1080p 的「电影级」）。
 * ★ 2026-11-19 真机：预览走 MiniMax 时样片好好的，升级回 Seedance `ultra` 又被同一条
 *   「参考图没过内容审核（常见是真人照片）」整段拒——预览绕开了、定稿又撞回去。
 *   所以定稿**跟着预览同一家**：预览选到 MiniMax 就用它的电影级（上游 768P，界面照实写档位名，
 *   不写 1080p），预览回落 Seedance 时才是 1080p 那一档。
 */
const FINAL_TIER_BASE = "ultra";
function finalTierId(): string {
  const provider = providerOf(previewTierId());
  const t = tierOfPreferred(tierOf(FINAL_TIER_BASE), provider);
  return tierOffered(t) ? t.id : FINAL_TIER_BASE;
}
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
  const location = useLocation();
  const d = useQuickDraft();
  const lead = useLeadDraft();
  // 声音样本是本机侧库：订阅一下，上传完立刻重画
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const voiceFileRef = useRef<HTMLInputElement>(null);
  const [voiceTarget, setVoiceTarget] = useState<string | null>(null);
  const [voiceErr, setVoiceErr] = useState("");
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
  const plan = d.plan;

  /** 真铺：用**调用那一刻**的 store（不读渲染时的闭包 —— 「不用场景卡」是先清 placeId 再铺的）。 */
  function doSeed(placeId: string | null) {
    const planNow = useQuickDraft.getState().plan;
    if (!planNow) return;
    const mine = myCards();
    const castNow = useLeadDraft
      .getState()
      .castIds.map((id) => mine.find((c) => c.id === id))
      .filter((c): c is Card => !!c);
    const scene = placeId ? (mine.find((c) => c.type === "scene" && c.id === placeId) ?? null) : null;
    const list = shotPlanNodes(planNow, {
      tierId: previewTierId(),
      aspect: "portrait",
      materials: [...castNow, ...(scene ? [scene] : [])],
    });
    if (!useFlow.getState().seed(list, { mode: "workflow", origin: "studio" })) {
      setQuick({ err: useFlow.getState().err || t`没铺成：流水线还是那条，先处理掉上面那条错误` });
      return;
    }
    useStudio.getState().newWorkDraft(); // 整表换过 = 与旧草稿脱钩（成了才断）
    setQuick({ step: "preview", err: "" });
  }

  /** 铺节点是「整表换 nodes」的入口：脏了先摆 DiscardFlowDialog（与套模板同一道闸） */
  function seedFlow(placeId: string | null = d.placeId) {
    if (!plan) return;
    if (flowDirty()) setAskDiscard(true);
    else doSeed(placeId);
  }

  /** 逐段出片（同一时刻只能炼一段，所以排队跑）。 */
  async function drawAll() {
    setDrawing(true);
    try {
      for (const n of useFlow.getState().nodes) {
        if (nodeDone(n) || n.status === "generating") continue;
        await useFlow.getState().genNode(n.id);
      }
    } catch (e) {
      // ★ 原来没有 catch：genNode 抛出来就直接冒到 unhandled，界面只看见按钮弹回原样（2026-11-19 真机：
      //   点了半天"没有反应"）。把原话摆出来，至少知道是被谁拒的。
      setQuick({ err: e instanceof Error ? e.message : String(e) });
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
        useFlow.getState().updateNode(n.id, { videoTier: finalTierId() });
        await useFlow.getState().genNode(n.id);
      }
    } catch (e) {
      // ★ 同 drawAll：不 catch 的话失败只表现为"按钮弹回去"，一句话都没有（真机踩过）
      setQuick({ err: e instanceof Error ? e.message : String(e) });
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

  // 从「自己传图做卡片」回来：做完的那张卡自动选中，并跳回对应的那一步
  useEffect(() => {
    const st = (location.state ?? null) as { createdCardId?: string } | null;
    if (!st?.createdCardId) return;
    const mine = myCards();
    const card = mine.find((c) => c.id === st.createdCardId);
    if (card?.type === "scene") {
      setQuick({ placeId: card.id, step: "scene" });
    } else if (card?.type === "character") {
      const live = new Set(mine.filter((c) => c.type === "character").map((c) => c.id));
      if (!useLeadDraft.getState().castIds.includes(card.id)) toggleCast(card.id, LEAD_CAST_MAX, live);
      setQuick({ step: "cast" });
    }
    navigate("/quick", { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在从做卡页回来的那一拍认一次
  }, []);

  /** 本地上传一段音频当声音样本（audioFileToVoice 是「上传本地音频」那条路的唯一实现） */
  async function onVoiceFile(file: File | null | undefined) {
    if (!file || !voiceTarget) return;
    setVoiceErr("");
    try {
      const r = await audioFileToVoice(file, VOICE_MIN_SEC, VOICE_MAX_SEC);
      await saveVoice(voiceTarget, { dataUrl: r.dataUrl, durationSec: r.durationSec, note: t`本地上传` });
    } catch (e) {
      setVoiceErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVoiceTarget(null);
      if (voiceFileRef.current) voiceFileRef.current.value = "";
    }
  }

  // 向导自己的拒绝一直在；flowStore 的整句拒绝只在**要用它**的那一步（预览）画 ——
  // 摆在写想法这一屏与当下的事无关，真机上看起来像"脚本生成失败了"
  const err = d.err || (d.step === "preview" || d.step === "cut" ? flowErr : "");
  const allDone = nodes.length > 0 && nodes.every(nodeDone);
  const priceOf = (i: number, tierOverride?: string) => nodeCost(nodes, i, mode, tierOverride);
  /** 定稿档在这一刻是什么（跟着预览那一家走，见文件头的 finalTierId） */
  const fin = finalTierId();
  const finLabel = tierOf(fin).label;

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
            onClick={() => void runIdea(previewTierId())}
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
            <CastPicker returnTo="quick" />
          </div>
          {/* 声音样本：卡里已有的直接用；没有就本地上传一段（audioFileToVoice，窗口 [2,15]s） */}
          {cast.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {cast.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-200">{c.name}</span>
                  <span className="flex-none text-[10px] text-slate-500">{voiceOf(c.id) ? t`有声音样本` : t`没有样本`}</span>
                  <button
                    onClick={() => {
                      setVoiceTarget(c.id);
                      voiceFileRef.current?.click();
                    }}
                    className="flex-none rounded-full bg-panel px-2.5 py-1 text-[10px] text-slate-200 ring-1 ring-slate-700"
                  >
                    {voiceOf(c.id) ? t`换一段音频` : t`上传音频`}
                  </button>
                </div>
              ))}
              {voiceErr && (
                <Warn compact tone="danger">
                  {voiceErr}
                </Warn>
              )}
              <input
                ref={voiceFileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => void onVoiceFile(e.target.files?.[0])}
              />
            </div>
          )}
          {/* 声音样本：出片时模型靠它认音色。没有样本的角色照样出片，但不会「用自己的声音」说话 —— 照实说 */}
          {cast.filter((c) => !voiceOf(c.id)).length > 0 && (
            <div className="mt-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2">
              <Warn compact>
                <Trans>这几个角色还没有声音样本：出片时台词不会用「他们的声音」说。可以上传一段（2~15 秒），或从视频里提卡时顺手取一段。</Trans>
              </Warn>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {cast
                  .filter((c) => !voiceOf(c.id))
                  .map((c) => (
                    <button
                      key={c.id}
                      onClick={() => navigate(`/card/${c.id}`)}
                      className="rounded-full bg-black/30 px-2.5 py-1 text-[10px] text-slate-200"
                    >
                      {c.name} ›
                    </button>
                  ))}
              </div>
            </div>
          )}
          <span className="flex-1" />
          {/* 没有人物卡也能往下走（2026-11-18 真机：新账号卡片库是空的，这里原来是一颗永远灰着的键 = 强制先花 80k 铸卡） */}
          {cast.length === 0 && (
            <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
              <Trans>也可以先不定人物：画面按分镜里的文字来，之后想挂卡再去工坊。</Trans>
            </p>
          )}
          <button
            onClick={() => setQuick({ step: "scene" })}
            className="mt-2 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
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
            onClick={() => navigate("/custom-card", { state: { returnTo: "quick" } })}
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
            onClick={() => seedFlow()}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
          >
            <Trans>铺好流水线，开始出预览 ›</Trans>
          </button>
          <button
            onClick={() => {
              setQuick({ placeId: null });
              seedFlow(null);
            }}
            className="mt-2 text-[11px] text-slate-500"
          >
            <Trans>不用场景卡</Trans>
          </button>
        </div>
      )}

      {/* ④ 预览：逐段出片 / 抽卡；⑤ 勾中的升 1080p */}
      {d.step === "preview" && (
        <div className="flex flex-1 flex-col">
          <p className="text-sm text-slate-300"><Trans>逐段看样片，不满意的重抽</Trans></p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            <Trans>先用便宜档（480p）出样片；勾中的段之后会按 {finLabel} 重出，画面会有变化。</Trans>
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
                        {on ? t`✓ 要升级` : t`升级 ${finLabel}`}
                        <span className="ml-1 text-[9px] opacity-70">{fmtTokens(priceOf(i, fin))}</span>
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
              {t`把勾中的 ${picked.size} 段升到 ${finLabel}`}
            </button>
          )}
          <button
            onClick={() => {
              setQuick({ step: "cut" });
              toCut();
            }}
            disabled={!allDone || busy || drawing}
            className="mt-4 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
          >
            <Trans>去剪辑 ›</Trans>
          </button>
          {/* ★ 2026-11-22 真机：门槛原来是「至少一段出片」，而组稿会把**没出片的段**也放进时间轴 ——
              刚才那条就是段1 有片子、段2 是黑的 4.0s，合成到那一截必失败。改成全部出片才放行，
              剩下几段当场说清楚（别让人对着灰键猜）。 */}
          {nodes.length > 0 && !allDone && (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              {t`还有 ${nodes.filter((n) => !nodeDone(n)).length} 段没出片——逐段出完才能去剪辑（剪辑页会把没出片的段当作一段黑片）`}
            </p>
          )}
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
            doSeed(useQuickDraft.getState().placeId);
          }}
        />
      )}

      {d.step === "cut" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-slate-300"><Trans>流水线已经铺好，去剪辑页合成、发布或存到本地。</Trans></p>
          <button onClick={() => toCut()} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
            <Trans>打开剪辑页 ›</Trans>
          </button>
          {/* ★ 2026-11-22 真机：toCut 被上一份没剪完的稿子整句拒时，这里只有一句"先去我的丢掉"——
              而人正站在这条新流水线上，回「我的」再回来这条路不顺。给一个当场可办的出路：
              丢掉旧稿、用眼前这条（旧稿是花过钱的，所以按钮上把代价说清楚，不藏在弹层里）。 */}
          {flowErr && (
            <button
              onClick={() => {
                void (async () => {
                  await dropCutSession();
                  useFlow.setState({ err: "" });
                  toCut();
                })();
              }}
              className="w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700"
            >
              <Trans>丢掉旧稿，用这一条 ›</Trans>
            </button>
          )}
          <button onClick={() => resetQuick()} className="text-[11px] text-slate-500">
            <Trans>再做一个</Trans>
          </button>
        </div>
      )}
    </div>
  );
}
