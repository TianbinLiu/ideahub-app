// 作品编辑页（仅作者可进）：改标题 / 分类 / 简介 / 封面 / 可见性，以及删除整部作品。
//
// ★ 这里**不能改内容**。原来还有「🛠 工坊重制某一 P」「＋ 新增一 P」「删除某一 P」，
//   2026-08 一并删掉，两条理由各自都成立：
//     1. 产品定案：作品一经发布不可回炉。已经有人看过、收藏过这条作品之后再换掉成片，
//        同一个链接下的内容就变了，而观众那边没有任何提示。
//     2. 它本来就没生效过。服务端的 BranchVideo **压根没有 parts 字段**，
//        分集的增删改只写进了本地 cache，刷新一次就打回原形——
//        典型的"静默且全局"的坏失败（铁律八）。与其留个假按钮不如拿掉。
//   多 P 的**读**路径保留（VideoPage 的选集条），老作品里已有的分集照常播。
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CoverSection } from "../components/CoverPicker";
import Icon from "../components/Icon";
import VisibilityPicker from "../components/VisibilityPicker";
import { deleteVideoItem, getVideo, isMyAuthor, partsOf, updateVideoMeta } from "../data/videos";
import { useVideosVersion } from "../hooks/useVideos";
import { VIDEO_CATEGORIES, formatDuration } from "../types";

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
  const [visibility, setVisibility] = useState<"public" | "private">(video?.visibility ?? "public");
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

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
    setVisibility(video?.visibility ?? "public");
  }, [video?.id, video?.visibility]);

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

  function save() {
    if (!video) return;
    if (!title.trim()) {
      setErr("标题不能为空");
      return;
    }
    updateVideoMeta(video.id, {
      title: title.trim(),
      category,
      description: description.trim(),
      cover,
      visibility,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function remove() {
    if (!video) return;
    deleteVideoItem(video.id);
    // 回个人页而不是回作品页——那条作品已经没了，跳回去只会看到"作品不存在"
    navigate("/me", { replace: true });
  }

  const totalOf = (i: number) => parts[i].segments.reduce((s, x) => s + x.durationSec, 0);

  return (
    <div className="min-h-full">
      {/* ★ safe-top 挂在 header 自己身上、不挂页面根：header 是 sticky top-0，
          安全区留白必须【在它内部】，否则它会滑到状态栏底下（ProfilePage 那条注释同理）。
          原来这三页压根没挂，顶栏文案直接压在状态栏上。 */}
      <header className="safe-top sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to={`/video/${video.id}`} className="flex items-center gap-1 text-slate-400 hover:text-white">
            <Icon name="back" size={18} />
            回到作品
          </Link>
          <span className="font-bold text-slate-100">编辑作品</span>
          <span className="truncate text-xs text-slate-500">{video.title}</span>
        </div>
      </header>

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
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
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
          <p className="mt-3 rounded-xl border border-slate-700/60 bg-panel/40 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-400">
            🔒 成片内容已定稿，发布后不能再改。
            想调整剧情或画面，请用同一套卡组重新做一部——
            <Link to="/studio" className="text-brand">去工坊再创作</Link>。
          </p>
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
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-slate-100 outline-none focus:border-brand"
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
              rows={4}
              maxLength={1000}
              className="w-full rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm leading-relaxed text-slate-100 outline-none focus:border-brand"
            />
          </div>

          <CoverSection cover={cover} onCover={setCover} segments={allSegments} />

          <VisibilityPicker value={visibility} onChange={setVisibility} />

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110">
              保存修改
            </button>
            {saved && <span className="text-sm text-emerald-300">✓ 已保存</span>}
          </div>

          {/* 删除放最后、要二次确认：这是本页唯一不可撤销的动作。
              ★ 不用 window.confirm —— Capacitor 的 WebView 里它是个系统弹窗，
              样式与整个 app 割裂，而且在部分机型上会被当成"网页弹窗"直接拦掉。 */}
          <div className="mt-2 border-t border-slate-800 pt-4">
            {confirmDel ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
                <div className="text-sm font-bold text-rose-200">删除《{video.title}》？</div>
                <p className="mt-1 text-[11px] leading-relaxed text-rose-200/70">
                  成片、评论和点赞会一起消失，不能撤销。
                  {visibility === "private" && "只是暂时不想让人看到的话，选「仅自己可见」就够了。"}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setConfirmDel(false)}
                    className="flex-1 rounded-xl bg-slate-700/70 py-2 text-sm text-slate-200"
                  >
                    取消
                  </button>
                  <button
                    onClick={remove}
                    className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:brightness-110"
                  >
                    确认删除
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
    </div>
  );
}
