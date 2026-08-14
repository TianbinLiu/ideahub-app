// 「有新版本」弹层（水墨风重排版；交互结构与启梦的 UpdateSheet 一致）。
//
// ★ 三种会卡住的情况都必须**当场说清楚**，不能只是按钮点了没动静：
//   ① 没给「安装未知应用」授权 —— 侧载最常见的一道坎，直接给一颗按钮跳到那一页；
//   ② 下载失败 / 校验不过 —— 原因原样显示，并且留着重试；
//   ③ 签名对不上 —— 系统安装器自己会报，这里提前把话说在前面。
//
// ★ 布局用 absolute inset-0（不是 fixed + portal）：本 App 的所有浮层都锚在
//   手机形态容器里（App.tsx 的 max-w-md 容器无 transform/filter 祖先），与 Player 同款。
import { useEffect, useState } from "react"
import {
  canInstall,
  downloadAndInstall,
  fmtSize,
  openInstallPermission,
  skipVersion,
  type UpdateInfo,
} from "../data/appUpdate"

export function UpdateSheet({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState("")

  useEffect(() => {
    void canInstall().then(setAllowed)
  }, [])

  // 从系统设置页授权完回来时，前台恢复要重新问一次 —— 否则用户明明授权了，
  // 这里还挂着"去授权"，只能把弹层关掉重开
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void canInstall().then(setAllowed)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  async function start() {
    setBusy(true)
    setErr("")
    setPct(0)
    try {
      await downloadAndInstall(info, (received, total) => {
        setPct(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0)
      })
      // 安装器已拉起。这里**不关弹层**：装不装是用户在系统弹窗里决定的，
      // 他可能点取消回来 —— 那时候还留着"立即更新"才有得再点
    } catch (e) {
      setErr(e instanceof Error ? e.message : "更新失败，稍后再试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-end bg-ink/60" onClick={busy ? undefined : onClose}>
      <div className="w-full rounded-t-2xl border-t border-ink/10 bg-paper p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-baseline gap-2">
          <h3 className="font-kai text-xl">有新版本 {info.versionName}</h3>
          {info.sizeBytes > 0 && <span className="text-xs text-mist">{fmtSize(info.sizeBytes)}</span>}
        </div>

        {info.notes && (
          <p className="mb-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-mist">
            {info.notes}
          </p>
        )}

        {allowed === false && (
          <div className="mb-3 rounded-xl border border-cinnabar/40 bg-cinnabar/5 p-3">
            <p className="text-xs leading-relaxed">
              这个 App 不是从应用商店装的，系统需要家长先允许它安装应用，才能自己完成更新。
            </p>
            <button
              onClick={() => void openInstallPermission()}
              className="mt-2 w-full rounded-lg bg-cinnabar py-2 text-sm text-paper"
            >
              去开启「允许安装未知应用」
            </button>
          </div>
        )}

        {busy && (
          <div className="mb-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
              {/* 只动 transform 的横条：下载中它每半兆动一次，用 width 会一直触发重排 */}
              <div
                className="h-full origin-left rounded-full bg-cinnabar transition-transform duration-200"
                style={{ transform: `scaleX(${pct / 100})`, width: "100%" }}
              />
            </div>
            <p className="mt-1.5 text-center text-xs tabular-nums text-mist">
              {pct > 0 ? `下载中 ${pct}%` : "正在连接…"}
            </p>
          </div>
        )}

        {err && (
          <div className="mb-3 rounded-xl border border-cinnabar/40 bg-cinnabar/5 p-3 text-xs leading-relaxed text-cinnabar">
            {err}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => {
              skipVersion(info.versionCode)
              onClose()
            }}
            disabled={busy}
            className="flex-1 rounded-full border border-ink/15 py-2.5 text-sm disabled:opacity-50"
          >
            以后再说
          </button>
          <button
            onClick={() => void start()}
            disabled={busy || allowed === false}
            className="flex-[1.6] rounded-full bg-cinnabar py-2.5 text-sm text-paper disabled:opacity-40"
          >
            {busy ? "下载中…" : err ? "重试" : "立即更新"}
          </button>
        </div>

        {/* ★ 签名不一致的情况提前说：早期 debug 测试包换正式包时系统只报「应用未安装」，
            完全看不出原因 */}
        <p className="mt-3 text-center text-[10px] leading-relaxed text-mist">
          若安装时提示「应用未安装」，多半是早期测试包签名不同，先卸载旧版再装即可
        </p>
      </div>
    </div>
  )
}
