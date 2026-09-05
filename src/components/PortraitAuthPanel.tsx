// 真人肖像授权面板 —— 「在 app 内发起授权 → 本人扫码/本机打开 → 查状态 → 拿到 asset id」
// 这一整段交互的**唯一实现**。
//
// ★★ 为什么是回调制（onBound）而不是自己写 cardAsset 侧库：三个宿主里有两个是**造卡
//   流程**（自己传图 / 从视频提取），那时卡还不存在、没有 cardId 可写 —— 面板只负责
//   把"确认可用的 assetId"交出去，落库时机由宿主定（造卡 = addCards 成功后，
//   详情页窄条 = 当场写）。反过来让面板直接写库，造卡流程就得先造卡再授权，
//   顺序被实现细节绑死。
// ★ 从 CardDetailPage 整段搬出（2026-08-28，仓库主人拍板"授权挪进造卡流程"）：
//   四分支 checkStatus、二维码、本机打开、手填退路，行为与详情页时代逐条一致。
// ★ 服务端没配 AK/SK 时 invite/check 都会 503 —— 面板把整句错摆出来并留手填那条路
//   （铁律八：坏了要有出口）。
//
// ★★ 2026-09-05 主人点名：**进面板就自动查**，不再让授权过的人每次点「查一下并自动接上」。
//   · 查到可用素材 → 直接列出来让他挑，「发起肖像授权」那颗大按钮不出（只留一行小字
//     「授权另一个人」，否则第二个真人永远没入口）；
//   · 一份都没有 → 才出「发起肖像授权」——第一次来的人看到的就只有它；
//   · 上次查到的可用素材按账号记在本机（localStorage），进面板先画这份、再去方舟刷新，
//     弱网下也不用盯着空白等。缓存只是预览，绑的时候用的仍是方舟现查的那份 id。
//   · 自动那一发**不自动绑**：宿主「取消绑定」之后面板会重新挂载，自动绑回去等于取消键失灵。
//     只有用户自己按「查授权状态」（刚扫完码那一刻）且正好一份可用时才顺手接上（老行为）。
import { useEffect, useState } from "react";
import {
  assetUsable,
  createPortraitInvite,
  fetchPortraitAssets,
  fetchPortraitGroups,
  type PortraitAsset,
  type PortraitInvite,
} from "../api/portrait";
import { currentUser } from "../data/account";
import { normalizeAssetId } from "../data/cardAsset";
import QrCode from "./QrCode";
import { isNative } from "../utils/oauth";

/** 上次查到的可用素材（按账号）。只存展示要用的三位，别把整份回包塞进 localStorage */
type CachedAsset = Pick<PortraitAsset, "id" | "name" | "createTime">;
const CACHE_PREFIX = "ideahub.portraitAssets.";
function cacheKey(): string {
  return `${CACHE_PREFIX}${currentUser()?.id ?? "anon"}`;
}
function readCache(): CachedAsset[] {
  try {
    const raw = localStorage.getItem(cacheKey());
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is CachedAsset => !!x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}
function writeCache(list: PortraitAsset[]): void {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(list.map(({ id, name, createTime }) => ({ id, name, createTime }))));
  } catch {
    // 配额满/隐私模式：只是下次进来少一份预览，方舟现查照旧
  }
}

export default function PortraitAuthPanel({
  onBound,
}: {
  /** 确认到一份可用素材（自动绑到的、列表里挑的、或手填的）。note 是来源说明 */
  onBound: (assetId: string, note: string) => void;
}) {
  const [invite, setInvite] = useState<PortraitInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  /** 查回来的素材。存全部（含审核失败的）——失败原因正是用户最需要看见的。null = 还没查到过 */
  const [found, setFound] = useState<PortraitAsset[] | null>(null);
  /** 本机记的上次结果：found 为 null 时拿它顶着画列表 */
  const [cached] = useState<CachedAsset[]>(() => readCache());
  /** 进面板那一发自动查的状态：查完（成或败）才决定「发起授权」那颗按钮出不出 */
  const [autoChecked, setAutoChecked] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftErr, setDraftErr] = useState("");

  async function startInvite() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      setInvite(await createPortraitInvite());
    } catch (e) {
      setMsg(`发起授权没成：${(e instanceof Error ? e.message : String(e)).slice(0, 100)}——可以改用「填 asset ID」那条路`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 「授权的就是我自己」：不用扫码，本机系统浏览器直接打开。
   * ★ 走系统浏览器而不是 app 内 WebView：那一页要登录被授权人自己的火山账号并做活体
   *   认证，系统浏览器才有已登录态与相机权限，也让用户看得见地址栏是 volcengine.com
   *   （在我们自己的 WebView 里让人输火山密码，是钓鱼页的形状）。
   */
  async function openHere(url: string) {
    if (!isNative()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
    } catch (e) {
      setMsg(`打不开系统浏览器（${e instanceof Error ? e.message : String(e)}）——用「复制链接」自己粘到浏览器里`);
    }
  }

  /**
   * 查授权状态。
   * ★★ 查的是**素材**不是资产组：组「已授权」≠ 有素材能出片 —— 素材要单独过内容审核，
   *   可能整张 Failed 而组照样 Authorized（2026-08-28 实测第一发就是）。
   * ★ 四种结局各说各的：①可用的列出来挑（用户自己按的那一发且正好一份 → 顺手接上）；
   *   ②只有失败的 → 把方舟的原话摆出来（红字逐条，这里不重复）；
   *   ③一条都没有 → 再问一次组，分清"还没授权"与"授权了但没传素材"；
   *   ④查失败 → 整句说，并让「发起授权」照常可点（不能因为查不到就把第一次来的人堵在门外）。
   * @param auto 进面板那一发：不自动绑、结果不用话说（列表本身就是答复）
   */
  async function checkStatus(auto = false) {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetchPortraitAssets();
      setFound(r.items);
      const usable = r.items.filter(assetUsable);
      const failed = r.items.filter((x) => !assetUsable(x));
      writeCache(usable);
      if (usable.length > 0) {
        if (!auto && usable.length === 1) {
          const id = normalizeAssetId(usable[0].id || "");
          if (!id) {
            setMsg(`方舟回了一份素材，但 ID 形状不认识（${usable[0].id}）——用「填 asset ID」那条路确认一下。`);
          } else {
            onBound(id, "本人授权（方舟可信素材库）");
            setMsg("已经接上这份已授权素材了。");
          }
        }
        // 自动那一发 / 多份：列表就是答复，不另说一句
      } else if (failed.length > 0) {
        setMsg(
          `授权是成了，但${failed.length > 1 ? `这 ${failed.length} 份素材都` : "上传的那份素材"}` +
            `没过方舟的内容审核（原因见下），所以还不能用来出片。请本人重新打开授权链接、换一张照片再传一次。`,
        );
      } else if (!auto) {
        const g = await fetchPortraitGroups();
        setMsg(
          g.totalCount > 0
            ? `已经有 ${g.totalCount} 个资产组，但里面一份素材都没有——请本人打开授权链接，走完活体认证后把照片传上去。`
            : "还没有已授权的素材——请本人扫码/打开链接、完成活体认证与授权后再查。",
        );
      }
    } catch (e) {
      setMsg(`${auto ? "自动查授权没成" : "查状态没成"}：${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
    } finally {
      setBusy(false);
      if (auto) setAutoChecked(true);
    }
  }

  // ★★ 进面板就查一次（主人点名）。宿主取消绑定后面板重挂，这一发也只列不绑，见文件头 ★★
  useEffect(() => {
    void checkStatus(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveManual() {
    // 归一（"asset://xxx" 与纯 id 都收）与格式判据都只有 cardAsset 一处
    const id = normalizeAssetId(draft);
    if (!id) {
      setDraftErr("这不像方舟的资产 ID —— 应该长成 asset-20260401123823-6d4x2 这样（在方舟控制台点「复制 asset ID」拿到）");
      return;
    }
    setDraftErr("");
    setDraft("");
    setManualOpen(false);
    onBound(id, "手工填入（方舟控制台授权）");
  }

  /** 画列表用的可用素材：现查到的优先，没查到过就用本机记的那份顶着 */
  const usableFound: CachedAsset[] = found ? found.filter(assetUsable) : cached;
  const fromCache = !found && cached.length > 0;

  return (
    <div className="space-y-1.5">
      {invite ? (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2">
          {/* ⚠ 别在这里写"有效期至 X"：自己授权自己时火山会把有效期直接改成永久
              （实测原文见 docs/backlog.md §1.6），邀约刚发出去时我们不知道扫码的是谁 */}
          <p className="mb-1.5 text-[10px] leading-relaxed text-sky-200">
            完成一次活体认证并授权（有效期在火山那一页确认）。
          </p>
          <button
            onClick={() => void openHere(invite.url)}
            className="mb-2 w-full rounded-xl bg-brand py-2.5 text-[12px] font-bold text-ink"
          >
            📱 就是我本人 · 在这台手机上完成授权
          </button>
          <p className="mb-1.5 text-[10px] leading-relaxed text-slate-400">
            要授权的是<b className="text-slate-300">别人</b>？让他用自己的手机扫这个码
            —— 活体认证必须在<b className="text-slate-300">他本人</b>的手机上、用他自己的火山账号做，
            这正是这份授权有效的原因。
          </p>
          {/* 二维码白底黑点写死不吃主题色（对比度是功能） */}
          <div className="mb-1.5 flex justify-center rounded-lg bg-white p-2">
            <QrCode text={invite.url} size={168} />
          </div>
          <p className="mb-1.5 break-all rounded bg-ink/60 px-2 py-1 font-mono text-[9px] text-slate-400">{invite.url}</p>
          <div className="flex gap-2">
            <button
              onClick={() => void navigator.clipboard?.writeText(invite.url).then(() => setMsg("链接已复制，可以发给本人"))}
              className="flex-1 rounded-full bg-brand py-1.5 text-[11px] font-bold text-ink"
            >
              复制链接
            </button>
            <button
              onClick={() => void checkStatus()}
              disabled={busy}
              className="rounded-lg border border-slate-600 px-3 text-[11px] text-slate-300 disabled:opacity-40"
            >
              {busy ? "查…" : "查授权状态"}
            </button>
          </div>
          <p className="mt-1 text-[9px] leading-relaxed text-slate-600">
            扫不动了？这条邀约码会过期，回来重新「发起授权」生成一张新的即可。
          </p>
        </div>
      ) : usableFound.length > 0 ? (
        // 授权过的人：直接挑。「发起授权」退成一行小字——第二个真人要有入口，但不该再是大按钮
        <p className="text-[10px] leading-relaxed text-slate-400">
          {fromCache
            ? autoChecked
              ? "上次查到的已授权素材（这次没能向方舟刷新，原因见下；仍可点一份接上）："
              : "上次查到的已授权素材（正在向方舟刷新…）："
            : `方舟里有 ${usableFound.length} 份已授权素材，点一份接上：`}
        </p>
      ) : !autoChecked && cached.length === 0 ? (
        // 第一次进、还没查完：别先闪一下「发起授权」再换成列表
        <p className="text-[10px] text-slate-500">正在查你之前有没有授权过…</p>
      ) : (
        <button
          onClick={() => void startInvite()}
          disabled={busy}
          className="w-full rounded-lg border border-sky-500/40 py-1.5 text-[11px] text-sky-200 disabled:opacity-40"
        >
          {busy ? "生成中…" : "🔗 发起肖像授权（本人扫码 / 本机打开）"}
        </button>
      )}

      {/* 可用素材列表（自动查到的 / 本机记的 / 扫完码查到的）。★ 一律列出来让用户挑，
          不替他绑：绑错人是零报错的（出片时换成另一个人的脸） */}
      {!invite && usableFound.length > 0 && (
        <div className="space-y-1">
          {usableFound.map((it) => (
            <button
              key={it.id}
              disabled={busy && fromCache}
              onClick={() => {
                const id = normalizeAssetId(it.id || "");
                if (!id) {
                  setMsg(`这份的 ID 形状不认识（${it.id}）——用「填 asset ID」那条路试试。`);
                  return;
                }
                onBound(id, "本人授权（方舟可信素材库）");
                setMsg("接上了。");
              }}
              className="w-full rounded-lg border border-slate-700 bg-ink/40 px-2 py-1.5 text-left disabled:opacity-50"
            >
              <span className="block font-mono text-[10px] text-emerald-300">{it.id}</span>
              <span className="block text-[9px] text-slate-500">
                {it.name || "（无文件名）"}
                {it.createTime ? ` · ${new Date(it.createTime).toLocaleString()}` : ""}
              </span>
            </button>
          ))}
          <div className="flex gap-3 px-1 text-[10px] text-slate-500">
            <button onClick={() => void checkStatus()} disabled={busy} className="underline disabled:opacity-40">
              {busy ? "刷新中…" : "刷新"}
            </button>
            <button onClick={() => void startInvite()} disabled={busy} className="underline disabled:opacity-40">
              授权另一个人
            </button>
          </div>
        </div>
      )}

      {/* 自动查失败时给一条重试的路（列表空着、按钮已经出了，但用户该知道为什么没列出来） */}
      {!invite && autoChecked && !found && cached.length === 0 && (
        <button onClick={() => void checkStatus()} disabled={busy} className="px-1 text-[10px] text-slate-500 underline disabled:opacity-40">
          {busy ? "查…" : "已经授权过了？再查一次"}
        </button>
      )}

      {msg && <p className="text-[10px] leading-relaxed text-slate-400">{msg}</p>}

      {/* 审核失败的逐条红字：方舟的原话是用户唯一能据以补救的信息 */}
      {found?.some((x) => !assetUsable(x)) && (
        <div className="space-y-1">
          {found
            .filter((x) => !assetUsable(x))
            .map((it) => (
              <p key={it.id} className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-2 py-1.5 text-[9px] leading-relaxed text-rose-300">
                ✗ {it.name || it.id} 没过审核：{it.error?.message || it.error?.code || "方舟没给原因"}
              </p>
            ))}
        </div>
      )}

      {/* 手填退路：服务端没配 AK/SK（前两颗 503）时这是唯一的路，永远保留 */}
      {manualOpen ? (
        <div>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftErr("");
            }}
            placeholder="粘贴 asset ID 或 asset://…"
            className="w-full rounded-lg border border-slate-700 bg-ink/60 px-2.5 py-2 font-mono text-[11px] text-slate-100 placeholder:text-slate-600"
          />
          {draftErr && <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{draftErr}</p>}
          <div className="mt-1.5 flex gap-2">
            <button onClick={saveManual} className="flex-1 rounded-full bg-brand py-1.5 text-[11px] font-bold text-ink">
              绑定
            </button>
            <button
              onClick={() => {
                setManualOpen(false);
                setDraftErr("");
              }}
              className="rounded-lg border border-slate-700 px-3 text-[11px] text-slate-400"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setManualOpen(true)}
          className="w-full rounded-lg border border-slate-600 py-1.5 text-[11px] text-slate-300"
        >
          ＋ 已在控制台授权过？直接填 asset ID
        </button>
      )}
    </div>
  );
}
