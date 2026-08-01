// 画质设置弹窗：三档模型精细度，选择后整页重载生效
import { useState } from "react";
import { getQuality, setQuality, QUALITY_LABELS, type Quality } from "../quality";

export default function QualityPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState<Quality>(() => getQuality());
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[86%] max-w-sm rounded-2xl border border-slate-600/50 bg-panel/95 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-bold text-slate-100">画面质量</h3>
        <p className="mb-4 text-xs text-slate-400">决定角色建模的精细度；切换后会重新载入工坊</p>
        <div className="flex flex-col gap-2">
          {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
            <button
              key={q}
              onClick={() => setCur(q)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                cur === q
                  ? "border-brand bg-brand/15 text-slate-100"
                  : "border-slate-600/40 bg-black/20 text-slate-300"
              }`}
            >
              <div>
                <div className="text-sm font-semibold">{QUALITY_LABELS[q].name}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{QUALITY_LABELS[q].desc}</div>
              </div>
              {cur === q && <span className="text-brand">✓</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-1.5 text-xs text-slate-400">
            取消
          </button>
          <button
            onClick={() => {
              if (cur !== getQuality()) setQuality(cur);
              else onClose();
            }}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-black"
          >
            应用
          </button>
        </div>
      </div>
    </div>
  );
}
