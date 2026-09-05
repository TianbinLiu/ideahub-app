/**
 * 「混音」页（VoiceSheet 的第二页）：把 1～3 味豆包 1.0 音色按比例调和成一把新嗓子，试听、保存为自己的声音、或发布到声音市场。
 *
 * 配方（rows）与语速由 VoiceSheet 持有——「保存」键在面板的公共页脚，页脚要读得到配方；语速滑杆也是面板画的（单音色页
 * 与这一页共用同一个字段），由 children 塞进来放在配方下面。这里只负责画配方、改配方，外加两件只属于混音页的事：
 * 试听（发的就是保存后念台词的那三个字段：mix + rate + pitch）与「发布到声音市场」。
 *
 * ★ 原料只能是服务端 /api/tts/voices 的 mixable 目录（23 个逐个验证过能出声的 1.0 音色），不是 studio/voices.ts 那份 2.0
 *   清单：2.0（uranus）混不了（上游 55000000），服务端写入时也会 400。女 / 男分组用的是服务端给的 gender，别猜 id 前缀。
 * ★ 每味一根滑杆是**相对权重**（0.05～1），右边显示归一后的占比——用户拖的是"这味多一点"，看的是"占几成"；
 *   发出去的是相对权重，归一只在服务端做一处（normalizeWeights：和 = 1、三位小数），这里的百分比只为显示。
 * ★ 同一味不许出现两次（下拉里灰掉别的行已选的）：服务端会把重复的合并权重，用户看到的两根滑杆就对不上一味。
 * ★ 语调指令对混音无效（1.0 没有 context_texts）：页面上原话提示，且不摆那个输入框。
 * ★ 发布 = POST /api/voice-templates（新模板）→ PUT settings { voice: { templateId } }（设为自己的声音，服务端展开成快照）。
 *   第二步失败时模板已经在市场里了：整句说「已发布但没设成」，让人去市场页点「设为我的声音」，别让他再发一遍。
 */
import { useState, type ReactNode } from "react";
import Icon from "../Icon";
import {
  companionErrorText,
  createVoiceTemplate,
  mixShares,
  updateCompanionSettings,
  type MixableVoice,
  type TtsVoiceCatalog,
  type VoiceMixEntry,
  type VoiceTemplate,
} from "../../api/companion";
import { isAbortError, previewErrorText, previewLine, type VoicePreviewer } from "./voicePreview";

const WEIGHT_MIN = 0.05;
const WEIGHT_MAX = 1;
const WEIGHT_STEP = 0.05;
const NAME_MAX = 60;
const DESC_MAX = 300;
/** 老服务端没给上限时按豆包官方上限 3 */
const DEFAULT_MAX_MIX = 3;

type Props = {
  /** 数字人叫什么（试听台词里自报家门） */
  name: string;
  catalog: TtsVoiceCatalog | null;
  catalogErr: string;
  rows: VoiceMixEntry[];
  onRows: (rows: VoiceMixEntry[]) => void;
  /** 用户覆盖层的语速；null = 跟随合并结果那一档（followRate） */
  rate: number | null;
  followRate: number;
  pitch: number | null;
  previewer: VoicePreviewer;
  /** 面板正在写服务端（保存 / 恢复）：这一页的键都灰掉 */
  disabled: boolean;
  /** 发布成功并已设为自己的声音 */
  onPublished: (template: VoiceTemplate) => void;
  /** 面板塞进来的语速滑杆，放在配方下面 */
  children?: ReactNode;
};

const clampWeight = (w: number) => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Number.isFinite(w) ? w : WEIGHT_MIN));

function VoiceOptions({ list, used, self }: { list: MixableVoice[]; used: Set<string>; self: string }) {
  return (
    <>
      {list.map((v) => (
        <option key={v.id} value={v.id} disabled={used.has(v.id) && v.id !== self}>
          {v.name}
        </option>
      ))}
    </>
  );
}

export default function VoiceMixer({ name, catalog, catalogErr, rows, onRows, rate, followRate, pitch, previewer, disabled, onPublished, children }: Props) {
  const [busy, setBusy] = useState<"" | "preview" | "publish">("");
  const [err, setErr] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  // 「发布到声音市场」这个动作本身就是想给别人用，所以默认公开；不勾 = 只在「我的」里
  const [shared, setShared] = useState(true);

  const mixable = catalog?.mixable ?? [];
  const maxMix = catalog?.maxMixVoices ?? DEFAULT_MAX_MIX;
  const female = mixable.filter((v) => v.gender === "female");
  const male = mixable.filter((v) => v.gender === "male");
  const shares = mixShares(rows);
  const used = new Set(rows.map((r) => r.voiceId));
  const canAdd = rows.length < maxMix && mixable.some((v) => !used.has(v.id));
  const locked = disabled || !!busy;

  function setRow(i: number, patch: Partial<VoiceMixEntry>) {
    onRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const next = mixable.find((v) => !used.has(v.id));
    if (!next || !canAdd) return;
    // 新加的一味先占 0.5：等于说"来一半"——1 会立刻把原来的味冲淡，0.05 又几乎听不出来
    onRows([...rows, { voiceId: next.id, weight: 0.5 }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 1) return;
    onRows(rows.filter((_, k) => k !== i));
  }

  async function preview() {
    if (busy === "preview") {
      previewer.stop();
      return;
    }
    if (locked || !rows.length) return;
    setErr("");
    setBusy("preview");
    try {
      await previewer.play({ text: previewLine(name), mix: rows, rate: rate ?? followRate, pitch: pitch ?? undefined });
    } catch (e) {
      if (!isAbortError(e)) setErr(previewErrorText(e));
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    const tplNameTrimmed = tplName.trim();
    if (locked || !rows.length) return;
    if (!tplNameTrimmed) {
      setErr("给这把嗓子起个名字再发布。");
      return;
    }
    setErr("");
    setBusy("publish");
    let created: VoiceTemplate | null = null;
    try {
      created = (
        await createVoiceTemplate({
          name: tplNameTrimmed.slice(0, NAME_MAX),
          description: tplDesc.trim().slice(0, DESC_MAX),
          recipe: rows,
          // null = 模板本身不定语速，用的人跟随自己的人格/模型
          rate,
          pitch,
          expressive: true,
          shared,
        })
      ).template;
      await updateCompanionSettings({ voice: { templateId: created._id } });
      setFormOpen(false);
      setTplName("");
      setTplDesc("");
      onPublished(created);
    } catch (e) {
      setErr(
        created
          ? `已发布「${created.name}」，但设为你的声音时失败了（${companionErrorText(e, "服务端出错")}）。去「声音市场」里点「设为我的声音」就行，不用再发一遍。`
          : companionErrorText(e, "发布失败，稍后再试。"),
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div>
      <p className="mb-2 rounded-lg bg-sky-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-sky-200">
        混音只支持 1.0 音色，语调指令对混音无效。最多 {maxMix} 味：滑杆是相对权重，右侧是归一后的占比。
      </p>
      {catalogErr && <p className="mb-2 text-[11px] leading-4 text-rose-300">读不到混音目录：{catalogErr}</p>}
      {!catalog && !catalogErr && <p className="mb-2 text-[11px] text-slate-500">读取音色目录…</p>}
      {catalog && mixable.length === 0 && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-300">
          这台服务器还没有可混音的 1.0 音色目录（服务端需要更新），先用「单音色」。
        </p>
      )}

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-700 bg-panel px-3 py-2">
            <div className="flex items-center gap-2">
              <select
                value={r.voiceId}
                onChange={(e) => setRow(i, { voiceId: e.target.value })}
                disabled={locked}
                aria-label={`第 ${i + 1} 味音色`}
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 text-[13px] text-slate-100 outline-none focus:border-brand disabled:opacity-60"
              >
                {/* 目录里没有的 id（老数据 / 目录还没到）也得显示出来，否则下拉会静默跳到第一项 */}
                {!mixable.some((v) => v.id === r.voiceId) && <option value={r.voiceId}>{r.voiceId}</option>}
                {female.length > 0 && (
                  <optgroup label="女">
                    <VoiceOptions list={female} used={used} self={r.voiceId} />
                  </optgroup>
                )}
                {male.length > 0 && (
                  <optgroup label="男">
                    <VoiceOptions list={male} used={used} self={r.voiceId} />
                  </optgroup>
                )}
              </select>
              <span className="w-10 shrink-0 text-right text-[12px] font-semibold text-brand">{Math.round(shares[i] * 100)}%</span>
              <button
                onClick={() => removeRow(i)}
                disabled={locked || rows.length <= 1}
                aria-label="去掉这一味"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 disabled:opacity-30"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <input
              type="range"
              min={WEIGHT_MIN}
              max={WEIGHT_MAX}
              step={WEIGHT_STEP}
              value={clampWeight(r.weight)}
              onChange={(e) => setRow(i, { weight: Number(e.target.value) })}
              disabled={locked}
              aria-label={`第 ${i + 1} 味权重`}
              className="mt-1.5 w-full accent-brand"
            />
          </div>
        ))}
      </div>
      <button
        onClick={addRow}
        disabled={locked || !canAdd}
        className="mt-2 w-full rounded-full border border-dashed border-slate-600 py-1.5 text-[12px] text-slate-300 disabled:opacity-40"
      >
        + 加一味（{rows.length}/{maxMix}）
      </button>

      {children}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void preview()}
          disabled={disabled || busy === "publish" || !rows.length}
          className="flex-1 rounded-full border border-brand/60 py-2 text-[13px] font-semibold text-brand disabled:opacity-40"
        >
          {busy === "preview" ? "■ 停止" : "▶ 试听"}
        </button>
        <button
          onClick={() => {
            setErr("");
            setFormOpen((v) => !v);
          }}
          disabled={locked || !rows.length}
          className="flex-1 rounded-xl border border-slate-600 py-2.5 text-[13px] text-slate-200 disabled:opacity-40"
        >
          发布到声音市场
        </button>
      </div>

      {formOpen && (
        <div className="mt-2 rounded-xl border border-slate-700 bg-panel p-3">
          <input
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder="模板名字（必填，例：清冷知性）"
            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
          />
          <textarea
            value={tplDesc}
            onChange={(e) => setTplDesc(e.target.value)}
            rows={2}
            maxLength={DESC_MAX}
            placeholder="一句话介绍（选填）"
            className="mt-2 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
          />
          <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="accent-brand" />
            公开到声音市场（不勾 = 只在「我的」里）
          </label>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void publish()}
              disabled={locked || !tplName.trim()}
              className="flex-1 rounded-xl bg-brand py-2.5 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              {busy === "publish" ? "发布中…" : "发布并设为我的声音"}
            </button>
            <button
              onClick={() => setFormOpen(false)}
              disabled={busy === "publish"}
              className="rounded-xl border border-slate-600 px-4 py-2.5 text-[13px] text-slate-300 disabled:opacity-40"
            >
              取消
            </button>
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-[11px] leading-4 text-rose-300">{err}</p>}
    </div>
  );
}
