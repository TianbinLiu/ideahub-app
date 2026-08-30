// 合成完成后的编辑发布页：标题 / 分类 / 简介 / 封面 / 可见性 + 左侧成片预览。
//
// ★ 只有「全新发布」这一种模式了。原来还有一种「回炉编辑」（把本次合成塞回既有作品的
//   某一 P），2026-08 随「作品一经发布不可回炉」一并删除 —— 理由见 studioStore 里
//   那段注释：已经有人看过的作品不该被换掉内容。想改内容 = 重新发一条。
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import ConfirmDialog from "../components/ConfirmDialog";
import InfoDialog from "../components/InfoDialog";
import { AGREEMENTS } from "../data/agreements";
import { CoverSection } from "../components/CoverPicker";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import AigcBadge from "../components/AigcBadge";
import Icon from "../components/Icon";
import VisibilityPicker from "../components/VisibilityPicker";
import SegmentPlayer from "../components/SegmentPlayer";
import TagInput from "../components/TagInput";
import { isArkAssetUrl } from "../ai/arkClient";
import { addCards, createDeck, deckSynced } from "../data/account";
import { MIN_PAID_PRICE, PLATFORM_CUT, fmtTokens } from "../data/economy";
import { publishVideo } from "../data/videos";
import { publishedExit, useStudio } from "../studio/studioStore";
import { VIDEO_CATEGORIES, VIDEO_TAG_LEN, VIDEO_TAG_MAX, type Visibility, formatDuration, parseTags, visibilityWire } from "../types";

export default function PublishPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const clearDraft = useStudio((s) => s.clearDraft);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(draft?.category ?? "剧情");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [cover, setCover] = useState(draft?.cover ?? "");
  const [tags, setTags] = useState<string[]>([]);
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState<number>(5000);
  // 可见性默认公开：发布这个动作本身的意思就是"给人看"。
  // 想先自己留着的人可以在这里改，发完在作品编辑页也随时能改回来。
  const [visibility, setVisibility] = useState<Visibility>("public");
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

  /** @param over 立刻要生效、还来不及经过 state 的字段（放弃确认卡里那条"先私密发出去"用） */
  async function publish(over?: { visibility?: Visibility }) {
    if (!draft || publishedRef.current) return;
    if (!title.trim()) {
      setErr("先给视频起个标题");
      return;
    }
    // ★★ 选了付费就必须真有价（见 economy.MIN_PAID_PRICE 的 ★★）：不拦的话
    //   「付费解锁」亮着、pricing 却一个字没写进去，静默发成永久免费。
    if (paid && price < MIN_PAID_PRICE) {
      setErr(`选了「付费解锁」就得填个价：最低 ${fmtTokens(MIN_PAID_PRICE)}。发布后改不了定价，所以这里不能留空。`);
      return;
    }
    // 本片卡组定名（合成时聚合了素材/派生卡，名字要等最终标题定下来）
    const deck = draft.deck?.cards.length
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
      // 上面已经拦掉了 paid 而价不足的情况，这里的条件与那道闸是同一把尺
      ...(paid && price >= MIN_PAID_PRICE ? { pricing: { mode: "paid" as const, partPrices: [price] } } : {}),
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
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/studio" className="flex items-center gap-1 text-slate-400 hover:text-white">
            <Icon name="back" size={18} />
            返回工坊
          </Link>
          <span className="font-bold text-slate-100">发布视频</span>
          <span className="text-xs text-slate-500">
            {draft.segments.length} 段 · 共 {formatDuration(total)}
          </span>
          <HelpButton tour="publish" className="ml-auto" />
        </div>
      </header>

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
            <div className="mt-2 text-center text-[11px] leading-4 text-slate-500">
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
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
            />
          </div>

          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">分类</div>
            <div className="flex flex-wrap gap-2">
              {VIDEO_CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3.5 py-1.5 text-sm ${
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

          {/* 付费设置：免费 / 付费（本 P 的解锁价，观众用 token 解锁，平台抽成后进你的 add-on） */}
          <div data-guide="publish-pricing">
            <div className="mb-1.5 text-sm font-semibold text-slate-300">收费方式</div>
            <div className="flex gap-2">
              {(["free", "paid"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaid(m === "paid")}
                  className={`rounded-full px-3.5 py-1.5 text-sm ${
                    (m === "paid") === paid ? "bg-gold font-semibold text-ink" : "bg-panel text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {m === "free" ? "免费观看" : "付费解锁"}
                </button>
              ))}
            </div>
            {paid && (
              <div className="mt-2.5 flex items-center gap-2.5 rounded-xl border border-gold/30 bg-gold/5 px-3.5 py-2.5">
                <span className="flex-none text-xs text-slate-300">
                  本片解锁价
                </span>
                <input
                  type="number"
                  min={MIN_PAID_PRICE}
                  step={100}
                  value={price}
                  onChange={(e) => {
                    setPrice(Math.max(0, Number(e.target.value) || 0));
                    setErr("");
                  }}
                  className={`w-28 rounded-lg border bg-panel px-2.5 py-1.5 text-sm tabular-nums outline-none ${
                    price < MIN_PAID_PRICE
                      ? "border-rose-500/60 text-rose-200 focus:border-rose-400"
                      : "border-slate-700 text-gold focus:border-gold"
                  }`}
                />
                <span className="flex-none text-xs text-slate-400">token</span>
                <span className="ml-auto flex-none text-[11px] text-slate-500">
                  {/* ★ 价不够时这里说的是"为什么发不出去"，而不是一个算给 0 的到手价 */}
                  {price < MIN_PAID_PRICE
                    ? `最低 ${fmtTokens(MIN_PAID_PRICE)}，不然发不出去`
                    : `你到手 ${fmtTokens(Math.floor(price * (1 - PLATFORM_CUT)))}（平台抽 ${Math.round(PLATFORM_CUT * 100)}%）`}
                </span>
              </div>
            )}
            {/* 「收益进 add-on、可直接用于生成」那句常驻说明搬进了引导（tours 的 publish） */}
          </div>

          {/* ★ 错误行挂在**发布键这一侧**（2026-08-30 移）：用户按的是这颗键，而原来它
              画在最上面那个标题输入框底下 —— 定价那条整句拒绝报在两屏之外，
              在手机上等于没报（铁律八：报错要落在动作发生的地方）。 */}
          {err && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-rose-200">
              {err}
            </div>
          )}

          {/* 作品发出去了、卡组没存上：如实说 + 再试一次 + 一条离开的路（铁律八） */}
          {deckIssue && (
            <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-xs leading-relaxed text-amber-100">
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
                  className="rounded-lg bg-amber-400/90 px-3 py-1.5 text-[11px] font-bold text-ink disabled:opacity-50"
                >
                  {busy ? "重试中…" : "再试一次"}
                </button>
                <button
                  onClick={() => finishAndGo(deckIssue.videoId)}
                  className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-[11px] text-amber-100"
                >
                  先去看作品
                </button>
              </div>
            </div>
          )}

          <div data-guide="publish-actions" className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void publish()}
              disabled={!!busy || !!deckIssue}
              className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110 disabled:opacity-50"
            >
              {busy || "发布"}
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
          <div className="rounded-xl border border-slate-700 bg-panel/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
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
          <p>这条合成好的成片和填好的标题、简介会被丢掉，回到工坊。</p>
          {/* ★★ 第三条路（2026-08-30）：这一页原来只有"现在就定死"和"全丢掉"两个选项，
              而用户手上是一条**真金白银炼出来的成片** —— 它是一次性的（发布即定稿，
              合成稿丢了就没了），而**可见性发布后随时能改**。两者的代价完全不对等。
              所以给一条中间路：先按「仅自己可见」发出去，人还在、片还在，什么时候想好了
              再去作品编辑页改成公开。⚠ 这不是"偷偷替他发布"：按钮上写清楚了这一下会做什么。 */}
          <button
            onClick={() => {
              setVisibility("private");
              setDiscardOpen(false);
              void publish({ visibility: "private" });
            }}
            // ★ 没标题就禁用，而不是"点了之后关掉弹层再在两屏之外报错"——
            //   那种失败方式用户读不出因果（发布键那条整句拒也是同一个理由挪的位置）
            disabled={!!busy || !title.trim()}
            className="mt-3 w-full rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-100 disabled:opacity-50"
          >
            <span className="font-bold">还是先按「仅自己可见」发出去吧</span>
            <br />
            {title.trim()
              ? "片子留住、不出现在任何人的首页；想好了再去作品编辑页改成公开。"
              : "得先给它起个标题，才发得出去（关掉这张卡去填一个）。"}
          </button>
        </ConfirmDialog>
      )}
    </div>
  );
}
