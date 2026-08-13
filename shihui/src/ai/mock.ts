import type { LineClip } from "../types"
import { hashStr } from "../utils/keywords"

// mock 生成：延迟 1.5~3s 后返回 "mock:" 占位段（与 ideahub 同约定）。
// 延迟做得比真实短两个数量级（真实 35-60s/段），但保留"异步 + 等待态"的形状，
// 页面上的 loading/禁用逻辑在 mock 下就能全部走到。
export async function mockGenClip(text: string, prevTail?: string): Promise<LineClip> {
  const wait = 1500 + (hashStr(text) % 1500)
  await new Promise((r) => setTimeout(r, wait))
  return {
    status: "ready",
    videoUrl: `mock:${text}`,
    // mock 段没有真实尾帧；把上一段的传下去只是保持数据形状
    tailFrame: prevTail,
  }
}
