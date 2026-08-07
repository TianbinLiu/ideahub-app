// 工作流页：一条竖排的节点流水线，逐段生成、逐段确认。
//
// 为什么不做 2D 画布（对标 libTV / 桌面版树画布）：手机上双指缩放 + 拖拽定位一个
// 210px 卡片是折磨，而这条产品线本来就是竖屏优先。树形结构在工坊那边已经存在，
// 到了工作流只剩一条"活动路径"要跑——竖排列表恰好就是它的形状。
//
// 三种入口共用本页：
//   工坊模式 → startFlow() 把活动路径铺进来（节点带素材卡与方案 id）
//   工作流模式 → seedSolo("workflow")，空节点自己写
//   简约模式 → seedSolo("simple")，只有一个节点，UI 收到最简
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FrameAnnotator, { drawCover } from "../components/FrameAnnotator";
import Icon from "../components/Icon";
import { AI_REAL } from "../ai";
import { VIDEO_TIERS, fmtTokens, segTokens } from "../data/economy";
import { walletOf } from "../data/account";
import { FlowNode, flowCost, useFlow } from "../studio/flowStore";
import { useStudio } from "../studio/studioStore";
import { useMediaUrl } from "../utils/mediaUrl";
import { formatDuration } from "../types";

const DURATIONS = [3, 5, 6, 8, 10];

/** 单个节点卡：折叠时只是一行缩略图，展开后是这一段的全部可调项 + 生成/确认动作 */
function NodeCard({
  node,
  index,
  total,
  active,
  onOpen,
}: {
  node: FlowNode;
  index: number;
  total: number;
  active: boolean;
  onOpen: () => void;
}) {
  const { mode, busy, updateNode, removeNode, moveNode, addAnn, removeAnn, genNode, setCursor } = useFlow();
  const simple = mode === "simple";
  const vsrc = useMediaUrl(node.videoUrl, { forCapture: true });
  const vref = useRef<HTMLVideoElement>(null);
  const [annOpen, setAnnOpen] = useState<{ frame: string; atSec: number } | null>(null);

  const cost = segTokens(node.durationSec, node.videoTier);
  const done = node.status === "done";

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
    } else if (node.firstFrame) {
      setAnnOpen({ frame: node.firstFrame, atSec: 0 });
    }
  }

  return (
    <div className="relative pl-9">
      {/* 左侧序号 + 连接线：一眼看出这是第几段、和上下段是连着的 */}
      <div className="absolute left-0 top-0 flex h-full w-9 flex-col items-center">
        <div
          className={`z-10 flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold ${
            done
              ? "bg-emerald-500/85 text-ink"
              : node.status === "generating"
                ? "bg-brand text-ink"
                : node.status === "failed"
                  ? "bg-rose-500/85 text-white"
                  : active
                    ? "bg-slate-200 text-ink"
                    : "bg-slate-700 text-slate-300"
          }`}
        >
          {done ? "✓" : index + 1}
        </div>
        {index < total - 1 && <div className="w-px flex-1 bg-slate-700" />}
      </div>

      <div
        className={`mb-3 overflow-hidden rounded-2xl border ${
          active ? "border-brand/60 bg-panel" : "border-slate-700/60 bg-panel/60"
        }`}
      >
        {/* 预览区：出片后放视频，否则放设定首帧 */}
        <button onClick={onOpen} className="block w-full text-left">
          {done && vsrc ? (
            <video
              ref={vref}
              src={vsrc}
              muted
              playsInline
              controls={active}
              className="aspect-video w-full bg-black object-cover"
            />
          ) : node.firstFrame ? (
            <img src={node.firstFrame} alt="" className="aspect-video w-full object-cover" />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center border-b border-dashed border-slate-600 bg-slate-800/40 text-xs text-slate-500">
              {node.status === "generating" ? "生成中…" : "还没有画面"}
            </div>
          )}
        </button>

        <div className="p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
              {node.title || `第 ${index + 1} 段`}
            </span>
            {node.status === "generating" ? (
              <span className="flex-none animate-pulse text-[11px] text-brand">{node.progress || "生成中…"}</span>
            ) : done ? (
              <span className="flex-none text-[11px] text-emerald-300">
                {node.videoUrl ? "✓ 已出片" : "✓ 已完成（演示帧）"}
              </span>
            ) : node.status === "failed" ? (
              <span className="flex-none text-[11px] text-rose-300">✗ 失败</span>
            ) : (
              <span className="flex-none text-[11px] text-slate-500">
                {node.durationSec}s · {fmtTokens(cost)}
              </span>
            )}
          </div>
          {!active && node.plot && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-400">{node.plot}</p>
          )}
          {node.error && active && (
            <p className="mt-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{node.error}</p>
          )}

          {active && (
            <div className="mt-2.5 space-y-2.5">
              {/* ── 这一段拍什么 ── */}
              {!simple && (
                <input
                  value={node.title}
                  onChange={(e) => updateNode(node.id, { title: e.target.value })}
                  maxLength={24}
                  placeholder="这一段叫什么"
                  className="w-full rounded-lg border border-slate-700 bg-ink px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                />
              )}
              <textarea
                value={node.plot}
                onChange={(e) => updateNode(node.id, { plot: e.target.value })}
                rows={simple ? 4 : 3}
                maxLength={400}
                placeholder={
                  simple
                    ? "想拍什么？例：雨夜的东京街头，霓虹灯牌下一只黑猫慢慢走过积水，倒影闪烁"
                    : "这一段的画面与剧情（会直接作为生成提示词）"
                }
                className="w-full resize-none rounded-lg border border-slate-700 bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
              />

              {/* ── 时长 ── */}
              <div className="flex items-center gap-1.5">
                <span className="flex-none text-[11px] text-slate-400">时长</span>
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => updateNode(node.id, { durationSec: d })}
                    className={`rounded-lg px-2 py-1 text-[11px] ${
                      node.durationSec === d ? "bg-brand text-ink" : "bg-slate-700/60 text-slate-300"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>

              {/* ── 档位 ── */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="flex-none text-[11px] text-slate-400">画质</span>
                {VIDEO_TIERS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => updateNode(node.id, { videoTier: t.id })}
                    title={t.desc}
                    className={`rounded-lg px-2 py-1 text-[11px] ${
                      node.videoTier === t.id ? "bg-brand text-ink" : "bg-slate-700/60 text-slate-300"
                    }`}
                  >
                    {t.label} · {fmtTokens(segTokens(node.durationSec, t.id))}
                  </button>
                ))}
              </div>

              {/* ── 衔接上一段 ── */}
              {index > 0 && (
                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={node.chain}
                    onChange={(e) => updateNode(node.id, { chain: e.target.checked })}
                    className="accent-brand"
                  />
                  从上一段的真实结尾画面接着拍（关掉则用本段自己的起拍图）
                </label>
              )}

              {/* ── 素材卡（工坊带过来的） ── */}
              {!!node.materials?.length && (
                <div className="flex flex-wrap gap-1">
                  {node.materials.map((c) => (
                    <span key={c.id} className="rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300">
                      {c.name}
                    </span>
                  ))}
                </div>
              )}

              {/* ── 圈选标注列表 ── */}
              {node.anns.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {node.anns.map((a) => (
                    <div key={a.id} className="relative w-32 flex-none overflow-hidden rounded-lg border border-slate-700 bg-ink">
                      <img src={a.frame} alt="" className="h-16 w-full object-cover" />
                      <div className="truncate px-1.5 py-1 text-[10px] text-slate-300" title={a.req}>
                        {a.req}
                      </div>
                      <button
                        onClick={() => removeAnn(node.id, a.id)}
                        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] text-slate-200"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* ── 动作区 ── */}
              <div className="flex flex-wrap gap-1.5">
                {done && (
                  <button
                    onClick={openAnnotator}
                    disabled={busy}
                    className="rounded-lg bg-slate-700/60 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
                  >
                    ⭕ 圈选此帧改画面
                  </button>
                )}
                {!simple && (
                  <>
                    <button
                      onClick={() => moveNode(node.id, -1)}
                      disabled={busy || index === 0}
                      className="rounded-lg bg-slate-700/60 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-30"
                    >
                      ◀ 前移
                    </button>
                    <button
                      onClick={() => moveNode(node.id, 1)}
                      disabled={busy || index === total - 1}
                      className="rounded-lg bg-slate-700/60 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-30"
                    >
                      后移 ▶
                    </button>
                    <button
                      onClick={() => removeNode(node.id)}
                      disabled={busy || total <= 1}
                      className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-[11px] text-rose-300 disabled:opacity-30"
                    >
                      🗑 删除
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={() => void genNode(node.id)}
                disabled={busy || !node.plot.trim()}
                className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {node.status === "generating"
                  ? node.progress || "生成中…"
                  : done
                    ? `♻ 按修改重新生成本段（${fmtTokens(cost)}）`
                    : `⚡ 生成第 ${index + 1} 段（${fmtTokens(cost)}）`}
              </button>

              {done && index < total - 1 && (
                <button
                  onClick={() => setCursor(index + 1)}
                  disabled={busy}
                  className="w-full rounded-xl border border-emerald-400/40 bg-emerald-500/15 py-2 text-sm font-bold text-emerald-200 disabled:opacity-40"
                >
                  ✓ 这段满意，去下一段
                </button>
              )}
            </div>
          )}
        </div>
      </div>

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
  const { nodes, cursor, mode, origin, busy, err, setCursor, addNode, reset } = useFlow();
  const [finalizing, setFinalizing] = useState("");
  const simple = mode === "simple";

  // 直接输地址进来（或热更新丢了状态）：没节点就回创作入口，别停在空白页。
  // leavingRef 是必需的：组稿成功后 reset() 清空节点，本效应会在 navigate("/cut")
  // 落地前抢跑，把用户按回 /create（实测踩到过）
  const leavingRef = useRef(false);
  useEffect(() => {
    if (nodes.length === 0 && !leavingRef.current) navigate("/create", { replace: true });
  }, [nodes.length, navigate]);

  const allDone = nodes.length > 0 && nodes.every((n) => n.status === "done");
  const remain = useMemo(() => flowCost(nodes), [nodes]);
  const wallet = walletOf();

  if (nodes.length === 0) return null;

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
    <div className="min-h-full pb-24">
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-3">
          <button
            onClick={() => navigate(origin === "studio" ? "/studio" : "/create")}
            className="flex items-center gap-1 text-slate-400 hover:text-white"
          >
            <Icon name="back" size={18} />
          </button>
          <span className="font-bold text-slate-100">{simple ? "简约模式" : "工作流"}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {simple ? "一个节点，一条短片" : `${nodes.length} 段 · 已完成 ${nodes.filter((n) => n.status === "done").length}`}
            {AI_REAL && remain > 0 && ` · 剩余约 ${fmtTokens(remain)}`}
          </span>
          <button
            onClick={() => void toCut()}
            disabled={!allDone || busy || !!finalizing}
            className="flex-none rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-35"
          >
            {finalizing || "去剪辑 ›"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pt-3">
        {err && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <span className="min-w-0 flex-1">{err}</span>
            <button onClick={() => useFlow.setState({ err: "" })} className="flex-none">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {nodes.map((n, i) => (
          <NodeCard
            key={n.id}
            node={n}
            index={i}
            total={nodes.length}
            active={i === cursor}
            onOpen={() => setCursor(i)}
          />
        ))}

        {!simple && (
          <button
            onClick={() => addNode()}
            disabled={busy}
            className="ml-9 w-[calc(100%-2.25rem)] rounded-2xl border border-dashed border-slate-600 py-3 text-xs text-slate-400 hover:border-brand disabled:opacity-40"
          >
            ＋ 加一段
          </button>
        )}

        <div className="mt-4 space-y-1 text-center text-[11px] leading-relaxed text-slate-500">
          <p>
            总时长 {formatDuration(nodes.reduce((s, n) => s + n.durationSec, 0))}
            {AI_REAL && wallet && ` · 余额 ${fmtTokens(wallet.plan + wallet.addon)}`}
          </p>
          <p>{allDone ? "全部段落已完成，去剪辑页排顺序、加音频、导出成片。" : "一段一段来：满意了再往下走，不满意就在画面上圈出来重炼。"}</p>
        </div>
      </main>
    </div>
  );
}
