// 卡片详情页：大卡面 + 类型/标签 + 简介 + 形象参考图（多图）+「<类型>信息」
// （铸卡时的完整提示词，具体到可复刻卡面）+ 3D 建模全息预览（有 modelUrl 的角色卡）。
// 创意工坊/我的/卡组详情点卡进来。
import { useEffect, useRef, useMemo, useState, useSyncExternalStore } from "react";
import { showToast } from "../data/toast";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import DeleteCardDialog from "../components/DeleteCardDialog";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router";
// ★ 出片管线的规则一律**从管线本身取**，这一页不再抄一份（铁律六）。
//   抄的那份漏过规则一（只有第一张人物卡进参考图），于是「出片用」这个标签会对着
//   一张从来不进模型的图亮起来 —— 用户为它多付了钱，界面还告诉他钱花在了出片上。
import { MAX_CHAR_REFS, MAX_REF_IMAGES, TYPE_LABEL, cardStyleSuffix, refUsedFlags } from "../ai/real";
import InfoDialog from "../components/InfoDialog";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import WorkshopShareBar, { shareBlockReason } from "../components/WorkshopShareBar";
import CardHologram, { CARD_MODELS, useHologramModel } from "../studio/ui/CardHologram";
import { acquireCard, bindCardAsset, cardsReady, fetchSharedCard, isRemoteMode, myCards, myDecks, removeCard, shareCard, updateCardMeta } from "../data/account";
import { addCardView, removeCardView } from "../data/cardViews";
import { removeVoice, subscribeVoices, voiceOf, voicesVersion } from "../data/cardVoice";
import { assetPersisted, assetSyncIssue, assetsVersion, subscribeAssets } from "../data/cardAsset";
import PortraitAuthPanel from "../components/PortraitAuthPanel";
import { formatHeat, heatOf } from "../data/social";
import {
  CARD_INFO_LABELS,
  CARD_NAME_MAX,
  CARD_SUMMARY_MAX,
  CARD_SLOTS,
  CARD_TYPE_COLORS,
  CARD_TYPE_LABELS,
  Card,
  CardType,
  CardView,
  MAX_CARD_VIEWS,
  SHARE_NOTE_MAX,
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
      `预算不够时「先被丢的就是各卡的第 2 张」，卡再多下去整张卡都会带不上（两种情况生成步骤里都会逐张点名）。` +
      // ★ P2-a（2026-08-29）后直通路的预算跟档位协议走（9/30），3 张那句只描述经典路
      `（白模挂卡与简约参考图直出那两条路更宽：参考图直接进视频模型，上限按所选档位的协议走。）`
    );
  }
  return (
    `出片时一段里只有「第一张人物卡」能带形象参考图：它最多取 ${MAX_CHAR_REFS} 张（优先${slotLabel(
      "character",
      "face",
    )} + ${slotLabel("character", "body")}）；同一段里的其余人物卡一张都不带，只按文字设定参与` +
    `——一张图里画多个角色会被方舟整条拒掉。所以上面的「出片用」是按"这张卡就是那第一张人物卡"标的：` +
    `它排在别的人物卡后面时，标着出片用的那几张同样进不了模型（生成步骤里会点名说明）。` +
    // ★ 不画设定帧的两条路是**例外**，必须说：白模 r2v 与简约参考图直出（P2-a 放宽后）
    //   的参考图直接进视频模型，"一张图里画多个角色被拒"根本不适用，每张人物卡各带各的
    //   形象图。不说这一句，用户会照上面那半句自我设限：以为挂第 2 张人物卡没用。
    `（两条不画设定帧的路是例外——白模模板挂卡、简约模式的参考图直出：每张人物卡都各带自己的形象图。）` +
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
  // ★★ 判**落盘了吗**，不是"内存里有吗"（2026-09-01 复核抓到）：saveAsset 写内存那一拍就
  //   emit()，只问 assetOf 的话窄条在点下去那一瞬间就没了 —— 连同它下面那句错误提示，
  //   而提示里还写着「再点一次」，那时已经无处可点。落盘失败时窄条留住，这条路才是真的。
  if (assetPersisted(card.id)) {
    // 绑上（且存住了）即窄条消失（见顶注）——只剩一句可能要说的话：服务端还没收下。
    // 绑定属于账号（server BranchCard.portrait），没上行 = 换台设备暂时看不到；下次登录会自动补传
    const issue = assetSyncIssue(card.id);
    return issue ? (
      <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-400/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
        🪪 肖像授权已在本机接上，但还没同步到服务端（{issue}）——换台设备暂时看不到，下次登录会自动补传。
      </p>
    ) : null;
  }
  return (
    <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-400/5 p-3">
      <p className="mb-1.5 text-[11px] leading-relaxed text-amber-200/90">
        🪪 这张真人卡还<b className="text-amber-100">没接上已授权的肖像素材</b>——
        「高清」「电影级」档不收直接上传的真人照片，接上之前用它出片会被拒。
      </p>
      <PortraitAuthPanel
        onBound={(assetId, note) => {
          // 窄条是"卡已存在"的场景，当场落库。写失败要出声（铁律八）：
          // 静默失败的话用户以为绑好了，出片那一刻才发现还是拒。
          // ★ 判**返回值**不判 reject：saveAsset 底下的 idbSet 把异常吞了回 false，
          //   原来那条 `.catch` 一次都跑不到（2026-09-01 修 cardAsset 契约时一并改）。
          //   服务端那半（换台设备看得到）由 bindCardAsset 记进侧库，上面 assetPersisted 那支把话说出来
          void bindCardAsset(card.id, { assetId, scope: "private", note }).then(
            (b) => b.stored || setSaveErr("绑定没存住（本机存储写入失败）——再点一次；一直不行就重启 App 再试。"),
            () => setSaveErr("绑定没存住（本机存储写入失败）——再点一次；一直不行就重启 App 再试。"),
          );
        }}
      />
      {saveErr && <p className="mt-1.5 text-[10px] leading-relaxed text-rose-300">{saveErr}</p>}
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
        <span className="mb-1.5 text-xs font-semibold text-slate-300">🔊 人物声音</span>
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
        <span className="mb-1.5 text-xs font-semibold text-slate-300">🔊 人物声音 · {v.durationSec}s</span>
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
                className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200 disabled:opacity-40"
              >
                + {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {gallery && (
        // 横滑小图：宽内容必须自己滚，别让整页横向滚（见 CLAUDE.md 底缘那几条的同类教训）
        <div className="-mx-1 flex gap-2 no-scrollbar overflow-x-auto px-1 pb-1">
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
        <button onClick={() => setRulesOpen(true)} className="ml-1 text-brand underline underline-offset-2">
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
      {err && <p className="mt-1 text-[11px] text-rose-300">{err}</p>}
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
                className="rounded-full bg-rose-500/90 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-40"
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
  useCountView("card", id);
  // 优先账号库；不在库里（比如看别人作品的卡组）用路由 state 里带来的卡
  // ★ 依赖里带上 accountV：账号库是原地改对象的单例，不把版本号写进依赖，
  //   "刚把这张卡加进库"之后这里还会拿着路由 state 里那份只读副本。
  const localCard = useMemo<Card | null>(() => {
    const mine = myCards().find((c) => c.id === id);
    if (mine) return mine;
    const passed = (loc.state as { card?: Card } | null)?.card;
    // ★★ 这道 id 校验原来**形同虚设**：写的是 `passed && passed.id === id ? passed : (passed ?? null)`,
    //   不匹配时 else 分支返回的还是 `passed`。于是 URL 指着 B 卡、路由 state 里躺着 A 卡时
    //   （返回栈里翻回来、或从两个入口先后点进来），页面画的是 A，而同一个组件里的
    //   `useCountView("card", id)` 把这次浏览记在 **B** 头上 —— 两件事都零报错。
    return passed && passed.id === id ? passed : null;
  }, [id, loc.state, accountV]);
  // ★ 这一页也会渲染**别人的**卡（工坊市场点进来时卡是由路由 state 带过来的），
  //   所以分享条必须按"这张卡在不在我库里"开门，不能只看有没有登录。
  const owned = useMemo(() => myCards().some((c) => c.id === id), [id, accountV]);
  /** 删卡确认开着没有 */
  const [ask, setAsk] = useState(false);
  /** 改名弹层（只对自己的卡）。★ 与删卡确认并排放在这里：都在所有早退之前 */
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  /** 「添加到我的卡片」的在途与失败原因（只对别人的卡出现） */
  const [getting, setGetting] = useState(false);
  const [getErr, setGetErr] = useState<string | null>(null);
  const heat = heatOf("card", id ?? "");

  /**
   * 库里没有、路由 state 也没带 → **去广场上按 id 取一次**（深链回源）。
   *
   * ★★ 这一段是为了堵一条"撒谎路径"：这一页此前只有两条来路（自己库里那份 / 上一页
   *   递过来的对象），于是**一条卡片链接是打不开的** —— 分享出去的链接、会话恢复、
   *   通知深链，落地都是一句"这张卡不在你的收藏里"，而那张卡在广场上好好挂着。
   *   （模板那边 2026-08-14 因为同一形状补过 fetchRemoteTemplateById，这条照它做。）
   * ★ hook 排在所有早退**之前**：卡在不在库里会改变早退与否，写在后面就是
   *   "Rendered fewer hooks"，整棵树当场崩（CLAUDE.md 那格坑）。
   */
  const [remote, setRemote] = useState<{ card: Card | null; err: string } | null>(null);
  const hydrating = !cardsReady();
  useEffect(() => {
    // 库里有 / state 带了 / 账号资产还没装完 → 都不该在这一拍去问服务端
    if (localCard || !id || hydrating || !isRemoteMode()) return;
    let alive = true;
    void fetchSharedCard(id)
      .then((c) => alive && setRemote({ card: c, err: "" }))
      .catch((e) => alive && setRemote({ card: null, err: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [localCard, id, hydrating]);

  /** 这一页要画的那张卡：自己库里那份优先，其次是刚从广场取回来的那份 */
  const card = localCard ?? remote?.card ?? null;

  // ★ hook 必须在下面那些早退之前跑完，否则"卡在不在库里"会改变 hook 数量，切换时直接崩
  //   （所以这里用 card?.，不是 card.）。★ 放在 card 算出来之后：深链回源拿到的卡也带
  //   modelUrl，用 localCard 的话那种卡的全息预览会永远不出来。
  const model = useHologramModel(card?.modelUrl ?? (card ? CARD_MODELS[card.name] : undefined));

  if (!card) {
    // ★ 四种结局分开说（原来四件事共用一句"这张卡不在你的收藏里"，那是铁律八没有出路）：
    //   ① 账号资产还在装 ② 正在去广场上取 ③ 这次没取成 ④ 真的没有
    if (hydrating || (isRemoteMode() && !remote)) {
      return (
        <EmptyState full loading text={hydrating ? "正在装载你的卡片库…" : "正在从创意工坊取这张卡…"} />
      );
    }
    if (remote?.err) {
      return (
        <EmptyState
          full
          icon="cards"
          error
          text={`这次没取到这张卡：${remote.err}`}
          hint="这不代表它不存在，只是这次没问到"
          cta={{ label: "重试", onClick: () => setRemote(null) }}
        />
      );
    }
  }

  if (!card) {
    return (
      /* ★ 走到这儿是**真的没有**：库里没有、路由 state 没带、广场上也没有（或离线）。
          前面三种"还不知道"的情况已经各自说过话了。 */
      <EmptyState
        full
        icon="cards"
        text={`这张卡不在你的收藏里${isRemoteMode() ? "，创意工坊的广场上也没有" : ""}`}
        cta={{ label: "去创意工坊", to: "/workshop", primary: true }}
      />
    );
  }

  const color = CARD_TYPE_COLORS[card.type];
  const inDecks = myDecks().filter((d) => d.cardIds.includes(card.id));
  const cardInfo = cardInfoOf(card);

  return (
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset onBack={() => nav(-1)} title="卡片详情" />

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
        {/* ★★ 改名入口（2026-08-30）。此前**根本改不了** —— 客户端的 updateCard 只写本地，
            服务端那条 PATCH 只收 views ⇒ 名字打错一个字的唯一出路是**删了重铸**，
            而铸卡是花钱的（顶档一张连带 3D 建模十几万 token）。只对自己的卡出现。 */}
        {owned && (
          <button
            onClick={() => {
              setEditName(card.name);
              setEditSummary(card.summary);
              setEditErr(null);
              setEditing(true);
            }}
            className="rounded-full border border-slate-600 px-2 py-0.5 text-[10px] text-slate-400"
          >
            改名
          </button>
        )}
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
            <span key={t} className="rounded-full bg-panel px-2.5 py-1 text-[11px] text-slate-300">
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

      {/* 固定身份句（Card.idLine）：出片提示词里代表这张卡的那一句（铸卡时压好、逐段复用）。
          只在真有的时候显示——老卡/自传图卡走 idLineOf 的兜底，那不是"留下来的身份句"，
          摆出来说成是就违反铁律五 */}
      {card.idLine && (
        <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-300">🎯 出片身份句</div>
          <p className="text-xs leading-relaxed text-slate-400">{card.idLine}</p>
          <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
            出片时提示词里代表这张卡的固定一句（逐段复用同一措辞，形象更稳）。长设定进画面靠上面的参考图与
            {CARD_INFO_LABELS[card.type]}，不直接塞进视频提示词。
          </p>
        </div>
      )}

      {/* 「<类型>信息」：铸卡时的完整提示词——照着它 AI 就能复刻出与卡面一致的画面/建模。
          ★ 标题按卡种叫（人物信息/场景信息/…），表在 types.CARD_INFO_LABELS 一处 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="mb-1.5 text-xs font-semibold text-slate-300">🧬 {CARD_INFO_LABELS[card.type]}</span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(cardInfo).then(() => showToast("已复制"));
            }}
            className="rounded-full bg-slate-700/70 px-2.5 py-1 text-[11px] text-slate-200"
          >
            复制
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
        disabledReason={shareBlockReason({
          remote: isRemoteMode(),
          published: !!card.published,
          owned,
          modelUrl: card.modelUrl,
          realPerson: card.realPerson,
          fromOthers: card.fromOthers,
        })}
        note={shareModelNote(card)}
        onToggle={(next, note) => shareCard(card.id, next, note)}
        noteMax={SHARE_NOTE_MAX}
      />

      {/* ★★ 别人的卡：这一页原来**没有任何"装到我的卡片"的入口**（2026-08-30 补）。
          观众看完只能 nav(-1) 回工坊、在网格里把这张卡再找一遍 —— 而分享条上那句
          「只能分享自己库里的卡：先把它添加到我的卡片」指的正是这个不存在的动作（铁律八：
          说了出路就得有出路）。装法走 account.acquireCard 一处（广场卡走 install、
          快照卡走落库，判据只在那儿）。 */}
      {/* ⚠ 这一格的显示条件是 `!owned || getErr` 而**不是** `!owned`（复核抓到）：
          快照卡那条路 `addCards` 会**先落本地**再同步，落完 `myCards()` 就有它了 ⇒
          `owned` 当场翻真 ⇒ 这一整块卸载 ⇒ 刚 set 进去的那句「没同步到服务器」画在了
          一个已经不存在的分支里 = 零提示，而卡此刻只在这台设备上、下次冷启动会被
          `loadRemoteAssets` 整表覆盖掉。留着这一格，那句话才有落点（铁律八）。 */}
      {(!owned || getErr) && (
        <div className="mb-2">
          <button
            onClick={() => {
              if (getting) return;
              setGetting(true);
              setGetErr(null);
              void acquireCard(card)
                .then((r) => {
                  if (!r.ok) setGetErr(r.why);
                })
                .finally(() => setGetting(false));
            }}
            disabled={getting}
            className={`block w-full rounded-xl py-2.5 text-center text-sm font-bold disabled:opacity-40 ${
              owned ? "bg-panel text-slate-300 ring-1 ring-slate-700" : "bg-brand/90 text-ink"
            }`}
          >
            {getting ? "添加中…" : getErr ? "再同步一次" : "＋ 添加到我的卡片"}
          </button>
          {getErr && <p className="mt-1 text-[11px] leading-relaxed text-rose-300">{getErr}</p>}
        </div>
      )}

      <Link
        to="/studio"
        className={`block w-full rounded-xl py-2.5 text-center text-sm font-bold ${
          owned ? "bg-brand/90 text-ink" : "bg-panel text-slate-300 ring-1 ring-slate-700"
        }`}
      >
        🎬 去 3D 工坊用这张卡创作
      </Link>

      {/* 删除（2026-08-30 主人点名"详情页没有删除功能"）。★ 只对自己库里的卡出现 ——
          这一页也渲染别人分享的卡，那种情况下"删除"删的是谁的卡讲不清楚。
          ★ 摆在最下面、用文字链而不是大按钮：这是不可逆操作，不该与主行动抢注意力；
            确认卡（DeleteCardDialog，与工坊页共用一份）会把后果按事实说全。 */}
      {owned && (
        <button
          onClick={() => setAsk(true)}
          className="mt-4 block w-full py-2 text-center text-[11px] text-slate-500"
        >
          删除这张卡
        </button>
      )}
      {editing && card && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6" onClick={() => !editBusy && setEditing(false)}>
          <div className="w-full max-w-xs rounded-2xl border border-slate-700 bg-ink p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-100">改这张卡的名字与简介</h3>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={CARD_NAME_MAX}
              placeholder="卡名"
              className="mt-3 w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
            <textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              maxLength={CARD_SUMMARY_MAX}
              rows={3}
              placeholder="一句话简介"
              className="mt-2 w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand leading-relaxed"
            />
            {/* ★ 如实说清改的是哪一份：随作品/卡组发出去的是**快照**（逐字段复制的），
                不会跟着改。不说的话用户以为"全网都改了"，回头发现别人那份还是旧名字。 */}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              改的是你库里这一份。已经随作品发布、或被别人装走的那些是当时的副本，不会跟着变。
            </p>
            {editErr && (
              <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
                {editErr}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={editBusy}
                className="flex-1 rounded-xl border border-slate-600 py-2.5 text-xs text-slate-300 disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => {
                  const name = editName.trim();
                  if (!name) {
                    setEditErr("卡名不能空着 —— 卡组里全靠它认人。");
                    return;
                  }
                  setEditBusy(true);
                  setEditErr(null);
                  void updateCardMeta(card.id, { name, summary: editSummary.trim() })
                    .then((why) => {
                      if (why) setEditErr(why);
                      else setEditing(false);
                    })
                    .finally(() => setEditBusy(false));
                }}
                disabled={editBusy}
                className="flex-1 rounded-xl bg-brand py-2.5 text-xs font-bold text-ink disabled:opacity-40"
              >
                {editBusy ? "保存中…" : editErr ? "再试一次" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ask && card && (
        <DeleteCardDialog
          card={card}
          onCancel={() => setAsk(false)}
          // ★ 真删成了才退页：没删成还退的话，那句失败原因跟着这一页一起没了，
          //   用户回到工坊看见卡还在，只会以为"点了没反应"
          onConfirm={async () => {
            const why = await removeCard(card.id);
            if (why) return why;
            setAsk(false);
            // 卡没了，这一页就是死页 —— replace 回上一屏（多半是工坊/卡组），别留一格
            nav(-1);
            return null;
          }}
        />
      )}

      <SocialPanel kind="card" id={card.id} />
    </div>
  );
}
