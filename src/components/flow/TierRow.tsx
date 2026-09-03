// 「这一段用哪个画质档」那一排 —— **两处共用的唯一实现**（本段设置抽屉 / 工坊节点卡角落）。
//
// 2026-08-30 从 SegSettings 抽出：工坊也要能就地换档（主人点名"把切换档位放入节点卡的角落"），
// 而这一排里攒着一串靠代价换来的规则：白模上不支持 r2v 的档要禁、原因必须印在页面上
// （手机没有 hover）、逐档报价必须问 nodeCost（光报 segTokens 会漏掉"这一档还得补几张
// 设定帧"，而用户正是在这一步比价）、换档同一拍要把时长吸附写回。抄第二份必然走样。
//
// ★★ 换到 1.0 两档（极速/标准）与真人档是**换一种出片方式**，不只是换个价：
//   它们协议上不收 reference_image（VideoTier.refImg 硬白名单），于是——
//   素材卡的形象图发不出去（只能在画设定帧时间接起作用）、参考视频用不了、台词音色带不了、
//   极速连尾帧都锁不住。这些都要在**换之前**说清楚，并且真正说不通的（挂着参考视频）
//   得当场清掉，否则出片会被 segmentGen 的门禁整句拒（钱没花，但用户白等一轮）。
import { useState } from "react";
import { Link } from "react-router";
import { tierBlockReason } from "../../data/account";
import { clampDuration, deriveIssue, fmtTokens, r2vPriceIssue, tierOf, VIDEO_TIERS } from "../../data/economy";
import { chosenOf, nodeCost, tplOfNode, useFlow } from "../../studio/flowStore";
import { carryIsHard } from "../../studio/segmentGen";

/**
 * 把这一段换到 `nextId` 档会**失去什么** —— 唯一实现（确认卡与提示语都读它）。
 * 空数组 = 换过去什么都不损失，直接换、不弹卡。
 *
 * ★ 只列**这一段真的有**的东西：泛泛地说"可能会有影响"等于没说，用户无从判断该不该换。
 */
export function tierSwitchLoss(nodeId: string, nextId: string): string[] {
  const s = useFlow.getState();
  const node = s.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const next = tierOf(nextId);
  const cur = tierOf(node.videoTier);
  const prop = chosenOf(node);
  const loss: string[] = [];
  // 参考视频：只有支持 r2v/参考视频的档带得动，换过去必须摘掉（不摘的话出片被整句拒）
  if (node.customRef && !next.refVid) {
    loss.push(`挂在这一段上的示例视频会被摘掉（「${next.label}」档带不了参考视频）`);
  }
  // 形象图：2.0 → 1.0 的核心落差。已经出过片的段不提这条（它已经拍完了）
  if (cur.refImg && !next.refImg && (node.materials?.length ?? 0) > 0) {
    loss.push(`挂的 ${node.materials!.length} 张素材卡不再直接进出片画面（只能在画设定帧时起作用，人物相似度会下降）`);
  }
  // 尾帧：极速档只认首帧
  if (cur.flf && !next.flf && prop.lastFrame) {
    loss.push(`这一段的结束画面不再锁得住（「${next.label}」档只认起拍帧）`);
  }
  // 音色样本。★ 与相邻两条同口径：只在**这一段真的有台词**时才提（引号里的台词才会被配音）
  if (cur.audio && !next.audio && /[「"']/.test(prop.plot)) {
    loss.push(`台词不再带音色样本（「${next.label}」档${next.flatCost ? "暂无配音" : "出片无声"}）`);
  }
  // ★ **升档也有变化**（2026-08-30 补）：收参考图的档上，帧改当参考图发 + 提示词点名
  //   （segmentGen 的 framesAsRefs）—— 卡片形象能同发了，但"必须从这一帧起拍"从协议级
  //   硬约束降成软引导。这是好事也是代价，两头都要说，不能只在降档时说。
  // ★ 判据走 segmentGen.carryIsHard 一处（2026-09-XX 收口）：这里原来手写
  //   `!cur.refImg && next.refImg`，与 framesAsRefs 是同一条规则的第二份实现 ——
  //   哪天加一档 flatCost 且收参考图的，两份必然只改到一份，而且零症状。
  if (carryIsHard(cur.id) && !carryIsHard(next.id) && (prop.firstFrame || prop.lastFrame)) {
    loss.push(`首尾帧会改成"参考图 + 提示词点名"发出去（换来的是素材卡形象能一起发；代价是起止画面不再是硬约束）`);
  }
  // 圈选改画面：白模那条不接受圈选，1.0 仍可（它就是首尾帧路），所以这里不提
  return loss;
}

export default function TierRow({
  nodeId,
  onDone,
  needsDerive,
}: {
  nodeId: string;
  onDone?: () => void;
  /** 宿主的主路要不要经过「推演三套」（工坊方案台 = 要）。为真时把走不了推演的档一并禁掉，
   *  否则用户切过去、再点重推，钱花在一次必被拒的操作上 */
  needsDerive?: boolean;
}) {
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const index = nodes.findIndex((n) => n.id === nodeId);
  const node = index >= 0 ? nodes[index] : undefined;
  /** 待确认的换档（非空 = 这一换有代价，先把话说完） */
  /** 待确认的换档。**存 nodeId** —— 卡摆着的时候用户可以用 ‹ › 翻到别的段（本组件不重挂，
   *  只是换了 prop），点「知道了」就会把这张卡的决定落到**另一段**上并静默摘掉它的示例视频。
   *  这是 CLAUDE.md「弹层按第几段记」那条坑的同款，判据一律认 id（2026-08-30 复核抓到）。 */
  const [ask, setAsk] = useState<{ nodeId: string; id: string; label: string; loss: string[] } | null>(null);
  if (!node) return null;
  const prop = chosenOf(node);
  const blockout = !!tplOfNode(node)?.refVideo;
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t)).filter((r): r is string => !!r);

  /** 真正落地：换档 + 时长吸附写回 + 清掉带不动的东西。
   *  ★ 从确认卡来的那一路会先核对 nodeId（见 ask 的注释）——对不上就整句拒，不静默照做 */
  function apply(id: string) {
    const flow = useFlow.getState();
    const next = tierOf(id);
    // ★★ 摘示例视频**要判返回值**（2026-08-30 复核抓到）：store 在生成中/已出片时会整句拒，
    //   而确认卡刚刚承诺过"它会被摘掉"。不判就会变成"档换了、视频还挂着"——下一次出片
    //   被 segmentGen 的门禁整句拒，用户拿着一句自相矛盾的界面无从下手（铁律八）。
    //   摘不掉就**整个不换**，把 store 给的那句原因摆出来。
    if (node!.customRef && !next.refVid && !flow.setCustomRefVideo(node!.id, null)) {
      setAsk(null);
      return; // 原因已在 flow.err 上（宿主都画它）
    }
    flow.updateNode(node!.id, { videoTier: id });
    // ★ 换档同一拍把时长**吸附写回**：换到按发档时 durationSec 可能停在 5/8，
    //   实扣按 clampDuration 吸附后的整档算 —— 不写回的话卡上写 5、账按 6
    const snapped = clampDuration(prop.durationSec, id);
    if (snapped !== prop.durationSec) flow.updateProposal(node!.id, { durationSec: snapped });
    setAsk(null);
    onDone?.();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-10 flex-none text-[11px] text-slate-400">画质</span>
        {VIDEO_TIERS.map((t) => {
          // ★ 白模节点上，不支持 r2v 的档位也要禁掉（判断在 economy.r2vPriceIssue 一处）：
          //   切过去出片必被门禁整句拒，让人选一个必失败的档不如当场说不能选
          const r2vBlock = blockout ? r2vPriceIssue(t.id) : null;
          // ★ 按发计价档（真人）走不了推演（判定在 economy.deriveIssue 一处）——工坊这一面
          //   的主路正是推演，切过去之后「重新推演三套」必被拒。宿主是画布时那条路还在
          //   （画布可以直出），所以这一条只在**需要推演**的宿主上拦：由 prop 决定。
          const block = tierBlockReason(t) ?? r2vBlock ?? (needsDerive ? deriveIssue(t.id) : null);
          return (
            <button
              key={t.id}
              onClick={() => {
                if (t.id === node.videoTier) return;
                const loss = tierSwitchLoss(node.id, t.id);
                if (loss.length) setAsk({ nodeId: node.id, id: t.id, label: t.label, loss });
                else apply(t.id);
              }}
              disabled={!!block}
              title={block ?? `${t.desc}（${t.model}）`}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
                node.videoTier === t.id ? "bg-brand text-ink" : "bg-panel text-slate-300"
              }`}
            >
              {/* ★ 与主按钮同一把尺（nodeCost，只把档位换成这一档）：光报 segTokens 会漏掉
                  "这一档还得补画几张设定帧"，而用户正是在**比价**的这一步被少报 */}
              {r2vBlock ? t.label : <>{t.label} · {fmtTokens(nodeCost(nodes, index, mode, t.id))}</>}
            </button>
          );
        })}
      </div>
      {/* ★ 点不动就必须写出为什么（手机上没有 hover，title 看不见），而且**只在这里写**：
          这排按钮归本组件，理由跟着按钮走 —— 宿主再写一份就会两处都印（实测本段设置抽屉
          里出现过两遍）。宿主自己的别的理由（r2v 闸、真人卡）仍由宿主印，那是另一件事。
          「去升级」只治得了套餐门槛那一类原因，所以跟着 tierBlocks 一起出现。 */}
      {tierBlocks.length > 0 && (
        <p className="text-[10px] leading-4 text-amber-300/80">
          {tierBlocks.join("；")}
          {/* 间隔用全角空格字面量——JSX 会把行间换行整个吃掉，靠折行留空隙留不住 */}
          {"　"}
          <Link to="/me" className="underline">
            去升级
          </Link>
        </p>
      )}
      {/* 换档的代价：**换之前**说，说的是这一段真的有的东西（tierSwitchLoss 一处判定） */}
      {ask && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
          <p className="text-[11px] font-semibold text-amber-200">换到「{ask.label}」档会有这些变化：</p>
          <ul className="space-y-0.5">
            {ask.loss.map((l) => (
              <li key={l} className="flex gap-1.5 text-[11px] leading-relaxed text-amber-100/90">
                <span className="flex-none">·</span>
                <span>{l}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] leading-relaxed text-slate-400">
            已经炼出来的成片不受影响；换回来之后这些能力也会回来（示例视频要重新挂）。
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (ask.nodeId !== node.id) {
                  // 卡摆着的时候用户翻到了别的段：这张卡说的是**那一段**的事，不能落到这一段上
                  useFlow.setState({ err: "这张确认卡是上一段的，已经作废——回到那一段再换档" });
                  setAsk(null);
                  return;
                }
                apply(ask.id);
              }}
              className="rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-bold text-ink"
            >
              知道了，换到「{ask.label}」
            </button>
            <button onClick={() => setAsk(null)} className="rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300">
              先不换
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
