// 「上传本地音频」当声音样本 —— 与跟读录音同一种产物（cardVoice 的 WAV dataURL），
// 只是声源换成文件。解码/窗口/封装的唯一实现在 utils/wav.audioFileToVoice。
import { useRef, useState } from "react";
import { VOICE_MAX_SEC, VOICE_MIN_SEC } from "../data/cardVoice";
import { audioFileToVoice } from "../utils/wav";

export default function VoiceUploadButton({
  onDone,
}: {
  onDone: (v: { dataUrl: string; durationSec: number; note: string }) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full rounded-full border border-slate-600 py-2 text-[11px] text-slate-300 disabled:opacity-40"
      >
        {busy ? "处理中…" : `🎵 上传本地音频（${VOICE_MIN_SEC}~${VOICE_MAX_SEC} 秒）`}
      </button>
      {err && <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{err}</p>}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          setErr("");
          void audioFileToVoice(f, VOICE_MIN_SEC, VOICE_MAX_SEC)
            .then((v) =>
              onDone({
                dataUrl: v.dataUrl,
                durationSec: v.durationSec,
                // 掐过头要如实说（durationSec 与 dataUrl 永远一致，见 audioFileToVoice 的 ★）
                note: v.trimmed ? `上传音频（原片较长，取前 ${VOICE_MAX_SEC}s）` : "上传音频",
              }),
            )
            .catch((er) => setErr(er instanceof Error ? er.message : String(er)))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}
