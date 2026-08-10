// 合成完成后的编辑发布页：标题 / 分类 / 简介 / 封面选择 + 左侧成片预览。
// 两种模式：全新发布（默认）/ 回炉编辑（studioStore.editTarget 非 null）——
// 后者把本次合成保存为既有作品的对应 P，并同步元信息，不新建作品。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CoverSection } from "../components/CoverPicker";
import Icon from "../components/Icon";
import SegmentPlayer from "../components/SegmentPlayer";
import { addCards, createDeck } from "../data/account";
import { PLATFORM_CUT, fmtTokens } from "../data/economy";
import { getVideo, partsOf, publishVideo, saveProject, setVideoParts, updateVideoMeta } from "../data/videos";
import { useStudio } from "../studio/studioStore";
import { VIDEO_CATEGORIES, formatDuration } from "../types";

export default function PublishPage() {
  const navigate = useNavigate();
  const draft = useStudio((s) => s.draft);
  const clearDraft = useStudio((s) => s.clearDraft);
  const editTarget = useStudio((s) => s.editTarget);
  // 编辑模式的目标作品。getVideo 返回 cache 里的同一对象，取初值用，不需要订阅
  const editingVideo = useMemo(() => (editTarget ? getVideo(editTarget.videoId) : null), [editTarget]);
  const [title, setTitle] = useState(editingVideo?.title ?? "");
  const [category, setCategory] = useState(editingVideo?.category ?? draft?.category ?? "剧情");
  const [description, setDescription] = useState(editingVideo?.description ?? draft?.description ?? "");
  const [cover, setCover] = useState(editingVideo?.cover ?? draft?.cover ?? "");
  // 付费设置：编辑模式取本 P 已有定价；全新发布默认免费
  const [paid, setPaid] = useState(
    (editingVideo?.pricing?.partPrices?.[editTarget?.partIndex ?? 0] ?? 0) > 0,
  );
  const [price, setPrice] = useState<number>(
    editingVideo?.pricing?.partPrices?.[editTarget?.partIndex ?? 0] || 5000,
  );
  const [err, setErr] = useState("");

  // 仅“直接闯入且无草稿”时送回工坊；发布成功后的 clearDraft 不应抢跳
  const publishedRef = useRef(false);
  useEffect(() => {
    if (!draft && !publishedRef.current) navigate("/studio", { replace: true });
  }, [draft, navigate]);

  if (!draft) return null;
  const total = draft.segments.reduce((s, x) => s + x.durationSec, 0);

  function publish() {
    if (!draft) return;
    if (!title.trim()) {
      setErr("先给视频起个标题");
      return;
    }
    // 源工程随发布落库：回工坊"重制"时才有完整节点树（三方案/未选走向）可还原
    const root = useStudio.getState().root;
    // 本片卡组定名（合成时聚合了素材/派生卡，名字要等最终标题定下来）
    const deck = draft.deck?.cards.length
      ? { name: `《${title.trim()}》卡组`, cards: draft.deck.cards }
      : undefined;
    if (editTarget && editingVideo) {
      const parts = partsOf(editingVideo).slice();
      const part = { name: editTarget.partName, segments: draft.segments, branchTree: draft.branchTree };
      if (editTarget.partIndex < parts.length) parts[editTarget.partIndex] = part;
      else parts.push(part);
      setVideoParts(editingVideo.id, parts);
      // 每 P 独立定价：本次编辑只改当前 P 的价，其余 P 保持原价
      const basePrices = editingVideo.pricing?.partPrices ?? [];
      const partPrices = parts.map((_, i) =>
        i === editTarget.partIndex ? (paid ? price : 0) : (basePrices[i] ?? 0),
      );
      updateVideoMeta(editingVideo.id, {
        title: title.trim(),
        category,
        description: description.trim(),
        cover,
        pricing: partPrices.some((p) => p > 0) ? { mode: "paid", partPrices } : { mode: "free", partPrices },
        // 编辑保存也刷新卡组（重制后素材可能换了）；无卡组的老作品保持原样
        ...(deck ? { deck } : {}),
      });
      if (root) saveProject(editingVideo.id, editTarget.partIndex, root);
      publishedRef.current = true;
      void useStudio.getState().retireWorkDraft();
      useStudio.getState().exitEdit(); // 一并清掉草稿与编辑态
      navigate(`/video/${editingVideo.id}`, { replace: true });
      return;
    }
    const item = publishVideo({
      title: title.trim(),
      category,
      description: description.trim(),
      cover,
      segments: draft.segments,
      branchTree: draft.branchTree,
      deck,
      merged: draft.merged,
      ...(paid && price > 0 ? { pricing: { mode: "paid" as const, partPrices: [price] } } : {}),
    });
    if (root) saveProject(item.id, 0, root);
    // 同名卡组落进作者自己的创意工坊（派生场景卡先入账号卡库，卡组引用才不悬空）
    if (deck) {
      addCards(deck.cards);
      createDeck(deck.name, deck.cards.map((c) => c.id));
    }
    publishedRef.current = true;
    clearDraft();
    // 发布成功 → 退休对应的在途草稿：它已经变成作品了，留在草稿列表里只是噪音，
    // 而且草稿正文带整份帧，白占配额。作品侧的源工程刚在上面 saveProject 存过，
    // 想再改走「重制」那条路，不依赖这条草稿
    void useStudio.getState().retireWorkDraft();
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
          <span className="font-bold text-slate-100">{editTarget ? "更新作品" : "发布视频"}</span>
          <span className="text-xs text-slate-500">
            {draft.segments.length} 个节点段 · 共 {formatDuration(total)}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-5 lg:grid-cols-[1.2fr_1fr]">
        {/* 成片预览 */}
        <div>
          {editTarget && (
            <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-5 text-amber-200">
              🛠 本次合成将保存为《{editTarget.videoTitle}》的 {editTarget.partName}
              {editingVideo && editTarget.partIndex >= partsOf(editingVideo).length ? "（新增一 P）" : "（覆盖原内容）"}
              ，不会新建作品。
            </div>
          )}
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

          {/* 付费设置：免费 / 付费（本 P 的解锁价，观众用 token 解锁，平台抽成后进你的 add-on） */}
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-300">观看权限</div>
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
                  本 P 解锁价{editTarget ? `（P${(editTarget.partIndex ?? 0) + 1}）` : ""}
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
              付费收益进入你的 add-on token，可直接用于生成视频——多 P 作品可在各 P 编辑时分别定价。
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button onClick={publish} className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110">
              {editTarget ? "保存修改" : "发布"}
            </button>
            <button
              onClick={() => {
                clearDraft();
                navigate("/studio");
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
