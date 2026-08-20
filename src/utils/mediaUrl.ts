// 播放器统一的媒体 URL 解析：
//   idb:<key>       —— 剪辑页合并导出的整条视频存 IndexedDB blob，播放时换 objectURL
//   http(s)（播放）—— 原样直连：<video> 播放不受 CORS 限制，走代理反而引入 502/全量下载延迟
//   http(s)（截帧）—— forCapture 时经代理取 blob（canvas 抽帧才不被跨域污染），
//                     大文件代理偶发 502，失败自动重试一次
//
// ★ 代理地址不在这里拼，走 ai/arkClient 的 fetchArkAsset：dev 是 vite 中间件、
//   打包后是服务端，两条路径不同，而这条规则以前有四份拷贝、真机上一起坏（见那边的注释）。
import { useEffect, useState } from "react";
import { fetchArkAsset } from "../ai/arkClient";
import { idbGet } from "../data/db";

const objectUrlCache = new Map<string, string>();

export async function resolveMediaUrl(url: string | undefined, opts?: { forCapture?: boolean }): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("idb:")) {
    const hit = objectUrlCache.get(url);
    if (hit) return hit;
    const blob = await idbGet<Blob>(url.slice(4));
    if (!blob) return null;
    const obj = URL.createObjectURL(blob);
    objectUrlCache.set(url, obj);
    return obj;
  }
  if (!/^https?:\/\//.test(url) || url.startsWith(`${location.origin}/`)) return url;
  if (!opts?.forCapture) return url; // 纯播放：直连最快最稳
  const cacheKey = `cap:${url}`;
  const hit = objectUrlCache.get(cacheKey);
  if (hit) return hit;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchArkAsset(url, 120_000).catch((e) => {
      if (attempt === 0) return null;
      // ★ 超时的 AbortError 一路裸抛的话，用户在合并页看到的是英文原文
      //   「The user aborted a request.」——既看不懂又不知道下一步（铁律八）。
      //   2026-08-20 真机实拍：跨境拉方舟 TOS 的 20MB 成片，120s 两次都拉不完，正是这句。
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("取媒体超时 —— 文件较大或网络太慢，稍后重试");
      }
      throw e;
    });
    if (!res || !res.ok) {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue; // 代理对大文件偶发 502/网络抖动：歇口气重试一次
      }
      throw new Error(`取媒体失败 ${res?.status ?? "网络错误"}`);
    }
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    objectUrlCache.set(cacheKey, obj);
    return obj;
  }
}

/** 组件用：异步解析媒体地址，解析完成前返回 null（调用方先出封面顶着）。
 *  forCapture=true 时经代理取 blob（供 canvas 截帧）；播放场景不要传。 */
export function useMediaUrl(url: string | undefined, opts?: { forCapture?: boolean }): string | null {
  const forCapture = !!opts?.forCapture;
  const sync = (u: string | undefined) =>
    u && !u.startsWith("idb:") && !(forCapture && /^https?:\/\//.test(u) && !u.startsWith(`${location.origin}/`))
      ? u
      : null;
  const [real, setReal] = useState<string | null>(() => sync(url));
  useEffect(() => {
    let alive = true;
    setReal(sync(url));
    if (!url) return;
    void resolveMediaUrl(url, { forCapture })
      .then((r) => {
        if (alive) setReal(r);
      })
      .catch((e) => console.warn("[media] 解析失败:", url.slice(0, 60), e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, forCapture]);
  return real;
}
