// 模板市场：简约模式的入口之一。别人发布的成功配方摆在这里，挑一个就能一句话出片。
//
// 与创意工坊的卡片市场刻意做成两个页面：卡片是"素材"（要自己组装成剧情），
// 模板是"成品配方"（一句话就出片）。混在一起会让新用户分不清该点哪个。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import Icon from "../components/Icon";
import BoxFramePicker, { boxMarksInSelection, type BoxFrameMode } from "../components/blockout/BoxFramePicker";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
// ★ 核对编号那一屏（含"删掉一个角色位"）迁到了 components/blockout/RoleConfirmSheet：
//   详情页 OwnerBar 要用同一个入口，一份实现两处用（两页各写一份必然分叉）
import { RoleConfirmEntry } from "../components/blockout/RoleConfirmSheet";
import { useSocialVersion } from "../components/SocialPanel";
import VideoTemplateExtractor from "../components/VideoTemplateExtractor";
import {
  blockoutJobExpired,
  blockoutJobNote,
  dismissBlockoutJob,
  browseTemplates,
  deleteTemplateEverywhere,
  detectTemplateRoles,
  myTemplates,
  pendingBlockoutIssue,
  pendingBlockoutJobs,
  prominentRoleWarning,
  refVideoIssue,
  refVideoPoster,
  refVideoRealSec,
  refreshPendingBlockoutJobs,
  refreshRemoteTemplate,
  remoteStateOf,
  remoteTemplatesCapable,
  resumeBlockoutize,
  setTemplatePublished,
  sharedLoadIssue,
  subscribeTemplates,
  templatesVersion,
  type BlockoutJob,
} from "../data/templates";
import { fmtTokens, ownRefTemplateCost } from "../data/economy";
import { readSocial } from "../data/social";
import { useFlow } from "../studio/flowStore";
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
}: {
  t: VideoTemplate;
  onPick?: () => void;
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

/**
 * 「去认一遍画面里有哪些人」的入口。**只对自己、只对白模模板**，两种情形：
 *   · **还没有角色位** → 第一次认（下面那段 ★★ 说的就是它）；
 *   · **已经有了、但一条都还没核对** → 重新认一遍。
 *
 * ★★★ 重认那一档是 2026-08-18 真机跑一遍才发现必须加的：老写法是
 *   `(t.roles?.length ?? 0) > 0` 就整个不出，于是一个用**旧提示词**认出来的模板
 *   （描述是「全白关节人偶」这种一句话）**永远升不上来** —— 拿不到多维描述、
 *   拿不到 `markDescs`，那句「有个特别显眼的人」也永远报不出来（它靠描述里的颜色）。
 *   而服务端**本来就允许**重认（只要没核对过）—— 是 App 把入口藏了。
 *   ⇒ 不加这一档的话，这一轮做的多维描述只对**今后新建**的模板生效，
 *     而存量模板的作者只能重传一遍视频、重新花一次钱。
 * ★ 允不允许重认只问 `remoteStateOf(t).rolesRedetectable` 一处（与服务端那道闸同源），
 *   别在这里写 `roles.some(...)` —— 写了就是同一条规则的第二处实现，
 *   而它漂了的表现是“摆一颗写着价钱、点下去却 400”的按钮。
 *
 * ★★ 它存在的理由就是那条路会失败：认人+量框要打上游，而上游耗时实测在 6.6s~140s
 *   之间浮动（连续调用会排队）。没有这个入口的话，一次抖动 = 作者永久拿到一个
 *   没有角色位的模板 —— 挂卡面板不出现、核对入口不出现，而他**看不出为什么，
 *   也无处重来**。服务端保证失败不留痕，所以再点一次就是干净的一次重试。
 * ★ 每点一次都**真花钱**（认人 + 量框都是计费的 chat），所以：① 按钮上把价钱说出来；
 *   ② 绝不做成自动重试。
 * ★ 结果三档都照实说（服务端回的 note 原样显示）：全成 / 有角色位没框 / 一个没认出来。
 */
function DetectRolesEntry({ t }: { t: VideoTemplate }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** AI 自己挑帧 / 我自己挑。★ 状态留在这一层：它只影响这一次识别，不进模板 */
  const [mode, setMode] = useState<BoxFrameMode>("auto");
  const [marks, setMarks] = useState<number[]>([]);
  // 只对**白模模板**（有参考视频）、**已登记**的自己那条出
  if (!t.refVideo || !t.remoteId) return null;
  const rs = remoteStateOf(t);
  if (rs?.isOwner === false) return null;
  const has = (t.roles?.length ?? 0) > 0;
  // ★ 已经核对过的不出：重认会把作者一条条改过的措辞整份冲掉，服务端也会 400。
  //   ★★ `rs` 为 null = 远端状态还没到货。已经有角色位时**往不出那一侧退**：
  //     摆一颗可能被服务端拒的付费按钮，比少一个入口坏。
  if (has && !rs?.rolesRedetectable) return null;
  const cost = ownRefTemplateCost();
  return (
    <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 px-3 py-2">
      <div className="text-[11px] leading-relaxed text-sky-100">
        {has ? (
          <>
            重新认一遍画面里的人：现在会给每个人偶写下
            <b className="font-bold">颜色、动作、他站在哪个景物旁</b>，套用出片时这几句会一并告诉 AI。
            <b className="font-bold">会覆盖现在这几行描述</b>（你自己改过的也会没），而且
            <b className="font-bold">按一次收一次费</b>。核对过之后就不能再重认了。
          </>
        ) : (
          <>
            这个模板还没有<b className="font-bold">角色位</b>——认一遍画面里有哪些人，套用时就能一个个挂卡
            （挂不上的话仍然可以用一句话描述要换谁）。
          </>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => {
            setBusy(true);
            setMsg("");
            // ★ 只有「自己挑」且真标了帧才传：`auto` 或一帧没标都发空，
            //   服务端那边 `pickedFrameCandidates` 退成 null → 自动铺法接手，
            //   与"没标"完全同一条路径（判据只在服务端一处，这里不另判）
            //   ★ 即使这条路没有选段（src 就是裁好的模板视频），也要走
            //     `boxMarksInSelection` —— 它是"标记 → 提交值"的唯一实现。今天两者结果
            //     相同（marks 插入时已量化+排序+判重），但那个函数再加一条规则时，
            //     这里手写的一份会**静默分叉**，正是它自己的注释要防的形状。
            void detectTemplateRoles(t.id, mode === "manual" ? boxMarksInSelection(marks).atSecs : undefined)
              .then((note) => setMsg(note || "认好了 ✓"))
              .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
          className="flex-none rounded-full bg-sky-400 px-3 py-1 text-[11px] font-bold text-ink disabled:opacity-50"
        >
          {busy ? "识别中…（要一到几分钟）" : `${has ? "重新识别角色位" : "识别角色位"}（${fmtTokens(cost)}）`}
        </button>
        {msg && <span className="min-w-0 flex-1 text-[10px] leading-relaxed text-sky-200">{msg}</span>}
      </div>
      {/* ★★ 挑帧摆在**这一屏**而不是登记那一步：这颗按钮多半是**重试**用的
          （第一次是登记时自动跑的），而重试正是"自动那条没认全、我来指一帧"的时刻。
          ★ 报价不随标几帧变：服务端依次试、第一个成的就停，上限本来就是
            BLOCKOUT_BOX_TRIES —— 标 1 帧和标满都在同一个上限内，报的一直是那个上限。 */}
      <div className="mt-2">
        <BoxFramePicker
          mode={mode}
          onModeChange={setMode}
          src={t.refVideo.url}
          marks={marks}
          onMarksChange={setMarks}
          disabled={busy}
        />
      </div>
    </div>
  );
}

/**
 * 作者自己那条模板下面的一行操作：**发布** / **下架** / **删除**。
 *
 * ★★ 为什么摆在列表里而不是只留在详情页：这两件事在此之前**只有详情页有入口**，
 *   而用户想做它们的那一刻，人正站在列表上看着那条模板。少一跳不是省事，是
 *   "功能存在"与"用户找得到"之间的差别 —— 在此之前它俩等于不存在。
 * ★ 判据、网络、本机同步**全在 data 层**（setTemplatePublished / deleteTemplateEverywhere），
 *   这里一行业务逻辑都没有（铁律六；详情页 OwnerBar 也是这么写的）。
 * ★★ 「是不是我的」：**本机库里有这条 = 就是我的**（`mine` 按定义只装自己的模板），
 *   否则才去问服务端的 `isOwner`（市场里别人那些条目走这一支）。
 *   ⚠ 我第一版写成"有 remoteId 就只认服务端 isOwner"，结果在真机上**整行都不出现** ——
 *   本机那两条的远端状态拉不到（服务端记录已被删），`isOwner` 是 undefined，于是判否。
 *   而那恰恰是最需要删除入口的时候：一条服务端已经没有、本机还赖着的幽灵模板。
 *   ⇒ 别拿"服务端说了算"去否掉一个本来就属于本机的事实。
 * ★ 拿 `author` 显示名比身份仍然是禁止的（CLAUDE.md 那条坑）—— 这里判的是本机库成员资格。
 * ★ 删除同样是**两段式**（与详情页那颗同一条理由：会连带销毁云端视频，不可撤销）。
 */
function OwnerRow({ t }: { t: VideoTemplate }) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState("");
  const st = remoteStateOf(t);
  const local = myTemplates().some((x) => x.id === t.id);
  const isMine = local || st?.isOwner === true;
  // ★ 判据只有 data 层那一处（颜色异类 ∧ 就在正中）。这里只负责在**发布之前**把它说出来。
  const prominent = prominentRoleWarning(t.roles ?? [], t.markSlots, t.markBoxes);
  if (!isMine) return null;
  // ★ 已发布与否：远端状态拿得到就以它为准（那是权威），拿不到退回本机镜像
  const published = st ? st.status === "published" : t.published;
  const blocked = st?.status === "blocked";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setArmed(false);
    }
  }

  return (
    <div data-guide="template-owner-row" className="flex flex-wrap items-center gap-2 px-1">
      {/* 只在**已发布**时给「下架」：没发布的模板本来就不在市场上，摆一颗点了没变化的
          按钮，用户只会以为它坏了（本仓明令禁止「摆一个永远点不动的选项」） */}
      {published && (
        <button
          onClick={() => void run(() => setTemplatePublished(t.id, false))}
          disabled={busy}
          className="rounded-full bg-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-100 disabled:opacity-40"
        >
          从市场下架
        </button>
      )}

      {/* ★★ 发布（2026-08-17 补）。在此之前整条发布链路都在（服务端 PATCH …/publish、
          data.setTemplatePublished、详情页 OwnerBar），**唯独列表里没有入口** ——
          而这一屏上到处在提发布：待核对那条琥珀提示写着「核对之前不能发布」，空态写着
          「做一个自己的、发布出来，这里就有了」。都在说发布，却没有一处能发布。
          当初只加下架/删除的取舍是"别摆点不动的按钮"，发布压根没进那次范围。

          ★★★ 这里**绝不重写服务端那四道闸**（已被平台下架 / 视频时长 / 没试炼过 /
            角色位未核对）。判据只有 data.setTemplatePublished 一处，失败就把它抛出来的
            整句原样印在下面（`err`）—— 列表行拿不到、也不该拿试炼闸的解释位。
          ★★ 但**只印一句话不够**：那几道闸的出路（去出一段片试炼、去核对角色位）
            全都在详情页。只印错误不给下一步，就是把「点了没反应」从一颗按钮换到另一处
            （铁律八要的是"响亮 + 有下一步"）。所以失败时紧跟一个「去详情页处理」。
          ★ blocked 不给按钮：平台下架后作者的 publish/unpublish 服务端两条路由都会 400，
            这是唯一一种"确定点不动"的状态，照本仓规矩不摆按钮、只说一句话。 */}
      {/* ★★★ 发布前把「这个模板会让别人换错人」说出来（2026-08-18 加，十发实拍换来的）。
          判据只有 `prominentRoleWarning` 一处：**颜色异类 ∧ 它就在正中**。
          实测这一档 5 发全错（换掉的都是那个异类，不管点名谁），而没有异类的全白素材
          点名最难的一档也换对了 —— 也就是说这不是"有时候会错"，是**这类素材必错**。
          ★ 为什么要摆在**发布**这一步而不是只在挂卡面板说：挂卡那句是给套用者看的，
            而他是**付了 r2v 的钱之后**才看见结果的人；作者按下发布，就是让每一个套用者
            各踩一次。这一句是唯一能在"扩散出去之前"拦一下的地方。
          ★ **只警告、不拦**（与本仓其它启发式同一条纪律）：判据是启发式，误报的代价是
            作者多看一句可以忽略的话，漏报的代价是退回现状。真要拦得有更硬的判据。 */}
      {!published && prominent && (
        <p className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-100">
          {prominent}
        </p>
      )}
      {blocked ? (
        <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300">已被平台下架</span>
      ) : (
        !published && (
          <button
            onClick={() => void run(() => setTemplatePublished(t.id, true))}
            disabled={busy}
            className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-bold text-ink disabled:opacity-40"
          >
            {busy ? "发布中…" : "发布到市场"}
          </button>
        )
      )}
      <button
        onClick={() => {
          if (!armed) {
            setArmed(true);
            window.setTimeout(() => setArmed(false), 3000);
            return;
          }
          void run(() => deleteTemplateEverywhere(t.id));
        }}
        onBlur={() => setArmed(false)}
        disabled={busy}
        className={`ml-auto rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40 ${
          armed ? "bg-rose-500 font-bold text-white" : "text-rose-400"
        }`}
      >
        {armed ? "真的删掉？（连云端视频一起）" : "删除"}
      </button>
      {/* ★★ 整句印出来、**不 truncate**：这里躺的是服务端那四道闸的原话（「还没核对」
          「发布前须真实出过一次片」…），截成一行省略号等于没说。改造前它是 truncate 的，
          而那时行里还没有会失败的操作 —— 加了发布之后这一条就变成了主要的信息出口。
        ★ 「去详情页处理」是那句话的**下一步**：试炼与核对的入口都只在详情页。 */}
      {err && (
        <p className="w-full text-[10px] leading-relaxed text-rose-300">
          {err}{" "}
          <Link to={`/template/${t.id}`} className="font-bold text-sky-300 underline">
            去详情页处理
          </Link>
        </p>
      )}
    </div>
  );
}

export default function TemplateMarketPage() {
  const ver = useTemplatesVersion();
  useSocialVersion();
  // 第一次进这一屏强制放一遍引导（看过一次不再自动弹；那颗 ? 随时能重看）
  useAutoGuide("templates");
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
        <HelpButton tour="templates" />
      </div>

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
        {list.map((t, i) => (
          <div key={t.id} className="space-y-1.5">
            {/* 引导锚点只挂第一张。这一屏是竖着滚的长列表、不是轮播，第一张不会横向滑走，
                所以用下标判就够（CreatePage 那边必须跟着当前页走，是因为三张并排且都在 DOM 里）。
                挂满每一张也没用：GuideOverlay 拿的是 querySelector 的第一个。 */}
            <TemplateCard
              t={t}
              onPick={() => pick(t)}
              guide={i === 0 ? "template-card" : undefined}
              guidePick={i === 0 ? "template-pick" : undefined}
            />
            {/* 核对编号的入口（两档：待核对 = 琥珀拦路条；核对过了 = 低调的"重新核对"）。
                ★★ 第二档不是锦上添花：作者多半是**确认完之后**才发现画面上有两个一样的号，
                  而"删掉那个找不到的位子"就在这一屏里 —— 没有常驻入口的话，他唯一的出路
                  是再花一次钱重炼整段（而服务端那边一直开着门）。
                ★ 判据、身份、刷新都在 RoleConfirmEntry 一处实现；这里只负责"摆在作者
                  自己的那一侧"（「我的模板」tab）。 */}
            {tab === "mine" && <RoleConfirmEntry t={t} />}
            {tab === "mine" && <DetectRolesEntry t={t} />}
            {/* 下架 / 删除：**只对自己的模板出**，两个 tab 都出（作者在市场里看到自己
                那条挂着，最想做的就是把它拿下来，让他先点进详情页再找是白绕一圈）。 */}
            <OwnerRow t={t} />
          </div>
        ))}
        {/* ★★ 空态要分得清**三件不同的事**（2026-08-17 种子模板删掉之后，市场真的会空）：
              ① 搜了没搜到 —— 用户自己知道怎么办（换个词），一句话就够；
              ② 市场真的空 —— 这不是故障，但也别只说"没有匹配的模板"（他没搜任何东西，
                 那句话会让人以为是筛选出了问题）。说清楚现状 + 给一条能走的路；
              ③ 拉不到远端 —— 那是**故障**，由上面的 sharedLoadIssue 横幅负责说，
                 这里不重复、也不冒充成"市场是空的"。
            ⚠ 别退回一句放之四海的"暂无数据"：三种情形的下一步动作完全不同。 */}
        {list.length === 0 && (
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
