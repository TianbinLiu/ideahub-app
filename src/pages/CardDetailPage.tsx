// 卡片详情页：大卡面 + 类型/标签 + 简介 + 形象参考图（多图）+「<类型>信息」
// （铸卡时的完整提示词，具体到可复刻卡面）+ 3D 建模全息预览（有 modelUrl 的角色卡）。
// 创意工坊/我的/卡组详情点卡进来。
import { useRef, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router";
// ★ 出片管线的规则一律**从管线本身取**，这一页不再抄一份（铁律六）。
//   抄的那份漏过规则一（只有第一张人物卡进参考图），于是「出片用」这个标签会对着
//   一张从来不进模型的图亮起来 —— 用户为它多付了钱，界面还告诉他钱花在了出片上。
import { MAX_CHAR_REFS, MAX_REF_IMAGES, TYPE_LABEL, cardStyleSuffix, refUsedFlags } from "../ai/real";
import Icon from "../components/Icon";
import InfoDialog from "../components/InfoDialog";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import CardHologram, { CARD_MODELS, useHologramModel } from "../studio/ui/CardHologram";
import { isRemoteMode, myCards, myDecks, shareCard } from "../data/account";
import { addCardView, removeCardView } from "../data/cardViews";
import { removeVoice, subscribeVoices, voiceOf, voicesVersion } from "../data/cardVoice";
import { assetOf, assetsVersion, saveAsset, subscribeAssets } from "../data/cardAsset";
import PortraitAuthPanel from "../components/PortraitAuthPanel";
import { formatHeat, heatOf } from "../data/social";
import {
  CARD_INFO_LABELS,
  CARD_SLOTS,
  CARD_TYPE_COLORS,
  CARD_TYPE_LABELS,
  Card,
  CardType,
  CardView,
  MAX_CARD_VIEWS,
  publishableModelUrl,
  slotLabel,
  viewTag,
  viewsOf,
} from "../types";
import { useAccountVersion } from "../hooks/useAccount";

/**
 * 老卡/素材卡没存这段信息时（字段仍叫 genPrompt，跨仓字段不改名），
 * 按派生管线同款格式现场拼一份——照着它就能复刻同风格卡面。
 *
 * ★★ 类型名与画风尾巴**必须**从 ai/real.ts 取（TYPE_LABEL / cardStyleSuffix），
 *   这里一个字都不许自己写。手抄的那份已经分叉过一次，而且分叉得毫无声响：
 *   real.ts 改成「画风卡一个画风词都不拼」之后，这里还在给没有 genPrompt 的画风卡
 *   （mock 市场种子里的「水墨留白」「胶片颗粒」「像素梦境」全都没有）拼上
 *   "二次元厚涂插画风"，而下面那行文案写着"把它交给 AI 即可生成与卡面一致的画面"
 *   并配了复制按钮 —— 用户照做拿回来的是厚涂而不是水墨，全程零报错（铁律六）。
 * ★ frameWord 传 "卡面"：这段文字复刻的是**卡面**那一张，与 real.forgePrimary 同参。
 */
function cardInfoOf(card: Card): string {
  if (card.genPrompt) return card.genPrompt;
  const tags = card.tags?.length ? `关键词：${card.tags.join("、")}。` : "";
  return `${TYPE_LABEL[card.type]}：${card.name}。${card.summary}${tags}${cardStyleSuffix(card.type, "卡面")}`;
}

/**
 * 分享前必须先说清楚的那句话：这张卡的 3D 建模能不能跟着走。
 *
 * ★ 不说的话就是骗人：卡片详情页把「全息实体 3D 建模」当卖点画在最上面，
 *   而工坊里现炼的建模是 `idb:model3d:*`——**这台设备**的 IndexedDB 指针，
 *   别人拿到就是个死链。判据收在 types.ts 的 publishableModelUrl 一处
 *   （服务端还有一份权威的同规则，见那边的注释）。
 * ★ 这里只剩"能分享，但建模带不走"这一档**提醒**。「第三方版权模型」那一档是
 *   **拦截**，归 shareBlockReason 管（写在这儿的话按钮还是亮的，按下去必然 400）。
 */
function shareModelNote(card: Card): string | null {
  const raw = card.modelUrl;
  if (!raw) return null;
  if (publishableModelUrl(raw)) return null;
  return "注意：这张卡的 3D 建模只存在这台设备上，分享出去的那份不会带建模。";
}

// ── 形象参考图（多图参考）─────────────────────────────────────────
//
// 这几张图是**喂给 AI 的**，不是相册：推演三套方案时它们被当作 Seedream 的参考图，
// 人物形象因此被烤进首尾帧，出片再按首尾帧拍（见 ai/real.prepareMaterialRefs）。
// 所以这一块的文案要说"AI 会怎么用"，不能只当图库摆着。

// ★ 图位（哪种卡有哪几张图、每张叫什么、锁住什么）**只有 types.CARD_SLOTS 一处**
//   （铁律六）。这一页原来另有一份一维的 KIND_LABEL + kindsFor：于是一把剑的主视图
//   被叫成"全身"、一张场景卡还能加"面部特写"。两份都删了，名字一律 slotLabel(type, kind)。

/**
 * 每个图位锁住什么。★ 按 CARD_SLOTS 拼，不再手写两句话去盖五种卡。
 * ★ 开头那句原来是"AI 画这一段的首尾帧时会照着这些图"——它把**所有**图位都说成会进
 *   模型，而下面 pipelineNoteFor 紧接着说的是"只取前几张"，两句话摆在一起自相矛盾，
 *   且矛盾的那半句正是花了钱的那半句。这句只交代"每格是干什么用的"，
 *   "哪几格真被喂进去"一律归 pipelineNoteFor 说（铁律六：一条规则只有一处口径）。
 */
function hintFor(type: CardType): string {
  const parts = CARD_SLOTS[type].map((s) => `${s.label}锁${s.locks}`).join("；");
  return `每个图位各锁住一件事：${parts}。`;
}

// ── 哪几张真会进出片管线 ────────────────────────────────────────
//
// ★★ 必须如实标出来（铁律八）。出片管线**不是每张都用**：
//   不标的话，用户为一张"画面一个像素都不会变"的图付了钱还以为有用 —— 顶档铸卡
//   给人物卡出的最后一张就是这个处境（data/economy.slotsFor 的注释是同一件事）。
//
// ★★ 判"哪几张真进模型"的**唯一实现**是 ai/real.refUsedFlags（与真正喂图的
//   prepareMaterialRefs 同源同模块）。这一页原来照抄了一份 MAX_CHAR_REFS +
//   REF_KIND_ORDER + refUsedFlags，而且抄漏了规则一 —— 卡组里第二张人物卡点进详情，
//   前两张图上明晃晃贴着「出片用」，它在管线里却连一张都收不到。三份拷贝已删。
//
// ⚠ 详情页只有**单卡视角**（不知道这张卡将来会和谁挂在同一段里），所以调
//   refUsedFlags(card) 不传 ctx —— 得到的是"它是这一段唯一那张卡"时的乐观结果。
//   两处会让这个乐观结果落空：① 它不是这一段的第一张人物卡（规则一）；
//   ② 一段最多带 MAX_REF_IMAGES 张，排在后面的整张卡都带不上（规则二）。
//   这两件事不能只靠生成日志事后补票：乐观口径那半句**常驻**在图库下那一行与放大层里，
//   完整规则仍由 pipelineNoteFor 一处拼出、在「取舍规则」小窗里展开（2026-08-28 收纳）。

/**
 * 图位旁边那句实情。只说"取几张、取哪几张、什么情况下一张都不取"。
 * ★ 非人物卡那句里的图位名按**这张卡真正的第 1 张**报，不按图位表的 [0] 报：
 *   管线取的是 viewsOf()[0]（存储顺序），老卡里排头的未必就是主视图 ——
 *   照表念一遍在那种卡上就是指着 A 说 B。
 * ★★ 人物卡那句里"只有第一张人物卡"是**必须写出来的那半句**（这里原来写的是
 *   "每张人物卡最多取 2 张"，那是规则一的第二个、错的版本）：用户挂了两张人物卡、
 *   发现配角不像，读到旧那句会判断参考图已经生效、问题出在提示词，于是反复重炼、
 *   加图、换更贵的档位 —— 每一轮都真扣钱，而配角的参考图从头到尾一张都没进过模型。
 */
function pipelineNoteFor(type: CardType, views: CardView[]): string {
  if (type !== "character") {
    const first = views[0] ? viewTag(type, views[0]) : CARD_SLOTS[type][0].label;
    return (
      `出片时这类卡先保证第 1 张（${first}）喂给 AI；同一段里参考图总共最多 ${MAX_REF_IMAGES} 张，` +
      `预算还有余才轮得到第 2 张 —— 也就是同段挂的卡越少，它越可能真的进模型。` +
      `预算不够时「先被丢的就是各卡的第 2 张」，卡再多下去整张卡都会带不上（两种情况生成步骤里都会逐张点名）。`
    );
  }
  return (
    `出片时一段里只有「第一张人物卡」能带形象参考图：它最多取 ${MAX_CHAR_REFS} 张（优先${slotLabel(
      "character",
      "face",
    )} + ${slotLabel("character", "body")}）；同一段里的其余人物卡一张都不带，只按文字设定参与` +
    `——一张图里画多个角色会被方舟整条拒掉。所以上面的「出片用」是按"这张卡就是那第一张人物卡"标的：` +
    `它排在别的人物卡后面时，标着出片用的那几张同样进不了模型（生成步骤里会点名说明）。` +
    // ★ 白模模板那条路是**例外**，必须说：那条路一张设定帧都不画（参考图直接进 r2v），
    //   "一张图里画多个角色被拒"根本不适用，所以每个角色位挂的卡各带各的形象图。
    //   不说这一句，用挂卡出片的用户会照上面那半句自我设限：以为挂第 2 张人物卡没用。
    `（白模模板挂卡那条路是例外：它不画设定帧，每个角色位挂的人物卡都各带自己的形象图。）` +
    `${slotLabel("character", "detail")}这一格铸卡不会自动出图（只能自己传），三张挂满时它也排在最后，出片轮不到它。`
  );
}

/**
 * 「方舟可信素材」窄条 —— 只在**坏了**的时候出现：真人卡 + 还没绑上素材。
 *
 * ★★ 2026-08-28 仓库主人拍板：授权的主路挪进**造卡流程**（自己传图 / 从视频提取里
 *   勾「真人」当场做，共用 components/PortraitAuthPanel 一份实现），详情页不再常驻
 *   整块授权区 —— 绑上素材后这里**整块消失**。
 *   这条窄条存在的唯一理由是授权**异步**：本人可能隔天才扫码，照片还可能被内容审核
 *   拒掉（2026-08-28 第一发实测就被拒：InputImageSensitiveContentDetected）——
 *   造卡时没接上的真人卡总得有个就地修复的地方，不能逼人删卡重来。
 * ★ 只对自己的卡出现（别人的卡看不到本机侧库）。
 * ★ 绑定后**没有解绑入口**是有意的（同一次拍板「绑上即消失」）：绑错只剩"手填填错"
 *   一种来路，而手填两处都过 normalizeAssetId。真要换绑，等出现真实需求再开口子，
 *   别为想象中的操作摆按钮。
 */
function CardAssetSection({ card, owned }: { card: Card; owned: boolean }) {
  useSyncExternalStore(subscribeAssets, assetsVersion, () => 0);
  const [saveErr, setSaveErr] = useState("");
  if (card.type !== "character" || card.realPerson !== true || !owned) return null;
  if (assetOf(card.id)) return null; // 绑上即消失（见顶注）
  return (
    <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3">
      <p className="mb-1.5 text-[11px] leading-relaxed text-amber-200/90">
        🪪 这张真人卡还<b className="text-amber-100">没接上已授权的肖像素材</b>——
        「高清」「电影级」档不收直接上传的真人照片，接上之前用它出片会被拒。
      </p>
      <PortraitAuthPanel
        onBound={(assetId, note) => {
          // 窄条是"卡已存在"的场景，当场落库。写失败要出声（铁律八）：
          // 静默失败的话用户以为绑好了，出片那一刻才发现还是拒
          saveAsset(card.id, { assetId, scope: "private", note }).catch(() =>
            setSaveErr("绑定没存住（本机存储写入失败）——再点一次；一直不行就重启 App 再试。"),
          );
        }}
      />
      {saveErr && <p className="mt-1.5 text-[10px] leading-relaxed text-rose-400">{saveErr}</p>}
    </div>
  );
}

/**
 * 人物声音区：🔊 标识 + 试听 + 移除。数据在本机侧库（data/cardVoice——样本不进 Card、
 * 不随分享，理由见那边顶注），所以**别人的卡**这里永远是空的，整块不渲染而不是摆一句
 * "他没有声音"（我们根本不知道他那台设备上有没有）。
 */
function CardVoiceSection({ card, owned }: { card: Card; owned: boolean }) {
  useSyncExternalStore(subscribeVoices, voicesVersion, () => 0);
  const [confirmRm, setConfirmRm] = useState(false);
  const v = voiceOf(card.id);
  if (card.type !== "character") return null;
  if (!v) {
    // 只对自己的卡提示"怎么补"：别人的卡看不到侧库，说什么都是猜
    if (!owned) return null;
    return (
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <span className="text-xs font-semibold text-slate-300">🔊 人物声音</span>
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          这张卡还没有声音样本。在工坊「从视频提取」圈选人物时可以顺手取一段（2~15 秒）——
          出片走「高清/电影级」档且台词写在引号里时，AI 会参考这段声音的音色。
        </p>
      </div>
    );
  }
  return (
    <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-300">🔊 人物声音 · {v.durationSec}s</span>
        {owned &&
          (confirmRm ? (
            <span className="flex items-center gap-2">
              <button
                onClick={() => {
                  removeVoice(card.id);
                  setConfirmRm(false);
                }}
                className="rounded-full bg-rose-500/90 px-2.5 py-1 text-[11px] font-bold text-white"
              >
                确认移除
              </button>
              <button onClick={() => setConfirmRm(false)} className="text-[11px] text-slate-400">
                不了
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmRm(true)} className="text-[11px] text-slate-500">
              移除
            </button>
          ))}
      </div>
      {/* 试听就是这一块存在的意义：样本干不干净只有耳朵能判 */}
      <audio controls src={v.dataUrl} className="h-9 w-full" />
      <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        {v.note ? `${v.note} · ` : ""}出片走「高清/电影级」档、台词写在引号里时，AI 会参考这段声音的音色
        （尽力而为，不是复刻）。样本只存在这台设备上，分享卡片不带它。
      </p>
    </div>
  );
}

function CardViewsSection({ card, owned }: { card: Card; owned: boolean }) {
  const views = viewsOf(card);
  // ★ 不传 ctx = 单卡视角（详情页不知道它将来和谁挂同一段）。乐观结果落空的两种情况
  //   由 pipelineNoteFor 明说，见本节顶部那段 ⚠
  const used = refUsedFlags(card);
  const fileRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<CardView["kind"]>("body");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [zoom, setZoom] = useState<number | null>(null);
  /** 「取舍规则」小窗（hintFor + pipelineNoteFor 的全文搬进去了，见下面那段 ★） */
  const [rulesOpen, setRulesOpen] = useState(false);

  // ★★ "要不要画成图库"的判据是**卡上有没有真的挂图**（`card.views` 非空），
  //   不是 viewsOf() 的长度。两者只在一种情况下不同，而那种情况恰好会丢东西：
  //   用户挂了 3 张、删到只剩 1 张自己传的照片时 viewsOf() 长度也是 1 ——
  //   按长度判就把那张图藏了，它既看不见也点不开、更删不掉（放大层是唯一的删除入口）。
  //   老卡兜底出来的那一张则相反：它就是上面的大卡面，重复摆一遍是个空功能。
  const hung = Array.isArray(card.views) && card.views.length > 0;

  // 兜底那一张（= 没真挂过图）时，只在"我能往里加图"的前提下画整块：
  //   ① 别人的卡：加不了图，那一张又是大卡面，整块就是个空功能；
  //   ② 离线模式：加不了图（views 只收永久 URL，本地没有服务器可转存），
  //      摆一个永远点不动的入口是本仓明令禁止的（CLAUDE.md「极致画质」那条）。
  if (!hung && (!owned || !isRemoteMode())) return null;

  const full = views.length >= MAX_CARD_VIEWS;
  const gallery = hung;

  const pick = (kind: CardView["kind"]) => {
    kindRef.current = kind;
    setErr("");
    setNote("");
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setErr("");
    setNote("");
    try {
      const res = await addCardView(card.id, file, kindRef.current);
      if (res.note) setNote(res.note);
    } catch (e) {
      // ★ 失败必须显示。这条路会走网络（转存 + 同步），catch 后不响的话用户看到的是
      //   "点了没反应"，还会以为图加上了（铁律八：全 app 没有地方监听 emitApiError）
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (i: number) => {
    if (busy) return;
    setBusy(true);
    setErr("");
    setNote("");
    try {
      await removeCardView(card.id, i);
      setZoom(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="shrink-0 text-xs font-semibold text-slate-300">
          🖼 形象参考{gallery ? `（${views.length}/${MAX_CARD_VIEWS}）` : ""}
        </span>
        {/* ★ 离线模式**明说做不了**，而不是摆一排点了就报错的按钮：这些图必须先转存成
            永久地址才能给 AI 用（views 不收 dataURL），而离线模式没有服务器可转存。
            摆一个永远点不动的选项是本仓明令禁止的（CLAUDE.md「极致画质」那条）。 */}
        {owned && !isRemoteMode() && <span className="text-[10px] text-slate-500">离线模式下加不了参考图</span>}
        {owned && isRemoteMode() && !full && (
          // ★ flex-wrap：图位按卡种给，人物卡有三个（全身立绘/面部特写/标志性细节），
          //   一行排不下时要往下折，不能顶破这张卡片
          <div className="flex flex-wrap justify-end gap-1.5">
            {CARD_SLOTS[card.type].map((s) => (
              <button
                key={s.kind}
                disabled={busy}
                onClick={() => pick(s.kind)}
                className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-50"
              >
                + {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {gallery && (
        // 横滑小图：宽内容必须自己滚，别让整页横向滚（见 CLAUDE.md 底缘那几条的同类教训）
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {views.map((v, i) => (
            <button
              key={`${v.url}#${i}`}
              onClick={() => setZoom(i)}
              className="relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border border-slate-700 bg-ink/60"
            >
              <img
                src={v.url}
                alt={viewTag(card.type, v)}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              {/* ★ 贴在图上的那两个字就是"这张钱花得值不值"：出片管线只吃前几张，
                  剩下的画得再好也进不了模型（判据在 ai/real.refUsedFlags，理由见本节顶部） */}
              <span
                className={`absolute inset-x-0 top-0 py-0.5 text-center text-[9px] ${
                  used[i] ? "bg-brand/85 font-semibold text-ink" : "bg-ink/80 text-slate-400"
                }`}
              >
                {used[i] ? "出片用" : "仅展示"}
              </span>
              <span className="absolute inset-x-0 bottom-0 bg-ink/75 py-0.5 text-center text-[9px] text-slate-300">
                {viewTag(card.type, v)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ★ 铁律八的那半句必须常驻：出片管线只吃前几张，「出片用」还是乐观口径。
          2026-08-28 文案收纳：页面留这一句 + 图上的角标 + 放大层里的口径；
          完整规则（每格锁什么 / 取几张 / 什么情况整张卡带不上）进小窗，点开才读——
          它按卡种动态拼（hintFor / pipelineNoteFor 原样保留），塞不进静态的引导步骤 */}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
        出片时<span className="text-slate-400">不是每张都会喂进模型</span>——「出片用」按单卡乐观口径标，
        同一段挂的卡多时可能让位。
        <button onClick={() => setRulesOpen(true)} className="ml-1 text-brand underline">
          取舍规则 ›
        </button>
      </p>
      {rulesOpen && (
        <InfoDialog title="参考图怎么被 AI 取用" onClose={() => setRulesOpen(false)}>
          <p>{hintFor(card.type)}</p>
          <p>{pipelineNoteFor(card.type, views)}</p>
        </InfoDialog>
      )}
      {owned && full && (
        <p className="mt-1 text-[10px] text-slate-500">
          已到 {MAX_CARD_VIEWS} 张上限 —— 方舟建议不要堆满，素材太多模型反而判断不出该优先保哪些特征。
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-amber-400">{note}</p>}
      {err && <p className="mt-1 text-[11px] text-rose-400">{err}</p>}
      {busy && <p className="mt-1 text-[11px] text-slate-400">处理中…</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ""; // 同一张图连选两次也要能触发
          void onFile(f);
        }}
      />

      {/* ★ 必须 portal 到 body：这一页的祖先里有 backdrop-blur / transform 的容器，
          它们会给 position:fixed 后代造包含块，`inset-0` 于是只铺满那个盒子。
          评论抽屉与首尾帧放大层都栽过这一条（CLAUDE.md 有记）。 */}
      {zoom !== null &&
        views[zoom] &&
        createPortal(
          <div
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/90 p-6"
            onClick={() => setZoom(null)}
          >
            <img src={views[zoom].url} alt="" className="max-h-[70vh] max-w-full rounded-lg object-contain" />
            <div className="text-xs text-slate-300">
              {viewTag(card.type, views[zoom])}
              {/* ★ 放大层是 portal 到 body 的整屏浮层，图下那段说明这时看不见 —— 所以
                  "可能让位"这半句必须在这里也说一次，否则用户读到的就是一句无条件的
                  "会喂给 AI"（人物卡排在别人后面、或一段挂满 3 张时都不成立）。
                  这里不重判规则（used 仍来自 ai/real.refUsedFlags），只是把口径说全 */}
              <span className={`ml-2 text-[11px] ${used[zoom] ? "text-brand" : "text-slate-500"}`}>
                {used[zoom] ? "· 出片时会喂给 AI（同一段挂的卡多时可能让位）" : "· 只在这一页展示，出片用不到"}
              </span>
            </div>
            {views[zoom].note && <div className="max-w-xs text-center text-[11px] text-amber-400">{views[zoom].note}</div>}
            {owned && (
              <button
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  void onRemove(zoom);
                }}
                className="rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                删掉这张
              </button>
            )}
            <div className="text-[10px] text-slate-500">点任意处关闭</div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function CardDetailPage() {
  const accountV = useAccountVersion();
  useSocialVersion(); // 热度到货后重渲染（服务端计数是懒加载的）
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const [copied, setCopied] = useState(false);
  useCountView("card", id);
  // 优先账号库；不在库里（比如看别人作品的卡组）用路由 state 里带来的卡
  // ★ 依赖里带上 accountV：账号库是原地改对象的单例，不把版本号写进依赖，
  //   "刚把这张卡加进库"之后这里还会拿着路由 state 里那份只读副本。
  const card = useMemo<Card | null>(() => {
    const mine = myCards().find((c) => c.id === id);
    if (mine) return mine;
    const passed = (loc.state as { card?: Card } | null)?.card;
    return passed && passed.id === id ? passed : (passed ?? null);
  }, [id, loc.state, accountV]);
  // ★ 这一页也会渲染**别人的**卡（工坊市场点进来时卡是由路由 state 带过来的），
  //   所以分享条必须按"这张卡在不在我库里"开门，不能只看有没有登录。
  const owned = useMemo(() => myCards().some((c) => c.id === id), [id, accountV]);
  const heat = heatOf("card", id ?? "");
  // ★ hook 必须在下面那个 `if (!card) return` 之前跑完，否则卡在不在库里会改变
  //   hook 数量，切换时直接崩。所以这里用 card?.，不是 card.
  const model = useHologramModel(card?.modelUrl ?? (card ? CARD_MODELS[card.name] : undefined));

  if (!card) {
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">这张卡不在你的收藏里</p>
        <Link to="/workshop" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去创意工坊
        </Link>
      </div>
    );
  }

  const color = CARD_TYPE_COLORS[card.type];
  const inDecks = myDecks().filter((d) => d.cardIds.includes(card.id));
  const cardInfo = cardInfoOf(card);

  return (
    <div className="safe-top min-h-full px-4 pb-8 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">卡片详情</h1>
      </div>

      {/* 大卡面 / 全息建模 双栏 */}
      <div className="mb-4 flex justify-center gap-3">
        <div className="w-44">
          <TarotCard cover={card.cover || null} title={card.name} sub={CARD_TYPE_LABELS[card.type]} type={card.type} />
        </div>
        {/* ★ 判据是 model.url（**解析得到的**地址），不是 card.modelUrl（指针）：
            自己在另一台设备上炼的卡，指针会跟着账号同步过来、blob 不会 ——
            照着指针画这个框，用户得到的是一个**永远填不满的空全息框**。
            取不到就当作"这张卡没有建模"，与从来没有建模的卡表现一致。 */}
        {model.url && (
          <div className="relative w-44 overflow-hidden rounded-2xl bg-ink/85">
            <CardHologram url={model.url} />
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[10px] tracking-wide text-cyan-300/90">
              ✦ 全息实体 3D 建模
            </span>
          </div>
        )}
      </div>

      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-bold text-slate-100">{card.name}</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs" style={{ color, borderColor: color }}>
          {CARD_TYPE_LABELS[card.type]}
        </span>
        {/* ★ 热度以前读的是 card.hot —— 那是 mock/ai.ts 里手打的 18 个常数，
            从来没有任何东西会去加它，等于把一个假数字当社区热度展示了一年。
            现在走 social.heatOf：远端模式是服务端算的全局值，离线/老服务端
            退回本机计数，并在旁边如实标出来。 */}
        <span className="text-xs text-gold">🔥 {formatHeat(heat.heat)}</span>
        {heat.source === "local" && <span className="text-[10px] text-slate-600">本机计数</span>}
      </div>
      {card.tags && card.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">
              #{t}
            </span>
          ))}
        </div>
      )}
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{card.summary}</p>

      {/* 形象参考图：AI 画设定帧时真的会照着它们锁形象，不是相册 */}
      <CardViewsSection card={card} owned={owned} />

      {/* 人物声音：标识 + 试听 + 移除（样本在本机侧库，不随卡同步/分享） */}
      <CardVoiceSection card={card} owned={owned} />

      {/* 方舟可信素材：真人卡做完肖像授权后填 asset ID，出片改走 asset:// */}
      <CardAssetSection card={card} owned={owned} />

      {/* 「<类型>信息」：铸卡时的完整提示词——照着它 AI 就能复刻出与卡面一致的画面/建模。
          ★ 标题按卡种叫（人物信息/场景信息/…），表在 types.CARD_INFO_LABELS 一处 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">🧬 {CARD_INFO_LABELS[card.type]}</span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(cardInfo).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
          >
            {copied ? "已复制 ✓" : "复制"}
          </button>
        </div>
        <p className="whitespace-pre-wrap break-all text-xs leading-relaxed text-slate-400">{cardInfo}</p>
        {/* ★ 老卡/素材卡没存 genPrompt，上面那段是 cardInfoOf 现拼的 —— 那就不能说
            "这是铸造时使用的提示词"（铁律五：没有的事不许说成有）。照着它出的图会像，
            但不等于当初那一张 */}
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          {card.genPrompt
            ? "这是铸造这张卡时使用的完整生成提示词。"
            : "这张卡没留下铸造时的提示词（老卡/素材卡），上面是按同款格式现补的一份。"}
          把它交给 AI（或在工坊中使用本卡），即可生成与卡面一致的
          {card.type === "character" ? "角色画面 / 3D 建模" : "画面"}。
        </p>
      </div>

      {inDecks.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">所属卡组</div>
          <div className="flex flex-wrap gap-2">
            {inDecks.map((d) => (
              <Link key={d.id} to={`/deck/${d.id}`} className="rounded-full bg-panel px-3 py-1.5 text-xs text-slate-200">
                🎴 {d.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 分享到创意工坊。只对**自己库里**的卡开放（这一页也渲染别人的卡） */}
      <WorkshopShareBar
        kind="card"
        className="mb-4"
        published={!!card.published}
        disabledReason={shareBlockReason({ remote: isRemoteMode(), owned, modelUrl: card.modelUrl, realPerson: card.realPerson })}
        note={shareModelNote(card)}
        onToggle={(next) => shareCard(card.id, next)}
      />

      <Link
        to="/studio"
        className="block w-full rounded-xl bg-brand/90 py-2.5 text-center text-sm font-bold text-ink"
      >
        🎬 去 3D 工坊用这张卡创作
      </Link>

      <SocialPanel kind="card" id={card.id} />
    </div>
  );
}
