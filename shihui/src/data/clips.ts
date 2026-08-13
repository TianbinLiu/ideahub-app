import { useSyncExternalStore } from "react"

// 内容库真视频清单（forge 管线的产物 public/clips/manifest.json）。
// 读取模式与 ideahub 弹幕同款：同步读 + 到货后 emit——渲染层每一拍都要问"这句有没有真片"，
// 不能让每个组件自己去 await 一个 fetch。
// 没有清单 = 纯占位模式，这是预期形态（骨架未跑 forge / 生产未发内容包），不报错不打日志。

export interface ClipSeg {
  video: string
  poster: string
}
interface Manifest {
  poems: Record<string, { segments: ClipSeg[] }>
}

let manifest: Manifest | null = null
let inflight = false
const listeners = new Set<() => void>()

export function loadClips(): void {
  // 成功后不重取；失败（离线冷启动/清单还没生成）后允许下次进入时再试——
  // 用 started 闩死的话，App 启动那一刻清单不在，这个会话就永远是占位模式
  if (manifest || inflight) return
  inflight = true
  fetch("/clips/manifest.json")
    .then((r) => {
      // ★ 必须看 Content-Type 不能只看状态码：dev/真机的 SPA 回退会给不存在的路径
      //   回 200 + index.html（主仓真机事故的同款形状），r.ok 在这里毫无意义
      const ct = r.headers.get("content-type") ?? ""
      return r.ok && ct.includes("json") ? (r.json() as Promise<Manifest>) : null
    })
    .then((m) => {
      inflight = false
      if (!m?.poems) return
      manifest = m
      listeners.forEach((f) => f())
    })
    .catch(() => {
      /* 离线/无清单：安静地保持占位模式，下次 loadClips 再试 */
      inflight = false
    })
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const snapshot = () => manifest

/** 这首诗的真视频段（每句一段，完整才返回；不完整的诗 forge 不会写进 manifest） */
export function useClips(poemId: string): ClipSeg[] | null {
  const m = useSyncExternalStore(subscribe, snapshot)
  return m?.poems[poemId]?.segments ?? null
}
