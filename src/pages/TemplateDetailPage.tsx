// 模板详情页：封面 + 简介 + 生成配方（画风/分镜骨架）+ 自带素材卡 + 互动区。
//
// 配方是明着给的，不藏——用户看得见"为什么这个模板出片像"，才知道该不该用它，
// 也才能照着改出自己的版本。这与卡片详情页展示「生成蓝图」是同一个主张。
//
// 白模模板（t.refVideo 存在，判定一律写存在性，types.ts 的 ★）在此之上多三块：
//   · 参考视频就地预览 + 套用成本行（r2v 连输入视频时长也计费，必须写明——
//     "42<70 所以更便宜"的直觉是反的）；
//   · 作者侧的发布状态机：登记（pending）→ 试炼（provenAt，作者先用它真实出过一次片）
//     → 发布（published）。状态的权威在服务端，这里只显示与转发；
//   · 身份判定走服务端按 ownerId 算的 isOwner——**绝不拿显示名比对**。
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import Icon from "../components/Icon";
// ★ 与市场页共用同一个核对入口/面板（含"删掉一个角色位"）。两页各写一份必然分叉，
//   而这一屏说的话直接决定作者会不会去重炼（花第二次钱）
import { RoleConfirmEntry } from "../components/blockout/RoleConfirmSheet";
import TarotCard from "../components/TarotCard";
import SocialPanel, { useCountView, useSocialVersion } from "../components/SocialPanel";
import { useTemplatesVersion } from "./TemplateMarketPage";
// ★ 「进挂卡编辑页要带什么、回哪儿」只有一处实现（FlowPage 导出的 castEditorState）：
//   收结果的是工作流页，入参形状与回程键写错一个字母的表现是"回来了但什么都没发生"，
//   两页各拼一份必然分叉（铁律六）。
import { castEditorState } from "./FlowPage";
import {
  deleteTemplateEverywhere,
  fetchRemoteTemplateById,
  getTemplate,
  myTemplates,
  refreshRemoteTemplate,
  refVideoIssue,
  refVideoOwnerNote,
  refVideoRealSec,
  registerIssueOf,
  registerTemplate,
  remoteStateOf,
  setTemplatePublished,
  updateTemplate,
} from "../data/templates";
import { VIDEO_TIERS, fmtTokens, r2vPriceIssue, r2vTokens } from "../data/economy";
import { useCurrentUser } from "../hooks/useAccount";
import { useFlow } from "../studio/flowStore";
import { CARD_TYPE_LABELS, VideoTemplate } from "../types";

/**
 * 白模出片会走哪一档。refVid 的**唯一出处**是 economy.VIDEO_TIERS（开闸 = 仓库主人翻
 * ultra 那一个布尔的 commit）——flowStore.applyTemplate 的档位钳制读的也是这张表的
 * 同一个标志，这里只是对同一张表的另一次读取，不是第二份"开没开"的登记处。
 */
function blockoutGate() {
  return VIDEO_TIERS.find((x) => x.refVid) ?? null;
}

/**
 * 闸门整句（null = 能出片能报价）。gate 不存在时的措辞与 flowStore.applyTemplate 一致。
 * ★ 第二段是**模板视频自己合不合方舟窗口**（唯一判据在 data/templates.refVideoIssue）：
 *   3.7 秒的坏模板以前在这一页全程绿灯，点下去才在方舟撞英文 400 —— 而那句 400
 *   全 app 没人接（没有全局 error toast），用户只会以为按钮坏了。
 */
function blockoutIssue(t: VideoTemplate): string | null {
  const gate = blockoutGate();
  if (!gate) return "白模模板出片暂未开放：还没有档位支持白模（r2v）出片，等开放后再来";
  return r2vPriceIssue(gate.id) ?? refVideoIssue(t.refVideo);
}

/** 白模区：参考视频预览 + 套用成本行。`isOwner` 只影响**措辞**（坏模板对作者要说清
 *  "不是你操作错了"以及重做时怎么才对），判据两边都只有 refVideoIssue 一处。 */
function BlockoutInfo({ t, isOwner }: { t: VideoTemplate; isOwner: boolean }) {
  if (!t.refVideo) return null;
  const gate = blockoutGate();
  const issue = blockoutIssue(t);
  // issue 为 null 时 gate 必然存在且报得出价（r2vPriceIssue 先查 refVid 再查 r2vMult）
  const tokens = issue === null ? r2vTokens(t.refVideo.durationSec, gate!.id) : null;
  const realSec = refVideoRealSec(t.refVideo);
  const ownerNote = isOwner ? refVideoOwnerNote(t.refVideo) : null;
  return (
    <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
      {/* ★ 计价锚点（durationSec，整数）与文件真实秒数（realDurationSec，小数）**都说**：
          只说锚点会让"按 4 秒收费、文件其实 3.7 秒"这件事永远看不见；只说真实秒数又对不上
          账单。老模板没有真实秒数（后加字段，缺一律当好），那时就只显示锚点。 */}
      <div className="mb-2 text-xs font-semibold text-sky-300">
        ⬜ 白模模板 · 参考视频 {realSec !== null ? `约 ${realSec.toFixed(1)}s（按 ${t.refVideo.durationSec} 秒计费）` : `${t.refVideo.durationSec}s`}
      </div>
      <video
        src={t.refVideo.url}
        controls
        playsInline
        preload="metadata"
        className="mb-2 max-h-72 w-full rounded-lg bg-black"
      />
      <p className="text-[11px] leading-relaxed text-slate-400">
        套用出片时 AI 会整段复刻这段视频的场景、道具与运镜，只把主角位（红色小人）换成你挂的角色卡。
        出片时长≈模板时长、画幅自适应模板视频。
      </p>
      {/* ★ 作者本人先看这一句：坏模板对他来说不是"换一个"，而是"这不是你的错、重做时至少
          选 5 秒"。它替代（不是叠加）下面那句给套用者的话 —— 两句一起显示会让作者以为
          出了两个错。判据同一处（refVideoOwnerNote 内部先问 refVideoIssue）。 */}
      {ownerNote ? (
        <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200">
          {ownerNote}
        </p>
      ) : issue !== null ? (
        // 看得见但点不动 + 说原因（闸没开 / 价没核 / 模板视频不合窗口，整句都来自各自的唯一实现）
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300/90">{issue}</p>
      ) : (
        tokens !== null && (
          <p className="mt-2 text-[11px] leading-relaxed text-slate-300">
            套用一次约 <b>{fmtTokens(tokens)}</b> token（「{gate!.label}」档 · 含模板视频
            <b>按 {t.refVideo.durationSec} 秒计</b>的输入费——r2v 连输入视频的时长也计费，输出时长按≈模板时长估
            {realSec !== null ? `；这段模板视频实际约 ${realSec.toFixed(1)} 秒，计费按整秒向上取` : ""}）
          </p>
        )
      )}
    </div>
  );
}

/** 作者本人才能看到的发布/改名区。发布 = 进模板市场供别人使用。
 *  经典配方照旧翻本机布尔；白模走服务端状态机（登记 → 试炼 → 发布），
 *  两条路的发布/删除都收口在 data/templates 的 setTemplatePublished /
 *  deleteTemplateEverywhere（铁律六：页面不各自去调 branch API）。 */
function OwnerBar({ t, inMine, onApply }: { t: VideoTemplate; inMine: boolean; onApply: () => void }) {
  const nav = useNavigate();
  const [title, setTitle] = useState(t.title);
  const [intro, setIntro] = useState(t.intro);
  const [busy, setBusy] = useState(false);
  const [opErr, setOpErr] = useState("");
  const dirty = title !== t.title || intro !== t.intro;
  const blockout = !!t.refVideo;
  const rs = remoteStateOf(t);
  const regIssue = registerIssueOf(t.id);

  /** 异步操作的统一收口：失败把 message 印出来（全 app 没人监听 emitApiError，
   *  这里不接住就是静默失败——铁律八） */
  async function run(op: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setOpErr("");
    try {
      await op();
    } catch (e) {
      setOpErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 白模的发布区按远端状态机走；经典配方保持原来的一颗切换按钮 */
  function publishArea() {
    if (!blockout) {
      return (
        <button
          onClick={() => void run(() => setTemplatePublished(t.id, !t.published))}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${t.published ? "bg-slate-700 text-slate-200" : "bg-brand text-ink"}`}
        >
          {t.published ? "取消发布" : "发布到模板市场"}
        </button>
      );
    }
    // 还没登记上（saveTemplate 之后的异步登记失败了 / 还在路上）
    if (!t.remoteId) {
      return regIssue ? (
        <button
          onClick={() => void run(() => registerTemplate(t.id))}
          disabled={busy}
          className="rounded-full bg-amber-500/90 px-3.5 py-1.5 text-xs font-bold text-ink disabled:opacity-50"
        >
          重新登记到服务器
        </button>
      ) : (
        <span className="rounded-full bg-slate-700/60 px-3.5 py-1.5 text-xs text-slate-300">正在登记到服务器…</span>
      );
    }
    if (rs?.status === "blocked") {
      return <span className="rounded-full bg-rose-500/15 px-3.5 py-1.5 text-xs text-rose-300">已被平台下架</span>;
    }
    if (t.published) {
      return (
        <button
          onClick={() => void run(() => setTemplatePublished(t.id, false))}
          disabled={busy}
          className="rounded-full bg-slate-700 px-3.5 py-1.5 text-xs font-bold text-slate-200 disabled:opacity-50"
        >
          取消发布
        </button>
      );
    }
    // 试炼闸：provenAt 由服务端在「作者本人的 r2v 任务真实出片成功」时写入，
    // 这里只显示。没过闸也把发布按钮亮着——点了会得到服务端那句 400 整句
    // （比灰按钮多一次确认机会，且文案永远与服务端一致）
    return (
      <button
        onClick={() => void run(() => setTemplatePublished(t.id, true))}
        disabled={busy}
        className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-ink disabled:opacity-50"
      >
        {rs?.provenAt ? "发布到模板市场" : "发布（需先试炼）"}
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-700/70 bg-panel p-3">
      <div className="mb-2 text-xs font-semibold text-slate-300">✎ 模板信息（只有你能改）</div>
      {/* 改名改简介写的是本机库；换设备后本机没有这条记录，改了也无处可存（V1 服务端
          没有元数据编辑端点）——藏掉输入框，只留下架/删除这些走服务端的操作，
          别摆一个"保存了却什么都没发生"的假按钮 */}
      {!inMine && (
        <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
          这台设备上没有它的本机记录（换了设备？）。可以在这里下架或删除；改名/改简介需回到当初提取它的设备。
        </p>
      )}
      {inMine && (
        <>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="模板名"
            className="mb-2 w-full rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
          />
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={2}
            placeholder="一句话说明这个模板能做什么样的片子"
            className="mb-2 w-full resize-none rounded-lg border border-slate-700 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand"
          />
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {inMine && (
          <button
            onClick={() => updateTemplate(t.id, { title: title.trim() || t.title, intro: intro.trim() })}
            disabled={!dirty}
            className="rounded-full bg-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-100 disabled:opacity-40"
          >
            保存
          </button>
        )}
        {publishArea()}
        <button
          onClick={() => void run(async () => {
            await deleteTemplateEverywhere(t.id);
            nav("/templates");
          })}
          disabled={busy}
          className="ml-auto rounded-full px-3 py-1.5 text-xs text-rose-400 disabled:opacity-50"
        >
          删除
        </button>
      </div>
      {/* ★★ 核对角色位的入口（白模 V2，两档常驻）：作者是从**这一页**点的发布，而发布闸的
          两道门之一就是它 —— 撞了 400 之后这里必须有下一步，不能只把整句印在下面
          （改造之前正是那样：opErr 里躺着一句"还没核对"，页面上却没有任何地方能去核对，
          而作者一旦点过一次「我已逐个核对」，市场页那条琥珀提示也消失了）。
          ★ 第二档（已核对）也留着：画面上有个人根本没被换成人偶 / 两个人的颜色对调了
          （老编号模板则是两个一样的号、某个号找不到）时，出路是回这一屏把那个位子**删掉**
          或对调两行，不是再花一次钱重炼整段。
          ★ 列表页与详情页都**不加"颜色版/编号版"徽章**：那个区别对套用者没有任何可操作性，
          他不会因为这个标签改变要不要套用，只会看不懂。两种模板的差异靠界面本身体现
          （核对入口的文案、核对面板的标题、挂卡那一屏的引导句）—— 那才是说了有用的地方。
          ★ 判据与身份不在这里重写：这一整块本来就只对作者渲染（isMine），
          入口内部只问 remoteStateOf 那份快照。 */}
      {/* empty:hidden —— 入口对经典配方/没角色位的模板返回 null，那时这个壳不该留下一道空白 */}
      <div className="mt-2 empty:hidden">
        <RoleConfirmEntry t={t} />
      </div>
      {/* 白模的试炼闸说明与操作：发布前须用本模板真实出过一次片。
          为什么有这道门也要说给作者听——方舟任务受理后失败不退费，坏模板的钱
          该坏在作者自己那一次，不该让每个套用的人各赔一次 */}
      {blockout && t.remoteId && rs?.status !== "blocked" && !t.published && (
        <div className="mt-2 rounded-lg bg-black/25 px-2.5 py-2 text-[11px] leading-relaxed text-slate-400">
          {rs?.provenAt ? (
            <span className="text-emerald-300">✓ 试炼通过——你已经用这个模板真实出过片，可以发布了。</span>
          ) : (
            <>
              发布前须用本模板<b>真实出过一次片</b>（套用它、挂上角色卡、付费出一段）——这一步能确保套用你模板的人不会白花钱。
              <span className="mt-1 flex gap-2">
                <button onClick={onApply} className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] text-slate-100">
                  去出一段片
                </button>
                <button
                  onClick={() => void run(() => refreshRemoteTemplate(t.id))}
                  disabled={busy}
                  className="rounded-full bg-slate-700/60 px-2.5 py-1 text-[11px] text-slate-300 disabled:opacity-50"
                >
                  出过了？刷新状态
                </button>
              </span>
            </>
          )}
        </div>
      )}
      {/* 登记失败的原因要印在页面上（重试按钮在上面）。regIssue 来自 data/templates
          的登记旁路——不印的话它只活在 console 里，用户面对的是"发布按钮永远没反应" */}
      {blockout && !t.remoteId && regIssue && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-300/90">{regIssue}</p>
      )}
      {blockout && t.remoteId && (
        <p className="mt-2 text-[10px] text-slate-500">
          标题/简介的修改只改本机显示；市场里展示的是登记那一刻的版本。
        </p>
      )}
      {opErr && <p className="mt-2 text-[11px] leading-relaxed text-rose-400">{opErr}</p>}
      {t.published && <p className="mt-2 text-[10px] text-slate-500">已在模板市场公开，别人可以直接套用出片。</p>}
    </div>
  );
}

export default function TemplateDetailPage() {
  useTemplatesVersion();
  useSocialVersion();
  const { id } = useParams();
  const nav = useNavigate();
  const user = useCurrentUser();
  useCountView("template", id);
  const t = id ? getTemplate(id) : null;
  const [applyErr, setApplyErr] = useState("");
  // 远端回源的结论：null = 还没试/在试，false = 真取不到。直达详情路由（会话恢复、
  // 分享链接）时 shared 缓存是空的——先回源再下"不存在"的结论，别对着一个真实存在的
  // 模板撒谎（回源实现在 data/templates.fetchRemoteTemplateById，取到会 emit 触发重渲）
  const looksRemote = !!id && /^[0-9a-f]{24}$/i.test(id);
  const [remoteMiss, setRemoteMiss] = useState(false);

  // 打开详情就刷新一次远端状态（provenAt 是服务端在出片轮询里写的，本机不刷新
  // 永远不知道试炼过没过）。refreshRemoteTemplate 对没登记/离线的模板是空操作
  useEffect(() => {
    if (id) void refreshRemoteTemplate(id);
  }, [id]);

  useEffect(() => {
    if (!id || t || !looksRemote) return;
    let alive = true;
    void fetchRemoteTemplateById(id).then((ok) => {
      if (alive && !ok) setRemoteMiss(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t 到货靠 emit 重渲，这里只在 id 变化时回源
  }, [id, looksRemote]);

  if (!t) {
    if (looksRemote && !remoteMiss) {
      return (
        <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
          <p className="text-sm text-slate-400">正在从服务器取这个模板…</p>
        </div>
      );
    }
    return (
      <div className="safe-top flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6">
        <Icon name="cards" size={40} className="text-slate-600" />
        <p className="text-sm text-slate-400">这个模板不存在或已被作者删除</p>
        <Link to="/templates" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          去模板市场
        </Link>
      </div>
    );
  }

  // 身份判定：
  //   · 白模路**绝不拿显示名比对**——服务端按 ownerId 对当前 JWT 算的 isOwner 是唯一
  //     权威（remoteStateOf）；登记还没完成（没有远端状态）时退回「本机库里有这条」
  //     （它就是这台设备刚提取的，连显示名都还没机会变）。
  //   · 经典路保留存量判定原样（含拿 user?.name 比对这个已知坑——CLAUDE.md「拿名字
  //     当身份」，另立任务修存量，这里只保证新路径不复刻它）。
  const inMine = myTemplates().some((x) => x.id === t.id);
  const rs = remoteStateOf(t);
  const isMine = t.refVideo ? (rs ? rs.isOwner : inMine) : inMine && user?.name === t.author;

  // 白模在闸门没开 / 模板视频本身不合方舟窗口时「看得见但点不动 + 说原因」
  // （原因印在 BlockoutInfo 的成本行里，作者本人看到的是另一句措辞）
  const applyBlocked = t.refVideo ? blockoutIssue(t) : null;

  function apply() {
    if (!t) return;
    setApplyErr("");
    // applyTemplate 返回 false = 被闸门整句拒绝（err 在 flow store 里）——把原因就地
    // 印出来，不能让按钮看起来"点了没反应"（铁律八）
    if (!useFlow.getState().applyTemplate(t)) {
      setApplyErr(useFlow.getState().err || "套用失败");
      return;
    }
    // ★★ V2 白模（有角色位）：**先领去挂卡**，再进工作流。
    //   判据是存在性（`roles?.length`，types.ts 的 ★），所以老模板（没有 roles）
    //   与经典配方模板走的还是原来那一行 nav("/flow")，一个字都没变。
    //   为什么不让用户先落到工作流页再自己找入口：这条路上"谁换成谁"全靠挂卡，
    //   没挂卡的 V2 节点连要求输入框都是空的（点名句由挂卡合成），用户在那里
    //   除了发呆没有别的可做。工作流页仍留着「改挂卡」入口，从模板市场直接套用
    //   （那一页不在本次施工位）进来的人靠它补上这一步。
    //   ⚠ 入参形状与回程约定见 VideoEditorPage 顶部注释；结果由 FlowPage 收。
    const castState = castEditorState(t);
    if (castState) nav("/video-editor", { state: castState });
    else nav("/flow");
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => nav(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
          <Icon name="back" size={18} className="text-slate-300" />
        </button>
        <h1 className="text-base font-bold text-slate-100">模板详情</h1>
        {!t.published && isMine && (
          <span className="ml-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">未发布</span>
        )}
      </div>

      <div className="mb-3 overflow-hidden rounded-2xl bg-black/40">
        {t.cover && <img src={t.cover} alt="" className="aspect-[16/10] w-full object-cover" />}
      </div>

      <h2 className="text-lg font-bold text-slate-100">{t.title}</h2>
      <div className="mt-0.5 mb-2 text-xs text-slate-500">
        @{t.author} ·{" "}
        {/* ★ 有真实秒数就报真实的：这一行是"这个模板长什么样"，不是账单。
            计价那个整数锚点在下面 BlockoutInfo 的成本行里说清楚。 */}
        {t.refVideo
          ? `白模复刻 · 模板视频 ${(refVideoRealSec(t.refVideo) ?? t.refVideo.durationSec).toFixed(1)}s`
          : `${t.recipe.beats.length} 段 · 每段 ${t.recipe.durationSec}s`}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-slate-300">{t.intro}</p>

      <BlockoutInfo t={t} isOwner={isMine} />

      <button
        onClick={apply}
        disabled={!!applyBlocked}
        title={applyBlocked ?? undefined}
        className="mb-1 block w-full rounded-xl bg-brand py-3 text-center text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
      >
        ⚡ 用这个模板出片{t.refVideo ? "（挂上你的角色卡）" : "（只需一句话）"}
      </button>
      {applyErr && <p className="mb-3 text-xs leading-relaxed text-rose-400">{applyErr}</p>}
      <div className="mb-3" />

      {/* 生成配方：明着给，用户才知道它为什么像，也才能照着改 */}
      <div className="mb-4 rounded-xl border border-slate-700/70 bg-panel p-3">
        <div className="mb-2 text-xs font-semibold text-slate-300">🧪 生成配方</div>
        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">画面质感与运镜</div>
          <p className="text-xs leading-relaxed text-slate-400">{t.recipe.styleHint}</p>
        </div>
        <div className="mb-2">
          <div className="mb-1 text-[11px] text-slate-500">分镜骨架（{"{{主题}}"} 会换成你那句话）</div>
          <ol className="space-y-1">
            {t.recipe.beats.map((b, i) => (
              <li key={i} className="rounded-lg bg-black/25 px-2.5 py-1.5 text-xs leading-relaxed text-slate-300">
                <span className="mr-1.5 text-slate-500">{i + 1}.</span>
                {b}
              </li>
            ))}
          </ol>
        </div>
        {t.source && (
          <div>
            <div className="mb-1 text-[11px] text-slate-500">参考画面特征</div>
            <p className="text-xs leading-relaxed text-slate-500">{t.source}</p>
          </div>
        )}
      </div>

      {t.cards.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-semibold text-slate-300">🎴 模板卡组 · {t.cards.length} 张</div>
          <div className="grid grid-cols-3 gap-2">
            {t.cards.map((c) => (
              <Link key={c.id} to={`/card/${c.id}`} state={{ card: c }}>
                <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 白模路：isMine 来自服务端 isOwner——**不要**再 && inMine（换设备后本机库
          是空的，但作者对自己已发布的模板必须仍有下架/删除入口，否则作废/侵权模板
          只能干挂在市场上被人付费套用）。经典路 isMine 本身就含 inMine，行为不变 */}
      {isMine && <OwnerBar t={t} inMine={inMine} onApply={apply} />}

      <SocialPanel kind="template" id={t.id} />
    </div>
  );
}
