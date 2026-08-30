// 自定义卡片：用**用户自己的图**铸一张卡（卡面 + 形象参考图 + 「<类型>信息」）。
// 入口在创意工坊「铸新卡」那一组里。
//
// ★★ 这条路的定位必须一眼看得出来：默认的铸卡**已经是 AI 全自动出图**（3D 工坊里
//   交给铸卡师，一张图都不用传）。这一页是给"我就是想用自己那张图"的人留的**另一条**
//   路，不是默认路径。2026-08-28 文案收纳：顶上的对比说明压成**一句常驻**（另一条路 /
//   不耗 token / 去工坊的链接），三条展开讲进了引导（tours 的 customcard，首次进页
//   强制放一遍、角落 ? 随时重看）——"默认铸卡不用传图"这件事仍然人人看得到。
//
// ★★ 这一页**一个模型都不调**，所以既不报价也不扣 token。这是它相对 AI 铸卡的真实
//   优势（也是唯一的），要写出来；反过来说，它也没有"AI 帮你补全另外两张图"这件事。
//
// ── 想清楚过的四件事（对应铁律五/七/八）────────────────────────────
// ① **离线模式给不给走？给。** 卡本身照样成立：`data/account.addCards` 在离线模式
//    **故意不转存** dataURL —— 它落在 IndexedDB 里，详情页能显示、出片管线的
//    prepRefImage 本来就吃 dataURL。发布则真的不行（`shareBlockReason` 第一条），
//    所以顶上那块黄字**明说**"能铸不能发、且只在这台设备上"，不假装能发（铁律五）。
// ② **一张图都没传就点铸卡会怎样？** 点不动，而且**写出还缺什么**。只把按钮灰掉
//    不说原因是本仓明令禁止的形状（CLAUDE.md「界面上摆一个永远点不动的选项」那条）。
// ③ **转存失败（lostViews 非空）时用户看到什么？** 看到"卡建好了，但这几张图没能存到
//    服务器"，**不是**一句"成功了"就跳走（铁律八）。这时**不自动跳转** —— 跳走了那段话
//    就没人读得到，而它说的正是"你的图可能会没"。
// ④ **图太大 / 比例超 3:1 怎么办？** 走 `data/cardViews.prepareCardImage`（与详情页
//    「+ 图位」同一份实现）：越界居中裁并把这件事**说出来**，超 5MB 直接报错。
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import PortraitAuthPanel from "../components/PortraitAuthPanel";
import VoiceRecorder from "../components/VoiceRecorder";
import VoiceUploadButton from "../components/VoiceUploadButton";
import { fetchPortraitAssetImage } from "../api/portrait";
import { addCards, canAfford, isRemoteMode, spendTokens, walletOf } from "../data/account";
import { API_ON } from "../api/client";
import { prepareCardImage } from "../data/cardViews";
import { AI_REAL, portraitViews, refineCardImage } from "../ai";
import { chatVision } from "../ai/arkClient";
import FrameAnnotator from "../components/FrameAnnotator";
import { CHAT_TURN_TOKENS, ONE_IMAGE, fmtTokens, schemeCost } from "../data/economy";
import { saveAsset } from "../data/cardAsset";
import { saveVoice } from "../data/cardVoice";
// 人物卡的图位不再写死三格，由**提示词方案**定（与「从视频提取」同一套方案库）。
// 方案在这里决定**图位结构**（几格、各叫什么、锁什么）；「AI 生成图位」车道
// 走 ai/portraitViews（与工坊提卡同一条出图路），报价同一把尺 schemeCost。
import {
  defaultScheme,
  listSchemes,
  schemeOf,
  schemesVersion,
  slotSize,
  subscribeSchemes,
} from "../data/promptSchemes";
import {
  CARD_INFO_LABELS,
  CARD_SLOTS,
  CARD_TYPES,
  CARD_TYPE_COVERS,
  CARD_TYPE_LABELS,
  Card,
  CardType,
  CardView,
  parseTags as parseTagsShared,
  roleToKind,
  slotLabel,
  uid,
} from "../types";
// （比例上限那个数现在只在引导文案里出现，由 tours.tsx 从 utils/image 插值）

/**
 * 卡名 / 简介的长度上限。
 * ★ 与 AI 铸卡那条路同一口径（`ai/real.ts` 收豆包返回时是 `name.slice(0,8)` /
 *   `summary.slice(0,60)`）：两条路铸出来的卡会并排摆在同一个九宫格里，一边能写 20 个字
 *   另一边只能写 8 个，卡面上的题名就会有一半是省略号。
 * ★ 8 这个数由 TarotCard 决定：题名是底部一条**单行**小字，再长就 truncate。
 */
const NAME_MAX = 8;
const SUMMARY_MAX = 60;
/** 「<类型>信息」。这段会被 AI 当作复刻这张卡的依据，给足空间但别让人贴一整本设定集 */
const INFO_MAX = 500;
const TAG_MAX = 6;
const TAG_LEN_MAX = 10;

/** 方案小窗的占位图（内置方案都带真实示例图了，这份只兜自定义方案没存示例的情况） */
const SCHEME_EMOJI: Record<string, string> = { scheme_clean: "🧍", scheme_faceless: "🫥", scheme_specsheet: "📐" };

/** 一个图位上已经准备好的那张图 */
interface Shot {
  /** 已按 prepareCardImage 处理过（比例裁 + 尺寸压制）的 dataURL */
  dataUrl: string;
  /** 我们动过这张图就有值，必须显示出来 */
  note?: string;
  /** 原文件名，只为让用户认得出自己传的是哪张 */
  fileName: string;
}

/** 标签输入 → tags。分隔符规则**只有一处**（types.parseTags），这里只把卡片的上限传进去
 *  —— 卡片与作品的上限是两条独立规则，但"怎么切"必须是同一条（见 types 那处的 ★） */
function parseTags(raw: string): string[] {
  return parseTagsShared(raw, { max: TAG_MAX, maxLen: TAG_LEN_MAX });
}

/** Blob → dataURL。纯编码，不是规则（规则都在 prepareCardImage 里） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error("图片读取失败"));
    fr.readAsDataURL(blob);
  });
}

export default function CustomCardPage() {
  const nav = useNavigate();
  const remote = isRemoteMode();

  const [type, setType] = useState<CardType>("character");
  // 按 **kind** 存，不按下标存：换卡种时图位的**数量和含义**都会变，按下标存会让
  // "人物卡的面部特写"在切成场景卡之后变成"局部特征"——一声不响地指鹿为马。
  // ★ 这份 kind 库只服务**非人物卡**了：人物卡的图位由方案定，另存 schemeShots（按 tag 键，
  //   同一条"不按下标"的理由）。两库互不相通，换卡种时各自原样留着 —— 切回来图还在。
  const [shots, setShots] = useState<Partial<Record<CardView["kind"], Shot>>>({});
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [info, setInfo] = useState("");
  const [tagText, setTagText] = useState("");

  // ── 人物卡：方案驱动的图位 ─────────────────────────────
  // 方案库是模块级侧库，自建/删除后要重渲染靠订阅（与 VideoCardAnnotator 同一套）
  useSyncExternalStore(subscribeSchemes, schemesVersion, () => 0);
  const [schemeId, setSchemeId] = useState<string>(defaultScheme().id);
  const [schemeOpen, setSchemeOpen] = useState(false);
  /** 用户亲手挑过方案没有 —— 勾「真人」只在没挑过时才换默认（主推≠强制） */
  const schemeTouched = useRef(false);
  /** 人物卡各图位（按方案的 tag 键）。换方案时 tag 对得上的留着，对不上的取下并说明 */
  const [schemeShots, setSchemeShots] = useState<Record<string, Shot>>({});
  /**
   * 两步向导（主人 2026-08-28 二次点名的形状）：**先**选方案 + 做真人授权/跟读，
   * **再**进传图表单。一页摊平的上一版被实测认定"没改"——方案行折叠在图位区里、
   * 真人区沉在两屏之下，用户按老动线走完全程都不会遇到它们。步骤化不是装饰，
   * 是把"先表态，再干活"变成动线本身。
   */
  const [step, setStep] = useState<"type" | "real" | "source" | "form" | "info" | "final">("type");
  /** 人物卡第②屏的来源选择（2026-08-30 主人点名的四步向导）：自己传图 or 素材交给 AI */
  const [lane, setLane] = useState<"upload" | "ai" | null>(null);
  /** AI 车道的素材：主素材图（必）+ 面部近照（选）+ 一句主体描述（选） */
  const [aiBody, setAiBody] = useState<Shot | null>(null);
  const [aiFace, setAiFace] = useState<Shot | null>(null);
  const [aiSubject, setAiSubject] = useState("");
  const [aiBusy, setAiBusy] = useState("");
  /** AI 素材选图口（body/face 复用一个 input） */
  const aiPickRef = useRef<{ which: "body" | "face" }>({ which: "body" });
  const aiFileRef = useRef<HTMLInputElement>(null);
  /** 圈选改图：开在哪一格上（人物卡 tag 键） */
  const [annot, setAnnot] = useState<{ tag: string; frame: string } | null>(null);
  /** 人物卡的方案小窗开没开（第 1 屏点「人物卡」弹出） */
  const [schemePick, setSchemePick] = useState(false);
  /** 授权照片自动填卡面的进行态/结果（铁律八：取失败要整句说，并给退路） */
  const [importMsg, setImportMsg] = useState("");
  /** 真人声明（仅人物卡）。勾了就必须同时勾 consentOk，否则铸卡整句拒（同提取那条路） */
  const [realPerson, setRealPerson] = useState(false);
  const [consentOk, setConsentOk] = useState(false);
  /** 造卡时就做完的肖像授权。卡还没有 id，先攒着，addCards 成功后才落 cardAsset 侧库 */
  const [pendingAsset, setPendingAsset] = useState<{ assetId: string; note: string } | null>(null);
  /** 跟读录到的声音样本。同上，addCards 成功后才落 cardVoice 侧库 */
  const [pendingVoice, setPendingVoice] = useState<{ dataUrl: string; durationSec: number; note: string } | null>(null);

  const [busySlot, setBusySlot] = useState<string | null>(null);
  /** 选图失败：**贴在出事的那一格上**，不是页面底部那条通用红字（见 onFile 的 catch）。
   *  key = 非人物卡的 kind 或人物卡的 tag（两个库的键都是字符串，一份提示态够用） */
  const [slotErr, setSlotErr] = useState<{ key: string; msg: string } | null>(null);
  const [err, setErr] = useState("");
  /** 换卡种时被丢掉的图位（必须说，见 changeType） */
  const [dropped, setDropped] = useState("");
  const [minting, setMinting] = useState(false);
  /** 铸成了、但有图没能存到服务器 —— 停在这一页把话说完，不自动跳走 */
  /**
   * 铸完之后**没有全成**的那个状态。
   *
   * ★★ `kind` 必须分开，两种失败对用户要做的事完全不同（见 account.AddCardsResult.synced）：
   *   · "unsynced" —— **整张卡**没到服务端。远端模式下 persist() 不写 IndexedDB，
   *     它只活在内存，用户下次冷启动就整张没了。这时该给的是**重试**，
   *     绝不能说"卡已经建好了"然后放他安心退出。
   *   · "views" —— 卡在服务端，只是某几张图没挂上。这时才是"去详情页补挂"。
   */
  const [partial, setPartial] = useState<{
    id: string;
    kind: "unsynced" | "views";
    lost: string[];
    reason?: string;
  } | null>(null);
  /**
   * 「配了服务端、但这次会话没连上」。
   *
   * ★★ 这**不是**离线模式，必须与真离线包分开处理 —— 与 account.buyPlan 里那段
   *   「配了服务端、但这次启动没连上 ≠ 这是个没有真钱的离线演示包」是同一条规则。
   *   这种状态下建卡是**必然丢数据**：卡只写内存（persist 在 remoteOn 时不落盘），
   *   而服务器一恢复，account 的联网自愈会走 loadRemoteAssets / reload，
   *   用服务端那份**整体覆盖** db.cards，全仓没有任何一处会把这期间建的卡补 POST 上去。
   *   于是用户拿自己拍的照片做的卡，会在"网终于通了"的那一刻凭空消失。
   *   所以这一页在这种状态下**不让铸**，并说清楚为什么、要他做什么。
   */
  const offlineButConfigured = API_ON && !remote;

  const fileRef = useRef<HTMLInputElement>(null);
  /** 正在为哪一格选图：非人物卡认 kind，人物卡认方案 tag */
  const pickingRef = useRef<{ kind: CardView["kind"] } | { tag: string }>({ kind: "body" });

  const slots = CARD_SLOTS[type];
  const primary = slots[0];
  const tags = useMemo(() => parseTags(tagText), [tagText]);
  const isChar = type === "character";
  const scheme = schemeOf(schemeId) ?? defaultScheme();
  /**
   * 本页实际使用的图位 = 方案图位里**去掉 fromCrop 那些**（2026-08-30 图位数量调研）：
   * fromCrop（原片截图）只在「从视频圈选提卡」那条路上是对照物；本页无论自传图还是
   * AI 生成，源图本来就在用户手里，再摆一格「原片截图」是无意义的第三格。
   * 由此各方案在本页的格数：全身立绘+面部特写 **2 格**（正是方舟指南的人物参考对：
   * 大头照+全身照，多视图反而加剧 ID 漂移）；无面部白模三视图 **3 格**（白模全身进管线、
   * 服装细节锁衣着、三视图是展示卖点）；角色设定规格图 **3 格**（face+body 进管线、
   * 规格稿展示）。数量随方案走，不写死。
   */
  const pageSlots = useMemo(() => scheme.slots.filter((s) => !s.fromCrop), [scheme]);
  /** 人物卡：按方案顺序取第一张已传的图 —— 它就是卡面（与非人物卡"第一格即卡面"同规则） */
  const charCover = isChar ? (pageSlots.map((s) => schemeShots[s.tag]).find(Boolean)?.dataUrl ?? null) : null;
  const declareReal = isChar && realPerson;
  // 路由套着 RequireAuth，进来就有内容，无条件弹（引导来自 origin/main 的 UI 梳理批）
  useAutoGuide("customcard", true);

  /**
   * 换卡种。★ 图位是按卡种给的（人物卡三格、其余两格），换过去没有的那一格**必须
   * 当场说清楚它去哪了** —— 默默丢掉的话，用户传了三张、铸出来只有两张，而他会以为
   * 是铸卡漏了（铁律八）。
   * ★ 名字要按**旧**卡种查（slotLabel(type, k)）：那一格在新卡种里根本不存在，
   *   按新卡种查会被 normalizeSlot 归到主槽，于是"丢了面部特写"被说成"丢了全景主视图"。
   * ★ 对得上的那些（body→body、detail→detail）原样留着：两种卡种下它们都是同一件事
   *   （第一张=主图/卡面，detail=局部），只是叫法不同，重传一遍纯属折腾人。
   */
  function changeType(next: CardType) {
    if (next === type) return;
    // ★ 人物卡（方案库）与其余卡种（kind 库）互不相通，涉及人物卡的切换**什么都不丢**
    //   （另一库原样留着，切回来图还在）——只有非人物卡之间才有"这一格没了"的问题
    if (next !== "character" && type !== "character") {
      const keep = new Set<string>(CARD_SLOTS[next].map((s) => s.kind));
      const gone = (Object.keys(shots) as CardView["kind"][]).filter((k) => shots[k] && !keep.has(k));
      if (gone.length > 0) {
        const kept: Partial<Record<CardView["kind"], Shot>> = {};
        for (const k of Object.keys(shots) as CardView["kind"][]) if (keep.has(k)) kept[k] = shots[k];
        setShots(kept);
        setDropped(
          `${CARD_TYPE_LABELS[next]}没有「${gone.map((k) => slotLabel(type, k)).join("、")}」这一格，` +
            `你传的那张已经取下来了——需要的话换回${CARD_TYPE_LABELS[type]}再传一次。`,
        );
      } else {
        setDropped("");
      }
    } else {
      setDropped("");
    }
    setType(next);
    setErr("");
  }

  /** 换方案：tag 对得上的图留着，对不上的取下**并说明**（与 changeType 同一条纪律） */
  function changeScheme(nextId: string) {
    schemeTouched.current = true;
    const next = schemeOf(nextId) ?? defaultScheme();
    const keep = new Set(next.slots.map((s) => s.tag));
    const gone = Object.keys(schemeShots).filter((t) => !keep.has(t));
    if (gone.length > 0) {
      const kept: Record<string, Shot> = {};
      for (const [t, s] of Object.entries(schemeShots)) if (keep.has(t)) kept[t] = s;
      setSchemeShots(kept);
      setDropped(`「${next.title}」里没有「${gone.join("、")}」这一格，你传的那张已经取下来了——换回原方案还能找回。`);
    } else {
      setDropped("");
    }
    setSchemeId(nextId);
    setSchemeOpen(false);
  }

  /**
   * 把授权素材的照片取来填进方案第一格（= 卡面）。主人两次点名要的"授权完自动用素材照片"。
   * ★ 走服务端代取（api/portrait.fetchPortraitAssetImage）：签名直链不出服务端；
   *   裁切/压制规则仍是 prepareCardImage 唯一实现（与手选同一条路）。
   * ★ 失败不静默：整句原因 + "从相册自己选也一样"的退路（授权时传的照片本来就在相册里）。
   */
  async function importAssetPhoto(assetId: string) {
    setImportMsg("正在把授权照片取来填进卡面…");
    try {
      const blob = await fetchPortraitAssetImage(assetId);
      const file = new File([blob], "授权素材.jpg", { type: blob.type || "image/jpeg" });
      const { blob: prepped, note } = await prepareCardImage(file);
      const dataUrl = await blobToDataUrl(prepped);
      const sc = schemeOf(schemeId) ?? defaultScheme();
      const slot0 = sc.slots[0];
      setSchemeShots((prev) => ({
        ...prev,
        [slot0.tag]: { dataUrl, fileName: "授权素材（自动填入）", ...(note ? { note } : {}) },
      }));
      setImportMsg(`✅ 已把授权照片填进「${slot0.tag}」（它就是卡面）——下一步里可以换`);
    } catch (e) {
      setImportMsg(
        `没取到授权照片（${(e instanceof Error ? e.message : String(e)).slice(0, 80)}）——授权时传的照片就在你相册里，下一步从相册选一样`,
      );
    }
  }

  function pick(target: { kind: CardView["kind"] } | { tag: string }) {
    pickingRef.current = target;
    setErr("");
    setSlotErr(null); // 上一次的失败提示不该跨到这一次
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    const target = pickingRef.current;
    const key = "kind" in target ? target.kind : target.tag;
    if (!file || busySlot) return;
    setBusySlot(key);
    setErr("");
    setSlotErr(null);
    try {
      // 比例/大小的规则只有这一处（data/cardViews.prepareCardImage），
      // 与详情页「+ 图位」共用；这一页只负责把它编成 dataURL 挂上去
      const { blob, note } = await prepareCardImage(file);
      const dataUrl = await blobToDataUrl(blob);
      const shot: Shot = { dataUrl, fileName: file.name, ...(note ? { note } : {}) };
      if ("kind" in target) {
        setShots((prev) => ({ ...prev, [target.kind]: shot }));
      } else {
        setSchemeShots((prev) => ({ ...prev, [target.tag]: shot }));
      }
    } catch (e) {
      // ★ 必须显示，而且要显示在**这一格里**（页面底部那条红字隔着两整节，手机上看不见）。
      //   这条路会解码、会裁、会编码，失败原因（不是图片 / 超 20MB / 太小 AI 认不出）
      //   都是用户能据此改正的话，吞掉就只剩"点了没反应"（铁律八）
      setSlotErr({ key, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusySlot(null);
    }
  }

  function removeShot(key: { kind: CardView["kind"] } | { tag: string }) {
    if ("kind" in key) {
      setShots((prev) => {
        const next = { ...prev };
        delete next[key.kind];
        return next;
      });
    } else {
      setSchemeShots((prev) => {
        const next = { ...prev };
        delete next[key.tag];
        return next;
      });
    }
    setErr("");
  }

  /** AI 车道整套价：逐格出图（schemeCost，只数生成型格）+ 一次看图写文案的对话。
   *  报价印在按钮上、实扣分两笔在各自成功后各扣一半——同一对常量，不另拼数（铁律六） */
  const aiPrice = schemeCost(pageSlots) + CHAT_TURN_TOKENS;

  /** AI 车道：素材 → 按方案逐格出图 → 看图写人物信息。失败整句说、成功才扣（铁律八） */
  async function runAiForge() {
    if (!aiBody || aiBusy) return;
    if (AI_REAL && !canAfford(aiPrice)) {
      const w = walletOf();
      setErr(`AI 生成整套约 ${fmtTokens(aiPrice)} token，余额 ${fmtTokens((w?.plan ?? 0) + (w?.addon ?? 0))} 不够——去「我的」页充值，或改选「自己上传图片」（不花钱）`);
      return;
    }
    setErr("");
    setAiBusy("准备中…");
    try {
      const out = await portraitViews({
        scheme: { ...scheme, slots: pageSlots },
        bodyCrop: aiBody.dataUrl,
        faceCrop: aiFace?.dataUrl ?? null,
        subject: aiSubject.trim() || undefined,
        onProgress: setAiBusy,
      });
      if (AI_REAL) spendTokens(schemeCost(pageSlots)); // 图那一半：出齐才扣
      const shots: Record<string, Shot> = {};
      for (const v of out) shots[v.tag] = { dataUrl: v.dataUrl, fileName: "AI 生成" };
      setSchemeShots(shots);
      // ── 文案那一半：看图写人物信息（AI 车道连人物信息一起生成，主人点名）──
      setAiBusy("按素材撰写人物信息…");
      try {
        const raw = AI_REAL
          ? await chatVision(
              "你是卡牌文案师。只输出一个 JSON 对象，不要输出任何其他文字。",
              `看这张角色素材图${aiSubject.trim() ? `（用户描述：${aiSubject.trim().slice(0, 60)}）` : ""}，写：` +
                `{"name":"卡名≤${NAME_MAX}字","summary":"一句话简介≤${SUMMARY_MAX}字",` +
                `"info":"复刻这个角色的要点（发型发色/眼睛/服装/气质），≤200字","tags":["≤${TAG_MAX}个标签"]}`,
              [aiBody.dataUrl],
            )
          : JSON.stringify({ name: "演示角色", summary: "演示档生成的占位文案（配好 Key 后按素材图撰写）", info: aiSubject.trim(), tags: [] });
        const j = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as {
          name?: string; summary?: string; info?: string; tags?: string[];
        };
        if (AI_REAL) spendTokens(CHAT_TURN_TOKENS); // 文案那一半：解析成功才扣
        if (j.name) setName(String(j.name).slice(0, NAME_MAX));
        if (j.summary) setSummary(String(j.summary).slice(0, SUMMARY_MAX));
        if (j.info) setInfo(String(j.info).slice(0, INFO_MAX));
        if (Array.isArray(j.tags) && j.tags.length) setTagText(j.tags.slice(0, TAG_MAX).join(" "));
      } catch {
        // 文案没写成不拦路（图已经在手），这一半也不扣钱——到人物信息那一步自己写
        setErr("图生成好了，但人物信息没写成（这一半没扣钱）——下一步自己填就行");
      }
      setStep("form");
    } catch (e) {
      setErr(`形象图没画成：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}——一分钱没扣，可以再试或改选自己传图`);
    } finally {
      setAiBusy("");
    }
  }

  /** 圈选改一格：标注图 + 一句要求 → i2i 重画（ONE_IMAGE，成功才扣） */
  async function refineSlot(tag: string, annotated: string, req: string) {
    const slot = pageSlots.find((s) => s.tag === tag);
    const shot = schemeShots[tag];
    if (!slot || !shot || busySlot) return;
    if (AI_REAL && !canAfford(ONE_IMAGE)) {
      setSlotErr({ key: tag, msg: `改一次图要 ${fmtTokens(ONE_IMAGE)} token，余额不够——去「我的」页充值` });
      return;
    }
    setBusySlot(tag);
    setSlotErr(null);
    try {
      const next = await refineCardImage({ annotated, req, size: slotSize(slot) });
      if (AI_REAL) spendTokens(ONE_IMAGE);
      setSchemeShots((prev) => ({ ...prev, [tag]: { dataUrl: next, fileName: shot.fileName, note: "已按圈选修改" } }));
    } catch (e) {
      setSlotErr({ key: tag, msg: `没改成：${(e instanceof Error ? e.message : String(e)).slice(0, 90)}（没扣钱）` });
    } finally {
      setBusySlot(null);
    }
  }

  // 还缺什么。★ 灰按钮 + 一句"还缺：…"是一体的：只灰不说等于告诉用户功能坏了
  const missing: string[] = [];
  if (isChar) {
    if (!charCover) missing.push("至少一张图（第一张有图的格子就是卡面）");
  } else if (!shots[primary.kind]) {
    missing.push(`${primary.label}（就是卡面）`);
  }
  if (!name.trim()) missing.push("卡名");
  if (!summary.trim()) missing.push("一句话简介");
  // 真人声明连着协议勾选（与提取那条路同一条规则，这里进 missing 让灰按钮把话说全）
  if (declareReal && !consentOk) missing.push("肖像同意的确认（勾了「真人」就必须勾它）");
  // ★ 连不上服务器时**不让铸**：建出来必然丢（见 offlineButConfigured）。
  //   拦在这里而不是拦在 mint() 里，是为了让灰按钮下面那行能把原因说出来。
  const ready = missing.length === 0 && !offlineButConfigured;

  async function mint() {
    if (!ready || minting) return;
    setMinting(true);
    setErr("");
    setPartial(null);
    try {
      const id = uid("card");
      // ★ 顺序**照图位表**（重要性降序），不照用户上传的先后：出片管线取的是
      //   viewsOf() 的存储顺序（详情页 pipelineNoteFor 说的就是这件事），
      //   按上传时间排会让"先手滑传了局部细节"的人把主视图挤到第 2 位。
      //   人物卡照**方案**的图位顺序，同一条理由。
      let cover: string;
      let views: CardView[];
      if (isChar) {
        const picked = pageSlots.map((s) => ({ slot: s, shot: schemeShots[s.tag] })).filter((x) => !!x.shot);
        cover = picked[0].shot.dataUrl;
        // ★★ kind 由 role 反推**并且必须照写**（types.roleToKind）：跨仓冻结三值，
        //   老服务端/老客户端只认它。role/tag 是新增位（与提取那条路 saveCard 逐字同规则）
        views = picked.map(({ slot, shot }) => ({
          kind: roleToKind(slot.role),
          role: slot.role,
          tag: slot.tag,
          url: shot.dataUrl,
          ...(shot.note ? { note: shot.note } : {}),
        }));
      } else {
        const picked = slots.map((s) => ({ slot: s, shot: shots[s.kind] })).filter((x) => !!x.shot);
        cover = picked[0].shot!.dataUrl;
        views = picked.map(({ slot, shot }) => ({
          kind: slot.kind,
          url: shot!.dataUrl,
          ...(shot!.note ? { note: shot!.note } : {}),
        }));
      }
      const card: Card = {
        id,
        type,
        name: name.trim().slice(0, NAME_MAX),
        summary: summary.trim().slice(0, SUMMARY_MAX),
        // ★ 第一张图**同时就是卡面**（与最低档 AI 铸卡的"一图两用"是同一条规则）。
        //   这里挂的是 dataURL —— 与本地铸的卡完全一样，Card.cover 本来就是 dataURL。
        cover,
        // ★ 只有一张图时 viewsOf() 的兜底给出的是**同一份结果**（卡面即主图参考），
        //   写 views 纯属冗余 —— 与 ai/real.forgeSlots 末尾那个判断同源。
        // ★★ 但**带 note 的那张必须写**：note 只挂在 CardView 上，兜底出来的那条没有它。
        //   不写的话，"我们把你 4:1 的长图居中裁成 3:1 了"这句话在上传时说过一次就永远消失，
        //   用户日后发现构图被切掉，在详情页放大层里找不到任何解释（改了用户的图就必须说）。
        //   forgeSlots 那边没这个问题：AI 画的图不会被裁，本来就不带 note。
        ...(views.length > 1 || views.some((v) => v.note) ? { views } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        // 用户填的那段就是详情页「<类型>信息」那一块。没填就**不写**这个字段——
        // 详情页会如实说"这张卡没留下铸造时的提示词，下面是按同款格式现补的一份"
        ...(info.trim() ? { genPrompt: info.trim().slice(0, INFO_MAX) } : {}),
        // 真人声明只在为 true 时写（缺省 = 非真人，读侧判否定，见 types.Card.realPerson）
        ...(declareReal ? { realPerson: true } : {}),
        // ⚠ imageTier 故意不写：那是**AI 出图档位**，这条路一张图都没让 AI 画。
        //   随手填一个会让详情页/报价按"精绘档"去解读一张纯手工卡。
      };

      // ★★ dataURL 直接交给 addCards 就行 —— 转存成永久地址是**它**的活
      //   （见 data/account.addCards 的 ★★：POST → 转存 → PATCH，顺序有讲究）。
      //   这一页**不许**自己去调 uploads/publishAssets 再写一条上传路径（铁律六）。
      const r = await addCards([card]);
      if (r.added.length === 0) {
        // addCards 永不 reject：没入库只有一种可能——账号库里没有当前用户（登录态失效）
        setErr("没能存进你的卡片库：登录态可能已经失效。重新登录后再点一次（这一页填的内容还在）。");
        return;
      }
      // ★ 判据是 addCards 显式给的 `synced`，**不是**"哪个字段有值"。
      //   靠字段猜的话，POST 挂了（卡根本没上去）会被说成"只是有图没传上"。
      if (!r.synced) {
        setPartial({ id, kind: "unsynced", lost: [], reason: r.reason });
        return;
      }
      // 造卡时攒下的授权素材与声音样本 —— addCards 成了才写（卡没入库，挂上去就是孤儿）。
      // 侧库只在本机，与 synced/lostViews 无关：卡到没到服务端都要写，写在跳转之前。
      if (declareReal && pendingAsset) {
        await saveAsset(id, { assetId: pendingAsset.assetId, scope: "private", note: pendingAsset.note });
      }
      if (isChar && pendingVoice) {
        await saveVoice(id, pendingVoice);
      }
      if (r.lostViews.length > 0) {
        setPartial({ id, kind: "views", lost: r.lostViews, reason: r.reason });
        return;
      }
      // 发布/加图/删图详情页都已经有了，这一页不再实现一遍（铁律六）
      nav(`/card/${id}`, { replace: true });
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">自己传图做卡片</h1>
        <HelpButton tour="customcard" />
        <span className="ml-auto text-[10px] text-slate-500">
          {step === "type"
            ? "选卡种"
            : step === "real"
              ? "真人素材"
              : step === "source"
                ? "① 选来源"
                : step === "form"
                  ? isChar ? "② 图位预览" : "传图与信息"
                  : step === "info"
                    ? "③ 人物信息"
                    : "④ 定名完成"}
        </span>
      </div>

      {/* ── 第 1 屏：只有五个卡种（主人点名的形状：无文案、约八成屏、不滚动）。
          2026-08-28 二改（主人点名"符合 app 风格"）：五条纯色平板 → 五张**塔罗卡面**
          （TarotCard 全仓同款卡框）；同日三改：封面从市场种子卡换成**工坊铸卡小窗同一套**
          看板娘导览图（types.CARD_TYPE_COVERS，主人点名两窗要一致）。
          说明性文字仍然全在引导里（tours 的 customcard，右上角 ? 随时重看） */}
      {step === "type" && (
        <>
          <div data-guide="cc-type" className="flex h-[78vh] flex-col gap-3">
            {/* 2+2+1 三行：第 5 张独居一行自动居中。卡由**行高**定尺寸（h-full + 2:3），
                max-w 兜住极窄屏（320px 宽时按宽收缩，TarotCard 自身的 aspect 保比例） */}
            {[CARD_TYPES.slice(0, 2), CARD_TYPES.slice(2, 4), CARD_TYPES.slice(4)].map((row, ri) => (
              <div key={ri} className="flex min-h-0 flex-1 items-center justify-center gap-3">
                {row.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      changeType(t);
                      // 人物卡：先弹方案小窗（看图挑）；其余卡种没有方案，直进表单
                      if (t === "character") setSchemePick(true);
                      else setStep("form");
                    }}
                    className="flex aspect-[2/3] h-full max-w-[46%] items-center transition-transform active:scale-[0.97]"
                  >
                    <TarotCard cover={CARD_TYPE_COVERS[t]} title={CARD_TYPE_LABELS[t]} type={t} size="md" />
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* 方案小窗：四张**只有示例图 + 名字**的牌（主人点名：不要简介；示例图是
              design/gen-scheme-examples.mjs 出的**真实 Seedream 产出**，不是美工示意）。
              题名压在图上的底部渐变里（与 TarotCard 同一手法）——clean 那张是白底，
              没有渐变垫底白字会看不见。无示例图的自定义方案退回占位 emoji。
              portal 到 body：与全仓浮层同一条纪律（祖先 transform/blur 会造包含块） */}
          {schemePick &&
            createPortal(
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
                onClick={() => setSchemePick(false)}
              >
                <div className="grid w-full max-w-sm grid-cols-2 gap-3" onClick={(e) => e.stopPropagation()}>
                  {listSchemes("character").map((sc) => (
                    <button
                      key={sc.id}
                      onClick={() => {
                        changeScheme(sc.id);
                        setRealPerson(false);
                        setConsentOk(false);
                        setSchemePick(false);
                        setStep("source");
                      }}
                      className="relative overflow-hidden rounded-2xl border border-slate-600 bg-panel transition-transform active:scale-[0.97]"
                    >
                      {sc.examples?.[0] ? (
                        <img src={sc.examples[0]} alt={sc.title} className="aspect-[3/4] w-full object-cover" />
                      ) : (
                        <span className="flex aspect-[3/4] w-full items-center justify-center bg-ink/60 text-5xl">
                          {SCHEME_EMOJI[sc.id] ?? "🎴"}
                        </span>
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-2 pt-6 text-center text-xs font-semibold text-slate-100">
                        {sc.title}
                      </span>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      // 真人路的图位用「全身立绘+面部特写」（传的是真人照片，正合适；
                      // 出片端合规靠 asset://，不靠无脸——那是 AI 出图路的主推）
                      const clean = listSchemes("character").find((s) => s.builtin && !s.faceless);
                      if (clean) changeScheme(clean.id);
                      setRealPerson(true);
                      setSchemePick(false);
                      setStep("real");
                    }}
                    className="relative overflow-hidden rounded-2xl border border-sky-500/60 bg-panel transition-transform active:scale-[0.97]"
                  >
                    {/* 示意图也是自己生成的（gen-scheme-examples.mjs 第四张）：**虚构**人像 +
                        识别框。刻意不搬火山控制台那张官方人像——那是火山的版权素材 */}
                    <img src="/schemes/realface.webp" alt="真人素材扫脸认证" className="aspect-[3/4] w-full object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2 pb-2 pt-6 text-center text-xs font-semibold text-sky-200">
                      真人素材扫脸认证
                    </span>
                  </button>
                </div>
              </div>,
              document.body,
            )}
        </>
      )}

      {/* ── 真人素材页（选「真人素材扫脸认证」才进）：肖像授权 + 跟读录音 + 传本地音频。
          跟读只在这一页有（主人点名）；其它方案在表单里只有传本地音频。 */}
      {step === "real" && (
        <>
          <button
            onClick={() => {
              setStep("type");
              setSchemePick(true);
            }}
            className="mb-3 flex items-center gap-1 text-[11px] text-slate-400"
          >
            <Icon name="back" size={12} />
            重选方案
          </button>
          <label className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-300">
            <input
              type="checkbox"
              checked={consentOk}
              onChange={(e) => {
                setConsentOk(e.target.checked);
                if (e.target.checked) setErr("");
              }}
              className="mt-0.5 h-4 w-4 flex-none accent-brand"
            />
            我确认已依法取得画面中人物对使用其肖像生成内容的同意，相应责任由我承担
          </label>
          <div className="mt-3 rounded-xl border border-slate-700/70 bg-panel p-2.5">
            {pendingAsset ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5">
                <span className="min-w-0">
                  <span className="block text-[10px] text-emerald-200">已接上授权素材，铸卡时一并绑定</span>
                  <span className="block truncate font-mono text-[9px] text-emerald-300/80">{pendingAsset.assetId}</span>
                </span>
                <button
                  onClick={() => {
                    setPendingAsset(null);
                    setImportMsg("");
                  }}
                  className="flex-none text-[10px] text-slate-500"
                >
                  取消
                </button>
              </div>
            ) : (
              <PortraitAuthPanel
                onBound={(assetId, note) => {
                  setPendingAsset({ assetId, note });
                  // 授权接上那一刻就把照片填进卡面（服务端代取，失败整句说并给退路）
                  void importAssetPhoto(assetId);
                }}
              />
            )}
            {importMsg && <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400">{importMsg}</p>}
          </div>
          <div className="mt-3 space-y-2">
            {pendingVoice ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] text-emerald-200">
                    🔊 已录 {pendingVoice.durationSec.toFixed(1)}s（铸卡时存进这张卡）
                  </span>
                  <audio src={pendingVoice.dataUrl} controls className="mt-1 h-8 w-full" />
                </span>
                <button onClick={() => setPendingVoice(null)} className="flex-none text-[10px] text-slate-500">
                  重来
                </button>
              </div>
            ) : (
              <>
                <VoiceRecorder onDone={setPendingVoice} />
                <VoiceUploadButton onDone={setPendingVoice} />
              </>
            )}
          </div>
          <button onClick={() => setStep("source")} className="mt-4 w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink">
            下一步：传图与信息 ›
          </button>
        </>
      )}

      {/* ── 来源选择（人物卡四步向导 · 第①步，2026-08-30 主人点名）：
          自己上传图片（不花钱）或把素材交给 AI 按方案逐格生成（连人物信息一起写） ── */}
      {step === "source" && (
        <>
          <button
            onClick={() => setStep(realPerson ? "real" : "type")}
            className="mb-3 flex items-center gap-1 text-[11px] text-slate-400"
          >
            <Icon name="back" size={12} />
            返回：{realPerson ? "真人素材" : "选卡种"}
          </button>
          <p className="mb-2 text-[11px] text-slate-400">
            方案「{scheme.title}」· {pageSlots.length} 个图位——这些图从哪来？
          </p>
          <div className="space-y-2.5">
            <button
              onClick={() => { setLane("upload"); setStep("form"); }}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-600 bg-panel px-4 py-4 text-left"
            >
              <span className="flex-none text-xl">🖼</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-100">自己上传图片</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">逐格传自己的图 · 不花钱</span>
              </span>
              <span className="ml-auto flex-none text-slate-500">›</span>
            </button>
            <button
              onClick={() => setLane("ai")}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-4 text-left ${lane === "ai" ? "border-brand/70 bg-brand/10" : "border-slate-600 bg-panel"}`}
            >
              <span className="flex-none text-xl">✨</span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-100">传素材，AI 生成图位</span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
                  按方案逐格出图 + 撰写人物信息 · {AI_REAL ? `约 ${fmtTokens(aiPrice)} token` : "演示档"}
                </span>
              </span>
              <span className="ml-auto flex-none text-slate-500">›</span>
            </button>
          </div>
          {lane === "ai" && (
            <div className="mt-3 rounded-xl border border-slate-700 bg-panel p-3">
              <div className="flex gap-2.5">
                {(["body", "face"] as const).map((w) => {
                  const shot = w === "body" ? aiBody : aiFace;
                  return (
                    <button
                      key={w}
                      onClick={() => { aiPickRef.current = { which: w }; aiFileRef.current?.click(); }}
                      disabled={!!aiBusy}
                      className="relative h-28 w-20 flex-none overflow-hidden rounded-lg border border-dashed border-slate-600 bg-ink/60 disabled:opacity-50"
                    >
                      {shot ? (
                        <img src={shot.dataUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
                          <Icon name="plus" size={16} />
                          <span className="px-1 text-center text-[9px] leading-tight">{w === "body" ? "主素材图（必）" : "面部近照（选）"}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
                <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-slate-500">
                  主素材图 = 这个角色最完整的一张（照片/截图/画都行）；有面部近照的话脸会锁得更准。
                  画风严格跟随素材（照片出写实、插画出同风格）。
                </p>
              </div>
              <input
                value={aiSubject}
                onChange={(e) => setAiSubject(e.target.value)}
                maxLength={60}
                placeholder="一句主体描述（选）：例「银白长发的星星发夹少女」"
                className="mt-2 w-full rounded-lg border border-slate-700 bg-ink/50 px-2.5 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
              />
              <button
                onClick={() => void runAiForge()}
                disabled={!aiBody || !!aiBusy}
                title={!aiBody ? "先传主素材图" : undefined}
                className="mt-2.5 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
              >
                {aiBusy || `✨ 生成 ${pageSlots.length} 张图位与人物信息${AI_REAL ? `（${fmtTokens(aiPrice)}）` : ""}`}
              </button>
            </div>
          )}
          <input
            ref={aiFileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              void (async () => {
                try {
                  const prep = await prepareCardImage(f);
                  const dataUrl = await blobToDataUrl(prep.blob);
                  const shot: Shot = { dataUrl, fileName: f.name, ...(prep.note ? { note: prep.note } : {}) };
                  if (aiPickRef.current.which === "body") setAiBody(shot);
                  else setAiFace(shot);
                  setErr("");
                } catch (err2) {
                  setErr(err2 instanceof Error ? err2.message : String(err2));
                }
              })();
            }}
          />
          {err && <p className="mt-3 text-[11px] leading-relaxed text-rose-400">{err}</p>}
        </>
      )}

      {(step === "form" || step === "info" || step === "final") && (
        <>
      {/* 表单顶部的回程：人物卡按四步向导逐级回，非人物卡照旧回选卡种 */}
      <button
        onClick={() =>
          setStep(
            isChar
              ? step === "final"
                ? "info"
                : step === "info"
                  ? "form"
                  : "source"
              : "type",
          )
        }
        className="mb-3 flex items-center gap-1 text-[11px] text-slate-400"
      >
        <Icon name="back" size={12} />
        返回：{isChar ? (step === "final" ? "人物信息" : step === "info" ? "图位预览" : "选来源") : "选卡种"}
      </button>

      {dropped && <p className="mb-3 text-[11px] leading-relaxed text-amber-400">{dropped}</p>}

      {/* ── 卡名 + 简介（右边挂实时卡面预览）。人物卡在第④步（定名完成）── */}
      {(!isChar || step === "final") && (
      <section className="mb-4 flex gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="mb-1.5 text-xs font-semibold text-slate-300">{isChar ? "卡名与简介" : "① 卡名与简介"}</h2>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder={`卡名（最多 ${NAME_MAX} 字）`}
            className="mb-2 w-full rounded-xl border border-slate-700 bg-panel px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            maxLength={SUMMARY_MAX}
            placeholder="一句话简介：这张卡是谁 / 是什么地方 / 是什么东西"
            className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <div className="mt-0.5 text-right text-[10px] text-slate-600">
            {summary.length}/{SUMMARY_MAX}
          </div>
        </div>
        {/* 实时卡面预览：卡框会盖掉四周一圈、题名压在底部，先看见再决定要不要换图 */}
        <div className="w-24 flex-none">
          <TarotCard
            cover={isChar ? charCover : (shots[primary.kind]?.dataUrl ?? null)}
            title={name.trim() || "未命名"}
            sub={CARD_TYPE_LABELS[type]}
            type={type}
          />
          <p className="mt-1 text-center text-[9px] leading-tight text-slate-500">卡面预览</p>
        </div>
      </section>
      )}

      {/* ── 图位（人物卡 = 第②步：预览 + 圈选改图）── */}
      {(!isChar || step === "form") && (
      <section data-guide="cc-slots" className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">
          {!isChar && "② "}图位（{isChar ? `按方案「${scheme.title}」· ${pageSlots.length} 格` : `${CARD_TYPE_LABELS[type]}共 ${slots.length} 格`}）
        </h2>

        {/* 人物卡：图位结构由**提示词方案**定（与「从视频提取」同一套方案库）。
            这一页不出图，方案只决定几格、各叫什么 —— 你自己往里传图。 */}
        {isChar && (
          <div className="mb-2 space-y-1.5">
            <button
              onClick={() => setSchemeOpen((v) => !v)}
              disabled={busySlot !== null}
              className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-panel px-2.5 py-2 text-left disabled:opacity-40"
            >
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-slate-200">
                  方案：{scheme.title}
                  {scheme.faceless && <span className="ml-1 text-emerald-300">· 无脸</span>}
                </span>
                <span className="block truncate text-[10px] text-slate-500">{scheme.intro}</span>
              </span>
              <span className="ml-2 flex-none text-[10px] text-slate-500">{schemeOpen ? "收起" : "换一套"}</span>
            </button>
            {schemeOpen && (
              <div className="space-y-1 rounded-lg border border-slate-700/70 bg-ink/40 p-1.5">
                {listSchemes("character").map((sc) => (
                  <button
                    key={sc.id}
                    onClick={() => changeScheme(sc.id)}
                    className={`w-full rounded-md px-2 py-1.5 text-left ${
                      sc.id === schemeId ? "bg-brand/15 ring-1 ring-brand/40" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[11px] font-semibold text-slate-200">{sc.title}</span>
                      {sc.faceless && (
                        <span className="flex-none rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] text-emerald-300">无脸</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{sc.intro}</span>
                  </button>
                ))}
                <p className="px-2 pb-1 text-[9px] leading-relaxed text-slate-600">
                  自建方案 / 从市场装新方案在工坊「从视频提取卡片」里做，装好这里就能选。
                </p>
              </div>
            )}
          </div>
        )}

        {isChar ? (
          <div className="space-y-2">
            {pageSlots.map((s, i) => {
              const shot = schemeShots[s.tag];
              // "第一张有图的就是卡面"：没图时按方案顺序把第一格标成卡面位
              const coverIdx = pageSlots.findIndex((x) => schemeShots[x.tag]);
              const isCover = coverIdx === -1 ? i === 0 : i === coverIdx;
              return (
                <div key={s.tag} className="flex gap-3 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                  <button
                    onClick={() => pick({ tag: s.tag })}
                    disabled={busySlot !== null}
                    className={`relative h-24 w-[4.5rem] flex-none overflow-hidden rounded-lg border bg-ink/60 disabled:opacity-50 ${
                      shot ? "border-slate-600" : isCover ? "border-dashed border-brand/60" : "border-dashed border-slate-600"
                    }`}
                  >
                    {shot ? (
                      <img src={shot.dataUrl} alt={s.tag} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
                        <Icon name="plus" size={18} />
                        <span className="text-[10px]">{busySlot === s.tag ? "处理中…" : "选图"}</span>
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200">{s.tag}</span>
                      {isCover && (
                        <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
                          {shot ? "卡面" : "第一张 · 同时就是卡面"}
                        </span>
                      )}
                    </div>
                    {/* 方案里这一格的出图提示词当"参照"给用户看：告诉他该传一张什么样的图。
                        这一页不出图，所以它只是说明文字，不进任何请求 */}
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{s.prompt}</p>
                    {slotErr?.key === s.tag && <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{slotErr.msg}</p>}
                    {shot && (
                      <>
                        <p className="mt-1 truncate text-[10px] text-slate-500">{shot.fileName}</p>
                        {shot.note && <p className="mt-0.5 text-[10px] leading-relaxed text-amber-400">{shot.note}</p>}
                        <div className="mt-1 flex gap-3">
                          <button
                            onClick={() => pick({ tag: s.tag })}
                            disabled={busySlot !== null}
                            className="text-[11px] text-brand disabled:opacity-50"
                          >
                            换一张
                          </button>
                          <button
                            onClick={() => removeShot({ tag: s.tag })}
                            disabled={busySlot !== null}
                            className="text-[11px] text-rose-400 disabled:opacity-50"
                          >
                            移除
                          </button>
                          <button
                            onClick={() => setAnnot({ tag: s.tag, frame: shot.dataUrl })}
                            disabled={busySlot !== null}
                            className="text-[11px] text-brand disabled:opacity-50"
                          >
                            {busySlot === s.tag ? "改图中…" : `⭕ 圈选改图${AI_REAL ? `（${fmtTokens(ONE_IMAGE)}）` : ""}`}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="space-y-2">
          {slots.map((s, i) => {
            const shot = shots[s.kind];
            const isPrimary = i === 0;
            return (
              <div key={s.kind} className="flex gap-3 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                <button
                  onClick={() => pick({ kind: s.kind })}
                  disabled={busySlot !== null}
                  className={`relative h-24 w-[4.5rem] flex-none overflow-hidden rounded-lg border bg-ink/60 disabled:opacity-50 ${
                    shot ? "border-slate-600" : isPrimary ? "border-dashed border-brand/60" : "border-dashed border-slate-600"
                  }`}
                >
                  {shot ? (
                    <img src={shot.dataUrl} alt={s.label} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-slate-500">
                      <Icon name="plus" size={18} />
                      <span className="text-[10px]">{busySlot === s.kind ? "处理中…" : "选图"}</span>
                    </span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-200">{s.label}</span>
                    {isPrimary ? (
                      <span className="rounded-full bg-brand/20 px-1.5 py-0.5 text-[9px] font-semibold text-brand">
                        必填 · 同时就是卡面
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[9px] text-slate-400">选填</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">锁住{s.locks}。</p>
                  {isPrimary && (
                    // ★ "一图两用"必须写明白：与最低档 AI 铸卡是同一条规则，
                    //   不说的话用户会以为卡面是另外一张、还要再传一次。
                    //   2:3 卡框怎么摆那半句在引导里（tours 的 customcard 第二步）
                    <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                      这一张既当卡面，也当这张卡的主形象参考。
                    </p>
                  )}
                  {/* ★★ 选图失败的话必须显示在**出事的这一格里**。原来只写进页面底部那个 err，
                      而那儿隔着「<类型>信息」和「标签」两整节 —— 手机上用户看到的就是
                      "点了没反应"，解释在两屏之下（铁律八）。 */}
                  {slotErr?.key === s.kind && (
                    <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{slotErr.msg}</p>
                  )}
                  {shot && (
                    <>
                      <p className="mt-1 truncate text-[10px] text-slate-500">{shot.fileName}</p>
                      {/* ★ 我们裁过用户的图就必须当面说（prepareCardImage 给的 note） */}
                      {shot.note && <p className="mt-0.5 text-[10px] leading-relaxed text-amber-400">{shot.note}</p>}
                      <div className="mt-1 flex gap-3">
                        <button
                          onClick={() => pick({ kind: s.kind })}
                          disabled={busySlot !== null}
                          className="text-[11px] text-brand disabled:opacity-50"
                        >
                          换一张
                        </button>
                        <button
                          onClick={() => removeShot({ kind: s.kind })}
                          disabled={busySlot !== null}
                          className="text-[11px] text-rose-400 disabled:opacity-50"
                        >
                          移除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
        {/* ★★ 铁律八：别让人以为"传满就一定都生效"。但**判据只有一处**
            （ai/real.refUsedFlags，详情页据它逐张标「出片用 / 仅展示」），
            所以这里只说"不是每张都进"并把人指过去，不在这儿把规则重念一遍（铁律六）——
            重念的那一份迟早会和管线分叉，而分叉的正是花了钱的那半句。 */}
        {/* 两段处理规则（自动压缩 / 比例裁切 / 出片时取几张）搬进了引导第三步——
            页面上只留"不是每张都用"这一句最防误解的。真裁了图时那一格的 note 自己会说。
            ★ 引导里那个比例数同样从 utils/image 的 REF_MAX_RATIO 插值，不手打（方舟硬约束） */}
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          出片时<span className="text-slate-400">不是每张都会喂进模型</span>——详情页会逐张标出
          「出片用 / 仅展示」，那里是唯一的判据。
        </p>
        {isChar && (
          <button
            onClick={() => setStep("info")}
            disabled={busySlot !== null || !charCover}
            title={!charCover ? "至少给一格图（第一张有图的就是卡面）" : undefined}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
          >
            下一步：人物信息 ›
          </button>
        )}
        {isChar && !charCover && (
          <p className="mt-1 text-center text-[10px] text-slate-500">至少给一格图，这颗键才亮（第一张有图的就是卡面）</p>
        )}
      </section>
      )}

      {/* 真人/授权/声音都在第 1 步表过态了，这里只留一行事实摘要（想改就返回上一步） */}
      {isChar && step === "final" && (realPerson || pendingAsset || pendingVoice) && (
        <p className="mb-4 rounded-lg border border-slate-700/70 bg-panel px-2.5 py-2 text-[10px] leading-relaxed text-slate-400">
          {realPerson ? "已声明真人" : ""}
          {pendingAsset ? `${realPerson ? " · " : ""}授权素材已接上（铸卡时绑定）` : ""}
          {pendingVoice ? `${realPerson || pendingAsset ? " · " : ""}已录音 ${pendingVoice.durationSec.toFixed(1)}s` : ""}
          {" —— 要改就"}
          <button onClick={() => setStep(isChar && realPerson ? "real" : "type")} className="text-brand">
            返回上一步
          </button>
        </p>
      )}

      {/* ── 「<类型>信息」（人物卡 = 第③步）── */}
      {(!isChar || step === "info") && (
      <section data-guide="cc-info" className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">{!isChar && "③ "}{CARD_INFO_LABELS[type]}（{isChar && lane === "ai" ? "AI 已按素材写好，可随意改" : "选填"}）</h2>
        <textarea
          value={info}
          onChange={(e) => setInfo(e.target.value)}
          rows={4}
          maxLength={INFO_MAX}
          placeholder={
            type === "character"
              ? "例：白裙短发的海边少女，左耳一枚贝壳耳坠，安静但固执；画风为二次元厚涂"
              : type === "style"
                ? "例：水墨留白，淡墨皴擦，大面积留白，边缘晕染"
                : "把这张卡的样子写具体：造型、材质、配色、光线……"
          }
          className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2 text-xs leading-relaxed text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        <div className="mt-0.5 flex items-start justify-between gap-2">
          {/* "不填会怎样"那句在引导第四步——选填两个字本身已经说了可跳过 */}
          <p className="text-[10px] leading-relaxed text-slate-500">
            <span className="text-slate-400">AI 复刻这张卡的画面 / 建模时会读这段</span>，写得越具体越像。
          </p>
          <span className="flex-none text-[10px] text-slate-600">
            {info.length}/{INFO_MAX}
          </span>
        </div>
        {isChar && (
          <button
            onClick={() => setStep("final")}
            className="mt-3 w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink"
          >
            下一步：定名与铸卡 ›
          </button>
        )}
      </section>
      )}

      {/* ── 标签（人物卡并入第④步）── */}
      {(!isChar || step === "final") && (
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">{!isChar && "④ "}标签（选填）</h2>
        <input
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder={`用空格或逗号分隔，最多 ${TAG_MAX} 个`}
          className="w-full rounded-xl border border-slate-700 bg-panel px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
        />
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-700/70 px-2 py-0.5 text-[10px] text-slate-300">
                #{t}
              </span>
            ))}
          </div>
        )}
      </section>
      )}

      {err && <p className="mb-2 text-[11px] leading-relaxed text-rose-400">{err}</p>}

      {/* 没有全成：**停在这儿**把话说完，不自动跳走 —— 跳走那段话就没人读得到 */}
      {(!isChar || step === "final") && (
        <>
      {partial?.kind === "unsynced" && (
        <div className="mb-3 rounded-xl border border-rose-500/50 bg-rose-500/10 p-3">
          <p className="text-xs font-semibold text-rose-200">这张卡没能存到服务器</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            原因：{partial.reason ?? "网络异常"}。
            <span className="text-rose-200">它现在只在这次会话里活着</span> —— 你现在能在卡片库里看到它，
            但下次重开 App 就会没有（登录后 App 会用服务器上那份覆盖本机）。
            <span className="text-slate-100">别退出这一页</span>，等网络好一点再点一次「重试」。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setPartial(null);
                void mint();
              }}
              className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-ink"
            >
              重试
            </button>
          </div>
        </div>
      )}
      {partial?.kind === "views" && (
        <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3">
          <p className="text-xs font-semibold text-amber-300">卡建好了，但有图没能存到服务器</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
            {partial.lost.slice(0, 3).join("、")}
            {partial.lost.length > 3 ? ` 等 ${partial.lost.length} 张` : ""}
            没能同步（{partial.reason ?? "上传失败"}）。卡本身在服务器上，只有这几张图还只留在这台设备，
            换设备或重新登录后它们会消失。
            {/* ★ 补救办法必须**真的走得通**：详情页的「+ 图位」在满格（MAX_CARD_VIEWS=3）时
                整组不渲染，而人物卡三格传满恰恰是这一页最主推的用法 —— 那时候唯一能触发
                自愈补传的动作是**先删一张再加回来**。原来这里只写"重新挂一次"，
                用户进去会发现连个「+」都没有。 */}
            <br />
            补救：进卡片详情页，把没同步的那张<span className="text-slate-100">先删掉、再重新加一次</span>
            （图位已经满了的话必须先删 —— 满格时没有「+」按钮）。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => nav(`/card/${partial.id}`, { replace: true })}
              className="rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-ink"
            >
              去看这张卡
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => void mint()}
        disabled={!ready || minting || busySlot !== null || !!partial}
        className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
      >
        {minting ? "铸造中…" : partial ? "已铸成" : "🎴 铸成卡片"}
      </button>
      {/* ★ 灰按钮必须**说出为什么**（CLAUDE.md「界面上摆一个永远点不动的选项」那条） */}
      {minting ? (
        // 远端模式这一步要串行上传几张图，弱网下几十秒是常事。不说的话用户会以为卡住了
        <p className="mt-1.5 text-center text-[11px] text-slate-500">
          {remote ? "正在存卡，并把图上传到服务器（手机上行慢时要几十秒）…" : "正在存进本机卡片库…"}
        </p>
      ) : partial ? null : offlineButConfigured ? (
        // ★ 这一条排在 missing 之前：填不填得完整都不该让他填 —— 先说真正的拦路原因
        <p className="mt-1.5 text-center text-[11px] text-rose-300">连不上服务器，现在铸出来的卡会丢（见上）</p>
      ) : !ready ? (
        <p className="mt-1.5 text-center text-[11px] text-slate-400">还缺：{missing.join("、")}</p>
      ) : (
        <p className="mt-1.5 text-center text-[11px] text-slate-500">不消耗 token · 铸好后直接进你的卡片库</p>
      )}
        </>
      )}

        </>
      )}

      {annot && (
        <FrameAnnotator
          frame={annot.frame}
          hint="圈出要改的地方，写一句要求——AI 会重画这一格"
          onClose={() => setAnnot(null)}
          onSave={(frame, req) => {
            const tag = annot.tag;
            setAnnot(null);
            void refineSlot(tag, frame, req);
          }}
        />
      )}

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
    </div>
  );
}
