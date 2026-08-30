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
import TagInput from "../components/TagInput";
import VisibilityPicker from "../components/VisibilityPicker";
import { deleteVideoItem, getVideo, isMyAuthor, partsOf, updateVideoMeta } from "../data/videos";
import { coverToPermanentUrl } from "../data/publishAssets";
import { useVideosVersion } from "../hooks/useVideos";
import { VIDEO_CATEGORIES, VIDEO_TAG_LEN, VIDEO_TAG_MAX, formatDuration, parseTags } from "../types";

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
  const [visibility, setVisibility] = useState<"public" | "private">(video?.visibility ?? "public");
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
  async function save(over?: { visibility?: "public" | "private" }): Promise<string | null> {
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
      updateVideoMeta(video.id, {
        title: title.trim(),
        category,
        description: description.trim(),
        cover: coverUrl,
        tags,
        visibility: over?.visibility ?? visibility,
      });
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
              className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110 disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存修改"}
            </button>
            {busy && <span className="text-sm text-slate-400">{busy}</span>}
            {saved && <span className="text-sm text-emerald-300">✓ 已保存</span>}
          </div>

          {/* 删除放最后、要二次确认：这是本页唯一不可撤销的动作。
              ★ 不用 window.confirm —— Capacitor 的 WebView 里它是个系统弹窗，
              样式与整个 app 割裂，而且在部分机型上会被当成"网页弹窗"直接拦掉。 */}
          <div className="mt-2 border-t border-slate-800 pt-4">
            {confirmDel ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5">
                <div className="text-sm font-bold text-rose-200">删除《{video.title}》？</div>
                {/* ★ 这句以前只说"成片、评论和点赞会一起消失" —— 而当时服务端一次
                    `uploader.destroy` 都没有：作品从库里没了，成片与封面那几个地址
                    仍然人人可访问。2026-08-30 服务端补上了回收，这句话才配得上"删除"两个字，
                    所以把它写全（铁律五：文案只按已实现的事实写）。 */}
                <p className="mt-1 text-[11px] leading-relaxed text-rose-200/70">
                  成片、评论和点赞会一起消失，云端存的视频与封面也会一并删除。不能撤销。
                </p>
                {/* ★★ 软替代：**这条只对还公开着的作品有意义**（2026-08-30 修）。
                    原来判的是 `visibility === "private"` —— 恰好反了：已经藏起来的人
                    才被劝"藏起来就够了"，而真正想把作品从别人眼前拿走的那位一个字看不到。
                    ★ 做成一颗**直达按钮**而不是一句话：多数人删作品是因为"不想被人看见"，
                      而不是"要腾地方"。这是四家同类产品里唯一被普遍验证有效的止损设计
                      —— 但前提是它得点得动，光说一句"你可以去上面那个选择器改"约等于没有。 */}
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
                        setVisibility(video?.visibility ?? "public"); // 开关翻回去，别让它说谎
                        setDelErr({ why: `没能改成「仅自己可见」：${why}`, kind: "soft" });
                      });
                    }}
                    disabled={saving}
                    className="mt-2.5 w-full rounded-xl border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-left text-[11px] leading-relaxed text-amber-100 disabled:opacity-50"
                  >
                    <span className="font-bold">改成「仅自己可见」就好</span>
                    <br />
                    别人的首页和你的主页上都不再出现，成片和评论都留着，随时能改回来。
                  </button>
                )}
                {delErr && (
                  <p className="mt-2.5 rounded-lg border border-rose-500/50 bg-rose-500/15 px-2.5 py-2 text-[11px] leading-relaxed text-rose-100">
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
                    className="flex-1 rounded-xl bg-slate-700/70 py-2 text-sm text-slate-200 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => void remove()}
                    disabled={deleting}
                    className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50"
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
    </div>
  );
}
