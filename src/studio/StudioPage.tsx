// 卡片工坊页：3D 画布 + HTML 交互层（NPC 对话 / 弹窗 / 提示条 / 卡组翻页箭头）
import { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Link, useNavigate } from "react-router-dom";
import TableScene from "./scene/TableScene";
import { composable, placeholderVisible, useStudio } from "./studioStore";
import { DEFAULT_CAM, SPREAD } from "./scene/layout";
import NpcDialog from "./ui/NpcDialog";
import { CardDetailModal, ComposeOverlay, NodeEditorModal, ProposalModal } from "./ui/modals";

function useHint(): string {
  const deckLen = useStudio((s) => s.deck.length);
  const root = useStudio((s) => s.root);
  const editorOpen = useStudio((s) => !!s.editor);
  const expandedNodeId = useStudio((s) => s.expandedNodeId);
  const marketOpen = useStudio((s) => s.market.open);
  if (editorOpen) return "填入素材卡与视频要求，AI 将推演三种走向";
  if (marketOpen) return "点击桌上的市场卡片可放大查看，喜欢就收进卡组";
  if (!root && deckLen === 0) return "先把素材交给铸卡师炼卡，或让 TA 摊开市场";
  if (!root) return "点击左侧虚线卡位，铸造第一段视频节点";
  if (expandedNodeId || !composable(root)) return "点击方案卡查看首尾帧与剧情，选定后将向右延展";
  if (placeholderVisible(root)) return "继续点击虚线卡位延展下一段，或点击中线右端的金色圆台合成完整视频";
  return "点击节点卡可重新展开三种走向";
}

export default function StudioPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const composing = useStudio((s) => s.composing);
  const initGreet = useStudio((s) => s.initGreet);
  const spreadOpen = useStudio((s) => s.spreadOpen);
  const deckLen = useStudio((s) => s.deck.length);
  const shiftSpread = useStudio((s) => s.shiftSpread);
  const hint = useHint();

  useEffect(() => {
    initGreet();
  }, [initGreet]);

  // 仅在“合成刚结束”那一刻跳转发布页，避免回到工坊被再次弹走
  const prevComposing = useRef(false);
  useEffect(() => {
    if (prevComposing.current && !composing && draft) navigate("/publish");
    prevComposing.current = composing;
  }, [composing, draft, navigate]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink">
      <Canvas
        dpr={[1, 2]}
        gl={{ preserveDrawingBuffer: true }}
        camera={{ fov: 42, position: DEFAULT_CAM.pos, near: 0.1, far: 80 }}
      >
        <TableScene />
      </Canvas>

      {/* 顶栏 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between p-4">
        <Link
          to="/"
          className="pointer-events-auto rounded-full bg-panel/80 px-4 py-2 text-sm text-slate-300 backdrop-blur hover:text-white"
        >
          ← 返回首页
        </Link>
        <div className="rounded-full bg-panel/80 px-4 py-2 text-sm font-semibold text-brand backdrop-blur">
          🎴 卡片工坊 · AI 视频创作
        </div>
      </div>

      {/* 底部提示条 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <div className="rounded-full bg-panel/80 px-5 py-2 text-sm text-slate-300 backdrop-blur">{hint}</div>
      </div>

      {/* 卡组展开翻页箭头 */}
      {spreadOpen && deckLen > SPREAD.maxVisible && (
        <div className="absolute bottom-24 left-[12%] flex gap-3">
          <button
            onClick={() => shiftSpread(-1)}
            className="h-10 w-10 rounded-full bg-panel/90 text-lg text-slate-200 backdrop-blur hover:bg-slate-700"
          >
            ‹
          </button>
          <button
            onClick={() => shiftSpread(1)}
            className="h-10 w-10 rounded-full bg-panel/90 text-lg text-slate-200 backdrop-blur hover:bg-slate-700"
          >
            ›
          </button>
        </div>
      )}

      <NpcDialog />
      <CardDetailModal />
      <NodeEditorModal />
      <ProposalModal />
      <ComposeOverlay />
    </div>
  );
}
