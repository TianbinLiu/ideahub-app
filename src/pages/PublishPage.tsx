// 合成完成后的编辑发布页：标题 / 分类 / 简介 / 封面选择 + 左侧成片预览。
// 两种模式：全新发布（默认）/ 回炉编辑（studioStore.editTarget 非 null）——
// 后者把本次合成保存为既有作品的对应 P，并同步元信息，不新建作品。
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CoverSection } from "../components/CoverPicker";
import Icon from "../components/Icon";
import SegmentPlayer from "../components/SegmentPlayer";
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
    if (editTarget && editingVideo) {
      const parts = partsOf(editingVideo).slice();
      const part = { name: editTarget.partName, segments: draft.segments, branchTree: draft.branchTree };
      if (editTarget.partIndex < parts.length) parts[editTarget.partIndex] = part;
      else parts.push(part);
      setVideoParts(editingVideo.id, parts);
      updateVideoMeta(editingVideo.id, {
        title: title.trim(),
        category,
        description: description.trim(),
        cover,
      });
      if (root) saveProject(editingVideo.id, editTarget.partIndex, root);
      publishedRef.current = true;
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
    });
    if (root) saveProject(item.id, 0, root);
    publishedRef.current = true;
    clearDraft();
    navigate(`/video/${item.id}`, { replace: true });
  }

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-ink/90 backdrop-blur">
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
