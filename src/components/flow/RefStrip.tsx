// 参考清单 —— 「这一段出片时，视频模型会收到哪些图、各是第几张」（N1，2026-10-03 对标 LibTV 节点检视器里那排编号缩略图）。
//
// ★ 只收 props、不认识任何 store（与 CustomFrameSlots / AnnStrip / PlanBoard 同一条约束）：
//   · 排队编号由宿主给（flowStore.nodeRefPlan → segmentGen.refPlanOf，与出片读同一批判定），这里一张都不自己数；
//   · 临时参考图的增 / 改 / 删由宿主接 flowStore 的三个 action（名字查重、上限、顺手收拾句子里的 @名字 都在那边）；
//   · 点名的认法只有 data/refMentions 一处（这里拿它标「已点名」与「没对上」，出片时编译的是同一套）。
// ★ 点一张图 = 把 `@名字` 写进句子（宿主给了 onMention 才有这个动作；自选卡片车道那一栏写的是推演要求，不插）。
//   文字是唯一真身：亮不亮全靠「句子里有没有这个点名」反推，不另存状态（与运镜 chips 同一个做法）。
// ★ 上传走 utils/image.fileToRefImage（卡片形象图同一条路：长边压到 1024、比例越界居中裁并说出来）——
//   这些图要当参考图发给视频 / 出图模型，越界的图会把整发请求 400 掉。
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import InfoTip from "../InfoTip";
import Spinner from "../Spinner";
import { showToast } from "../../data/toast";
import { tierNamesFor } from "../../data/account";
import { useLang } from "../../i18n/useLang";
import { VIDEO_REF_WINDOW, fileToRefImage } from "../../utils/image";
import type { RefPlan, RefPlanItem } from "../../studio/segmentGen";
import {
  EXTRA_REF_MAX,
  EXTRA_REF_NAME_MAX,
  EXTRA_REF_ROLES,
  FRAME_ALIASES,
  compileMentions,
  mentionTargets,
  type ExtraRef,
  type ExtraRefRole,
} from "../../data/refMentions";

/** 用途的短名。带同一句 msgctxt：「场景」「道具」这种词在别处另有条目（卡种名），不该共用一个译法 */
const ROLE_LABELS: Record<ExtraRefRole, MessageDescriptor> = {
  layout: msg({ message: "站位构图", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
  scene: msg({ message: "场景", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
  prop: msg({ message: "道具", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
  outfit: msg({ message: "服装", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
  style: msg({ message: "画风", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
  free: msg({ message: "其它", context: "临时参考图的用途：没在句子里点名时，系统按它替这张图说一句" }),
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

export default function RefStrip({
  plan,
  extras,
  cards,
  tierLabel,
  text,
  onMention,
  pendingFromDerive,
  canEdit,
  onAdd,
  onUpdate,
  onRemove,
  onError,
}: {
  /** 排队编号（flowStore.nodeRefPlan）。null = 这一段不在了 */
  plan: RefPlan | null;
  /** 这一段挂的临时参考图（已过 usableExtraRefs） */
  extras: ExtraRef[];
  /** 这一段挂的卡（点名能认到的名字；没分到图的卡也能被点名） */
  cards: { id: string; name: string }[];
  /** 当前档位的名字（「这一档不收参考图」那句话里用） */
  tierLabel: string;
  /** 会随出片发出去的那句话（标「已点名 / 没对上」用）。不给 = 不标 */
  text?: string;
  /** 把 `@名字` 写进句子（宿主决定插到哪一栏、守不守字数上限）。不给 = 这一栏不支持点名 */
  onMention?: (name: string) => void;
  /** 「帧还没有」那一格怎么说：真 = 推演方案时画（自选卡片、还没推演），否则 = 出片前现画 */
  pendingFromDerive?: boolean;
  canEdit: boolean;
  /** 加一张（已压好的 dataURL）。回新图的 id；被拒回 null（原因宿主自己显示） */
  onAdd: (dataUrl: string) => string | null;
  onUpdate: (id: string, patch: { name?: string; role?: ExtraRefRole }) => boolean;
  onRemove: (id: string) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useLingui();
  const { active: lang } = useLang();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  /** 正在编辑哪一张临时参考图（存 id：删掉 / 换段后自然对不上，面板就收起） */
  const [sel, setSel] = useState<string | null>(null);
  /** 名字输入框的草稿（失焦 / 回车才提交：边打边查重会把半截名字判成重名） */
  const [nameDraft, setNameDraft] = useState("");
  const selected = extras.find((x) => x.id === sel) ?? null;
  // 选中哪张 / 它被改了名（宿主那边提交成功）→ 输入框跟上。★ hook 排在早退之前（check-hook-order）
  const selName = selected?.name;
  useEffect(() => {
    if (selName !== undefined) setNameDraft(selName);
  }, [sel, selName]);
  if (!plan) return null;
  // 「换哪一档就有」按能力现算、按这个人用不用得了分两种说法（account.tierNamesFor；2026-10-07 起原来写死的「高清」「电影级」对免费用户是死路）
  const vidNames = tierNamesFor((x) => x.refVid);
  const imgNames = tierNamesFor((x) => x.refImg);
  const audioNames = tierNamesFor((x) => x.audio && x.refImg);
  const vidUsable = vidNames.usable;
  const vidMember = vidNames.member;
  const imgUsable = imgNames.usable;
  const imgMember = imgNames.member;
  const audioUsable = audioNames.usable;
  const audioMember = audioNames.member;
  const items = plan.items;
  const numOf = (id: string) => items.find((it) => it.kind === "extra" && it.extra?.id === id)?.n ?? null;
  const firstN = items.find((it) => it.kind === "first")?.n;
  const lastN = items.find((it) => it.kind === "last")?.n;
  // 点名目标：与出片编译同一套拼法。帧两格恒在（没当参考图发的档上它们退成「首帧画面」，同样算认得）
  const compiled =
    text !== undefined
      ? compileMentions(
          text,
          mentionTargets({
            cards,
            extras: extras.map((x) => ({ id: x.id, name: x.name, n: numOf(x.id) })),
            frames: { first: firstN ?? null, last: lastN ?? null },
          }),
        )
      : null;
  const used = compiled?.used ?? new Set<string>();
  const loose = compiled ? [...new Set(compiled.loose)] : [];
  const keyOf = (it: RefPlanItem) =>
    it.kind === "extra" ? `extra:${it.extra?.id}` : it.kind === "card" ? `card:${it.card?.id}` : it.kind === "mid" ? "" : `frame:${it.kind}`;
  /** 这一格在句子里叫什么（中间帧不能点名：时序点名句已经逐张说过它） */
  const nameOf = (it: RefPlanItem): string | null => {
    if (it.kind === "extra") return it.extra?.name ?? null;
    if (it.kind === "card") return it.card?.name ?? null;
    if (it.kind === "mid") return null;
    const list = FRAME_ALIASES[it.kind];
    return lang === "zh" ? list[0] : list[list.length - 1];
  };
  const labelOf = (it: RefPlanItem): string =>
    it.kind === "first" ? (it.carried ? t`首帧·承接` : t`首帧`) : it.kind === "last" ? t`尾帧` : it.kind === "mid" ? t`中间帧` : (nameOf(it) ?? "");
  const openEditor = (x: ExtraRef) => setSel(x.id);
  const tap = (it: RefPlanItem) => {
    if (it.kind === "extra" && it.extra) {
      // 临时参考图：点开编辑条（改名 / 用途 / 删除 / 写进句子都在那儿）
      if (sel === it.extra.id) setSel(null);
      else openEditor(it.extra);
      return;
    }
    const name = nameOf(it);
    if (name && onMention && canEdit) onMention(name);
  };
  const commitName = () => {
    if (!selected) return;
    if (nameDraft === selected.name) return;
    if (!onUpdate(selected.id, { name: nameDraft })) setNameDraft(selected.name);
  };
  const full = extras.length >= EXTRA_REF_MAX;
  /** 没发出去的临时参考图（这一档不收 / 模板段）也要摆出来：人得找得到它、删得掉它 */
  const orphanExtras = extras.filter((x) => numOf(x.id) === null);
  const textOnlyNames = plan.textOnly.map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const voiceNames = plan.voices.map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const idleNames = (plan.voiceIdle?.cards ?? []).map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const overNames = (plan.voiceOver?.cards ?? []).map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const overCap = plan.voiceOver?.capSec ?? 0;
  const quietNames = (plan.voiceQuiet ?? []).map((c) => c.name).join(t({ message: "、", comment: "列举几个名字时的分隔符" }));
  const looseNames = loose.map((x) => `@${x}`).join(" ");
  const chip = (it: RefPlanItem) => {
    const k = keyOf(it);
    const on = !!k && used.has(k);
    const isSel = it.kind === "extra" && it.extra?.id === sel;
    const tappable = it.kind === "extra" ? canEdit : !!onMention && canEdit && it.kind !== "mid";
    const body = (
      <>
        <span
          className={`relative block h-14 w-11 overflow-hidden rounded-md border bg-ink/60 ${
            isSel ? "border-brand" : on ? "border-brand/70" : it.src ? "border-slate-600" : "border-dashed border-slate-600"
          }`}
        >
          {it.src ? (
            <img src={it.src} alt="" className="h-full w-full object-cover" draggable={false} />
          ) : (
            <span className="flex h-full w-full items-center justify-center px-0.5 text-center text-[9px] leading-tight text-slate-500">
              {pendingFromDerive ? <Trans>推演时画</Trans> : <Trans>出片前 AI 画</Trans>}
            </span>
          )}
          <span className="absolute left-0 top-0 rounded-br-md bg-black/75 px-1 text-[9px] font-bold leading-4 text-slate-100">{it.n}</span>
          {on && <span className="absolute bottom-0 right-0 rounded-tl-md bg-brand px-1 text-[9px] font-bold leading-4 text-ink">@</span>}
        </span>
        <span className={`w-11 truncate text-center text-[9px] ${it.kind === "extra" ? "text-sky-200" : "text-slate-400"}`}>{labelOf(it)}</span>
      </>
    );
    // 点不动的那几格（这一栏不支持点名 / 中间帧 / 生成中）只是陈列：画成普通块，不画成一颗灰掉的按钮
    return tappable ? (
      <button key={`${it.kind}-${it.n}`} type="button" onClick={() => tap(it)} title={labelOf(it)} className="flex w-11 flex-none flex-col items-center gap-0.5">
        {body}
      </button>
    ) : (
      <div key={`${it.kind}-${it.n}`} title={labelOf(it)} className="flex w-11 flex-none flex-col items-center gap-0.5">
        {body}
      </div>
    );
  };
  return (
    <div data-guide="ref-strip" className="rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-100">
          <Trans>参考清单</Trans>
        </span>
        <InfoTip title={t`参考清单`}>
          <Trans>这一排就是出片时视频模型会收到的图，按发送顺序编号。素材卡是谁、哪几张图是他，由系统自动写进提示词；你另加的参考图没在句子里点名时，系统按「用途」替它说一句。想自己说清楚某张图管什么，就在句子里写 @名字（或点这一排上的图）——出片时会在名字后面接上模型认的编号「图片N」。</Trans>
        </InfoTip>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!canEdit || reading || full}
          title={full ? t`一段最多 ${EXTRA_REF_MAX} 张临时参考图` : undefined}
          className="flex-none rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
        >
          {reading ? <Spinner size="xs" /> : <Trans>＋ 参考图</Trans>}
        </button>
      </div>

      {plan.sends ? (
        items.length > 0 ? (
          <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">{items.map(chip)}</div>
        ) : (
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            <Trans>这一段还没有任何参考图：挂素材卡、给首尾帧，或点「＋ 参考图」加一张站位草图 / 道具照片。</Trans>
          </p>
        )
      ) : (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          {plan.why === "real" ? (
            <Trans>真人档只认一张起拍画面，不收参考图：卡片与临时参考图只按文字参与。</Trans>
          ) : plan.why === "refvid" ? (
            vidUsable ? (
              <Trans>「{tierLabel}」档带不了示例视频——换成「{vidUsable}」之后这里才排得出清单。</Trans>
            ) : (
              <Trans>「{tierLabel}」档带不了示例视频；带得了的「{vidMember}」是会员档（开通会员套餐或充值过任意一笔后可用）。</Trans>
            )
          ) : imgUsable ? (
            <Trans>「{tierLabel}」档协议上不收参考图：卡片形象只用来画首尾帧，出片时模型看到的只有首尾帧。想让模型直接看到卡片形象与临时参考图，换「{imgUsable}」。</Trans>
          ) : (
            <Trans>「{tierLabel}」档协议上不收参考图：卡片形象只用来画首尾帧，出片时模型看到的只有首尾帧。让模型直接看到卡片形象与临时参考图要「{imgMember}」（会员档）。</Trans>
          )}
        </p>
      )}

      {/* 没发出去的临时参考图也摆出来（找得到、删得掉） */}
      {orphanExtras.length > 0 && (
        <div className="no-scrollbar mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {orphanExtras.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => (sel === x.id ? setSel(null) : openEditor(x))}
              disabled={!canEdit}
              className="flex w-11 flex-none flex-col items-center gap-0.5 opacity-60"
            >
              <span className={`block h-14 w-11 overflow-hidden rounded-md border ${sel === x.id ? "border-brand" : "border-slate-600"}`}>
                <img src={x.url} alt="" className="h-full w-full object-cover" draggable={false} />
              </span>
              <span className="w-11 truncate text-center text-[9px] text-slate-400">{x.name}</span>
            </button>
          ))}
        </div>
      )}
      {plan.extrasDropped && (
        <p className="mt-1 text-[10px] leading-relaxed text-amber-300/90">
          <Trans>临时参考图在这一档发不出去（上面那几张变淡的）。</Trans>
        </p>
      )}

      {/* 编辑条：改名 / 用途 / 写进句子 / 删除 */}
      {selected && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-black/30 p-2">
          <div className="flex items-center gap-1.5">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              maxLength={EXTRA_REF_NAME_MAX}
              disabled={!canEdit}
              placeholder={t`名字`}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand disabled:opacity-40"
            />
            {onMention && (
              <button
                type="button"
                onClick={() => onMention(selected.name)}
                disabled={!canEdit}
                className="flex-none rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-ink disabled:opacity-40"
              >
                <Trans>@ 写进句子</Trans>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onRemove(selected.id);
                setSel(null);
              }}
              disabled={!canEdit}
              className="flex-none rounded-full border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-40"
            >
              <Trans>删除</Trans>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-[10px] text-slate-500">
              <Trans>用途</Trans>
            </span>
            {EXTRA_REF_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onUpdate(selected.id, { role: r })}
                disabled={!canEdit}
                className={`rounded-full px-2 py-0.5 text-[10px] disabled:opacity-40 ${
                  selected.role === r ? "bg-brand font-semibold text-ink" : "bg-slate-700/60 text-slate-300"
                }`}
              >
                {t(ROLE_LABELS[r])}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            {used.has(`extra:${selected.id}`) ? (
              <Trans>句子里已经点到它了：这张图管什么，以你写的那半句为准。</Trans>
            ) : selected.role === "free" ? (
              <Trans>没在句子里点名时，系统只会说它是一张补充参考——最好选一个用途，或者在句子里用 @{selected.name} 说清楚。</Trans>
            ) : (
              <Trans>没在句子里点名时，系统按这个用途替它说一句。</Trans>
            )}
          </p>
        </div>
      )}

      {(plan.refVideo || voiceNames || textOnlyNames) && plan.sends && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          {plan.refVideo && <Trans>🎬 另带示例视频（不占图片编号）。</Trans>}
          {voiceNames && <Trans>🔊 台词带声音样本：{voiceNames}。</Trans>}
          {textOnlyNames && <Trans>没带图、只按文字参与：{textOnlyNames}。</Trans>}
        </p>
      )}
      {/* 卡带着声音样本、这一发却带不上：出片之前就说为什么（此前只在出片那一行进度里说，或者根本不说） */}
      {plan.voiceIdle && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {plan.voiceIdle.why === "quote" ? (
            <Trans>🔇 {idleNames} 带着声音样本，但句子里没有台词——把台词写进引号（「」或 “”）里，才会按这张卡的声音配音。</Trans>
          ) : plan.voiceIdle.why === "tier" ? (
            audioUsable ? (
              <Trans>🔇 {idleNames} 带着声音样本，但「{tierLabel}」档出片无声——要配音换「{audioUsable}」。</Trans>
            ) : (
              <Trans>🔇 {idleNames} 带着声音样本，但「{tierLabel}」档出片无声——配音要「{audioMember}」（会员档）。</Trans>
            )
          ) : (
            <Trans>🔇 {idleNames} 带着声音样本，但这一段的出片方式带不了参考音频（台词仍会配音，音色由模型定）。</Trans>
          )}
        </p>
      )}
      {/* 带着声音样本、这一段却没有他的台词：这次不带（谁说的由 data/shotScript.lineSpeakers 认，认不准时一张都不筛，这一行也就不出现） */}
      {plan.voiceQuiet && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          <Trans>🔇 {quietNames} 在这一段没有台词，这次不带声音样本。</Trans>
        </p>
      )}
      {/* 声音样本合计太长、这几位没带上（N2）：出片之前就说，别等出片那一行进度 */}
      {plan.voiceOver && (
        <p className="mt-1 text-[10px] leading-relaxed text-amber-300/90">
          <Trans>🔇 {overNames} 的声音样本这次带不上：这一档的参考音频合计最长 {overCap} 秒。把样本剪短些，或少挂一张带声音的卡。</Trans>
        </p>
      )}
      {loose.length > 0 && (
        <p className="mt-1 text-[10px] leading-relaxed text-amber-300/90">
          <Trans>{looseNames} 没对上这一段的任何参考——检查名字，或点上面的图重新写进句子（发出去时它只是普通文字）。</Trans>
        </p>
      )}
      {onMention && plan.sends && items.length > 0 && canEdit && (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          <Trans>点一张图，把它写进句子（@名字）。</Trans>
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 同一张图连选两次也要能触发
          if (!f) return;
          setReading(true);
          // 这些图直接发给视频模型：按它的窗口裁 / 放大（比卡片图那一套更窄，见 VIDEO_REF_WINDOW）
          void fileToRefImage(f, 1024, 0.85, VIDEO_REF_WINDOW)
            .then(async (img) => {
              const id = onAdd(await blobToDataUrl(img.blob));
              if (!id) return;
              // 比例越界被裁过要说出来（不能默默改人家的图）
              if (img.cropped) showToast(t`这张图太长 / 太宽，已居中裁过`, 2600);
              setSel(id);
            })
            .catch((err) => onError(err instanceof Error ? err.message : String(err)))
            .finally(() => setReading(false));
        }}
      />
    </div>
  );
}
