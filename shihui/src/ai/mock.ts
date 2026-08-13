import type { LineClip } from "../types"
import { hashStr } from "../utils/keywords"

// mock 生成：延迟后返回 "mock:" 占位段（与 ideahub 同约定）。
// 延迟比真实短两个数量级（真实 ≈60-90s/句），但保留"异步 + 分阶段进度"的形状，
// 页面上的 loading/禁用/进度文案在 mock 下就能全部走到。
export async function mockGenClip(
  text: string,
  prevTail?: string,
  onProgress?: (status: string) => void,
): Promise<LineClip> {
  const wait = 500 + (hashStr(text) % 500)
  for (const stage of ["正在画这一句的画面…", "画面动起来…", "保存视频…"]) {
    onProgress?.(stage)
    await new Promise((r) => setTimeout(r, wait))
  }
  return {
    status: "ready",
    videoUrl: `mock:${text}`,
    // mock 段没有真实尾帧；把上一段的传下去只是保持数据形状
    tailFrame: prevTail,
  }
}
