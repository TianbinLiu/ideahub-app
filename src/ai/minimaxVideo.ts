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
import { ArkTaskUnknown, syncWalletFromHeaders } from "./arkClient";

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

/** 一条 Success 的任务状态 → 下载地址。**唯一实现**：出片主路径与「取回」共用 */
async function minimaxFileUrl(st: Record<string, unknown>): Promise<string> {
  const fileId = String(st.file_id ?? "");
  if (!fileId) throw new Error("真人档出片成功却没有文件号——上游协议变了，把这句话反馈给我们");
  const f = await jsonOf(await fetch(`${BASE}/file/${encodeURIComponent(fileId)}`, { headers: authHeaders() }), "取件");
  const file = f.file as { download_url?: string; backup_download_url?: string } | undefined;
  const url = file?.download_url || file?.backup_download_url;
  if (!url) throw new Error("真人档取件失败：上游没有返回下载地址");
  return url;
}

/**
 * 把一发已经受理过、当时没接到的真人档成片取回来。
 *
 * ★★ **这条路上不许出现下定论的句子**（除非上游明说 Fail）。方舟那边有一句
 *   「已经花掉的钱无法挽回」是对的 —— 那是 404 = 产物真过期了。而这一档我们
 *   **没有量过 MiniMax 的留存**，任何"没了"的断语都可能是对着一发还活着的成片说的，
 *   而听到这句话的用户不会来报 bug，他会直接走。
 * ★ 查询与取件都**不计费**（server 的 minimax.routes 里这两条只挂 pollLimit，
 *   没走 chargedArkCall）—— 所以"取回不再花一分钱"这句话在这一档同样是真的。
 */
export async function takeMinimaxTask(
  taskId: string,
  onProgress?: (s: string) => void,
): Promise<{ url: string }> {
  onProgress?.("正在向上游核对这一发的状态…（查询不花钱）");
  let st: Record<string, unknown>;
  try {
    st = await jsonOf(await fetch(`${BASE}/video/${encodeURIComponent(taskId)}`, { headers: authHeaders() }), "查询");
  } catch (e) {
    // 查不动 ≠ 取不回。凭据必须留着，话也不能说死。
    throw new Error(
      `暂时查不到这一发（${e instanceof Error ? e.message.slice(0, 60) : "查询失败"}）——凭据还在，过一会儿再点一次，查询不花钱。`,
    );
  }
  const status = String(st.status ?? "");
  if (status === "Success") return { url: await minimaxFileUrl(st) };
  if (status === "Fail") {
    // 上游明说失败：这时候"受理之后失败不退"是真的，必须照说 —— 藏起来会让用户
    // 以为重试免费，而重试是重新下一单
    const b = baseRespOf(st);
    throw new Error(
      `上游说这一发失败了：${b?.status_msg || "未说明原因"}。按约定，受理之后的失败不退款；重新生成会再花一次钱。`,
    );
  }
  throw new Error(
    `这一发还在上游排队或生成中（当前状态：${status || "未知"}）——过几分钟再点一次「取回」，查询不花钱、凭据也还在。`,
  );
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
  /**
   * 任务**刚被上游受理**（从这一刻起这一发的钱已经花掉了）。
   * ★ 与 arkClient 的 onTask 同一条约定：调用方拿它去落凭据，而落凭据必须发生在
   *   开始等待**之前** —— 进程被系统回收时，落过盘的那一份是唯一还活着的线索。
   */
  onTask?: (taskId: string) => void;
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
  o.onTask?.(taskId); // ★ 在开始等之前落凭据（理由见 onTask 的 ★）

  // 实测 768P/6s 约 40~90 秒出片；10 分钟死线（与方舟侧的轮询纪律同精神：不无限等）
  const deadline = Date.now() + 10 * 60_000;
  // ★★ 单次查询抖动**不放弃整发**（2026-08-31 补，照 arkClient 的同一条纪律）：
  //   原来这一行是裸的 `await jsonOf(fetch(...))`，`jsonOf` 对任何非 2xx / 非 JSON
  //   当场抛 —— 手机在 5G/WiFi 之间切一下、或代理吃到一次上游 504，整发就被判死。
  //   而**钱在提交那一刻就已经扣掉且不退**，任务在 MiniMax 那边照跑照出片。
  //   连查五次才放弃，与方舟侧同一个数。
  let pollFails = 0;
  for (;;) {
    if (Date.now() > deadline) {
      // ★★ 抛 **ArkTaskUnknown**（2026-08-31）：这不是失败，是"我们没接到"。
      //   凭据留着、取回入口亮起来 —— 而在这之前唯一亮着的是「重新生成」= 再扣一次
      //   整档的钱（真人档按发计价，10 秒档 270k，而免费版月额一共 300k：
      //   一个免费用户到这一步连那颗按钮都按不动，这个月就此结束）。
      //   ⚠ 这一行与下面那个 pollFails 分支**必须同时**是 ArkTaskUnknown：
      //   只改一个的话，另一个仍抛普通 Error → flowStore 的真失败分支
      //   `if (taskId) dropVideoJob(taskId)` 会把刚落的凭据当场删掉，比不改更坏。
      throw new ArkTaskUnknown(
        "真人档出片 10 分钟没出结果——任务多半还在上游跑，不是失败：钱在提交那一刻就已经花掉了。",
        taskId,
      );
    }
    await new Promise((r) => setTimeout(r, 8000));
    let st: Record<string, unknown>;
    try {
      st = await jsonOf(await fetch(`${BASE}/video/${encodeURIComponent(taskId)}`, { headers: authHeaders() }), "查询");
      pollFails = 0;
    } catch (e) {
      if (++pollFails >= 5) {
        // 与上面那个死线分支同一个类型（理由见那里的 ★★）：连查五次查不动 =
        // **我们瞎了，不是这一发废了**。我们自己代理回的 429/504 也落在这儿，
        // 它们更是"可重试"，绝不能进任何一个下定论的分支。
        throw new ArkTaskUnknown(
          `盯不住这一发的进度了（${e instanceof Error ? e.message.slice(0, 60) : "查询失败"}）——任务还在上游跑，不是失败。`,
          taskId,
        );
      }
      prog(`真人档生成中…（查询失败 ${pollFails}/5，重试中）`);
      continue;
    }
    const status = String(st.status ?? "");
    prog(`真人档生成中…（${status || "排队"}）`);
    if (status === "Fail") {
      const b = baseRespOf(st);
      throw new Error(`真人档出片失败：${b?.status_msg || "上游未说明原因"}`);
    }
    if (status === "Success") {
      const url = await minimaxFileUrl(st);
      return url;
    }
  }
}
