/**
 * 人格制作向导（/support/personas/new）——设计正本 docs/digital-human-creator-center.md §4.3 的 7 步：
 * 基本设定 → 素材 → 问卷 → AI 生成 → 试聊 → 微调 → 发布。
 *
 * ★ 这一页**只画界面**：表单状态、两条 AI 长活与发布都在 studio/personaWizardStore.ts（结果必须落在 store，
 *   人退出这一页时 Promise 照跑，写进已卸载组件 = 生成好的草稿静默丢掉），问卷 / 说话人识别 / 字数上限
 *   在 companion/personaWizard.ts。
 * ★ 反馈形状（CLAUDE.md + ui-copy-grammar）：整句的成功 / 提醒 / 失败一律**就地**画成页内三色横幅或
 *   控件下的一行小字，不用 toast；人已经离开这一页时，唯一的通知渠道是 data/jobs 的全局胶囊。
 * ★ 试聊在途时**不**因为组件卸载而 abort：那条 SSE 的结果写进 store，人回来还能看到（abort 只发生在
 *   换一句话、重生成、清空重来这三处）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import ConfirmDialog from "../components/ConfirmDialog";
import EmptyState from "../components/EmptyState";
import Icon from "../components/Icon";
import PageHeader from "../components/PageHeader";
import Spinner from "../components/Spinner";
import TagInput from "../components/TagInput";
import { useBackOr } from "../hooks/useBackOr";
import type { PersonaDraftField, PersonaMaterialKind } from "../api/companion";
import {
  MATERIAL_FILE_ACCEPT,
  MATERIAL_KIND_LABEL,
  MATERIAL_TOTAL_MAX,
  PERSONA_COVER_EMOJIS,
  PERSONA_LIMITS,
  PERSONA_QUESTIONS,
  PERSONA_ROLES,
  PERSONA_TAG_LEN,
  PERSONA_TAG_MAX,
  choiceValueAt,
  overLimitText,
  questionnaireTouched,
} from "../companion/personaWizard";
import {
  PERSONA_STEPS,
  PREVIEW_ROUNDS_MAX,
  abortPreview,
  addMaterial,
  analysisUsed,
  clearPreview,
  equipPublishedPersona,
  exampleFilled,
  generateBlockedReason,
  materialChars,
  patchDraft,
  patchStyle,
  previewRounds,
  publishPersona,
  removeMaterial,
  resetPersonaWizard,
  runGeneratePersona,
  sendPreviewMessage,
  useWizardField,
  usePersonaWizard,
  wizardBusy,
  wizardDirty,
  type PersonaStep,
  type WizardBanner,
} from "../studio/personaWizardStore";
import { parseTags } from "../types";

// ── 样式速查（CLAUDE.md 的形状，全页只写这一份）────────────────────────────
const INPUT =
  "w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand";
const TEXTAREA = `${INPUT} resize-none leading-relaxed`;
const PRIMARY = "rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40";
const SECONDARY = "rounded-xl border border-slate-600 py-2.5 text-sm font-semibold text-slate-300 disabled:opacity-40";
const CARD = "rounded-xl border border-slate-700/70 bg-panel p-3";
const CHIP = "rounded-full px-3.5 py-1.5 text-xs font-semibold";
const CHIP_ON = "bg-brand text-ink";
const CHIP_OFF = "bg-panel text-slate-300";
/** 行内小键（列表行里的「只换这个」「删」）：紧凑一律胶囊 */
const MINI = "rounded-full bg-slate-800 px-3 py-1 text-[11px] font-semibold text-slate-300 disabled:opacity-40";
const FIELD_LABEL = "mb-1.5 text-sm font-semibold text-slate-300";
const CARD_LABEL = "mb-1.5 text-xs font-semibold text-slate-300";

/** 三色横幅：底色只有 /10 一档，边线一律同色 /40（CLAUDE.md「提示条」那条） */
const BANNER_CLS: Record<WizardBanner["kind"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const DRAFT_FIELD_LABEL: Record<PersonaDraftField, MessageDescriptor> = {
  name: msg`名字`,
  description: msg`简介`,
  tags: msg`标签`,
  summary: msg`说话风格`,
  catchphrases: msg`口头禅`,
  stanceHint: msg`立场倾向`,
  tone: msg`语气`,
  addressUser: msg`称呼`,
  greeting: msg`开场白`,
  examples: msg`示例对话`,
  boundaries: msg`边界`,
};

function Banner({ banner }: { banner: WizardBanner | null }) {
  if (!banner) return null;
  return <div className={`mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${BANNER_CLS[banner.kind]}`}>{banner.text}</div>;
}

/** 控件下面那一行报错小字（就地整句，铁律八） */
function ErrLine({ text }: { text: string }) {
  if (!text) return null;
  return <p className="mt-1.5 text-xs leading-relaxed text-rose-300">{text}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className={FIELD_LABEL}>{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** 有上限的输入框：超了当场在旁边说，别等提交吃 400 */
function LimitedInput({
  value,
  onChange,
  max,
  placeholder,
  rows,
}: {
  value: string;
  onChange: (v: string) => void;
  max: number;
  placeholder?: string;
  rows?: number;
}) {
  const over = overLimitText(value, max);
  return (
    <div>
      {rows ? (
        <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={TEXTAREA} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT} />
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${over ? "text-rose-300" : "text-slate-500"}`}>{over || `${value.length} / ${max}`}</span>
      </div>
    </div>
  );
}

// ── 第 1 步：基本设定 ───────────────────────────────────────────────────────
function StepBasics() {
  const [name, setName] = useWizardField("name");
  const [role, setRole] = useWizardField("role");
  const [roleCustom, setRoleCustom] = useWizardField("roleCustom");
  const [relation, setRelation] = useWizardField("relation");
  const [intro, setIntro] = useWizardField("intro");
  const [addressUser, setAddressUser] = useWizardField("addressUser");
  const [coverEmoji, setCoverEmoji] = useWizardField("coverEmoji");
  const { t } = useLingui();

  return (
    <div className="space-y-4">
      <Field label={t`叫什么名字`}>
        <LimitedInput value={name} onChange={setName} max={PERSONA_LIMITS.name} placeholder={t`给这个人格起个名字`} />
      </Field>

      <Field label={t`TA 是做什么的`} hint={t`选一个大方向就行，后面 AI 会照着写。`}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {PERSONA_ROLES.map((r) => {
            const on = r.key === "custom" ? roleCustom : !roleCustom && role === r.label;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => {
                  if (r.key === "custom") {
                    setRoleCustom(true);
                    setRole("");
                  } else {
                    setRoleCustom(false);
                    setRole(r.label);
                  }
                }}
                className={`${CHIP} shrink-0 ${on ? CHIP_ON : CHIP_OFF}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        {roleCustom ? (
          <input
            value={role}
            onChange={(e) => setRole(e.target.value.slice(0, 20))}
            placeholder={t`比如「树洞」「陪练」「编剧搭子」`}
            className={`mt-2 ${INPUT}`}
          />
        ) : (
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            {PERSONA_ROLES.find((r) => r.label === role)?.hint ?? t`还没选。`}
          </p>
        )}
      </Field>

      <Field label={t`和你是什么关系`} hint={t`朋友 / 学姐 / 助理 / 搭子…… 这一句会明显影响说话的分寸。`}>
        <input value={relation} onChange={(e) => setRelation(e.target.value.slice(0, 40))} placeholder={t`比如「认识很久的朋友」`} className={INPUT} />
      </Field>

      <Field label={t`一句话简介`}>
        <LimitedInput value={intro} onChange={setIntro} max={PERSONA_LIMITS.intro} placeholder={t`一句话说清 TA 是谁`} rows={2} />
      </Field>

      <Field label={t`TA 怎么称呼你`}>
        <LimitedInput value={addressUser} onChange={setAddressUser} max={PERSONA_LIMITS.addressUser} placeholder={t`你 / 您 / 我的名字`} />
      </Field>

      <Field label={t`封面 emoji`}>
        <div className="flex flex-wrap items-center gap-2">
          {PERSONA_COVER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setCoverEmoji(e)}
              className={`h-10 w-10 rounded-xl text-xl ${coverEmoji === e ? "bg-brand/15 ring-1 ring-brand" : "bg-panel"}`}
            >
              {e}
            </button>
          ))}
          <input
            value={coverEmoji}
            onChange={(e) => setCoverEmoji(e.target.value.slice(0, 4))}
            aria-label={t`自己敲一个 emoji`}
            className="h-10 w-16 rounded-xl border border-slate-700 bg-panel text-center text-xl text-slate-100 outline-none focus:border-brand"
          />
        </div>
      </Field>
    </div>
  );
}

// ── 第 2 步：素材 ───────────────────────────────────────────────────────────
function StepMaterials() {
  const materials = usePersonaWizard((s) => s.materials);
  const speakers = usePersonaWizard((s) => s.speakers);
  const [speaker, setSpeaker] = useWizardField("speaker");
  const [reading, setReading] = useWizardField("reading");
  const [materialErr, setMaterialErr] = useWizardField("materialErr");
  const [kind, setKind] = useState<PersonaMaterialKind>("chat");
  const [paste, setPaste] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const total = materials.reduce((n, m) => n + m.chars, 0);
  const over = total - MATERIAL_TOTAL_MAX;
  const { t } = useLingui();

  async function pickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setMaterialErr("");
    for (const file of Array.from(files)) {
      const fileName = file.name;
      setReading(t`正在读 ${fileName}…`);
      try {
        const text = await file.text();
        if (!text.trim()) {
          setMaterialErr(t`${fileName} 里没有文字。`);
          continue;
        }
        addMaterial(kind, file.name, text);
      } catch {
        // 读不出来要说是哪一个（一句「导入失败」在多选时等于没说）
        setMaterialErr(t`${fileName} 读不出来，换个纯文本文件试试。`);
      }
    }
    setReading("");
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-200">
        <Trans>素材只用来生成这一次的人格，不入库、不公开，也不会出现在发布出去的人格卡里。</Trans>
      </div>

      <Field label={t`这是什么素材`}>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MATERIAL_KIND_LABEL) as PersonaMaterialKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`${CHIP} ${k === kind ? CHIP_ON : CHIP_OFF}`}>
              {MATERIAL_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t`粘一段进来`}>
        <textarea
          rows={5}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={t`聊天记录、发过的文案、随手写的笔记都行`}
          className={TEXTAREA}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!paste.trim()}
            onClick={() => {
              addMaterial(kind, t`粘贴的文本`, paste);
              setPaste("");
            }}
            className={`flex-1 ${PRIMARY}`}
          >
            <Trans>加进来</Trans>
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} className={`flex-1 ${SECONDARY}`}>
            <Trans>选文件</Trans>
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={MATERIAL_FILE_ACCEPT}
          hidden
          onChange={(e) => void pickFiles(e.target.files)}
        />
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500"><Trans>支持 {MATERIAL_FILE_ACCEPT} 这几种纯文本，可以一次选多个。</Trans></p>
      </Field>

      {reading && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Spinner size="xs" />
          {reading}
        </div>
      )}
      <ErrLine text={materialErr} />

      {materials.length > 0 && (
        <div>
          <div className={CARD_LABEL}><Trans>已经导入 {materials.length} 条，一共 {total} 字</Trans></div>
          <div className="space-y-2">
            {materials.map((m) => (
              <div key={m.id} className={`flex items-center gap-2 ${CARD}`}>
                <Icon name="file" size={16} className="shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-100">{m.label}</div>
                  <div className="text-[11px] text-slate-500">
                    <Trans>{MATERIAL_KIND_LABEL[m.kind]} · {m.chars} 字</Trans>
                  </div>
                </div>
                <button type="button" onClick={() => removeMaterial(m.id)} className={MINI}>
                  <Trans>删掉</Trans>
                </button>
              </div>
            ))}
          </div>
          {over > 0 && (
            <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
              <Trans>超出上限 {over} 字。送去分析时会从最前面截掉这一段，保留最近的 {MATERIAL_TOTAL_MAX} 字（越靠后越像现在的 TA）。</Trans>
            </div>
          )}
        </div>
      )}

      {speakers.length > 0 && (
        <Field label={t`哪个是 TA`} hint={t`只把 TA 说的话送去分析，不然会把你自己的说话方式也学进去。`}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSpeaker("")} className={`${CHIP} ${speaker === "" ? CHIP_ON : CHIP_OFF}`}>
              <Trans>不筛，全都要</Trans>
            </button>
            {speakers.map((sp) => (
              <button
                key={sp.name}
                type="button"
                onClick={() => setSpeaker(sp.name)}
                className={`${CHIP} ${speaker === sp.name ? CHIP_ON : CHIP_OFF}`}
              >
                <Trans>{sp.name} · {sp.lines} 条</Trans>
              </button>
            ))}
          </div>
        </Field>
      )}

      {materials.some((m) => m.kind === "chat") && speakers.length === 0 && (
        <p className="text-[11px] leading-relaxed text-slate-500"><Trans>没认出「谁在说话」，会把整段一起分析。</Trans></p>
      )}
    </div>
  );
}

// ── 第 3 步：问卷 ───────────────────────────────────────────────────────────
function StepQuiz() {
  const [q, setQ] = useWizardField("questionnaire");
  const [customAddress, setCustomAddress] = useState("");
  const [customTaboo, setCustomTaboo] = useState("");
  const touched = questionnaireTouched(q);
  const { t } = useLingui();

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-400">
        <Trans>12 道题都有默认值，一道不动也能直接生成 —— 想调哪一项就调哪一项。已调整 {touched} 项。</Trans>
      </p>

      {PERSONA_QUESTIONS.map((def) => {
        if (def.kind === "slider") {
          const v = typeof q[def.key] === "number" ? (q[def.key] as number) : def.fallback;
          return (
            <div key={def.key} className={CARD}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-300">{def.label}</span>
                <span className="text-[11px] text-slate-500">{v}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={v}
                onChange={(e) => setQ({ ...q, [def.key]: Number(e.target.value) })}
                className="w-full accent-brand"
                aria-label={def.label}
              />
              <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                <span>{def.low}</span>
                <span>{def.high}</span>
              </div>
            </div>
          );
        }
        if (def.kind === "choice") {
          const v = typeof q[def.key] === "string" ? (q[def.key] as string) : def.fallback;
          // ★ 屏幕上是中文、发出去可能是别的词（language / emoji 两项服务端认 zh|en|mixed、none|light|heavy）——
          //   取值一律经 `choiceValueAt`，别在这里手写 `def.values?.[i] ?? def.options[i]`（那是第二处实现）
          const known = def.options.some((_, i) => choiceValueAt(def, i) === v);
          // ★ `freeform` 只长在「怎么称呼你」那一项上，联合类型里其余分支根本没有这个属性 ——
          //   `in` 判存在，别给 PersonaQuestion 上补一个"人人都有但多数是 undefined"的字段
          const freeform = "freeform" in def && def.freeform === true;
          return (
            <div key={def.key} className={CARD}>
              <div className={CARD_LABEL}>{def.label}</div>
              <div className="flex flex-wrap gap-2">
                {def.options.map((o, i) => {
                  const val = choiceValueAt(def, i);
                  return (
                    <button key={o} type="button" onClick={() => setQ({ ...q, [def.key]: val })} className={`${CHIP} ${v === val ? CHIP_ON : CHIP_OFF}`}>
                      {o}
                    </button>
                  );
                })}
                {freeform && (
                  <button
                    type="button"
                    onClick={() => setQ({ ...q, [def.key]: customAddress || "" })}
                    className={`${CHIP} ${!known ? CHIP_ON : CHIP_OFF}`}
                  >
                    <Trans>自己写</Trans>
                  </button>
                )}
              </div>
              {freeform && !known && (
                <input
                  value={customAddress || v}
                  onChange={(e) => {
                    // 与 style.addressUser 同一个上限：这两处最后会被服务端拼进同一句人设
                    const next = e.target.value.slice(0, PERSONA_LIMITS.addressUser);
                    setCustomAddress(next);
                    setQ({ ...q, [def.key]: next });
                  }}
                  placeholder={t`写一个称呼`}
                  className={`mt-2 ${INPUT}`}
                />
              )}
            </div>
          );
        }
        if (def.kind === "text") {
          const v = typeof q[def.key] === "string" ? (q[def.key] as string) : def.fallback;
          return (
            <div key={def.key} className={CARD}>
              <div className={CARD_LABEL}>{def.label}</div>
              <input
                value={v}
                onChange={(e) => setQ({ ...q, [def.key]: e.target.value.slice(0, def.maxLen) })}
                placeholder={def.placeholder}
                className={INPUT}
              />
            </div>
          );
        }
        // tags：多选 + 自填
        const list = Array.isArray(q[def.key]) ? (q[def.key] as string[]) : [...def.fallback];
        const toggle = (o: string) => setQ({ ...q, [def.key]: list.includes(o) ? list.filter((x) => x !== o) : [...list, o] });
        return (
          <div key={def.key} className={CARD}>
            <div className={CARD_LABEL}>{def.label}</div>
            <div className="flex flex-wrap gap-2">
              {def.options.map((o) => (
                <button key={o} type="button" onClick={() => toggle(o)} className={`${CHIP} ${list.includes(o) ? CHIP_ON : CHIP_OFF}`}>
                  {o}
                </button>
              ))}
              {list
                .filter((o) => !(def.options as readonly string[]).includes(o))
                .map((o) => (
                  <button key={o} type="button" onClick={() => toggle(o)} className={`${CHIP} ${CHIP_ON}`}>
                    {o} ✕
                  </button>
                ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={customTaboo}
                onChange={(e) => setCustomTaboo(e.target.value.slice(0, 30))}
                placeholder={t`再加一条不聊的`}
                className={`flex-1 ${INPUT}`}
              />
              <button
                type="button"
                disabled={!customTaboo.trim() || list.includes(customTaboo.trim())}
                onClick={() => {
                  setQ({ ...q, [def.key]: [...list, customTaboo.trim()] });
                  setCustomTaboo("");
                }}
                className={`${SECONDARY} px-4`}
              >
                <Trans>加</Trans>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 第 4 步：AI 生成 ────────────────────────────────────────────────────────
function DraftRow({
  field,
  children,
  busyField,
}: {
  field: PersonaDraftField;
  children: ReactNode;
  busyField: PersonaDraftField | null;
}) {
  const { t } = useLingui();
  return (
    <div className="border-t border-slate-700/60 py-2.5 first:border-t-0 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-300">{t(DRAFT_FIELD_LABEL[field])}</span>
        <button
          type="button"
          disabled={busyField !== null}
          onClick={() => void runGeneratePersona({ only: [field] })}
          className={`${MINI} shrink-0`}
        >
          {busyField === field ? t`换着…` : t`只换这个`}
        </button>
      </div>
      <div className="text-sm leading-relaxed text-slate-100">{children}</div>
    </div>
  );
}

function StepGenerate() {
  const draft = usePersonaWizard((s) => s.draft);
  const genBusy = usePersonaWizard((s) => s.genBusy);
  const genOnly = usePersonaWizard((s) => s.genOnly);
  const genErr = usePersonaWizard((s) => s.genErr);
  // ★ 问的是"这一版**用上了**分析吗"，不是"分析过吗"：素材改过之后那一份就不作数了
  //   （见 personaWizardStore 的 `analyzedKey` ★★），照着 `analysis !== null` 说「读过你的素材」是假话
  const analysis = usePersonaWizard(analysisUsed);
  const blocked = usePersonaWizard(generateBlockedReason);
  const mats = usePersonaWizard((s) => s.materials.length);
  const { t } = useLingui();

  // ★ 整份生成时才铺满屏的载入态；「只换这个」只让那一行转圈，不该把已经读到一半的草稿抽走
  if (genBusy && !genOnly) {
    return <EmptyState loading text={genBusy} hint={t`可以退出这一页，跑完会有通知。`} />;
  }

  if (!draft) {
    return (
      <div className="space-y-3">
        <div className={CARD}>
          <div className={CARD_LABEL}><Trans>这一次会拿什么去写</Trans></div>
          <ul className="space-y-1 text-xs leading-relaxed text-slate-400">
            <li>{blocked ? t`· 基本设定：还没填` : t`· 基本设定：已填`}</li>
            <li>{mats > 0 ? t`· 素材：${mats} 条，${materialChars()} 字` : t`· 素材：没有（跳过了）`}</li>
            <li><Trans>· 问卷：12 项（没动过的用默认值）</Trans></li>
          </ul>
        </div>
        <ErrLine text={blocked || genErr} />
        <button type="button" disabled={!!blocked} onClick={() => void runGeneratePersona()} className={`flex w-full items-center justify-center gap-1.5 ${PRIMARY}`}>
          <Icon name="sparkle" size={16} />
          <Trans>让 AI 写一版</Trans>
        </button>
        <p className="text-[11px] leading-relaxed text-slate-500">
          <Trans>有素材的话会先分析一遍再写，慢一点；分析结果留着，后面重写不用再读一次素材。</Trans>
        </p>
      </div>
    );
  }

  const st = draft.style;
  return (
    <div className="space-y-3">
      <ErrLine text={genErr} />
      <section className={CARD}>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl leading-none">{draft.coverEmoji || "🎭"}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-slate-100">{draft.name || t`（还没有名字）`}</div>
            <div className="truncate text-[11px] text-slate-500">{analysis ? t`读过你的素材` : t`只按设定和问卷写的`}</div>
          </div>
        </div>
        <DraftRow field="name" busyField={genOnly}>
          {draft.name || "—"}
        </DraftRow>
        <DraftRow field="description" busyField={genOnly}>
          {draft.description || "—"}
        </DraftRow>
        <DraftRow field="tags" busyField={genOnly}>
          {draft.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {draft.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300">
                  #{tag}
                </span>
              ))}
            </div>
          ) : (
            "—"
          )}
        </DraftRow>
        <DraftRow field="summary" busyField={genOnly}>
          {st.summary || "—"}
        </DraftRow>
        <DraftRow field="catchphrases" busyField={genOnly}>
          {st.catchphrases.length > 0 ? st.catchphrases.join(" / ") : "—"}
        </DraftRow>
        <DraftRow field="tone" busyField={genOnly}>
          {st.tone || "—"}
        </DraftRow>
        <DraftRow field="addressUser" busyField={genOnly}>
          {st.addressUser || "—"}
        </DraftRow>
        <DraftRow field="greeting" busyField={genOnly}>
          {st.greeting || "—"}
        </DraftRow>
        <DraftRow field="examples" busyField={genOnly}>
          {st.examples && st.examples.length > 0 ? (
            <div className="space-y-1.5">
              {st.examples.map((ex, i) => (
                <div key={i} className="rounded-xl bg-slate-900 p-2">
                  <div className="text-[11px] text-slate-500"><Trans>你：{ex.user}</Trans></div>
                  <div className="mt-0.5 text-sm text-slate-200">{ex.reply}</div>
                </div>
              ))}
            </div>
          ) : (
            "—"
          )}
        </DraftRow>
        <DraftRow field="boundaries" busyField={genOnly}>
          {st.boundaries && st.boundaries.length > 0 ? st.boundaries.join(" / ") : "—"}
        </DraftRow>
      </section>

      <button type="button" disabled={genOnly !== null} onClick={() => void runGeneratePersona()} className={`w-full ${SECONDARY}`}>
        <Trans>整体再来一版</Trans>
      </button>
    </div>
  );
}

// ── 第 5 步：试聊 ───────────────────────────────────────────────────────────
function StepPreview({ onBackToGenerate }: { onBackToGenerate: () => void }) {
  const draft = usePersonaWizard((s) => s.draft);
  const chat = usePersonaWizard((s) => s.chat);
  const chatBusy = usePersonaWizard((s) => s.chatBusy);
  const chatErr = usePersonaWizard((s) => s.chatErr);
  const rounds = usePersonaWizard(previewRounds);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { t } = useLingui();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat]);

  const full = rounds >= PREVIEW_ROUNDS_MAX;
  const name = draft?.name || "TA";

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-400">
        <Trans>拿这份草稿聊几句看看像不像。聊 {PREVIEW_ROUNDS_MAX} 轮，已经聊了 {rounds} 轮。</Trans>
      </p>

      <div ref={listRef} className="max-h-[46vh] space-y-2 overflow-y-auto">
        {chat.length === 0 && <p className="py-6 text-center text-xs text-slate-500"><Trans>发一句试试，比如「你好呀」。</Trans></p>}
        {chat.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
                m.role === "user" ? "rounded-br-sm bg-brand text-ink" : "rounded-bl-sm bg-slate-800 text-slate-100"
              }`}
            >
              {m.role === "assistant" && <span className="mr-1.5 text-[11px] text-brand">{name}</span>}
              {m.text || (m.streaming ? "…" : "")}
              {/* 这一页没有 Live2D 舞台，演出标签不演、只作为"它确实带了情绪"的读数摆着 */}
              {m.role === "assistant" && !m.streaming && m.face && m.face !== "normal" && (
                <span className="ml-1.5 text-[11px] text-slate-400">［{m.face}］</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <ErrLine text={chatErr} />

      <div className="flex items-end gap-2">
        <textarea
          rows={1}
          value={text}
          // ★ 就地截到服务端那条硬限：超了整条请求 400（message 只有一句 "Invalid input"），
          //   而这是一个可以粘贴的框 —— 粘一篇文章进来是很自然的事
          onChange={(e) => setText(e.target.value.slice(0, PERSONA_LIMITS.chatMessage))}
          disabled={full || !draft}
          placeholder={full ? t`已经聊满 ${PREVIEW_ROUNDS_MAX} 轮了` : t`说点什么`}
          className={`flex-1 ${TEXTAREA} disabled:opacity-40`}
        />
        {/* ★ 在途时这颗键换成「停下」（调已经写好、此前全仓没人调过的 abortPreview）：SSE 那条现在虽然
            带了看门狗，等满 90 秒也是 90 秒 —— 用户得有一颗现在就能按的键 */}
        {chatBusy ? (
          <button
            type="button"
            onClick={() => abortPreview()}
            className="flex items-center gap-1.5 rounded-full border border-slate-600 px-4 py-2.5 text-xs font-bold text-slate-300"
          >
            <Spinner size="xs" />
            <Trans>停下</Trans>
          </button>
        ) : (
          <button
            type="button"
            disabled={!text.trim() || full || !draft}
            onClick={() => {
              void sendPreviewMessage(text);
              setText("");
            }}
            className={`flex items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-xs font-bold text-ink disabled:opacity-40`}
          >
            <Icon name="send" size={14} />
            <Trans>发</Trans>
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {/* ★ 聊满 5 轮之后此前没有任何出路：输入框永久禁用，而「回去重生成」不清 chat（重生成整份草稿
            现在会顺手清掉，但用户也该能就地重来一次） */}
        <button type="button" disabled={chat.length === 0} onClick={() => clearPreview()} className={`flex-1 ${SECONDARY} disabled:opacity-40`}>
          <Trans>清空重聊</Trans>
        </button>
        <button type="button" onClick={onBackToGenerate} className={`flex-1 ${SECONDARY}`}>
          <Trans>不太像，回去重生成</Trans>
        </button>
      </div>
    </div>
  );
}

// ── 第 6 步：微调 ───────────────────────────────────────────────────────────
/** 可增删的字符串列表（口头禅 / 边界）：一处实现，两个字段共用 */
function StringList({
  items,
  max,
  maxLen,
  placeholder,
  onChange,
}: {
  items: string[];
  max: number;
  maxLen: number;
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const { t } = useLingui();
  const full = items.length >= max;
  return (
    <div>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={v}
              onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
              className={`flex-1 ${INPUT}`}
            />
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className={MINI}>
              <Trans>删</Trans>
            </button>
          </div>
        ))}
      </div>
      {items.some((v) => v.length > maxLen) && <ErrLine text={t`有一条超过 ${maxLen} 字了，发布会被服务端拒掉。`} />}
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={full}
          placeholder={full ? t`最多 ${max} 条，已经满了` : placeholder}
          className={`flex-1 ${INPUT} disabled:opacity-40`}
        />
        <button
          type="button"
          disabled={full || !draft.trim()}
          onClick={() => {
            onChange([...items, draft.trim()]);
            setDraft("");
          }}
          className={`${SECONDARY} px-4`}
        >
          <Trans>加</Trans>
        </button>
      </div>
    </div>
  );
}

function StepTune() {
  const draft = usePersonaWizard((s) => s.draft);
  const [coverEmoji, setCoverEmoji] = useWizardField("coverEmoji");
  const { t } = useLingui();
  if (!draft) return <EmptyState emoji="🎭" text={t`还没有草稿。`} hint={t`回到「生成」那一步先让 AI 写一版。`} />;
  const st = draft.style;

  return (
    <div className="space-y-4">
      <Field label={t(DRAFT_FIELD_LABEL.name)}>
        <LimitedInput value={draft.name} onChange={(v) => patchDraft({ name: v })} max={PERSONA_LIMITS.name} />
      </Field>

      <Field label={t`封面 emoji`}>
        <div className="flex flex-wrap items-center gap-2">
          {PERSONA_COVER_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setCoverEmoji(e);
                patchDraft({ coverEmoji: e });
              }}
              className={`h-10 w-10 rounded-xl text-xl ${(draft.coverEmoji || coverEmoji) === e ? "bg-brand/15 ring-1 ring-brand" : "bg-panel"}`}
            >
              {e}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.description)}>
        <LimitedInput value={draft.description} onChange={(v) => patchDraft({ description: v })} max={PERSONA_LIMITS.description} rows={2} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.tags)} hint={t`让别人在人格市场里搜得到。`}>
        <TagInput
          tags={draft.tags}
          onChange={(next) => patchDraft({ tags: next })}
          max={PERSONA_TAG_MAX}
          maxLen={PERSONA_TAG_LEN}
          split={parseTags}
        />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.summary)}>
        <LimitedInput value={st.summary} onChange={(v) => patchStyle({ summary: v })} max={PERSONA_LIMITS.summary} rows={4} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.catchphrases)} hint={t`每条 ${PERSONA_LIMITS.catchphrase} 字以内，最多 ${PERSONA_LIMITS.catchphrases} 条。`}>
        <StringList
          items={st.catchphrases}
          max={PERSONA_LIMITS.catchphrases}
          maxLen={PERSONA_LIMITS.catchphrase}
          placeholder={t`再加一句口头禅`}
          onChange={(next) => patchStyle({ catchphrases: next })}
        />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.tone)}>
        <LimitedInput value={st.tone ?? ""} onChange={(v) => patchStyle({ tone: v })} max={PERSONA_LIMITS.tone} rows={2} placeholder={t`慢热、爱用省略号、生气也不飙脏话`} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.addressUser)}>
        <LimitedInput value={st.addressUser ?? ""} onChange={(v) => patchStyle({ addressUser: v })} max={PERSONA_LIMITS.addressUser} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.greeting)}>
        <LimitedInput value={st.greeting ?? ""} onChange={(v) => patchStyle({ greeting: v })} max={PERSONA_LIMITS.greeting} rows={2} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.stanceHint)}>
        {/* ★ stanceHint 的服务端上限是 500，不是 summary 那个 2000（见 PERSONA_LIMITS.stanceHint 的 ★） */}
        <LimitedInput value={st.stanceHint} onChange={(v) => patchStyle({ stanceHint: v })} max={PERSONA_LIMITS.stanceHint} rows={2} />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.examples)} hint={t`一组一问一答，最多 ${PERSONA_LIMITS.examples} 组、每句 ${PERSONA_LIMITS.example} 字以内。`}>
        <ExampleList
          items={st.examples ?? []}
          onChange={(next) => patchStyle({ examples: next })}
        />
      </Field>

      <Field label={t(DRAFT_FIELD_LABEL.boundaries)} hint={t`TA 自己不聊的东西。平台的安全底线是另外固定注入的，不用写在这里。`}>
        <StringList
          items={st.boundaries ?? []}
          max={PERSONA_LIMITS.boundaries}
          maxLen={PERSONA_LIMITS.boundary}
          placeholder={t`比如「不聊前任」`}
          onChange={(next) => patchStyle({ boundaries: next })}
        />
      </Field>
    </div>
  );
}

/** 示例对话（user + reply 一组）可增删 */
function ExampleList({
  items,
  onChange,
}: {
  items: Array<{ user: string; reply: string }>;
  onChange: (next: Array<{ user: string; reply: string }>) => void;
}) {
  const full = items.length >= PERSONA_LIMITS.examples;
  const { t } = useLingui();
  const over = items.some((e) => e.user.length > PERSONA_LIMITS.example || e.reply.length > PERSONA_LIMITS.example);
  // ★ 只判"太长"不判"没填完"是不够的：服务端 exampleSchema 对 user / reply 都是 min(1)。
  //   送出去那一拍由 `draftForServer` 统一滤掉，这里只把"你有一组没填完"说出来 ——
  //   否则用户会看着自己加的那一行悄无声息地消失。判据共用 `exampleFilled`（一处实现）。
  const blanks = items.map((e, i) => (exampleFilled(e) ? 0 : i + 1)).filter(Boolean);
  return (
    <div className="space-y-2">
      {items.map((ex, i) => (
        <div key={i} className={CARD}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              {exampleFilled(ex) ? <Trans>第 {i + 1} 组</Trans> : <Trans>第 {i + 1} 组 · 还没填完</Trans>}
            </span>
            <button type="button" onClick={() => onChange(items.filter((_, k) => k !== i))} className={MINI}>
              <Trans>删</Trans>
            </button>
          </div>
          <input
            value={ex.user}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, user: e.target.value } : x)))}
            placeholder={t`用户说`}
            className={`${INPUT} mb-2`}
          />
          <textarea
            rows={2}
            value={ex.reply}
            onChange={(e) => onChange(items.map((x, k) => (k === i ? { ...x, reply: e.target.value } : x)))}
            placeholder={t`TA 回`}
            className={TEXTAREA}
          />
        </div>
      ))}
      {over && <ErrLine text={t`有一句超过 ${PERSONA_LIMITS.example} 字了，发布会被服务端拒掉。`} />}
      {blanks.length > 0 && (
        <p className="text-xs leading-relaxed text-amber-300">
          <Trans>第 {blanks.join(" / ")} 组还没填完 —— 试聊和发布时这几组会被丢掉（一问一答缺一边的示例喂不了模型）。</Trans>
        </p>
      )}
      <button
        type="button"
        disabled={full}
        onClick={() => onChange([...items, { user: "", reply: "" }])}
        className={`w-full ${SECONDARY}`}
      >
        {full ? t`最多 ${PERSONA_LIMITS.examples} 组，已经满了` : t`加一组`}
      </button>
    </div>
  );
}

// ── 第 7 步：发布 ───────────────────────────────────────────────────────────
function StepPublish() {
  const navigate = useNavigate();
  const draft = usePersonaWizard((s) => s.draft);
  const published = usePersonaWizard((s) => s.published);
  const [shared, setShared] = useWizardField("shared");
  const [priceText, setPriceText] = useWizardField("priceText");
  const [agreed, setAgreed] = useWizardField("agreed");
  const pubBusy = usePersonaWizard((s) => s.pubBusy);
  const pubErr = usePersonaWizard((s) => s.pubErr);
  // ★ 装备的在途 / 回执活在 store 里（见 personaWizardStore 的 `equipBusy` ★）：点完就退出去也不会静默丢掉
  const equipBusy = usePersonaWizard((s) => s.equipBusy);
  const equipMsg = usePersonaWizard((s) => s.equipMsg);
  const { t } = useLingui();

  if (published) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs leading-relaxed text-emerald-200">
          {shared ? (
            <Trans>「{published.name}」做好了。已经公开到人格市场。</Trans>
          ) : (
            <Trans>「{published.name}」做好了。只有你自己能看到（没公开）。</Trans>
          )}
        </div>
        {equipMsg && <div className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${BANNER_CLS[equipMsg.kind]}`}>{equipMsg.text}</div>}
        <button
          type="button"
          disabled={equipBusy}
          onClick={() => void equipPublishedPersona()}
          className={`w-full ${PRIMARY}`}
        >
          {equipBusy ? t`装上中…` : t`装备为当前人格`}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              resetPersonaWizard();
            }}
            className={`flex-1 ${SECONDARY}`}
          >
            <Trans>再做一个</Trans>
          </button>
          <button type="button" onClick={() => navigate("/support/personas", { replace: true })} className={`flex-1 ${SECONDARY}`}>
            <Trans>去人格市场</Trans>
          </button>
        </div>
      </div>
    );
  }

  if (!draft) return <EmptyState emoji="🎭" text={t`还没有草稿。`} hint={t`回到「生成」那一步先让 AI 写一版。`} />;

  const price = Math.min(PERSONA_LIMITS.price, Math.max(0, Math.round(Number(priceText) || 0)));
  const priceBad = priceText.trim() !== "" && !Number.isFinite(Number(priceText));

  return (
    <div className="space-y-4">
      <Field label={t`谁能看到`}>
        <div className="flex rounded-xl bg-panel p-1">
          <button
            type="button"
            onClick={() => setShared(false)}
            className={`flex-1 rounded-lg py-2 text-sm ${!shared ? "bg-brand font-semibold text-ink" : "text-slate-300"}`}
          >
            <Trans>只有我</Trans>
          </button>
          <button
            type="button"
            onClick={() => setShared(true)}
            className={`flex-1 rounded-lg py-2 text-sm ${shared ? "bg-brand font-semibold text-ink" : "text-slate-300"}`}
          >
            <Trans>公开到市场</Trans>
          </button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          {shared ? t`别人能在人格市场里搜到、装上用；署你的名。` : t`只有你自己能装上用，市场里搜不到。`}
        </p>
      </Field>

      <Field label={t`标价`} hint={t`0 = 免费。App 里没有支付，付费人格的购买目前只在官网。`}>
        <input
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          inputMode="numeric"
          placeholder="0"
          className={INPUT}
        />
        {priceBad ? (
          <ErrLine text={t`这里只能填数字。`} />
        ) : (
          <p className="mt-1 text-[11px] text-slate-500"><Trans>会按 {price} 积分发布（0~{PERSONA_LIMITS.price} 的整数）。</Trans></p>
        )}
      </Field>

      <label className={`flex items-start gap-2.5 ${CARD}`}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 accent-brand" />
        <span className="text-xs leading-relaxed text-slate-300">
          <Trans>我确认：<br />· 这份人格的内容是我自己写的，或者我已经获得授权；<br />· 不冒充真实存在的人（公众人物、认识的人都算）；<br />· 没有把别人的隐私（聊天记录里的手机号、住址、病情之类）放进去。<br /><span className="text-slate-500">违规的内容会被下架，情节严重的可能封号。</span></Trans>
        </span>
      </label>

      <ErrLine text={pubErr} />

      <button
        type="button"
        disabled={pubBusy || !agreed || priceBad}
        onClick={() => void publishPersona()}
        className={`w-full ${PRIMARY}`}
      >
        {pubBusy ? t`发布中…` : shared ? t`发布到市场` : t`保存为我的人格`}
      </button>
      {!agreed && <p className="text-[11px] leading-relaxed text-slate-500"><Trans>先勾上上面那三条才能发布。</Trans></p>}
    </div>
  );
}

// ── 页壳：步条 + 内容 + 上下步 ──────────────────────────────────────────────
export default function SupportPersonaNewPage() {
  const back = useBackOr("/support/create");
  const [step, setStep] = useWizardField("step");
  const banner = usePersonaWizard((s) => s.banner);
  const hasDraft = usePersonaWizard((s) => s.draft !== null);
  const dirty = usePersonaWizard(wizardDirty);
  const busy = usePersonaWizard(wizardBusy);
  const published = usePersonaWizard((s) => s.published);
  const [askReset, setAskReset] = useState(false);
  const { t } = useLingui();

  // ★ 结局分叉靠它：页在 → 就地画；页不在 → data/jobs 的胶囊通知（store 文件头 ★★）
  useEffect(() => {
    usePersonaWizard.setState({ mounted: true });
    return () => {
      usePersonaWizard.setState({ mounted: false });
    };
  }, []);

  const idx = useMemo(() => PERSONA_STEPS.findIndex((s) => s.key === step), [step]);

  /** 走得到吗：后三步都要先有草稿 —— 摆一个点不动的步骤不如说清为什么（ui-copy-grammar 第 4 条） */
  function reachable(key: PersonaStep): boolean {
    if (key === "preview" || key === "tune" || key === "publish") return hasDraft;
    return true;
  }
  function go(key: PersonaStep): void {
    if (!reachable(key)) return;
    setStep(key);
    window.scrollTo({ top: 0 });
  }

  const prev = idx > 0 ? PERSONA_STEPS[idx - 1].key : null;
  const next = idx < PERSONA_STEPS.length - 1 ? PERSONA_STEPS[idx + 1].key : null;

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader
        sticky
        inset
        onBack={back}
        title={t`制作人格`}
        subtitle={t`第 ${idx + 1} / ${PERSONA_STEPS.length} 步 · ${PERSONA_STEPS[idx].label}`}
        right={
          dirty && !published ? (
            <button type="button" disabled={busy} onClick={() => setAskReset(true)} className={`${MINI} shrink-0`}>
              <Trans>重新开始</Trans>
            </button>
          ) : undefined
        }
      />

      {/* 步条：横向滚动一律 no-scrollbar（安卓 WebView 上不加会闪一条滚动条） */}
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {PERSONA_STEPS.map((s, i) => {
          const on = s.key === step;
          const ok = reachable(s.key);
          return (
            <button
              key={s.key}
              type="button"
              disabled={!ok}
              onClick={() => go(s.key)}
              className={`${CHIP} shrink-0 disabled:opacity-40 ${on ? CHIP_ON : CHIP_OFF}`}
            >
              {i + 1}. {s.label}
            </button>
          );
        })}
      </div>
      {!hasDraft && (step === "basics" || step === "materials" || step === "quiz") && (
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500"><Trans>试聊、微调、发布三步要先生成出草稿才能进。</Trans></p>
      )}

      <Banner banner={banner} />

      {step === "basics" && <StepBasics />}
      {step === "materials" && <StepMaterials />}
      {step === "quiz" && <StepQuiz />}
      {step === "generate" && <StepGenerate />}
      {step === "preview" && <StepPreview onBackToGenerate={() => go("generate")} />}
      {step === "tune" && <StepTune />}
      {step === "publish" && <StepPublish />}

      {!published && (
        <div className="mt-6 flex gap-2">
          {prev && (
            <button type="button" onClick={() => go(prev)} className={`flex-1 ${SECONDARY}`}>
              <Trans>上一步</Trans>
            </button>
          )}
          {next && (
            <button type="button" disabled={!reachable(next)} onClick={() => go(next)} className={`flex-1 ${PRIMARY}`}>
              {step === "materials" ? t`跳过 / 下一步` : t`下一步`}
            </button>
          )}
        </div>
      )}

      {askReset && (
        <ConfirmDialog
          title={t`重新开始？`}
          confirmLabel={t`清空`}
          danger
          onClose={() => setAskReset(false)}
          onConfirm={() => {
            resetPersonaWizard();
            setAskReset(false);
          }}
        >
          <Trans>填过的设定、导入的素材、生成出来的草稿和试聊记录都会清掉，回到第一步。已经发布出去的人格不受影响。</Trans>
        </ConfirmDialog>
      )}
    </div>
  );
}
