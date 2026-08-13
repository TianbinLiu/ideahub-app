// 自定义卡片：用**用户自己的图**铸一张卡（卡面 + 形象参考图 + 「<类型>信息」）。
// 入口在创意工坊「铸新卡」那一组里。
//
// ★★ 这条路的定位必须一眼看得出来：默认的铸卡**已经是 AI 全自动出图**（3D 工坊里
//   交给铸卡师，一张图都不用传）。这一页是给"我就是想用自己那张图"的人留的**另一条**
//   路，不是默认路径 —— 页面顶上那块对比说明不是装饰，去掉它用户就会以为"原来铸卡
//   还得自己找图"，等于把刚做完的全自动铸卡藏起来了。
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
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon";
import TarotCard from "../components/TarotCard";
import { addCards, isRemoteMode } from "../data/account";
import { API_ON } from "../api/client";
import { prepareCardImage } from "../data/cardViews";
import {
  CARD_INFO_LABELS,
  CARD_SLOTS,
  CARD_TYPES,
  CARD_TYPE_COLORS,
  CARD_TYPE_LABELS,
  Card,
  CardType,
  CardView,
  slotLabel,
  uid,
} from "../types";
// 比例上限是方舟的硬约束，文案里那个数只能从这里取（见下面图位那段的 ★）
import { REF_MAX_RATIO } from "../utils/image";

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

/** 一个图位上已经准备好的那张图 */
interface Shot {
  /** 已按 prepareCardImage 处理过（比例裁 + 尺寸压制）的 dataURL */
  dataUrl: string;
  /** 我们动过这张图就有值，必须显示出来 */
  note?: string;
  /** 原文件名，只为让用户认得出自己传的是哪张 */
  fileName: string;
}

/** 标签输入 → tags。空格 / 逗号 / 顿号 / # 都当分隔符（用户三种都会打） */
function parseTags(raw: string): string[] {
  const list = raw
    .split(/[\s,，、#]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.slice(0, TAG_LEN_MAX));
  return Array.from(new Set(list)).slice(0, TAG_MAX);
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
  const [shots, setShots] = useState<Partial<Record<CardView["kind"], Shot>>>({});
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [info, setInfo] = useState("");
  const [tagText, setTagText] = useState("");

  const [busySlot, setBusySlot] = useState<CardView["kind"] | null>(null);
  /** 选图失败：**贴在出事的那一格上**，不是页面底部那条通用红字（见 onFile 的 catch） */
  const [slotErr, setSlotErr] = useState<{ kind: CardView["kind"]; msg: string } | null>(null);
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
  const pickingRef = useRef<CardView["kind"]>("body");

  const slots = CARD_SLOTS[type];
  const primary = slots[0];
  const tags = useMemo(() => parseTags(tagText), [tagText]);

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
    setType(next);
    setErr("");
  }

  function pick(kind: CardView["kind"]) {
    pickingRef.current = kind;
    setErr("");
    setSlotErr(null); // 上一次的失败提示不该跨到这一次
    fileRef.current?.click();
  }

  async function onFile(file: File | undefined) {
    const kind = pickingRef.current;
    if (!file || busySlot) return;
    setBusySlot(kind);
    setErr("");
    setSlotErr(null);
    try {
      // 比例/大小的规则只有这一处（data/cardViews.prepareCardImage），
      // 与详情页「+ 图位」共用；这一页只负责把它编成 dataURL 挂上去
      const { blob, note } = await prepareCardImage(file);
      const dataUrl = await blobToDataUrl(blob);
      setShots((prev) => {
        const next = { ...prev };
        next[kind] = { dataUrl, fileName: file.name, ...(note ? { note } : {}) };
        return next;
      });
    } catch (e) {
      // ★ 必须显示，而且要显示在**这一格里**（页面底部那条红字隔着两整节，手机上看不见）。
      //   这条路会解码、会裁、会编码，失败原因（不是图片 / 超 20MB / 太小 AI 认不出）
      //   都是用户能据此改正的话，吞掉就只剩"点了没反应"（铁律八）
      setSlotErr({ kind, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusySlot(null);
    }
  }

  function removeShot(kind: CardView["kind"]) {
    setShots((prev) => {
      const next = { ...prev };
      delete next[kind];
      return next;
    });
    setErr("");
  }

  // 还缺什么。★ 灰按钮 + 一句"还缺：…"是一体的：只灰不说等于告诉用户功能坏了
  const missing: string[] = [];
  if (!shots[primary.kind]) missing.push(`${primary.label}（就是卡面）`);
  if (!name.trim()) missing.push("卡名");
  if (!summary.trim()) missing.push("一句话简介");
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
      const picked = slots.map((s) => ({ slot: s, shot: shots[s.kind] })).filter((x) => !!x.shot);
      const cover = picked[0].shot!.dataUrl;
      const views: CardView[] = picked.map(({ slot, shot }) => ({
        kind: slot.kind,
        url: shot!.dataUrl,
        ...(shot!.note ? { note: shot!.note } : {}),
      }));
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
      </div>

      {/* ★ 与默认路径的区别写在最前面。不写的话这一页会被读成"原来铸卡得自己找图" */}
      <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
        <p className="text-xs leading-relaxed text-amber-200/90">
          这是<span className="font-semibold">另一条</span>路：卡面和形象参考图全部用你上传的图。
        </p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-slate-400">
          <li>· 默认铸卡是 <span className="text-slate-300">AI 全自动出图</span>（3D 工坊 → 找铸卡师），一张图都不用你传。</li>
          <li>· 这里<span className="text-slate-300">不调用任何出图模型，因此不消耗 token</span>；相应地，也不会有 AI 帮你补齐其余图位。</li>
          <li>· 铸出来的卡和 AI 铸的完全同一种东西：能进卡组、能当出片的形象参考、能发布到创意工坊。</li>
        </ul>
        <Link to="/studio" className="mt-2 inline-block text-[11px] text-brand">
          想让 AI 来画？去 3D 工坊 ›
        </Link>
      </div>

      {/* ★★ 两种"没连服务器"必须分开说，因为后果差着一整张卡（见 offlineButConfigured） */}
      {offlineButConfigured ? (
        <div className="mb-3 rounded-xl border border-rose-500/50 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-slate-300">
          <span className="font-semibold text-rose-200">连不上服务器，这会儿做不了卡：</span>
          现在建的卡<span className="text-rose-200">只会存在内存里</span>，等网络恢复、App 与服务器对上账之后，
          它会连同你传的图一起消失（App 会用服务器上那份覆盖本机，而离线期间建的卡不会自动补传上去）。
          与其让你白填一遍，不如等连上再来 —— 换个网络或稍后重开 App 试试。
        </div>
      ) : (
        !remote && (
          <div className="mb-3 rounded-xl border border-slate-600 bg-panel p-3 text-[11px] leading-relaxed text-slate-300">
            <span className="font-semibold text-slate-200">离线版（这个包没有配服务器）：</span>
            这张卡<span className="text-slate-100">能铸</span>，图存在这台设备上，出片时照样能当形象参考；
            但<span className="text-amber-300">发布不了</span> ——「发布到创意工坊」要有服务器，
            而且换设备或清掉 App 数据后这些图就没了。
          </div>
        )
      )}

      {/* ── 1 卡片类型 ── */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">① 这是一张什么卡</h2>
        <div className="flex flex-wrap gap-2">
          {CARD_TYPES.map((t) => {
            const on = t === type;
            return (
              <button
                key={t}
                onClick={() => changeType(t)}
                // ★★ 处理图片期间不许换卡种：onFile 在 await 之后按 pickingRef 里的 kind
                //   写 shots，而 changeType 只按**当时**的 shots 算要丢哪几张 ——
                //   在途那张既不会被取下、也不会进"已经取下来了"那句说明，
                //   处理完直接写进一个新卡种根本没有的图位，从此不显示、不入卡、零提示。
                disabled={busySlot !== null}
                className="rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-40"
                style={{
                  color: on ? "#0b1020" : CARD_TYPE_COLORS[t],
                  borderColor: CARD_TYPE_COLORS[t],
                  background: on ? CARD_TYPE_COLORS[t] : CARD_TYPE_COLORS[t] + "14",
                  fontWeight: on ? 700 : 400,
                }}
              >
                {CARD_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
        {/* ★ 这里**不**把各卡种的图位名列一遍：那是 types.CARD_SLOTS 的内容，
            下面第 ③ 步已经照表画出来了。抄一份摆在这儿，改表时它不会跟着变 */}
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          卡种决定下面有<span className="text-slate-400">哪几个图位、每格锁住什么</span>
          （一把剑不该有"全身立绘"）。换卡种时对不上的那一格会被取下来，并在这里告诉你。
        </p>
        {dropped && <p className="mt-1 text-[11px] leading-relaxed text-amber-400">{dropped}</p>}
      </section>

      {/* ── 2 卡名 + 简介（右边挂实时卡面预览）── */}
      <section className="mb-4 flex gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="mb-1.5 text-xs font-semibold text-slate-300">② 卡名与简介</h2>
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
            cover={shots[primary.kind]?.dataUrl ?? null}
            title={name.trim() || "未命名"}
            sub={CARD_TYPE_LABELS[type]}
            type={type}
          />
          <p className="mt-1 text-center text-[9px] leading-tight text-slate-500">卡面预览</p>
        </div>
      </section>

      {/* ── 3 图位 ── */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">
          ③ 图位（{CARD_TYPE_LABELS[type]}共 {slots.length} 格）
        </h2>
        <div className="space-y-2">
          {slots.map((s, i) => {
            const shot = shots[s.kind];
            const isPrimary = i === 0;
            return (
              <div key={s.kind} className="flex gap-3 rounded-xl border border-slate-700/70 bg-panel p-2.5">
                <button
                  onClick={() => pick(s.kind)}
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
                    //   不说的话用户会以为卡面是另外一张、还要再传一次
                    <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                      这一张既当卡面，也当这张卡的主形象参考。卡框是竖版 2:3，非这个比例的图会被
                      <span className="text-slate-400">居中显示</span>（这一步只影响卡面怎么摆，不裁图）。
                    </p>
                  )}
                  {/* ★★ 选图失败的话必须显示在**出事的这一格里**。原来只写进页面底部那个 err，
                      而那儿隔着「<类型>信息」和「标签」两整节 —— 手机上用户看到的就是
                      "点了没反应"，解释在两屏之下（铁律八）。 */}
                  {slotErr?.kind === s.kind && (
                    <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{slotErr.msg}</p>
                  )}
                  {shot && (
                    <>
                      <p className="mt-1 truncate text-[10px] text-slate-500">{shot.fileName}</p>
                      {/* ★ 我们裁过用户的图就必须当面说（prepareCardImage 给的 note） */}
                      {shot.note && <p className="mt-0.5 text-[10px] leading-relaxed text-amber-400">{shot.note}</p>}
                      <div className="mt-1 flex gap-3">
                        <button
                          onClick={() => pick(s.kind)}
                          disabled={busySlot !== null}
                          className="text-[11px] text-brand disabled:opacity-50"
                        >
                          换一张
                        </button>
                        <button
                          onClick={() => removeShot(s.kind)}
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
        {/* ★★ 铁律八：别让人以为"传满就一定都生效"。但**判据只有一处**
            （ai/real.refUsedFlags，详情页据它逐张标「出片用 / 仅展示」），
            所以这里只说"不是每张都进"并把人指过去，不在这儿把规则重念一遍（铁律六）——
            重念的那一份迟早会和管线分叉，而分叉的正是花了钱的那半句。 */}
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          出片时<span className="text-slate-400">不是每张都会喂进模型</span>：取几张要看这张卡在那一段里排第几、
          同一段里还挂了几张卡。铸完之后卡片详情页会逐张标出「出片用 / 仅展示」，那里是唯一的判据。
        </p>
        {/* ★ 比例这个数从 utils/image 的 REF_MAX_RATIO 取，不手打一个 "3"：它是方舟的**硬**
            约束（越界不是忽略这张图，是整个请求 400），改的时候文案必须跟着改。
          ★ 刻意**不**写"单张上限 5MB"：那是压缩**之后**的 blob 上限，压缩后基本碰不到；
            用户真会撞到的是原图 20MB 那道（utils/image.decodeImageFile），而两个数摆在
            一起只会让人以为 6MB 的手机原图不能用 —— 其实完全可以（铁律五）。 */}
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          相册里的原图直接选就行：会自动压到 AI 认得出的尺寸再挂上去，不会把整份原图塞进卡里。
          长宽比超过 {REF_MAX_RATIO}:1 的会被居中裁进 {REF_MAX_RATIO}:1（方舟不收更极端的参考图），
          裁过就会在上面那一格里写出来；图太大 / 太小则会当场说明原因。
        </p>
      </section>

      {/* ── 4 「<类型>信息」 ── */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">④ {CARD_INFO_LABELS[type]}（选填）</h2>
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
          <p className="text-[10px] leading-relaxed text-slate-500">
            这段话会存进这张卡的「{CARD_INFO_LABELS[type]}」，
            <span className="text-slate-400">之后 AI 复刻这张卡的画面 / 建模时会读它</span>。写得越具体越像。
            不填也行——详情页会按卡名与简介现补一份。
          </p>
          <span className="flex-none text-[10px] text-slate-600">
            {info.length}/{INFO_MAX}
          </span>
        </div>
      </section>

      {/* ── 5 标签 ── */}
      <section className="mb-4">
        <h2 className="mb-1.5 text-xs font-semibold text-slate-300">⑤ 标签（选填）</h2>
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

      {err && <p className="mb-2 text-[11px] leading-relaxed text-rose-400">{err}</p>}

      {/* 没有全成：**停在这儿**把话说完，不自动跳走 —— 跳走那段话就没人读得到 */}
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
