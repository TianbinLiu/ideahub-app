/**
 * 「声音」面板（客服页顶栏旁那颗 🎙️）：给数字人手调音色 / 语速 / 语调，存到服务端（官网与 App 同一份）。
 *
 * 声音是三层合并：用户覆盖 > 人格自带 > 模型推荐 > 服务端默认。面板改的只是「用户覆盖」这一层——
 * 「恢复跟随人格/模型」= 把这一层清掉（PUT { voice: null }），之后念台词用的就是人格/模型给的嗓子。
 * 列表与旋钮的样子沿用 SettingsVoicePage（铸卡师的声音），但**存的地方不同**：那边是本机 localStorage
 * （铸卡师是 3D 工坊里的本机 NPC），这边是账号级的服务端设置，别把两边的存取混到一起。
 *
 * ★ 点一把嗓子 = 选中 + 立刻试听：试听是唯一能证明"这把嗓子在这台服务器上真能出声"的动作。
 *   试听走 SpeechPlayer 喂口型，面板后面的看板娘会跟着张嘴——用户看得见"这就是她说话的样子"。
 * ★ 试听的参数与保存后真正念台词的一致（语速为空就用合并结果那一档，不是音色自带的预设）：
 *   试听听到的必须就是之后听到的，否则「保存」这个动作在用户眼里就是坏的。
 * ★ 只列单音色：voices.ts 里的「混音」配方要 1.0 音色（本账号未开通），且服务端只收一个 voiceId。
 * ★ 所有失败就地整句说明；保存成功才关面板并让页面重拉 config（voiceSettings 是服务端算的合并结果）。
 */
import { useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { ApiError } from "../../api/client";
import { companionErrorText, updateCompanionSettings, type CompanionSettings, type VoiceSettings } from "../../api/companion";
import { synthesizeSpeech } from "../../api/support";
import { SpeechPlayer } from "../../companion/speech";
import { companionBus } from "../../companion/bus";
import { VOICES, rateLabel, type PresetVoice } from "../../studio/voices";

/** 只列单音色（见文件头 ★） */
const SINGLE_VOICES = VOICES.filter((v) => !v.mix);
const INSTRUCT_MAX = 200;

type Props = {
  /** 数字人叫什么（试听台词里自报家门） */
  name: string;
  /** GET /api/companion/settings 的结果；null = 还没读到 / 老服务端 */
  settings: CompanionSettings | null;
  /** config.voiceSettings：服务端算好的合并结果；老服务端没有 → undefined */
  merged?: VoiceSettings;
  onClose: () => void;
  /** 保存 / 恢复成功后：页面重拉 config + settings */
  onSaved: () => void;
};

function voiceName(id: string): string {
  return SINGLE_VOICES.find((v) => v.id === id)?.name || id;
}

function previewErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 501 || e.status === 404) return "这台服务器没配云端语音，试听不了；保存设置仍然有效。";
    if (e.status === 429) return "试听太频繁了，稍等几秒再点。";
  }
  return companionErrorText(e, "试听没出声，稍后再试。");
}

export default function VoiceSheet({ name, settings, merged, onClose, onSaved }: Props) {
  const override = settings?.settings.voice ?? null;
  const [voiceId, setVoiceId] = useState(override?.voiceId || "");
  // null = 跟随（滑杆停在合并结果那一档）；一动就变成显式值
  const [rate, setRate] = useState<number | null>(override?.rate ?? null);
  const [instruct, setInstruct] = useState(override?.instruct || "");
  /** 正在做什么：音色 id = 试听中；"save" / "reset" = 写服务端 */
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const playerRef = useRef<SpeechPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 关面板：掐掉试听，嘴闭上
  useEffect(
    () => () => {
      abortRef.current?.abort();
      playerRef.current?.stop();
      companionBus.stopSpeaking();
    },
    [],
  );

  const following = !override;
  const followRate = merged?.rate ?? 0;
  // 面板不摆这两个旋钮：保留用户在官网设过的值，别一保存就把它们冲掉
  const expressive = override?.expressive ?? true;
  const pitch = override?.pitch ?? null;
  const saving = busy === "save" || busy === "reset";

  async function preview(v: PresetVoice) {
    setVoiceId(v.id);
    setErr("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(v.id);
    try {
      const blob = await synthesizeSpeech(
        {
          text: `你好，我是${name}，有什么可以帮你？`,
          voice: v.id,
          rate: rate ?? merged?.rate ?? undefined,
          pitch: pitch ?? undefined,
          instruct: instruct.trim() || merged?.instruct || undefined,
          expressive,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!playerRef.current) playerRef.current = new SpeechPlayer();
      await playerRef.current.play(blob, (level) => companionBus.mouth(level), { signal: controller.signal });
    } catch (e) {
      if (!controller.signal.aborted) setErr(previewErrorText(e));
    } finally {
      if (abortRef.current === controller) {
        companionBus.stopSpeaking();
        setBusy("");
      }
    }
  }

  async function save() {
    if (busy) return;
    setBusy("save");
    setErr("");
    try {
      await updateCompanionSettings({
        voice: { voiceId, rate, pitch, instruct: instruct.trim().slice(0, INSTRUCT_MAX), expressive },
      });
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

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={saving ? undefined : onClose}>
      <div
        className="flex max-h-[82vh] w-full flex-col rounded-t-3xl border-t border-white/10 bg-slate-950/95 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          <span className="shrink-0 text-[14px] font-semibold text-slate-100">{name}的声音</span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
            {following ? `跟随人格/模型：${merged?.voiceId ? voiceName(merged.voiceId) : "服务端默认"}` : "你的设置（官网同步）"}
          </span>
          <button onClick={onClose} disabled={saving} aria-label="关闭" className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-300 disabled:opacity-40">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
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
        </div>

        <div className="flex shrink-0 gap-2 border-t border-white/10 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
          <button onClick={() => void save()} disabled={!!busy} className="flex-1 rounded-full bg-brand py-2.5 text-[14px] font-semibold text-ink disabled:opacity-60">
            {busy === "save" ? "保存中…" : "保存"}
          </button>
          <button
            onClick={() => void reset()}
            disabled={!!busy || following}
            className="rounded-full border border-slate-600 px-4 py-2.5 text-[13px] text-slate-300 disabled:opacity-40"
          >
            {busy === "reset" ? "恢复中…" : "恢复跟随人格/模型"}
          </button>
        </div>
      </div>
    </div>
  );
}
