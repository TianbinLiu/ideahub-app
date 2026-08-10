// 工作流页：一屏一个节点卡，横向切节点。
//
// 这就是工坊的节点卡，只是脱掉了 3D 桌面：一个节点持有若干走向方案，左右箭头/横划换节点。
//
// ★ 一段的推进是**三拍**（见 flowStore 的 FlowNode.plan）：
//     写要求 →「生成本段」先推演三套方案（方案台，各带首尾帧预览卡）→ 挑一套（可换帧、
//     改剧情、让 AI 按修改重画）→「生成本段」才真去炼视频。
//   所以中间那块大屏幕在不同时刻是三种东西：方案台 / 起拍画面 / 成片播放器。
//
// 三种入口共用本页：
//   工坊模式 → startFlow() 把活动路径整卡搬进来（含全部走向、素材卡、档位，且每段都已出片）
//   工作流模式 → seedSolo("workflow")，方案台是主路径
//   简约模式 → seedSolo("simple")，单节点单走向、不推演方案、**不存草稿**，UI 收到最简
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import FrameAnnotator, { drawCover } from "../components/FrameAnnotator";
import GenTrace from "../components/GenTrace";
import Icon from "../components/Icon";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
import { AI_REAL } from "../ai";
import { walletOf } from "../data/account";
import { myTemplates } from "../data/templates";
import { VIDEO_TIERS, fmtTokens, proposalsCost, segTokens, tierOf } from "../data/economy";
import {
  FlowNode,
  chosenOf,
  flowCost,
  nodeDone,
  nodeVideo,
  planOf,
  redrawCost,
  requirementOf,
  useFlow,
} from "../studio/flowStore";
import PlanBoard from "../studio/ui/PlanBoard";
import { useStudio } from "../studio/studioStore";
import { formatDuration } from "../types";
import { useMediaUrl } from "../utils/mediaUrl";

const DURATIONS = [3, 5, 6, 8, 10];
/** 触发换节点/换走向的滑动阈值（px）；低于它按点击处理 */
const SWIPE = 48;

/** 套模板后的"一句话"输入：配方负责像不像，用户只负责换谁来演。
 *  下面把填好的分镜实时显示出来——让用户看得见这句话到底变成了什么，
 *  而不是把提示词藏起来当黑箱（黑箱一旦出片不对，用户无从下手）。 */
function TemplateSubjectBox() {
  const { template, subject, setSubject, nodes, cursor } = useFlow();
  const [open, setOpen] = useState(false);
  if (!template) return null;
  const plot = nodes[Math.min(cursor, nodes.length - 1)]?.proposals.find((p) => p.id === nodes[cursor]?.chosenId)?.plot ?? "";
  return (
    <div className="space-y-1.5">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={60}
        placeholder="一句话：换成谁来演？例：一只戴墨镜的柴犬"
        className="w-full rounded-lg border border-brand/50 bg-panel px-2.5 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
      />
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 text-[10px] text-slate-500">
        <Icon name="chevron" size={10} className={open ? "rotate-90" : ""} />
        {open ? "收起" : "看看这句话变成了什么"}
      </button>
      {open && (
        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-black/30 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
          {plot || "先写那句话"}
        </p>
      )}
    </div>
  );
}

/** 一屏一个节点：大屏幕（方案台/画面/成片）+ 本段要求 + 可调项 + 主按钮 */
function NodeScreen({ node, index, total }: { node: FlowNode; index: number; total: number }) {
  const {
    mode,
    busy,
    updateNode,
    updateProposal,
    setRequirement,
    chooseProposal,
    shiftProposal,
    genNode,
    deriveProposals,
    regenProposal,
    setFrame,
    addAnn,
    removeAnn,
    shiftCursor,
  } = useFlow();
  const tpl = useFlow((s) => s.template);
  // 上一段的选定走向：决定本段能否承接真实结尾起拍（也决定推演报价——共用开头帧时图量减半）
  const prevProp = useFlow((s) => (index > 0 ? chosenOf(s.nodes[index - 1]) : null));
  const simple = mode === "simple";
  const prop = chosenOf(node);
  const video = nodeVideo(node);
  const done = nodeDone(node);
  const realVideo = video && !video.startsWith("mock:") ? video : undefined;
  const vsrc = useMediaUrl(realVideo, { forCapture: true });
  const vref = useRef<HTMLVideoElement>(null);
  const [annOpen, setAnnOpen] = useState<{ frame: string; atSec: number } | null>(null);
  const [sheet, setSheet] = useState(false); // 底部「本段设置」抽屉
  // 出片之后大屏幕默认放成片；想回去看/改方案就翻回方案台（改完可以重炼）
  const [showPlan, setShowPlan] = useState(false);

  // ── 方案台三态（见 flowStore.FlowNode.plan）──
  const plan = simple ? null : planOf(node);
  const picking = plan === "picking";
  const carried = !!(node.chain && prevProp?.lastFrame);
  const cost = segTokens(prop.durationSec, node.videoTier);
  const propCost = proposalsCost(carried);
  const req = requirementOf(node);
  const generating = node.status === "generating";
  // 主按钮：没方案台先推演，摊开着就重推，挑定了才真出片。**这是唯一的推进入口**
  const stage: "derive" | "rederive" | "film" = simple || plan === "picked" ? "film" : picking ? "rederive" : "derive";
  const mainCost = stage === "film" ? cost : propCost;
  const mainDisabled =
    busy ||
    generating ||
    (stage === "film" ? !prop.plot.trim() : !req.trim() && !node.materials?.length);
  const mainLabel = generating
    ? node.progress || "生成中…"
    : stage === "rederive"
      ? `♻ 重新生成方案（${fmtTokens(propCost)}）`
      : stage === "derive"
        ? `⚡ 生成本段（${fmtTokens(propCost)}）`
        : done
          ? `♻ 重新生成（${fmtTokens(cost)}）`
          : `⚡ 生成本段（${fmtTokens(cost)}）`;

  function onMain() {
    if (stage === "film") return void genNode(node.id);
    setShowPlan(false);
    void deriveProposals(node.id);
  }

  // 大屏幕放什么：成片 > 方案台 > 起拍画面 > 一句"还没有画面"
  const boardOn = plan != null && (!done || showPlan);

  /** 从预览播放器截当前帧去圈选（视频经代理取流，画布不会被跨域污染） */
  function openAnnotator() {
    const v = vref.current;
    if (v && v.videoWidth) {
      v.pause();
      const c = document.createElement("canvas");
      c.width = 1280;
      c.height = 720;
      drawCover(c.getContext("2d")!, v, 1280, 720);
      setAnnOpen({ frame: c.toDataURL("image/jpeg", 0.9), atSec: v.currentTime });
    } else if (prop.firstFrame) {
      setAnnOpen({ frame: prop.firstFrame, atSec: 0 });
    }
  }

  // 手势：在预览区上横划换节点、竖划换走向（输入框区域不参与，见 data-noswipe）
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-noswipe]")) return;
      drag.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = drag.current;
      drag.current = null;
      if (!d || busy) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE) return;
      if (Math.abs(dx) >= Math.abs(dy)) shiftCursor(dx < 0 ? 1 : -1);
      else if (node.proposals.length > 1) shiftProposal(node.id, dy < 0 ? 1 : -1);
    },
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── 段导航条 ──
          换节点从"压在画面上的两枚半透明箭头"挪到这里：方案台铺满大屏幕之后，那两枚
          箭头正好落在方案卡上，点方案会误触换段 */}
      <div className="flex flex-none items-center gap-2 px-3 py-1.5">
        <button
          onClick={() => shiftCursor(-1)}
          disabled={index === 0 || busy}
          aria-label="上一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-200 disabled:opacity-25"
        >
          <Icon name="back" size={15} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          <span className="flex-none text-[11px] text-slate-300">
            {total > 1 ? `第 ${index + 1}/${total} 段` : "本段"}
          </span>
          {done && <span className="flex-none rounded-full bg-emerald-500/85 px-1.5 text-[10px] text-ink">✓ 已出片</span>}
          {picking && (
            <span className="flex-none rounded-full bg-gold/20 px-1.5 text-[10px] text-gold">待挑方案</span>
          )}
          {generating && (
            <span className="min-w-0 flex-1 animate-pulse truncate rounded-full bg-brand px-1.5 text-[10px] font-semibold text-ink">
              {node.progress || "生成中…"}
            </span>
          )}
          {node.status === "failed" && (
            <span className="min-w-0 flex-1 truncate rounded-full bg-rose-500/85 px-1.5 text-[10px] text-white">
              ✗ {node.error}
            </span>
          )}
        </div>
        {/* 出片后大屏幕默认放成片，这枚开关把方案台翻回来（改帧改剧情再重炼） */}
        {done && plan != null && (
          <button
            onClick={() => setShowPlan((v) => !v)}
            className="flex-none rounded-full bg-panel px-2.5 py-1 text-[10px] text-slate-300"
          >
            {showPlan ? "看成片" : "看方案"}
          </button>
        )}
        <button
          onClick={() => shiftCursor(1)}
          disabled={index >= total - 1 || busy}
          aria-label="下一段"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-200 disabled:opacity-25"
        >
          <Icon name="chevron" size={15} />
        </button>
      </div>

      {/* ── 大屏幕：方案台 / 成片 / 起拍画面（手势区）── */}
      <div className={`relative min-h-0 flex-1 ${boardOn ? "bg-[#0b0f18]" : "flex items-center justify-center bg-black"}`} {...swipe}>
        {boardOn ? (
          /* 方案台自己要吃竖向滚动与点击，横划换段在这里会打架 —— data-noswipe 关掉手势 */
          <div className="absolute inset-0" data-noswipe>
            <PlanBoard
              proposals={node.proposals}
              pickedId={picking ? null : node.chosenId}
              isDone={(p) => !!node.videoByProposal[p.id]}
              busy={busy || generating}
              regenId={node.regenning ? node.chosenId : null}
              onPick={(id) => chooseProposal(node.id, id)}
              onPatch={(_id, patch) => updateProposal(node.id, patch)}
              onFrame={(_id, which, dataUrl) => setFrame(node.id, which, dataUrl)}
              onRegen={() => void regenProposal(node.id)}
              regenCost={(p) => redrawCost(node, p, prevProp)}
              onRederive={() => void deriveProposals(node.id)}
              rederiveCost={propCost}
              carriedFrom={carried}
            />
          </div>
        ) : done && vsrc ? (
          <video ref={vref} src={vsrc} muted playsInline controls className="max-h-full max-w-full" />
        ) : prop.firstFrame ? (
          <img src={prop.firstFrame} alt="" className="max-h-full max-w-full" />
        ) : (
          <div className="px-8 text-center text-xs leading-relaxed text-slate-500">
            {generating
              ? node.progress || "生成中…"
              : simple
                ? "还没有画面——在下面写清楚这一段要拍什么"
                : "还没有画面——在下面写清楚这一段要拍什么，点「生成本段」先看三套方案"}
          </div>
        )}
      </div>

      {/* ── 本段内容 ── */}
      <div className="flex-none space-y-2 border-t border-slate-800 bg-ink px-4 pb-3 pt-2.5" data-noswipe>
        {/* 出片过程日志：跑着时展开，跑完自动收起但留着可回看 */}
        <GenTrace steps={node.steps ?? []} running={generating} />
        {tpl ? (
          /* 套了模板：用户只需要说"换成谁/什么主题"，其余由配方补齐。
             剧情框仍然可展开查看/微调——模板是起点不是牢笼 */
          <TemplateSubjectBox />
        ) : simple ? (
          <textarea
            value={prop.plot}
            onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
            rows={3}
            maxLength={400}
            placeholder="想拍什么？例：雨夜的东京街头，霓虹灯牌下一只黑猫慢慢走过积水，倒影闪烁"
            className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
        ) : (
          /* 工作流：这一栏是**用户自己的话**（推演三套方案的依据），不是某一套的剧情。
             改了它再点「重新生成方案」就按新要求重推——各套的剧情在方案台里逐字改 */
          <div className="space-y-1">
            <textarea
              value={req}
              onChange={(e) => setRequirement(node.id, e.target.value)}
              rows={2}
              maxLength={400}
              placeholder="这一段要拍什么？（AI 会按它推演三套走向）"
              className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <p className="text-[10px] leading-4 text-slate-500">
              {picking
                ? "改完这句话可以「重新生成方案」；挑定一套之后按钮才变回「生成本段」"
                : plan === "picked"
                  ? "已挑定一套 · 在上面的方案台里换首尾帧、改剧情"
                  : "点「生成本段」先出三套方案（各带首尾帧预览），挑定后再炼视频"}
            </p>
          </div>
        )}

        {/* 圈选标注缩略 */}
        {node.anns.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {node.anns.map((a) => (
              <div key={a.id} className="relative w-24 flex-none overflow-hidden rounded-lg bg-panel">
                <img src={a.frame} alt="" className="h-12 w-full object-cover" />
                <div className="truncate px-1 py-0.5 text-[9px] text-slate-300" title={a.req}>
                  {a.req}
                </div>
                <button
                  onClick={() => removeAnn(node.id, a.id)}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-[9px] text-slate-200"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSheet(true)}
            className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300"
          >
            ⚙ {prop.durationSec}s · {tierOf(node.videoTier).label}
          </button>
          {done && (
            <button
              onClick={openAnnotator}
              disabled={busy}
              className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-40"
            >
              ⭕ 圈选改画面
            </button>
          )}
          <button
            onClick={onMain}
            disabled={mainDisabled}
            className={`min-w-0 flex-1 rounded-lg py-2 text-xs font-bold disabled:opacity-40 ${
              stage === "rederive" ? "bg-gold/90 text-ink" : "bg-brand text-ink"
            }`}
            title={AI_REAL ? `预计消耗 ${fmtTokens(mainCost)} token` : undefined}
          >
            {mainLabel}
          </button>
        </div>

        {done && index < total - 1 && (
          <button
            onClick={() => shiftCursor(1)}
            disabled={busy}
            className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 py-2 text-xs font-bold text-emerald-200 disabled:opacity-40"
          >
            ✓ 这段满意，去下一段
          </button>
        )}
      </div>

      {/* ── 本段设置抽屉 ── */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/70" onClick={() => setSheet(false)}>
          <div className="safe-bottom w-full space-y-3 rounded-t-2xl bg-ink p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">第 {index + 1} 段设置</span>
              <button onClick={() => setSheet(false)} className="text-slate-400">
                <Icon name="close" size={18} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => updateProposal(node.id, { durationSec: d })}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] ${prop.durationSec === d ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                >
                  {d}s
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">画质</span>
              {VIDEO_TIERS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => updateNode(node.id, { videoTier: t.id })}
                  title={t.desc}
                  className={`rounded-lg px-2.5 py-1.5 text-[11px] ${node.videoTier === t.id ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                >
                  {t.label} · {fmtTokens(segTokens(prop.durationSec, t.id))}
                </button>
              ))}
            </div>

            {index > 0 && (
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={node.chain}
                  onChange={(e) => updateNode(node.id, { chain: e.target.checked })}
                  className="accent-brand"
                />
                从上一段的真实结尾画面接着拍
              </label>
            )}

            {!!node.materials?.length && (
              <div className="flex flex-wrap gap-1">
                <span className="w-10 flex-none text-[11px] text-slate-400">素材</span>
                {node.materials.map((c) => (
                  <span key={c.id} className="rounded-full bg-panel px-2 py-0.5 text-[10px] text-slate-300">
                    {c.name}
                  </span>
                ))}
              </div>
            )}

            {/* 推演三套方案的入口以前就藏在这里，绝大多数用户没找到它——现在它是屏幕中间
                那块方案台 + 底部主按钮的主路径，抽屉里只留真正的"设置"（时长/画质/承接） */}
          </div>
        </div>
      )}

      {annOpen && (
        <FrameAnnotator
          frame={annOpen.frame}
          hint="标注会先改这一段的设定画面，再重新生成本段视频"
          onClose={() => setAnnOpen(null)}
          onSave={(frame, req) => {
            addAnn(node.id, { frame, req, atSec: annOpen.atSec });
            setAnnOpen(null);
          }}
        />
      )}
    </div>
  );
}

export default function FlowPage() {
  const navigate = useNavigate();
  const { nodes, cursor, mode, origin, busy, err, setCursor, addNode, removeNode, moveNode, reset } = useFlow();
  const [finalizing, setFinalizing] = useState("");
  const [tplExtract, setTplExtract] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const tpl = useFlow((s) => s.template);
  const simple = mode === "simple";

  // 直接输地址进来（或热更新丢了状态）：没节点就回创作入口，别停在空白页。
  // leavingRef 是必需的：组稿成功后 reset() 清空节点，本效应会在 navigate("/cut")
  // 落地前抢跑，把用户按回 /create（实测踩到过）
  const leavingRef = useRef(false);
  useEffect(() => {
    if (nodes.length === 0 && !leavingRef.current) navigate("/create", { replace: true });
  }, [nodes.length, navigate]);

  // ★ 自动存盘只挂在"又炼出一段"这一个事件上，不做定时/每次改动都存：
  //   一段视频是几十秒 + 真金白银，丢了补不回来；而草稿正文带整份首尾帧 base64，
  //   一条几 MB，频繁写盘会拖慢主线程还费配额。改文字这种廉价改动交给手动按钮。
  //   写在 FlowPage 而不是 flowStore：flowStore 绝不 import studioStore（互相 import
  //   在 Vite 下会拿到半初始化的模块），而这一页两边都拿得到。
  //   ★ 简约模式不落草稿：它只有一段、几十秒就出片，一路直通剪辑与发布，中间没有"回来
  //     接着做"的状态可言。给它存草稿只会在个人页堆一串一次性的半成品，而每条都带 1MB
  //     级的帧，把真正需要草稿的工坊/工作流那 20 条上限挤掉（见 data/drafts.MAX_DRAFTS）。
  const doneCount = nodes.filter(nodeDone).length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (simple) return;
    if (doneCount > prevDone.current) void useStudio.getState().saveWorkDraft({ from: "flow" });
    prevDone.current = doneCount;
  }, [doneCount, simple]);

  const allDone = nodes.length > 0 && nodes.every(nodeDone);
  const remain = useMemo(() => flowCost(nodes), [nodes]);
  const wallet = walletOf();
  const node = nodes[Math.min(cursor, nodes.length - 1)];

  if (nodes.length === 0 || !node) return null;

  /** 存盘。失败要说出来：配额满/隐私模式下 IndexedDB 写不进去，
   *  静默"保存成功"会让用户放心地关掉页面，然后什么都没了（铁律八） */
  async function saveNow() {
    setSaveState("saving");
    const meta = await useStudio.getState().saveWorkDraft({ from: "flow" });
    setSaveState(meta ? "saved" : "failed");
    if (!meta) useFlow.setState({ err: "草稿保存失败（存储空间不足或浏览器隐私模式）" });
    setTimeout(() => setSaveState("idle"), 2200);
  }

  /** 全部满意 → 组稿（回写真帧 + 提炼卡组）→ 进剪辑页 */
  async function toCut() {
    if (busy || finalizing) return;
    setFinalizing("组稿中…");
    try {
      const ok = await useStudio.getState().finalizeFromFlow(useFlow.getState().nodes, (s) => setFinalizing(s));
      if (ok) {
        leavingRef.current = true;
        reset();
        navigate("/cut");
      }
    } catch (e) {
      console.warn("[flow] 组稿失败:", e);
      useFlow.setState({ err: `组稿失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}` });
    } finally {
      setFinalizing("");
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-ink">
      <header className="safe-top flex flex-none items-center gap-2.5 px-4 py-2.5">
        <button
          onClick={() => navigate(origin === "studio" ? "/studio" : "/create")}
          className="flex-none text-slate-300"
        >
          <Icon name="back" size={20} />
        </button>
        <span className="flex-none text-sm font-bold text-slate-100">{simple ? "简约模式" : "工作流"}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {simple ? "一个节点，一条短片" : `${nodes.length} 段 · 已出片 ${nodes.filter(nodeDone).length}`}
          {AI_REAL && remain > 0 && ` · 剩余约 ${fmtTokens(remain)}`}
        </span>
        {/* 手动存盘。自动保存只在"炼完一段"那种昂贵节点触发（见上面的 effect），
            纯改文字不会自动存——想留住就点这里。简约模式没有这颗按钮（它不进草稿库） */}
        {!simple && (
          <button
            onClick={() => void saveNow()}
            disabled={saveState === "saving"}
            className="flex-none rounded-full bg-slate-700/80 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          >
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存 ✓"
                : saveState === "failed"
                  ? "保存失败"
                  : "存草稿"}
          </button>
        )}
        {/* ★ 这里原来是「⚡ 炼完剩余 N 段」——一键把几段一起炼。它和"每段挑定方案再出片"
            是两条互相拆台的路：批量跑起来时后面那些段可能还摊着三套方案没挑，按钮却已经
            替用户按 fresh[0] 炼下去了（每段几万 token）。现在推进只走每段自己的主按钮，
            这里只剩"全段就绪 → 去剪辑" */}
        <button
          onClick={() => void toCut()}
          disabled={!allDone || busy || !!finalizing}
          className="flex-none rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-ink disabled:opacity-35"
          title={allDone ? undefined : "每一段都挑定方案并炼出视频后才能去剪辑"}
        >
          {finalizing || "去剪辑 ›"}
        </button>
      </header>

      {/* 简约模式的模板栏：套上模板 = 配方负责画风与分镜，用户只写一句话 */}
      {simple && (
        <div className="mx-4 mb-1.5 flex flex-none items-center gap-2 rounded-xl border border-slate-700/70 bg-panel px-3 py-2">
          {tpl ? (
            <>
              <span className="flex-none text-xs">🧪</span>
              <Link to={`/template/${tpl.id}`} className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-100">
                {tpl.title}
              </Link>
              <span className="flex-none text-[10px] text-slate-500">{nodes.length} 段</span>
              {/* 出片了、模板是自己提取的、还没发布 → 就地引导发布（详情页的作者区管标题/简介） */}
              {allDone && myTemplates().some((x) => x.id === tpl.id && !x.published) ? (
                <Link
                  to={`/template/${tpl.id}`}
                  className="flex-none rounded-full bg-gold/90 px-2.5 py-1 text-[11px] font-bold text-ink"
                >
                  发布模板
                </Link>
              ) : (
                <button onClick={() => navigate("/templates")} className="flex-none text-[11px] text-brand">
                  换
                </button>
              )}
              <button
                onClick={() => useFlow.getState().seedSolo("simple")}
                className="flex-none text-[11px] text-slate-500"
              >
                不用
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                套个模板？一句话就能出同类视频
              </span>
              <button
                onClick={() => navigate("/templates")}
                className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100"
              >
                模板市场
              </button>
              <button
                onClick={() => setTplExtract(true)}
                className="flex-none rounded-full bg-brand/90 px-2.5 py-1 text-[11px] font-bold text-ink"
              >
                提取模板
              </button>
            </>
          )}
        </div>
      )}

      {err && (
        <div className="mx-4 mb-1.5 flex flex-none items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <span className="min-w-0 flex-1">{err}</span>
          <button onClick={() => useFlow.setState({ err: "" })} className="flex-none">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* 一屏一个节点（key 让切节点时播放器彻底重建，不残留上一段的画面） */}
      <div className="min-h-0 flex-1">
        <NodeScreen key={node.id} node={node} index={cursor} total={nodes.length} />
      </div>

      {/* ── 底部节点条：整条流水线的缩略 + 增删换序 ── */}
      {!simple && (
        <div className="safe-bottom flex-none border-t border-slate-800 bg-[#141821] px-3 pb-3 pt-2">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {nodes.map((n, i) => {
              const p = chosenOf(n);
              return (
                <button
                  key={n.id}
                  onClick={() => setCursor(i)}
                  className={`relative h-11 w-16 flex-none overflow-hidden rounded-lg border-2 ${
                    i === cursor ? "border-brand" : "border-transparent"
                  }`}
                >
                  {p.firstFrame ? (
                    <img src={p.firstFrame} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-panel text-[10px] text-slate-500">
                      {i + 1}
                    </span>
                  )}
                  {nodeDone(n) ? (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-500/90 px-1 text-[8px] text-ink">
                      ✓
                    </span>
                  ) : (
                    planOf(n) === "picking" && (
                      <span className="absolute right-0.5 top-0.5 rounded-full bg-gold/90 px-1 text-[8px] text-ink">
                        ⋯
                      </span>
                    )
                  )}
                </button>
              );
            })}
            {/* ★ 上一段没出片就不许加下一段：段与段靠**前一段的真实尾帧**承接起拍，
                先摆出五个空段再回头一段段炼，等于让后面每一段都从设定帧起拍（衔接断掉），
                而且用户会攒下一堆没挑方案的段——这正是要改掉的"最后一起生成"的老路 */}
            <button
              onClick={() => addNode()}
              disabled={busy || !nodeDone(nodes[nodes.length - 1])}
              title={nodeDone(nodes[nodes.length - 1]) ? "加一段" : "先把最后一段挑定方案并炼出视频"}
              className="h-11 w-11 flex-none rounded-lg border border-dashed border-slate-600 text-slate-400 disabled:opacity-40"
              aria-label="加一段"
            >
              ＋
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
            <button
              onClick={() => moveNode(node.id, -1)}
              disabled={busy || cursor === 0}
              className="rounded bg-panel px-2 py-1 text-slate-300 disabled:opacity-30"
            >
              ◀ 前移
            </button>
            <button
              onClick={() => moveNode(node.id, 1)}
              disabled={busy || cursor === nodes.length - 1}
              className="rounded bg-panel px-2 py-1 text-slate-300 disabled:opacity-30"
            >
              后移 ▶
            </button>
            <button
              onClick={() => removeNode(node.id)}
              disabled={busy || nodes.length <= 1}
              className="rounded bg-rose-500/15 px-2 py-1 text-rose-300 disabled:opacity-30"
            >
              🗑 删除本段
            </button>
            <span className="min-w-0 flex-1 truncate text-right text-slate-500">
              总时长 {formatDuration(nodes.reduce((s, n) => s + chosenOf(n).durationSec, 0))}
              {AI_REAL && wallet && ` · 余额 ${fmtTokens(wallet.plan + wallet.addon)}`}
            </span>
          </div>
        </div>
      )}
      {tplExtract && (
        <VideoTemplateExtractor
          onClose={() => setTplExtract(false)}
          onDone={(t) => useFlow.getState().applyTemplate(t)}
        />
      )}
    </div>
  );
}
