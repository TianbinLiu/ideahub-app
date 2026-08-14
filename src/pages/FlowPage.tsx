// 工作流页：一屏一个节点卡，横向切节点。
//
// 这就是工坊的节点卡，只是脱掉了 3D 桌面：一个节点持有若干走向方案，横向切节点。
//
// ★ 一段的推进是**三拍**（见 flowStore 的 FlowNode.plan）：
//     写要求 →「生成本段」先推演三套方案（方案台，各带首尾帧预览卡）→ 挑一套（可换帧、
//     改剧情、让 AI 按修改重画）→「生成本段」才真去炼视频。
//   所以中间那块大屏幕在不同时刻是三种东西：方案台 / 起拍画面 / 成片播放器。
//   出片浮层（ForgeOverlay）只在第三拍开——推演也会把 status 置成 generating，跟着它走
//   会让"挑方案"这一步莫名其妙弹出炼卡动画。
//
// 三种入口共用本页：
//   工坊模式 → startFlow() 把活动路径整卡搬进来（含全部走向、素材卡、档位，且每段都已出片）
//   工作流模式 → seedSolo("workflow")，方案台是主路径
//   简约模式 → seedSolo("simple")，单节点单走向、不推演方案、**不存草稿**，UI 收到最简
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import ForgeOverlay, { type ForgePhase } from "../components/ForgeOverlay";
import FrameAnnotator, { drawCover } from "../components/FrameAnnotator";
import GenTrace from "../components/GenTrace";
import Icon from "../components/Icon";
import { MaterialButtonArt } from "../components/MascotStage";
import MaterialSheet, { MaterialStrip } from "../components/MaterialSheet";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
import { AI_REAL } from "../ai";
import { tierBlockReason, walletOf } from "../data/account";
import { myTemplates } from "../data/templates";
import { VIDEO_TIERS, clampDuration, fmtTokens, modelLabel, proposalsCost, r2vPriceIssue, tierOf } from "../data/economy";
import {
  FlowNode,
  chosenOf,
  flowCost,
  frontierOf,
  nodeCost,
  nodeDone,
  nodeRefOn,
  nodeVideo,
  planOf,
  redrawCost,
  requirementOf,
  useFlow,
} from "../studio/flowStore";
import PlanBoard from "../studio/ui/PlanBoard";
import { deckQuoteOf, useStudio } from "../studio/studioStore";
import { VIDEO_ASPECTS, aspectCss, aspectOf, formatDuration } from "../types";
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
function NodeScreen({
  node,
  index,
  total,
  matOpen,
  matShake,
  onToggleMat,
}: {
  node: FlowNode;
  index: number;
  total: number;
  /** 素材窗口开着（圆形按钮点亮） */
  matOpen: boolean;
  /** 每加一次素材 +1：拿它当 key 让抖动的 CSS 动画重播（同 CharacterPerch 的做法） */
  matShake: number;
  onToggleMat: () => void;
}) {
  const {
    mode,
    nodes, // 档位选择器要问 nodeCost（整段报价），它需要整张表
    busy,
    err,
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
    addNode,
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
  /** 出片浮层。只由「出片」这一拍开——推演方案也会把 status 置成 generating，
   *  跟着 status 走的话"挑方案"这一步会莫名其妙弹出炼卡动画 */
  const [forge, setForge] = useState<ForgePhase | null>(null);
  // 出片之后大屏幕默认放成片；想回去看/改方案就翻回方案台（改完可以重炼）
  const [showPlan, setShowPlan] = useState(false);
  const matCount = node.materials?.length ?? 0;

  // ── 方案台三态（见 flowStore.FlowNode.plan）──
  const plan = simple ? null : planOf(node);
  const picking = plan === "picking";
  const carried = !!(node.chain && prevProp?.lastFrame);
  // ★ 报价问 store 的 nodeCost，与真正扣钱的 genNode 同一处实现：它算的是"出片 +
  //   这一段还得补画几张设定帧"，而简约模式恰恰是两张帧都没有的那条路（铁律六）
  const cost = useFlow((s) => nodeCost(s.nodes, index, s.mode));
  const propCost = proposalsCost(carried);
  /**
   * 这一段会不会走「参考生视频」（卡片形象 + 一句话直出，不画设定帧）。
   * 与出片时的判定同一个函数 —— 界面说"直接用卡片形象"、实际却画了张设定帧，
   * 用户只会觉得卡片没生效。
   *
   * ★ 问 store 的 nodeRefOn 而不是自己拼一遍参数：**承接帧也算一票**（首尾帧与参考图
   *   互斥）。在这里漏传 carryFrame 的话，套模板的简约模式从第 2 段起就会写着
   *   "直接用卡片形象、不画设定帧"，实际却在承接上一段真实尾帧并按文字补画结束帧。
   */
  const refOn = useFlow((s) => nodeRefOn(s.nodes, index, s.mode));
  /** 本段走白模复刻（r2v）。判定与报价（nodeCost）同源：模板快照带 refVideo（存在性） */
  const blockout = !!tpl?.refVideo;
  /** 当前套餐点不动的档位各是为什么（空 = 都能选）。判断在 data/account 一处 */
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t)).filter((r): r is string => !!r);
  /** 白模节点下各档位点不动的 r2v 原因（判断在 economy.r2vPriceIssue 一处，铁律六）。
   *  几档的整句常常相同（"暂未开放"），Set 去重后再印，别把同一句话糊三遍 */
  const r2vBlocks = blockout
    ? [...new Set(VIDEO_TIERS.map((t) => r2vPriceIssue(t.id)).filter((r): r is string => !!r))]
    : [];
  const req = requirementOf(node);
  const generating = node.status === "generating";
  /** 主按钮这一下干什么：没方案台先推演，摊开着就重推，挑定了才真出片。
   *  **这是唯一的推进入口**——三套方案原来藏在「本段设置」抽屉的一枚小按钮后面，
   *  绝大多数用户没见过它，于是最贵的一步（出片）反而没有选择余地。 */
  const stage: "derive" | "rederive" | "film" = simple || plan === "picked" ? "film" : picking ? "rederive" : "derive";
  const mainCost = stage === "film" ? cost : propCost;
  const mainDisabled =
    busy || generating || (stage === "film" ? !prop.plot.trim() : !req.trim() && !node.materials?.length);
  const mainLabel = generating
    ? node.progress || "生成中…"
    : stage === "rederive"
      ? `♻ 重新生成方案（${fmtTokens(propCost)}）`
      : stage === "derive"
        ? `⚡ 生成本段（${fmtTokens(propCost)}）`
        : done
          ? `♻ 重新生成（${fmtTokens(cost)}）`
          : `⚡ 生成本段（${fmtTokens(cost)}）`;

  async function onMain() {
    if (busy) return;
    if (stage !== "film") {
      // 推演不开炼卡浮层（见 forge 的注释）；方案台自己会显示"待挑方案"
      setShowPlan(false);
      void deriveProposals(node.id);
      return;
    }
    setForge("forging");
    const ok = await genNode(node.id);
    setForge(ok ? "done" : "failed");
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
      {/* ── 段导航条 + 状态 ──
          ★ 换节点从"压在画面上的两枚半透明箭头"挪到这里，状态角标也一并搬过来：方案台铺满
            大屏幕之后，那两枚箭头正好落在方案卡的首尾帧上，点方案会误触换段。
            顺序门禁的表达（锁图标 + 说明"为什么点不动"）原样保留，真正的拦截仍在
            flowStore.clampCursor。 */}
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
          {picking && <span className="flex-none rounded-full bg-gold/20 px-1.5 text-[10px] text-gold">待挑方案</span>}
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
          disabled={index >= total - 1 || !done || busy}
          title={index >= total - 1 ? "没有下一段了" : done ? "下一段" : "先把这一段炼出来"}
          aria-label={done ? "下一段" : "下一段（本段还没出片）"}
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-panel text-slate-200 disabled:opacity-25"
        >
          <Icon name={done || index >= total - 1 ? "chevron" : "lock"} size={done || index >= total - 1 ? 15 : 13} />
        </button>
      </div>

      {/* ── 大屏幕：方案台 / 成片 / 起拍画面（手势区）── */}
      <div
        className={`relative min-h-0 flex-1 ${boardOn ? "bg-[#0b0f18]" : "flex items-center justify-center bg-black"}`}
        {...swipe}
      >
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
              // 预览卡的框跟本段画幅走：写死一个比例，另一种画幅的帧会被裁掉一大半
              frameAspect={aspectCss(node.aspect)}
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
        {/* 标题不在这里改了——它是"某一套方案"的标题，跟剧情一起放在方案台那一行里改，
            两处都能改同一个字段只会让人不知道哪个说了算 */}
        {tpl ? (
          /* 套了模板：用户只需要说"换成谁/什么主题"，其余由配方补齐。
             剧情框仍然可展开查看/微调——模板是起点不是牢笼 */
          <>
            <TemplateSubjectBox />
            {/* ★ 白模的报价行必须**明示输入费构成**：r2v 连模板视频的输入时长也计费
                （输出还≈输入），"42<70 所以更便宜"的直觉是反的——只报一个总数，
                用户会拿纯任务的价一比就觉得被多收了。数字与主按钮同一把尺子（nodeCost） */}
            {tpl.refVideo && (
              <p className="text-[10px] leading-4 text-slate-500">
                {`白模复刻出片（「${tierOf(node.videoTier).label}」档）：模板视频 ${tpl.refVideo.durationSec}s 的输入也计费、输出≈模板时长，共约 ${fmtTokens(cost)} token`}
                {matCount === 0 && "。挂上带形象图的角色卡（右下角素材按钮），AI 会把红色小人换成它"}
              </p>
            )}
          </>
        ) : simple ? (
          <div className="space-y-1">
            <textarea
              value={prop.plot}
              onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
              rows={3}
              maxLength={400}
              placeholder="想拍什么？例：雨夜的东京街头，霓虹灯牌下一只黑猫慢慢走过积水，倒影闪烁"
              className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            {/* ★ 挂了卡就必须说清"这些卡到底怎么参与出片"，因为两种做法的结果差很多：
                支持参考图的档位是把卡的形象图**直接交给 Seedance**（一句话直出，不画设定帧，
                也就更便宜）；不支持的档位只能先按文字重画一张设定帧再出片，形象是"照着描述
                画的"而不是"照着卡片用的"。悄悄换一种做法 = 用户以为卡片没生效（铁律八） */}
            {matCount > 0 && (
              <p className="text-[10px] leading-4 text-slate-500">
                {refOn
                  ? `直接把素材卡的形象参考图交给「${tierOf(node.videoTier).label}」档出片，不再画设定帧（更快也更省）`
                  : tierOf(node.videoTier).refImg
                    ? "素材卡上还没有形象参考图（去卡片详情页加几张），这次只能先按描述画一张设定帧再出片"
                    : `「${tierOf(node.videoTier).label}」档不支持参考图：会先按描述画一张设定帧再出片。想直接用卡片形象，在「⚙ 本段设置」里换成「高清」或「电影级」`}
              </p>
            )}
          </div>
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
            {/* 时长显示的是**真正会发出去**的秒数（2.5 不收 3 秒，见 clampDuration）——
                写 3 秒却出 4 秒的片，用户对不上账。
                ★ 白模例外：时长 = 模板登记时长，**不过 clampDuration**（edit 输出≈输入是
                协议行为，10s 上限是纯 t2v 档位的约束——夹了就是"显示 10s、实出 14s"） */}
            ⚙ {blockout && tpl?.refVideo ? tpl.refVideo.durationSec : clampDuration(prop.durationSec, node.videoTier)}s ·{" "}
            {tierOf(node.videoTier).label} · {aspectOf(node.aspect).label}
          </button>
          {done && (
            <button
              onClick={openAnnotator}
              disabled={busy}
              /* 收成两个字：这一行现在还要放素材按钮，"圈选改画面"会把生成按钮挤到折行 */
              title="圈选改画面"
              className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-40"
            >
              ⭕ 圈选
            </button>
          )}
          <button
            onClick={() => void onMain()}
            disabled={mainDisabled}
            title={AI_REAL ? `预计消耗 ${fmtTokens(mainCost)} token` : undefined}
            className={`min-w-0 flex-1 rounded-lg py-2 text-xs font-bold disabled:opacity-40 ${
              stage === "rederive" ? "bg-gold/90 text-ink" : "bg-brand text-ink"
            }`}
          >
            {mainLabel}
          </button>
          {/* 素材入口。就贴在「生成本段」旁边，因为它改的正是这一段要炼成什么样。
              图案是 Q 版看板娘抱着牌：收起时躲在牌后只露眼睛，展开时把牌举起来大笑，
              两态之间是同一条 8 帧序列正播/倒播（见 MaterialButtonArt）。
              角标是本段已挂的张数——加卡那一下按钮会抖一下（key 换了动画才会重播，
              同 CharacterPerch 那套做法）。 */}
          <button
            key={matShake}
            onClick={onToggleMat}
            aria-label={`本段素材 ${matCount} 张`}
            title="本段素材"
            /* 不裁圆角：让她连人带牌探出钮外一点，比塞进一个圆里更有"她在按钮上"的味道 */
            className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-full transition ${
              matOpen ? "bg-brand/20 ring-2 ring-brand" : "bg-panel ring-1 ring-slate-700"
            } ${matShake > 0 ? "mat-shake" : ""}`}
          >
            <MaterialButtonArt open={matOpen} size={42} />
            {matCount > 0 && (
              <span className="absolute -right-1 -top-1 z-10 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-ink">
                {matCount}
              </span>
            )}
          </button>
        </div>

        {/* 出片之后才给"往下走"。最后一段没有下一段可去，改成就地追加一段——
            底部节点条上的 ＋ 现在也要等出片才亮，这里是同一条规则的另一个入口 */}
        {done &&
          (index < total - 1 ? (
            <button
              onClick={() => shiftCursor(1)}
              disabled={busy}
              className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 py-2 text-xs font-bold text-emerald-200 disabled:opacity-40"
            >
              ✓ 这段满意，去下一段
            </button>
          ) : simple ? null : (
            <button
              onClick={() => addNode()}
              disabled={busy}
              className="w-full rounded-lg border border-emerald-400/40 bg-emerald-500/15 py-2 text-xs font-bold text-emerald-200 disabled:opacity-40"
            >
              ✓ 这段满意，再加一段
            </button>
          ))}
      </div>

      {/* 炼卡浮层：压住整屏，中央看板娘 + 这一段的步骤日志 */}
      {forge && (
        <ForgeOverlay
          phase={forge}
          steps={node.steps ?? []}
          // 余额不足这类"还没进流程就被拦下"的失败没有 node.error，只有 store 的 err
          error={node.error || err}
          onClose={() => setForge(null)}
        />
      )}

      {/* ── 本段设置抽屉 ── */}
      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/70" onClick={() => setSheet(false)}>
          {/* 同上：safe-bottom 会把 p-4 的下内边距吃成 0，两个值合成一个写 */}
          <div
            className="w-full space-y-3 rounded-t-2xl bg-ink p-4"
            style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-100">第 {index + 1} 段设置</span>
              <button onClick={() => setSheet(false)} className="text-slate-400">
                <Icon name="close" size={18} />
              </button>
            </div>

            {/* ★ 白模节点**没有时长选择器**（仓库主人拍板）：时长 = 模板的登记时长，
                edit 输出≈输入是协议行为，不吃 clampDuration 的 10s 上限（那是纯 t2v
                档位的产品约束）。摆一排点了不生效的时长按钮就是骗人 —— 换成一句明说 */}
            {blockout && tpl?.refVideo ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
                <span className="text-[11px] text-slate-300">
                  {tpl.refVideo.durationSec}s · 跟随模板视频（白模复刻的输出时长≈模板时长，不可另选）
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
                {DURATIONS.map((d) => {
                  // ★ 短于本档下限的时长直接禁掉并说明：Seedance 2.5 的合法区间是 [4,30]，
                  //   3 秒发过去是同步 400，用户只会觉得"这一档坏了"（见 VideoTier.minSec）
                  const tooShort = d < tierOf(node.videoTier).minSec;
                  return (
                    <button
                      key={d}
                      onClick={() => updateProposal(node.id, { durationSec: d })}
                      disabled={tooShort}
                      title={tooShort ? `「${tierOf(node.videoTier).label}」最短 ${tierOf(node.videoTier).minSec} 秒` : undefined}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${prop.durationSec === d ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            )}

            {/* 画幅：已出片的段不给改——改了这一段的成片还是老画幅，
                用户以为改完就变了，直到剪辑页合并才发现这一段被裁/补了边 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">画幅</span>
              {VIDEO_ASPECTS.map((a) => (
                <button
                  key={a.id}
                  onClick={() => updateNode(node.id, { aspect: a.id })}
                  // ★ 白模禁改：真正的出片画幅是 adaptive 跟随模板视频（arkClient 的
                  //   BLOCKOUT_TASK 整体接管 ratio），这排按钮点了不会改变产出 ——
                  //   摆着能点就是"改了不生效"的骗人选项
                  disabled={done || blockout}
                  title={
                    blockout
                      ? "白模复刻的画幅自适应模板视频，不可另选"
                      : done
                        ? "这一段已出片，改画幅要重新生成才生效"
                        : a.desc
                  }
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
                    node.aspect === a.id ? "bg-brand text-ink" : "bg-panel text-slate-300"
                  }`}
                >
                  <span
                    className={`block rounded-[2px] border-2 ${node.aspect === a.id ? "border-ink/70" : "border-slate-400"}`}
                    style={{ width: a.id === "portrait" ? 8 : 14, height: a.id === "portrait" ? 14 : 8 }}
                  />
                  {a.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 flex-none text-[11px] text-slate-400">画质</span>
              {VIDEO_TIERS.map((t) => {
                // ★ 白模节点上，不支持 r2v 的档位也要禁掉（判断在 economy.r2vPriceIssue
                //   一处）：切过去出片必被 segmentGen 的门禁整句拒绝，让人选一个必失败的
                //   档位不如当场说不能选。价目也不能对这些档位问 nodeCost —— 那会走进
                //   segmentCost 的"没 r2v 价还硬报"兜底（按最贵系数 + console.error 点名），
                //   而这里不是门禁被改坏，只是一排比价按钮
                const r2vBlock = blockout ? r2vPriceIssue(t.id) : null;
                const block = tierBlockReason(t) ?? r2vBlock;
                return (
                  <button
                    key={t.id}
                    onClick={() => updateNode(node.id, { videoTier: t.id })}
                    disabled={!!block}
                    title={block ?? `${t.desc}（${t.model}）`}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${node.videoTier === t.id ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
                  >
                    {/* ★ 与主按钮同一把尺子（nodeCost，只是把档位换成这一档）：光报 segTokens
                        会漏掉"这一档还得补画几张设定帧"，而简约模式正是两张都要补的那条路 ——
                        于是抽屉里写 108k、外面按钮写 134.6k，用户在**比价**的这一步被少报 */}
                    {r2vBlock ? t.label : <>{t.label} · {fmtTokens(nodeCost(nodes, index, mode, t.id))}</>}
                  </button>
                );
              })}
            </div>
            {/* ★ 点不动就必须写出为什么。只把按钮灰掉的话，用户只会觉得"这功能坏了"
                （CLAUDE.md「界面上摆一个永远点不动的选项」）。title 在手机上没有 hover，
                所以原因得**印在页面上**，不能只挂在 title 里 */}
            {(tierBlocks.length > 0 || r2vBlocks.length > 0) && (
              <p className="text-[10px] leading-4 text-amber-300/80">
                {[...tierBlocks, ...r2vBlocks].join("；")}
                {/* 「去升级」只治得了套餐门槛那类原因；r2v 闸门没开不是充钱能解决的，
                    只有套餐原因在场时才给这个链接。间隔用全角空格字面量——JSX 会把
                    行间换行整个吃掉，靠折行留空隙是留不住的 */}
                {tierBlocks.length > 0 && (
                  <>
                    {"　"}
                    <Link to="/me" className="underline">
                      去升级
                    </Link>
                  </>
                )}
              </p>
            )}
            {/* ★ 把**真正会被调用的那个模型**写出来。「极速/标准/高清」只说了画质档次，
                没说这一段到底交给谁去生成 —— 而不同世代的模型（1.0 / 2.0）观感差别很大，
                用户对不上账时无从判断。这里显示的是 tierOf(...).model 推导出来的名字，
                与发给方舟的 id 同源，不会出现"界面写着一个、实际跑另一个"。
                title 里给完整 id，要查证的人一眼能看到。 */}
            <div className="text-[10px] text-slate-500" title={tierOf(node.videoTier).model}>
              本段模型：{modelLabel(tierOf(node.videoTier).model)}
              <span className="ml-1 opacity-70">· {tierOf(node.videoTier).desc}</span>
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
  const { nodes, cursor, mode, origin, busy, err, setCursor, addNode, removeNode, addMaterials, removeMaterial, reset } =
    useFlow();
  const [finalizing, setFinalizing] = useState("");
  const [tplExtract, setTplExtract] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /** 素材窗口开着 = 底部那条也换成本段素材（见下面的底部区） */
  const [matOpen, setMatOpen] = useState(false);
  /** 每加一次素材 +1，传给圆形按钮当 key 让抖动重播 */
  const [matShake, setMatShake] = useState(0);
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
  /** 还没出片的第一段 = 用户最远能走到的地方（-1 表示全出片了，随便看） */
  const frontier = frontierOf(nodes);
  /**
   * 按下「完成视频」那一下还要花的钱（组稿时提炼本片卡组，撞上 3D 关键词再加建模）。
   *
   * ★★ 这笔钱以前**从头到尾没在界面上出现过**：顶栏只累加各段的出片费，而组稿会再烧
   *   最多 110k（8 张卡）+ 最多 320k（2 个建模）。用户照着顶栏那个数攒余额，
   *   点完「完成视频」发现少了一大截 —— CLAUDE.md「页面报 ¥25、实际扣 ¥15」那条的放大版。
   * ★ 报价与实收同一处实现：deckQuoteOf 与 finalizeFromFlow 读的是同一个 mode、
   *   同一份文字、同一批常量（见 studioStore.deckQuoteOf）。简约模式它返回全 0 ——
   *   那条路**不报也不收**。
   */
  const deck = useMemo(() => deckQuoteOf(nodes, mode), [nodes, mode]);
  /** 顶栏那个"剩余约"。★ 把组稿那一笔一起算进去：分开显示两个数，用户没有任何理由
   *  相信它们要相加，而"我还得准备多少 token"是一个数不是两个。 */
  const remain = useMemo(() => flowCost(nodes, mode) + deck.total, [nodes, mode, deck.total]);
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
      // ★ mode 显式传过去：「简约模式不出卡组」这条规则由它决定，而 store 里偷读
      //   useFlow 的话，这个调用点上根本看不出"模式会改变这次组稿花多少钱"。
      //   与上面 deckQuoteOf 报价时读的是同一个 mode —— 报什么价就收什么钱。
      const st = useFlow.getState();
      const ok = await useStudio.getState().finalizeFromFlow(st.nodes, st.mode, (s) => setFinalizing(s));
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
        {/* 收口按钮：全部出片后把各段并成一条片子（去剪辑页合并）。
            这里原来是「⚡ 炼完剩余 N 段」——那条路与"逐段确认"是对着干的：
            它让用户在没看过第一段效果之前，就把后面几段的钱一次性烧掉。
            现在只留一个终点，没出片时明说还差几段，而不是给一个点了就批量扣费的入口。 */}
        <button
          onClick={() => void toCut()}
          disabled={!allDone || busy || !!finalizing}
          title={allDone ? "把各段合成一条完整视频" : "每段都出片之后才能合成"}
          className="flex-none rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
        >
          {/* 文案要短：375px 宽的顶栏还得放返回、标题、进度、存草稿四样，
              带上「还差 N 段」会把中间那行进度挤成一个省略号。
              "还差几段"由旁边的「N 段 · 已出片 M」交代，这里只留终点本身 */}
          {finalizing || "完成视频"}
          {allDone && " ›"}
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

      {/* ★★ 组稿前把「完成视频」那一下要花的钱明说出来。
          为什么单开一行而不是塞进按钮上：那颗按钮在 375px 顶栏里与返回/标题/进度/存草稿
          挤在一起，多两个字就把中间那行进度压成省略号（CLAUDE.md 那条底缘几何的同类问题）。
          为什么等到 allDone 才出现：在那之前按钮是灰的，用户此刻要读的是"下一段多少钱"；
          整片的这一笔一直算在顶栏「剩余约」里，不会因为这行没出现就瞒着他。
          ⚠ 措辞三处都不许含糊：**最多**（张数是上限，按实际出卡结算）、
          **约**（单价还没与火山账单对过，见 economy 的 ⚠）、以及余额不足会自动跳过
          （那是 finalizeFromFlow 真实的行为，不写的话用户会以为钱不够就完不成片）。 */}
      {deck.on && AI_REAL && allDone && (
        <div className="mx-4 mb-1.5 flex-none rounded-xl border border-slate-700/70 bg-panel px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          {/* ★ 整句在 JS 里拼好再交给 JSX：分成几段写的话，JSX 会把每行之间的换行折成
              一个空格，于是条件那一支不成立时就变成「…token 。都按实际…」——
              中文标点前多一个空格，看着像是文案坏了 */}
          {[
            `点「完成视频」还会提炼本片卡组：最多 ${deck.maxCards} 张卡，约 ${fmtTokens(deck.cards)} token`,
            deck.wants3d
              ? `；这条片写了 3D / 建模一类的画风，还会给派生的角色卡铸最多 ${deck.max3d} 个 3D 建模，另约 ${fmtTokens(deck.model3d)} token`
              : "",
            "。都按实际出卡结算，余额不够会自动跳过（成片不受影响）。",
          ].join("")}
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
        <NodeScreen
          key={node.id}
          node={node}
          index={cursor}
          total={nodes.length}
          matOpen={matOpen}
          matShake={matShake}
          onToggleMat={() => setMatOpen((v) => !v)}
        />
      </div>

      {/* ── 底部区：素材窗口开着时是【本段素材】，否则是【整条流水线的节点条】──
          这两样是同一块地方的两种用途：素材窗口一打开，用户关心的就是"这一段用哪些卡"，
          此时还占着位置的节点条只是噪音（而且那会儿他也不该跳段）。 */}
      {(!simple || matOpen) && (
        <div
          className="flex-none border-t border-slate-800 bg-[#141821] px-3 pt-2.5"
          /* ★ 不能写 `safe-bottom pb-3`：.safe-bottom 在 index.css 里排在 @tailwind utilities
             之后，两条都是 padding-bottom，后写的赢 —— 于是没有安全区的设备（桌面、
             大多数安卓）padding-bottom 直接变成 0，素材卡整排贴死在屏幕最底边。
             两个值必须合成一个。素材条比节点条高，多留一点。 */
          style={{ paddingBottom: `calc(${matOpen ? "1rem" : "0.75rem"} + env(safe-area-inset-bottom, 0px))` }}
        >
          {matOpen ? (
            <MaterialStrip materials={node.materials ?? []} onRemove={(id) => removeMaterial(node.id, id)} />
          ) : (
            <>
              {/* 节点条 = 进度轨：已出片的和当前这段可以点，再往后是锁着的。
                  真正的拦截在 flowStore.clampCursor，这里画出"为什么点不动" */}
              <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
                {nodes.map((n, i) => {
                  const p = chosenOf(n);
                  const locked = frontier >= 0 && i > frontier;
                  return (
                    <button
                      key={n.id}
                      onClick={() => setCursor(i)}
                      disabled={locked}
                      aria-label={`第 ${i + 1} 段${locked ? "（还没轮到）" : ""}`}
                      /* 定高不定宽：缩略图按本段画幅撑出宽度，横竖一眼能分出来
                         （写死 16:9 的话，竖屏段在这条里被裁得只剩腰） */
                      style={{ aspectRatio: aspectCss(n.aspect) }}
                      className={`relative h-11 flex-none overflow-hidden rounded-lg border-2 ${
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
                      {locked && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                          <Icon name="lock" size={13} className="text-white/75" />
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* 只能在末尾追加，且上一段必须已出片（同一条规则在 flowStore.addNode 里兜底） */}
                <button
                  onClick={() => addNode()}
                  disabled={busy || !nodeDone(nodes[nodes.length - 1])}
                  title={nodeDone(nodes[nodes.length - 1]) ? "加一段" : "先把当前这段炼出来"}
                  className="h-11 w-11 flex-none rounded-lg border border-dashed border-slate-600 text-slate-400 disabled:opacity-30"
                  aria-label="加一段"
                >
                  ＋
                </button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
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
            </>
          )}
        </div>
      )}

      {/* 素材窗口：从屏幕上方落下，拖卡到屏幕中间交给看板娘 */}
      {matOpen && (
        <MaterialSheet
          materials={node.materials ?? []}
          onAdd={(cards) => {
            const n = addMaterials(node.id, cards);
            if (n > 0) setMatShake((k) => k + 1); // 一张没加就别抖——抖了等于说"加上了"
            return n;
          }}
          onClose={() => setMatOpen(false)}
        />
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
