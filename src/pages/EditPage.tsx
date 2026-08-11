// 作品编辑页（仅作者可进）：改标题/分类/简介/封面（四种来源），管理多 P——
// 改名、删除、回工坊重制某一 P、新增一 P。成片内容的修改都发生在工坊
// （startEditPart / startNewPart 载入编辑态后跳 /studio），本页只管"壳"。
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { CoverSection } from "../components/CoverPicker";
import Icon from "../components/Icon";
import {
  getVideo,
  isMyAuthor,
  partsOf,
  setVideoParts,
  shiftProjectsAfterDelete,
  updateVideoMeta,
} from "../data/videos";
import { useVideosVersion } from "../hooks/useVideos";
import { useStudio } from "../studio/studioStore";
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
  const [partNames, setPartNames] = useState<string[]>(parts.map((p) => p.name));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // 深链刚进来时 video 可能还没就绪（远端补详情）；就绪后把表单初值补上。
  // 只在"表单还是空白"时回填，避免覆盖用户已输入的内容。
  useEffect(() => {
    if (!video) return;
    setTitle((t) => (t ? t : video.title));
    setCategory((c) => (c !== "剧情" ? c : video.category));
    setDescription((d) => (d ? d : video.description));
    setCover((c) => (c ? c : video.cover));
    setPartNames((ns) => (ns.length === parts.length ? ns : parts.map((p) => p.name)));
  }, [video, parts]);

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
  // 合并发布的成片不可修改（产品定案）：只能用同款卡组回工坊重新生成
  if (video.merged) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-slate-400">
        <span className="text-3xl">🔒</span>
        <div className="text-center text-sm leading-relaxed">
          《{video.title}》已合并发布，成片不可修改。
          <br />
          想调整内容，请用同款卡组回工坊重新生成一部。
        </div>
        <Link to="/studio" className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-ink">
          🎴 去工坊再创作
        </Link>
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
    updateVideoMeta(video.id, { title: title.trim(), category, description: description.trim(), cover });
    // P 名有改动才整组回写（setVideoParts 会镜像 parts[0] 到顶层字段）
    if (parts.some((p, i) => (partNames[i] ?? p.name) !== p.name)) {
      setVideoParts(video.id, parts.map((p, i) => ({ ...p, name: partNames[i]?.trim() || p.name })));
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  function remakePart(i: number) {
    if (!video) return;
    void useStudio
      .getState()
      .startEditPart(video.id, i)
      .then((ok) => {
        if (ok) navigate("/studio");
        else setErr("载入该 P 失败，稍后再试");
      });
  }

  function addPart() {
    if (!video) return;
    if (useStudio.getState().startNewPart(video.id)) navigate("/studio");
  }

  function deletePart(i: number) {
    if (!video || parts.length <= 1) return;
    if (!window.confirm(`删除 ${partNames[i] || parts[i].name}？该 P 的成片将从作品中移除（不可撤销）。`)) return;
    setVideoParts(video.id, parts.filter((_, j) => j !== i).map((p, j2) => ({ ...p, name: partNames.filter((_, j) => j !== i)[j2] || p.name })));
    shiftProjectsAfterDelete(video.id, i);
    setPartNames((ns) => ns.filter((_, j) => j !== i));
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
        {/* 左：P 管理 */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">分集（P）管理</h2>
          <div className="space-y-2.5">
            {parts.map((p, i) => (
              <div key={i} className="rounded-xl bg-panel/60 p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={partNames[i] ?? p.name}
                    onChange={(e) => setPartNames((ns) => ns.map((n, j) => (j === i ? e.target.value : n)))}
                    maxLength={20}
                    aria-label={`第 ${i + 1} P 名称`}
                    className="w-28 flex-none rounded-lg border border-slate-700 bg-black/30 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                    {p.segments.length} 段 · {formatDuration(totalOf(i))}
                    {p.branchTree ? " · 互动分支" : ""}
                  </span>
                  <button
                    onClick={() => remakePart(i)}
                    className="flex-none rounded-lg bg-brand/15 px-3 py-1.5 text-xs text-brand hover:bg-brand/25"
                    title="回工坊载入这一 P 的节点树，编辑后重新合成"
                  >
                    🛠 工坊重制
                  </button>
                  {parts.length > 1 && (
                    <button
                      onClick={() => deletePart(i)}
                      className="flex-none rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
                    >
                      删除
                    </button>
                  )}
                </div>
                <div className="mt-2 flex gap-1.5 overflow-x-auto">
                  {p.segments.map((sg, si) => (
                    <img key={si} src={sg.firstFrame} alt={sg.title} className="h-12 w-[85px] flex-none rounded object-cover" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={addPart}
            className="mt-3 w-full rounded-xl border border-dashed border-slate-600 py-2.5 text-sm text-slate-300 hover:border-brand hover:text-brand"
          >
            ＋ 新增一 P（进工坊制作）
          </button>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            重制/新增都会打开卡片工坊并进入编辑模式，合成后自动保存回本作品；顶部横幅可随时退出。
          </p>
        </div>

        {/* 右：元信息 + 封面 */}
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

          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} className="rounded-xl bg-brand px-6 py-2.5 font-bold text-ink hover:brightness-110">
              保存修改
            </button>
            {saved && <span className="text-sm text-emerald-300">✓ 已保存</span>}
          </div>
        </div>
      </main>
    </div>
  );
}
