// 跟着做 B「主角定妆 · 多镜头」的两件事 —— 两个面（工坊铸段窗、画布「＋ 加一段」）共用的唯一实现（2026-10-04 第二期，
// 方案 docs/guided-modes-design.md §二 B）：
//   ① 第①步就地「现做一个主角」（forgeLead）；
//   ② 第④步把向导的结果落成一段（leadAppendSpec：交给 flowStore.appendNode / appendQuote 的那一份）。
//
// ★ 现做主角走**铸卡师那条路**（ai.generateCards，工坊素材窗同一条出图路），不走自传图做卡片那条（portraitViews）：
//   这一步要「只写一句话就画得出来」，而自传图那条必须先有一张照片。铸卡师那条按图位表画，人物卡在「精绘」档正好两张 ——
//   全身立绘 + 照着它画的面部特写（types.CARD_SLOTS / economy.slotsFor），就是官方说的「全身照 + 大头照」。
// ★★ 2026-10-10（2.63）从「定妆」（Seedream 4.5）换成「精绘」（5.0 pro）：4.5 在方舟第十批下线名单上（11-24），「定妆」那一档整个撤了
//   （economy.IMAGE_TIERS 的 ★★）。不退到「速写」：速写只画一张主图，B 要的是两张（全身 + 特写），少一张出片时人就不稳。
//   精绘一张图实测七八十秒到一分半，两张串着画要几分钟 —— 向导那颗键旁边照实说（CastPicker），进度一张一张报（generateCards 的 onProgress）。
// ★★ 只收一句话、不收照片，并且交代「不要照片写实的真人风格」：写实的人脸图会被高清 / 电影级整发拒
//   （400 InputImageSensitiveContentDetected.PrivacyInformation —— 2026-09-30 付费实测，**哪怕是 Seedream 画的**，见 account.realFaceIssue 的 ★★）。
//   B 的出片恰好只在这两档上（data/guidedModes.modeBlock），在这里画一张写实脸 = 付了图钱、出片那一刻被拒。
//   用照片做真人主角要走「自传图做卡片」的真人认证（火山引擎适用），那一套不在这一步里重做 —— 向导里给一条去那儿的路。
// ★ 钱：报价 economy.forgeCost(1, "character", LEAD_IMAGE_TIER)，实扣 forgeSettle(minted, LEAD_IMAGE_TIER)（离线账本；远端模式服务端按调用结算，
//   按的是真发出去的模型 = 同一档的 model），与素材窗同一对函数。档位只写在 LEAD_IMAGE_TIER 一处：报价、余额门、出图、结算都读它。
// ★ 画成就落进卡片库（account.addCards，顺带把形象图转存成永久地址）：这一步的产物就是一张人物卡（方案原话「存成人物卡」）——
//   摆一个「收下」再落库的话，人没点之前 App 被回收，这两张付过钱的图就没了。主图都没画成（minted 0）的不落库：那张卡面是占位图。
// ★ 这一炉是谁开的：回来时换了账号就作废（与 studioStore.forgeCards 同一条），不往新账号的库里塞。
import { t } from "@lingui/core/macro";
import { AI_REAL, generateCards } from "../ai";
import { addCards, canAfford, frozenNote, spendTokens } from "../data/account";
import { workOwner } from "../data/deviceOwner";
import { forgeCost, forgeSettle, fmtTokens, imageTierPriceIssue, slotsFor } from "../data/economy";
import { uid, type Card, type Proposal, type VideoAspect } from "../types";
import type { AppendSpec } from "./flowStore";

/** 现做主角用哪一档出图：「精绘」= 全身立绘 + 面部特写两张（economy.IMAGE_TIERS；2.63 之前是「定妆」，理由见文件头 ★★） */
export const LEAD_IMAGE_TIER = "master";
export const LEAD_NAME_MAX = 8;
export const LEAD_DESC_MIN = 4;
export const LEAD_DESC_MAX = 120;

/** 现做一个主角要多少（null = 这一档报不出价，见 economy.imageTierPriceIssue） */
export function leadForgeCost(): number | null {
  return forgeCost(1, "character", LEAD_IMAGE_TIER);
}

/* i18n-frozen: 交给铸卡师的人物描述（出图与写卡文案的提示词），冻结中文 */
const leadNote = (name: string, desc: string, style: string | null): string =>
  [name ? `名字叫${name}` : "", desc, style ? `画风：${style}` : "", "不要照片写实的真人风格，要插画、动画或绘本一类的画风"]
    .filter(Boolean)
    .join("。") + "。";

export interface LeadForged {
  card: Card;
  /** 真画成了几张（满 = want） */
  minted: number;
  want: number;
  /** 铸卡师逐条记的实情（哪张没画成、为什么） */
  notes: string[];
  /** 卡没同步到服务器的原因（本机有、重开 App 就没了）；同步了是 null */
  unsynced: string | null;
  /** 没转存成永久地址的形象图（「凛」的面部特写…） */
  lostViews: string[];
  lostReason?: string;
}

/**
 * 现做一个主角：一句话（+ 可选的名字与画风）→ 两张图的人物卡，落进卡片库。失败整句 throw（铁律八）。
 * @param style 画风芯片的原话（向导里那几颗：二次元 / 3D 动画…），没挑 = null
 */
export async function forgeLead(o: { name: string; desc: string; style: string | null; onProgress: (s: string) => void }): Promise<LeadForged> {
  const desc = o.desc.trim().slice(0, LEAD_DESC_MAX);
  if (desc.length < LEAD_DESC_MIN) throw new Error(t`先写一句这个人长什么样（至少 ${LEAD_DESC_MIN} 个字）`);
  const cost = leadForgeCost();
  const issue = imageTierPriceIssue(LEAD_IMAGE_TIER);
  if (issue || cost === null) throw new Error(issue ?? t`这一档暂时报不出价，换个时间再试`);
  if (AI_REAL && !canAfford(cost)) {
    const price = fmtTokens(cost);
    throw new Error(frozenNote() ?? t`现做一个主角要 ${price} token，余额不够——去「我的」页充值`);
  }
  const owner = workOwner();
  const name = o.name.trim().slice(0, LEAD_NAME_MAX);
  const { cards, minted, notes } = await generateCards([], leadNote(name, desc, o.style), "character", {
    tierId: LEAD_IMAGE_TIER,
    onProgress: o.onProgress,
  });
  if (workOwner() !== owner) throw new Error(t`这一炉是上一个登录的账号开的，已作废。`);
  // 按真画成的张数结算（离线账本；远端模式这一行是空操作，服务端早按调用结算过），与素材窗同一个函数
  if (AI_REAL) {
    const due = forgeSettle(minted, LEAD_IMAGE_TIER);
    if (due !== null) spendTokens(due);
  }
  const got = minted[0] ?? 0;
  const forged = cards[0];
  const why = notes.join(t({ message: "；", comment: "把铸卡时的几条说明连成一句时的分隔符" }));
  if (!forged || (AI_REAL && got === 0)) {
    // 主图都没画成：卡面是占位图，不落库。钱的话只说事实（同素材窗那句的口径：客户端无从断言「没收钱」）
    throw new Error(
      why
        ? t`主角的形象图没画成（${why}），这张卡没收进卡片库。已经画出来、只是没取回来的图仍会计费，实扣以「我的」页余额为准——可以再试一次`
        : t`主角的形象图没画成，这张卡没收进卡片库。已经画出来、只是没取回来的图仍会计费，实扣以「我的」页余额为准——可以再试一次`,
    );
  }
  // 名字是人写的就照人写的（写台词时认说话人就认这个名字）；没写才用铸卡师起的
  const card: Card = name ? { ...forged, name } : forged;
  const r = await addCards([card]);
  if (r.added.length === 0) throw new Error(t`没能存进你的卡片库：登录态可能已经失效。重新登录后再做一次`);
  return {
    card,
    minted: got,
    want: slotsFor("character", LEAD_IMAGE_TIER).length,
    notes,
    unsynced: r.synced ? null : r.reason || t`没能同步到服务器`,
    lostViews: r.lostViews,
    ...(r.reason ? { lostReason: r.reason } : {}),
  };
}

/** 向导交出来的那一份（第④步点下去时） */
export interface LeadSpec {
  /** 出场人物（第一个 = 主角） */
  cast: Card[];
  /** 这场戏（人的原话，存进 requirement） */
  scene: string;
  /** 分镜（一段话，存进方案的 plot —— 出片提示词就是它） */
  script: string;
  durationSec: number;
  aspect: VideoAspect;
}

/**
 * 向导的结果 → 落一段要交给 flowStore 的那一份（appendNode 落段、appendQuote 报价读的是同一份）。
 * ★ 落成的是一段**参考图直出段**（direct）：出片规则与 A 完全相同（人物图直接给视频模型、不画帧，data/drawPlan），
 *   B 只是先把人定死、再把剧本写成多镜头 —— 别给它另开一种段（那就是出片规则的第二份实现）。
 * ★ 方案标题存进作品（VideoSegment.title），按作者当时的界面语言定下来（与「参考图直出」「自定义」同一条先例）。
 */
export function leadAppendSpec(spec: LeadSpec, tierId: string): AppendSpec {
  const p: Proposal = {
    id: uid("prop"),
    title: t`主角定妆 · 多镜头`,
    plot: spec.script,
    firstFrame: "",
    lastFrame: "",
    durationSec: spec.durationSec,
  };
  return {
    proposals: [p],
    chosenId: p.id,
    materials: spec.cast,
    videoTier: tierId,
    aspect: spec.aspect,
    requirement: spec.scene.trim(),
    direct: true,
  };
}
