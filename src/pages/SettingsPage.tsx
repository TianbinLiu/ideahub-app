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
import { DEFAULT_INSTRUCT, VOICES, currentInstruct, currentRate, currentVoice, rateLabel, setInstruct, setRate, setVoice, type PresetVoice } from "../studio/voices";

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

      <VoiceSection />

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

// ── 铸卡师的声音 ──────────────────────────────────────────────
// 音色全部是火山官方预置（见 studio/voices.ts 的三条选型原则）。
// 试听直接打 /api/tts —— 它是**唯一**能证明"凭据配对了、音色能用、额度还有"的
// 动作，比让用户回工坊触发一句台词再猜哪里错了快得多。
function VoiceSection() {
  const [id, setId] = useState(() => currentVoice().id);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [instruct, setIns] = useState(currentInstruct);
  // null = 跟随音色默认；滑杆一动就变成显式值
  const [rate, setRateState] = useState<number | null>(currentRate);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function preview(v: PresetVoice) {
    setId(v.id);
    setVoice(v.id);
    setErr("");
    setBusy(v.id);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "欢迎来到卡片工坊，把你的素材交给我，我为你炼成卡片。",
          voice: v.id,
          mix: v.mix,
          rate: rate ?? v.rate,
          pitch: v.pitch,
          expressive: v.expressive,
          instruct,
        }),
      });
      if (res.status === 404) {
        setErr("还没配置云端语音：把 TTS_APPID / TTS_TOKEN 填进 .env.local 并重启 dev 服务器");
        return;
      }
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      audioRef.current?.pause();
      const a = new Audio(URL.createObjectURL(await res.blob()));
      audioRef.current = a;
      await a.play();
    } catch (e) {
      setErr(String(e).slice(0, 160));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-xs font-semibold text-slate-400">铸卡师的声音</h2>
      <p className="mb-2.5 text-[11px] text-slate-500">
        点一下即试听并选定。没配云端语音时退回系统内置合成器（需装中文语音包）。
      </p>
      <div className="space-y-2">
        {VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => void preview(v)}
            disabled={!!busy}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-60 ${
              id === v.id ? "border-brand bg-brand/10" : "border-slate-700 bg-panel"
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm text-slate-100">
                {v.name}
                {/* 混音项与单音色不同：语调指令对它无效（那是 2.0 专属） */}
                {v.mix && <span className="rounded bg-slate-700 px-1 text-[10px] text-slate-400">调和</span>}
              </div>
              <div className="truncate text-[11px] text-slate-500">{v.why}</div>
            </div>
            <span className="ml-2 flex-none text-brand">{busy === v.id ? "…" : id === v.id ? "✓" : "▶"}</span>
          </button>
        ))}
      </div>
      {err && <p className="mt-2 text-[11px] text-rose-300">{err}</p>}

      {/* 语速。和语调指令一起构成"挑完音色之后的两个旋钮"：
          这个管快慢、那个管语气。放在音色列表和语调指令中间，顺序即调参顺序。 */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">语速</span>
          <span className="text-[11px] text-slate-500">
            {rate === null ? `跟随音色（${rateLabel(currentVoice().rate ?? 0)}）` : rateLabel(rate)}
          </span>
        </div>
        <input
          type="range"
          min={-30}
          max={20}
          step={5}
          value={rate ?? currentVoice().rate ?? 0}
          onChange={(e) => {
            const v = Number(e.target.value);
            setRateState(v);
            setRate(v);
          }}
          className="w-full accent-brand"
        />
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-600">
          <span>0.70× 慢</span>
          <span>1.00×</span>
          <span>1.20× 快</span>
        </div>
        {rate !== null && (
          <button
            onClick={() => {
              setRateState(null);
              setRate(null);
            }}
            className="mt-1 text-[11px] text-slate-500 underline"
          >
            恢复跟随音色
          </button>
        )}
      </div>

      {/* 语调指令。**这个旋钮比换音色管用**——同一把嗓子加上一句"用成熟冷静的
          语气"，出来的音频与原味逐字节不同。所以放在音色列表下面，紧挨着试听。 */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400">语调指令</span>
          {instruct !== DEFAULT_INSTRUCT && (
            <button
              onClick={() => {
                setIns(DEFAULT_INSTRUCT);
                setInstruct(DEFAULT_INSTRUCT);
              }}
              className="text-[11px] text-slate-500 underline"
            >
              恢复默认
            </button>
          )}
        </div>
        <textarea
          value={instruct}
          onChange={(e) => {
            setIns(e.target.value);
            setInstruct(e.target.value);
          }}
          rows={3}
          maxLength={120}
          placeholder="用一句话描述你想要的语气，例如：请用成熟冷静的语气，语速放慢"
          className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-brand"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          语速与语调改完，点上面任意音色即刻试听 · 语调这一段不计费 · **只对 2.0 单音色生效**，「调和」那几条用不了
        </p>
      </div>
    </section>
  );
}
