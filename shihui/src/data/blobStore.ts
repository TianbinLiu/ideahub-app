import { useEffect, useState } from "react"

// 创作侧真视频的落地仓：IndexedDB 存 Blob，作品里只存 "idb:<id>" 指针。
// 为什么必须落地：方舟产物是 TOS 域 URL，24h 失效——发布的作品存死链等于骗用户。
// localStorage 放不下（单作品 8-16MB），这是 shihui 第一个用 IndexedDB 的模块；
// 将来接服务端后，这里换成"上传成功前的本地缓冲"。

const DB_NAME = "shihui-blobs"
const STORE = "blobs"

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("indexedDB open 失败"))
  })
  return dbPromise
}

export async function saveBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    // ★ 配额不足时事务只发 abort 不发 error（评审抓的）：不挂 onabort 这个 Promise
    //   永不 settle，生成流程会永久卡在「保存视频…」
    tx.onabort = () => reject(tx.error ?? new Error("存储空间不够了，清理一些旧作品再试"))
    tx.onerror = () => reject(tx.error ?? new Error("blob 写入失败"))
  })
}

/** 删除作品时清掉它的真片（不清的话 8-16MB/首永久孤儿化在 IndexedDB） */
export async function deleteBlob(id: string): Promise<void> {
  const cached = urlCache.get(`idb:${id}`)
  if (cached) {
    URL.revokeObjectURL(cached)
    urlCache.delete(`idb:${id}`)
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error("blob 删除被中止"))
    tx.onerror = () => reject(tx.error ?? new Error("blob 删除失败"))
  })
}

async function loadBlob(id: string): Promise<Blob | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error("blob 读取失败"))
  })
}

// ObjectURL 缓存：同一个视频反复打开播放器不重建 URL。
// 会话期内不 revoke——播放器可能随时回来，几个 URL 句柄的代价远小于"播着播着源没了"
const urlCache = new Map<string, string>()

async function resolveVideoUrl(videoUrl: string): Promise<string | null> {
  if (!videoUrl.startsWith("idb:")) return videoUrl
  const cached = urlCache.get(videoUrl)
  if (cached) return cached
  const blob = await loadBlob(videoUrl.slice(4))
  if (!blob) return null // 库被清（换浏览器/清数据）：调用方退回占位画面
  const url = URL.createObjectURL(blob)
  urlCache.set(videoUrl, url)
  return url
}

/** 把作品里的 videoUrl（可能是 idb: 指针）解析成 <video> 能播的地址；解析中/失败返回 null */
export function useVideoUrl(videoUrl: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    videoUrl && !videoUrl.startsWith("idb:") ? videoUrl : (videoUrl && urlCache.get(videoUrl)) || null,
  )
  useEffect(() => {
    if (!videoUrl) {
      setUrl(null)
      return
    }
    // 先按新 url 立即复位（直链/已缓存的直接给，其余清空）——不复位的话，
    // 换句瞬间新挂载的 <video> 会拿着上一句的 ObjectURL 把旧画面重播一遍（评审抓的）
    const immediate = !videoUrl.startsWith("idb:") ? videoUrl : (urlCache.get(videoUrl) ?? null)
    setUrl(immediate)
    if (immediate) return
    let alive = true
    resolveVideoUrl(videoUrl).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl(null),
    )
    return () => {
      alive = false
    }
  }, [videoUrl])
  return url
}
