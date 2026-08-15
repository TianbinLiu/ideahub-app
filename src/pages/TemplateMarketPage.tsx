// 模板市场：简约模式的入口之一。别人发布的成功配方摆在这里，挑一个就能一句话出片。
//
// 与创意工坊的卡片市场刻意做成两个页面：卡片是"素材"（要自己组装成剧情），
// 模板是"成品配方"（一句话就出片）。混在一起会让新用户分不清该点哪个。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon";
// ★ 核对编号那一屏（含"删掉一个角色位"）迁到了 components/blockout/RoleConfirmSheet：
//   详情页 OwnerBar 要用同一个入口，一份实现两处用（两页各写一份必然分叉）
import { RoleConfirmEntry } from "../components/blockout/RoleConfirmSheet";
import { useSocialVersion } from "../components/SocialPanel";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
import {
  blockoutJobExpired,
  blockoutJobNote,
  browseTemplates,
  myTemplates,
  pendingBlockoutIssue,
  pendingBlockoutJobs,
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
import { VideoTemplate } from "../types";

export function useTemplatesVersion(): number {
  return useSyncExternalStore(subscribeTemplates, templatesVersion, () => 0);
}

function fmt(n: number): string {
  return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
}

export function TemplateCard({ t, onPick }: { t: VideoTemplate; onPick?: () => void }) {
  // 走唯一入口 readSocial（模板的互动计数首发仍是本机的——服务端 ASSET_KINDS 还没有
  // "template"，那是 P2 快跟；到那天这里一行不用改，data/social 换个来源就行）。
  // ★ 别在这儿读 likedBy.length —— 数字从哪来只该由 data/social 说了算
  const s = readSocial("template", t.id);
  // 白模模板的参考视频就地预览（存在性判定 t.refVideo，types.ts 的 ★）。
  // 视频挂在 Link 里面：靠 e.preventDefault() 拦掉 <a> 的默认跳转——预览时点视频
  // 是在操作播放器，不是想进详情页
  const [preview, setPreview] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/70 bg-panel">
      <Link to={`/template/${t.id}`} className="block">
        <div className="relative aspect-[16/10] bg-black/40">
          {preview && t.refVideo ? (
            <div className="h-full w-full" onClick={(e) => e.preventDefault()}>
              <video
                src={t.refVideo.url}
                controls
                autoPlay
                muted
                playsInline
                className="h-full w-full bg-black object-contain"
              />
            </div>
          ) : (
            t.cover && <img src={t.cover} alt="" className="h-full w-full object-cover" />
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
              {/* 白模只有一段（整段复刻），报"模板视频几秒"比"1 段"信息量大 */}
              <span>{t.refVideo ? `${t.refVideo.durationSec}s 复刻` : `${t.recipe.beats.length} 段`}</span>
            </div>
          </div>
        </div>
      </Link>
      <div className="flex items-center gap-2 p-2.5">
        <p className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-relaxed text-slate-400">{t.intro}</p>
        {onPick && (
          <button onClick={onPick} className="flex-none rounded-full bg-brand px-3 py-1.5 text-[11px] font-bold text-ink">
            用它出片
          </button>
        )}
      </div>
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
        {job.roles.length > 0 ? ` · 认出 ${job.roles.length} 个角色位` : ""}
      </div>
      <p className={`mt-1 text-[11px] leading-relaxed ${expired ? "text-slate-400" : "text-amber-200/90"}`}>
        {blockoutJobNote(job)}
      </p>
      {issue && <p className="mt-1.5 text-[11px] leading-relaxed text-rose-300">{issue}</p>}
      {!expired && (
        <button
          onClick={() => void take()}
          disabled={!!busy}
          className="mt-2 w-full rounded-full bg-brand py-2 text-[12px] font-bold text-ink disabled:opacity-50"
        >
          {busy ? "取回中…" : "取回这一发的结果（不额外花钱）"}
        </button>
      )}
      {/* ★ 进度话摆在按钮下面而不是塞进按钮里：它是整句（"生成中 35s（可以退出…）"），
          塞进按钮会折成三行还看不清 —— 而这一步最长要等几分钟，不报进度用户会以为死了 */}
      {busy && <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{busy}</p>}
    </div>
  );
}

export default function TemplateMarketPage() {
  const ver = useTemplatesVersion();
  useSocialVersion();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"market" | "mine">("market");
  // 白模上传入口按能力门控渲染（探测走 remoteTemplatesCapable 唯一实现）：
  // 老服务端 / 离线时不摆一个走到上传那步才失败的按钮（CLAUDE.md「永远点不动的选项」）
  const [blockoutCap, setBlockoutCap] = useState(false);
  const [extract, setExtract] = useState(false);
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

  // ★★ 冷启动后远端状态快照是空的（本机库只存模板本身，不存 status/provenAt/待核对）。
  //   不补的话，「编号待核对」那条提示重启后就**不出现了**，而服务端那道发布闸还在 ——
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

  /** 套用模板。applyTemplate 返回 false = 被闸门整句拒绝（白模在 refVid 全关时），
   *  这时改跳详情页——那里印着拒绝的原因（r2vPriceIssue 整句），留在市场干瞪眼不行 */
  function pick(t: VideoTemplate) {
    if (useFlow.getState().applyTemplate(t)) nav("/flow");
    else nav(`/template/${t.id}`);
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">视频模板</h1>
        <span className="ml-auto text-[11px] text-slate-500">套上模板，一句话出片</span>
      </div>

      <div className="mb-3 flex gap-2">
        {(["market", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${tab === t ? "bg-brand text-ink" : "bg-panel text-slate-300"}`}
          >
            {t === "market" ? "模板市场" : `我的模板 ${myTemplates().length || ""}`}
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
                // 取回成功 = 本机多了一个白模模板（还等着核对编号）。切到「我的模板」，
                // 下面那条「编号待核对」的提示就跟着出来了 —— 那是发布前的必经一步
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
          上传白模预演视频，做一个能分享的白模模板
        </button>
      )}

      <div className="space-y-3">
        {list.map((t) => (
          <div key={t.id} className="space-y-1.5">
            <TemplateCard t={t} onPick={() => pick(t)} />
            {/* 核对编号的入口（两档：待核对 = 琥珀拦路条；核对过了 = 低调的"重新核对"）。
                ★★ 第二档不是锦上添花：作者多半是**确认完之后**才发现画面上有两个一样的号，
                  而"删掉那个找不到的位子"就在这一屏里 —— 没有常驻入口的话，他唯一的出路
                  是再花一次钱重炼整段（而服务端那边一直开着门）。
                ★ 判据、身份、刷新都在 RoleConfirmEntry 一处实现；这里只负责"摆在作者
                  自己的那一侧"（「我的模板」tab）。 */}
            {tab === "mine" && <RoleConfirmEntry t={t} />}
          </div>
        ))}
        {list.length === 0 && (
          <div className="py-16 text-center text-sm text-slate-500">
            {tab === "mine" ? "还没提取过模板——回简约模式上传一段参考视频试试" : "没有匹配的模板"}
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
