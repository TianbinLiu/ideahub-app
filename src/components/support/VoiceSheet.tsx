/**
 * 「声音」面板（客服页顶栏旁那颗 🎙️）：给数字人换嗓子，存到服务端（官网与 App 同一份）。三页：
 *   单音色 —— 2.0 音色（studio/voices.ts 那份清单）+ 语速 + 语调指令；
 *   混音   —— 1～3 味 1.0 音色按比例调和（VoiceMixer），可发布成声音市场的模板；
 *   声音市场 —— 别人发布的混音模板，试听 / 设为我的声音（VoiceMarket）。
 *
 * 声音是三层合并：用户覆盖 > 人格自带 > 模型推荐 > 服务端默认。面板改的只是「用户覆盖」这一层——
 * 「恢复跟随人格/模型」= 把这一层清掉（PUT { voice: null }），之后念台词用的就是人格/模型给的嗓子。
 * 列表与旋钮的样子沿用 SettingsVoicePage（铸卡师的声音），但**存的地方不同**：那边是本机 localStorage
 * （铸卡师是 3D 工坊里的本机 NPC），这边是账号级的服务端设置，别把两边的存取混到一起。
 *
 * ★ 点一把嗓子 = 选中 + 立刻试听：试听是唯一能证明"这把嗓子在这台服务器上真能出声"的动作。
 *   三页的试听走同一个 VoicePreviewer（voicePreview.ts）喂口型，面板后面的看板娘会跟着张嘴。
 * ★ 试听的参数与保存后真正念台词的一致（语速为空就用合并结果那一档，不是音色自带的预设）：
 *   试听听到的必须就是之后听到的，否则「保存」这个动作在用户眼里就是坏的。
 * ★ 语速 / 音高是三页共用的同一个字段（settings.voice.rate / pitch），所以滑杆只画一根：单音色页放在列表下面，
 *   混音页由 children 塞到配方下面；市场页的模板自带语速，不画。
 * ★ 「声音身份」二选一：单音色页保存发 voiceId、混音页保存发 mix（服务端会把另一个清掉）。哪一页在前面就存哪一页的
 *   身份——两页各自的选择不会互相带走。配方没动只改了语速时保留 templateId（服务端支持「用这个模板，但快一点」），
 *   市场页的「使用中」才不会因为拖了一下语速就消失。
 * ★ 混音原料与上限来自服务端 /api/tts/voices（mixable / maxMixVoices），面板打开时拉一次，三页共用：
 *   市场卡片上的配方名字也靠它翻译（模板里只有 id）。老服务端没有 mixable → 混音页说明要更新，单音色照常。
 * ★ 所有失败就地整句说明；保存 / 设为我的声音成功才关面板并让页面重拉 config（voiceSettings 是服务端算的合并结果）。
 *   发布模板例外：成功后不关，切到市场页「我的」让人看见自己那条（带「使用中」）——发布这件事需要一个看得见的结果。
 */
import { useEffect, useMemo, useState } from "react";
import { CloseButton } from "../IconTapButton";
import {
  companionErrorText,
  getTtsVoices,
  mixRecipeText,
  updateCompanionSettings,
  type CompanionSettings,
  type TtsVoiceCatalog,
  type VoiceMixEntry,
  type VoiceSettings,
  type VoiceTemplate,
} from "../../api/companion";
import { VOICES, rateLabel, type PresetVoice } from "../../studio/voices";
import VoiceMixer from "./VoiceMixer";
import VoiceMarket from "./VoiceMarket";
import { VoicePreviewer, isAbortError, previewErrorText, previewLine } from "./voicePreview";

/** 单音色页只列 2.0 单音色：voices.ts 里的「混音」配方是铸卡师那边的本机预设，数字人的混音走「混音」页（服务端目录） */
const SINGLE_VOICES = VOICES.filter((v) => !v.mix);
const INSTRUCT_MAX = 200;

type Tab = "single" | "mix" | "market";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "single", label: "单音色" },
  { key: "mix", label: "混音" },
  { key: "market", label: "声音市场" },
];

type Props = {
  /** 数字人叫什么（试听台词里自报家门） */
  name: string;
  /** GET /api/companion/settings 的结果；null = 还没读到 / 老服务端 */
  settings: CompanionSettings | null;
  /** config.voiceSettings：服务端算好的合并结果；老服务端没有 → undefined */
  merged?: VoiceSettings;
  onClose: () => void;
  /** 保存 / 恢复 / 设为我的声音 / 发布成功后：页面重拉 config + settings */
  onSaved: () => void;
};

function sameRecipe(a: VoiceMixEntry[], b: VoiceMixEntry[] | null | undefined): boolean {
  return !!b && a.length === b.length && a.every((m, i) => m.voiceId === b[i].voiceId && m.weight === b[i].weight);
}

export default function VoiceSheet({ name, settings, merged, onClose, onSaved }: Props) {
  const override = settings?.settings.voice ?? null;
  // 在用混音（自己调的或市场模板）就直接落在混音页：打开面板最常见的目的是"再调调"
  const [tab, setTab] = useState<Tab>(() => (override?.mix?.length ? "mix" : "single"));
  const [voiceId, setVoiceId] = useState(override?.voiceId || "");
  const [rows, setRows] = useState<VoiceMixEntry[]>(() => override?.mix ?? merged?.mix ?? []);
  // null = 跟随（滑杆停在合并结果那一档）；一动就变成显式值
  const [rate, setRate] = useState<number | null>(override?.rate ?? null);
  const [instruct, setInstruct] = useState(override?.instruct || "");
  /** 正在做什么：音色 id = 试听中；"save" / "reset" = 写服务端 */
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [catalog, setCatalog] = useState<TtsVoiceCatalog | null>(null);
  const [catalogErr, setCatalogErr] = useState("");
  /** 刚从混音页发布过来的那条：市场页直接开「我的」并报一句 */
  const [published, setPublished] = useState<VoiceTemplate | null>(null);
  const [previewer] = useState(() => new VoicePreviewer());

  // 关面板：掐掉试听，嘴闭上
  useEffect(() => () => previewer.stop(), [previewer]);

  useEffect(() => {
    let alive = true;
    getTtsVoices()
      .then((r) => alive && setCatalog(r))
      .catch((e) => alive && setCatalogErr(companionErrorText(e, "读不到音色目录")));
    return () => {
      alive = false;
    };
  }, []);

  // 混音页还没有配方时，目录一到就先放一味：一页空空的配方没法"拖一下听听"
  useEffect(() => {
    const first = catalog?.mixable?.[0];
    if (first && rows.length === 0) setRows([{ voiceId: first.id, weight: 1 }]);
  }, [catalog, rows.length]);

  /** 音色 id → 名字：本机清单 → 服务端 2.0 目录 → 1.0 可混音目录；都没有就原样给 id */
  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of SINGLE_VOICES) map.set(v.id, v.name);
    for (const v of catalog?.voices ?? []) if (!map.has(v.id)) map.set(v.id, v.name);
    for (const v of catalog?.mixable ?? []) map.set(v.id, v.name);
    return (id: string) => map.get(id) || id;
  }, [catalog]);

  const following = !override;
  const followRate = merged?.rate ?? 0;
  // 面板不摆这两个旋钮：保留用户在官网设过的值，别一保存就把它们冲掉
  const expressive = override?.expressive ?? true;
  const pitch = override?.pitch ?? null;
  const saving = busy === "save" || busy === "reset";
  // 标题那一行：现在真正在用的嗓子（合并结果；老服务端没有合并结果就看覆盖层）
  const effective = merged ?? override;
  const effectiveText = !effective
    ? "服务端默认"
    : effective.mix?.length
      ? `混音 ${mixRecipeText(effective.mix, nameOf)}`
      : effective.voiceId
        ? nameOf(effective.voiceId)
        : "服务端默认";
  const currentTemplateId = settings?.voice?.templateId ?? null;

  function switchTab(next: Tab) {
    if (saving || next === tab) return;
    previewer.stop();
    setBusy("");
    setErr("");
    setTab(next);
  }

  async function preview(v: PresetVoice) {
    setVoiceId(v.id);
    setErr("");
    setBusy(v.id);
    try {
      await previewer.play({
        text: previewLine(name),
        voice: v.id,
        rate: rate ?? merged?.rate ?? undefined,
        pitch: pitch ?? undefined,
        instruct: instruct.trim() || merged?.instruct || undefined,
        expressive,
      });
    } catch (e) {
      if (!isAbortError(e)) setErr(previewErrorText(e));
    } finally {
      // 被下一把嗓子顶掉时 busy 已经是它的 id 了，别清
      setBusy((b) => (b === v.id ? "" : b));
    }
  }

  async function save() {
    if (busy) return;
    setBusy("save");
    setErr("");
    try {
      if (tab === "mix") {
        if (!rows.length) throw new Error("先加一味音色再保存。");
        const templateId = sameRecipe(rows, override?.mix) ? (override?.templateId ?? null) : null;
        await updateCompanionSettings({ voice: { mix: rows, templateId, rate, pitch, expressive: true } });
      } else {
        await updateCompanionSettings({
          voice: { voiceId, rate, pitch, instruct: instruct.trim().slice(0, INSTRUCT_MAX), expressive },
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(companionErrorText(e, "保存失败，稍后再试。"));
      setBusy("");
    }
  }

  async function reset() {
    if (busy) return;
    setBusy("reset");
    setErr("");
    try {
      await updateCompanionSettings({ voice: null });
      onSaved();
      onClose();
    } catch (e) {
      setErr(companionErrorText(e, "恢复失败，稍后再试。"));
      setBusy("");
    }
  }

  function onPublished(t: VoiceTemplate) {
    setPublished(t);
    onSaved();
    switchTab("market");
  }

  const rateSlider = (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400">语速</span>
        <span className="text-[11px] text-slate-500">{rate === null ? `跟随（${rateLabel(followRate)}）` : rateLabel(rate)}</span>
      </div>
      <input
        type="range"
        min={-30}
        max={20}
        step={5}
        value={rate ?? Math.max(-30, Math.min(20, followRate))}
        onChange={(e) => setRate(Number(e.target.value))}
        disabled={saving}
        className="w-full accent-brand"
      />
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-600">
        <span>0.70× 慢</span>
        <span>1.00×</span>
        <span>1.20× 快</span>
      </div>
      {rate !== null && (
        <button onClick={() => setRate(null)} className="mt-1 text-[11px] text-slate-500 underline">
          跟随人格/模型
        </button>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60" onClick={saving ? undefined : onClose}>
      <div
        className="flex max-h-[86vh] w-full flex-col rounded-t-2xl border-t border-slate-700 bg-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <span className="shrink-0 text-sm font-bold text-slate-100">{name}的声音</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {following ? "跟随人格/模型" : "你的设置（官网同步）"} · {effectiveText}
          </span>
          <CloseButton chip="sm" size={13} align="end" disabled={saving} onClick={onClose} />
        </div>

        <div className="flex shrink-0 gap-1.5 px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              disabled={saving}
              aria-pressed={tab === t.key}
              className={`flex-1 rounded-full py-1.5 text-xs font-semibold ${tab === t.key ? "bg-brand text-ink" : "bg-panel text-slate-300"} disabled:opacity-60`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {tab === "single" && (
            <>
              <div className="space-y-2">
                {SINGLE_VOICES.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => void preview(v)}
                    disabled={saving}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-60 ${
                      voiceId === v.id ? "border-brand bg-brand/10" : "border-slate-700 bg-panel"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-slate-100">{v.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{v.why}</div>
                    </div>
                    <span className="ml-2 flex-none text-brand">{busy === v.id ? "…" : voiceId === v.id ? "✓" : "▶"}</span>
                  </button>
                ))}
              </div>
              {err && <p className="mt-2 text-[11px] leading-4 text-rose-300">{err}</p>}

              {/* 语速与语调：挑完音色之后的两个旋钮，紧挨着列表才能"改完点任意音色即刻试听" */}
              {rateSlider}

              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">语调指令</span>
                  <span className="text-[11px] text-slate-600">
                    {instruct.length}/{INSTRUCT_MAX}
                  </span>
                </div>
                <textarea
                  value={instruct}
                  onChange={(e) => setInstruct(e.target.value)}
                  rows={3}
                  maxLength={INSTRUCT_MAX}
                  placeholder={
                    merged?.instruct
                      ? `留空 = 跟随人格/模型：${merged.instruct}`
                      : "用一句话描述想要的语气，例如：温柔一点，语速放慢。留空 = 跟随人格/模型"
                  }
                  className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
                />
              </div>
            </>
          )}

          {tab === "mix" && (
            <>
              <VoiceMixer
                name={name}
                catalog={catalog}
                catalogErr={catalogErr}
                rows={rows}
                onRows={setRows}
                rate={rate}
                followRate={followRate}
                pitch={pitch}
                previewer={previewer}
                disabled={saving}
                onPublished={onPublished}
              >
                {rateSlider}
              </VoiceMixer>
              {err && <p className="mt-2 text-[11px] leading-4 text-rose-300">{err}</p>}
            </>
          )}

          {tab === "market" && (
            <>
              {published && (
                <p className="mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs leading-5 text-emerald-200">
                  已发布「{published.name}」{published.shared ? "到声音市场" : "（未公开，只在「我的」里）"}，并设为你的声音。
                </p>
              )}
              <VoiceMarket
                name={name}
                currentTemplateId={currentTemplateId}
                nameOf={nameOf}
                previewer={previewer}
                initialMine={!!published}
                disabled={saving}
                onApplied={() => {
                  onSaved();
                  onClose();
                }}
                onDeleted={onSaved}
              />
              {err && <p className="mt-2 text-[11px] leading-4 text-rose-300">{err}</p>}
            </>
          )}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-white/10 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          {tab !== "market" && (
            <button onClick={() => void save()} disabled={!!busy} className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-ink disabled:opacity-60">
              {busy === "save" ? "保存中…" : tab === "mix" ? "保存这把混音" : "保存"}
            </button>
          )}
          <button
            onClick={() => void reset()}
            disabled={!!busy || following}
            className={`rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-slate-300 disabled:opacity-40 ${tab === "market" ? "flex-1" : ""}`}
          >
            {busy === "reset" ? "恢复中…" : "恢复跟随人格/模型"}
          </button>
        </div>
      </div>
    </div>
  );
}
