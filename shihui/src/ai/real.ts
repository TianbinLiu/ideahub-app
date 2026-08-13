import { saveBlob } from "../data/blobStore"
import type { LineClip } from "../types"
import { guessKeywords } from "../utils/keywords"
import { fetchArkAsset, generateImage, generateVideo } from "./arkClient"
import ink from "./inkStyle.json"

// 创作侧真生成（dev 版）：孩子写一句 → Seedream 画首帧 → Seedance pro-fast 出段
// → 视频落 IndexedDB → 捕获真实尾帧给下一句起拍。
// 与内容库管线（scripts/forge.mjs）的差别是刻意的：
//   forge 用 1-0-pro 首尾帧锁定（批量、质量优先、无浏览器）；
//   这里用 pro-fast 首帧起拍（交互等待、成本优先），承接靠捕获真实尾帧——
//   两条路线都是 ideahub 验证过的标准做法，风格串共用 inkStyle.json（一处实现）。

/** 从孩子的句子拼生成提示词。没有人工 scene，靠词表意象兜底把画面钉住 */
const framePrompt = (text: string, hasRef: boolean): string =>
  `${ink.style} ${hasRef ? "与参考图同一画风的新一幕：" : ""}表现「${text}」的意境，` +
  `画面元素：${guessKeywords(text).join("、")}。人物一律远景小小的剪影。`

export async function realGenClip(
  text: string,
  prevTail?: string,
  onProgress?: (status: string) => void,
): Promise<LineClip> {
  try {
    onProgress?.("正在画这一句的画面…")
    const frameUrl = await generateImage(framePrompt(text, !!prevTail), {
      imageRefs: prevTail ? [prevTail] : undefined,
    })

    onProgress?.("画面动起来…")
    const videoUrl = await generateVideo(`${ink.motion} 画面内容：「${text}」。`, frameUrl, {
      onProgress,
    })

    // TOS 链接 24h 失效，必须立刻落地：发布的作品明天还要能播
    onProgress?.("保存视频…")
    const blob = await fetchArkAsset(videoUrl)
    const id = crypto.randomUUID()
    await saveBlob(id, blob)

    // 尾帧捕获失败不算失败：下一句少一张参考图（承接感变弱），但这一句是完好的。
    // 常见触发：页面切后台（媒体事件永不到达，主仓已知坑）——所以必须带超时。
    onProgress?.("记住这一幕的结尾…")
    const tailFrame = await captureVideoTail(blob).catch(() => {
      console.warn("尾帧捕获失败（页面在后台？），下一句将没有承接参考图")
      return undefined
    })

    return { status: "ready", videoUrl: `idb:${id}`, tailFrame }
  } catch (e) {
    // ★ 翻译层收口在这一处：孩子界面只说人话，任何方舟原文（英文代码/模型名/JSON）
    //   都不许上屏（评审确认之前只盖住了敏感词一类）。技术原文留控制台排查。
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[创作生成失败]", e)
    if (/Sensitive|RiskControl|敏感/i.test(msg)) {
      throw new Error("这句话画不出来，换个说法试试～")
    }
    if (/429/.test(msg)) {
      throw new Error("画坊这会儿太忙啦，歇一小会儿再点「重画」～")
    }
    throw new Error("这一句没画出来，点「重画」再试一次～")
  }
}

const evt = (el: HTMLMediaElement, name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    el.addEventListener(name, () => resolve(), { once: true })
    el.addEventListener("error", () => reject(new Error(`video ${name} error`)), { once: true })
  })

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}超时`)), ms))])

/** 抽视频最后一帧（压到宽 ≤720 的 jpeg dataURL：它要作为参考图 base64 上传，原帧太肥） */
async function captureVideoTail(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob)
  try {
    const video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    video.src = url
    await withTimeout(evt(video, "loadedmetadata"), 10_000, "视频元数据")
    video.currentTime = Math.max(0, video.duration - 0.05)
    await withTimeout(evt(video, "seeked"), 10_000, "视频定位")
    // 按长边压：竖屏 704×1248 按宽算等于不压（评审抓的），按长边压到 720 → 406×720，
    // 作参考图足够，base64 体积小三倍（它要走创建请求上行）
    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.85)
  } finally {
    URL.revokeObjectURL(url)
  }
}
