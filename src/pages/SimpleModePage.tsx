// 简约模式：**一步一屏**的出片向导（2026-08-23 从 FlowPage 独立出来）。
//
// ★★ 为什么独立成页：简约模式此前寄生在 FlowPage 里 —— 那一页是为「多段流水线」写的，
//   顶栏、节点条、方案台、画布切换全是给工作流准备的，简约只能靠一串 `simple &&` 把它们
//   一个个关掉。结果是：一屏上摆着七八样东西，而简约用户真正要做的只有三件
//   （挑个起点 → 说清拍什么 → 出片）。用户点名：一页只负责一个功能一个步骤。
//
// ★ 三步，每屏只问一件事：
//     1 选起点：套模板 / 自己写 —— 这一屏**只有两个选项**，别的什么都没有
//     2 说清楚：模板路是挑一个模板（挑完可再补一句要求）；自定义路是写一句话
//     3 确认出片：时长画质画幅 + 一颗带价钱的生成键
//
// ★★ 生成这件事**不在这里另写一份**：仍然走 flowStore 的 genNode（与工作流、工坊同一处
//   实现）。这一页只负责"把用户的意思填进那唯一一个节点"，钱、门禁、进度、失败话术
//   全部沿用 store 里那份（铁律六）。
// ★ 简约恒单段、恒直出（不推演方案）：所以没有方案台、没有节点条、不存草稿
//   （saveWorkDraft 自己会挡掉 simple，见 studioStore）。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import SegSettings from "../components/flow/SegSettings";
import { chosenOf, nodeCost, nodeDone, tplOfNode, useFlow } from "../studio/flowStore";
import { fmtTokens } from "../data/economy";
import {
  browseTemplates,
  groupRows,
  myTemplates,
  refVideoIssue,
  refVideoPoster,
  subscribeTemplates,
  templatesVersion,
} from "../data/templates";
import { VideoTemplate, aspectCss } from "../types";
import CustomFrameSlots from "../components/flow/CustomFrameSlots";
import { useFlowActions } from "../hooks/useFlowActions";
import FuseFrameSheet, { fuseSourcesOf } from "../studio/ui/FuseFrameSheet";

type Step = "start" | "fill" | "go";

export default function SimpleModePage() {
  const navigate = useNavigate();
  const nodes = useFlow((s) => s.nodes);
  const mode = useFlow((s) => s.mode);
  const err = useFlow((s) => s.err);
  const busy = useFlow((s) => s.busy);
  const { seedSolo, setNodeTemplate, updateProposal, genNode } = useFlow();
  const [step, setStep] = useState<Step>("start");
  /** 走哪条路。null = 还没选（第 1 屏） */
  const [route, setRoute] = useState<"template" | "custom" | null>(null);

  // ★ 进来就确保流水线是「简约单段」形态。已经是就不动（用户可能是从生成中途退出来的）。
  useEffect(() => {
    if (mode !== "simple" || nodes.length !== 1) seedSolo("simple");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在进页时对齐一次
  }, []);

  const node = nodes[0];
  // ★★ 下面这些派生值与那个 useEffect 都必须排在 `if (!node) return null` **之前**
  //   （2026-08-30 被新加的构建门禁 scripts/check-hook-order.mjs 抓出来）：
  //   首帧进来时 `nodes` 可能是空的（上面那个 effect 才去 seedSolo），于是第一次渲染
  //   早退、只注册了 1 个 hook；seedSolo 填上之后重渲染变成 2 个 —— React 抛
  //   「Rendered more hooks than during the previous render」，**整页白屏且这一页没有
  //   ErrorBoundary**。用户读到的是"简约模式打不开了"。
  //   ⇒ hook 照常跑，把"没有节点"的情况挡在 effect 体内。
  // ★ 只有**下面那个 effect 依赖的**两个值需要提前算（它们必须在早退之前，见上面的 ★★）；
  //   其余派生值留在早退之后 —— 那样类型上 node 已经收窄，不用到处补空判。
  const generating = node?.status === "generating";
  const done = !!node && nodeDone(node);

  // ★★ 出片之后必须**组稿**再走，不能光 navigate("/cut")（2026-08-31 修）。
  //   `navigate("/cut")` 只是换路由，而剪辑页读的是 `studioStore.draft` —— 这条路
  //   从来没调过 finalizeFromFlow，draft 恒为 null ⇒ CutPage 挂载那一拍就
  //   `navigate(publishedExit() ?? "/studio", { replace: true })`，把人 replace 进
  //   3D 铸卡桌面。而简约模式**不进草稿库**（saveWorkDraft 挡掉 simple），
  //   这条刚花钱炼出来的片子在 app 里没有第二份副本；按返回键回 /simple 又会被同一个
  //   effect 再推去 /cut、再弹回 /studio，来回弹。钱花了、片没了、零报错。
  //   ⇒ 走与工作流/工坊**同一份**组稿实现（铁律六）：cut() 负责
  //   finalizeFromFlow → persistCutDraft → reset → navigate("/cut", {replace}) ，
  //   连 cutSession 冲突拦截与落盘失败那句话的透传都在里面。
  const fa = useFlowActions();
  // ★★ **只许触发一次**：`fa.toCut` 每次渲染都是新函数（返回对象里现造的），放进依赖
  //   会让这个 effect 每渲染一次就跑一遍；而 `cut()` 里那道 `if (busy || finalizing)`
  //   挡不住并发的第一拍（setFinalizing 是异步的）—— 而组稿会**铸卡组、建 3D 模型**，
  //   那是真扣 token 的。用 ref 而不是 state：ref 的写立刻生效，state 要等下一次渲染。
  const cutFired = useRef(false);
  const toCutRef = useRef(fa.toCut);
  toCutRef.current = fa.toCut;
  useEffect(() => {
    if (!done || generating || cutFired.current) return;
    cutFired.current = true;
    toCutRef.current();
  }, [done, generating]);

  if (!node) return null;
  const prop = chosenOf(node);
  const tpl = tplOfNode(node);
  const cost = nodeCost(nodes, 0, mode);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6">
      {/* 顶栏：只有返回 + 第几步。简约不需要存草稿/完成视频那一排。
          ★ 走 PageHeader（2026-09-05 主人截图：这一页此前没留状态栏的位置，返回键压在时间上、
            「第 1/3 步」压在电量图标上 —— 全 app 唯一一页顶栏没 safe-top 的） */}
      <PageHeader
        className="mb-4"
        onBack={() => (step === "start" ? navigate("/create") : setStep(step === "go" ? "fill" : "start"))}
        title="写一句话出片"
        right={
          <span className="flex-none text-[11px] text-slate-500">
            第 {step === "start" ? 1 : step === "fill" ? 2 : 3} / 3 步
          </span>
        }
      />

      {/* store 的整句拒绝（换模板被拒、生成被拒…）—— 不画一份就是"点了没反应"（铁律八） */}
      {err && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}

      {step === "start" && (
        <StepStart
          onPick={(r) => {
            // ★★ 选「自己写」必须**摘掉已套的模板**（2026-08-23 实测抓到）：
            //   用户从模板路退回来改选自定义时，节点上那份 tpl 快照还在 —— 第 3 屏会
            //   照旧显示「套用的模板 …」、按 r2v 计价（2.2M 而不是几十 k），最后出的
            //   还是模板复刻。他明明选了"自己写"，全程零报错。
            //   ★ 走 store 的 setNodeTemplate(null)（摘模板的唯一实现，会一并清挂卡与点名句）。
            if (r === "custom" && tpl) setNodeTemplate(node.id, null);
            setRoute(r);
            setStep("fill");
          }}
        />
      )}

      {step === "fill" && route === "template" && (
        <StepTemplate
          currentId={tpl?.id}
          onPick={(t) => {
            if (setNodeTemplate(node.id, t)) setStep("go");
          }}
          onBack={() => setStep("start")}
        />
      )}

      {step === "fill" && route === "custom" && (
        <StepCustom
          value={prop.plot}
          onChange={(v) => updateProposal(node.id, { plot: v })}
          onNext={() => setStep("go")}
        />
      )}

      {step === "go" && (
        <StepGo
          nodeId={node.id}
          tplTitle={tpl?.title}
          plot={prop.plot}
          onPlot={(v) => updateProposal(node.id, { plot: v })}
          cost={cost}
          busy={busy || generating}
          progress={generating ? node.progress || "生成中…" : ""}
          onGo={() => void genNode(node.id)}
        />
      )}
    </div>
  );
}

/** 第 1 步：**整屏只有两个选项**。用户点名——第一步别摆别的东西。 */
function StepStart({ onPick }: { onPick: (r: "template" | "custom") => void }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <p className="mb-1 text-center text-sm text-slate-400">想怎么开始？</p>
      <button
        onClick={() => onPick("template")}
        className="rounded-2xl border border-brand/50 bg-brand/10 px-4 py-6 text-left"
      >
        <div className="text-base font-bold text-slate-100">🧪 套一个模板</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">挑一条现成的片子，复刻它的画面与运镜</div>
      </button>
      <button
        onClick={() => onPick("custom")}
        className="rounded-2xl border border-slate-700 bg-panel px-4 py-6 text-left"
      >
        <div className="text-base font-bold text-slate-100">✍️ 自己写一句</div>
        <div className="mt-1 text-xs leading-relaxed text-slate-400">说一句想拍什么，AI 直接出一条短片</div>
      </button>
    </div>
  );
}

/** 第 2 步（模板路）：挑一个模板。分段组折成一行（与画布同一条规则，走 data 层的 groupRows）。 */
function StepTemplate({
  currentId,
  onPick,
  onBack,
}: {
  currentId?: string;
  onPick: (t: VideoTemplate) => void;
  onBack: () => void;
}) {
  // ★ 市场是懒加载 + 到货 emit：不订阅的话远端模板到了也不上屏。
  //   ★★ 用 data 层的 subscribeTemplates，**不 import TemplateShelf 的 useTemplatesVersion**
  //     —— 页面 import 那个组件会撞 RoleConfirmSheet 记过的循环 import 坑。
  const ver = useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const flat = [...myTemplates(), ...browseTemplates("")].filter((t) => {
      if (!t.refVideo) return false;
      const k = t.remoteId || t.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return groupRows(flat).slice(0, 40);
  }, [ver]);

  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-sm text-slate-300">挑一个模板</p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {rows.map((row) => {
          const head = row.parts[0];
          const count = head.group?.count ?? row.parts.length;
          const multi = row.parts.length > 1 || count > 1;
          if (!multi) return <TplRow key={row.key} t={head} currentId={currentId} onPick={() => onPick(head)} />;
          const open = openKey === row.key;
          return (
            <div key={row.key} className="rounded-xl border border-slate-700 bg-panel">
              <button
                onClick={() => setOpenKey(open ? null : row.key)}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
              >
                <Thumb t={head} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-100">
                    {head.title.replace(/\s*[·・]\s*第\s*\d+\s*\/\s*\d+\s*段\s*$/, "")}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">共 {count} 段 · 点开选一段</div>
                </div>
                <span className="flex-none text-[11px] text-slate-400">{open ? "▴" : "▾"}</span>
              </button>
              {open && (
                <div className="space-y-1.5 border-t border-slate-700/70 p-1.5">
                  {row.parts.map((p) => (
                    <TplRow
                      key={p.id}
                      t={p}
                      currentId={currentId}
                      seg={`第 ${(p.group?.index ?? 0) + 1}/${count} 段`}
                      onPick={() => onPick(p)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-700 py-10 text-center text-xs leading-relaxed text-slate-500">
            还没有可用的模板
            <button onClick={onBack} className="mt-2 block w-full text-[11px] text-brand">
              ← 换成自己写一句
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Thumb({ t }: { t: VideoTemplate }) {
  const src = t.cover || refVideoPoster(t.refVideo);
  return (
    <div className="h-12 w-20 flex-none overflow-hidden rounded-lg bg-black/40">
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </div>
  );
}

function TplRow({
  t,
  currentId,
  seg,
  onPick,
}: {
  t: VideoTemplate;
  currentId?: string;
  seg?: string;
  onPick: () => void;
}) {
  const issue = refVideoIssue(t.refVideo);
  const cur = t.id === currentId;
  return (
    <button
      onClick={() => !issue && onPick()}
      disabled={!!issue}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${
        cur ? "border-brand/70 bg-brand/10" : "border-slate-700 bg-panel"
      } disabled:opacity-60`}
    >
      <Thumb t={t} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-slate-100">{seg ?? t.title}</div>
        <div className="truncate text-[10px] text-slate-500">
          {t.refVideo!.durationSec}s 复刻{issue ? ` · ${issue}` : ""}
        </div>
      </div>
    </button>
  );
}

/** 第 2 步（自定义路）：**整屏只有一个输入框**。 */
function StepCustom({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-sm text-slate-300">想拍什么？</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        maxLength={400}
        autoFocus
        placeholder="例：雨夜霓虹的街头，穿风衣的侦探快步穿过人群"
        className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2.5 text-sm leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
      />
      <span className="flex-1" />
      <button
        onClick={onNext}
        disabled={!value.trim()}
        className="mt-4 w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
      >
        下一步
      </button>
    </div>
  );
}

/** 第 3 步：确认与出片。价钱来自 nodeCost（与真扣钱同一个函数）。 */
function StepGo({
  nodeId,
  tplTitle,
  plot,
  onPlot,
  cost,
  busy,
  progress,
  onGo,
}: {
  nodeId: string;
  tplTitle?: string;
  plot: string;
  onPlot: (v: string) => void;
  cost: number;
  busy: boolean;
  progress: string;
  onGo: () => void;
}) {
  // ── 自定义首尾帧（选填，主人点名的第三条路·简约面）──
  // 帧就写在这一段的方案上（flowStore.setFrame 唯一实现），给了就走首尾帧直出、
  // 报价当场跟着变（nodeCost 读的就是方案上的帧）。融图 = 既有 FuseFrameSheet。
  const node = useFlow((s) => s.nodes.find((n) => n.id === nodeId));
  const setFrame = useFlow((s) => s.setFrame);
  const [customOpen, setCustomOpen] = useState(false);
  const [fuse, setFuse] = useState<"first" | "last" | null>(null);
  const prop = node ? chosenOf(node) : null;
  return (
    <div className="flex flex-1 flex-col">
      <p className="mb-3 text-sm text-slate-300">确认一下就出片</p>
      {tplTitle && (
        <div className="mb-3 rounded-xl border border-slate-700 bg-panel px-3 py-2.5">
          <div className="text-[10px] text-slate-500">套用的模板</div>
          <div className="truncate text-xs font-semibold text-slate-100">{tplTitle}</div>
        </div>
      )}
      <div className="mb-3">
        <div className="mb-1.5 text-[11px] text-slate-500">{tplTitle ? "再补一句要求（可留空）" : "要拍什么"}</div>
        <textarea
          value={plot}
          onChange={(e) => onPlot(e.target.value)}
          rows={3}
          maxLength={400}
          className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2 text-xs leading-relaxed text-slate-100 outline-none focus:border-brand"
        />
      </div>
      {/* 套模板时不给：模板的画面来自配方/参考视频，再塞用户帧是两套世界打架 */}
      {!tplTitle && node && prop && (
        <div className="mb-3">
          <button
            onClick={() => setCustomOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-panel px-3 py-2 text-[11px] text-slate-300"
          >
            <span className="min-w-0 truncate">
              ✍ 自定义首尾帧
              {prop.firstFrame || prop.lastFrame
                ? ` · 已给${prop.firstFrame ? "首" : ""}${prop.firstFrame && prop.lastFrame ? "、" : ""}${prop.lastFrame ? "尾" : ""}帧`
                : "（选填 · 传自己的图或融图，AI 只补缺的）"}
            </span>
            <span className="ml-2 flex-none text-[10px] text-slate-500">{customOpen ? "收起" : "展开"}</span>
          </button>
          {customOpen && (
            <div className="mt-2 space-y-1.5">
              <CustomFrameSlots
                first={prop.firstFrame}
                last={prop.lastFrame}
                aspectCssValue={aspectCss(node.aspect)}
                canEdit={!busy}
                firstEmptyNote="空 = AI 按上面那句话补画（计费）"
                onFrame={(which, url) => setFrame(nodeId, which, url)}
                onFuse={setFuse}
                onError={(msg) => useFlow.setState({ err: msg })}
              />
            </div>
          )}
        </div>
      )}
      {fuse && node && prop && (
        <FuseFrameSheet
          which={fuse}
          sources={fuseSourcesOf({
            materials: node.materials,
            carryFrame: null, // 简约恒单段
            firstFrame: prop.firstFrame,
            lastFrame: prop.lastFrame,
          })}
          aspect={node.aspect}
          onDone={(url) => {
            setFrame(nodeId, fuse, url);
            setFuse(null);
          }}
          onClose={() => setFuse(null)}
        />
      )}
      <SegSettings nodeId={nodeId} />
      <span className="flex-1" />
      {progress && <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">{progress}</p>}
      <button
        onClick={onGo}
        disabled={busy || (!tplTitle && !plot.trim())}
        className="mt-3 w-full rounded-xl bg-brand py-3.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-500"
      >
        {busy ? "生成中…" : `⚡ 出片（${fmtTokens(cost)}）`}
      </button>
    </div>
  );
}
