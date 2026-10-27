// 「只用文字 + 封面」做一个视频模板（文字模板 P1 的作者那一屏，2026-10-26 主人点名；设计正本 docs/text-template-design-2026-10-26.md）。
//
// 四步：① 写提示词（体检 + 一键改） → ② 给图位起名（正文里的「图1~图4」改写成 @名字，套用的人按名字补图） → ③ 规格（时长 / 画幅 / 默认档 + 报价）
//   → ④ 封面与名字（本机图片压成 720p，存进「我的模板」）。
// ★ 这一屏**一条规则都不判**：体检只读 data/textTemplate.textTplFindings、改只调 applyTextTplFixes / timecodesToShots、图位只读
//   refMentions.templateSlotRefs / rewriteSlotMentions / refNameIssue、能在哪几档上跑只问 templates.textTplTierMissOf、
//   价钱只问 flowStore.textTplQuote（与套用之后 genNode 真扣同一个 nodeCost）。存的最后一道是 saveTemplate 里的 normTextTplSpec。
// ★ 做模板不调 AI、不花 token：入口卡与提取器第一屏的说法都按这条写（TemplateCreateCard 头上「每条路都要花 token」那个坑）。
// ★ P1 只存本机：上市场要等服务端那一半（P2）—— 存好那一屏照实说，别摆一颗点了必被拒的「发布」。
// ★ 写了一半关掉不丢（同提取窗的 parked）：状态停在模块级，按 deviceOwner 认人 —— 换了账号就不还给他（data/deviceOwner 的同一条规矩）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useAuthState } from "../hooks/useAccount";
import { tierBlockReason, tierOffered } from "../data/account";
import { deviceOwner } from "../data/deviceOwner";
import { priceTag, promptMaxOf, tierOf, VIDEO_TIERS } from "../data/economy";
import { EXTRA_REF_NAME_MAX, refNameIssue, rewriteSlotMentions, templateSlotRefs } from "../data/refMentions";
import { packShots, SHOT_MAX, joinShots } from "../data/shotScript";
import { saveTemplate, textTplRecipe, textTplTierMissOf, textTplTierWhyText } from "../data/templates";
import {
  applyTextTplFixes,
  canonTextTplPrompt,
  excerptAround,
  maxTimecodeSec,
  TEXT_TPL_PROMPT_MAX,
  textTplBlocked,
  textTplFindings,
  timecodesToShots,
} from "../data/textTemplate";
import { textTplQuote } from "../studio/flowStore";
import { DURATIONS, LONG_DURATIONS, TPL_CATEGORIES, VIDEO_ASPECTS, type TextTplSpec, type VideoAspect, type VideoTemplate } from "../types";
import { fileToCoverDataUrl } from "./CoverPicker";
import { CloseButton } from "./IconTapButton";
import { useDialogShell } from "./Sheet";
import StepDots from "./StepDots";
import Warn from "./Warn";

/** 图位提示（套用的人看的「这里放一张什么图」）最多几个字 */
const SLOT_HINT_MAX = 30;
const TITLE_MAX = 40;
const INTRO_MAX = 200;
/** 时长能选哪几个：所有档的并集（哪一档放不下由下面那排档位逐个说，不在这里夹） */
const SEC_CHOICES = [...DURATIONS, ...LONG_DURATIONS];

interface Draft {
  owner: string;
  step: number;
  raw: string;
  names: Record<number, string>;
  hints: Record<number, string>;
  durationSec: number | null;
  aspect: VideoAspect;
  tier: string;
  title: string;
  intro: string;
  category: string;
  cover: string;
}

const blank = (owner: string): Draft => ({
  owner,
  step: 0,
  raw: "",
  names: {},
  hints: {},
  durationSec: null,
  aspect: "portrait",
  tier: "",
  title: "",
  intro: "",
  category: "",
  cover: "",
});

/** 图位在作者原文里的叫法（「图3」）：照作者写的字摆，不翻 —— 英文界面里写成 Image 3 反而对不上正文 */
// i18n-ignore-next-line: 图位写法是被解析的输入（refMentions.templateSlotRefs），不是界面文案
const slotLabel = (n: number) => `图${n}`;

/** 写了一半关掉、再打开时接着写（只在这次会话的内存里；存好之后清掉） */
let parked: Draft | null = null;

/** 正文里点到这个图位的那几处（给起名的人看上下文；摘法只在 textTemplate.excerptAround，详情页同一个） */
function slotContext(text: string, num: number): string[] {
  const out: string[] = [];
  for (const h of templateSlotRefs(text).hits) {
    if (!h.nums.includes(num)) continue;
    const cut = excerptAround(text, h.from, h.to);
    if (cut && !out.includes(cut)) out.push(cut);
  }
  return out;
}

export default function TextTemplateSheet({ onClose, onUse }: { onClose: () => void; onUse?: (tpl: VideoTemplate) => void }) {
  const { t } = useLingui();
  const owner = deviceOwner();
  const auth = useAuthState();
  const nav = useNavigate();
  const loc = useLocation();
  // 没登录时写的那份（owner 为空）由紧接着登录的这个人接着写：存之前要先登录，登录页回来正是为了接着存它
  const [d, setD] = useState<Draft>(() => (parked && (parked.owner === owner || !parked.owner) ? { ...parked, owner } : blank(owner)));
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState<VideoTemplate | null>(null);
  const put = (patch: Partial<Draft>) =>
    setD((prev) => {
      const next = { ...prev, ...patch };
      parked = next;
      return next;
    });
  const close = () => onClose();
  const { panelProps } = useDialogShell(close);

  // ── ① 体检 ──
  // 体检、图位、改写都是对几百字的纯函数，每次渲染现算（不 memo：依赖里一半是对象，写错一个就是读到上一拍的结论）
  const scan = templateSlotRefs(d.raw);
  const nums = scan.nums;
  // 内容规则连标题、简介、每个图位的提示一起看（textTplFindings 的 policyParts）
  const findings = textTplFindings(d.raw, {
    shotMax: SHOT_MAX,
    slots: { nums: scan.nums, over: scan.over },
    policyParts: [d.title, d.intro, ...nums.map((n) => d.hints[n] || "")],
  });
  const blocked = textTplBlocked(findings);
  const rawLen = [...d.raw].length;

  // ── ② 图位：默认名「素材N」，过 refNameIssue（重名 / 保留字 / 空） ──
  const slotBase = t({ message: "素材", context: "文字模板图位的默认名字前缀（后面接编号：素材1）；会写进正文当 @名字，英文写成 Ref" });
  const nameOf = (n: number) => d.names[n] ?? `${slotBase}${n}`;
  const nameIssues = nums.map((n) => refNameIssue(nameOf(n), nums.filter((m) => m !== n).map(nameOf)));
  const namesOk = nameIssues.every((x) => !x);
  const rewritten = rewriteSlotMentions(d.raw, Object.fromEntries(nums.map((n) => [n, nameOf(n)])));
  const prompt = canonTextTplPrompt(rewritten.text, packShots);
  const slots = nums.map((n) => ({ name: nameOf(n), hint: (d.hints[n] || "").trim() }));

  // ── ③ 规格 ──
  const timecodeEnd = maxTimecodeSec(prompt);
  /** 时间轴写到第几秒，缺省时长就往上取到够得着的那一格（没写时间轴 = 5 秒） */
  const autoSec = timecodeEnd != null ? SEC_CHOICES.find((s) => s >= timecodeEnd) ?? SEC_CHOICES[SEC_CHOICES.length - 1] : 5;
  const durationSec = d.durationSec ?? autoSec;
  const shape: Pick<TextTplSpec, "prompt" | "slots" | "timecode" | "durationSec"> = { prompt, slots, timecode: timecodeEnd != null, durationSec };
  const shown = VIDEO_TIERS.filter((tier) => tierOffered(tier));
  const runnable = shown.filter((tier) => !textTplTierMissOf(shape, tier.id)).map((tier) => tier.id);
  // 默认档：人选过、而且还跑得了就用它；否则挑第一个跑得了、这个人也用得了的
  const tierId = runnable.includes(d.tier) ? d.tier : runnable.find((id) => !tierBlockReason(tierOf(id))) ?? runnable[0] ?? "";
  const spec: TextTplSpec = {
    v: 1,
    prompt,
    slots,
    ...(timecodeEnd != null ? { timecode: true } : {}),
    durationSec,
    aspect: d.aspect,
    tiers: tierId ? [tierId, ...runnable.filter((id) => id !== tierId)] : [],
  };
  const draftTpl: VideoTemplate = {
    id: "text-tpl-draft",
    title: d.title || t`文字模板`,
    intro: d.intro,
    cover: d.cover,
    author: "",
    createdAt: 0,
    cards: [],
    recipe: textTplRecipe(spec),
    text: spec,
    published: false,
  };
  const quote = tierId ? textTplQuote(draftTpl, tierId) : null;

  const steps = [{ label: t`提示词` }, { label: t`图位` }, { label: t`规格` }, { label: t`封面` }];
  const goNext = () => {
    setErr("");
    // 没有图位就跳过第二步
    if (d.step === 0) put({ step: nums.length ? 1 : 2 });
    else put({ step: d.step + 1 });
  };
  const goBack = () => {
    setErr("");
    if (d.step === 2 && !nums.length) put({ step: 0 });
    else put({ step: Math.max(0, d.step - 1) });
  };

  async function pickCover(file: File | undefined) {
    if (!file) return;
    setErr("");
    const url = await fileToCoverDataUrl(file, d.aspect).catch(() => null);
    if (!url) return setErr(t`这张图读不出来——换一张 JPG / PNG / WebP 试试`);
    put({ cover: url });
  }

  function save() {
    setErr("");
    // ★ 没登录不存：本机模板库按人分开，没人登录时存进去的那条谁都看不见（重开就「不见了」），要等第一个登录的人认领（data/templates.partition）。
    //   去登录页之前写的都停在 parked 里，回来再打开这一屏接着存（pending 不是「没登录」，等认出人再点）
    if (auth === "out") {
      close();
      nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
      return;
    }
    if (auth === "pending") return setErr(t`正在确认登录状态，稍等一下再点`);
    try {
      const tpl = saveTemplate({
        title: d.title.trim(),
        intro: d.intro.trim(),
        ...(d.category ? { category: d.category } : {}),
        cover: d.cover,
        cards: [],
        recipe: textTplRecipe(spec),
        text: spec,
      });
      parked = null;
      setSaved(tpl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const field =
    "w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";
  const chip = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs disabled:opacity-40 ${on ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={close}>
      <div
        {...panelProps}
        aria-label={t`只用文字 + 封面做模板`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4 outline-none"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mb-3 flex items-center">
          <h3 className="text-sm font-bold text-slate-100">
            <Trans>只用文字 + 封面做模板</Trans>
          </h3>
          <span className="flex-1" />
          <CloseButton chip="sm" size={13} align="end" onClick={close} />
        </div>

        {saved ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-ok-500/40 bg-ok-500/10 p-3">
              <div className="text-sm font-bold text-ok-300">
                <Trans>已存进「我的模板」：{saved.title}</Trans>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                <Trans>现在只存在这台设备上，你自己随时能套用。发布到市场要等下一版（服务端那一半还没上线）。</Trans>
              </p>
            </div>
            {onUse && (
              <button
                onClick={() => {
                  onUse(saved);
                  close();
                }}
                className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
              >
                <Trans>用这个模板出片</Trans>
              </button>
            )}
            <button onClick={close} className="w-full rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700">
              <Trans>完成</Trans>
            </button>
          </div>
        ) : (
          <>
            <StepDots className="mb-3" steps={steps} current={d.step} />

            {/* ══ ① 写提示词 ══ */}
            {d.step === 0 && (
              <div className="space-y-2.5">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  <Trans>
                    把整段提示词贴进来：人物、场景、按秒写的时间轴、约束都行。写到「图1 / 图2…」的地方，下一步会变成图位，套用的人按名字补自己的图。做模板不花
                    token。
                  </Trans>
                </p>
                <textarea
                  value={d.raw}
                  onChange={(e) => put({ raw: e.target.value })}
                  maxLength={TEXT_TPL_PROMPT_MAX * 2}
                  rows={10}
                  placeholder={t`例：蓝发少女站在 Blender 界面里…… 0-2s：换上图1 的服装…… 2-5s：……`}
                  className={`${field} resize-none leading-relaxed`}
                />
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  <span className="tabular-nums">
                    <Trans>{rawLen} 字</Trans>
                  </span>
                  {/* 每一档对文字模板段放开的上限（economy.promptMaxOf 的 long 档：电影级 1000、其余按档）：这里只摆够不够，不拦 —— 下面「规格」那一步才逐档说跑不跑得了 */}
                  {shown
                    .filter((tier) => !tier.startOnly)
                    .map((tier) => {
                      const max = promptMaxOf(tier.id, { long: true });
                      const ok = rawLen <= max;
                      return (
                        <span key={tier.id} className={`rounded-full px-2 py-0.5 ${ok ? "bg-panel text-slate-300" : "bg-warn-500/15 text-warn-200"}`}>
                          {tier.label} ≤ {max}
                          {ok ? " ✓" : " ✗"}
                        </span>
                      );
                    })}
                </div>

                {findings.map((f, i) => {
                  switch (f.kind) {
                    case "empty":
                      return null;
                    case "params":
                      return (
                        <Warn key={i} tone="danger">
                          <Trans>正文里写了 {f.hits.join(" ")}——时长、画幅、分辨率在「规格」那一步选，先把这几处删掉。</Trans>
                        </Warn>
                      );
                    case "brackets":
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <Warn className="flex-1" tone="info">
                            <Trans>有 {f.count} 处【】：模型会把它当成要画出来的字。建议改成「标题：」的写法。</Trans>
                          </Warn>
                          <button
                            onClick={() => put({ raw: applyTextTplFixes(d.raw, { brackets: true, quotes: false }) })}
                            className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-200 ring-1 ring-slate-700"
                          >
                            <Trans>一键改</Trans>
                          </button>
                        </div>
                      );
                    case "labelQuotes":
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <Warn className="flex-1" tone="info">
                            <Trans>「{f.labels.slice(0, 3).join("、")}」加了引号：引号里的字可能被当成台词念出来或写进画面。</Trans>
                          </Warn>
                          <button
                            onClick={() => put({ raw: applyTextTplFixes(d.raw, { brackets: false, quotes: true }) })}
                            className="flex-none rounded-full bg-panel px-3 py-1 text-[11px] text-slate-200 ring-1 ring-slate-700"
                          >
                            <Trans>去掉引号</Trans>
                          </button>
                        </div>
                      );
                    case "dialogue":
                      return (
                        <Warn key={i} tone="info">
                          <Trans>有 {f.count} 句台词：出声的档会把它配成语音。</Trans>
                        </Warn>
                      );
                    case "timeline": {
                      const conv = f.shots === "ok" ? timecodesToShots(d.raw, SHOT_MAX) : null;
                      return (
                        <div key={i} className="space-y-1.5 rounded-lg border border-info-500/40 bg-info-500/10 px-3 py-2">
                          <p className="text-[11px] leading-relaxed text-info-200">
                            <Trans>
                              认出 {f.beats} 段时间轴，写到第 {f.maxSec} 秒。按秒写的时间轴只有电影级照着走；改写成「镜头1：/ 镜头2：」草稿和高清也能跑（秒数不再写死）。
                            </Trans>
                            {f.gaps && (
                              <>
                                {" "}
                                <Trans>时间轴中间有空档或重叠，检查一下。</Trans>
                              </>
                            )}
                          </p>
                          {f.shots === "tooMany" && (
                            <Warn tone="danger" compact>
                              <Trans>超过 9 段：模型照不过来，合并几段再存。</Trans>
                            </Warn>
                          )}
                          {f.shots === "merge" && (
                            <Warn compact>
                              <Trans>段数比一段能放的镜头（{SHOT_MAX} 个）多：保留秒数只能在电影级上跑；想在别的档上跑，先把相邻几段合并成 {SHOT_MAX} 段以内。</Trans>
                            </Warn>
                          )}
                          {conv?.kind === "ok" && (
                            <button
                              onClick={() => put({ raw: canonTextTplPrompt(joinShots(conv.script), packShots), durationSec: d.durationSec ?? autoSec })}
                              className="rounded-full bg-panel px-3 py-1 text-[11px] text-slate-200 ring-1 ring-slate-700"
                            >
                              <Trans>改写成镜头</Trans>
                            </button>
                          )}
                        </div>
                      );
                    }
                    case "strayTimecodes":
                      return (
                        <Warn key={i} tone="info">
                          <Trans>「时间轴」那一段之外还有 {f.count} 处像时间码的写法：它们不算进时间轴，也不决定模板时长。</Trans>
                        </Warn>
                      );
                    case "slots":
                      return f.over ? (
                        <Warn key={i} tone="danger">
                          <Trans>认出 {f.nums.length} 个图位，一段最多带 4 张参考图——合并几个再存。</Trans>
                        </Warn>
                      ) : (
                        <Warn key={i} tone="info">
                          <Trans>认出 {f.nums.length} 个图位（{f.nums.map(slotLabel).join("、")}），下一步给它们起名。</Trans>
                        </Warn>
                      );
                    case "policy":
                      return (
                        <Warn key={i} tone={f.level === "blocked" ? "danger" : "warn"}>
                          {f.level === "blocked" ? (
                            <Trans>这种内容（{[...f.expose, ...f.minor].slice(0, 4).join("、")}）不能发布到市场，自己用不受影响，出片照常由模型审核。</Trans>
                          ) : (
                            <Trans>写到了「{f.expose.slice(0, 3).join("、")}」：以后发布到市场时会进人工审核。</Trans>
                          )}
                        </Warn>
                      );
                    default:
                      return null;
                  }
                })}
                <button
                  onClick={goNext}
                  disabled={!d.raw.trim() || blocked}
                  className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                >
                  <Trans>下一步</Trans>
                </button>
              </div>
            )}

            {/* ══ ② 图位 ══ */}
            {d.step === 1 && (
              <div className="space-y-2.5">
                <p className="text-[11px] leading-relaxed text-slate-400">
                  <Trans>
                    每个图位起一个短名字（最多 {EXTRA_REF_NAME_MAX} 个字），正文里的「图N」会改成「@名字」。套用的人按名字补一张自己的图，出片时编号自动对上。
                  </Trans>
                </p>
                {nums.map((n, i) => {
                  const issue = nameIssues[i];
                  return (
                    <div key={n} className="space-y-1.5 rounded-xl border border-slate-700/70 bg-panel p-3">
                      <div className="text-xs font-semibold text-slate-300">{slotLabel(n)}</div>
                      {slotContext(d.raw, n).map((line) => (
                        <p key={line} className="text-[11px] leading-relaxed text-slate-400">
                          {line}
                        </p>
                      ))}
                      <input
                        value={nameOf(n)}
                        onChange={(e) => put({ names: { ...d.names, [n]: e.target.value } })}
                        maxLength={EXTRA_REF_NAME_MAX}
                        placeholder={t`名字`}
                        className={field}
                      />
                      {issue && (
                        <p className="text-[11px] text-danger-300">
                          {issue === "empty" ? t`起一个名字` : issue === "taken" ? t`和别的图位重名了` : t`这个名字是保留的写法，换一个`}
                        </p>
                      )}
                      <input
                        value={d.hints[n] || ""}
                        onChange={(e) => put({ hints: { ...d.hints, [n]: e.target.value } })}
                        maxLength={SLOT_HINT_MAX}
                        placeholder={t`提示套用的人放什么图（选填，例：全身立绘，正面）`}
                        className={field}
                      />
                    </div>
                  );
                })}
                {rewritten.missing.length > 0 && (
                  <Warn tone="danger">
                    <Trans>还有图位没起名：{rewritten.missing.map(slotLabel).join("、")}</Trans>
                  </Warn>
                )}
                <div className="flex gap-2">
                  <button onClick={goBack} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700">
                    <Trans>上一步</Trans>
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!namesOk || rewritten.missing.length > 0}
                    className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    <Trans>下一步</Trans>
                  </button>
                </div>
              </div>
            )}

            {/* ══ ③ 规格 ══ */}
            {d.step === 2 && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>时长</Trans>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {SEC_CHOICES.map((s) => (
                      <button key={s} onClick={() => put({ durationSec: s })} className={chip(durationSec === s)}>
                        {s}s
                      </button>
                    ))}
                  </div>
                  {timecodeEnd != null && durationSec < timecodeEnd && (
                    <Warn className="mt-1.5">
                      <Trans>时间轴写到第 {timecodeEnd} 秒，模板时长至少要 {timecodeEnd} 秒。</Trans>
                    </Warn>
                  )}
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>画幅</Trans>
                  </div>
                  <div className="flex gap-1.5">
                    {VIDEO_ASPECTS.map((a) => (
                      <button key={a.id} onClick={() => put({ aspect: a.id, cover: a.id === d.aspect ? d.cover : "" })} className={chip(d.aspect === a.id)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>默认出片模型</Trans>
                  </div>
                  <p className="mb-1.5 text-[11px] leading-relaxed text-slate-400">
                    <Trans>套用的人默认落在这一档；跑得了的档都会记进模板，套用的人可以在这几档之间换。</Trans>
                  </p>
                  <div className="space-y-1.5">
                    {shown.map((tier) => {
                      const why = textTplTierMissOf(shape, tier.id);
                      const plan = tierBlockReason(tier);
                      const q = why ? null : textTplQuote(draftTpl, tier.id);
                      return (
                        <button
                          key={tier.id}
                          onClick={() => put({ tier: tier.id })}
                          disabled={!!why}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left disabled:opacity-40 ${
                            tierId === tier.id ? "bg-brand/20 ring-1 ring-brand" : "bg-panel"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-slate-100">{tier.label}</span>
                            <span className="block text-[10px] text-slate-400">{why ? textTplTierWhyText(why) : plan ?? tier.desc}</span>
                          </span>
                          {q && <span className="flex-none text-[11px] tabular-nums text-slate-300">{priceTag(q.tokens)}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {!runnable.length && (
                    <Warn tone="danger" className="mt-1.5">
                      <Trans>这段正文在哪一档上都跑不了——看每一档下面那句原因，回去改正文或换时长。</Trans>
                    </Warn>
                  )}
                  {quote && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
                      {quote.drawsFirstFrame ? (
                        <Trans>套用一次出一段 {priceTag(quote.tokens)}（含先画 1 张开头画面）。做模板本身不花 token。</Trans>
                      ) : (
                        <Trans>套用一次出一段 {priceTag(quote.tokens)}。做模板本身不花 token。</Trans>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={goBack} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700">
                    <Trans>上一步</Trans>
                  </button>
                  <button
                    onClick={goNext}
                    disabled={!runnable.length || (timecodeEnd != null && durationSec < timecodeEnd)}
                    className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    <Trans>下一步</Trans>
                  </button>
                </div>
              </div>
            )}

            {/* ══ ④ 封面与名字 ══ */}
            {d.step === 3 && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>封面</Trans>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3">
                    <span
                      className="flex w-24 flex-none items-center justify-center overflow-hidden rounded-xl border border-slate-700 bg-panel text-[11px] text-slate-400"
                      style={{ aspectRatio: d.aspect === "portrait" ? "9 / 16" : "16 / 9" }}
                    >
                      {d.cover ? <img src={d.cover} alt="" className="h-full w-full object-cover" /> : <Trans>选一张图</Trans>}
                    </span>
                    <span className="text-[11px] leading-relaxed text-slate-400">
                      <Trans>从相册选一张图，按{VIDEO_ASPECTS.find((a) => a.id === d.aspect)?.label}居中裁成 720p。</Trans>
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => void pickCover(e.target.files?.[0])} />
                  </label>
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>名字</Trans>
                  </div>
                  <input value={d.title} onChange={(e) => put({ title: e.target.value })} maxLength={TITLE_MAX} placeholder={t`例：蓝发少女变装`} className={field} />
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>简介（选填）</Trans>
                  </div>
                  <textarea
                    value={d.intro}
                    onChange={(e) => put({ intro: e.target.value })}
                    maxLength={INTRO_MAX}
                    rows={2}
                    placeholder={t`一句话说说这个模板拍的是什么`}
                    className={`${field} resize-none leading-relaxed`}
                  />
                </div>
                <div>
                  <div className="mb-1.5 text-sm font-semibold text-slate-300">
                    <Trans>分类（选填）</Trans>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {TPL_CATEGORIES.map((c) => (
                      <button key={c.id} onClick={() => put({ category: d.category === c.id ? "" : c.id })} className={chip(d.category === c.id)}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                {err && <p className="text-xs text-danger-300">{err}</p>}
                <div className="flex gap-2">
                  <button onClick={goBack} className="flex-1 rounded-xl bg-panel py-2.5 text-sm font-bold text-slate-200 ring-1 ring-slate-700">
                    <Trans>上一步</Trans>
                  </button>
                  <button
                    onClick={save}
                    disabled={!d.cover || !d.title.trim()}
                    className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
                  >
                    {auth === "out" ? <Trans>登录后存进我的模板</Trans> : <Trans>存进我的模板</Trans>}
                  </button>
                </div>
                {(!d.cover || !d.title.trim()) && (
                  <p className="text-center text-[11px] text-slate-400">
                    {!d.cover ? <Trans>先选一张封面</Trans> : <Trans>给模板起个名字</Trans>}
                  </p>
                )}
              </div>
            )}
            {err && d.step !== 3 && <p className="mt-2 text-xs text-danger-300">{err}</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
