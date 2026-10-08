// 「改这一帧」—— 出片**之前**就把关键画面改对（N3，2026-10-03 对标 LibTV 的图片节点：先做图再出片）。
//
// 两种改法，都是一张图的钱，都在同一处实现（flowStore.editFrame）：
//   ✨ 一句话改：在这一帧上按要求改（带上卡片形象图锁脸；句子里 `@名字` 点到的临时参考图一并带上）；
//   ⭕ 圈着改：先在这一帧上圈出要动的那一处，只改圈里的（底图是画着红圈的那张，FrameAnnotator 与成片圈选同一个）。
//
// ★ 这件事此前只有工坊方案台有（「✨ AI 改首帧 / 改尾帧」，且只有一句话那一种），画布与自定义车道都没有；
//   圈选则只能在**成片**上圈（重炼时才生效，要再花一次出片钱才看得到结果）。现在三处是同一个组件、同一条规则。
// ★ 只收 props、不认识任何 store（与 CustomFrameSlots / RefStrip 同一条约束）：能不能改、改完写到哪儿都在宿主接的那个 action 里。
// ★ 圈选弹窗 portal 到 body：宿主可能在带 transform / backdrop-filter 的容器里（画布的变换层、投影窗），fixed 会被它们当包含块。
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { createPortal } from "react-dom";
import FrameAnnotator from "../FrameAnnotator";

export default function FrameEditBox({
  first,
  last,
  carriedFirst,
  disabled,
  editing,
  costLabel,
  canMention,
  onEdit,
}: {
  /** 这两帧现在的画面（首帧承接上一段时传那张承接帧）；空串 = 还没有，那颗键点不动 */
  first: string;
  last: string;
  /** 首帧是承接上一段结尾来的：改了它，这一段就不再从上一段结尾起拍（要当面说） */
  carriedFirst?: boolean;
  disabled: boolean;
  /** 正在改哪一帧（flowStore.frameEdit 落在这一段上时） */
  editing: "first" | "last" | null;
  /** 一张图的价（演示构建传 null：不印价） */
  costLabel: string | null;
  /** 这一段挂着临时参考图：提示可以在句子里用 @名字 把它带上 */
  canMention?: boolean;
  /** 发起改帧。回 false = 被拒 / 没改成（原因宿主那条错误条会画），输入不清空 */
  onEdit: (which: "first" | "last", req: string, annotated?: string) => Promise<boolean>;
}) {
  const { t } = useLingui();
  const [which, setWhich] = useState<"first" | "last" | null>(null);
  const [req, setReq] = useState("");
  const [annot, setAnnot] = useState(false);
  const frame = which === "first" ? first : which === "last" ? last : "";
  /** 常用改法：点一下填进输入框（文字是唯一真身，填完还能改） */
  const presets = [t`去掉背景里的路人`, t`改成夜晚`, t`改成下雨天`, t`换一个表情`, t`光线改成黄昏`];
  const run = (annotated?: string, text?: string) => {
    if (!which) return;
    const w = which;
    void onEdit(w, (text ?? req).trim(), annotated).then((ok) => {
      if (ok) {
        setWhich(null);
        setReq("");
      }
    });
  };
  return (
    <div data-guide="frame-edit" className="space-y-1.5">
      <div className="flex gap-1.5">
        {(["first", "last"] as const).map((w) => {
          const has = !!(w === "first" ? first : last);
          return (
            <button
              key={w}
              type="button"
              onClick={() => {
                setWhich(which === w ? null : w);
                setReq("");
              }}
              disabled={disabled || !has}
              title={!has ? (w === "first" ? t`还没有首帧可改` : t`还没有尾帧可改`) : undefined}
              className={`flex-1 rounded-full border py-1.5 text-[11px] disabled:opacity-40 ${
                which === w ? "border-brand bg-brand/10 text-slate-100" : "border-slate-600 text-slate-300"
              }`}
            >
              {editing === w ? t`改图中…` : w === "first" ? t`✨ 改首帧` : t`✨ 改尾帧`}
            </button>
          );
        })}
      </div>
      {which && frame && (
        <div className="space-y-1.5 rounded-lg bg-black/30 p-2">
          {which === "first" && carriedFirst && (
            <p className="text-[10px] leading-relaxed text-amber-300/90">
              <Trans>这张开头帧承接的是上一段的结尾——改了它，这一段就不再从上一段结尾起拍。</Trans>
            </p>
          )}
          {/* 不另摆缩略图：这一帧就在旁边（方案台的首尾帧卡 / 自定义车道的两格），方案台那一栏只有一百多像素宽，输入框要占满 */}
          <textarea
            value={req}
            onChange={(e) => setReq(e.target.value)}
            rows={2}
            maxLength={160}
            disabled={disabled}
            placeholder={t`例：把伞换成红色 / 去掉背景里的路人 / 光线改成黄昏`}
            className="w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
          />
          <div className="no-scrollbar flex gap-1 overflow-x-auto">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReq(p)}
                disabled={disabled}
                className="flex-none rounded-full bg-slate-700/60 px-2 py-0.5 text-[10px] text-slate-300 disabled:opacity-40"
              >
                {p}
              </button>
            ))}
          </div>
          {/* 窄栏里两颗键各占一行（min-w 逼它换行），宽的地方并排 */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => run()}
              disabled={disabled || !req.trim()}
              className="min-w-[128px] flex-1 rounded-full bg-brand px-2 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-40"
            >
              {editing ? t`改图中…` : costLabel ? t`按这句话改（${costLabel}）` : t`按这句话改`}
            </button>
            <button
              type="button"
              onClick={() => setAnnot(true)}
              disabled={disabled}
              className="min-w-[128px] flex-1 rounded-full border border-slate-600 px-2 py-1.5 text-[11px] text-slate-200 disabled:opacity-40"
            >
              {costLabel ? t`⭕ 圈出一处再改（${costLabel}）` : t`⭕ 圈出一处再改`}
            </button>
          </div>
          {/* ★ @名字 只对「按这句话改」管用（flowStore.editFrame）：圈着改的底图是画着红圈的那张、一张别的图都不带（2.62 发版评审抓到：
              原来这句话压在两颗键底下，照着它在圈选窗里写 @名字，模型拿到的只是一个名字、根本没见过那张图） */}
          <p className="text-[10px] leading-relaxed text-slate-500">
            {canMention ? (
              <Trans>改好的帧会顶替这一张并锁住（重画这一套时不动它）。想照着某张临时参考图改，就用「按这句话改」，在句子里写 @它的名字（圈着改只看圈里那一处，不带参考图）。</Trans>
            ) : (
              <Trans>改好的帧会顶替这一张并锁住（重画这一套时不动它）。</Trans>
            )}
          </p>
        </div>
      )}
      {annot &&
        which &&
        frame &&
        createPortal(
          <div className="relative z-[70]">
            <FrameAnnotator
              frame={frame}
              hint={t`圈出要改的那一处，写一句要求——只改圈里的，改好直接顶替这一帧`}
              onClose={() => setAnnot(false)}
              onSave={(annotated, text) => {
                setAnnot(false);
                run(annotated, text);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}
