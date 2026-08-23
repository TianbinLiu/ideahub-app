// 模板货架：模板市场 + 我的模板的整块 UI（tab、搜索、待取回、上传入口、列表、提取器）。
//
// ★ 2026-08-21 从 pages/TemplateMarketPage 抽出来：用户要求把「我的模板/模板市场」
//   也摆进创意工坊页 —— 两个页面渲染同一份货架，抄一份的话发布/删除/分组这些规则
//   迟早各改各的（铁律六）。/templates 独立页保留（深链与引导教程还指着它）。
// ★ 分段模板组在列表里收成**一条**（用户点名：分段的模板要在同一模板下）：
//   组头是第 1 段的卡，下面一条「共 N 段」的横条能展开其余段——每段的核对/识别/
//   发布/删除操作原样住在各自的卡里，规则零复制。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "./Icon";
// ★ 核对编号那一屏（含"删掉一个角色位"）在 components/blockout/RoleConfirmSheet：
//   详情页 OwnerBar 要用同一个入口，一份实现两处用（两页各写一份必然分叉）
import { useSocialVersion } from "./SocialPanel";
import VideoTemplateExtractor from "./VideoTemplateExtractor";
import {
  blockoutJobExpired,
  blockoutJobNote,
  dismissBlockoutJob,
  browseTemplates,
  isMyTemplate,
  templateGroupOf,
  myTemplates,
  pendingBlockoutIssue,
  pendingBlockoutJobs,
  refVideoIssue,
  refVideoPoster,
  refVideoRealSec,
  refreshPendingBlockoutJobs,
  refreshRemoteTemplate,
  remoteStateOf,
  remoteTemplatesCapable,
  resumeBlockoutize,
  sharedLoadIssue,
  subscribeTemplates,
  templatesVersion,
  type BlockoutJob,
} from "../data/templates";
import { readSocial } from "../data/social";
import { useFlow } from "../studio/flowStore";
import { useApplyTemplate } from "./flow/useApplyTemplate";
import { VideoTemplate } from "../types";

export function useTemplatesVersion(): number {
  return useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
}

function fmt(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}

export function TemplateCard({
  t,
  onPick,
  guide,
  guidePick,
  actions,
}: {
  t: VideoTemplate;
  onPick?: () => void;
  /** 塞进卡片格子里的操作区（2026-08-20：识别/核对/发布/删除都住进来，列表不再往
   *  卡片下面堆三块说明文字）。只在「我的模板」侧传。 */
  actions?: React.ReactNode;
  /** 新手引导的锚点名（落到卡片根元素的 `data-guide`）。
   *  ★ 必须显式收一个 prop：TemplateCard 自己声明 props、**不透传 `...rest`**，
   *  调用处直接写 `data-guide` 会被 TS 挡下；而为了挂锚点在外面包一层盒子也不行 ——
   *  下面那颗 guidePick 更是包不得（见那条注释），两个锚点统一走 prop，
   *  免得一个包一个不包。 */
  guide?: string;
  /** 同上，落到「用它出片」那颗按钮上（卡片与按钮在引导里是两步，各要自己的圈）。
   *  ★ 这颗尤其不能在外面包一层：按钮是底下那行 `flex … gap-2 p-2.5` 里的 `flex-none` 项，
   *  套一层 span 之后 flex 项变成了那层盒子（它不带 flex-none），简介那段能占的宽度
   *  跟着变 —— 而 line-clamp-2 的截断位置就是按这个宽度算的。 */
  guidePick?: string;
}) {
  // 走唯一入口 readSocial（模板的互动计数首发仍是本机的——服务端 ASSET_KINDS 还没有
  // "template"，那是 P2 快跟；到那天这里一行不用改，data/social 换个来源就行）。
  // ★ 别在这儿读 likedBy.length —— 数字从哪来只该由 data/social 说了算
  const s = readSocial("template", t.id);
  // 白模模板的参考视频就地预览（存在性判定 t.refVideo，types.ts 的 ★）。
  // 视频挂在 Link 里面：靠 e.preventDefault() 拦掉 <a> 的默认跳转——预览时点视频
  // 是在操作播放器，不是想进详情页
  const [preview, setPreview] = useState(false);
  /** 封面：自己上传的那份优先；没有就从模板视频派生一帧。
   *  ★★ 「自己传白模视频」那条路建出来的模板 `cover` 一直是空串 —— 在此之前那张卡是
   *    **纯黑**的（`t.cover && <img>` 直接不渲染），看起来像模板坏了。 */
  const cover = t.cover || refVideoPoster(t.refVideo);
  return (
    <div data-guide={guide} className="overflow-hidden rounded-2xl border border-slate-700/70 bg-panel">
      <Link to={`/template/${t.id}`} className="block">
        <div className="relative aspect-[16/10] bg-black/40">
          {preview && t.refVideo ? (
            <div className="h-full w-full" onClick={(e) => e.preventDefault()}>
              <video
                src={t.refVideo.url}
                poster={cover || undefined}
                controls
                autoPlay
                muted
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            </div>
          ) : (
            cover && <img src={cover} alt="" className="h-full w-full object-cover" />
          )}
          {t.refVideo && (
            <span className="absolute left-2 top-2 rounded bg-sky-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
              白模
            </span>
          )}
          {/* ★ V2 标识：这个模板有**角色位**，套用时能逐个人偶换人（V1 只能整段换一个主体）。
              判据是**存在性**（`roles?.length`），不是等值 —— V1 老模板整个字段缺失。
              为什么要摆出来：两种模板在市场上长得一模一样，而能力差一个量级；
              不标的话用户只能靠"点进去试试"才知道这个模板能不能分角色换人。 */}
          {t.roles?.length ? (
            <span className="absolute left-[3.1rem] top-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {t.roles.length} 个角色位可换人
            </span>
          ) : null}
          {t.refVideo && (
            <button
              onClick={(e) => {
                e.preventDefault();
                setPreview((v) => !v);
              }}
              className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-slate-100"
            >
              {preview ? "封面" : "▶ 预览"}
            </button>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
            <div className="truncate text-sm font-bold text-slate-50">{t.title}</div>
            <div className="mt-0.5 flex items-center gap-2.5 text-[10px] text-slate-300">
              <span>@{t.author}</span>
              <span className="flex items-center gap-0.5">
                <Icon name="play" size={10} /> {fmt(s.views)}
              </span>
              <span className="flex items-center gap-0.5">
                <Icon name="heart" size={10} /> {fmt(s.likes)}
              </span>
              {/* 白模只有一段（整段复刻），报"模板视频几秒"比"1 段"信息量大。
                  ★ 有真实秒数就报真实的（计价那个整数锚点在详情页说清楚）。 */}
              <span>
                {t.refVideo
                  ? `${(refVideoRealSec(t.refVideo) ?? t.refVideo.durationSec).toFixed(1)}s 复刻`
                  : `${t.recipe.beats.length} 段`}
              </span>
              {/* ★★ 模板视频本身出不了片时打角标并置灰，**但不从列表里拿掉**：东西静默消失，
                  用户只会以为是我们弄丢了（铁律八）。判据只有 refVideoIssue 一处，
                  点进详情页会读到完整的那句原因（作者本人还会看到"不是你操作错了"）。 */}
              {refVideoIssue(t.refVideo) && (
                <span className="rounded-full bg-rose-500/20 px-1.5 py-px text-[9px] text-rose-200">暂时不可用</span>
              )}
            </div>
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-2 p-2.5">
        <p className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">{t.intro}</p>
        {onPick && (
          <button
            data-guide={guidePick}
            onClick={onPick}
            className="flex-none rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink"
          >
            用它出片
          </button>
        )}
      </div>
      {actions && <div className="border-t border-slate-700/60 px-2.5 pb-2.5 pt-2">{actions}</div>}
    </div>
  );
}

/**
 * 【白模 V2 · 两阶段的恢复入口】一发**已经付过钱、还没取回结果**的白模化。
 *
 * ★★ 这一块是把白模化拆成两阶段的**目的本身**。开炼那一发的钱在 r2v 被受理时就花掉了
 *   （受理后失败不退），而后面还要等好几分钟出片 —— 手机切后台、弱网断线、进程被系统
 *   回收、网关超时，任何一条都会打断那次等待。**没有这个入口，用户就是"钱花了、结果
 *   没了、还不知道该去哪找"**，那时两阶段反而比一条长请求更糟（多了一个丢结果的接缝）。
 * ★ 剩余时间要显示，而且要**真的在走**（每分钟重算一次）：一条永远停在"剩 1 分钟"的
 *   提示比不显示更坏。24 小时不是我们定的时限，是方舟产物 URL 的物理寿命（TOS 签名地址）。
 * ★ 过期的那条**不给按钮、整句说明费用无法挽回**（blockoutJobNote 一处实现）：
 *   摆一颗点了必然失败的按钮，等于让用户以为还有救。
 */
function BlockoutResumeCard({ job, onTaken }: { job: BlockoutJob; onTaken: () => void }) {
  const [busy, setBusy] = useState("");
  const [issue, setIssue] = useState("");
  // 每分钟重算一次剩余时间（blockoutJobNote 是纯函数，重渲即刷新）
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const expired = blockoutJobExpired(job);

  async function take() {
    setIssue("");
    setBusy("正在取回…");
    try {
      await resumeBlockoutize(job.jobId, (s) => setBusy(s));
      onTaken();
    } catch (e) {
      // 服务端/数据层给的都是整句人话（"还在生成中""受理后失败不退""产物已过期"…），
      // 原样显示。★ 这里**绝不**自己补一句"重试一下"——有些失败重试就是再花一次钱
      setIssue(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        expired ? "border-slate-600/60 bg-black/25" : "border-amber-500/50 bg-amber-500/10"
      }`}
    >
      <div className="text-[11px] font-bold text-amber-200">
        {expired ? "这一发白模化已经取不回来了" : "有一发白模化还没取回结果"}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-300">
        「{job.title}」· {job.durSec > 0 ? `${job.durSec}s` : "选段"}
        {/* ★ 序数方案下把位置列出来：这一发的凭据里就记着当初真正算出来的那份清单
            （`markSlots`，跟着凭据走而不是"按今天服务端是哪一套"事后推），所以这里说得准。
            老凭据没有这一位 → 只报个数（编号不连续，列出来反而误导） */}
        {job.roles.length > 0
          ? job.markSlots.length > 0
            ? ` · 认出 ${job.roles.length} 个角色位：${job.roles.map((r) => r.label).join("、")}`
            : ` · 认出 ${job.roles.length} 个角色位`
          : ""}
      </div>
      <p className={`mt-1 text-[11px] leading-relaxed ${expired ? "text-slate-400" : "text-amber-200/90"}`}>
        {blockoutJobNote(job)}
      </p>
      {issue && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{issue}</p>}
      {!expired ? (
        <button
          onClick={() => void take()}
          disabled={!!busy}
          className="mt-2 w-full rounded-full bg-brand py-2 text-[12px] font-bold text-ink disabled:opacity-50"
        >
          {busy ? "取回中…" : "取回这一发的结果（不额外花钱）"}
        </button>
      ) : (
        /* ★★ 只有**已经过期**的才给这颗（判据在 data 层 dismissBlockoutJob 里再挡一次）：
             产物过期之后这条凭据在服务端名单里永远留着，而它已经没有任何可做的事 ——
             不给消除入口的话，用户面对的是一个**永远关不掉**的提醒，久了就把真正
             还能取回的那几发一起当成背景噪音忽略掉。
           ★ 措辞不写"删除"：什么都没被删，那笔钱也不会回来，消掉的只是这条提醒。 */
        <button
          onClick={() => dismissBlockoutJob(job)}
          className="mt-2 w-full rounded-full border border-slate-600 py-2 text-[12px] text-slate-300"
        >
          知道了，不用再提醒我这一发
        </button>
      )}
      {/* ★ 进度话摆在按钮下面而不是塞进按钮里：它是整句（"生成中 35s（可以退出…）"），
          塞进按钮会折成三行还看不清 —— 而这一步最长要等几分钟，不报进度用户会以为死了 */}
      {busy && <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{busy}</p>}
    </div>
  );
}

/** 列表格子上作者那条模板的**状态标**（2026-08-23 起格子上只剩它）。
 *  ★ 所有作者操作（核对 / 识别 / 发布 / 下架 / 删除）都移进了详情页的作者工作台 ——
 *    用户点名「格子上别堆一排按钮」；顺带列表滑动不再误触删除。此前"摆在列表里省一跳"
 *    那条取舍（见 git 历史）按用户新要求撤销：入口收在详情页一处，格子回归"只陈列 + 一眼看状态"。
 *  ★ 判据仍在 data 层唯一实现（isMyTemplate / remoteStateOf），这里只读不写。 */
function OwnerRow({ t }: { t: VideoTemplate }) {
  const st = remoteStateOf(t);
  if (!isMyTemplate(t)) return null;
  const published = st ? st.status === "published" : t.published;
  const blocked = st?.status === "blocked";
  const [label, cls] = blocked
    ? ["已下架", "bg-rose-500/15 text-rose-300"]
    : published
      ? ["已发布", "bg-emerald-500/15 text-emerald-300"]
      : ["草稿", "bg-slate-700 text-slate-300"];
  return (
    <span data-guide="template-owner-row" className={`flex-none rounded-full px-2.5 py-1 text-[11px] ${cls}`}>
      {label}
    </span>
  );
}

/** 列表行：单模板一行；分段组收成一行（组内按 group.index 升序）。
 *  ★ 与 templateGroupOf 刻意不同：那边组不齐宁可只回自己（整组**套用**少一段是静默丢
 *  内容）；这边是**陈列**，有几段摆几段、组头照实报「共 N 段」——藏起来才是静默。 */
function groupRows(list: VideoTemplate[]): { key: string; parts: VideoTemplate[] }[] {
  const rows: { key: string; parts: VideoTemplate[] }[] = [];
  const byKey = new Map<string, { key: string; parts: VideoTemplate[] }>();
  for (const t of list) {
    if (!t.group) {
      rows.push({ key: `t:${t.id}`, parts: [t] });
      continue;
    }
    const k = `g:${t.group.key}`;
    const hit = byKey.get(k);
    if (hit) hit.parts.push(t);
    else {
      const row = { key: k, parts: [t] };
      byKey.set(k, row);
      rows.push(row); // 组的位置按它第一次出现算（列表本身已按时间排过）
    }
  }
  for (const r of rows) r.parts.sort((a, b) => (a.group?.index ?? 0) - (b.group?.index ?? 0));
  return rows;
}

/** 分段组的一行：组头 = 第 1 段的卡 + 「共 N 段」横条，展开才铺其余段。
 *  每段的核对/识别/发布/删除仍在**各自**的卡里（OwnerRow 原样复用）——分组只是陈列，
 *  不新造任何一条组级规则。「用它出片」从任何一段点都是整组套用（pick 里的 templateGroupOf）。 */
function GroupRow({
  parts,
  pick,
  guide,
  guidePick,
}: {
  parts: VideoTemplate[];
  pick: (t: VideoTemplate) => void;
  guide?: string;
  guidePick?: string;
}) {
  const [open, setOpen] = useState(false);
  const head = parts[0];
  const count = head.group?.count ?? parts.length;
  const totalSec = parts.reduce((s, p) => s + (refVideoRealSec(p.refVideo) ?? p.refVideo?.durationSec ?? 0), 0);
  return (
    <div className="space-y-1.5">
      <TemplateCard
        t={head}
        onPick={() => pick(head)}
        guide={guide}
        guidePick={guidePick}
        actions={
          <div className="space-y-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-left text-[11px] text-sky-200"
            >
              <span>📼</span>
              <span className="min-w-0 flex-1">
                同一条视频拆成 {count} 段的分段模板（共约 {Math.round(totalSec)}s）· 套用即整组铺开
                {parts.length !== count ? ` · 这台设备上只看到 ${parts.length} 段` : ""}
              </span>
              <span className="flex-none font-semibold">{open ? "收起 ▴" : "展开各段 ▾"}</span>
            </button>
            {isMyTemplate(head) && <OwnerRow t={head} />}
          </div>
        }
      />
      {open &&
        parts.slice(1).map((p) => (
          <div key={p.id} className="ml-5">
            <TemplateCard t={p} onPick={() => pick(p)} actions={isMyTemplate(p) ? <OwnerRow t={p} /> : undefined} />
          </div>
        ))}
    </div>
  );
}

/** 货架本体。embedded = 摆在别的页里（创意工坊）：不带页头，其余一模一样 */
export default function TemplateShelf({ initialTab }: { initialTab?: "market" | "mine" }) {
  const ver = useTemplatesVersion();
  useSocialVersion();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"market" | "mine">(initialTab ?? "market");
  // 白模上传入口按能力门控渲染（探测走 remoteTemplatesCapable 唯一实现）：
  // 老服务端 / 离线时不摆一个走到上传那步才失败的按钮（CLAUDE.md「永远点不动的选项」）
  const [blockoutCap, setBlockoutCap] = useState(false);
  const [extract, setExtract] = useState(false);
  /** 套用被就地拒绝时那句话（分段组凑不齐）。★ 不走 flowStore.err：那条错误条只画在
   *  工作流页与画布上，而用户此刻站在模板列表里 —— 写进那里等于没人看得见 */
  const [pickErr, setPickErr] = useState("");
  // 套用前的在途流水线守卫（唯一实现，与模板详情页共用）
  const { guard, dialog: discardDialog } = useApplyTemplate();
  useEffect(() => {
    let alive = true;
    void remoteTemplatesCapable().then((ok) => {
      if (alive) setBlockoutCap(ok);
    });
    // ★★ 进这一页就拉一次「还没取回结果」的名单（服务端那份是唯一真相 —— 进程被系统
    //   回收时本机 state 一起没了，只有它还在）。强制重拉而不是用缓存：用户点进来，
    //   多半就是因为刚才那一发被打断了，这时候给他看一份可能已经过时的名单没有意义。
    void refreshPendingBlockoutJobs();
    return () => {
      alive = false;
    };
  }, []);
  // ★ 依赖里带 ver：远端 shared 是「懒加载 + 到货 emit」，到货那一拍 version 变了
  //   列表才会重算——只依赖 tab/q 的话，远端模板到了也不上屏
  const list = useMemo(() => (tab === "market" ? browseTemplates(q) : myTemplates()), [tab, q, ver]);
  /** 分段组收成一行（用户点名：分段的模板要在同一模板下）。tab 标签上的数字也数**行** */
  const rows = useMemo(() => groupRows(list), [list]);
  const mineRows = useMemo(() => groupRows(myTemplates()).length, [ver]);

  // ★★ 冷启动后远端状态快照是空的（本机库只存模板本身，不存 status/provenAt/待核对）。
  //   不补的话，「角色位待核对」那条提示重启后就**不出现了**，而服务端那道发布闸还在 ——
  //   作者看到的是"点发布失败"却找不到任何出口（正是铁律八说的静默）。
  //   只补 **有角色位、已登记、且还没有快照** 的那几条，每条一次（asked 记名防重）；
  //   refreshRemoteTemplate 是读路径，失败静默降级为"用上次的快照"，到货会 emit。
  const asked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (tab !== "mine") return;
    for (const t of myTemplates()) {
      if (!t.roles?.length || !t.remoteId || remoteStateOf(t) || asked.current.has(t.id)) continue;
      asked.current.add(t.id);
      void refreshRemoteTemplate(t.id);
    }
  }, [tab, ver]);

  /** 套用模板。applyTemplate 返回 false = 被整句拒绝（白模在 refVid 全关时，或**模板视频
   *  本身不满足方舟窗口** —— 2026-08-16 起多了这一条），这时改跳详情页：那里印着拒绝的
   *  原因（r2vPriceIssue / refVideoIssue 各自的整句），留在市场干瞪眼不行。
   *  ★ 卡片上那个「暂时不可用」角标只是把这件事提前画出来，不是第二处判断 */
  function pick(t: VideoTemplate) {
    // 分段组从任意一段点「用它出片」都是**整组**套用（templateGroupOf 不是组员时回 [自己]，
    // 所以单模板走的还是 applyTemplate 那条原路）
    const parts = templateGroupOf(t);
    // ★★ 组不齐时**整句拒绝**，绝不静默退成单段（2026-08-21 对抗评审确认）：
    //   templateGroupOf 凑不齐 count 就回 [自己]，而 `parts.length > 1` 这个判据会把它
    //   当成"这本来就是单模板"，落进 applyTemplate —— 一个节点、mode 退成 simple、
    //   其余段全丢，err 一个字都没有。而卡上那条横条正写着「套用即整组铺开」。
    //   凑不齐的常见原因：作者只发布了其中几段、某段被删、远端列表分页截断、弱网只到货一半。
    //   ⚠ 删段之后其余段的 group.count 仍是旧值，那一组会**永远**凑不齐 —— 所以这句话
    //     必须把"缺了几段"说出来，让作者知道去补发或重切，而不是每次都莫名其妙少几段。
    if (t.group && parts.length !== t.group.count) {
      setPickErr(
        `这是一条分成 ${t.group.count} 段的模板，但这台设备上只拿到了 ${parts.length} 段 —— ` +
          `整组套用会少内容，所以先不套。下拉刷新试试；如果是作者只发布了其中几段（组内每段各自发布），` +
          `等其余段发布出来再用。`,
      );
      return;
    }
    setPickErr("");
    // ★ 整表覆盖 nodes 之前先过守卫（唯一实现见 useApplyTemplate 的 ★★）：在途流水线
    //   连同已花钱的段会被这一下抹掉，而且不断开旧草稿的话，新流水线出片时的自动存盘
    //   会把那条草稿原地覆盖 —— 那是那些付费段唯一的备份
    guard(() => {
      const group = parts.length > 1;
      const ok = group ? useFlow.getState().applyTemplateGroup(parts) : useFlow.getState().applyTemplate(t);
      if (ok) nav("/flow");
      // ★★ 被整句拒时：**分段组把原因就地印出来，别甩去详情页**（第六轮收尾扫描抓到）。
      //   两个理由：① 详情页从头到尾不读 flowStore.err，它只会重算**这一条**模板的
      //   blockoutIssue —— 而组里坏的可能是第 3 段，用户点的第 1 段完全健康，
      //   那一页于是一个字都不提为什么被拒，看起来就是"点了『用它出片』被莫名甩走"；
      //   ② 更糟的是他在那一页再点一次「用它出片」，走的是 applyTemplate（单条），
      //   其余段静默消失 —— 而那正是本函数上面明令拒绝的「整组套用会少内容」。
      //   单模板那条仍然跳详情页：那一页会自己重算 blockoutIssue，措辞与这里一致。
      else if (group) setPickErr(useFlow.getState().err || "这一组模板暂时套不了");
      else nav(`/template/${t.id}`);
      return ok;
    });
  }

  return (
    <div>
      {discardDialog}
      <div className="mb-3 flex gap-2">
        {(["market", "mine"] as const).map((t) => (
          <button
            key={t}
            // 引导只圈「我的模板」那颗（market 那颗给 undefined = 不渲染这个属性，
            // 与改造前的 DOM 一模一样）
            data-guide={t === "mine" ? "templates-tab-mine" : undefined}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
          >
            {t === "market" ? "模板市场" : `我的模板 ${mineRows || ""}`}
          </button>
        ))}
      </div>

      {tab === "market" && (
        <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-700 bg-black/30 px-3.5 py-2">
          <Icon name="search" size={15} className="text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜模板：特摄、治愈、赛博…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
        </div>
      )}

      {pickErr && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-300/90">{pickErr}</p>
      )}

      {/* 远端市场拉挂了要明说：不说的话"远端加载失败"看起来和"市场就这么几个模板"
          一模一样（铁律八——失败要响；本机与种子照常显示，所以是"响且局部"） */}
      {tab === "market" && sharedLoadIssue() && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300/90">{sharedLoadIssue()}</p>
      )}

      {/* ★★ 「还没取回结果」摆在**两个 tab 都看得见**的位置，而不是只在「我的模板」里：
          这一块关系到已经花掉的钱，用户从任何一条路进这一页都该第一眼看见它
          （藏进另一个 tab = 他得先猜到要去那里翻）。列表本身按快过期的排前面。 */}
      {pendingBlockoutJobs().length > 0 && (
        <div className="mb-3 space-y-2">
          {pendingBlockoutJobs().map((j) => (
            <BlockoutResumeCard
              key={j.jobId}
              job={j}
              onTaken={() => {
                // 取回成功 = 本机多了一个白模模板（还等着核对角色位）。切到「我的模板」，
                // 下面那条「待核对」的提示就跟着出来了 —— 那是发布前的必经一步
                setTab("mine");
              }}
            />
          ))}
        </div>
      )}
      {/* 名单拉不到要说出来：不说的话"拉挂了"看起来和"你没有待取回的"一模一样，
          而后者是在钱上撒谎（铁律八） */}
      {pendingBlockoutIssue() && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-300/90">
          {pendingBlockoutIssue()}
        </p>
      )}

      {/* 「我的模板」的白模上传入口：跳提取器并直接拨到白模开关。
          只在能力探测过了才渲染（与提取器里开关的门控是同一个探测） */}
      {tab === "mine" && blockoutCap && (
        <button
          onClick={() => setExtract(true)}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-sky-500/50 py-3 text-xs text-sky-300"
        >
          <Icon name="plus" size={14} />
          {/* ★★ 2026-08-17 改文案：原来写「上传白模预演视频」，而它跳的是**任意视频 →
              AI 付费白模化**那条路 —— 用户带着一段自己做好的白模片点进去，会被再白模化
              一次、白花一次 r2v，而且画质更差。现在两条路都在框选那一屏里选，
              所以这句话要把**两种都传得**说出来。 */}
          传一段视频做白模模板（自己做好的白模片也行）
        </button>
      )}

      <div className="space-y-3">
        {rows.map((row, i) =>
          row.parts.length > 1 ? (
            <GroupRow
              key={row.key}
              parts={row.parts}
              pick={pick}
              guide={i === 0 ? "template-card" : undefined}
              guidePick={i === 0 ? "template-pick" : undefined}
            />
          ) : (
            <div key={row.key} className="space-y-1.5">
              {/* 引导锚点只挂第一行。这一屏是竖着滚的长列表、不是轮播，第一行不会横向滑走，
                  所以用下标判就够。挂满每一张也没用：GuideOverlay 拿的是 querySelector 的第一个。 */}
              {/* 2026-08-20 起作者操作全塞进卡片格子（TemplateCard 的 actions 槽）：
                  核对/识别/发布/删除是一行小按钮，长说明各自收进面板 —— 列表不再在卡片
                  下面堆三块常驻文字。isMyTemplate 判据在 data 层一处。 */}
              <TemplateCard
                t={row.parts[0]}
                onPick={() => pick(row.parts[0])}
                guide={i === 0 ? "template-card" : undefined}
                guidePick={i === 0 ? "template-pick" : undefined}
                actions={isMyTemplate(row.parts[0]) ? <OwnerRow t={row.parts[0]} /> : undefined}
              />
            </div>
          ),
        )}
        {/* ★★ 空态要分得清**三件不同的事**（2026-08-17 种子模板删掉之后，市场真的会空）：
              ① 搜了没搜到 —— 用户自己知道怎么办（换个词），一句话就够；
              ② 市场真的空 —— 这不是故障，但也别只说"没有匹配的模板"（他没搜任何东西，
                 那句话会让人以为是筛选出了问题）。说清楚现状 + 给一条能走的路；
              ③ 拉不到远端 —— 那是**故障**，由上面的 sharedLoadIssue 横幅负责说，
                 这里不重复、也不冒充成"市场是空的"。
            ⚠ 别退回一句放之四海的"暂无数据"：三种情形的下一步动作完全不同。 */}
        {rows.length === 0 && (
          <div className="py-16 text-center text-sm leading-relaxed text-slate-500">
            {tab === "mine"
              ? "还没有你自己的模板——上面那两个入口都能做一个"
              : q.trim()
                ? "没有匹配的模板，换个词试试"
                : "市场上还没有公开的模板。做一个自己的、发布出来，这里就有了。"}
          </div>
        )}
      </div>

      {extract && (
        <VideoTemplateExtractor
          defaultBlockout
          onClose={() => setExtract(false)}
          onDone={(t) => pick(t)}
        />
      )}
    </div>
  );
}
