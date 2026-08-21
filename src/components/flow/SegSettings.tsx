// 「本段设置」—— 时长 / 画幅 / 画质 / 承接开关，**两面共用的唯一实现**。
//
// ★★ 2026-08-21 从 FlowPage 的底部抽屉抽出来：画布也要能改这些（时长与画质**直接决定
//   这一段多少钱**，只在线性视图里能改等于画布不自足）。而这块里攒着一串靠代价换来的
//   规则 —— 白模的时长跟随模板不可另选、已出片不许改画幅、白模画幅 adaptive 不许选、
//   r2v 不支持的档位要禁掉且**把原因印在页面上**（手机没有 hover）、逐档报价必须问
//   nodeCost（光报 segTokens 会漏掉"这一档还得补几张设定帧"，用户正是在这一步比价）。
//   抄第二份的话，这些规则会一条一条地在另一面走样，而走样了不报错。
// ★ 组件自己认 node.id 从 store 读（与 PlanSheet / CardPicker 同款）：宿主只给一个 id，
//   不必把 index/nodes/mode 一路传下来，也就不会出现"传的是上一段"那类错。
import { Link } from "react-router";
import { tierBlockReason } from "../../data/account";
import { fmtTokens, modelLabel, r2vPriceIssue, tierOf, VIDEO_TIERS } from "../../data/economy";
import { chosenOf, nodeCost, nodeDone, tplOfNode, useFlow } from "../../studio/flowStore";
import { DURATIONS, VIDEO_ASPECTS } from "../../types";

export default function SegSettings({ nodeId }: { nodeId: string }) {
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const { updateProposal, updateNode } = useFlow();
  const index = nodes.findIndex((n) => n.id === nodeId);
  const node = index >= 0 ? nodes[index] : undefined;
  if (!node) return null;
  const prop = chosenOf(node);
  const done = nodeDone(node);
  const tpl = tplOfNode(node);
  /** 这一段走白模复刻（判据与报价、出片同源：模板快照带 refVideo） */
  const blockout = !!tpl?.refVideo;
  const tierBlocks = VIDEO_TIERS.map((t) => tierBlockReason(t)).filter((r): r is string => !!r);
  /** 白模节点下各档位点不动的 r2v 原因（判断在 economy.r2vPriceIssue 一处，铁律六）。
   *  几档的整句常常相同（"暂未开放"），Set 去重后再印，别把同一句话糊三遍 */
  const r2vBlocks = blockout
    ? [...new Set(VIDEO_TIERS.map((t) => r2vPriceIssue(t.id)).filter((r): r is string => !!r))]
    : [];

  return (
    <div className="space-y-3">
      {/* ★ 白模节点**没有时长选择器**（仓库主人拍板）：时长 = 模板的登记时长，
          edit 输出≈输入是协议行为，不吃 clampDuration 的 10s 上限（那是纯 t2v
          档位的产品约束）。摆一排点了不生效的时长按钮就是骗人 —— 换成一句明说 */}
      {blockout && tpl?.refVideo ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-10 flex-none text-[11px] text-slate-400">时长</span>
          <span className="text-[11px] text-slate-300">
            {/* ★ 这里说的是**计价与预期时长**（锚点），不是文件真实秒数 —— 真实秒数在
                模板详情页如实显示。两处措辞刻意不同，别把这一处改成真实值：
                账单按锚点走，用户对账时看的是这个数 */}
            按 {tpl.refVideo.durationSec} 秒计 · 跟随模板视频（白模复刻的输出时长≈模板时长，不可另选）
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
      {/* ★ 白模段不印档位 desc（2026-08-21 对抗评审确认）：白模被钳死在 ultra 档，
          而 ultra 的 desc 里那句「出片带 AI 生成的环境音」对白模是**假的** ——
          BLOCKOUT_TASK 写死 generate_audio:false（带歌的参考视频会被方舟版权拦下，
          见 arkClient 那段 ★）。用户在最贵一档上照那句话付了钱，拿回的每段都是哑的。
          改印白模自己的实话：声音在合并那一步回填原片音轨。 */}
      <div className="text-[10px] text-slate-500" title={tierOf(node.videoTier).model}>
        本段模型：{modelLabel(tierOf(node.videoTier).model)}
        <span className="ml-1 opacity-70">
          · {blockout ? "白模复刻：只换人不生成声音，音轨在「完成视频」那一步回填原片" : tierOf(node.videoTier).desc}
        </span>
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

    </div>
  );
}
