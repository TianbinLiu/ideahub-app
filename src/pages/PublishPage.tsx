// 合成完成后的编辑发布页：标题 / 分类 / 简介 / 封面 / 可见性 + 左侧成片预览。
//
// ★ 这一页有**两种模式**，判据只有一处：`draft.reviseOf`（见 types.DraftVideo.reviseOf）。
//     · 缺省 —— 全新发布，行为与从前一字不变；
//     · 有值 —— **回炉重做**：这条合成稿要去替换一条已发布作品的内容（同一个链接、
//       同一批播放/点赞/评论）。顶栏、主按钮、主按钮上那句话、以及壳字段的初值四处跟着换。
//   2026-08 曾有一种老的「回炉编辑」（把本次合成塞回既有作品的某一 P），随「发布即定稿」
//   一起删掉，两条理由是①观众零知情②它只写本地。2026-09-07 这一版把两条都堵上了：
//   版次下发 + 收藏者通知 + 确认卡当面报数；内容走 `PATCH` + `baseRevision` 乐观锁
//   （对不上 409，服务器上一个字都不写）。**分集（parts）不复活**。
//
// ★★ 失败路径**绝不调 `finishPublish`**：它会 `set({draft:null})` + `dropCutSession()` +
//   `retireWorkDraft()` 三件一起做 —— 替换没成功还调它，等于"既没换成、合成稿也没了"，
//   而那份合成稿里躺着真花过钱的卡组与成片。
import { useEffect, useMemo, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import ConfirmDialog from "../components/ConfirmDialog";
import InfoDialog from "../components/InfoDialog";
import { AGREEMENTS } from "../data/agreements";
import { CoverSection } from "../components/CoverPicker";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import AigcBadge from "../components/AigcBadge";
import VisibilityPicker from "../components/VisibilityPicker";
import SegmentPlayer from "../components/SegmentPlayer";
import TagInput from "../components/TagInput";
import { isArkAssetUrl } from "../ai/arkClient";
import { addCards, createDeck, deckSynced } from "../data/account";
import { getVideo, publishVideo, reviseVideo, type ReviseResult } from "../data/videos";
import { useVideosVersion } from "../hooks/useVideos";
import { publishedExit, useStudio } from "../studio/studioStore";
import { VIDEO_CATEGORIES, VIDEO_TAG_LEN, VIDEO_TAG_MAX, type Visibility, formatDuration, parseTags, visibilityOf, visibilityWire } from "../types";

export default function PublishPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const clearDraft = useStudio((s) => s.clearDraft);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(draft?.category ?? "剧情");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [cover, setCover] = useState(draft?.cover ?? "");
  const [tags, setTags] = useState<string[]>([]);
  // 可见性默认公开：发布这个动作本身的意思就是"给人看"。
  // 想先自己留着的人可以在这里改，发完在作品编辑页也随时能改回来。
  const [visibility, setVisibility] = useState<Visibility>("public");
  /**
   * 「随片带上这套卡组」。★ **默认开**，不是默认关。
   *
   * ★★ 这颗开关 2026-08-31 加，是为了给作者一条**退出**的路，不是把功能关掉：
   *   新人最低成本的入口就是抄一套现成卡组接着改（「收入卡组」「做同款」都靠它），
   *   默认关等于事实上永远关，广场的冷启动池会当场空掉。
   *   但"我这条片子用了哪几张卡"确实是作者该有权决定的 —— 尤其是他用了自己家人
   *   的照片做真人卡的时候（那种卡的形象图服务端已经对别人扣下了，见
   *   types.Card.portraitWithheld，但连名字都不想给别人看的诉求同样成立）。
   */
  const [shareDeck, setShareDeck] = useState(true);
  const [err, setErr] = useState("");
  /** 发布途中的一句进度（存卡组要等网络，不说话就是"点了没反应"） */
  const [busy, setBusy] = useState("");
  /**
   * 作品发出去了、但**本片卡组没能存进工坊**。
   * ★ 单独一格而不是并进 err：这两件事的处置完全不同 —— err 是"没发成，改完再发"，
   *   这一格是"已经发成了，卡组要不要再试一次"，而且它必须给一条离开这一页的路。
   */
  const [deckIssue, setDeckIssue] = useState<{
    videoId: string;
    why: string;
    retry: () => Promise<string | null>;
  } | null>(null);
  /** 「放弃本次合成」的确认小窗。丢的是已经合成好的整条成片，一点就没太草率 */
  const [discardOpen, setDiscardOpen] = useState(false);
  /** AIGC 内容须知全文（data/agreements 唯一一份） */
  const [aigcOpen, setAigcOpen] = useState(false);
  useAutoGuide("publish", !!draft);

  // ── 回炉态 ──────────────────────────────────────────────
  const reviseOf = draft?.reviseOf ?? null;
  const version = useVideosVersion();
  /** 要被替换的那条作品（壳字段的初值从它来）。取不到（本机库里没有）时**照样能提交** ——
   *  真正的判据在服务端（作者 + baseRevision），这里拿不到只是初值退回合成稿自己的值 */
  const origin = useMemo(() => (reviseOf ? getVideo(reviseOf.videoId) : null), [reviseOf?.videoId, version]);
  /**
   * 替换失败那条页内横幅。★ 三样一起存：档（决定 amber/rose）、整句原话、以及这一档给哪几颗键。
   *   ⚠ **不与 `err` 合并**：err 是"没发成，改完再发"（表单校验），这一格是"服务器拒了/撞车了"，
   *     出路完全不同（重试 / 取回最新工程重来 / 只能知道了）。
   */
  const [reviseFail, setReviseFail] = useState<Extract<ReviseResult, { ok: false }> | null>(null);

  // 壳字段初值：回炉态一律**预填原作品的值**（不是新草稿的自动标题）——用户回炉是来换内容的，
  // 让他把标题简介再敲一遍是把"改内容"伪装成"发新片"。
  // ★ 只在"表单还是空白"时回填，避免覆盖用户已经输入的内容（同 EditPage 那条）。
  // ★ 可见性与标签**按 id 变化重置**，不用"空了才填"：它们的合法值里就有一个是默认值，
  //   "是不是空"分辨不出"还没改"与"用户选了这个"（EditPage 那条教训逐字同源）。
  useEffect(() => {
    if (!origin) return;
    setTitle((t) => (t ? t : origin.title));
    setCategory((c) => (c !== "剧情" ? c : origin.category));
    setDescription((d) => (d ? d : origin.description));
    setCover((c) => (c ? c : origin.cover));
  }, [origin]);
  useEffect(() => {
    if (!origin) return;
    setVisibility(visibilityOf(origin));
    setTags(origin.tags ?? []);
  }, [origin?.id]);

  /**
   * 本页刚刚发布过（publish() 已经把去处发出去了）。
   * 两件事都靠它，缺一件都出过问题：
   *   ① 守卫别抢跳 —— 这个 effect **真的会在发布那一拍跑起来**：HashRouter 的路由切换
   *      走 startTransition（低优先级），而清稿经 useSyncExternalStore 是同步更新，
   *      React 会先用空 draft 把本页重画一遍并跑完 effect，路由那一拍才落地；
   *   ② 防连点 —— 正因为路由切换是低优先级，那颗「发布」按钮在跳走前还能再按一次，
   *      而 publishVideo 是同步落库的，两条一模一样的作品就这么出去了。
   */
  const publishedRef = useRef(false);
  /**
   * 草稿没了就别把人晾在这一页上 —— 但**去哪儿要看是怎么没的**（判据只在
   * studioStore.publishedExit 一处，铁律六）：发布收工留下的死页送回首页，
   * "直接输地址闯进来 / 热更新丢了状态"才回工坊。
   */
  const published = useStudio((s) => s.publishedWorkId);
  useEffect(() => {
    if (draft || publishedRef.current) return;
    navigate(publishedExit() ?? "/studio", { replace: true });
  }, [draft, published, navigate]);

  if (!draft) return null;
  const total = draft.segments.reduce((s, x) => s + x.durationSec, 0);

  /**
   * 回炉提交：拿这份合成稿**替换**原作品的内容。
   *
   * ★★ 失败**绝不调 `finishPublish`**（见文件头那条 ★★）：合成稿原样留着，用户从个人页
   *   那条「剪到一半」横幅回来重试。也**不入待发队列** —— 队列里那份 `baseRevision` 会
   *   陈旧，自动重试必然 409，而且是在用户看不见的地方连着 409。
   * ★ `publishedRef` 只在**真成了**之后才置位：置早了失败时那颗键就永久禁着，
   *   而用户此刻最需要的就是再点一次。
   */
  async function submitRevise() {
    if (!draft || !reviseOf || publishedRef.current || busy) return;
    if (!title.trim()) {
      setErr("先给视频起个标题");
      return;
    }
    setErr("");
    setReviseFail(null);
    setBusy("正在替换…");
    const res = await reviseVideo(
      reviseOf.videoId,
      {
        ...draft,
        title: title.trim(),
        category,
        description: description.trim(),
        ...(tags.length > 0 ? { tags } : { tags: [] }),
        cover,
        // 本片卡组：随片带上那颗开关在回炉时同样有效（作者随时可以改主意不带卡组）
        ...(shareDeck && draft.deck?.cards.length
          ? { deck: { name: `《${title.trim()}》卡组`, cards: draft.deck.cards } }
          : { deck: undefined }),
        ...visibilityWire(visibility),
      },
      reviseOf.baseRevision,
    );
    setBusy("");
    if (!res.ok) {
      setReviseFail(res);
      return;
    }
    publishedRef.current = true;
    // ★ 回炉**不做**「同名卡组落进作者工坊」那一步（全新发布那条路才做）：`createDeck`
    //   按名字再建一条，回炉多半用的还是同一套卡 —— 用户的工坊里会多出一条同名卡组，
    //   而卡本身随作品的 deck 一起上行了（详情页「收入卡组」拿得到）。
    useStudio.getState().finishPublish(res.videoId);
    navigate(`/video/${res.videoId}`, {
      replace: true,
      // 成功要说一句"发生了什么"，而且要说在**结果所在的那一页**上（本 app 没有 toast）。
      // ★ 只说已知事实：版次是回包里的；"会收到通知的人"数拿不到就不提（不许拼一个数）
      // ★ 版次的说法与详情页那一行**同一把尺**：revision 是"回炉过几次"，第一次回炉之后
      //   是第 2 版。两处印不同的数比不印更糟。
      state: { banner: `已替换。这条作品现在是第 ${res.revision + 1} 版，收藏过它的人会收到通知。` },
    });
  }

  /** @param over 立刻要生效、还来不及经过 state 的字段（放弃确认卡里那条"先私密发出去"用） */
  async function publish(over?: { visibility?: Visibility }) {
    if (!draft || publishedRef.current) return;
    if (!title.trim()) {
      setErr("先给视频起个标题");
      return;
    }
    // 本片卡组定名（合成时聚合了素材/派生卡，名字要等最终标题定下来）
    const deck =
      shareDeck && draft.deck?.cards.length
        ? { name: `《${title.trim()}》卡组`, cards: draft.deck.cards }
        : undefined;
    const item = publishVideo({
      title: title.trim(),
      category,
      description: description.trim(),
      ...(tags.length > 0 ? { tags } : {}),
      cover,
      segments: draft.segments,
      branchTree: draft.branchTree,
      deck,
      merged: draft.merged,
      // 三档 → 两个字段，映射只有 types.visibilityWire 一处
      ...visibilityWire(over?.visibility ?? visibility),
    });
    // ★ 作品已经落库了，从这一刻起不许再发第二条（下面要 await，窗口比原来长）
    publishedRef.current = true;

    // 同名卡组落进作者自己的创意工坊（派生场景卡先入账号卡库，卡组引用才不悬空）
    //
    // ★★ **要等结果，不能即发即忘**（2026-08-30 修）：原来这两句是同步调完就跳走。
    //   两条同步失败都是 `emitApiError` 静默的（全 app 没有任何地方监听它），于是
    //   用户看着「本片卡组」已经在工坊里，下次冷启动 `loadRemoteAssets` 拿服务端那份
    //   整体覆盖 —— 整组卡无声消失。而这批卡里可能有派生角色卡，一张的 3D 建模就是
    //   十几万 token（铁律八：钱花出去的失败必须响）。
    // ★ 失败也**不回滚、不拦着人走**：作品本身已经发出去了，把用户扣在这一页上更糟。
    //   这里只做两件事：如实说没存上、给一条"再试一次"的出路。
    if (deck) {
      setBusy("正在把本片卡组存进你的工坊…");
      const r = await addCards(deck.cards);
      const d = createDeck(deck.name, deck.cards.map((c) => c.id));
      const deckOk = !!d && (await deckSynced(d.id));
      setBusy("");
      if (!r.synced || !deckOk) {
        setDeckIssue({
          videoId: item.id,
          why: r.reason || "这组卡没能同步到服务器",
          retry: async () => {
            const again = await addCards(deck.cards);
            if (!again.synced) return again.reason || "还是没能同步到服务器";
            const d2 = createDeck(deck.name, deck.cards.map((c) => c.id));
            return !d2 || !(await deckSynced(d2.id)) ? "卡片存上了，卡组本身没建成" : null;
          },
        });
        return;
      }
    }
    finishAndGo(item.id);
  }

  /** 收工三件事（记下作品 + 清合成稿 + 退休在途草稿）收在 store 一处：
   *  顺序错一点，守卫就会抢在跳转前把人送去工坊（见 finishPublish 的 ★） */
  function finishAndGo(videoId: string) {
    useStudio.getState().finishPublish(videoId);
    navigate(`/video/${videoId}`, { replace: true });
  }

  return (
    <div className="min-h-full">
      {/* ★ safe-top 挂在 header 自己身上、不挂页面根：header 是 sticky top-0，
          安全区留白必须【在它内部】，否则它会滑到状态栏底下（ProfilePage 那条注释同理）。
          原来这三页压根没挂，顶栏文案直接压在状态栏上。 */}
      <PageHeader
        sticky
        onBack={() => navigate("/studio")}
        backLabel="返回工坊"
        title={reviseOf ? "回炉重做" : "发布视频"}
        subtitle={`${draft.segments.length} 段 · 共 ${formatDuration(total)}`}
        right={<HelpButton tour="publish" />}
      />

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-5 lg:grid-cols-[1.2fr_1fr]">
        {/* 成片预览 */}
        <div>
          <SegmentPlayer segments={draft.segments} cover={cover || draft.cover} />
          <div className="mt-2 text-center text-xs text-slate-500">成片预览（各段按时间线依次播放）</div>
          {/* 每段的来历必须可见：真实 Seedance 影像还是首尾帧渐变回退。
              此前两者在预览里长得都"会动"，用户分不清哪些是真生成的 */}
          <div data-guide="publish-segments" className="mt-3 space-y-1.5">
            {draft.segments.map((sg, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-panel/60 px-3 py-1.5 text-xs">
                <span className="flex-none text-slate-500">第 {i + 1} 段</span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{sg.title}</span>
                {sg.videoUrl ? (
                  <span className="flex-none rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                    ✓ 真实影像
                  </span>
                ) : (
                  <span
                    className="flex-none rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300"
                    title="该段视频生成失败或处于演示模式，播放时用首尾帧渐变代替"
                  >
                    ⚠ 渐变回退
                  </span>
                )}
              </div>
            ))}
          </div>
          {/* 2026-08-20 起成片出片即转存永久地址，这句只对"转存失败退回方舟直链"的少数段成立 ——
              无条件挂着就是对多数用户撒谎（他们的链接根本不会过期） */}
          {draft.segments.some((sg) => isArkAssetUrl(sg.videoUrl)) && (
            <div className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
              有片段还挂在临时链接上（约 24 小时有效）——尽快发布，服务端会转存为长期地址
            </div>
          )}
        </div>

        {/* 发布表单 */}
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
              placeholder="给这支视频起个好名字"
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
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

          {/* 话题标签：分区只有 6 个固定值，长尾内容没有落点，标签就是给它们准备的。
              上限与规范化都在 types 一处，与服务端 zod 逐字相等（那边有用例钉着） */}
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">话题标签</div>
            <TagInput
              tags={tags}
              onChange={setTags}
              max={VIDEO_TAG_MAX}
              maxLen={VIDEO_TAG_LEN}
              split={parseTags}
            />
          </div>

          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">简介</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={1000}
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none focus:border-brand"
            />
          </div>

          <CoverSection cover={cover} onCover={setCover} segments={draft.segments} />

          <VisibilityPicker value={visibility} onChange={setVisibility} />

          {/* 随片带卡组：只在这条片子真的有卡组时才摆（没有卡组时摆一颗恒灰的开关是噪声） */}
          {!!draft.deck?.cards.length && (
            <div>
              <div className="mb-1.5 text-sm font-semibold text-slate-300">这套卡组</div>
              <button
                onClick={() => setShareDeck((v) => !v)}
                className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left ${
                  shareDeck ? "border-brand/40 bg-brand/5" : "border-slate-700 bg-panel"
                }`}
              >
                <span className={`mt-0.5 flex-none text-base ${shareDeck ? "text-brand" : "text-slate-500"}`}>
                  {shareDeck ? "☑" : "☐"}
                </span>
                <span className="text-xs leading-relaxed text-slate-300">
                  随片带上这 {draft.deck.cards.length} 张卡
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    {shareDeck
                      ? "看到这条片子的人能看到卡面与设定，也能「收入卡组」接着创作——这是别人找到你的主要方式。声明过真实人物的卡，形象图不会给出去。"
                      : "别人只看得到成片，看不到你用了哪几张卡，也不能「做同款」。"}
                  </span>
                </span>
              </button>
            </div>
          )}

          {/* ★★ 「付费解锁」这一档 2026-08-31 **下架**（主人拍板），别顺手加回来 ——
              先把结算做出来，再放开关。当时的事实（逐处核过）：
              ① `toVideoItem` 根本不映射 pricing（`ApiVideo` 里连这个键都没有，所以 TS
                 连"你忘了传"都提示不了）⇒ 发布之后**任何一次从服务端读回**这条作品都没有
                 定价 ⇒ `partPrice = 0`、`locked = false`，那把锁一次都不会出现；
              ② 就算把映射补上也只是一把**假锁**：远端模式 `spendTokens` 直接返回、一分不扣，
                 `creditAuthorAddon` 按显示名在本机 db 里找作者、必然找不到，`persist()`
                 是 no-op、purchases 从不上行，服务端**没有任何解锁/分账端点**，
                 `segments[].videoUrl` 对所有读得到这条作品的人原样返回；
              ③ 于是这颗开关的真实含义是"作者以为自己在收钱，实际一分没有，也没人被拦"。
                 生产库当时 7 条作品、标了付费的 0 条 —— 趁没人踩上去先收起来。
              ⇒ 要恢复它，先做服务端那一侧：解锁端点（扣费 + 落购买记录 + 给作者入账）、
                按购买态决定发不发 `segments[].videoUrl`、客户端购买态从服务端读。
              ★ 这个 `data-guide` 锚点留着：引导里那一步（tours 的「谁能看」）指着它。 */}
          <div data-guide="publish-pricing">
            <div className="mb-1.5 text-sm font-semibold text-slate-300">收费方式</div>
            <div className="rounded-xl border border-slate-700/70 bg-panel px-3.5 py-2.5 text-xs leading-relaxed text-slate-400">
              目前所有作品都是<b className="font-semibold text-slate-200">免费观看</b>。付费解锁还没开放——
              等收款和分账真的通了再放出来，免得你以为在收钱、其实一分也到不了账。
            </div>
          </div>

          {/* ★ 错误行挂在**发布键这一侧**（2026-08-30 移）：用户按的是这颗键，而原来它
              画在最上面那个标题输入框底下 —— 定价那条整句拒绝报在两屏之外，
              在手机上等于没报（铁律八：报错要落在动作发生的地方）。 */}
          {err && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
              {err}
            </div>
          )}

          {/* 作品发出去了、卡组没存上：如实说 + 再试一次 + 一条离开的路（铁律八） */}
          {deckIssue && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-100">
              <span className="font-bold">作品已经发布成功了</span>，但本片卡组没能存进你的工坊：{deckIssue.why}。
              <span className="text-amber-200/80">卡还在这台设备上，重试一次多半就好。</span>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setBusy("正在重试…");
                    void deckIssue.retry().then((why) => {
                      setBusy("");
                      if (why) setDeckIssue({ ...deckIssue, why });
                      else finishAndGo(deckIssue.videoId);
                    });
                  }}
                  disabled={!!busy}
                  className="rounded-full bg-amber-400/90 px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
                >
                  {busy ? "重试中…" : "再试一次"}
                </button>
                <button
                  onClick={() => finishAndGo(deckIssue.videoId)}
                  className="rounded-full border border-amber-500/40 px-3 py-1.5 text-[11px] text-amber-100"
                >
                  先去看作品
                </button>
              </div>
            </div>
          )}

          {/* 回炉失败的页内横幅（非 toast）。★ 服务端那句话**原样显示**：付费/已下架/复核中
              那几档都是写给用户看的整句中文，这里再翻译一遍必然与服务端分叉（铁律六）。 */}
          {reviseFail && (
            <div
              className={`rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
                reviseFail.kind === "conflict"
                  ? "border-amber-500/40 bg-amber-400/10 text-amber-100"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-200"
              }`}
            >
              {reviseFail.why}
              {reviseFail.kind === "conflict" && (
                <span className="block text-amber-200/80">合成稿还留在「我的」里，没有丢。</span>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {reviseFail.kind === "conflict" && (
                  <button
                    onClick={() => {
                      // ★ 出路是「回编辑页取回最新工程重来」，**不是**「把我这一版另发成新作品」：
                      //   那颗键会拿一份全是永久 Cloudinary 地址的画布走发布路径，于是新旧两条
                      //   作品**逐字共享**同一批资产 —— 删掉任一条，另一条当场黑屏且零报错。
                      navigate(`/edit/${reviseOf?.videoId ?? ""}`);
                    }}
                    className="rounded-full bg-amber-400/90 px-3 py-1.5 text-[11px] font-bold text-ink"
                  >
                    取回最新工程重来
                  </button>
                )}
                {reviseFail.kind === "network" && (
                  <button
                    onClick={() => void submitRevise()}
                    disabled={!!busy}
                    className="rounded-full bg-rose-400/90 px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
                  >
                    重试
                  </button>
                )}
                <button
                  onClick={() => setReviseFail(null)}
                  className="rounded-full border border-slate-600 px-3 py-1.5 text-[11px] text-slate-300"
                >
                  知道了
                </button>
              </div>
            </div>
          )}

          {/* 主按钮上方那一行：回炉态说清"这一下会动谁"；全新发布态说清"发完还能回炉" */}
          {reviseOf ? (
            <p className="text-xs leading-relaxed text-amber-300">
              会替换《{origin?.title || "原作品"}》的内容，链接不变。
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-slate-500">发布后会留存这条片的工坊工程，之后可回炉重做。</p>
          )}

          <div data-guide="publish-actions" className="flex items-center gap-3 pt-2">
            <button
              onClick={() => (reviseOf ? void submitRevise() : void publish())}
              disabled={!!busy || !!deckIssue}
              className="rounded-xl bg-brand px-6 py-2.5 text-sm font-bold text-ink hover:brightness-110 disabled:opacity-40"
            >
              {busy || (reviseOf ? "替换原作品" : "发布")}
            </button>
            <button
              onClick={() => setDiscardOpen(true)}
              disabled={!!busy || !!deckIssue}
              className="rounded-xl bg-panel px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              放弃本次合成
            </button>
          </div>
          {/* ★★ 内容声明。**恒开、不可关**，而且是**主动声明**不是默示同意（2026-08-30 改）。
              《人工智能生成合成内容标识办法》第十条要求用户"主动声明并使用服务提供者提供的
              标识功能进行标识"—— 原来这里是一句"发布即视为同意《AIGC 内容须知》"的脚注，
              那在法律上是**默示**，而且藏在按钮下面像免责声明，不像声明。
              ⚠ 不给关：本 app 的每一条作品都是 AI 生成的（画面要么是 Seedance 出的片、
                要么是两张 AI 设定帧之间的渐变），给一个永远不能选"否"的开关只是装样子，
                还会让人以为可以关掉。所以画成"已声明"的既成事实 + 说清楚都做了什么。 */}
          <div className="rounded-xl border border-slate-700/70 bg-panel/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <AigcBadge />
              内容声明：本作品由 AI 生成
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              发布后会做三件事：成片每一帧的右下角带「AI 生成」角标；首页与详情页在作品旁显示
              「AI 生成」标识；并按
              <button onClick={() => setAigcOpen(true)} className="text-brand">
                《AIGC 内容须知》
              </button>
              承担发布者责任。
              <span className="text-slate-500">这项声明不可关闭。</span>
            </p>
          </div>
        </div>
      </main>

      {aigcOpen && (
        <InfoDialog title={AGREEMENTS.aigc.title} onClose={() => setAigcOpen(false)}>
          {AGREEMENTS.aigc.body}
        </InfoDialog>
      )}

      {discardOpen && (
        <ConfirmDialog
          title="放弃本次合成？"
          confirmLabel="放弃"
          danger
          onConfirm={() => {
            clearDraft();
            // ★ replace 而不是 push：草稿一丢，这一格就是死页 —— 用 push 的话那个守卫
            //   （同一拍就会跑）先把本格 replace 成 /studio，再叠一格 /studio 上去，
            //   用户得按两次返回才走得掉
            navigate("/studio", { replace: true });
          }}
          onClose={() => setDiscardOpen(false)}
        >
          {/* 只说已知事实：丢的是这条合成稿和填好的发布信息。各段素材/草稿丢没丢
              取决于上游存盘情况，这里不知道，就不许诺（DiscardFlowDialog 那条教训） */}
          <p>
            这条合成好的成片和填好的标题、简介会被丢掉，回到工坊。
            {reviseOf && `《${origin?.title || "原作品"}》不受影响，还是现在这一版。`}
          </p>
          {/* ★★ 第三条路（2026-08-30）：这一页原来只有"现在就定死"和"全丢掉"两个选项，
              而用户手上是一条**真金白银炼出来的成片** —— 它是一次性的（发布即定稿，
              合成稿丢了就没了），而**可见性发布后随时能改**。两者的代价完全不对等。
              所以给一条中间路：先按「仅自己可见」发出去，人还在、片还在，什么时候想好了
              再去作品编辑页改成公开。⚠ 这不是"偷偷替他发布"：按钮上写清楚了这一下会做什么。 */}
          {/* ★★ 这条中间路**只在全新发布时成立**：回炉态下"先私密发出去"会走 publishVideo
              ——那是**另发一条新作品**，而用户此刻要的是替换原作品。两条作品会逐字共享
              同一批 Cloudinary 资产（服务端对非方舟 http 地址一律 kept 原样落库），
              删掉任一条另一条当场黑屏、零报错。所以回炉态整颗键不画。 */}
          {!reviseOf && (
          <button
            onClick={() => {
              setVisibility("private");
              setDiscardOpen(false);
              void publish({ visibility: "private" });
            }}
            // ★ 没标题就禁用，而不是"点了之后关掉弹层再在两屏之外报错"——
            //   那种失败方式用户读不出因果（发布键那条整句拒也是同一个理由挪的位置）
            disabled={!!busy || !title.trim()}
            className="mt-3 w-full rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-100 disabled:opacity-40"
          >
            <span className="font-bold">还是先按「仅自己可见」发出去吧</span>
            <br />
            {title.trim()
              ? "片子留住、不出现在任何人的首页；想好了再去作品编辑页改成公开。"
              : "得先给它起个标题，才发得出去（关掉这张卡去填一个）。"}
          </button>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
