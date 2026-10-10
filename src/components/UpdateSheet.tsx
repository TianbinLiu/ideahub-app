// 「有新版本」弹层：说清版本、大小、改了什么，然后下载 + 拉起安装器。
//
// ★ 三种会卡住的情况都必须**当场说清楚**，不能只是按钮点了没动静：
//   ① 没给「安装未知应用」授权 —— 这是侧载最常见的一道坎，直接给一颗按钮跳到那一页；
//   ② 下载失败 / 校验不过 —— 原因原样显示，并且留着重试；
//   ③ 签名对不上 —— 系统安装器自己会报，这里提前把话说在前面（从早期的 debug 包
//      换到正式包时必然发生，只能先卸载）。
//
// ★★ 强制更新（清单的 minVersionCode，判据只在 data/appUpdate.isMandatory，2026-10-10）：这张弹层就是这一版唯一的出口 ——
//   · 关不掉：没有「以后再说」、没有「关闭」，点遮罩不关；安卓返回键（全 app 没人监听 backButton，默认是 WebView 后退）
//     只退得动底下那一页，这张弹层挂在路由之外（App.tsx 的 UpdateGate），退不掉它。
//   · 但**永远有路可走**：下不动 / 校验不过 / 装不上都留着「重试」，另给一条「在浏览器里打开官网下载页」（DOWNLOAD_PAGE_URL）——
//     应用内更新整条走不通的时候（镜像挂了、存储满了、系统不让装），人还能从官网把新包装上。打不开浏览器就把地址写出来。
//   · 层级压在引导层（GUIDE_Z = 90）之上：引导会在各屏自己弹出来，盖住这张卡的话人只看得见引导、点不到更新。
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DOWNLOAD_PAGE_URL,
  canInstall,
  downloadAndInstall,
  fmtSize,
  isMandatory,
  openInstallPermission,
  skipVersion,
  type UpdateInfo,
} from "../data/appUpdate";
import { openExternal } from "../utils/openExternal";
import Icon from "./Icon";

export default function UpdateSheet({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const { t } = useLingui();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  /** 强制更新：这一版关不掉（见文件头 ★★） */
  const forced = isMandatory(info);
  /** 打不开浏览器（被拦 / 没有浏览器）：把官网下载页的地址写出来，让人自己去 */
  const [linkFailed, setLinkFailed] = useState(false);
  const versionName = info.versionName;

  async function openDownloadPage() {
    setLinkFailed(false);
    try {
      await openExternal(DOWNLOAD_PAGE_URL);
    } catch {
      setLinkFailed(true);
    }
  }

  useEffect(() => {
    void canInstall().then(setAllowed);
  }, []);

  // 从系统设置页授权完回来时，前台恢复要重新问一次 —— 否则用户明明授权了，
  // 这里还挂着"去授权"，只能把弹层关掉重开
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void canInstall().then(setAllowed);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function start() {
    setBusy(true);
    setErr("");
    setPct(0);
    try {
      await downloadAndInstall(info, (received, total) => {
        setPct(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0);
      });
      // 安装器已经拉起来了。这里**不关弹层**：装不装是用户在系统弹窗里决定的，
      // 他可能点取消回来 —— 那时候还留着"立即更新"才有得再点
    } catch (e) {
      setErr(e instanceof Error ? e.message : t`更新失败，请稍后再试`);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={`fixed inset-0 flex items-end bg-black/60 ${forced ? "z-[95]" : "z-[60]"}`}
      onClick={busy || forced ? undefined : onClose}
    >
      <div
        className="w-full rounded-t-2xl border-t border-slate-700 bg-ink p-4"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="text-lg">{forced ? "⬆️" : "🎉"}</span>
          <h3 className="text-sm font-bold text-slate-100">
            {forced ? <Trans>需要更新到 {versionName}</Trans> : <Trans>有新版本 {info.versionName}</Trans>}
          </h3>
          {info.sizeBytes > 0 && <span className="text-[11px] text-slate-500">{fmtSize(info.sizeBytes)}</span>}
        </div>

        {forced && (
          <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            {/* ★ 不许诺「数据不会丢」：签名对不上时只能卸载重装（底下那行），那条路上本机的草稿是会没的 */}
            <Trans>你手上这一版已经停止支持了，更新之后才能接着用。</Trans>
          </div>
        )}

        {info.notes && (
          <p className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
            {info.notes}
          </p>
        )}

        {allowed === false && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-[11px] leading-relaxed text-amber-100">
              <Trans>这个 App 不是从应用商店装的，系统需要你先允许它安装应用，才能自己完成更新。</Trans>
            </p>
            <button
              onClick={() => void openInstallPermission()}
              className="mt-2 w-full rounded-xl bg-amber-400/90 py-2.5 text-xs font-bold text-ink"
            >
              <Trans>去开启「允许安装未知应用」</Trans>
            </button>
          </div>
        )}

        {busy && (
          <div className="mb-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
              {/* 只动 transform 的横条：下载过程中它每半兆动一次，用 width 会一直触发重排 */}
              <div
                className="h-full origin-left rounded-full bg-brand transition-transform duration-200"
                style={{ transform: `scaleX(${pct / 100})`, width: "100%" }}
              />
            </div>
            <p className="mt-1.5 text-center text-[11px] tabular-nums text-slate-400">
              {pct > 0 ? t`下载中 ${pct}%` : t`正在连接…`}
            </p>
          </div>
        )}

        {err && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          {/* 强制的那一版没有「以后再说」（见文件头 ★★） */}
          {!forced && (
            <button
              onClick={() => {
                skipVersion(info.versionCode);
                onClose();
              }}
              disabled={busy}
              className="flex-1 rounded-xl bg-slate-700/70 py-2.5 text-sm text-slate-200 disabled:opacity-40"
            >
              <Trans>以后再说</Trans>
            </button>
          )}
          <button
            onClick={() => void start()}
            disabled={busy || allowed === false}
            className="flex-[1.6] rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:bg-slate-700 disabled:text-slate-400"
          >
            {busy ? <Trans>下载中…</Trans> : err ? <Trans>重试</Trans> : <Trans>立即更新</Trans>}
          </button>
        </div>

        {/* 另一条路：官网下载页（只给强制的那一版：它关不掉，应用内那条整个走不通时人还得有路可走；
            普通更新照旧一字不变 —— 关掉弹层、过两天再点就是它的出路） */}
        {forced && (
          <div className="mt-2 text-center">
            <button
              onClick={() => void openDownloadPage()}
              className="text-[11px] text-brand underline underline-offset-2"
            >
              <Trans>下不动、装不上？在浏览器里打开官网下载页</Trans>
            </button>
            {linkFailed && (
              <p className="mt-1 select-all text-[11px] leading-relaxed text-rose-300">
                <Trans>没能打开浏览器。可以手动访问：{DOWNLOAD_PAGE_URL}</Trans>
              </p>
            )}
          </div>
        )}

        {/* ★ 签名不一致的情况提前说：早期发出去的测试包如果是 debug 签名，
            换成正式签名的包时系统会直接拒绝安装，而它给的提示（"应用未安装"）
            完全看不出原因 */}
        <p className="mt-3 text-center text-[10px] leading-relaxed text-slate-600">
          <Trans>若安装时提示「应用未安装」，多半是早期测试包的签名不同，先卸载旧版再装即可</Trans>
          {!forced && (
            <button onClick={onClose} className="ml-1 inline-flex items-center text-slate-500 underline underline-offset-2">
              <Trans>关闭</Trans>
              <Icon name="close" size={10} className="ml-0.5" />
            </button>
          )}
        </p>
      </div>
    </div>,
    document.body,
  );
}
