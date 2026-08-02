// 设置页：编辑资料（头像/昵称/简介）、画质、玩家形象、存储用量、退出登录。
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut, updateProfile } from "../data/account";
import { useCurrentUser } from "../hooks/useAccount";
import { storageEstimate } from "../data/db";
import { QUALITY_LABELS, getQuality, setQuality, type Quality } from "../studio/quality";

const AVATARS = ["🦊", "🐺", "🐱", "🦉", "🐙", "🦋", "🌙", "⭐", "🔮", "🎴", "🎬", "🍥"];

export default function SettingsPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [saved, setSaved] = useState(false);
  const [storage, setStorage] = useState<{ usedMB: number; quotaMB: number } | null>(null);
  const [quality, setQ] = useState<Quality>(() => getQuality());

  useEffect(() => {
    void storageEstimate().then(setStorage);
  }, []);

  if (!user) {
    navigate("/login?next=/settings", { replace: true });
    return null;
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
          ←
        </button>
        <h1 className="text-lg font-bold text-slate-100">设置</h1>
      </div>

      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold text-slate-400">头像</h2>
        <div className="grid grid-cols-6 gap-2">
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
        <div className="space-y-2">
          {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
            <button
              key={q}
              onClick={() => {
                setQ(q);
                if (q !== getQuality()) setQuality(q);
              }}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left ${
                quality === q ? "border-brand bg-brand/10" : "border-slate-700 bg-panel"
              }`}
            >
              <div>
                <div className="text-sm text-slate-100">{QUALITY_LABELS[q].name}</div>
                <div className="text-[11px] text-slate-500">{QUALITY_LABELS[q].desc}</div>
              </div>
              {quality === q && <span className="text-brand">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-xs font-semibold text-slate-400">存储</h2>
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
                作品与卡片存在本机浏览器数据库中。AI 生成的画面体积较大，空间不足时请删除旧作品。
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
