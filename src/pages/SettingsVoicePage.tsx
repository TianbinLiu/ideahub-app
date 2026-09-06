// 铸卡师的声音：音色 + 语速 + 语调。从设置页拆出来的单功能子页（2026-08-27）。
//
// 音色全部是火山官方预置（见 studio/voices.ts 的三条选型原则）。
// 试听直接打 /api/tts —— 它是**唯一**能证明"凭据配对了、音色能用、额度还有"的
// 动作，比让用户回工坊触发一句台词再猜哪里错了快得多。
//
// ★ 拆页顺手删掉了原来的"默认收起 + 收起时画当前选中"那套：那是 24 把嗓子挤在
//   设置长页里时的自保（光它就 50 行，下面还有五节）。现在整页只有它，直接摊开。
// ★ 使用说明在引导弹窗里（tours.tsx 的 setvoice）。页面上保留两类话：失败原因
//   （err），和"没配云端语音时退回系统合成器"——后者是条件触发的降级解释，
//   藏进看一遍就不弹的引导里等于静默失败（tours.tsx 文件头 ❌ 那条）。
//
// ★ 必须走 API_BASE 而不是同源 /api/tts。真机上 WebView 的源是 https://localhost，
//   而 Capacitor 的本地静态服务器对未命中的路径做 SPA 回退：POST /api/tts 拿回的是
//   **200 + index.html**，不是 404（真机 CDP 实测）。于是按 404 分支的判断永远
//   不成立，代码把一段 HTML 当音频塞进 <audio> 去播——静悄悄地失败。
//   dev 时 API_BASE 是空串，同源就落回 vite 的 dev 中间件。
import { useRef, useState } from "react";
import PageHeader from "../components/PageHeader";
import { useNavigate } from "react-router";
import HelpButton from "../components/guide/HelpButton";
import { useAutoGuide } from "../components/guide/useAutoGuide";
import { useCurrentUser } from "../hooks/useAccount";
import {
  DEFAULT_INSTRUCT,
  VOICES,
  currentInstruct,
  currentRate,
  currentVoice,
  rateLabel,
  setInstruct,
  setRate,
  setVoice,
  type PresetVoice,
} from "../studio/voices";
import { speak } from "../studio/speech";
import { API_BASE, getToken } from "../api/client";

const PREVIEW_LINE = "欢迎来到卡片工坊，把你的素材交给我，我为你炼成卡片。";

export default function SettingsVoicePage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [id, setId] = useState(() => currentVoice().id);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [instruct, setIns] = useState(currentInstruct);
  // null = 跟随音色默认；滑杆一动就变成显式值
  const [rate, setRateState] = useState<number | null>(currentRate);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useAutoGuide("setvoice", !!user);

  // 路由已套 RequireAuth；这里只为 TS 收窄（render 里 navigate 会被 React 丢弃，别改回来）
  if (!user) return null;

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
      //   "没配云端语音时退回系统内置合成器"，不实现的话点一下静悄悄，跟坏了一模一样。
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
    <div className="min-h-full px-4 pb-10">
      <PageHeader sticky inset className="mb-4" onBack={() => navigate(-1)} title="铸卡师的声音" right={<HelpButton tour="setvoice" />} />

      {/* 条件触发的降级说明，留在页面上（没配云端语音的设备靠它解释"怎么换了把嗓子"） */}
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">没配云端语音时退回系统内置合成器（需装中文语音包）。</p>

      <div data-guide="setvoice-list" className="space-y-2">
        {VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => void preview(v)}
            disabled={!!busy}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left disabled:opacity-40 ${
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

      {/* 语速与语调：挑完音色之后的两个旋钮，紧挨着列表才能"改完点任意音色即刻试听" */}
      <div data-guide="setvoice-tune">
        <div className="mt-4">
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
              className="mt-1 text-[11px] text-slate-500 underline underline-offset-2"
            >
              恢复跟随音色
            </button>
          )}
        </div>

        {/* 语调指令。**这个旋钮比换音色管用**——同一把嗓子加上一句"用成熟冷静的
            语气"，出来的音频与原味逐字节不同。 */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">语调指令</span>
            {instruct !== DEFAULT_INSTRUCT && (
              <button
                onClick={() => {
                  setIns(DEFAULT_INSTRUCT);
                  setInstruct(DEFAULT_INSTRUCT);
                }}
                className="text-[11px] text-slate-500 underline underline-offset-2"
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
            className="w-full resize-none rounded-xl border border-slate-700 bg-panel px-3.5 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
