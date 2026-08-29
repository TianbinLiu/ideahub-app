// 真人档（MiniMax 海螺）的出片客户端 —— 卡片系统 V2 真人分支（2026-08-24）。
//
// 为什么另起一家供应商：方舟对真人参考图两套探测器全拦（名人版权、普通人隐私，
// 全任务形态实测），海螺同一批图输入输出两端都放行且成片落地（三发探针全 Success，
// docs/card-system-v2-design.md 有矩阵）。境内 api.minimaxi.com，无人脸出境问题。
//
// ★ 路径形状以 **server 代理**（/api/minimax/video、/video/:taskId、/file/:fileId）为准，
//   dev 由 vite 代理把同样的路径改写到上游（vite.config.ts）——两个环境同一套客户端代码。
//   密钥永远不在前端：dev 是 vite 注头，生产是 server 注头（同 /api/ark 的纪律）。
// ★ 判断"这台服务器有没有这个能力"看响应形状与 Content-Type，不信状态码
//   （Capacitor 的 SPA 回退对未命中路径回 200 + index.html，CLAUDE.md 有专条）。
import { API_BASE } from "../api/client";
import { getToken } from "../api/client";
import { syncWalletFromHeaders } from "./arkClient";

/** 上游受理回执的业务码：0 = 成功。非 0 时 status_msg 是给人看的原因 */
interface BaseResp {
  status_code: number;
  status_msg: string;
}

const BASE = `${API_BASE}/api/minimax`;

function authHeaders(): Record<string, string> {
  // 生产（server 代理）要带登录态；dev 的 vite 代理会忽略这个头，无害
  const tk = getToken();
  return { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) };
}

async function jsonOf(res: Response, what: string): Promise<Record<string, unknown>> {
  // 计费代理在每个响应上带权威余额头（生产 server 写；dev 的 vite 代理没有，helper 自会跳过）。
  // 扣费/退款都发生在服务端，这里不同步的话镜像要等下一次方舟调用才自愈
  syncWalletFromHeaders(res.headers);
  const ct = res.headers.get("Content-Type") ?? "";
  if (!ct.includes("application/json")) {
    // SPA 回退 / 网关错误页都会走到这里 —— 说清是哪一步、拿到了什么
    throw new Error(`真人档出片${what}失败：服务器没有应答这个接口（HTTP ${res.status}，${ct || "无类型"}）`);
  }
  const j = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`真人档出片${what}失败（HTTP ${res.status}）：${JSON.stringify(j).slice(0, 160)}`);
  return j;
}

function baseRespOf(j: Record<string, unknown>): BaseResp | null {
  const b = j.base_resp as BaseResp | undefined;
  return b && typeof b.status_code === "number" ? b : null;
}

/**
 * 一发海螺出片：创建 → 轮询 → 取下载地址。
 * durationSec 必须已经被 economy.clampDuration 吸附到价表档位（6/10）——
 * 这里**不再夹一次**：两处各夹一遍就是同一条规则的第二处实现。
 */
export async function minimaxVideo(o: {
  model: string;
  prompt: string;
  /** 首帧图：URL 或 dataURL（实测两种都收） */
  firstFrame: string;
  durationSec: number;
  onProgress?: (s: string) => void;
}): Promise<string> {
  const prog = (s: string) => o.onProgress?.(s);
  prog("真人档任务创建中…");
  const created = await jsonOf(
    await fetch(`${BASE}/video`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: o.model,
        prompt: o.prompt,
        first_frame_image: o.firstFrame,
        duration: o.durationSec,
        // 分辨率钉死 768P：报价表（economy.VideoTier.flatCost）就是按它锚的，
        // 让它可变 = 报价与实扣两个数
        resolution: "768P",
      }),
    }),
    "创建",
  );
  const br = baseRespOf(created);
  if (!br || br.status_code !== 0) {
    throw new Error(`真人档任务被上游拒绝：${br ? `${br.status_code} ${br.status_msg}` : JSON.stringify(created).slice(0, 160)}`);
  }
  const taskId = String(created.task_id ?? "");
  if (!taskId) throw new Error("真人档任务受理了却没给任务号——上游协议变了，把这句话反馈给我们");

  // 实测 768P/6s 约 40~90 秒出片；10 分钟死线（与方舟侧的轮询纪律同精神：不无限等）
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("真人档出片超时（10 分钟没出结果）——稍后在流水线上重试这一段");
    await new Promise((r) => setTimeout(r, 8000));
    const st = await jsonOf(await fetch(`${BASE}/video/${encodeURIComponent(taskId)}`, { headers: authHeaders() }), "查询");
    const status = String(st.status ?? "");
    prog(`真人档生成中…（${status || "排队"}）`);
    if (status === "Fail") {
      const b = baseRespOf(st);
      throw new Error(`真人档出片失败：${b?.status_msg || "上游未说明原因"}`);
    }
    if (status === "Success") {
      const fileId = String(st.file_id ?? "");
      if (!fileId) throw new Error("真人档出片成功却没有文件号——上游协议变了，把这句话反馈给我们");
      const f = await jsonOf(await fetch(`${BASE}/file/${encodeURIComponent(fileId)}`, { headers: authHeaders() }), "取件");
      const file = f.file as { download_url?: string; backup_download_url?: string } | undefined;
      const url = file?.download_url || file?.backup_download_url;
      if (!url) throw new Error("真人档取件失败：上游没有返回下载地址");
      return url;
    }
  }
}
