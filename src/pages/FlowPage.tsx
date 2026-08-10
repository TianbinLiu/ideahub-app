// 工作流页：一屏一个节点卡，横向切节点、纵向切走向。
//
// 这就是工坊的节点卡，只是脱掉了 3D 桌面：一个节点持有若干走向方案，左右箭头/横划
// 换节点，上下箭头/竖划换走向——与工坊里点节点卡看三种走向是同一件事。
//
// 三种入口共用本页：
//   工坊模式 → startFlow() 把活动路径整卡搬进来（含全部走向、素材卡、档位）
//   工作流模式 → seedSolo("workflow")，可现场让 AI 推演三种走向
//   简约模式 → seedSolo("simple")，单节点单走向，UI 收到最简
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
import { walletOf } from "../data/account";
import { myTemplates } from "../data/templates";
import { VIDEO_TIERS, fmtTokens, segTokens, tierOf } from "../data/economy";
import { FlowNode, chosenOf, flowCost, frontierOf, nodeDone, nodeVideo, useFlow } from "../studio/flowStore";
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

/** 一屏一个节点：预览 + 走向切换 + 本段可调项 + 生成/确认 */
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
    busy,
    err,
    updateNode,
    updateProposal,
    shiftProposal,
    genNode,
    deriveProposals,
    addAnn,
    removeAnn,
    shiftCursor,
    addNode,
  } = useFlow();
  const tpl = useFlow((s) => s.template);
  const simple = mode === "simple";
  const prop = chosenOf(node);
  const video = nodeVideo(node);
  const done = nodeDone(node);
  const realVideo = video && !video.startsWith("mock:") ? video : undefined;
  const vsrc = useMediaUrl(realVideo, { forCapture: true });
  const vref = useRef<HTMLVideoElement>(null);
  const [annOpen, setAnnOpen] = useState<{ frame: string; atSec: number } | null>(null);
  const [sheet, setSheet] = useState(false); // 底部「本段设置」抽屉
  /** 出片浮层。只由「生成本段」这一个入口开——推演走向也会把 status 置成 generating，
   *  跟着 status 走的话点"推演三种走向"会莫名其妙弹出炼卡动画 */
  const [forge, setForge] = useState<ForgePhase | null>(null);
  const matCount = node.materials?.length ?? 0;

  async function runGen() {
    if (busy) return;
    setForge("forging");
    const ok = await genNode(node.id);
    setForge(ok ? "done" : "failed");
  }

  const cost = segTokens(prop.durationSec, node.videoTier);
  const pIdx = node.proposals.findIndex((p) => p.id === node.chosenId);

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
      {/* ── 预览区（手势区）── */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black" {...swipe}>
        {done && vsrc ? (
          <video ref={vref} src={vsrc} muted playsInline controls className="max-h-full max-w-full" />
        ) : prop.firstFrame ? (
          <img src={prop.firstFrame} alt="" className="max-h-full max-w-full" />
        ) : (
          <div className="px-8 text-center text-xs leading-relaxed text-slate-500">
            {node.status === "generating" ? node.progress || "生成中…" : "还没有画面——在下面写清楚这一段要拍什么"}
          </div>
        )}

        {/* 左右换节点 */}
        {index > 0 && (
          <button
            onClick={() => shiftCursor(-1)}
            className="absolute left-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white"
            aria-label="上一段"
          >
            <Icon name="back" size={22} />
          </button>
        )}
        {/* 顺序门禁：本段没出片就过不去（真正的拦截在 flowStore.clampCursor，
            这里只是把"为什么点不动"画出来——否则用户会以为按钮坏了） */}
        {index < total - 1 && (
          <button
            onClick={() => shiftCursor(1)}
            disabled={!done}
            title={done ? "下一段" : "先把这一段炼出来"}
            className={`absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white ${
              done ? "" : "opacity-40"
            }`}
            aria-label={done ? "下一段" : "下一段（本段还没出片）"}
          >
            <Icon name={done ? "chevron" : "lock"} size={done ? 22 : 17} />
          </button>
        )}

        {/* 换走向：贴底居中的一枚药丸，⌃/⌄ 与"上下划"的手势方向对得上。
            不放右侧竖列——那里正是"下一段"箭头的位置，两组控件会叠在一起 */}
        {node.proposals.length > 1 && (
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/55 px-2 py-1">
            <button
              onClick={() => shiftProposal(node.id, -1)}
              className="flex h-6 w-6 rotate-90 items-center justify-center text-white"
              aria-label="上一个走向"
            >
              <Icon name="back" size={15} />
            </button>
            {node.proposals.map((p, i) => (
              <span
                key={p.id}
                className={`h-1.5 rounded-full ${i === pIdx ? "w-4 bg-brand" : "w-1.5"} ${
                  i === pIdx ? "" : node.videoByProposal[p.id] ? "bg-emerald-400/70" : "bg-white/35"
                }`}
              />
            ))}
            <button
              onClick={() => shiftProposal(node.id, 1)}
              className="flex h-6 w-6 rotate-90 items-center justify-center text-white"
              aria-label="下一个走向"
            >
              <Icon name="chevron" size={15} />
            </button>
          </div>
        )}

        {/* 状态角标 */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1">
          <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-slate-200">
            第 {index + 1}/{total} 段
            {node.proposals.length > 1 && ` · 走向 ${pIdx + 1}/${node.proposals.length}`}
          </span>
          {done && <span className="rounded-full bg-emerald-500/85 px-2 py-0.5 text-[11px] text-ink">✓ 已出片</span>}
          {node.status === "generating" && (
            <span className="animate-pulse rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-ink">
              {node.progress || "生成中…"}
            </span>
          )}
          {node.status === "failed" && (
            <span className="max-w-[70vw] truncate rounded-full bg-rose-500/85 px-2 py-0.5 text-[11px] text-white">
              ✗ {node.error}
            </span>
          )}
        </div>
      </div>

      {/* ── 本段内容 ── */}
      <div className="flex-none space-y-2 border-t border-slate-800 bg-ink px-4 pb-3 pt-2.5" data-noswipe>
        {/* 出片过程日志：跑着时展开，跑完自动收起但留着可回看 */}
        <GenTrace steps={node.steps ?? []} running={node.status === "generating"} />
        {!simple && (
          <input
            value={prop.title}
            onChange={(e) => updateProposal(node.id, { title: e.target.value })}
            maxLength={24}
            placeholder="这一段叫什么"
            className="w-full bg-transparent text-sm font-bold text-slate-100 outline-none placeholder:text-slate-600"
          />
        )}
        {tpl ? (
          /* 套了模板：用户只需要说"换成谁/什么主题"，其余由配方补齐。
             剧情框仍然可展开查看/微调——模板是起点不是牢笼 */
          <TemplateSubjectBox />
        ) : (
          <textarea
            value={prop.plot}
            onChange={(e) => updateProposal(node.id, { plot: e.target.value })}
            rows={simple ? 3 : 2}
            maxLength={400}
            placeholder={
              simple
                ? "想拍什么？例：雨夜的东京街头，霓虹灯牌下一只黑猫慢慢走过积水，倒影闪烁"
                : "这一段的画面与剧情（会直接作为生成提示词）"
            }
            className="w-full resize-none rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
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
              /* 收成两个字：这一行现在还要放素材按钮，"圈选改画面"会把生成按钮挤到折行 */
              title="圈选改画面"
              className="flex-none rounded-lg bg-panel px-2.5 py-2 text-[11px] text-slate-300 disabled:opacity-40"
            >
              ⭕ 圈选
            </button>
          )}
          <button
            onClick={() => void runGen()}
            disabled={busy || !prop.plot.trim()}
            className="min-w-0 flex-1 rounded-lg bg-brand py-2 text-xs font-bold text-ink disabled:opacity-40"
          >
            {node.status === "generating"
              ? node.progress || "生成中…"
              : done
                ? `♻ 重新生成（${fmtTokens(cost)}）`
                : `⚡ 生成本段（${fmtTokens(cost)}）`}
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

            {!simple && (
              <button
                onClick={() => {
                  setSheet(false);
                  void deriveProposals(node.id);
                }}
                disabled={busy}
                className="w-full rounded-xl bg-panel py-2.5 text-xs font-semibold text-slate-200 disabled:opacity-40"
              >
                🔮 让 AI 就这一段推演三种走向（可上下切换挑一个）
              </button>
            )}
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
  const doneCount = nodes.filter(nodeDone).length;
  const prevDone = useRef(doneCount);
  useEffect(() => {
    if (doneCount > prevDone.current) void useStudio.getState().saveWorkDraft({ from: "flow" });
    prevDone.current = doneCount;
  }, [doneCount]);

  const allDone = nodes.length > 0 && nodes.every(nodeDone);
  /** 还没出片的第一段 = 用户最远能走到的地方（-1 表示全出片了，随便看） */
  const frontier = frontierOf(nodes);
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
        {/* 手动存盘。自动保存只在"炼完一段"那种昂贵节点触发（见下面的 effect），
            纯改文字不会自动存——想留住就点这里 */}
        <button
          onClick={() => void saveNow()}
          disabled={saveState === "saving"}
          className="flex-none rounded-full bg-slate-700/80 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
        >
          {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存 ✓" : saveState === "failed" ? "保存失败" : "存草稿"}
        </button>
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
              <div className="flex items-center gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {nodes.map((n, i) => {
                  const p = chosenOf(n);
                  const locked = frontier >= 0 && i > frontier;
                  return (
                    <button
                      key={n.id}
                      onClick={() => setCursor(i)}
                      disabled={locked}
                      aria-label={`第 ${i + 1} 段${locked ? "（还没轮到）" : ""}`}
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
                      {nodeDone(n) && (
                        <span className="absolute right-0.5 top-0.5 rounded-full bg-emerald-500/90 px-1 text-[8px] text-ink">
                          ✓
                        </span>
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
