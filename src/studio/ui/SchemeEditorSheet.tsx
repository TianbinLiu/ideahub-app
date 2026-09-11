// 「提示词方案」编辑屏：自建一套，或从内置的那几套改一份出来。
//
// ★★ 为什么值得有这一屏：方案的价值全在**提示词**里，而提示词是要反复调的 ——
//   只能用内置那三套的话，"方案市场"就只是三个固定按钮。这一屏是 UGC 的入口。
//
// ★ 校验只有一处（`data/promptSchemes.schemeIssue`）：这里和 `saveScheme` 问的是
//   同一把尺。抄第二份的下场是"编辑屏放行、保存那头拒"，用户点了保存什么都没发生。
// ★ 三条方案作者**改不动**的硬规则不在这一屏开放（见 promptSchemes 文件头 ★★★）：
//   风格跟随参考图那句由 slotPrompt 统一拼、图位数 ≤ MAX_CARD_VIEWS、
//   合成规格图该走 display —— 后者拦不住（作者可以乱选），所以每一档 role 旁边
//   写清楚它意味着什么（ROLE_LABELS.hint），别让人以为选哪个都一样。
// ★ 整屏浮层 portal 到 body：祖先上的 backdrop-blur / transform 会给 fixed 后代造
//   包含块，inset-0 会缩到那个盒子里（CLAUDE.md 那条坑）。
import { useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import { CloseButton } from "../../components/IconTapButton";
import { MAX_CARD_VIEWS, ROLE_LABELS, VIEW_TAG_MAX, type CardRole } from "../../types";
import { isGenerated, saveScheme, schemeIssue, type PromptScheme, type SchemeSlot } from "../../data/promptSchemes";
import { fmtTokens, schemeCost } from "../../data/economy";
import { AI_REAL } from "../../ai";

const ROLES: CardRole[] = ["primary", "face", "aux", "display"];

/** 新建时的起手图位：一格能出片的主图。★ 不给空数组——空列表让人不知道从哪下手 */
function blankSlot(): SchemeSlot {
  return { tag: "", role: "primary", prompt: "" };
}

export default function SchemeEditorSheet({
  source,
  onSaved,
  onClose,
}: {
  /** 从哪一套改。内置的会被当成「另存为」（内置不可改，见 PromptScheme.builtin） */
  source?: PromptScheme;
  onSaved: (s: PromptScheme) => void;
  onClose: () => void;
}) {
  /** 内置只能"另存为"，用户自己那份才是真的改 */
  const { t } = useLingui();
  const copying = !source || !!source.builtin;
  const [title, setTitle] = useState(source ? (source.builtin ? t`${source.title} 副本` : source.title) : "");
  const [intro, setIntro] = useState(source?.intro ?? "");
  const [faceless, setFaceless] = useState(!!source?.faceless);
  // ★ 复制时去掉图位 id（其余一位不动）：id 只属于内置方案，身份键与 CardView.tag 按它取冻结的中文原名
  //   （promptSchemes.slotKey / slotCardTag）。另存出来的是**用户方案**，按它自己的 slot.tag 认 —— 这一格的名字
  //   用户随时会改，带着内置 id 存进本机方案库、发到市场，「带 id = 内置图位」这条就在存储里失真了。
  const [slots, setSlots] = useState<SchemeSlot[]>(
    source
      ? source.slots.map((s) => {
          const copy = { ...s };
          delete copy.id;
          return copy;
        })
      : [blankSlot()],
  );
  const [err, setErr] = useState("");

  function patchSlot(i: number, patch: Partial<SchemeSlot>) {
    setErr("");
    setSlots((cur) => cur.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }

  function save() {
    // ★ 与 saveScheme 同一把尺（唯一实现），所以这里过了那边一定过
    const issue = schemeIssue({ title: title.trim(), slots });
    if (issue) {
      setErr(issue);
      return;
    }
    try {
      const saved = saveScheme({
        // 内置的另存为要**换新 id**（不传 id 就是新建），否则会盖掉内置那套的位置
        id: copying ? undefined : source?.id,
        title: title.trim(),
        intro: intro.trim(),
        faceless,
        slots,
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const cost = schemeCost(slots);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-ink p-4 sm:rounded-2xl sm:border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100">
            {copying ? (source ? t`另存为我的方案` : t`自建一套方案`) : t`改这套方案`}
          </h3>
          <CloseButton chip="sm" size={13} align="end" onClick={onClose} />
        </div>
        {/* 内置不可改这件事要说出来，不然用户改半天发现存出来的是另一套 */}
        {source?.builtin && (
          <p className="mb-2 rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-400">
            <Trans>内置方案不能直接改——保存后会另存成<b className="text-slate-300">你自己的一套</b>，内置那套保持原样。</Trans>
          </p>
        )}

        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setErr("");
          }}
          maxLength={20}
          placeholder={t`方案名字（例如「白模三视图·我的版」）`}
          className="mb-1.5 w-full rounded-lg border border-slate-700 bg-panel px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-500"
        />
        <input
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          maxLength={60}
          placeholder={t`一句话说清它产出什么（选方案时会显示）`}
          className="mb-1.5 w-full rounded-lg border border-slate-700 bg-panel px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500"
        />
        {/* ★ 「无脸」只描述**产出形态**，措辞绝不能暗示"更容易过检测"（design doc §B2） */}
        <label className="mb-2.5 flex items-start gap-2 text-[11px] leading-relaxed text-slate-300">
          <input
            type="checkbox"
            checked={faceless}
            onChange={(e) => setFaceless(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none accent-brand"
          />
          <span>
            <Trans>产出里不含可辨认的人脸（白模台 / 剪影 / 人脸与服装分离）</Trans>
            <span className="block text-[10px] text-slate-500">
              <Trans>勾上后会排在方案列表前面——只借动作与穿着、不复刻长相的做法</Trans>
            </span>
          </span>
        </label>

        <div className="mb-1 flex items-center justify-between">
          <span className="mb-1.5 text-xs font-semibold text-slate-300">
            <Trans>图位（{slots.length}/{MAX_CARD_VIEWS}）</Trans>
          </span>
          <span className="text-[10px] text-slate-500">{AI_REAL ? t`炼一次约 ${fmtTokens(cost)}` : t`演示模式不计费`}</span>
        </div>

        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-700/70 bg-panel p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <input
                  value={s.tag}
                  onChange={(e) => patchSlot(i, { tag: e.target.value })}
                  /* ★★ 硬拦在 VIEW_TAG_MAX：服务端那头是 zod .max()，超了是**整发 400**
                     （这张卡发不上去且零报错），不是把标签截短 */
                  maxLength={VIEW_TAG_MAX}
                  placeholder={t`图位 ${i + 1} 的名字，如「白模全身」`}
                  className="min-w-0 flex-1 rounded-md border border-slate-700 bg-ink/60 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-500"
                />
                {slots.length > 1 && (
                  <button
                    onClick={() => {
                      setErr("");
                      setSlots((cur) => cur.filter((_, k) => k !== i));
                    }}
                    className="flex-none text-[11px] text-slate-500"
                  >
                    <Trans>删</Trans>
                  </button>
                )}
              </div>

              {/* role：选了会怎样写在下面一行（ROLE_LABELS.hint，唯一实现在 types.ts） */}
              <div className="mb-1 flex flex-wrap gap-1">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    onClick={() => patchSlot(i, { role: r })}
                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                      s.role === r ? "bg-brand font-semibold text-ink" : "bg-slate-700/70 text-slate-300"
                    }`}
                  >
                    {ROLE_LABELS[r].label}
                  </button>
                ))}
              </div>
              <p className="mb-1.5 text-[9px] leading-relaxed text-slate-500">{ROLE_LABELS[s.role].hint}</p>

              <label className="mb-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <input
                  type="checkbox"
                  checked={!!s.fromCrop}
                  onChange={(e) => patchSlot(i, { fromCrop: e.target.checked })}
                  className="h-3.5 w-3.5 accent-brand"
                />
                <Trans>直接用原片裁剪，不让 AI 画（这一格不花钱）</Trans>
              </label>

              {isGenerated(s) ? (
                <>
                  <div className="mb-1 flex gap-1">
                    {(["body", "face"] as const).map((rf) => (
                      <button
                        key={rf}
                        onClick={() => patchSlot(i, { ref: rf })}
                        className={`rounded-md px-2 py-0.5 text-[10px] ${
                          (s.ref ?? "body") === rf ? "bg-slate-600 text-slate-100" : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {rf === "face" ? <Trans>参考脸部裁剪</Trans> : <Trans>参考主裁剪</Trans>}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={s.prompt}
                    onChange={(e) => patchSlot(i, { prompt: e.target.value })}
                    maxLength={400}
                    placeholder={t`这一格要画成什么样？（画风句会自动接上）`}
                    className="h-16 w-full resize-none rounded-md border border-slate-700 bg-ink/60 px-2 py-1.5 text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-500"
                  />
                </>
              ) : (
                <p className="text-[10px] text-slate-500"><Trans>这一格放原片裁剪本身，不调模型、不计费。</Trans></p>
              )}
            </div>
          ))}
        </div>

        {slots.length < MAX_CARD_VIEWS && (
          <button
            onClick={() => {
              setErr("");
              setSlots((cur) => [...cur, blankSlot()]);
            }}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-600 py-1.5 text-[11px] text-slate-400"
          >
            <Trans>＋ 再加一个图位</Trans>
          </button>
        )}

        {/* 画风那条硬规则要明说：作者会以为自己能在提示词里指定画风，实际会被自动接上的那句盖住 */}
        <p className="mt-2 text-[9px] leading-relaxed text-slate-600">
          <Trans>
            每一格的提示词后面都会自动接上「保持参考图的画风与人物长相一致」——真人截图出写实、动漫截图出同风格插画。这一条不开放修改，免得真人素材被画成另一个画风。
          </Trans>
        </p>

        {err && <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{err}</p>}
        <button onClick={save} className="mt-2.5 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
          {AI_REAL && cost > 0
            ? copying
              ? t`存成我的方案（用它炼一次约 ${fmtTokens(cost)}）`
              : t`保存修改（用它炼一次约 ${fmtTokens(cost)}）`
            : copying
              ? t`存成我的方案`
              : t`保存修改`}
        </button>
      </div>
    </div>,
    document.body,
  );
}
