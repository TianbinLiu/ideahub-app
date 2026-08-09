// 铸卡师对话：气泡制。
// · NPC 说话 = 角色旁浮出的漫画对话气泡（rAF 直读 NPC_SCREEN 跟随头顶投影）
// · 「🛒 逛市场 / 📎 添加素材 / 💬 记录」以小气泡选项挂在对话气泡下方
// · 市场模式只在**屏幕上方**放一条搜索栏——桌面摊开的卡再也不会被对话窗挡住
// · 💬 打开历史对话记录窗（含继续对话的输入行）
// · 📎 弹素材表单：文件 + 文字描述一起填好再交给铸卡师，不再直接拉起文件选择器
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../studioStore";
import { fileToCover } from "../../mock/frames";
import { AI_REAL, MaterialFile } from "../../ai";
import { canAfford, spendTokens, walletOf } from "../../data/account";
import { forgeCardCount, forgeCost, fmtTokens } from "../../data/economy";
import { Card, CARD_TYPES, CARD_TYPE_LABELS, CardType } from "../../types";
import TarotCard from "../../components/TarotCard";
import { NPC_SCREEN } from "../scene/cameraOrbit";
import { setVoiceEnabled, voiceEnabled, voiceStatus, voiceSupported } from "../speech";
import { useBackGuard } from "../backGuards";

export default function NpcDialog() {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const projection = useStudio((s) => s.projection);
  const marketOpen = useStudio((s) => s.market.open);
  // 对话默认隐藏：可见性由 store 的 dialogView 决定，只有点击 3D 里的 NPC 才唤起
  const open = useStudio((s) => s.dialogView);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  // 声音开关存 localStorage（跨会话），这里只是把它镜像成可重渲的本地态
  const [voice, setVoice] = useState(voiceEnabled);

  // 气泡跟随 NPC 头顶投影：rAF 直接写 DOM，不走 React 状态（零重渲 60fps 跟随）
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        el.style.left = `${NPC_SCREEN.x * 100}%`;
        el.style.top = `${NPC_SCREEN.y * 100}%`;
        el.style.opacity = NPC_SCREEN.visible ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 退出对话的动作已经搬进 store.exitDialog()，由顶栏返回按钮统一触发——
  // 气泡右上角那个 ✕ 只有 ~14px，手机上根本按不准，删了。
  // 记录窗/素材窗则各自压进返回栈（useBackGuard），按返回先关它们。
  // ⚠ 必须写在下面两个早返回**之前**：Hook 不能出现在条件之后，
  // 否则投影窗一开（projection → return null）本次渲染就少调两个 Hook，
  // React 直接抛 "Rendered more hooks than during the previous render"
  useBackGuard(historyOpen, () => setHistoryOpen(false));
  useBackGuard(forgeOpen, () => setForgeOpen(false));

  // 投影窗打开时隐藏对话层，避免遮挡
  if (projection) return null;
  if (!open) return null;

  const lastNpc = [...messages].reverse().find((m) => m.from === "npc");

  return (
    <>
      {/* ── NPC 对话气泡（跟随角色） ── */}
      <div
        ref={anchorRef}
        className="pointer-events-none absolute z-10 w-[68%] max-w-[340px] -translate-x-1/2 -translate-y-full"
        style={{ left: "50%", top: "30%" }}
      >
        <div className="pointer-events-auto rounded-2xl border border-slate-600/70 bg-panel/95 px-3.5 py-2.5 shadow-[0_6px_24px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="mb-0.5 flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${busy ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
            <span className="text-[11px] font-semibold text-slate-300">铸卡师</span>
            {voiceSupported() && (
              <button
                onClick={() => {
                  const next = !voice;
                  setVoiceEnabled(next);
                  setVoice(next);
                }}
                // ml-auto 原来挂在 ✕ 上（✕ 没了要移回来），热区从 -m-1 p-1 放大到 p-2
                className="-m-2 ml-auto p-2 text-xs text-slate-500 hover:text-white"
                title={
                  voiceStatus() === "no-voice"
                    ? "系统没有中文语音包，暂时发不出声（嘴型仍会动）"
                    : voice
                      ? "关闭语音"
                      : "开启语音"
                }
                aria-label={voice ? "关闭语音" : "开启语音"}
              >
                {voice && voiceStatus() === "ok" ? "🔊" : "🔇"}
              </button>
            )}
          </div>
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-100">
            {busy ? "炉火正旺，卡片成形中…" : lastNpc?.text ?? "……"}
          </div>
        </div>
        {/* 气泡尾巴：指向角色 */}
        <div className="mx-auto h-3 w-3 -translate-y-1.5 rotate-45 border-b border-r border-slate-600/70 bg-panel/95" />
        {/* ── 选项气泡：逛市场 / 添加素材 / 记录 ── */}
        <div className="pointer-events-auto mt-1 flex justify-center gap-2">
          {marketOpen ? (
            <button
              onClick={() => {
                const st = useStudio.getState();
                st.closeMarket();
                st.npcSay("市场先收起来了。还想做点什么？");
              }}
              title="也可以按左上角的返回"
              className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
            >
              ‹ 收起市场
            </button>
          ) : (
            <>
              <button
                onClick={() => void useStudio.getState().openMarket()}
                className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
              >
                🛒 逛市场
              </button>
              <button
                onClick={() => setForgeOpen(true)}
                className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
              >
                📎 添加素材
              </button>
            </>
          )}
          <button
            onClick={() => setHistoryOpen(true)}
            className="rounded-full border border-slate-600/70 bg-panel/90 px-3 py-1.5 text-xs text-slate-200 backdrop-blur hover:border-brand hover:text-brand"
            title="查看历史对话"
          >
            💬 记录
          </button>
        </div>
        {/* 去掉 ✕ 之后要补一条出口指引，否则用户会以为自己被关在对话里了。
            **不要写死"退出对话"**——市场开着的时候顶栏那颗按钮写的是「收起市场」，
            两边对不上反而更迷惑。这里只指路，具体做什么由按钮自己说。
            垫一层半透明底：它正好压在角色身上，纯文字在浅色头发上会看不见 */}
        <div className="mt-1.5 flex justify-center">
          <span className="pointer-events-none rounded-full bg-black/45 px-2 py-0.5 text-[10px] text-slate-400 backdrop-blur">
            左上角的返回按钮可逐层退出
          </span>
        </div>
      </div>

      {/* ── 市场搜索条：钉在屏幕上方，桌面的卡全程可见 ── */}
      {marketOpen && <MarketTopBar />}

      {historyOpen && <HistorySheet onClose={() => setHistoryOpen(false)} />}
      {forgeOpen && <ForgeForm onClose={() => setForgeOpen(false)} />}
    </>
  );
}

// ── 市场搜索条（屏幕上方） ─────────────────────────────────────
function MarketTopBar() {
  const loading = useStudio((s) => s.market.loading);
  const [q, setQ] = useState("");
  function search() {
    void useStudio.getState().marketSearch(q.trim());
  }
  return (
    <div className="safe-top absolute inset-x-0 top-12 z-10 px-3">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-slate-600/70 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="flex-none text-xs font-semibold text-slate-200">🛒 市场</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) search();
          }}
          placeholder="搜索：古风 / 侦探 / 场景…"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
        />
        <button
          onClick={search}
          disabled={loading}
          className="flex-none rounded-full bg-brand/85 px-3 py-1 text-xs font-semibold text-ink disabled:opacity-40"
        >
          {loading ? "…" : "搜索"}
        </button>
      </div>
      <div className="mt-1 text-center text-[10px] text-slate-500">点桌上的卡放大查看 · 喜欢就收进卡组</div>
    </div>
  );
}

// ── 历史对话记录窗 ─────────────────────────────────────────────
function HistorySheet({ onClose }: { onClose: () => void }) {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  function send() {
    if (!text.trim()) return;
    void useStudio.getState().sendToNpc(text);
    setText("");
  }

  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div
        className="safe-top absolute inset-x-3 top-12 bottom-[30%] mx-auto flex max-w-md flex-col overflow-hidden rounded-2xl border border-slate-600/70 bg-panel/95 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-700/60 px-3.5 py-2.5">
          <span className="text-sm font-semibold text-slate-100">对话记录</span>
          <span className="text-[11px] text-slate-500">{messages.length} 条</span>
          <button onClick={onClose} className="ml-auto -m-1 p-1 text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
                  m.from === "me" ? "bg-brand/20 text-sky-100" : "bg-slate-700/60 text-slate-200"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy && <div className="pl-1 text-xs text-amber-300/90 pulse-soft">炉火正旺，卡片成形中…</div>}
        </div>
        <div className="flex gap-2 border-t border-slate-700/60 p-2.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder="和铸卡师聊聊…"
            className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="rounded-xl bg-brand/80 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 素材窗：选卡种 → 交素材 → 过目 → 满意才收 ─────────────────
//
// 以前是"填完即出卡、直接飞进卡组"：卡种全靠正则猜（"白裙少女"常被判成场景卡），
// 猜错了卡也已经进了账号资产，只能绕到创意工坊去删。现在拆成三步——
//   1 选卡种：把最容易出错的一项交回用户手里，模型只负责起名写简介
//   2 交素材：文件 + 描述，并**先报价**（真实 AI 下每次开炼都真烧 token）
//   3 过目：不满意可以回去改素材、也可以原样重炼，点「收下」才落账入组
// 预览态刻意封掉背景点击和 ✕：这批卡是花了 token 炼出来的，别让手滑抹掉。
type ForgeStep = "type" | "input" | "preview";

const TYPE_HINT: Record<CardType, string> = {
  character: "谁在故事里——长相 / 性格 / 口癖",
  scene: "故事发生在哪——地点与空间",
  background: "整体色调与光线氛围",
  prop: "会被拿起来用的关键物件",
  style: "画风与镜头语言的基调",
};

/** 卡种封面：看板娘亲自比划着推销每一类卡（design/gen-cardtype-covers.mjs 出的图）。
 *  她就是创作入口三张封面里那位、也是工坊里的铸卡师——全 app 同一个人。
 *  640×960 webp，五张合计 258KB；想换姿势/换构图重跑那个脚本，别手改图。 */
const TYPE_COVER: Record<CardType, string> = {
  character: "/cardtype/character.webp",
  scene: "/cardtype/scene.webp",
  background: "/cardtype/background.webp",
  prop: "/cardtype/prop.webp",
  style: "/cardtype/style.webp",
};

function ForgeForm({ onClose }: { onClose: () => void }) {
  const pending = useStudio((s) => s.pendingFiles);
  const busy = useStudio((s) => s.dialog.busy);
  const [step, setStep] = useState<ForgeStep>("type");
  const [type, setType] = useState<CardType | null>(null);
  const [desc, setDesc] = useState("");
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Card[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 关窗即弃：「取消」就该是取消。描述是组件本地态、关窗必丢，文件却存在 store 里——
  // 不一起清掉，下次打开就莫名其妙带着上一轮的素材，两者行为还对不上。
  useEffect(() => () => useStudio.setState({ pendingFiles: [] }), []);

  const cardN = forgeCardCount(pending.length, !!desc.trim());
  const cost = forgeCost(cardN);
  const wallet = walletOf();
  const canForge = pending.length > 0 || !!desc.trim();

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    const mats: MaterialFile[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const dataUrl = await fileToCover(f);
      let textContent: string | null = null;
      if (!dataUrl && /\.(txt|md)$/i.test(f.name)) {
        try {
          textContent = (await f.text()).slice(0, 500);
        } catch {
          textContent = null;
        }
      }
      mats.push({ name: f.name, dataUrl, text: textContent });
    }
    useStudio.getState().addFiles(mats);
    setReading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function forge() {
    if (busy || !canForge) return;
    if (AI_REAL && !canAfford(cost)) {
      setErr(
        `需要 ${fmtTokens(cost)} token，余额 ${fmtTokens((wallet?.plan ?? 0) + (wallet?.addon ?? 0))} 不够——去「我的」页充值`,
      );
      return;
    }
    setErr("");
    try {
      const cards = await useStudio.getState().forgeCards(pending, desc.trim(), type);
      if (cards.length === 0) {
        setErr("这批素材没能炼出卡，补充点描述再试？");
        return;
      }
      // 按**实际出卡**结算：预估是"一份素材一张卡"的上限，模型少出几张就少收几张
      if (AI_REAL) spendTokens(forgeCost(cards.length));
      setPreview(cards);
      setStep("preview");
    } catch (e) {
      setErr(`炼卡失败：${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
  }

  function accept() {
    if (!preview) return;
    useStudio.getState().acceptForge(preview);
    useStudio.setState({ pendingFiles: [] });
    onClose();
  }

  const locked = busy || step === "preview";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4"
      onClick={locked ? undefined : onClose}
    >
      <div
        className="flex max-h-[88%] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-600/70 bg-panel/95 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
          {step !== "type" && !busy && (
            <button
              onClick={() => setStep(step === "preview" ? "input" : "type")}
              className="-ml-1 rounded-lg px-1.5 py-0.5 text-slate-400 hover:text-white"
              aria-label="上一步"
            >
              ‹
            </button>
          )}
          <h3 className="text-sm font-bold text-slate-100">
            {step === "type"
              ? "📎 想炼一张什么卡？"
              : step === "input"
                ? `📎 ${type ? CARD_TYPE_LABELS[type] : "自动判断"} · 递上素材`
                : "🔥 出炉了，过个目"}
          </h3>
          <span className="ml-auto text-[10px] text-slate-500">
            {step === "type" ? "1/3" : step === "input" ? "2/3" : "3/3"}
          </span>
          {!locked && (
            <button onClick={onClose} className="-mr-1 p-1 text-slate-400 hover:text-white">
              ✕
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1">
          {/* ── 1 选卡种 ── */}
          {step === "type" && (
            // 卡牌网格而不是一行一项：这一步选的就是"卡"，用列表选卡是在用文字描述图像。
            // 三列——竖屏 375px 下每格约 97px 宽、145px 高（2:3），看板娘的手势还认得出；
            // 四列会把她压到 70px，姿势就糊成一团了
            <div className="grid grid-cols-3 gap-2.5">
              {CARD_TYPES.map((t) => (
                <button key={t} onClick={() => { setType(t); setStep("input"); }} className="group text-left">
                  <TarotCard cover={TYPE_COVER[t]} title={CARD_TYPE_LABELS[t]} type={t} active={type === t} />
                  <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-slate-500 group-hover:text-slate-300">
                    {TYPE_HINT[t]}
                  </p>
                </button>
              ))}
              {/* 第六格：交给铸卡师判断。做成同尺寸的虚线卡位，与上面五张排成一个 2×3 的整块 */}
              <button onClick={() => { setType(null); setStep("input"); }} className="group text-left">
                <div className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-1 rounded-[5%] border border-dashed border-slate-600 bg-ink/40 px-1 text-center group-hover:border-brand">
                  <span className="text-xl">🎲</span>
                  <span className="text-[10px] leading-tight text-slate-400 group-hover:text-brand">让铸卡师<br />看着办</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-tight text-slate-500">按素材自动判断类型</p>
              </button>
            </div>
          )}

          {/* ── 2 交素材 ── */}
          {step === "input" && (
            <>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={reading}
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-slate-600 py-4 text-slate-400 hover:border-brand hover:text-brand disabled:opacity-40"
              >
                <span className="text-2xl">{reading ? "⏳" : "🖼"}</span>
                <span className="text-xs">{reading ? "读取中…" : "点击选择图片 / 文本文件（最多 6 个，可不选）"}</span>
              </button>
              {pending.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {pending.map((f) => (
                    <span
                      key={f.name}
                      className="flex items-center gap-1 rounded-full bg-slate-700/70 px-2 py-0.5 text-xs text-slate-200"
                    >
                      {f.dataUrl ? "🖼" : "📄"} {f.name.length > 14 ? f.name.slice(0, 14) + "…" : f.name}
                      <button
                        className="text-slate-400 hover:text-white"
                        onClick={() => useStudio.getState().removeFile(f.name)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3">
                <div className="mb-1 text-xs font-semibold text-slate-300">文字描述</div>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder={
                    type === "character"
                      ? "如：白裙短发的海边少女，安静但固执"
                      : type === "scene"
                        ? "如：黄昏的旧海港，锈铁塔吊与晒网的木架"
                        : "描述素材，或直接描述你想要的卡"
                  }
                  className="w-full resize-none rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
                />
              </div>
              {AI_REAL && canForge && (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  预估 {fmtTokens(cost)} token（{cardN} 张卡，每张都要出一次卡面）· 按实际出卡张数结算 · 每次重炼都会再扣
                </p>
              )}
            </>
          )}

          {/* ── 3 过目 ── */}
          {step === "preview" && preview && (
            <>
              <p className="mb-2 text-[11px] text-slate-400">还没进你的卡组——不满意可以回去改素材，或者原样再炼一炉。</p>
              <div className="grid grid-cols-3 gap-2.5">
                {preview.map((c) => (
                  <div key={c.id}>
                    <TarotCard cover={c.cover || null} title={c.name} sub={CARD_TYPE_LABELS[c.type]} type={c.type} />
                    <p className="mt-1 line-clamp-3 text-[10px] leading-tight text-slate-500">{c.summary}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {err && <p className="mt-2 text-[11px] text-rose-300">{err}</p>}
        </div>

        {step === "input" && (
          <div className="flex gap-2 px-4 pb-3.5 pt-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-xl bg-slate-700/70 px-4 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={() => void forge()}
              disabled={busy || !canForge}
              className="flex-1 rounded-xl bg-brand/85 py-2 text-sm font-bold text-ink disabled:opacity-40"
            >
              {busy ? "炼卡中…" : "交给铸卡师炼卡"}
            </button>
          </div>
        )}
        {step === "preview" && (
          <div className="flex gap-2 px-4 pb-3.5 pt-2">
            <button
              onClick={() => {
                setPreview(null);
                setStep("input");
              }}
              disabled={busy}
              className="rounded-xl bg-slate-700/70 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              回去改
            </button>
            <button
              onClick={() => void forge()}
              disabled={busy}
              className="rounded-xl bg-slate-700/70 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"
            >
              {busy ? "…" : "↻ 重炼"}
            </button>
            <button
              onClick={accept}
              disabled={busy}
              className="flex-1 rounded-xl bg-brand/85 py-2 text-sm font-bold text-ink disabled:opacity-40"
            >
              收下这批卡
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.txt,.md"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
      </div>
    </div>
  );
}
