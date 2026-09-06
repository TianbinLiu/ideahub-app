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
import {
  DEFAULT_IMAGE_TIER,
  IMAGE_TIERS,
  dearestCardType,
  fmtTokens,
  forgeCardCount,
  forgeCost,
  forgeSettle,
  imageTierOf,
  imageTierPriceIssue,
  modelLabel,
  slotsFor,
} from "../../data/economy";
import { Card, CARD_TYPES, CARD_TYPE_COVERS, CARD_TYPE_LABELS, CardType } from "../../types";
import TarotCard from "../../components/TarotCard";
import TokenCost from "../../components/TokenCost";
import { NPC_SCREEN } from "../scene/cameraOrbit";
import { setVoiceEnabled, voiceEnabled, voiceStatus, voiceSupported } from "../speech";
import { useBackGuard } from "../backGuards";
import { routeIntent, searchKeyword } from "../npcIntent";
import { CHAT_TURN_TOKENS } from "../../data/economy";

export default function NpcDialog() {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const thinking = useStudio((s) => s.dialog.thinking);
  // 炼卡阶段播报（顶档一炉两张图、每张实测 70 秒以上）。空串时退回那句固定的"炉火正旺"
  const forgeProgress = useStudio((s) => s.forgeProgress);
  const projection = useStudio((s) => s.projection);
  const marketOpen = useStudio((s) => s.market.open);
  // 对话默认隐藏：可见性由 store 的 dialogView 决定，只有点击 3D 里的 NPC 才唤起
  const open = useStudio((s) => s.dialogView);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [forgeOpen, setForgeOpen] = useState(false);
  // 声音开关存 localStorage（跨会话），这里只是把它镜像成可重渲的本地态
  const [voice, setVoice] = useState(voiceEnabled);
  /** 从聊天窗抬进炼卡窗时带过去的描述 */
  const [forgeInit, setForgeInit] = useState("");

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
            <span className="mb-1.5 text-xs font-semibold text-slate-300">铸卡师</span>
            {/* ★ 合规：《AI 生成合成内容标识办法》第 4 条的**显式标识**。
                火山原生的做法（aigc_watermark）是在每句话末尾加一串"滴滴"提示音，
                NPC 对话里每说一句响一次，没法听。第 4 条同时允许"在交互场景界面
                添加显著的提示标识"——所以改由这枚角标承担，音频里只留隐式元数据。
                别为了清爽把它删了，这是上架硬性义务。 */}
            <span className="rounded bg-slate-700/80 px-1 text-[9px] leading-4 text-slate-400">AI 合成语音</span>
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
          <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
            {busy ? forgeProgress || "炉火正旺，卡片成形中…" : thinking ? "……" : (lastNpc?.text ?? "……")}
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
          <span className="pointer-events-none rounded-full px-2 py-0.5 bg-black/45 text-[10px] text-slate-400 backdrop-blur">
            左上角的返回按钮可逐层退出
          </span>
        </div>
      </div>

      {/* ── 市场搜索条：钉在屏幕上方，桌面的卡全程可见 ── */}
      {marketOpen && <MarketTopBar />}

      {historyOpen && (
        <HistorySheet
          onClose={() => setHistoryOpen(false)}
          // 路由判到"炼卡"时不直接花钱，只把用户抬到那个**已经会报价**的三步窗，
          // 并把他刚打的那句话预填进描述里
          onOpenForge={(desc) => {
            setHistoryOpen(false);
            setForgeInit(desc);
            setForgeOpen(true);
          }}
        />
      )}
      {forgeOpen && (
        <ForgeForm
          initialDesc={forgeInit}
          onClose={() => {
            setForgeOpen(false);
            setForgeInit("");
          }}
        />
      )}
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

// ── 炉边：和铸卡师说话的地方 ───────────────────────────────────
//
// 这里原来叫「对话记录」，只是一个只读的历史列表 + 一个**被劫持的**输入行：
// 市场开着时它是搜索框，否则打一句话就**直接炼一张卡**（约 13.7k token，
// 全 app 唯一一个免确认花钱的入口）。现在它是真的聊天窗。
//
// ★ 路由放在这一层而不是 store：forge 档要打开的 ForgeForm 是 NpcDialog 的组件
//   state，store 够不到它（backGuards 的注释也写着这些开关不搬进 store）。
function HistorySheet({ onClose, onOpenForge }: { onClose: () => void; onOpenForge: (desc: string) => void }) {
  const messages = useStudio((s) => s.dialog.messages);
  const busy = useStudio((s) => s.dialog.busy);
  const thinking = useStudio((s) => s.dialog.thinking);
  const forgeProgress = useStudio((s) => s.forgeProgress);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, thinking]);

  function send() {
    const t = text.trim();
    if (!t) return;
    const st = useStudio.getState();
    switch (routeIntent(t)) {
      case "crisis":
        st.meSay(t, "chat");
        st.crisisReply();
        break;
      case "help":
        st.meSay(t, "chat");
        st.helpReply();
        break;
      case "forge":
        // 只开窗预填，**不扣费**——扣费按钮仍在那个窗里，由用户手指按下
        onOpenForge(t);
        break;
      case "market":
        st.meSay(t, "chat");
        void (st.market.open
          ? st.marketSearch(searchKeyword(t))
          : st.openMarket().then(() => st.marketSearch(searchKeyword(t))));
        break;
      default:
        void st.chatToNpc(t);
    }
    setText("");
  }

  return (
    <div className="absolute inset-0 z-30" onClick={onClose}>
      <div
        className="safe-top absolute inset-x-3 top-12 bottom-[30%] mx-auto flex max-w-md flex-col overflow-hidden rounded-2xl border border-slate-600/70 bg-panel/95 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-700/60 px-3.5 py-2.5">
          <span className="text-sm font-semibold text-slate-100">炉边</span>
          {/* ★ 合规角标必须在这儿也有一份：这个 z-30 的窗盖住了 3D 气泡上那枚，
              而用户在聊天窗里停留时间最长——显式标识不能在最主要的界面上消失 */}
          <span className="rounded bg-slate-700/80 px-1 text-[9px] leading-4 text-slate-400">AI 合成语音</span>
          <button onClick={onClose} className="-m-2 ml-auto p-2 text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
          {messages.map((m) =>
            // sys = 居中细线服务条，不是气泡：明确"这不是角色在说话"
            m.kind === "sys" ? (
              <div key={m.id} className="px-4 py-1 text-center text-[11px] leading-relaxed text-amber-200/80">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
                    m.from === "me"
                      ? "bg-brand/20 text-sky-100"
                      : m.kind === "act"
                        ? "border-l-2 border-amber-400/50 bg-slate-700/40 text-slate-300"
                        : "bg-slate-700/60 text-slate-200"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ),
          )}
          {thinking && (
            <div className="flex justify-start">
              <div className="flex gap-1 rounded-2xl bg-slate-700/60 px-3 py-2.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="dot-typing h-1.5 w-1.5 rounded-full bg-slate-400"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}
          {busy && (
            <div className="pl-1 text-xs text-amber-300/90 pulse-soft">{forgeProgress || "炉火正旺，卡片成形中…"}</div>
          )}
        </div>

        {/* 复用 TokenCost 而不是手写：演示模式下它自己会说"不消耗 token"，
            余额不足时自带去充值的出路 */}
        <TokenCost tokens={CHAT_TURN_TOKENS} note="每说一句扣一次" className="px-3 pt-1.5" />
        <div className="flex gap-2 px-2.5 pb-2.5 pt-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            // ★ maxLength 是前端唯一能真正省钱的地方：粘贴十万字就是一次十万 token
            //   的输入，而 400 的报价对它完全失真
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
            }}
            placeholder="和铸卡师说点什么…"
            className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-ink/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-brand"
          />
          <button
            onClick={send}
            disabled={busy || thinking || !text.trim()}
            className="rounded-full bg-brand/80 px-4 py-2 text-sm font-semibold text-ink disabled:opacity-40"
          >
            发送
          </button>
        </div>

        {/* 输入行不再炼卡了，"打字就出卡"的肌肉记忆需要一条回路。
            两颗都先关本窗：市场把卡摊在桌面上、ForgeForm 同样是 z-30，两个 z-30
            叠在一起谁在上由 DOM 顺序决定，很难看 */}
        <div className="flex gap-2 border-t border-slate-700/60 px-2.5 py-2">
          <button
            onClick={() => {
              onClose();
              void useStudio.getState().openMarket();
            }}
            className="flex-1 rounded-full bg-slate-700/60 py-1.5 text-xs text-slate-300"
          >
            🛒 逛市场
          </button>
          <button onClick={() => onOpenForge("")} className="flex-1 rounded-full bg-slate-700/60 py-1.5 text-xs text-slate-300">
            📎 递素材
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

// 卡种封面表 2026-08-28 收进 types.CARD_TYPE_COVERS（「自己传图做卡片」也要同一套，
// 各抄一份必然分叉）。看板娘导览图的出处与注意事项见那边的注释。

function ForgeForm({ onClose, initialDesc = "" }: { onClose: () => void; initialDesc?: string }) {
  const pending = useStudio((s) => s.pendingFiles);
  const busy = useStudio((s) => s.dialog.busy);
  // 炼卡阶段播报：素材窗盖在对话气泡上面，用户这会儿看的是这颗按钮
  const forgeProgress = useStudio((s) => s.forgeProgress);
  const [step, setStep] = useState<ForgeStep>("type");
  const [type, setType] = useState<CardType | null>(null);
  // 从聊天窗抬过来时带着用户刚打的那句话。**step 仍停在 "type"**——让用户自己挑
  // 卡种正是这个三步窗存在的理由，别为了少点一次就跳过它
  const [desc, setDesc] = useState(initialDesc);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<Card[] | null>(null);
  // 出图档位（速写/定妆/精绘）。★ 默认值只能来自 DEFAULT_IMAGE_TIER —— 这里写死
  // "sketch" 就是第二处默认值，改档位表时它不会跟着动，而且一点不报错
  const [tierId, setTierId] = useState<string>(DEFAULT_IMAGE_TIER);
  const fileRef = useRef<HTMLInputElement>(null);

  // 关窗即弃：「取消」就该是取消。描述是组件本地态、关窗必丢，文件却存在 store 里——
  // 不一起清掉，下次打开就莫名其妙带着上一轮的素材，两者行为还对不上。
  useEffect(() => () => useStudio.setState({ pendingFiles: [] }), []);

  const cardN = forgeCardCount(pending.length, !!desc.trim());
  /**
   * 这一炉最多要花多少。**null = 这一档报不出价**（价目表里没有它的模型），不是 0 ——
   * economy 那侧刻意不抛异常（render 里抛 = 白屏，见 economy.imagePriceOf 的 ★★），
   * 把"翻成人话 + 挡住按钮"留给这里。
   */
  const cost = forgeCost(cardN, type, tierId);
  /** 报不出价时的那句人话。唯一实现在 economy，这里只负责显示与拦截 */
  const priceIssue = imageTierPriceIssue(tierId);
  const wallet = walletOf();
  const canForge = pending.length > 0 || !!desc.trim();
  const tier = imageTierOf(tierId);
  /** 这一档给这类卡画哪几张。★ 只问 economy.slotsFor（全仓唯一实现），
   *  界面上的张数与报价、出图、结算永远是同一次 slice 的结果 */
  const slots = type ? slotsFor(type, tierId) : null;
  /**
   * 卡种未定（🎲 让铸卡师看着办）时报价按**最贵的那类**走。
   * ★ 这里不再自己 reduce 一遍：那与 forgeCost 的 null 分支是同一条规则的第二处实现，
   *   两边分叉的样子就是"嘴上说按人物卡报价、实际按别的类算钱"。现在两边同问
   *   economy.dearestCardType（铁律六）。
   */
  const dearest = dearestCardType(tierId);
  const maxSlots = slotsFor(dearest, tierId).length;

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
    // ★ 报不出价就**不开炼**。这是 economy 那侧"认不出的模型不许静默按低价收"那条规则
    //   的落地点：原来它是 imageTokensOf 里的一句 throw，可 forgeCost 是在 render 里调的，
    //   真触发时用户看到的是白屏、错误只进 console —— 一句话都没有，反而更静默（铁律八）。
    //   现在数值侧返回 null、人话侧给 priceIssue，在这里翻成用户看得懂的一句并早退。
    if (priceIssue || cost === null) {
      setErr(priceIssue ?? "这一档暂时报不出价，换个档位再试");
      return;
    }
    if (AI_REAL && !canAfford(cost)) {
      setErr(
        `需要 ${fmtTokens(cost)} token，余额 ${fmtTokens((wallet?.plan ?? 0) + (wallet?.addon ?? 0))} 不够——去「我的」页充值`,
      );
      return;
    }
    setErr("");
    try {
      const { cards, minted, notes } = await useStudio.getState().forgeCards(pending, desc.trim(), type, tierId);
      if (cards.length === 0) {
        setErr("这批素材没能炼出卡，补充点描述再试？");
        return;
      }
      // 按**实际出卡 + 实际出图**结算：预估是"一份素材一张卡、每张都画满这一档"的上限，
      // 模型少出几张就少记几张。
      // ★ minted 是**每张卡各自画成了几张图**，不是"出了卡面的卡数"。旧写法
      //   （cards.filter(c => c.genPrompt).length）是一张卡一个布尔，一卡多图之后
      //   "该画 3 张、成了 2 张"会被算成满额，用户被全额收费且全程零提示。
      // ★★ 这一句真正动余额的只有**离线模式**：远端模式下 spendTokens 是空操作，
      //   真扣费在服务端，按每次方舟调用是否 2xx 记（W2 只对非 2xx 退款）。
      if (AI_REAL) {
        // due 为 null 只可能是"这一档报不出价"，而那时上面的早退根本不会让流程走到这儿
        const due = forgeSettle(minted, tierId);
        if (due !== null) spendTokens(due);
        // 该画几张按**每张卡自己的卡种**算：🎲 那条路上卡种是模型定的，报价时还不知道
        const want = cards.reduce((n, c) => n + slotsFor(c.type, tierId).length, 0);
        const got = minted.reduce((n, k) => n + k, 0);
        // ★★ 措辞只**陈述事实**，不替服务端承诺退款。原话是"少的 N 张没收你的钱"——
        //   客户端根本无从验证这件事，而且它在最常见的那种失败下是**错的**：
        //   图已经画出来、只是取图那一步 504 或弱网超时的，服务端按 2xx 早就扣了，
        //   客户端却把它算作"没画成"。于是钱包响应头刚同步完 -40,000，界面却红字写着
        //   "没收你的钱"，用户照这句话对账只会认定自己被多扣（铁律五、八）。
        //   真实扣了多少以钱包余额为准 —— 那是服务端的权威值，不是我们这边的推算。
        if (got < want)
          setErr(
            `这一炉该出 ${want} 张图、成了 ${got} 张——缺的 ${want - got} 张先用你的原图顶上。` +
              `已经画出来、只是没取回来的那几张仍会计费，实扣以「我的」页余额为准` +
              // ★★ notes 是**哪一张、为什么**。不拼上去的话这句只剩两个数字，
              //   而 forgeProgress 那一行早被 forgeCards 的 finally 清掉了 ——
              //   用户拿着一张缺图的卡和一笔已扣的钱，无从判断该不该重炼（铁律八）。
              (notes.length > 0 ? `。${notes.join("；")}` : ""),
          );
        else if (notes.length > 0) setErr(notes.join("；"));
      } else if (notes.length > 0) {
        // 演示模式（AI_REAL=false）也要说：那条路一张图都没真画，而档位面板照常写着
        // "每张卡出 N 张图"。不说的话界面从头到尾在讲一件没发生的事。
        setErr(notes.join("；"));
      }
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
                  <TarotCard cover={CARD_TYPE_COVERS[t]} title={CARD_TYPE_LABELS[t]} type={t} active={type === t} />
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
                <div className="mb-1.5 text-xs font-semibold text-slate-300">文字描述</div>
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
              {/* ── 出图档位：照工作流「画质」那一行的形态（FlowPage）──
                  报价挂在每颗按钮上，因为**这一步就是在比价**：把价钱只写在下面那条
                  统一提示里，用户要点三次才看得全三档各要多少。
                  ⚠ cardN=0（什么都没填）时整批报价恒为 0，摆一排写着 0 的按钮是骗人，
                  所以整块与 TokenCost 同一个 canForge 闸门 —— 有东西可炼才谈价。 */}
              {canForge && (
                <div className="mt-3 space-y-1.5 rounded-xl border border-slate-700/60 bg-ink/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-8 flex-none text-[11px] text-slate-400">精度</span>
                    {IMAGE_TIERS.map((t) => {
                      // 这一档报不出价（价目表里没有它的模型）时：不写数字、也不许选。
                      // ★ 写个 0 或者按别的档的价糊上去，就是"页面报一个数、火山扣另一个数"
                      const c = forgeCost(cardN, type, t.id);
                      const issue = imageTierPriceIssue(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => setTierId(t.id)}
                          // 炉子开着就别让人改档：结算用的是开炼那一刻的档位（闭包里的
                          // tierId），此时改它不会算错钱，但按钮会显得"改了却没生效"
                          disabled={busy || c === null}
                          title={issue ?? `${t.desc}（${t.model}）`}
                          className={`rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40 ${
                            tierId === t.id ? "bg-brand text-ink" : "bg-panel text-slate-300"
                          }`}
                        >
                          {t.label} · {c === null ? "报不出价" : fmtTokens(c)}
                        </button>
                      );
                    })}
                  </div>
                  {/* 这一档给这类卡出几张、分别是什么。名字来自 types.CARD_SLOTS
                      （经 slotsFor），不在这儿另编一套说法 */}
                  <p className="text-[10px] leading-relaxed text-slate-400">
                    {slots
                      ? `每张卡出 ${slots.length} 张图：${slots.map((s) => s.label).join(" · ")}`
                      : `每张卡最多 ${maxSlots} 张图 —— 卡种交给铸卡师判，这里先按最贵的${CARD_TYPE_LABELS[dearest]}报价；少画的那张不会去调出图，也就不计费`}
                  </p>
                  {/* ★ 把**真正会被调用的那个模型**写出来（与工作流「本段模型」同一做法）：
                      「速写/定妆/精绘」只说了档次，没说这一炉交给谁去画，而不同世代的
                      Seedream 观感与耗时差很多（顶档实测一张 70 秒以上）。
                      名字由 modelLabel 从 id 推导，与真正发出去的 id 同源；title 给完整 id */}
                  <div className="text-[10px] text-slate-500" title={tier.model}>
                    本次出图：{modelLabel(tier.model)}
                    <span className="ml-1 opacity-70">· {tier.desc}</span>
                  </div>
                  {/* ★ note 里原来写的是"按实际画成的结算"。那句只有离线模式成立：
                      远端模式真扣费在服务端，按**每次调用**是否 2xx 记，图画出来了、
                      取图那步超时的照扣（见 economy.forgeSettle 的 ⚠⚠）。所以这里
                      只说"按真正调用了几次出图算"——它两种模式下都是实话（铁律五）。 */}
                  {cost === null ? (
                    <p className="text-[11px] text-rose-300">{priceIssue ?? "这一档暂时报不出价，换个档位再试"}</p>
                  ) : (
                    <TokenCost
                      tokens={cost}
                      upper
                      note={
                        slots
                          ? `${cardN} 张卡 × 最多 ${slots.length} 张图 · 按真正调用了几次出图算 · 每次重炼都会再扣`
                          : `${cardN} 张卡 · 每张最多 ${maxSlots} 张图 · 按真正调用了几次出图算 · 每次重炼都会再扣`
                      }
                    />
                  )}
                </div>
              )}
            </>
          )}

          {/* ── 3 过目 ── */}
          {step === "preview" && preview && (
            <>
              {/* ★★ 价钱**印在那颗按钮上**（2026-08-23 挪的）。原来它只能写在这段提示里，
                  理由写得很清楚：三颗按钮挤一行，375px 屏上塞进 6 位数会把「收下这批卡」
                  挤断行 —— 也就是说，**是排版把价钱从决策点上挤走的**。
                  底下那排已改成两行（收下独占一行，回去改/再炼一炉并排），位置腾出来了，
                  价钱就该回到按下之前看得见的地方。 */}
              <p className="mb-2 text-[11px] text-slate-400">
                还没进你的卡组，点「收下这批卡」才落账。
                {AI_REAL && cost === null && "（这一档现在报不出价，重炼前先换个档位）"}
              </p>
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
              className="rounded-xl bg-slate-700/70 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-40"
            >
              取消
            </button>
            <button
              onClick={() => void forge()}
              disabled={busy || !canForge}
              className="flex-1 rounded-xl bg-brand/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              {/* 顶档一炉要画两张图、每张 70 秒以上。一个不动的"炼卡中…"与卡死无从区分，
                  所以按钮直接显示阶段播报（store.forgeProgress ← generateCards.onProgress） */}
              {busy ? forgeProgress || "炼卡中…" : "交给铸卡师炼卡"}
            </button>
          </div>
        )}
        {step === "preview" && (
          <div className="space-y-2 px-4 pb-3.5 pt-2">
            {/* ★ 免费的那件事（收下）独占一行、最显眼；两颗要么退回、要么再花钱的
                并排在下面。原来三颗等宽挤一行，看不出"哪颗是常规动作、哪颗要再收一次钱"。 */}
            <button
              onClick={accept}
              disabled={busy}
              className="w-full rounded-xl bg-brand/85 py-2.5 text-sm font-bold text-ink disabled:opacity-40"
            >
              收下这批卡
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setPreview(null);
                  setStep("input");
                }}
                disabled={busy}
                className="flex-1 rounded-xl bg-slate-700/70 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-40"
              >
                回去改素材
              </button>
              <button
                onClick={() => void forge()}
                disabled={busy}
                className="flex-1 rounded-xl bg-slate-700/70 px-3 py-2.5 text-xs text-slate-200 disabled:opacity-40"
              >
                {busy ? "…" : AI_REAL && cost !== null ? `↻ 再炼一炉（${fmtTokens(cost)}）` : "↻ 再炼一炉"}
              </button>
            </div>
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
