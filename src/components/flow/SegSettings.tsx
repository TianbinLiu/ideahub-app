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
import { clampDuration, modelLabel, r2vPriceIssue, realFaceIssue, tierOf, VIDEO_TIERS } from "../../data/economy";
import { chosenOf, nodeDone, tplOfNode, useFlow } from "../../studio/flowStore";
import { DURATIONS, VIDEO_ASPECTS } from "../../types";
import TierRow from "./TierRow";
import { carryIsHard } from "../../studio/segmentGen";

export default function SegSettings({ nodeId }: { nodeId: string }) {
  const nodes = useFlow((s) => s.nodes);
  const { updateProposal, updateNode } = useFlow();
  const index = nodes.findIndex((n) => n.id === nodeId);
  const node = index >= 0 ? nodes[index] : undefined;
  if (!node) return null;
  const prop = chosenOf(node);
  const done = nodeDone(node);
  const tpl = tplOfNode(node);
  /** 这一段走白模复刻（判据与报价、出片同源：模板快照带 refVideo） */
  const blockout = !!tpl?.refVideo;
  /**
   * 白模节点下各档位点不动的 r2v 原因（判断在 economy.r2vPriceIssue 一处，铁律六）。
   *
   * ★★ 2026-08-23 修：原来只对**整句**做 Set 去重，而每句都带着自己的档位名
   *   （「极速」这一档暂未开放…／「标准」这一档暂未开放…），四句字面不同 ⇒ 去重恒失效，
   *   于是同一件事在屏幕上糊了三四遍，把这一块撑成一大段红字。
   *   现在按**去掉档位名之后**的句子去重：同因只留一条，并把档位名合并到一起说。
   */
  const r2vBlocks = blockout
    ? (() => {
        const byReason = new Map<string, string[]>();
        for (const t of VIDEO_TIERS) {
          const why = r2vPriceIssue(t.id);
          if (!why) continue;
          // 「「极速」这一档暂未开放…」→ 去掉开头那个带引号的档位名，剩下的就是"原因本身"
          const bare = why.replace(/^「[^」]*」/, "").trim();
          const hit = byReason.get(bare);
          if (hit) hit.push(t.label);
          else byReason.set(bare, [t.label]);
        }
        return [...byReason].map(([bare, names]) => `「${names.join("」「")}」${bare}`);
      })()
    : [];
  /**
   * 真人卡 × 档位的门禁原因（判断在 economy.realFaceIssue 一处，铁律六）——生成闸
   * （flowStore.genNode / deriveProposals）拒的就是这一句，这里提前印出来，
   * 免得用户写完一大段要求、点了生成才第一次听说真人卡过不去。
   * 按当前档位问一次就够：今天四档 realFace 全 false，逐档问只会把同一句糊四遍
   * （上面 r2vBlocks 刚治过这个）。
   * blockout 位跟着本段事实：白模节点上「真人」档整个按不动（上面 r2vBlocks 正印着
   * 原因），默认那句「换成真人档就能出」在这儿是死路 —— 两行并排自相矛盾。
   */
  const realFaceBlock = realFaceIssue(node.materials, node.videoTier, { blockout });

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
            // ★ 按发计价档（真人档）只有价表里那几个整档：8 秒会被 clampDuration 吸附到
            //   10 档并按 10 收——让它可点就是"按钮写 8、账按 10"，比灰掉更糟
            const flat = tierOf(node.videoTier).flatCost;
            const offStep = !!flat && !(d in flat);
            return (
              <button
                key={d}
                onClick={() => updateProposal(node.id, { durationSec: d })}
                disabled={tooShort || offStep}
                title={
                  offStep
                    ? `「${tierOf(node.videoTier).label}」按发计价，只有 ${Object.keys(flat!).join("/")} 秒两档`
                    : tooShort
                      ? `「${tierOf(node.videoTier).label}」最短 ${tierOf(node.videoTier).minSec} 秒`
                      : undefined
                }
                // ★ 高亮跟 clampDuration 的**结算值**走，不跟存量原始值（2026-08-24 真机抓到）：
                //   换到按发档时 durationSec 可能还停在 5——实扣按吸附后的 6 算（clampDuration
                //   是报价与出片同一把尺），5s 却还亮着 = 界面写 5、账按 6。
                className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${clampDuration(prop.durationSec, node.videoTier) === d ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
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

      {/* 画质那一排（含逐档报价、r2v 禁用、换档代价确认）抽在 TierRow 一处，
          工坊节点卡角落用的是同一份 */}
      <TierRow nodeId={node.id} />

      {/* ★ 点不动就必须写出为什么。只把按钮灰掉的话，用户只会觉得"这功能坏了"
          （CLAUDE.md「界面上摆一个永远点不动的选项」）。title 在手机上没有 hover，
          所以原因得**印在页面上**，不能只挂在 title 里 */}
      {/* ★ 套餐门槛那一类原因（含「去升级」）现在由 TierRow 印 —— 它拥有那排按钮。
          这里只剩**本页自己的**理由：r2v 闸没开、真人卡与本段不搭。两份都印过一阵子，
          结果是同一句话在抽屉里出现两遍 */}
      {(r2vBlocks.length > 0 || realFaceBlock) && (
        <p className="text-[10px] leading-4 text-amber-300/80">
          {[...r2vBlocks, ...(realFaceBlock ? [realFaceBlock] : [])].join("；")}
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
          {/* ★ 同 FlowCanvas 那条 ⓘ：硬度随档位变，判据同一处（segmentGen.carryIsHard） */}
          从上一段的真实结尾画面接着拍
          {!carryIsHard(node.videoTier) && (
            <span className="text-slate-500">（这一档是参考+点名，不是硬保证）</span>
          )}
        </label>
      )}

      {!!node.materials?.length && (
        <div className="flex flex-wrap gap-1">
          <span className="w-10 flex-none text-[11px] text-slate-400">素材</span>
          {node.materials.map((c) => (
            <span key={c.id} className="rounded-full px-2 py-0.5 bg-panel text-[10px] text-slate-300">
              {c.name}
            </span>
          ))}
        </div>
      )}

    </div>
  );
}
