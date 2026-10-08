// 「火山引擎适用」—— 真人卡做火山引擎肖像授权的**唯一界面入口**（铁律六）。三个宿主共用：
// 自己传图造卡的真人素材页、从视频圈选造卡、卡片详情页。
//
// ★★ 形状是一个勾选框（2026-09-30 主人拍板）：勾上 = 这张卡的真人素材做过火山引擎认证，
//   只收授权素材的档位（高清 / 电影级）才对它开放；不勾 = 照样能铸卡、照样能用真人档。
//   所以这里**一句说明都不写**：哪一档能用、哪一档不能用，由档位按钮本身可点与否表达
//   （TierRow 读 account.realFaceIssue —— 判据只有那一处）。
// ★ 勾上的流程：
//   ① 先查这个账号在火山已有哪些可用素材 —— 授权过的人不该每做一张卡就重扫一遍脸；
//      有 → 列出来挑一份，或「扫脸认证新的」；没有 → 直接生成邀约、在系统浏览器打开火山那一页。
//   ② 在火山登录 + 活体认证；回到 App（系统浏览器关掉 / 页面重新可见）就自动查一次，
//      另有一个慢轮询兜住「让本人用他自己的手机扫码」那条路（那时本机不会发生"回来"）。
//   ③ 认"新"素材靠**发起前的 id 快照做差集**，不靠时间戳：账号里可能早就有别人的素材，
//      拿"最新的一份"去绑，就是把别人的脸绑到这张卡上 —— 零报错（出片时换成另一个人的脸）。
//      差出来正好一份才自动勾上；多于一份就列出来让人挑。
// ★ 取消勾选 = 解绑，具体做什么由宿主决定（造卡流程 = 丢掉待绑定；详情页 = 当场解绑）。
// ★ 服务端没配 AK/SK 时邀约会 503 —— 只在出错时才摆出「填 asset ID」的手填退路（铁律八：
//   坏了要有出口；没坏就别占地方）。
// ★ 走系统浏览器而不是 App 内 WebView：那一页要登录火山账号并做活体认证，系统浏览器才有
//   相机权限与已登录态，也让用户看得见地址栏是 volcengine.com（在我们自己的 WebView 里让人
//   输火山密码，是钓鱼页的形状）。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import {
  assetUsable,
  createPortraitInvite,
  fetchPortraitAssets,
  type PortraitAsset,
  type PortraitInvite,
} from "../api/portrait";
import { normalizeAssetId } from "../data/cardAsset";
import { relativeTime } from "../types";
import { isNative } from "../utils/oauth";
import QrCode from "./QrCode";

/** 等火山结果的慢轮询：间隔与上限。★ 上限到了就停，别让一张忘在后台的页一直打方舟的 OpenAPI */
const POLL_MS = 8_000;
const POLL_LIMIT_MS = 10 * 60_000;

type Phase = "idle" | "pick" | "wait";

function assetTime(raw: string | undefined): string {
  if (!raw) return "";
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? relativeTime(ms) : raw;
}

export default function VolcCompatToggle({
  boundId,
  onBound,
  onUnbind,
  disabled,
}: {
  /** 这张卡此刻绑着的素材 id；null = 没勾 */
  boundId: string | null;
  /** 认到一份可用素材（自动认到的 / 列表里挑的 / 手填的）。note 是来源说明 */
  onBound: (assetId: string, note: string) => void;
  /** 取消勾选 */
  onUnbind: () => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  /** 只放**出了事**的话：查不到、发不起、审核没过。正常路径上一个字都不说 */
  const [msg, setMsg] = useState("");
  const [pickable, setPickable] = useState<PortraitAsset[]>([]);
  const [invite, setInvite] = useState<PortraitInvite | null>(null);
  /** 这一轮新出现、但没过方舟内容审核的素材 —— 失败原因是用户唯一能据以补救的信息 */
  const [failed, setFailed] = useState<PortraitAsset[]>([]);
  const [qr, setQr] = useState(false);
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftErr, setDraftErr] = useState("");
  /** 发起前就已经在账号里的素材 id（可用的与审核失败的都算）——认"新"素材的差集基准 */
  const beforeRef = useRef<Set<string>>(new Set());
  const checkingRef = useRef(false);
  // ★ 回调走 ref：等待期间的监听器（可见性 / 浏览器关闭 / 轮询）是**挂载那一拍**建的，
  //   直接闭包 onBound 会拿到宿主旧一轮渲染的那份（宿主状态已经变了）
  // ★ 翻译函数不能这样走 ref：Lingui 宏只转换 useLingui() 解构出来的那个 `t` 绑定，
  //   对 ref 上存的函数做模板串调用不会被转换 —— 提取不到、运行时也拼不出句子。语言在等待中途被切换
  //   的那一刻少数几句话用旧语言说，这个代价可以接受。
  const onBoundRef = useRef(onBound);
  onBoundRef.current = onBound;

  function reset() {
    setPhase("idle");
    setBusy(false);
    setMsg("");
    setPickable([]);
    setInvite(null);
    setFailed([]);
    setQr(false);
    setManual(false);
    setDraft("");
    setDraftErr("");
  }

  function bind(rawId: string, note: string) {
    // 归一与格式判据只有 cardAsset 一处（"asset://xxx" 与纯 id 都收）
    const id = normalizeAssetId(rawId);
    if (!id) {
      setMsg(t`火山返回的素材 ID 形状不认识（${rawId}）`);
      setManual(true);
      return;
    }
    reset();
    onBoundRef.current(id, note);
  }

  async function openHere(url: string) {
    if (!isNative()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
    } catch (e) {
      setMsg(t`打不开系统浏览器（${e instanceof Error ? e.message : String(e)}）`);
      setQr(true); // 打不开就把链接与二维码摆出来，至少还能复制或扫
    }
  }

  /** 勾上：先看已有素材，没有就直接去火山 */
  async function begin() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    setFailed([]);
    let known: PortraitAsset[] = [];
    try {
      known = (await fetchPortraitAssets()).items;
    } catch {
      // 查不到已有素材不能把第一次来的人堵在门外：照样去发起认证。快照为空 ⇒ 回来时认出的"新"素材
      // 可能不止一份，那时会列出来让人挑，而不是替他绑
      known = [];
    }
    beforeRef.current = new Set(known.map((a) => a.id));
    const usable = known.filter(assetUsable);
    setBusy(false);
    if (usable.length > 0) {
      setPickable(usable);
      setPhase("pick");
      return;
    }
    await authorizeNew();
  }

  /** 发起一次新的火山引擎认证并在系统浏览器里打开 */
  async function authorizeNew() {
    setBusy(true);
    setMsg("");
    try {
      const inv = await createPortraitInvite();
      setInvite(inv);
      setPickable([]);
      setPhase("wait");
      void openHere(inv.url);
    } catch (e) {
      setMsg(t`没能发起火山引擎认证：${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 查这一轮有没有**新**素材。
   * @param fromUser 用户自己按的「查结果」：查不到要说一句；自动那几发查不到就安静等下一发
   */
  async function checkNew(fromUser = false) {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const items = (await fetchPortraitAssets()).items;
      const fresh = items.filter((a) => !beforeRef.current.has(a.id));
      const ok = fresh.filter(assetUsable);
      setFailed(fresh.filter((a) => !assetUsable(a)));
      if (ok.length === 1) {
        bind(ok[0].id, t`火山引擎认证`);
        return;
      }
      if (ok.length > 1) {
        setPickable(ok);
        setPhase("pick");
        return;
      }
      if (fromUser && fresh.length === 0) setMsg(t`还没查到认证结果`);
    } catch (e) {
      if (fromUser) setMsg(t`查认证结果没成：${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
    } finally {
      checkingRef.current = false;
    }
  }

  // ★★ 等待期间：回到 App 就查（页面重新可见 / 系统浏览器关掉），外加慢轮询兜住"本人在另一台手机上扫码"
  useEffect(() => {
    if (phase !== "wait") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkNew();
    };
    document.addEventListener("visibilitychange", onVisible);
    let dead = false;
    let handle: { remove: () => Promise<void> } | null = null;
    if (isNative()) {
      void import("@capacitor/browser")
        .then(async ({ Browser }) => {
          const h = await Browser.addListener("browserFinished", () => void checkNew());
          if (dead) void h.remove();
          else handle = h;
        })
        .catch(() => {
          /* 监听挂不上就靠可见性与轮询，不影响主路 */
        });
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        window.clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") void checkNew();
    }, POLL_MS);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVisible);
      void handle?.remove();
      window.clearInterval(timer);
    };
    // checkNew 读的都是 ref 与 setter，跟着 phase 重挂就够
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function saveManual() {
    const id = normalizeAssetId(draft);
    if (!id) {
      setDraftErr(t`这不像火山的素材 ID —— 应该长成 asset-20260401123823-6d4x2 这样`);
      return;
    }
    bind(id, t`手工填入`);
  }

  const checked = !!boundId;
  const open = phase !== "idle" || manual || !!msg || failed.length > 0;

  return (
    <div>
      <label className={`flex items-center gap-2 text-[11px] text-slate-300 ${disabled ? "opacity-40" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || busy}
          onChange={() => {
            if (checked) {
              reset();
              onUnbind();
              return;
            }
            // 流程进行中再点一下 = 不做了（勾选框此刻仍是空的，点它就是"撤回这一次"）
            if (open) {
              reset();
              return;
            }
            void begin();
          }}
          className="h-3.5 w-3.5 flex-none accent-brand"
        />
        <Trans>火山引擎适用</Trans>
      </label>

      {open && (
        <div className="mt-1.5 space-y-1.5 pl-5">
          {phase === "pick" && (
            <div className="space-y-1">
              {pickable.map((it) => (
                <button
                  key={it.id}
                  onClick={() => bind(it.id, t`火山引擎认证`)}
                  className="w-full rounded-lg border border-slate-700 bg-ink/40 px-2 py-1.5 text-left"
                >
                  <span className="block font-mono text-[10px] text-emerald-300">{it.id}</span>
                  <span className="block text-[9px] text-slate-500">
                    {it.name || ""}
                    {it.createTime ? `${it.name ? " · " : ""}${assetTime(it.createTime)}` : ""}
                  </span>
                </button>
              ))}
              <button
                onClick={() => void authorizeNew()}
                disabled={busy}
                className="w-full rounded-full border border-sky-500/40 py-1.5 text-[11px] text-sky-200 disabled:opacity-40"
              >
                {busy ? <Trans>生成中…</Trans> : <Trans>扫脸认证新的</Trans>}
              </button>
            </div>
          )}

          {phase === "wait" && invite && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-400"><Trans>等待火山引擎认证…</Trans></p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
                <button onClick={() => void openHere(invite.url)} className="underline underline-offset-2">
                  <Trans>重新打开</Trans>
                </button>
                <button onClick={() => setQr((v) => !v)} className="underline underline-offset-2">
                  <Trans>本人扫码</Trans>
                </button>
                <button onClick={() => void checkNew(true)} className="underline underline-offset-2">
                  <Trans>查结果</Trans>
                </button>
              </div>
              {qr && (
                <div className="space-y-1">
                  {/* 二维码白底黑点写死不吃主题色（对比度是功能） */}
                  <div className="flex justify-center rounded-lg bg-white p-2">
                    <QrCode text={invite.url} size={160} />
                  </div>
                  <p className="break-all rounded bg-ink/60 px-2 py-1 font-mono text-[9px] text-slate-400">{invite.url}</p>
                </div>
              )}
            </div>
          )}

          {msg && <p className="text-[10px] leading-relaxed text-rose-300">{msg}</p>}

          {failed.map((it) => (
            <p key={it.id} className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[9px] leading-relaxed text-rose-300">
              ✗ {it.name || it.id} <Trans>没过审核：</Trans>
              {it.error?.message || it.error?.code || t`火山没给原因`}
            </p>
          ))}

          {manual && (
            <div>
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftErr("");
                }}
                placeholder={t`粘贴素材 ID 或 asset://…`}
                className="w-full rounded-lg border border-slate-700 bg-ink/60 px-2.5 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-500"
              />
              {draftErr && <p className="mt-1 text-[10px] leading-relaxed text-rose-300">{draftErr}</p>}
              <button onClick={saveManual} className="mt-1.5 w-full rounded-full bg-brand py-1.5 text-[11px] font-bold text-ink">
                <Trans>绑定</Trans>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
