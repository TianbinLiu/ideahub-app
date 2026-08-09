// 设置页：编辑资料（头像/昵称/简介）、画质、玩家形象、存储用量、退出登录。
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useNavigate } from "react-router";
import { setAvatarImage, signOut, updateProfile, isRemoteMode } from "../data/account";
import Avatar from "../components/Avatar";
import { fileToSquareImage } from "../utils/image";
import { useCurrentUser } from "../hooks/useAccount";
import { storageEstimate } from "../data/db";
import { QUALITY_LABELS, getQuality, isNativeApp, setQuality, type Quality } from "../studio/quality";

const AVATARS = ["🦊", "🐺", "🐱", "🦉", "🐙", "🦋", "🌙", "⭐", "🔮", "🎴", "🎬", "🍥"];

export default function SettingsPage() {
  // 远端模式下作品的权威副本在服务器，本地这份只是缓存——文案不能再说「存在本机」
  const remote = isRemoteMode();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  const [quality, setQ] = useState<Quality>(() => getQuality());
  const native = isNativeApp();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarErr, setAvatarErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  if (!user) {
    navigate("/login?next=/settings", { replace: true });
    return null;
  }

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarErr("");
    setAvatarBusy(true);
    try {
      // 压成 256px 见方再存/上传：手机相册原图动辄几 MB，
      // 离线模式会挤爆 IndexedDB，远端模式白占 Cloudinary 流量
      const img = await fileToSquareImage(file, 256);
      await setAvatarImage(img);
    } catch (e) {
      setAvatarErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAvatarBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // 允许重选同一张
    }
  }

  function save() {
    updateProfile({ name: name.trim().slice(0, 16) || user!.name, bio: bio.slice(0, 120) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="safe-top min-h-full px-4 pb-10 pt-3">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-xl text-slate-400">
          <Icon name="back" size={20} />
        </button>
        <h1 className="text-lg font-bold text-slate-100">设置</h1>
      </div>

      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold text-slate-400">头像</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={() => fileRef.current?.click()}
            className="relative shrink-0 rounded-full transition active:scale-95"
            aria-label="更换头像"
          >
            <Avatar name={user.name} src={user.avatar} size={72} />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-brand text-ink">
              <Icon name="plus" size={14} strokeWidth={2.5} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
              className="rounded-xl bg-panel px-4 py-2 text-sm text-slate-100 disabled:opacity-60"
            >
              {avatarBusy ? "处理中…" : "从相册选择"}
            </button>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              自动裁成正方形并压到 256px，不会上传原图。
            </p>
            {avatarErr && <p className="mt-1 text-[11px] text-rose-400">{avatarErr}</p>}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void pickAvatar(e.target.files?.[0])}
        />

        {/* 不想上传照片的用户仍可用 emoji（新账号的默认值也是 emoji） */}
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-500">或选一个 emoji</summary>
          <div className="mt-2 grid grid-cols-6 gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => updateProfile({ avatar: a })}
                className={`flex aspect-square items-center justify-center rounded-xl text-2xl transition ${
                  user.avatar === a ? "bg-brand/25 ring-2 ring-brand" : "bg-panel"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </details>
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-xs font-semibold text-slate-400">资料</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="昵称"
          className="w-full rounded-xl border border-slate-700 bg-panel px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-brand"
        />
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="一句话简介"
          rows={3}
          className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-4 py-2.5 text-sm text-slate-100 outline-none focus:border-brand"
        />
        <button onClick={save} className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink">
          {saved ? "已保存 ✓" : "保存资料"}
        </button>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold text-slate-400">画面质量（3D 工坊）</h2>
        <p className="mb-2 text-[11px] text-slate-500">首次进工坊会按你的设备自动选一档 · 这里是唯一的修改入口（工坊顶栏已不再放画质按钮）</p>
        <div className="space-y-2">
          {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => {
            // 原生壳里"极致"档的大文件在出包时被裁掉了（scripts/prune-app-assets.mjs），
            // getQuality() 会把它降回 mid。于是老代码 `if (q !== getQuality())` 永远成立
            // ——点一次「极致」就 reload 一次、回来还是 mid，用户以为按钮坏了，实际是在
            // 无限重载。直接把这一档在原生端禁掉，并把原因写在档位说明里。
            const blocked = q === "high" && native;
            return (
              <button
                key={q}
                disabled={blocked}
                onClick={() => {
                  setQ(q);
                  if (q !== getQuality()) setQuality(q);
                }}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-45 ${
                  quality === q ? "border-brand bg-brand/10" : "border-slate-700 bg-panel"
                }`}
              >
                <div>
                  <div className="text-sm text-slate-100">{QUALITY_LABELS[q].name}</div>
                  <div className="text-[11px] text-slate-500">
                    {blocked ? "App 安装包不含 4K 贴图，请在网页版使用" : QUALITY_LABELS[q].desc}
                  </div>
                </div>
                {quality === q && !blocked && <span className="text-brand">✓</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold text-slate-400">{remote ? "本机缓存" : "存储"}</h2>
        <div className="rounded-xl border border-slate-700 bg-panel p-4">
          {storage ? (
            <>
              <div className="mb-2 flex justify-between text-xs text-slate-300">
                <span>已用 {storage.usedMB} MB</span>
                <span className="text-slate-500">可用约 {storage.quotaMB} MB</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, (storage.usedMB / Math.max(1, storage.quotaMB)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {remote
                  ? "作品与卡片已同步到服务器，换设备登录同一账号即可看到。这里显示的是本机缓存占用。"
                  : "作品与卡片存在本机浏览器数据库中。AI 生成的画面体积较大，空间不足时请删除旧作品。"}
              </p>
            </>
          ) : (
            <span className="text-xs text-slate-500">读取中…</span>
          )}
        </div>
      </section>

      <button
        onClick={() => {
          signOut();
          navigate("/", { replace: true });
        }}
        className="w-full rounded-xl border border-rose-500/40 py-3 text-sm text-rose-400"
      >
        退出登录
      </button>
    </div>
  );
}
