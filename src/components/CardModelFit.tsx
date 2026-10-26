// 「按模型适配」—— 卡片详情页上这一格（2026-09-30 主人点名：按模型存专用内容）。
//
// ★★ 为什么需要它：不是每个出片模型都收得到卡片的形象图 ——
//   · 收不到参考图的模型（今天是 Seedance 1.0 的「标准 / 极速」）：卡片形象只能经由设定帧间接起作用，
//     而一段里只有第一张人物卡画得进帧（画帧只带第一个人物的图，见 segmentGen 的 drawRefs；「多角色同框被整条拒」那条老约束
//     2026-10-03 查清是精灵图的事，不是场景里的两个人），总共 3 张图；
//   · 只认一张起拍画面的模型（今天是真人档 MiniMax Hailuo 2.3 Fast）：一段里只有当起拍画面的那张卡用得上形象，
//     而卡上的白底立绘当第一帧，开场就是一片白底。
//   于是每张卡可以为它们各存一份专用内容，就像真人卡的「火山引擎适用」：
//   · 「文字版形象描述（… 用）」= Card.textDesc：收不到这张卡的图时替代图片（2026-10-10 之前叫「标准/极速适用」）；
//   · 「起拍画面（… 用）」= Card.startFrames（竖 / 横各一张）：只认起拍画面的模型以它起拍（2026-10-26 之前叫「真人档适用」）。
//   括号里写哪几个模型（或哪几档）随这个人此刻摆得出来的模型变（account.videoModelsNames）。
//   出片时用不用、用哪一份，只在 studio/segmentGen 一处判（materialText / 真人档起拍那一支）。
// ★★ 2026-10-26（出片地区 · 主人第 2 件）：每行开头写**具体模型名**、按家分组（Seedance / MiniMax），只列这个人此刻摆得出来的模型；
//   地区还不知道时只写档位名、不写供应商与模型名（account.offeredVideoModels 的 ★★）。卡在每个模型上的状态只出自 data/cardFit
//   （按能力位：收参考图 / 只经由帧 / 只认起拍画面），这里只负责说成整句。
// ★ 勾上 = 有内容，取消 = 删掉内容（同「火山引擎适用」：勾着本身就是状态）。
// ★ 只对自己的卡出现（别人的卡改不了）；背景卡在所有模型上本来就只以文字参与，不摆这一格。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AI_REAL, briefArkReason, chargeNote, chargeOnFail, describeCardForText, drawStartFrames } from "../ai";
import { uploadImage } from "../api/uploads";
import { assetOf } from "../data/cardAsset";
import { cardInputOf, fitLevelOf, fitRowsForCard, type FitLevel, type FitState } from "../data/cardFit";
import {
  canAfford,
  frozenNote,
  isRemoteMode,
  offeredVideoModels,
  providerGroupName,
  regionTiersLine,
  spendTokens,
  tierBlockReason,
  updateCardMeta,
  videoModelsLead,
  videoModelsNames,
} from "../data/account";
import { CHAT_TURN_TOKENS, ONE_IMAGE, fmtTokens } from "../data/economy";
import { TEXT_DESC_MAX, startFramesAllowed, type Card, type VideoAspect } from "../types";
import Icon, { type IconName } from "./Icon";
import Warn from "./Warn";

const ASPECTS: VideoAspect[] = ["portrait", "landscape"];

/** 行首那枚图标（形状先于颜色：色弱的人也分得出三种） */
const LEVEL_ICON: Record<FitLevel, { icon: IconName; cls: string }> = {
  ok: { icon: "check", cls: "text-ok-300" },
  partial: { icon: "alert", cls: "text-warn-300" },
  no: { icon: "ban", cls: "text-danger-300" },
  textOnly: { icon: "info", cls: "text-slate-400" },
};

/**
 * 行首图标 + 给读屏的那个词（Icon 自己是 aria-hidden：只画一枚图标，读屏就只读到后面那句原因，「用得上」与「用不上」听不出区别）。
 * 只有卡片页画它：卡组页一行里是好几种状态的张数，没有单一结论。
 */
function FitLevelIcon({ level }: { level: FitLevel }) {
  const { t } = useLingui();
  const it = LEVEL_ICON[level];
  const word = level === "ok" ? t`用得上` : level === "partial" ? t`部分用得上` : level === "no" ? t`用不上` : t`只用文字`;
  return (
    <span className={`mt-0.5 flex-none ${it.cls}`}>
      <Icon name={it.icon} size={11} strokeWidth={2} />
      <span className="sr-only">{word}</span>
    </span>
  );
}

/** 「按模型适配」这一格的标题（卡片页与卡组页同一个） */
export function ModelFitTitle() {
  return (
    <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-300">
      <Icon name="gauge" size={13} />
      <Trans>按模型适配</Trans>
    </div>
  );
}

export default function CardModelFit({ card, owned }: { card: Card; owned: boolean }) {
  const { t } = useLingui();
  const [busy, setBusy] = useState<"" | "text" | "frames">("");
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState("");
  /** 文字版形象描述的编辑稿（勾上之后可以改了再存） */
  const [draft, setDraft] = useState(card.textDesc ?? "");
  /** 演示构建 / 用户想自己写：不调 AI，直接摆输入框 */
  const [manual, setManual] = useState(false);
  useEffect(() => {
    setDraft(card.textDesc ?? "");
  }, [card.id, card.textDesc]);
  if (!owned || card.type === "background") return null;

  /** 此刻摆给这个人的出片模型（地区问到了才写名字，见 account.offeredVideoModels） */
  const { named, models } = offeredVideoModels();
  /** 这张卡在每个模型上的状态，按家分组、结论相同的并成一行（判据只在 data/cardFit 一处，卡组页读的是同一份） */
  const groups = fitRowsForCard(card, models, { hasAsset: !!assetOf(card.id), startOk: startFramesAllowed(card) }, named);
  /** 地区那一句（这里只给哪几家 / 一家都没有）：地区不知道、没有哪一档被拦时为 null（与档位那一排同一句） */
  const regionLine = regionTiersLine();

  const textOn = !!card.textDesc?.trim();
  const framesOn = !!(card.startFrames?.portrait || card.startFrames?.landscape);
  /** 起拍画面只给画得出开场镜头、又不是真人照片的卡（判据 types.startFramesAllowed 一处；真人卡在只认起拍画面的模型上本来就以照片起拍） */
  const framesAllowed = startFramesAllowed(card);
  const real = card.type === "character" && card.realPerson === true;
  const textPrice = fmtTokens(CHAT_TURN_TOKENS);
  const framesPrice = fmtTokens(ONE_IMAGE * ASPECTS.length);
  /** 读文字版形象描述的模型：收不到形象图的（只经由帧、只认起拍画面 —— 起拍画面那一类里不当起拍画面的卡也读它，segmentGen.materialText） */
  const textNames = videoModelsNames(models.filter((m) => cardInputOf(m.tiers[0]) !== "refs"), named);
  /** 读起拍画面的模型（只认一张起拍画面的那一类） */
  const startModels = models.filter((m) => cardInputOf(m.tiers[0]) === "start");
  const startNames = videoModelsNames(startModels, named);
  /**
   * 读起拍画面的那几档这个人**都**用不了（今天：「真人」是会员档，免费用户）—— AI 画起拍画面要先花两张图的钱，
   * 而眼下哪一档都用不上它：在价签旁边把那句会员档说出来（2026-10-26 设计审核：原来照样标价、可以点）。
   */
  const startTiers = startModels.flatMap((m) => m.tiers);
  const startBlocked = startTiers.length > 0 && startTiers.every((x) => !!tierBlockReason(x)) ? tierBlockReason(startTiers[0]) : null;

  // ── 一种状态说成哪句话（与出片管线同一套事实，见文件头；状态由 data/cardFit 给） ──
  const reasonOf = (s: FitState): string => {
    switch (s) {
      case "image":
        return t`形象图直接进模型`;
      case "asset":
        return t`以火山引擎认证素材进模型（只在简约模式不带首帧时）`;
      case "needAsset":
        return t`要先勾「火山引擎适用」`;
      case "realPhoto":
        return t`真人照片直接进模型`;
      case "noRealFace":
        return t`不收真人照片`;
      case "text":
        return t`收不到图时用文字版形象描述`;
      case "frameOnly":
        return t`形象图只经由设定帧起作用，收不到图时只剩出片句`;
      case "photo":
        return t`以卡上的真人照片起拍`;
      case "startFrames":
        return t`用专门画好的起拍画面起拍`;
      case "ownImage":
        return t`用卡上的图起拍（白底立绘开场就是白底）`;
      case "onlyAsStart":
        return t`只有它当起拍画面时才用得上形象图`;
      case "textOnly":
        return t`只用文字`;
    }
  };

  async function save(patch: Parameters<typeof updateCardMeta>[1]): Promise<boolean> {
    const err = await updateCardMeta(card.id, patch);
    if (err) setMsg(err);
    return !err;
  }

  async function enableText() {
    setMsg("");
    if (!AI_REAL) {
      // 演示构建没有看图模型：直接自己写
      setManual(true);
      return;
    }
    if (!canAfford(CHAT_TURN_TOKENS)) {
      setMsg(frozenNote() ?? t`生成一段约 ${textPrice} token，余额不够——去「我的」页充值`);
      return;
    }
    setBusy("text");
    try {
      const desc = await describeCardForText(card);
      spendTokens(CHAT_TURN_TOKENS); // 离线账本；远端模式是空操作（服务端按调用结算）
      if (await save({ textDesc: desc })) setDraft(desc);
    } catch (e) {
      const why = briefArkReason(e, 60);
      const money = chargeNote(chargeOnFail(e), CHAT_TURN_TOKENS);
      setMsg(money ? t`没写成（${why}）。${money.line}` : t`没写成（${why}），没有扣钱。`);
    } finally {
      setBusy("");
    }
  }

  async function enableFrames() {
    setMsg("");
    const price = ONE_IMAGE * ASPECTS.length;
    if (AI_REAL && !canAfford(price)) {
      setMsg(frozenNote() ?? t`画两张约 ${framesPrice} token，余额不够——去「我的」页充值`);
      return;
    }
    setBusy("frames");
    let drawn: Record<VideoAspect, string> | null = null;
    try {
      drawn = await drawStartFrames(card, (done, total) => setProgress(t`画起拍画面 ${done + 1}/${total}…`));
      if (AI_REAL) spendTokens(price);
    } catch (e) {
      const why = briefArkReason(e, 60);
      const money = chargeNote(chargeOnFail(e), ONE_IMAGE);
      setMsg(money ? t`没画成（${why}）。${money.line}` : t`没画成（${why}），没有扣钱。`);
      setBusy("");
      setProgress("");
      return;
    }
    try {
      // ★ 远端模式要永久地址：dataURL 发上去服务端整发 400（与 views 同一条规则）；离线模式就存本机
      const out: Partial<Record<VideoAspect, string>> = {};
      for (const a of ASPECTS) {
        out[a] = isRemoteMode() ? await uploadImage(await (await fetch(drawn[a])).blob(), `start-${a}.jpg`) : drawn[a];
      }
      await save({ startFrames: out });
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 60) : String(e);
      setMsg(t`起拍画面画好了，但没能存上（${why}）——这两张已计费，再勾一次会重新画、再花一次钱。`);
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <ModelFitTitle />
      {/* 行首按此刻摆得出来的模型现算（account.offeredVideoModels）：停用的、这个地区给不出的、这台服务端不支持的都不列 ——
          原来写死「高清 / 电影级」「标准 / 极速」「真人档」三行，停用之后还在说一整行（2026-10-10 文案复核抓到） */}
      {groups.length === 0 ? (
        <p className="mb-2 text-[10px] leading-relaxed text-slate-400">{regionLine ?? t`现在没有摆得出来的出片模型。`}</p>
      ) : (
        <div className="mb-2 space-y-1">
          {groups.map((g) => (
            <div key={g.provider ?? "all"}>
              {g.provider && <div className="text-[11px] font-semibold text-slate-300">{providerGroupName(g.provider)}</div>}
              <ul className="space-y-0.5 text-[10px] leading-relaxed text-slate-400">
                {g.rows.map((r) => {
                  const lead = videoModelsLead(r.models, named);
                  const reason = reasonOf(r.state);
                  return (
                    <li key={r.state} className="flex gap-1.5">
                      <FitLevelIcon level={fitLevelOf(r.state)} />
                      <span className="min-w-0 flex-1">{t`${lead}：${reason}`}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {/* 地区挡掉了某一家时说一句（只写给得出的那几家）；地区不知道时为 null */}
          {named && regionLine && <p className="text-[10px] leading-relaxed text-slate-400">{regionLine}</p>}
        </div>
      )}

      {!real && (
        <div className="mb-2">
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={textOn || manual}
              disabled={!!busy}
              onChange={() => {
                if (textOn) {
                  setManual(false);
                  void save({ textDesc: "" });
                  return;
                }
                if (manual) {
                  setManual(false);
                  return;
                }
                void enableText();
              }}
              className="h-3.5 w-3.5 flex-none accent-brand"
            />
            {/* 括号里写读它的那几个模型（地区不知道时写档名）：1.0 两档停用后不再点它们的名；一个都不剩时换一句不点名的 */}
            {textNames ? <Trans>文字版形象描述（{textNames}用）</Trans> : <Trans>文字版形象描述（收不到形象图时用）</Trans>}
            {!textOn && AI_REAL && <span className="text-[10px] text-slate-500"><Trans>AI 写一段约 {textPrice} token</Trans></span>}
          </label>
          {busy === "text" && <p className="mt-1 pl-5 text-[10px] text-slate-400"><Trans>正在看图写文字版形象描述…</Trans></p>}
          {(textOn || manual) && (
            <div className="mt-1.5 pl-5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, TEXT_DESC_MAX))}
                rows={3}
                maxLength={TEXT_DESC_MAX}
                placeholder={t`不看图也能画出同一个样子的外形描述`}
                className="w-full resize-none rounded-lg border border-slate-700 bg-ink/60 px-2 py-1.5 text-[11px] leading-relaxed text-slate-100 placeholder:text-slate-500"
              />
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[9px] text-slate-500">{draft.length}/{TEXT_DESC_MAX}</span>
                {draft.trim() !== (card.textDesc ?? "").trim() && (
                  <button
                    onClick={() => {
                      void save({ textDesc: draft.trim() }).then((ok) => ok && setManual(false));
                    }}
                    disabled={!draft.trim()}
                    className="rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold text-ink disabled:opacity-40"
                  >
                    <Trans>保存</Trans>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 起拍画面：只认起拍画面的模型一个都摆不出来时（停用 / 这个地区给不出）不引人去画；已经画了的照样摆着，好取消 */}
      {framesAllowed && (startNames || framesOn) && (
        <div>
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={framesOn}
              disabled={!!busy}
              onChange={() => {
                if (framesOn) void save({ startFrames: null });
                else void enableFrames();
              }}
              className="h-3.5 w-3.5 flex-none accent-brand"
            />
            {startNames ? <Trans>起拍画面（{startNames}用）</Trans> : <Trans>起拍画面</Trans>}
            {!framesOn && AI_REAL && <span className="text-[10px] text-slate-500"><Trans>AI 画竖横两张约 {framesPrice} token</Trans></span>}
          </label>
          {!startNames && framesOn && (
            <Warn compact className="mt-1 pl-5">
              <Trans>你现在能用的出片模型都用不上它（起拍画面先留着，可以随时取消）</Trans>
            </Warn>
          )}
          {startNames && !framesOn && startBlocked && (
            <Warn compact className="mt-1">
              {startBlocked}
            </Warn>
          )}
          {busy === "frames" && <p className="mt-1 pl-5 text-[10px] text-slate-400">{progress || t`准备中…`}</p>}
          {framesOn && (
            <div className="mt-1.5 flex items-start gap-2 pl-5">
              {ASPECTS.map((a) =>
                card.startFrames?.[a] ? (
                  <img
                    key={a}
                    src={card.startFrames[a]}
                    alt=""
                    className={`rounded-md border border-slate-700 object-cover ${a === "portrait" ? "h-24 w-[54px]" : "h-[54px] w-24"}`}
                  />
                ) : null,
              )}
            </div>
          )}
        </div>
      )}

      {msg && <p className="mt-1.5 text-[10px] leading-relaxed text-danger-300">{msg}</p>}
    </div>
  );
}
