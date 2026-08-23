// 设置页：编辑资料（头像/昵称/简介）、画质、玩家形象、存储用量、退出登录。
import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon";
import { useNavigate } from "react-router";
import { setAvatarImage, signOut, updateProfile, isAdmin, isRemoteMode } from "../data/account";
import Avatar from "../components/Avatar";
import { fileToSquareImage } from "../utils/image";
import { useCurrentUser } from "../hooks/useAccount";
import { storageEstimate } from "../data/db";
import { resetGuidesSeen } from "../data/guide";
import { planSweep, runSweep, type SweepPlan } from "../data/cacheSweep";
import { QUALITY_LABELS, getQuality, setQuality, type Quality } from "../studio/quality";
import { DEFAULT_INSTRUCT, VOICES, currentInstruct, currentRate, currentVoice, rateLabel, setInstruct, setRate, setVoice, type PresetVoice } from "../studio/voices";
import { speak } from "../studio/speech";
import { API_BASE, getToken } from "../api/client";
import { checkUpdate, currentVersion, selfUpdateSupported, type UpdateInfo } from "../data/appUpdate";
import UpdateSheet from "../components/UpdateSheet";

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
            // ★ 这里原来把「极致」在原生端禁掉了，因为那时 4K 素材在出包时被裁掉、
            //   getQuality() 会把 high 降回 mid ——「点一次 reload 一次、回来还是均衡」
            //   的死循环。2026-08-11 起 4K 随包发布（见 scripts/prune-app-assets.mjs），
            //   封顶和这里的禁用一起取消。三档现在在 App 里都是真的能用的。
            return (
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
                  ? "作品与卡片已同步到服务器，换设备登录同一账号即可看到；这里是它们在本机的副本，加上生成过程中的中间文件。"
                  : "作品与卡片存在本机数据库里。AI 生成的画面体积较大，空间不足时请删除旧作品。"}
              </p>
              <CacheSweeper onDone={() => void storageEstimate().then(setStorage)} />
            </>
          ) : (
            <span className="text-xs text-slate-500">读取中…</span>
          )}
        </div>
      </section>

      <GuideResetSection />

      <VersionSection />

      {/* ── 管理后台入口 ────────────────────────────────────────
          ★★ 非管理员**看不到这一行**（判断走 data/account 的 isAdmin 那一处，铁律六）。
            摆一个点进去就被拒的入口，只会让人以为功能坏了（CLAUDE.md 那条
            「界面上摆一个永远点不动的选项」）。
          ★ role 缺省（老服务端不返回）时 isAdmin() 为 false，这一段整块不出现 ——
            降级成"和普通用户一样"，而不是报错（铁律七）。
          ★ 顺带把「免扣费」说在这儿：管理员在服务端是不扣 token 的，不说的话
            他会把"这一步免费"当成产品事实（各处报价旁边也有同一句，见 TokenCost）。 */}
      {isAdmin() && (
        <section className="mb-6">
          <h2 className="mb-2.5 text-xs font-semibold text-slate-400">管理</h2>
          <button
            onClick={() => navigate("/admin")}
            className="flex w-full items-center gap-3 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-left"
          >
            <span className="text-lg">🛡️</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-slate-100">管理后台</span>
              <span className="block text-[11px] text-slate-400">处理举报（下架 / 驳回 / 删除）· 平台数据</span>
            </span>
            <Icon name="chevron" size={16} className="flex-none text-slate-500" />
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            你的账号是管理员：AI 生成走的是免扣费通道，消耗不从钱包里扣。
          </p>
        </section>
      )}

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
//
// ★ 必须走 API_BASE 而不是同源 /api/tts。真机上 WebView 的源是 https://localhost，
//   而 Capacitor 的本地静态服务器对未命中的路径做 SPA 回退：POST /api/tts 拿回的是
//   **200 + index.html**，不是 404（真机 CDP 实测）。于是下面按 404 分支的判断永远
//   不成立，代码把一段 HTML 当音频塞进 <audio> 去播——静悄悄地失败，这正是用户报的
//   "点一下无法试听"。dev 时 API_BASE 是空串，同源就落回 vite 的 dev 中间件。
const PREVIEW_LINE = "欢迎来到卡片工坊，把你的素材交给我，我为你炼成卡片。";

function VoiceSection() {
  const [id, setId] = useState(() => currentVoice().id);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [instruct, setIns] = useState(currentInstruct);
  /**
   * 音色区展不展开。**默认收起**（2026-08-23）：这张列表有 24 把嗓子，每条两行 ——
   * 光它就 50 行，而设置页下面还有引导复位、版本、清理缓存几节，路过的人得一直划。
   * ★ 收起时**把当前选的那把画出来**，不是画一个"声音 ›"的空壳：这一节的信息价值
   *   九成在"我现在用的是哪把"，藏掉它等于逼人点开才能确认一件没改过的事。
   * ★ 语速与语调指令跟着一起收 —— 它们要"改完点上面任意音色即刻试听"，
   *   跟列表分开摆就没法试听了（那条相邻关系是这块原来的设计取舍，见下面 ★）。
   */
  const [open, setOpen] = useState(false);
  // null = 跟随音色默认；滑杆一动就变成显式值
  const [rate, setRateState] = useState<number | null>(currentRate);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function preview(v: PresetVoice) {
    setId(v.id);
    setVoice(v.id);
    setErr("");
    setBusy(v.id);
    try {
      const tk = getToken();
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({
          text: PREVIEW_LINE,
          voice: v.id,
          mix: v.mix,
          rate: rate ?? v.rate,
          pitch: v.pitch,
          expressive: v.expressive,
          instruct,
        }),
      });
      // ★ 这台服务器就是没有云端嗓子（404 没挂路由 / 501 没配密钥 / 401 掉登录）：
      //   **真的退回系统合成器**，而不是只弹一句错误。上面那行小字向用户承诺过
      //   "没配云端语音时退回系统内置合成器"，此前根本没实现——点一下静悄悄，
      //   跟坏了一模一样。
      if (res.status === 404 || res.status === 501 || res.status === 401 || res.status === 403) {
        if (!speak(PREVIEW_LINE)) setErr("这台设备既没有云端语音，系统也没装中文语音包，试听不了");
        return;
      }
      if (!res.ok) {
        setErr(`云端语音没出声（${res.status}）：稍后再试，或到火山控制台看额度`);
        return;
      }
      audioRef.current?.pause();
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      // 试听一次几十 KB，切着音色连点十几下就是十几个悬着的 blob——播完就放掉
      a.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
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
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-panel px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-slate-100">{VOICES.find((v) => v.id === id)?.name ?? "跟随系统"}</span>
          <span className="block truncate text-[11px] text-slate-500">{VOICES.find((v) => v.id === id)?.why ?? ""}</span>
        </span>
        <span className="ml-2 flex-none text-[11px] text-slate-400">{open ? "收起" : `换一把（${VOICES.length} 选）`}</span>
      </button>

      {open && (
        <div className="mt-2.5">
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
          语速与语调改完，点上面任意音色即刻试听 · 语调这一段不计费 · 只对 2.0 单音色生效，「调和」那几条用不了
        </p>
      </div>
        </div>
      )}
    </section>
  );
}

// ── 新手引导的复位 ────────────────────────────────────────────
//
// ★★ 为什么这颗按钮是**必需**的而不是锦上添花：引导是**强制**弹的（第一次进某一屏时
//   自动拦下来，只能一路点「下一步」，没有跳过）。用户在没看懂的时候连点几下过去，
//   那一屏就再也不会自动出现了 —— 而"再也不会自动出现"正是这个设计要的效果，
//   所以必须另给一条回头路。没有它的话，用户只能一页一页去找那颗 `?`。
// ★ 不显示"你看过几份"之类的计数：那是个用户看不懂也做不了事的数字（设置页那条
//   「已用 xx MB」踩过同一个形状，后来配了真能清的按钮才成立）。
// ★ 只清**这台设备**上的记录：引导状态本来就只存在 localStorage，不上服务端。
function GuideResetSection() {
  const [done, setDone] = useState(false);
  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-xs font-semibold text-slate-400">新手引导</h2>
      <div className="rounded-xl border border-slate-700 bg-panel p-4">
        <p className="mb-2.5 text-[11px] leading-relaxed text-slate-500">
          每个界面第一次打开时会自动放一遍使用引导，之后不再自动弹。想再看某一屏，点那一屏角落的
          <b className="text-slate-300"> ? </b>就行；下面这颗是把<b className="text-slate-300">所有</b>引导恢复成"没看过"。
        </p>
        <button
          onClick={() => {
            resetGuidesSeen();
            setDone(true);
          }}
          className="rounded-full bg-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-100"
        >
          {done ? "已恢复——下次进各个界面会重新弹一遍" : "重看所有新手引导"}
        </button>
      </div>
    </section>
  );
}

// ── 版本与更新 ────────────────────────────────────────────────
//
// ★ 只在**侧载渠道**出现。上架包由商店负责更新，摆一个"检查更新"在那里
//   就是一颗点了没反应的按钮（原生那边直接 reject，见 android 的 play 渠道空壳）。
// ★ 手动检查失败要把原因说出来 —— 和启动时那次静默检查不同：用户主动点了，
//   "已是最新"和"根本没查成"必须分得开（铁律八）。
function VersionSection() {
  const [ver, setVer] = useState<{ versionCode: number; versionName: string } | null>(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void currentVersion().then(setVer);
    void selfUpdateSupported().then(setSupported);
  }, []);

  if (!ver) return null; // 浏览器里跑：没有版本号可显示，整段不出现

  return (
    <section className="mb-6">
      <h2 className="mb-2.5 text-xs font-semibold text-slate-400">版本</h2>
      <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-panel p-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-100">
            {ver.versionName} <span className="text-[11px] text-slate-500">（{ver.versionCode}）</span>
          </div>
          <div className="text-[11px] text-slate-500">{note || (supported ? "可以检查有没有新版本" : "由应用商店负责更新")}</div>
        </div>
        {supported && (
          <button
            onClick={() => {
              setBusy(true);
              setNote("");
              void checkUpdate(false)
                .then((r) => {
                  if (r) setInfo(r);
                  else setNote("已经是最新版本");
                })
                .catch((e) => setNote(e instanceof Error ? e.message : "检查失败"))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
            className="flex-none rounded-full bg-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          >
            {busy ? "检查中…" : "检查更新"}
          </button>
        )}
      </div>
      {info && <UpdateSheet info={info} onClose={() => setInfo(null)} />}
    </section>
  );
}

// ── 清理缓存 ──────────────────────────────────────────────────
//
// ★ 为什么要有这颗按钮：光显示"已用 300MB"是一条**用户看不懂、也做不了任何事**的信息 ——
//   只会让人担心，却给不出下一步。要么让它可操作，要么别显示。
// ★ 清的只有"没人引用的中间文件"（判据与安全边界见 data/cacheSweep.ts）：
//   未发布的草稿、还没传上去的作品，一个都不碰。所以文案敢把话说死。
// ★ 没得清的时候明说"没有可清理的"，不做成一颗点了假装忙一下的按钮。
function CacheSweeper({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<SweepPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void planSweep().then(setPlan);
  }, []);

  if (!plan) return <p className="mt-2 text-[11px] text-slate-600">正在算可清理的空间…</p>;

  const mb = plan.bytes / 1048576;
  if (plan.keys.length === 0) {
    return <p className="mt-2 text-[11px] text-slate-600">{note || "没有可清理的中间文件"}</p>;
  }

  return (
    <div className="mt-3">
      <button
        onClick={() => {
          setBusy(true);
          void runSweep(plan)
            .then((n) => {
              setNote(`已清理 ${n} 个文件`);
              setPlan({ keys: [], bytes: 0 });
              onDone();
            })
            .finally(() => setBusy(false));
        }}
        disabled={busy}
        className="w-full rounded-xl border border-slate-600 py-2 text-xs text-slate-200 disabled:opacity-50"
      >
        {busy ? "清理中…" : `清理缓存（可释放 ${mb < 1 ? "<1" : mb.toFixed(0)} MB）`}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">
        只删生成过程中留下的、已经没人用的中间文件。未发布的草稿和还没传上去的作品不会动。
      </p>
    </div>
  );
}
