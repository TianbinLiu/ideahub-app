// 合成完成后的编辑发布页：标题 / 分类 / 简介 / 封面 / 可见性 + 左侧成片预览。
//
// ★ 只有「全新发布」这一种模式了。原来还有一种「回炉编辑」（把本次合成塞回既有作品的
//   某一 P），2026-08 随「作品一经发布不可回炉」一并删除 —— 理由见 studioStore 里
//   那段注释：已经有人看过的作品不该被换掉内容。想改内容 = 重新发一条。
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CoverSection } from "../components/CoverPicker";
import Icon from "../components/Icon";
import VisibilityPicker from "../components/VisibilityPicker";
import SegmentPlayer from "../components/SegmentPlayer";
import { addCards, createDeck } from "../data/account";
import { PLATFORM_CUT, fmtTokens } from "../data/economy";
import { publishVideo } from "../data/videos";
import { publishedExit, useStudio } from "../studio/studioStore";
import { VIDEO_CATEGORIES, formatDuration } from "../types";

export default function PublishPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const clearDraft = useStudio((s) => s.clearDraft);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(draft?.category ?? "剧情");
  const [description, setDescription] = useState(draft?.description ?? "");
  const [cover, setCover] = useState(draft?.cover ?? "");
  const [paid, setPaid] = useState(false);
  const [price, setPrice] = useState<number>(5000);
  // 可见性默认公开：发布这个动作本身的意思就是"给人看"。
  // 想先自己留着的人可以在这里改，发完在作品编辑页也随时能改回来。
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [err, setErr] = useState("");

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

  function publish() {
    if (!draft || publishedRef.current) return;
    if (!title.trim()) {
      setErr("先给视频起个标题");
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
      cover,
      segments: draft.segments,
      branchTree: draft.branchTree,
      deck,
      merged: draft.merged,
      visibility,
      ...(paid && price > 0 ? { pricing: { mode: "paid" as const, partPrices: [price] } } : {}),
    });
    // 同名卡组落进作者自己的创意工坊（派生场景卡先入账号卡库，卡组引用才不悬空）
    if (deck) {
      addCards(deck.cards);
      createDeck(deck.name, deck.cards.map((c) => c.id));
    }
    publishedRef.current = true;
    // 收工三件事（记下作品 + 清合成稿 + 退休在途草稿）收在 store 一处：
    // 顺序错一点，守卫就会抢在跳转前把人送去工坊（见 finishPublish 的 ★）
    useStudio.getState().finishPublish(item.id);
    navigate(`/video/${item.id}`, { replace: true });
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
            {draft.segments.length} 个节点段 · 共 {formatDuration(total)}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-5 lg:grid-cols-[1.2fr_1fr]">
        {/* 成片预览 */}
        <div>
          <SegmentPlayer segments={draft.segments} cover={cover || draft.cover} />
          <div className="mt-2 text-center text-xs text-slate-500">成片预览（各节点段按时间线依次播放）</div>
          {/* 每段的来历必须可见：真实 Seedance 影像还是首尾帧渐变回退。
              此前两者在预览里长得都"会动"，用户分不清哪些是真生成的 */}
          <div className="mt-3 space-y-1.5">
            {draft.segments.map((sg, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-panel/60 px-3 py-1.5 text-xs">
                <span className="flex-none text-slate-500">第 {i + 1} 段</span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{sg.title}</span>
                {sg.videoUrl ? (
                  <span className="flex-none rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                    ✓ Seedance 真实影像
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
          {draft.segments.some((sg) => sg.videoUrl) && (
            <div className="mt-2 text-center text-[11px] leading-4 text-slate-500">
              真实影像链接约 24 小时有效——尽快发布，服务端会转存为长期地址
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
            {err && <div className="mt-1 text-xs text-red-400">{err}</div>}
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
          <div>
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
                  本 P 解锁价
                </span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={price}
                  onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                  className="w-28 rounded-lg border border-slate-700 bg-panel px-2.5 py-1.5 text-sm tabular-nums text-gold outline-none focus:border-gold"
                />
                <span className="flex-none text-xs text-slate-400">token</span>
                <span className="ml-auto flex-none text-[11px] text-slate-500">
                  你到手 {fmtTokens(Math.floor(price * (1 - PLATFORM_CUT)))}（平台抽 {Math.round(PLATFORM_CUT * 100)}%）
                </span>
              </div>
            )}
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              付费收益进入你的 add-on token，可直接用于生成视频。
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={publish} className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110">
              发布
            </button>
            <button
              onClick={() => {
                clearDraft();
                // ★ replace 而不是 push：草稿一丢，这一格就是死页 —— 用 push 的话上面那个
                //   守卫（同一拍就会跑）先把本格 replace 成 /studio，再叠一格 /studio 上去，
                //   用户得按两次返回才走得掉
                navigate("/studio", { replace: true });
              }}
              className="rounded-xl bg-panel px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200"
            >
              放弃本次合成
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
