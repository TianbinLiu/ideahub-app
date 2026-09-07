// 作品编辑页（仅作者可进）：改标题 / 分类 / 简介 / 封面 / 可见性、**回炉重做**、删除整部作品。
//
// ★ 这一页有两件性质完全不同的事，别把它们混成一件：
//     · **改壳**（标题/分区/简介/标签/封面/可见性）—— PATCH 七个字段，观众看到的内容不变；
//     · **回炉重做**（下面那颗 🛠）—— 把发布时留存的工坊工程取回工坊接着改，再走同一条
//       PATCH **换掉成片内容**。同一个链接、同一批播放/点赞/评论，但**内容变了**。
//   所以回炉那颗键前面有一张确认卡，卡上当面报出真实的播放/收藏/弹幕数，并**提前**说清楚
//   提交之后会清空多少条弹幕（弹幕的 at 是全片累计秒、没有段落锚点，内容一换必然错位）。
//
// ★ 2026-08 曾有「🛠 工坊重制某一 P」「＋ 新增一 P」「删除某一 P」，删掉的两条理由是
//   ①观众零知情 ②它只写本地（服务端没有 parts 字段，PATCH 上去被 strip）。
//   2026-09-07 回炉重新做起来的时候两条都被逐条堵上了（版次下发 + 收藏者通知 + 确认卡报数；
//   每一条写路径都落在服务端 + revision 乐观锁）。但**分集（parts）不复活**：
//   回炉替换的是整条作品的 segments，多 P 的**读**路径照旧保留，老作品的分集照常播。
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import PageHeader from "../components/PageHeader";
import EmptyState from "../components/EmptyState";
import ConfirmDialog from "../components/ConfirmDialog";
import { Link, useNavigate, useParams } from "react-router";
import { CoverSection } from "../components/CoverPicker";
import TagInput from "../components/TagInput";
import VisibilityPicker from "../components/VisibilityPicker";
import { deleteVideoItem, getVideo, isMyAuthor, isUploading, partsOf, updateVideoMeta } from "../data/videos";
import { coverToPermanentUrl } from "../data/publishAssets";
import * as projects from "../data/projects";
import { danmakuFetched, danmakuOf, danmakuVersion, subscribeDanmaku } from "../data/danmaku";
import { useStudio } from "../studio/studioStore";
import { useApplyTemplate } from "../components/flow/useApplyTemplate";
import { useVideosVersion } from "../hooks/useVideos";
import { VIDEO_CATEGORIES, VIDEO_TAG_LEN, VIDEO_TAG_MAX, type Visibility, formatDuration, parseTags, segsTotal, visibilityOf, visibilityWire } from "../types";

export default function EditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const version = useVideosVersion();
  const video = useMemo(() => (id ? getVideo(id) : null), [id, version]);
  const parts = useMemo(() => (video ? partsOf(video) : []), [video, version]);

  const [title, setTitle] = useState(video?.title ?? "");
  const [category, setCategory] = useState(video?.category ?? "剧情");
  const [description, setDescription] = useState(video?.description ?? "");
  const [cover, setCover] = useState(video?.cover ?? "");
  const [tags, setTags] = useState<string[]>(video?.tags ?? []);
  // ★ 界面上是三档，线上是两个字段 —— 映射只在 types.visibilityOf/visibilityWire 两处
  const [visibility, setVisibility] = useState<Visibility>(video ? visibilityOf(video) : "public");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  // 删除现在要等服务端确认（见 videos.deleteVideoItem 的 ★★），所以这一格自己扛
  // "在删"和"没删成的原因"——失败后弹层一关、原因没了，就又回到"点了没反应"
  const [deleting, setDeleting] = useState(false);
  /** 确认卡上那条失败原因。★ 带 kind：这张卡上有两个会失败的动作（删除、改成仅自己可见），
   *  不分开的话改可见性失败会让**删除键**变成「再试一次」——按下去删的是作品 */
  const [delErr, setDelErr] = useState<{ why: string; kind: "delete" | "soft" } | null>(null);

  // ── 回炉重做 ────────────────────────────────────────────
  // 工程列表在这一页挂载时才问（那是唯一要用它的地方，理由见 data/projects.readyProjects 的 ★）
  useSyncExternalStore(projects.subscribeProjects, projects.projectsVersion);
  useEffect(() => {
    void projects.readyProjects();
  }, []);
  // 弹幕条数要**当面报真数**：同步读内存那份，第一次问会顺手在后台拉一次，到货 emit
  useSyncExternalStore(subscribeDanmaku, danmakuVersion);
  /** 确认卡开着 */
  const [reforgeAsk, setReforgeAsk] = useState(false);
  /** 正在取回工程（整页态）/ 取回失败那句原话 */
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState("");
  /** 上一次取回失败是不是「留存的那份画布描述的是别的版次」—— 那一档重试与换网络都没用，
   *  两句话都不该说（见 data/projects.StaleProjectError 的 ★） */
  const [fetchStale, setFetchStale] = useState(false);
  /** 「重试留存」/「删除留存的工坊工程」那两颗小键各自的状态 */
  const [retainMsg, setRetainMsg] = useState("");
  const [dropAsk, setDropAsk] = useState(false);
  const [dropping, setDropping] = useState(false);
  // 回炉是**第九条整表覆盖入口**：守卫与套模板/打开草稿同一份实现（先问脏、成了再断草稿）。
  // ★ claim: false —— 工程不是草稿，套上之后要断开与旧草稿的关联，此后自动存盘会**另存**
  //   一条普通在途草稿（这正是我们要的：回炉途中新炼的付费段有本地备份）
  const { guard: reforgeGuard, dialog: reforgeDialog } = useApplyTemplate();

  // 深链刚进来时 video 可能还没就绪（远端补详情）；就绪后把表单初值补上。
  // 只在"表单还是空白"时回填，避免覆盖用户已输入的内容。
  useEffect(() => {
    if (!video) return;
    setTitle((t) => (t ? t : video.title));
    setCategory((c) => (c !== "剧情" ? c : video.category));
    setDescription((d) => (d ? d : video.description));
    setCover((c) => (c ? c : video.cover));
  }, [video]);

  // ★ 可见性单独同步，且**不能**用上面那种"空了才填"的写法：
  //   它的合法值里就有一个是默认值，"是不是空"分辨不出"用户还没改"和"用户选了公开"。
  //   改用「作品 id 变了就重置」——同一部作品内不覆盖用户的选择。
  useEffect(() => {
    setVisibility(video ? visibilityOf(video) : "public");
  }, [video?.id, video?.visibility, video?.linkOnly]);

  // ★ 标签与 visibility 同款处理，理由一样：空数组既可能是"还没填"也可能是"用户清空了"，
  //   分辨不出来，所以只在**换了一部作品**时重置，同一部作品内不覆盖用户的编辑。
  useEffect(() => {
    setTags(video?.tags ?? []);
  }, [video?.id]);

  // 截帧/候选帧覆盖整部作品：多 P 全拼进时间轴
  const allSegments = useMemo(() => parts.flatMap((p) => p.segments), [parts]);

  if (!video) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <div>作品不存在或已删除</div>
        <Link to="/" className="text-brand">返回首页</Link>
      </div>
    );
  }
  if (!isMyAuthor(video.author)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <div>只有作者本人可以编辑这部作品</div>
        <Link to={`/video/${video.id}`} className="text-brand">回到作品</Link>
      </div>
    );
  }

  /**
   * 保存。
   *
   * ★★ 换封面必须**先把图传成永久 URL 再保存**。
   *   CoverSection 吐出来的是 dataURL（截帧 / 本地上传 / AI 生成都是），几百 KB 到 1MB。
   *   直接塞进 PATCH 会撞上网关 1MB 的请求体上限，而且撞了只表现成 fetch failed；
   *   服务端那边也明确只收 http(s) URL。走和发布同一条路（publishAssets），不另写一套。
   *
   * ★ 传失败/存失败就**不许显示「✓ 已保存」**。原来这里是无条件 setSaved(true)，
   *   于是远端模式下换封面永远显示保存成功、实际一次都没存上，重启就变回去
   *   ——AI 封面还是真花了 token 的（铁律八）。
   *
   * ★ 成败要**返回**、不能只写进 `err`：调用方据此决定收不收弹层、要不要把开关翻回去。
   *   「改成仅自己可见」那颗按钮实测栽过一次（2026-08-30）：保存失败时确认卡照样关、
   *   开关照样翻过去 —— 用户以为作品藏起来了，其实还公开挂着，正是这颗按钮要防的事。
   *
   * @param over 立刻要生效、还来不及经过 state 的字段（「改成仅自己可见」那颗按钮用）
   * @returns null = 真存上了；字符串 = 没存上的原因（同时也写进了 `err`）
   */
  async function save(over?: { visibility?: Visibility }): Promise<string | null> {
    if (!video) return "作品不存在";
    if (!title.trim()) {
      setErr("标题不能为空");
      return "标题不能为空";
    }
    setSaving(true);
    setErr("");
    try {
      let coverUrl = cover;
      if (cover && cover.startsWith("data:")) {
        setBusy("正在上传封面…");
        coverUrl = await coverToPermanentUrl(cover);
        setCover(coverUrl); // 回填，避免用户再点一次又传一遍
      }
      // ★★ **要 await 并判回执**（2026-08-30 复核抓到）：`updateVideoMeta` 原来是同步的、
      //   远端那半是即发即忘 —— PATCH 失败时这里照样 `setSaved(true)` 闪一句「✓ 已保存」，
      //   而失败侧唯一的动作是 emitApiError（全 app 零监听）。用户看到"保存成功"，
      //   服务端一个字都没改；那颗「改成仅自己可见」的按钮更是照样收卡、翻开关 ——
      //   而它存在的全部理由正是防这件事。
      const syncWhy = await updateVideoMeta(video.id, {
        title: title.trim(),
        category,
        description: description.trim(),
        cover: coverUrl,
        tags,
        // ★ 三档 → 两个字段。别在这里手写 `{visibility, linkOnly}`：漏掉 linkOnly 的表现是
        //   "从凭链接可见改成仅自己可见，界面收紧了、链接却照样打得开"（零报错）
        ...visibilityWire(over?.visibility ?? visibility),
      });
      if (syncWhy) {
        setErr(syncWhy);
        return syncWhy;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      return null;
    } catch (e) {
      const why = e instanceof Error ? `封面上传失败：${e.message}` : "保存失败，请重试";
      setErr(why);
      return why;
    } finally {
      setBusy("");
      setSaving(false);
    }
  }

  async function remove() {
    if (!video) return;
    setDeleting(true);
    setDelErr(null);
    try {
      // ★ 没删成就别跳页：跳走等于把那句失败原因一起带走，而作品其实还在
      const why = await deleteVideoItem(video.id);
      if (why) {
        setDelErr({ why, kind: "delete" });
        return;
      }
      // 回个人页而不是回作品页——那条作品已经没了，跳回去只会看到"作品不存在"
      navigate("/me", { replace: true });
    } finally {
      setDeleting(false);
    }
  }

  const totalOf = (i: number) => segsTotal(parts[i].segments);

  // ── 回炉：能不能点，点不动的话为什么 ──────────────────────
  // ★ **每一档禁用态都「按钮存在但灰」**，
  //   下面一行说清原因 —— 隐藏按钮会被读成"这个功能没上线"，而它其实只是这一条不行。
  //   ⚠ **不预判「正在被复核」**：那一档只由服务端拒绝。一旦告诉作者"你正在被复核"，
  //     他的最优解不是回炉（已被挡）而是**直接删掉作品**，管理员打开只剩一条不存在的目标 ——
  //     那比回炉规避更糟。
  const supported = projects.projectsSupported();
  const hasProject = projects.hasProject(video.id);
  /** 留存的那份工程描述的是**别的版次**（多半是上一版）。判据与 loadProject 那道闸同源。 */
  const projectMeta = projects.projectMetaOf(video.id);
  const projectStale =
    !!projectMeta && (projectMeta.stale || projectMeta.videoRevision !== Number(video.revision ?? 0));
  const reforgeWhy: string | null = (() => {
    if (supported === null) return "正在确认这条作品有没有留存工坊工程…";
    // ★★ 「问了但没问到」与「这台服务器确实没有这个端点」是两句不同的话，摊在四档上
    //   （见 data/projects.readyProjects 的 ★★）。把一次网络抖动说成"服务器不支持"，
    //   用户会去等一个根本不会到来的服务器更新 —— 说一句错的原因比不给原因更坏。
    if (supported === "error") return "暂时问不到服务器，没能确认这条作品有没有留存工坊工程。";
    if (supported === false) return "这台服务器还不支持回炉重做。等服务器更新后再试。";
    if (isUploading(video)) return "这条作品还在上传，传完再回炉。";
    if (video.pricing?.mode === "paid") return "这条作品设为按分集收费，不能换内容。";
    if (video.takedown) return "这条作品已被平台下架，下架期间不能改内容。";
    if (!hasProject) return "这条作品没有留存工坊工程，改不了内容。想换内容请重新发一条。";
    // ★★ 「留存的那份是上一版」这一档**在按下之前就说**（2026-09-07 补）：判据与
    //   data/projects.loadProject 那道硬闸同源（都是比 videoRevision 与作品当下的 revision），
    //   但这里是**预告**、那里是**拦截** —— 让用户点下去再被整页拒，等于把一次必然失败的
    //   往返摆在他面前。⚠ 这不是把闸挪到 UI 上：真正的门仍然只有 loadProject 一处（铁律六）。
    //   ★ 服务端给的 `stale` 是同一件事的提示位（回炉成功、客户端还没 PUT 新画布），
    //     两个都读：meta 可能来自老服务端（没有 stale），也可能来自还没刷新的列表缓存。
    if (projectStale) {
      return `留存的工坊工程还是上一版的，这一版没有留存上来 —— 现在换不了内容。${
        projects.pendingFor(video.id, video.clientId) ? "先点下面的「重新留存这一版」。" : "想换内容请重新发一条。"
      }`;
    }
    return null;
  })();

  /** 确认卡上那几个数：**取不到就整段不出现**，绝不拼一个骗人的数（本仓那条纪律） */
  const danmakuCount = danmakuOf(video.id).length;
  const danmakuKnown = danmakuFetched(video.id);
  const isPublic = visibilityOf(video) === "public";

  /**
   * 取回工程 → 铺进工坊。三道闸的顺序是承重的：
   *   ① `studioBusyReason()` —— 工坊里有一炉在跑（钱正在花）就整句拒，不进；
   *   ② **先取回、后守卫** —— `useApplyTemplate.guard` 的 apply 必须是"成了才返回真"
   *      （它据此决定要不要 `newWorkDraft()` 断开旧草稿）。反过来先守卫的话，取回失败时
   *      流水线一个字没改却已经和它那条草稿脱钩，下次自动存盘会另存一条重复的；
   *   ③ guard 里那一下才真 `openProject` + 跳页。
   */
  async function beginReforge(): Promise<void> {
    setReforgeAsk(false);
    setFetchErr("");
    setFetchStale(false);
    const busyWhy = useStudio.getState().studioBusyReason();
    if (busyWhy) {
      setFetchErr(busyWhy);
      return;
    }
    setFetching(true);
    let canvas: Awaited<ReturnType<typeof projects.loadProject>>;
    try {
      // ★★ 版次是**取回时就要判的硬闸**（见 data/projects.loadProject 的 ★★★）：
      //   一份描述上一版的画布配上现读的 baseRevision，服务端会正常接受并把线上内容
      //   静默退回上一版。这里把"作品当下是第几版"递进去，对不上就整句拒、不进工坊。
      canvas = await projects.loadProject(video!.id, Number(video!.revision ?? 0));
    } catch (e) {
      setFetching(false);
      setFetchErr(e instanceof Error ? e.message : "原因不明");
      setFetchStale(e instanceof projects.StaleProjectError);
      return;
    }
    setFetching(false);
    reforgeGuard(
      () => {
        const v = video!;
        const ok = useStudio.getState().openProject(canvas.canvas, {
          videoId: v.id,
          // ★★ 报的是**这份画布自己**描述的版次，不是现读作品的 revision。
          //   后者永远"新鲜"，拿它当 base 的话那道 409 永远不会响 —— 一份陈旧画布会被
          //   服务端正常接受，把线上内容静默退回（见 data/projects.loadProject 的 ★★★）。
          //   loadProject 已经保证了它 === Number(v.revision ?? 0)；写成这样是为了让
          //   "谁是权威"这件事在代码里看得见，而不是靠上面那道闸的记忆。
          //   ★ 判否定：没有 revision = 从没回炉过 = 0（服务端那边有专门的 $or 分支接这一档）
          baseRevision: canvas.videoRevision,
          title: v.title,
        });
        if (!ok) {
          setFetchErr(useStudio.getState().studioBusyReason() ?? "现在铺不进工坊，稍后再试");
          return false;
        }
        // ★ 落在**工作流**而不是 3D 工坊：回炉改的是"每一段的内容"，工作流正是逐段那一面
        //   （工坊桌面管的是摆卡与推演）。两边是同一条流水线，用户随时能切过去。
        navigate("/flow");
        return true;
      },
      { label: "回炉重做（丢弃上面那条流水线）", noun: "回炉", claim: false },
    );
  }

  // 取回中 / 取回失败：整页态（这一步要走网络，把人扣在编辑页上盯着一颗没反应的键更糟）
  if (fetching) return <EmptyState full loading text="正在取回工坊工程…" />;

  return (
    <div className="min-h-full">
      {/* ★ safe-top 挂在 header 自己身上、不挂页面根：header 是 sticky top-0，
          安全区留白必须【在它内部】，否则它会滑到状态栏底下（ProfilePage 那条注释同理）。
          原来这三页压根没挂，顶栏文案直接压在状态栏上。 */}
      <PageHeader sticky onBack={() => navigate(`/video/${video.id}`)} backLabel="回到作品" title="编辑作品" subtitle={video.title} />

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-5 lg:grid-cols-[1.2fr_1fr]">
        {/* 左：内容一览（只读） */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">作品内容</h2>
          <div className="space-y-2.5">
            {parts.map((p, i) => (
              <div key={i} className="rounded-xl bg-panel/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex-none rounded-lg bg-slate-800 px-2.5 py-1 text-sm text-slate-300">
                    {p.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {p.segments.length} 段 · {formatDuration(totalOf(i))}
                    {p.branchTree ? " · 互动分支" : ""}
                  </span>
                </div>
                <div className="mt-2 flex gap-1.5 no-scrollbar overflow-x-auto">
                  {p.segments.map((sg, si) => (
                    <img
                      key={si}
                      src={sg.firstFrame}
                      alt={sg.title}
                      className="h-12 w-[85px] flex-none rounded object-cover"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {/* ★ 这一段原来写的是「🔒 成片内容已定稿，发布后不能再改」—— 2026-09-07 起不再成立
              （下面那颗 🛠 就是改内容的路）。措辞按**事实**写：能改，但改的是同一个链接下的内容。 */}
          <p className="mt-3 rounded-xl border border-slate-700/60 bg-panel/40 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400">
            想换成片内容，用下面的「🛠 回炉重做」把这条片的工坊工程取回工坊接着改 —— 链接、播放量、
            评论都留着。想做一条全新的，
            <Link to="/studio" className="text-brand">去工坊再创作</Link>。
          </p>

          {/* ── 回炉重做 ─────────────────────────────────────
              摆在左栏「作品内容」下面而不是右栏表单里：它改的正是上面列出来的那些段，
              而右栏从上到下全是"改壳"。放一起会让人以为保存修改也会动内容。 */}
          <div className="mt-4">
            <button
              onClick={() => setReforgeAsk(true)}
              disabled={!!reforgeWhy}
              className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink active:scale-[0.99] disabled:bg-slate-700 disabled:text-slate-400"
            >
              🛠 回炉重做
            </button>
            {reforgeWhy && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{reforgeWhy}</p>}
            {/* 「重试留存」：本机还留着一份没提交上去的画布待办时才摆。
                ★ 判据带 clientId —— 待办是**单键**，不比对的话会拿"最近那一摊"去补另一条作品
                （见 data/projects.pendingFor 的 ★）。
                ⛔ **不许再加 `!hasProject`**（2026-09-07 评审删掉的那一条）：它把这颗键锁死在
                  「首次发布时留存失败」那一档，而最需要它的恰恰是相反的一档 ——
                  **回炉成功、重新留存失败**。那条路上 hasProject 恒为真（首次发布已经留过一份），
                  于是键永远不出现：用户手上明明有一份 ready 的待办，屏幕上却没有任何补救入口，
                  工程永久停在上一版，下一次回炉会被那道版次闸整句拒（本该能救的却救不了）。
                  而留存失败那句话本身还写着「可在编辑页点「重试留存」」—— 在回炉路径上那是句假话。
                ★ 已经有一份（陈旧的）工程时把键名说清楚：用户要知道现存那份不是这一版。 */}
            {supported === true && projects.pendingFor(video.id, video.clientId) && (
              <button
                onClick={() => {
                  setRetainMsg("正在重试…");
                  void projects
                    .retryRetain(video!.id, video!.title, Number(video!.revision ?? 0))
                    .then((why) => setRetainMsg(why ?? "工程已留存，现在可以回炉重做了"));
                }}
                disabled={retainMsg === "正在重试…"}
                className="mt-2 rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700 disabled:opacity-40"
              >
                {hasProject ? "重新留存这一版（现存那份还是上一版）" : "重试留存"}
              </button>
            )}
            {/* 「问不到服务器」那一档给一颗真的能重问的键：`retryReadyProjects` 会把那个失败的
                Promise memo 置回 null，否则这个会话里再也问不了第二次（见 readyProjects 的 ★★）。 */}
            {supported === "error" && (
              <button
                onClick={() => void projects.retryReadyProjects()}
                className="mt-2 rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700"
              >
                重新问一次服务器
              </button>
            )}
            {retainMsg && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">{retainMsg}</p>}
            {/* 删掉留存的工程：用户主动放弃。作品本身不受影响，但回炉入口会永久消失 —— 两步确认 */}
            {hasProject && (
              <button onClick={() => setDropAsk(true)} className="mt-2 text-[11px] text-slate-500 underline underline-offset-2">
                删除留存的工坊工程
              </button>
            )}
            {/* 取回失败 / 工坊在途被拒：整句原话，落在按下的那颗键旁边（铁律八） */}
            {fetchErr && (
              <div className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2">
                {/* ★ 原话原样显示（data 层与服务端写的都是整句中文）。
                    ⚠ 「换个网络再试一次」与那颗重试键只给**真的可能是网络问题**的那几档：
                      版次对不上那一档再试一万次也是同一句话，摆一颗永远不会成的重试键
                      比不摆更坏（本仓那条：说一句错的原因比不给原因更坏）。 */}
                <p className="text-[11px] leading-relaxed text-rose-200">
                  没能取回这条作品的工坊工程（{fetchErr}）。
                  {fetchStale
                    ? "本机还留着那一版的画布的话，先点上面的「重新留存这一版」；否则只能重新发一条。"
                    : "换个网络再试一次。"}
                </p>
                <div className="mt-2 flex gap-2">
                  {!fetchStale && (
                    <button
                      onClick={() => void beginReforge()}
                      className="rounded-full bg-panel px-3 py-1.5 text-[11px] text-slate-200 ring-1 ring-slate-700"
                    >
                      重试
                    </button>
                  )}
                  <button onClick={() => setFetchErr("")} className="rounded-full px-3 py-1.5 text-[11px] text-slate-400">
                    知道了
                  </button>
                </div>
              </div>
            )}
          </div>
          {reforgeDialog}
        </div>

        {/* 右：元信息 + 封面 + 可见性 */}
        <div className="space-y-5">
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">标题 *</div>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setErr("");
              }}
              maxLength={40}
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none focus:border-brand"
            />
            {err && <div className="mt-1 text-xs text-red-400">{err}</div>}
          </div>

          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">分类</div>
            <div className="flex flex-wrap gap-2">
              {VIDEO_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3.5 py-1.5 text-xs ${
                    category === c ? "bg-brand font-semibold text-ink" : "bg-panel text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* 话题标签：与发布页共用 TagInput 一份（上限/切分都在 types 一处）。
              ★ 这里必须也有：服务端 PATCH 支持改 tags，不给入口的话打错一个字就永久错着
                —— 而发布页那边"发布后改不了"的东西已经够多了（定价那条就是） */}
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">话题标签</div>
            <TagInput tags={tags} onChange={setTags} max={VIDEO_TAG_MAX} maxLen={VIDEO_TAG_LEN} split={parseTags} />
          </div>

          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">简介</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={1000}
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none focus:border-brand"
            />
          </div>

          <CoverSection cover={cover} onCover={setCover} segments={allSegments} />

          <VisibilityPicker value={visibility} onChange={setVisibility} />

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void save()}
              disabled={saving}
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-ink hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存修改"}
            </button>
            {busy && <span className="text-sm text-slate-400">{busy}</span>}
            {saved && <span className="text-sm text-emerald-300">✓ 已保存</span>}
          </div>

          {/* 删除放最后、要二次确认：这是本页唯一不可撤销的动作。
              ★ 不用 window.confirm —— Capacitor 的 WebView 里它是个系统弹窗，
              样式与整个 app 割裂，而且在部分机型上会被当成"网页弹窗"直接拦掉。 */}
          <div className="mt-2 border-t border-slate-700/60 pt-4">
            {confirmDel ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
                <div className="text-sm font-bold text-rose-200">删除《{video.title}》？</div>
                {/* ★ 这句以前只说"成片、评论和点赞会一起消失" —— 而当时服务端一次
                    `uploader.destroy` 都没有：作品从库里没了，成片与封面那几个地址
                    仍然人人可访问。2026-08-30 服务端补上了回收，这句话才配得上"删除"两个字，
                    所以把它写全（铁律五：文案只按已实现的事实写）。 */}
                <p className="mt-1 text-[11px] leading-relaxed text-rose-300">
                  成片、评论和点赞会一起消失，云端存的视频与封面也会一并删除。不能撤销。
                </p>
                {/* ★★ 软替代：**这条只对还公开着的作品有意义**（2026-08-30 修）。
                    原来判的是 `visibility === "private"` —— 恰好反了：已经藏起来的人
                    才被劝"藏起来就够了"，而真正想把作品从别人眼前拿走的那位一个字看不到。
                    ★ 做成一颗**直达按钮**而不是一句话：多数人删作品是因为"不想被人看见"，
                      而不是"要腾地方"。这是四家同类产品里唯一被普遍验证有效的止损设计
                      —— 但前提是它得点得动，光说一句"你可以去上面那个选择器改"约等于没有。 */}
                {/* ★ 「凭链接可见」也算"还在外面"：链接是活的、能被转发，所以这一档同样
                    该被劝一句。判 `!== "private"` 正好把两档都包含进来（三档之后这条依然对）。 */}
                {visibility !== "private" && (
                  <button
                    onClick={() => {
                      // ★★ **存成了才收卡、才认这个开关**（2026-08-30 实测抓到）：
                      //   保存这条路是会失败的（封面是 dataURL 时要先上传），而原来这里
                      //   是"翻开关 → 关卡 → 甩出去一个不看结果的 save" —— 失败时用户
                      //   看着开关已经在「仅自己可见」上、卡也关了，作品其实还公开挂着。
                      //   这正是这颗按钮要解决的问题的反面。
                      setVisibility("private");
                      setDelErr(null);
                      void save({ visibility: "private" }).then((why) => {
                        if (!why) {
                          setConfirmDel(false);
                          return;
                        }
                        setVisibility(video ? visibilityOf(video) : "public"); // 开关翻回去，别让它说谎
                        setDelErr({ why: `没能改成「仅自己可见」：${why}`, kind: "soft" });
                      });
                    }}
                    disabled={saving}
                    className="mt-2.5 w-full rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-100 disabled:opacity-40"
                  >
                    <span className="font-bold">改成「仅自己可见」就好</span>
                    <br />
                    别人的首页和你的主页上都不再出现，成片和评论都留着，随时能改回来。
                  </button>
                )}
                {delErr && (
                  <p className="mt-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-100">
                    {delErr.why}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setConfirmDel(false);
                      setDelErr(null);
                    }}
                    disabled={deleting}
                    className="flex-1 rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200 disabled:opacity-40"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void remove()}
                    disabled={deleting}
                    className="rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-40"
                  >
                    {deleting ? "删除中…" : delErr?.kind === "delete" ? "再试一次" : "确认删除"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDel(true)}
                className="text-sm text-rose-400 hover:text-rose-300"
              >
                删除这部作品
              </button>
            )}
          </div>
        </div>
      </main>

      {/* 回炉确认卡。★ 正文按**这条作品的真实数字**拼，取不到的那一段整段不出现 ——
          "128 次播放"与"0 次播放"是两句不同的话，而"还没数清"绝不能被写成 0。
          ★★ 弹幕那一段必须**提前**说清会删掉多少条：换内容之后弹幕的 at（全片累计秒）
             必然对不上画面，服务端会在替换成功那一拍把它们全部清空，且不可恢复。
             事后再说等于没说 —— 那时东西已经没了。 */}
      {reforgeAsk && (
        <ConfirmDialog
          title="回炉重做这条作品？"
          confirmLabel="继续回炉"
          onConfirm={() => void beginReforge()}
          onClose={() => setReforgeAsk(false)}
        >
          {isPublic ? (
            <p>
              这条作品已经有 {video.plays} 次播放
              {typeof video.saves === "number" && video.saves > 0 ? `、${video.saves} 个人收藏` : ""}
              。重新剪辑之后，同一个链接下的内容会变，收藏过它的人会收到一条「你收藏的作品重新剪辑过了」。
            </p>
          ) : (
            <p>这条作品别人看不到，没有观众会收到通知。</p>
          )}
          {danmakuKnown ? (
            danmakuCount > 0 && (
              <p className="mt-2">
                这条作品有 {danmakuCount} 条弹幕。弹幕是按全片时间轴打的，换内容会让它们对不上画面，
                所以会被清空，且无法恢复。
              </p>
            )
          ) : (
            <p className="mt-2">
              还没数清这条作品有多少条弹幕。弹幕是按全片时间轴打的，换内容会让它们对不上画面，
              所以提交时会被全部清空，且无法恢复。
            </p>
          )}
        </ConfirmDialog>
      )}

      {/* 删掉留存的工程：作品本身不受影响，但回炉入口会永久消失 —— 说清楚这两句就够了 */}
      {dropAsk && (
        <ConfirmDialog
          title="删掉这条作品的工坊工程？"
          confirmLabel={dropping ? "删除中…" : "删掉"}
          danger
          busy={dropping}
          onConfirm={() => {
            setDropping(true);
            void projects.dropProject(video!.id).then((why) => {
              setDropping(false);
              setDropAsk(false);
              // 失败要说话：不说的话按钮点了一下、卡关了、工程还在（铁律八）
              if (why) setRetainMsg(`没能删掉这份工程（${why}）`);
            });
          }}
          onClose={() => setDropAsk(false)}
        >
          <p>删掉之后这条作品就不能再回炉了，作品本身不受影响。</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
