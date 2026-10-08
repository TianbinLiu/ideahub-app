// 「按模型适配」—— 卡片详情页上这一格（2026-09-30 主人点名：按模型存专用内容）。
//
// ★★ 为什么需要它：不是每个出片模型都收得到卡片的形象图 ——
//   · 标准 / 极速（Seedance 1.0）协议上**没有参考图**：卡片形象只能经由设定帧间接起作用，
//     而一段里只有第一张人物卡画得进帧（Seedream 一张图里画两个角色会被整条拒），总共 3 张图；
//   · 真人档（海螺 2.3-Fast）**只认一张起拍画面**：一段里只有当起拍画面的那张卡用得上形象，
//     而卡上的白底立绘当第一帧，开场就是一片白底。
//   于是每张卡可以为它们各存一份专用内容，就像真人卡的「火山引擎适用」：
//   · 「标准/极速适用」= 文字版形象描述（Card.textDesc）：收不到这张卡的图时替代图片；
//   · 「真人档适用」  = 起拍画面（Card.startFrames，竖 / 横各一张）：真人档以它起拍。
//   出片时用不用、用哪一份，只在 studio/segmentGen 一处判（materialText / 真人档起拍那一支）。
// ★ 勾上 = 有内容，取消 = 删掉内容（同「火山引擎适用」：勾着本身就是状态）。
// ★ 只对自己的卡出现（别人的卡改不了）；背景卡在所有档位本来就只以文字参与，不摆这一格。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { AI_REAL, briefArkReason, chargeNote, chargeOnFail, describeCardForText, drawStartFrames } from "../ai";
import { uploadImage } from "../api/uploads";
import { cardFitOf } from "../data/cardFit";
import { canAfford, frozenNote, isRemoteMode, spendTokens, updateCardMeta } from "../data/account";
import { CHAT_TURN_TOKENS, ONE_IMAGE, fmtTokens, refImgTierList } from "../data/economy";
import { TEXT_DESC_MAX, startFramesAllowed, type Card, type VideoAspect } from "../types";

const ASPECTS: VideoAspect[] = ["portrait", "landscape"];

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
  /** 这张卡在三类出片模型上的状态（判据只在 data/cardFit 一处，卡组页的适配摘要读的是同一份） */
  const fit = cardFitOf(card);
  if (!fit) return null; // 只有背景卡会走到这里，上面已经早退；这一行让类型闭合

  const textOn = !!card.textDesc?.trim();
  const framesOn = !!(card.startFrames?.portrait || card.startFrames?.landscape);
  /** 起拍画面只给画得出开场镜头、又不是真人照片的卡（判据 types.startFramesAllowed 一处；真人卡在真人档本来就以照片起拍） */
  const framesAllowed = startFramesAllowed(card);
  const real = card.type === "character" && card.realPerson === true;
  const textPrice = fmtTokens(CHAT_TURN_TOKENS);
  const framesPrice = fmtTokens(ONE_IMAGE * ASPECTS.length);

  // ── 各档位能用到这张卡的哪些部分（与出片管线同一套事实，见文件头；状态由 cardFitOf 给，这里只负责说成整句） ──
  const line2x =
    fit.ref === "asset"
      ? t`以火山引擎认证素材进模型（只在简约模式不带首帧时）`
      : fit.ref === "needAsset"
        ? t`要先勾「火山引擎适用」`
        : t`形象图直接进模型`;
  const line10 =
    fit.frames === "noRealFace"
      ? t`不收真人照片`
      : fit.frames === "text"
        ? t`收不到图时用文字版形象描述`
        : t`形象图只经由设定帧起作用，收不到图时只剩出片句`;
  const lineReal =
    fit.start === "photo"
      ? t`以卡上的真人照片起拍`
      : fit.start === "startFrames"
        ? t`用专门画好的起拍画面起拍`
        : fit.start === "ownImage"
          ? t`用卡上的图起拍（白底立绘开场就是白底）`
          : fit.start === "onlyAsStart"
            ? t`只有它当起拍画面时才用得上形象图`
            : t`只用文字`;

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
      <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>🎛 按模型适配</Trans></div>
      <ul className="mb-2 space-y-0.5 text-[10px] leading-relaxed text-slate-400">
        {/* 行首按能力现算（economy.refImgTierList）：2026-10-07 加了「草稿」，写死「高清 / 电影级」就少说一档 */}
        <li><Trans>{refImgTierList()}：{line2x}</Trans></li>
        <li><Trans>标准 / 极速：{line10}</Trans></li>
        <li><Trans>真人档：{lineReal}</Trans></li>
      </ul>

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
            <Trans>标准/极速适用</Trans>
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

      {framesAllowed && (
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
            <Trans>真人档适用</Trans>
            {!framesOn && AI_REAL && <span className="text-[10px] text-slate-500"><Trans>AI 画竖横两张约 {framesPrice} token</Trans></span>}
          </label>
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

      {msg && <p className="mt-1.5 text-[10px] leading-relaxed text-rose-300">{msg}</p>}
    </div>
  );
}
