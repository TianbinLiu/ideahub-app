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
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import Icon from "../components/Icon";
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
  if (!node) return null;
  const prop = chosenOf(node);
  const tpl = tplOfNode(node);
  const generating = node.status === "generating";
  const done = nodeDone(node);
  const cost = nodeCost(nodes, 0, mode);

  /** 出片后直接去剪辑/发布：简约不留草稿，出完就该往外走 */
  useEffect(() => {
    if (done && !generating) navigate("/cut");
  }, [done, generating, navigate]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6 pt-3">
      {/* 顶栏：只有返回 + 第几步。简约不需要存草稿/完成视频那一排 */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => (step === "start" ? navigate("/create") : setStep(step === "go" ? "fill" : "start"))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-panel"
        >
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <span className="text-sm font-bold text-slate-100">写一句话出片</span>
        <span className="flex-1" />
        <span className="text-[11px] text-slate-500">
          第 {step === "start" ? 1 : step === "fill" ? 2 : 3} / 3 步
        </span>
      </div>

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
