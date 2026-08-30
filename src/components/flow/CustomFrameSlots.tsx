// 「自定义首尾帧」的两格编辑条 —— 画布 NodePanel 与简约 NodeScreen 共用的一份 markup。
//
// ★ 只收 props、不认识任何 store（与 PlanBoard/FuseFrameSheet 同一条约束）：
//   帧写入的唯一实现是 flowStore.setFrame（pinned/承接语义都在那边），这里只负责画。
//   两个宿主各抄一份 60 行的格子，哪天空态文案或清帧按钮改了就会各长各的样。
// ★ 上传的解码/压制走 utils/image.fileToFrameDataUrl（工坊上传开头帧同一条路）。
import { useRef } from "react";
import { fileToFrameDataUrl } from "../../utils/image";

export default function CustomFrameSlots({
  first,
  last,
  aspectCssValue,
  canEdit,
  firstEmptyNote,
  onFrame,
  onFuse,
  onError,
}: {
  first: string;
  last: string;
  /** CSS aspect-ratio 值（types.aspectCss 的产物）——帧格按本段画幅撑形状 */
  aspectCssValue: string;
  canEdit: boolean;
  /** 首帧空着时那句说明（承接/AI 补画由宿主按 index/chain 定，这里不判） */
  firstEmptyNote: string;
  /** 写帧（传 "" = 清掉）。宿主接 flowStore.setFrame */
  onFrame: (which: "first" | "last", dataUrl: string) => void;
  /** 打开融图（宿主自己挂 FuseFrameSheet） */
  onFuse: (which: "first" | "last") => void;
  /** 文件解码失败要出声（铁律八），宿主决定写到哪条错误位上 */
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<"first" | "last">("first");
  return (
    <>
      <div className="flex gap-2">
        {(["first", "last"] as const).map((which) => {
          const url = which === "first" ? first : last;
          const emptyNote = which === "first" ? firstEmptyNote : "空 = AI 按提示词补画（计费）";
          return (
            <div key={which} className="flex-1 rounded-lg border border-slate-700/70 bg-panel p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-300">{which === "first" ? "首帧" : "尾帧"}</span>
                {url && canEdit && (
                  <button onClick={() => onFrame(which, "")} className="text-[10px] text-slate-500">
                    清掉
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  pickRef.current = which;
                  fileRef.current?.click();
                }}
                disabled={!canEdit}
                className="relative w-full overflow-hidden rounded-md border border-dashed border-slate-600 bg-ink/60 disabled:opacity-50"
                style={{ aspectRatio: aspectCssValue }}
              >
                {url ? (
                  <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center text-slate-500">
                    <span className="text-sm">＋</span>
                    <span className="text-[9px] leading-tight">{emptyNote}</span>
                  </span>
                )}
              </button>
              <button
                onClick={() => onFuse(which)}
                disabled={!canEdit}
                className="mt-1 w-full rounded-md border border-slate-600 py-1 text-[10px] text-slate-300 disabled:opacity-40"
              >
                🎨 融图合成这一帧
              </button>
            </div>
          );
        })}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 同一张图连选两次也要能触发
          if (!f) return;
          const which = pickRef.current;
          void fileToFrameDataUrl(f).then(
            (d) => onFrame(which, d),
            (err) => onError(err instanceof Error ? err.message : String(err)),
          );
        }}
      />
    </>
  );
}
