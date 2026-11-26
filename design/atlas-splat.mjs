#!/usr/bin/env node
// 用 Atlas 官方 Developer API 把 11 张归一后的多视角图重建为高斯泼溅（SPZ）。
//
// 文档依据（2026-11-25 实读 .md 原文）：
//   · API base: https://api.atlas.worldlabs.ai/api/v2
//   · 认证：每个受保护请求带 `WLT-Api-Key: <project key>`（不认 query 参数）；
//     key 绑定 project，路由里不写项目 id。见 docs/atlas-splat.md。
//   · 资产上传四步：POST /assets（只给 displayName）→
//     POST /assets/{id}:createUploadUrl {contentType, contentLength} →
//     PUT 到签名 URL（**不带** WLT-Api-Key，必须原样带返回的 headers）→
//     POST /assets/{id}:completeUpload。READY 后任务才能用。
//   · 没有位姿 → 先 POST /tasks:images2PosedRGBD 估相机 + 线性深度（EXR），
//     返回每帧的 imageAsset / camera / depth.depthAsset；再把三者原样喂给
//     POST /tasks:posedImages2Splats。所有任务都是异步 operation，用
//     GET /operations/{id} 轮询，done=true 且 error=null 才算成功。
//   · credits（2026-11-26 在 Atlas 平台 Settings → Developer Platform → Credits (API) 页面实读）：
//       posedImages2Splats 成功一次 refined 5,000（$5）/ draft 500（$0.50），失败免费；
//       images2PosedRGBD 2 credits / 输入图（11 张 = 22 credits，$0.022）。
//       docs/billing.md 的 rate card 没列 posed RGBD 的单价，平台定价页列了。
//       Developer API 没有余额查询端点，余额只能看平台页面；脚本把 402
//       CREDITS_UNAVAILABLE / SPEND_LIMIT_EXCEEDED 当作余额不足的唯一信号。
//   · ⚠ 文档自相矛盾：任务指南写 "Set refine to false" 走 draft，但 API reference
//     的 PosedImages2SplatsRequest schema 里没有 refine 字段（多字段会 422）。
//     本脚本默认不传 refine（= refined），--draft 只是留个入口，真被 422 就是证据。
//   · ⚠ 实测补充（2026-11-26）：enhancePrompt=false 必须配非空 prompt（422 原文
//     "enhancePrompt=false requires a non-empty prompt"），本脚本用固定 SCENE_PROMPT。
//
// 设计要点（为什么这么写）：
//   · ★ 绝不在拿到 operation id 之后重复提交：每拿到 id 立刻落盘 atlas-state.json，
//     重跑先认 id 再轮询。一个 refined 任务 5,000 credits，重复提交就是重复扣。
//   · ★ Idempotency-Key 由「输入文件 sha256 + 参数」推导，传输层重试沿用同一个 key；
//     换 body 必须换 key，否则服务端 409。
//   · ★ 先跑 --pose-only 并校验位姿（内参网格 / 四元数归一 / 相机基线），
//     确认没问题再花 5,000 credits 跑 splats —— 参数错误白烧额度是这里最大的风险。
//   · ★ 不打印 API key、也不打印 uploadUrl / readUrl（文档明说这两种 URL 是短期秘密）。
//
// 用法（仓库根目录 app/）：
//   node design/atlas-splat.mjs --dry-run    只做：health + 认证 + 上传 1 张 + credits 说明
//   node design/atlas-splat.mjs --pose-only  上传 11 张 + images2PosedRGBD + 校验位姿
//   node design/atlas-splat.mjs --splat-only 用已保存的 posed-rgbd.json 跑 posedImages2Splats
//   node design/atlas-splat.mjs --run        上面两步连跑（有 state 就断点续跑）
//   node design/atlas-splat.mjs --status     看本地 state 与产物
//   --draft                                   走 refine:false（见上面 ⚠）
//   --allow-pure-rotation                     位姿退化成纯旋转时仍然继续（默认拦下）
//
// 环境变量：
//   ATLAS_API_KEY      优先；不设则读 ATLAS_ENV_FILE（默认 ~/ideahub/server/.env）
//   ATLAS_ENV_FILE     默认 C:\Users\tliu7\ideahub\server\.env
//   ATLAS_NORM_DIR     默认 ~/Downloads/workshop-views12/norm
//   ATLAS_OUT_DIR      默认 <repo>/.tmp-gs-step2
//   ATLAS_API_BASE     默认 https://api.atlas.worldlabs.ai/api/v2
//
// 产物（.tmp-gs-step2/，已被 .gitignore 的 .tmp-gs-*/ 覆盖）：
//   atlas-state.json        资产 / operation id / 已完成标记（断点续跑用）
//   atlas.log               全部日志（含每步耗时）
//   posed-rgbd.json         images2PosedRGBD 的 response（位姿 + 深度 asset id）
//   scene.spz               下载的 refined SPZ（校验过 NGSP 头）
//   atlas-report.json       本次运行的完整报告（时间 / ids / 位姿统计 / SPZ 头 / credits）
import { createHash } from "node:crypto";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(process.env.ATLAS_OUT_DIR || join(ROOT, ".tmp-gs-step2"));
const STATE_FILE = join(OUT_DIR, "atlas-state.json");
const LOG_FILE = join(OUT_DIR, "atlas.log");
const REPORT_FILE = join(OUT_DIR, "atlas-report.json");
const POSED_FILE = join(OUT_DIR, "posed-rgbd.json");
const API_BASE = (process.env.ATLAS_API_BASE || "https://api.atlas.worldlabs.ai/api/v2").replace(/\/+$/, "");
const NORM_DIR = resolve(process.env.ATLAS_NORM_DIR || join(homedir(), "Downloads", "workshop-views12", "norm"));
const ENV_FILE = process.env.ATLAS_ENV_FILE || join(homedir(), "ideahub", "server", ".env");
const TARGET_GRID = [1280, 720];
const EXCLUDE_VIEWS = new Set([11]); // 18mm 全景，伪多视角里位姿最易错；见 workshop-views12/notes.md
const SPLAT_COST_CREDITS = { refined: 5000, draft: 500 };
const POSE_COST_CREDITS_PER_IMAGE = 2; // 平台定价页（docs/billing.md 未列）
// ★ 422 实测（2026-11-26）：enhancePrompt=false 时服务端要求 prompt 非空
//   （"Value error, enhancePrompt=false requires a non-empty prompt"）。
//   给一段固定场景描述，既能跳过 prompt enhancement（省时、可复现），又满足校验。
const SCENE_PROMPT =
  "Night-time interior of a witch's attic study under a steep sloped roof with heavy dark wooden rafters. " +
  "On the far wall is one small round window of frosted glass glowing with cold pale blue-white light. " +
  "A long dark wooden table with a blue embroidered runner runs through the centre, flanked by carved chairs. " +
  "A complete carved stone fireplace with brass ornaments stands on the left wall; bookshelves, a brass armillary sphere " +
  "and a chest of drawers line the right wall. Polished dark wooden floor, smooth plaster walls, warm patina, no people.";

mkdirSync(OUT_DIR, { recursive: true });

// ───────────────────────────── 日志 / 计时 ─────────────────────────────

const timings = [];
let runStarted = Date.now();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // 日志写不进去不该让任务失败
  }
}

async function step(name, fn) {
  log(`▶ ${name}`);
  const t = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t;
    timings.push({ name, ms, ok: true });
    log(`✓ ${name} (${(ms / 1000).toFixed(1)}s)`);
    return out;
  } catch (err) {
    const ms = Date.now() - t;
    timings.push({ name, ms, ok: false, error: err.message });
    log(`✗ ${name} (${(ms / 1000).toFixed(1)}s): ${err.message}`);
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1);

// ───────────────────────────── 状态落盘 ─────────────────────────────

function defaultState() {
  return { schema: 1, apiBase: API_BASE, createdAt: new Date().toISOString(), assets: {}, operations: {}, results: {} };
}

function loadState() {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(readFileSync(STATE_FILE, "utf8")) };
  } catch (err) {
    throw new Error(`state file 读不出来（${STATE_FILE}）：${err.message}`);
  }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ───────────────────────────── 凭据 ─────────────────────────────

function loadApiKey() {
  if (process.env.ATLAS_API_KEY && process.env.ATLAS_API_KEY.trim()) {
    return { key: process.env.ATLAS_API_KEY.trim(), source: "环境变量 ATLAS_API_KEY" };
  }
  if (!existsSync(ENV_FILE)) {
    throw new Error(`找不到 ${ENV_FILE}，也没有 ATLAS_API_KEY 环境变量`);
  }
  const text = readFileSync(ENV_FILE, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*ATLAS_API_KEY\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) return { key: v, source: `env 文件 ${ENV_FILE}` };
  }
  throw new Error(`${ENV_FILE} 里没有 ATLAS_API_KEY=...`);
}

// ───────────────────────────── HTTP ─────────────────────────────

class ApiError extends Error {
  constructor(status, body, pathLabel) {
    const code = body && typeof body === "object" ? body.code : undefined;
    const detail = body && typeof body === "object" ? body.detail : undefined;
    let tail = "";
    if (detail !== undefined) tail = ` detail=${JSON.stringify(detail).slice(0, 900)}`;
    else if (body && typeof body === "object") tail = ` body=${JSON.stringify(body).slice(0, 900)}`;
    else if (typeof body === "string" && body) tail = ` body=${body.slice(0, 900)}`;
    super(`HTTP ${status}${code ? ` ${code}` : ""} on ${pathLabel}${tail}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function apiHeaders(key, idempotencyKey) {
  const h = { "Content-Type": "application/json" };
  if (key) h["WLT-Api-Key"] = key;
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return h;
}

async function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request(key, pathLabel, { method = "GET", body, idempotencyKey, retries = 4, timeoutMs = 60000, auth = true } = {}) {
  const url = pathLabel.startsWith("http") ? pathLabel : `${API_BASE}${pathLabel}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        url,
        { method, headers: apiHeaders(auth ? key : null, idempotencyKey), body: body === undefined ? undefined : JSON.stringify(body) },
        timeoutMs,
      );
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      const wait = Math.min(20000, 1000 * 2 ** attempt + Math.random() * 500);
      log(`  ! ${method} ${pathLabel} 网络错误（${err.name}: ${err.message}），${(wait / 1000).toFixed(1)}s 后重试（${attempt + 1}/${retries}）`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (res.ok) return data;

    const retryable = [429, 500, 502, 503, 504].includes(res.status) && attempt < retries;
    if (retryable) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 0, Math.min(30000, 1000 * 2 ** attempt + Math.random() * 500));
      log(`  ! ${method} ${pathLabel} → HTTP ${res.status}${data?.code ? ` ${data.code}` : ""}，${(wait / 1000).toFixed(1)}s 后重试（${attempt + 1}/${retries}）`);
      await sleep(wait);
      continue;
    }
    throw new ApiError(res.status, data, pathLabel);
  }
  throw new Error(`${method} ${pathLabel} 重试 ${retries} 次仍失败：${lastErr?.message || "unknown"}`);
}

// ───────────────────────────── 资产 ─────────────────────────────

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listNormViews() {
  if (!existsSync(NORM_DIR)) throw new Error(`找不到归一后的图片目录：${NORM_DIR}`);
  const views = readdirSync(NORM_DIR)
    .map((f) => {
      const m = f.match(/^view-(\d+)\.jpg$/i);
      return m ? { file: join(NORM_DIR, f), n: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .filter((v) => !EXCLUDE_VIEWS.has(v.n))
    .sort((a, b) => a.n - b.n);
  if (!views.length) throw new Error(`${NORM_DIR} 下没有 view-XX.jpg`);
  return views;
}

async function verifyAsset(key, assetId) {
  try {
    const a = await request(key, `/assets/${assetId}`);
    return a && a.state === "READY" ? a : null;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function uploadAsset(key, view, state) {
  const bytes = readFileSync(view.file);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const cached = state.assets[sha];
  if (cached?.assetId) {
    const ready = await verifyAsset(key, cached.assetId);
    if (ready) {
      log(`  · view-${String(view.n).padStart(2, "0")} 复用已 READY 的资产 ${cached.assetId}（${bytes.length} bytes）`);
      return { ...cached, verifiedAt: new Date().toISOString() };
    }
    log(`  · 缓存的资产 ${cached.assetId} 已不可用，重新上传`);
  }

  const t0 = Date.now();
  const displayName = `workshop-norm-${basename(view.file)}`;
  const created = await request(key, "/assets", { method: "POST", body: { asset: { displayName } } });
  const assetId = created.id;

  // createUploadUrl：contentType/contentLength 必须与实际字节一致，否则 completeUpload 会拒。
  let ready = null;
  for (let attempt = 0; attempt < 2 && !ready; attempt++) {
    const grant = await request(key, `/assets/${assetId}:createUploadUrl`, {
      method: "POST",
      body: { contentType: "image/jpeg", contentLength: bytes.length },
    });
    // 签名 URL 的 headers 必须原样带上（Host/Content-Length 由 fetch 自己算，不能手填）。
    const putHeaders = { ...(grant.headers || {}) };
    delete putHeaders["Content-Length"];
    delete putHeaders["content-length"];
    delete putHeaders["Host"];
    delete putHeaders["host"];
    let put;
    try {
      put = await fetchWithTimeout(grant.uploadUrl, { method: grant.method || "PUT", headers: putHeaders, body: bytes }, 120000);
    } catch (err) {
      log(`  ! 上传 PUT 失败（${err.name}: ${err.message}），${attempt === 0 ? "重新申请上传票重试" : "放弃"}`);
      continue;
    }
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      log(`  ! 上传 PUT → HTTP ${put.status} ${t.slice(0, 300)}，${attempt === 0 ? "重新申请上传票重试" : "放弃"}`);
      continue;
    }
    const completed = await request(key, `/assets/${assetId}:completeUpload`, { method: "POST", body: {} });
    if (completed && completed.state === "READY") {
      ready = completed;
    } else {
      log(`  ! completeUpload 返回 state=${completed?.state}，重试`);
    }
  }
  if (!ready) throw new Error(`上传 view-${view.n} 失败`);

  const rec = {
    assetId,
    file: view.file,
    displayName,
    bytes: bytes.length,
    sha256: sha,
    width: ready.width,
    height: ready.height,
    state: ready.state,
    uploadedAt: new Date().toISOString(),
    uploadMs: Date.now() - t0,
  };
  state.assets[sha] = rec;
  saveState(state);
  log(`  · view-${String(view.n).padStart(2, "0")} → ${assetId} ${ready.state} ${ready.width}×${ready.height} ${bytes.length} bytes (${secs(rec.uploadMs)}s)`);
  return rec;
}

// ───────────────────────────── operation ─────────────────────────────

function operationErrorText(op) {
  const e = op?.error || {};
  let reason = "";
  try {
    const info = (e.details || []).find((d) => d && (d["@type"] || "").includes("ErrorInfo"));
    if (info?.reason) reason = ` reason=${info.reason}`;
  } catch {
    // ignore
  }
  return `operation ${op?.id} 失败：code=${e.code ?? "?"}${reason} message=${e.message ?? "(none)"}`;
}

async function pollOperation(key, opId, label, { timeoutMs = 45 * 60 * 1000, state, slot } = {}) {
  const t0 = Date.now();
  let delay = 2000;
  let lastMeta = "";
  let notFound = 0;
  for (;;) {
    let op;
    try {
      op = await request(key, `/operations/${opId}`, { retries: 3 });
    } catch (err) {
      // 文档：刚提交后短暂 404 可以重试；持续 404 才是问题。
      if (err instanceof ApiError && err.status === 404 && notFound < 6) {
        notFound++;
        log(`  · operation ${opId} 还读不到（404），3s 后重试 ${notFound}/6`);
        await sleep(3000);
        continue;
      }
      throw err;
    }
    const elapsed = Date.now() - t0;
    const meta = op.metadata ? JSON.stringify(op.metadata) : "";
    if (meta !== lastMeta) {
      log(`[${label}] ${secs(elapsed)}s done=${op.done} metadata=${meta || "(null)"}`);
      lastMeta = meta;
    } else if (!op.done) {
      log(`[${label}] ${secs(elapsed)}s done=false 运行中…`);
    }
    if (state && slot) {
      const prev = state.operations[slot] || {};
      // ★ 续跑保护：已经 done 的 operation 再轮询一次，不要把首轮的耗时覆盖成 0.x 秒。
      const keepElapsed = prev.done === true && prev.elapsedMs != null;
      state.operations[slot] = {
        ...prev,
        id: opId,
        done: !!op.done,
        lastPollAt: new Date().toISOString(),
        elapsedMs: keepElapsed ? prev.elapsedMs : elapsed,
      };
      if (op.done) {
        state.operations[slot].error = op.error || null;
        state.operations[slot].finishedAt = state.operations[slot].finishedAt || new Date().toISOString();
      }
      saveState(state);
    }
    if (op.done) {
      if (op.error) throw new Error(operationErrorText(op));
      return op;
    }
    if (elapsed > timeoutMs) {
      throw new Error(`operation ${opId} 超过 ${(timeoutMs / 60000).toFixed(0)} 分钟还没完成（继续用 --status / 重跑脚本轮询，别重新提交）`);
    }
    const wait = Math.min(20000, delay + Math.random() * 1000);
    delay = Math.min(20000, Math.round(delay * 1.45));
    await sleep(wait);
  }
}

// ───────────────────────────── 位姿校验 ─────────────────────────────

function validatePosed(resp, expectedCount) {
  const frames = resp?.frames;
  if (!Array.isArray(frames)) throw new Error("images2PosedRGBD 的 response 里没有 frames[]");
  if (frames.length !== expectedCount) throw new Error(`位姿帧数 ${frames.length} != 输入 ${expectedCount}`);
  const problems = [];
  const positions = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const tag = `frame[${i}]`;
    if (!f?.imageAsset?.assetId) problems.push(`${tag}: 缺 imageAsset.assetId`);
    if (!f?.depth?.depthAsset?.assetId) problems.push(`${tag}: 缺 depth.depthAsset.assetId`);
    const intr = f?.camera?.intrinsics;
    if (!intr) {
      problems.push(`${tag}: 缺 camera.intrinsics`);
      continue;
    }
    if (Math.round(intr.width) !== TARGET_GRID[0] || Math.round(intr.height) !== TARGET_GRID[1]) {
      problems.push(`${tag}: 内参网格 ${intr.width}x${intr.height} != ${TARGET_GRID.join("x")}`);
    }
    for (const k of ["fx", "fy", "cx", "cy"]) {
      if (!Number.isFinite(intr[k]) || intr[k] <= 0) problems.push(`${tag}: intrinsics.${k}=${intr[k]} 非法`);
    }
    const ex = f?.camera?.extrinsics;
    if (!ex || !Array.isArray(ex.position) || ex.position.length !== 3 || !ex.position.every(Number.isFinite)) {
      problems.push(`${tag}: extrinsics.position 非法`);
    } else {
      positions.push(ex.position);
    }
    const q = ex?.quaternion;
    if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) {
      problems.push(`${tag}: extrinsics.quaternion 非法`);
    } else {
      const norm = Math.hypot(...q);
      if (Math.abs(norm - 1) > 0.01) problems.push(`${tag}: quaternion 模长 ${norm.toFixed(4)} 不是单位四元数`);
    }
    if (ex?.coordinateSystem && !["rub", "rdf"].includes(ex.coordinateSystem)) {
      problems.push(`${tag}: coordinateSystem=${ex.coordinateSystem}`);
    }
  }

  let maxPairwise = 0;
  let centroid = [0, 0, 0];
  if (positions.length) {
    for (let c = 0; c < 3; c++) centroid[c] = positions.reduce((s, p) => s + p[c], 0) / positions.length;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const d = Math.hypot(positions[i][0] - positions[j][0], positions[i][1] - positions[j][1], positions[i][2] - positions[j][2]);
        if (d > maxPairwise) maxPairwise = d;
      }
    }
  }
  const stats = {
    frameCount: frames.length,
    poseRefinementAccepted: resp?.poseRefinementAccepted ?? null,
    maxPairwiseCameraDistance: Number(maxPairwise.toFixed(6)),
    centroidWorld: centroid.map((v) => Number(v.toFixed(6))),
    pureRotationSuspected: positions.length > 1 && maxPairwise < 0.02,
  };
  if (problems.length) throw new Error(`位姿校验失败：\n  - ${problems.slice(0, 12).join("\n  - ")}`);
  return stats;
}

// ───────────────────────────── SPZ ─────────────────────────────

const SPZ_MAGIC = 0x5053474e; // little-endian "NGSP"

// 签名 URL（uploadUrl / readUrl / signedQuery）和 base64 都是短期秘密，落盘前一律剥掉。
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (["url", "readUrl", "uploadUrl", "signedQuery", "base64"].includes(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

function parseSpzHeader(buf) {
  if (buf.length < 16) throw new Error(`SPZ 只有 ${buf.length} 字节，连 16 字节头都不够`);
  const magic = buf.readUInt32LE(0);
  const magicBytes = buf.subarray(0, 4);
  const header = {
    magicHex: "0x" + magic.toString(16).padStart(8, "0"),
    magicAscii: magicBytes.toString("latin1"),
    version: buf.readUInt32LE(4),
    numPoints: buf.readUInt32LE(8),
    shDegree: buf.readUInt8(12),
    fractionalBits: buf.readUInt8(13),
    flags: buf.readUInt8(14),
    reserved: buf.readUInt8(15),
  };
  header.validMagic = magic === SPZ_MAGIC;
  return header;
}

// 极简 ZIP 解包：Atlas 正常回 .spz；万一被包成 zip，只为把单个 .spz 取出来。
function extractSingleSpzFromZip(buf) {
  // 找 End of Central Directory（0x06054b50），从尾部往前最多扫 64KB+22。
  let eocd = -1;
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("看起来是 zip（PK\\x03\\x04），但找不到 EOCD");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const entry = entries.find((e) => /\.spz$/i.test(e.name));
  if (!entry) throw new Error(`zip 里没有 .spz（entries: ${entries.map((e) => e.name).join(", ")}）`);
  const lh = entry.localOffset;
  if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("zip local header 不对");
  const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
  const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return { name: entry.name, data: raw };
  if (entry.method === 8) return { name: entry.name, data: inflateRawSync(raw) };
  throw new Error(`zip 压缩方法 ${entry.method} 不支持（只认 store/deflate）`);
}

// ───────────────────────────── 下载 ─────────────────────────────

async function downloadTo(url, dest, label) {
  const res = await fetchWithTimeout(url, { method: "GET" }, 15 * 60 * 1000);
  if (!res.ok) throw new Error(`下载 ${label} → HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  return dest;
}

async function resolveReadUrl(key, asset) {
  if (asset?.url) return asset.url;
  if (!asset?.assetId) throw new Error("资产既没有 url 也没有 assetId");
  const r = await request(key, `/assets/${asset.assetId}:createReadUrl`, { method: "POST", body: {} });
  if (!r?.readUrl) throw new Error(`createReadUrl 没给 readUrl（asset ${asset.assetId}）`);
  return r.readUrl;
}

// ───────────────────────────── 主流程 ─────────────────────────────

function parseArgs(argv) {
  const args = { mode: null, draft: false, allowPureRotation: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.mode = "dry-run";
    else if (a === "--pose-only") args.mode = "pose-only";
    else if (a === "--splat-only") args.mode = "splat-only";
    else if (a === "--run") args.mode = "run";
    else if (a === "--status") args.mode = "status";
    else if (a === "--draft") args.draft = true;
    else if (a === "--allow-pure-rotation") args.allowPureRotation = true;
    else if (a === "--help" || a === "-h") args.mode = "help";
    else throw new Error(`不认识的参数 ${a}`);
  }
  if (!args.mode) args.mode = "help";
  return args;
}

async function dryRun(key, state) {
  await step("health（不需要 key）", async () => {
    const h = await request(null, "/health", { auth: false, retries: 2 });
    log(`  · health: ${JSON.stringify(h).slice(0, 300)}`);
    return h;
  });

  const assets = await step("认证：GET /assets?pageSize=1（assets.read）", async () => {
    const r = await request(key, "/assets?pageSize=1");
    const n = Array.isArray(r?.assets) ? r.assets.length : Array.isArray(r) ? r.length : null;
    log(`  · 认证通过（列到 ${n ?? "?"} 个资产，说明 key 有效且有 assets.read）`);
    return r;
  });

  const views = listNormViews();
  if (!views.length) throw new Error("没有可上传的图");
  const first = views.find((v) => v.n === 1) || views[0];
  const asset = await step(`上传 1 张：view-${String(first.n).padStart(2, "0")}`, () => uploadAsset(key, first, state));

  log("credits：Developer API 文档没有余额查询端点；余额看平台 Settings → Developer Platform → Credits (API)。");
  log("         脚本把 HTTP 402 CREDITS_UNAVAILABLE / SPEND_LIMIT_EXCEEDED 当作余额不足的唯一信号。");
  log(`         平台定价（2026-11-26 实读）：images2PosedRGBD ${POSE_COST_CREDITS_PER_IMAGE} credits/输入图（11 张 = ${11 * POSE_COST_CREDITS_PER_IMAGE}）；` +
    `posedImages2Splats refined ${SPLAT_COST_CREDITS.refined} / draft ${SPLAT_COST_CREDITS.draft}（成功才扣，失败免费）。`);
  log("         本账号页面显示 10,000 credits available（≈ $10.00，2026-11-26 读数）。");

  const report = {
    kind: "dry-run",
    at: new Date().toISOString(),
    apiBase: API_BASE,
    keySource: state.keySource,
    healthOk: true,
    authOk: true,
    assetCountSample: Array.isArray(assets?.assets) ? assets.assets.length : null,
    uploaded: asset,
    creditsNote: "文档无余额查询端点；见 atlas-report.json / 报告。",
    timings,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  log(`dry-run 完成，报告 ${REPORT_FILE}`);
}

function findOperation(state, slot) {
  return state.operations?.[slot]?.id ? state.operations[slot] : null;
}

async function ensureAssets(key, state) {
  const views = listNormViews();
  log(`归一后的输入：${views.length} 张（${views.map((v) => "view-" + String(v.n).padStart(2, "0")).join(", ")}）`);
  const assets = [];
  for (const v of views) assets.push(await uploadAsset(key, v, state));
  return assets;
}

async function runPose(key, state, assets) {
  const poseCost = assets.length * POSE_COST_CREDITS_PER_IMAGE;
  const body = {
    frames: assets.map((a) => ({ imageAsset: { assetId: a.assetId } })),
    targetResolution: TARGET_GRID,
    canonicalizeToFirstFrame: true,
    refinePoses: true,
  };
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ frames: assets.map((a) => a.sha256), targetResolution: TARGET_GRID, canonicalize: true, refinePoses: true }))
    .digest("hex")
    .slice(0, 16);

  let op = findOperation(state, "images2PosedRGBD");
  if (op && op.done && op.error) throw new Error(`上一次 images2PosedRGBD 已失败，先看 atlas.log；如要重跑请删掉 state 里 operations.images2PosedRGBD 再执行（会重新计费）`);
  log(`  · images2PosedRGBD 计价：${assets.length} 张 × ${POSE_COST_CREDITS_PER_IMAGE} credits = ${poseCost} credits`);
  if (!op) {
    const idem = `wlt-gs-${inputHash}-pose`;
    const submitted = await step(`提交 images2PosedRGBD（${assets.length} 帧，idempotency ${idem}）`, () =>
      request(key, "/tasks:images2PosedRGBD", { method: "POST", body, idempotencyKey: idem, timeoutMs: 120000 }),
    );
    op = { id: submitted.id, idempotencyKey: idem, submittedAt: new Date().toISOString(), done: false };
    state.operations.images2PosedRGBD = op;
    saveState(state);
    log(`  · operation ${submitted.id} 已落盘（先记 id 再等，避免重复提交）`);
  } else {
    log(`  · 复用已提交的 operation ${op.id}（不再提交）`);
  }

  const done = await pollOperation(key, op.id, "pose", { state, slot: "images2PosedRGBD", timeoutMs: 45 * 60 * 1000 });
  const response = done.response;
  if (!response) throw new Error("images2PosedRGBD done=true 但没有 response");
  writeFileSync(POSED_FILE, JSON.stringify({ operationId: op.id, savedAt: new Date().toISOString(), response: stripSecrets(response) }, null, 2) + "\n");
  const stats = validatePosed(response, assets.length);
  log(`  · 位姿校验通过：${JSON.stringify(stats)}`);
  if (stats.pureRotationSuspected) {
    const msg = `⚠ 相机基线只有 ${stats.maxPairwiseCameraDistance}（疑似纯旋转）。纯旋转没有基线，深度尺度恢复不了，splats 会退化成 2.5D；真要继续请加 --allow-pure-rotation。`;
    if (!args.allowPureRotation) throw new Error(msg);
    log(msg);
  }
  state.results.pose = { operationId: op.id, stats, savedAt: new Date().toISOString() };
  saveState(state);
  return { response, stats, operationId: op.id };
}

async function runSplats(key, state) {
  if (!existsSync(POSED_FILE)) throw new Error(`没有 ${POSED_FILE}，先跑 --pose-only`);
  const posed = JSON.parse(readFileSync(POSED_FILE, "utf8"));
  const frames = posed.response?.frames;
  if (!Array.isArray(frames) || frames.length < 2) throw new Error("posed-rgbd.json 里 frames 少于 2");

  const posedFrames = frames.map((f) => ({
    imageAsset: { assetId: f.imageAsset.assetId },
    depth: { depthAsset: { assetId: f.depth.depthAsset.assetId } },
    camera: f.camera,
  }));
  const body = { posedFrames, prompt: SCENE_PROMPT, enhancePrompt: false };
  if (args.draft) body.refine = false; // ⚠ 见文件头：公开 schema 没这个字段，可能 422。
  const mode = args.draft ? "draft" : "refined";
  const cost = SPLAT_COST_CREDITS[mode];
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ frames: posedFrames.map((f) => f.imageAsset.assetId), mode, prompt: SCENE_PROMPT, enhancePrompt: false }))
    .digest("hex")
    .slice(0, 16);
  const slot = `posedImages2Splats:${mode}`;

  let op = findOperation(state, slot);
  if (op && op.done && op.error) throw new Error(`上一次 ${slot} 已失败；如要重跑请删掉 state 对应 entry（失败任务按文档免费，但请先看日志）`);
  if (!op) {
    const idem = `wlt-gs-${inputHash}-splats-${mode}`;
    log(`  · 即将提交 ${mode} splats：文档单价 ${cost} credits（成功才扣，失败免费）`);
    const submitted = await step(`提交 posedImages2Splats（${mode}，${posedFrames.length} 帧，idempotency ${idem}）`, () =>
      request(key, "/tasks:posedImages2Splats", { method: "POST", body, idempotencyKey: idem, timeoutMs: 120000 }),
    );
    op = { id: submitted.id, idempotencyKey: idem, mode, submittedAt: new Date().toISOString(), done: false, creditsChargedOnSuccess: cost };
    state.operations[slot] = op;
    saveState(state);
    log(`  · operation ${submitted.id} 已落盘`);
  } else {
    log(`  · 复用已提交的 operation ${op.id}（不再提交）`);
  }

  const done = await pollOperation(key, op.id, mode, { state, slot, timeoutMs: 90 * 60 * 1000 });
  const response = done.response || {};
  const refined = response.refinedSplats && typeof response.refinedSplats === "object" ? response.refinedSplats : {};
  const draft = response.draftSplat || null;
  const entries = Object.entries(refined)
    .map(([k, v]) => ({ count: Number(k), key: k, asset: v }))
    .sort((a, b) => (Number.isFinite(a.count) ? a.count : -1) - (Number.isFinite(b.count) ? b.count : -1));
  const pickedEntry = args.draft ? null : entries[entries.length - 1];
  const picked = args.draft ? draft : pickedEntry?.asset;
  if (!picked) throw new Error(`${mode} 成功但 response 里没有 ${args.draft ? "draftSplat" : "refinedSplats"}：${JSON.stringify(response).slice(0, 500)}`);

  const label = "SPZ";
  const dest = join(OUT_DIR, args.draft ? "scene-draft.spz" : "scene.spz");
  const url = await resolveReadUrl(key, picked);
  const t0 = Date.now();
  await downloadTo(url, dest, label);
  const bytes = readFileSync(dest);
  const ms = Date.now() - t0;
  log(`  · 已下载 ${dest} ${(bytes.length / 1024 / 1024).toFixed(2)} MiB (${secs(ms)}s)`);

  let header;
  let container = "spz";
  let zipEntry = null;
  let fileBytes = bytes;
  const first4 = bytes.subarray(0, 4);
  if (first4[0] === 0x50 && first4[1] === 0x4b) {
    log("  · 下载物是 zip，抽取其中 .spz");
    const ex = extractSingleSpzFromZip(bytes);
    zipEntry = ex.name;
    fileBytes = Buffer.from(ex.data);
    writeFileSync(dest, fileBytes);
    header = parseSpzHeader(fileBytes);
    container = "zip";
  } else if (first4[0] === 0x1f && first4[1] === 0x8b) {
    log("  · 下载物是 gzip，解压后重新落盘为 .spz");
    fileBytes = gunzipSync(bytes);
    writeFileSync(dest, fileBytes);
    header = parseSpzHeader(fileBytes);
    container = "gzip";
  } else {
    header = parseSpzHeader(fileBytes);
  }
  log(`  · SPZ header: magic=${header.magicAscii} (${header.magicHex}) version=${header.version} numPoints=${header.numPoints} shDegree=${header.shDegree} fractionalBits=${header.fractionalBits} flags=${header.flags}`);
  if (!header.validMagic) log(`  · ⚠ 头 4 字节不是 NGSP，可能是别的容器格式`);

  const result = {
    operationId: op.id,
    mode,
    requestedAt: new Date().toISOString(),
    credits: { documentedPrice: cost, chargedOnSuccess: cost },
    responseKeys: Object.keys(response),
    splatCountKey: pickedEntry?.key ?? null,
    assetId: picked.assetId ?? null,
    prompt: SCENE_PROMPT,
    container,
    zipEntry,
    path: dest,
    bytes: fileBytes.length,
    sha256: createHash("sha256").update(fileBytes).digest("hex"),
    header,
    downloadMs: ms,
    operationResponse: stripSecrets(response),
  };
  state.results.splats = result;
  saveState(state);
  {
    // 每次都重写报告：dry-run / pose-only 的前半段不能丢。
    const prior = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, "utf8")) : {};
    writeFileSync(REPORT_FILE, JSON.stringify({ ...prior, splats: result, timings, finishedAt: new Date().toISOString() }, null, 2) + "\n");
  }
  return result;
}


async function runAll(key, state) {
  const assets = await step("上传 11 张归一图", () => ensureAssets(key, state));
  const pose = await step("images2PosedRGBD：估位姿 + 深度", () => runPose(key, state, assets));
  const splats = await step(`posedImages2Splats：${args.draft ? "draft 500" : "refined 5,000"} credits`, () => runSplats(key, state));
  log("完成：");
  log(`  · SPZ: ${splats.path} ${(splats.bytes / 1024 / 1024).toFixed(2)} MiB`);
  log(`  · NGSP version=${splats.header.version} numPoints=${splats.header.numPoints} shDegree=${splats.header.shDegree}`);
  log(`  · 位姿：${JSON.stringify(pose.stats)}`);
  const poseCost = assets.length * POSE_COST_CREDITS_PER_IMAGE;
  log(`  · credits：images2PosedRGBD ${assets.length}×${POSE_COST_CREDITS_PER_IMAGE}=${poseCost}；splats ${splats.credits.chargedOnSuccess}`);
  const draftOp = state.operations["posedImages2Splats:draft"];
  const draftCost = draftOp?.done && !draftOp?.error ? draftOp.creditsChargedOnSuccess || 0 : 0;
  const operations = Object.entries(state.operations).map(([slot, op]) => ({
    slot,
    id: op.id,
    mode: op.mode ?? null,
    elapsedMs: op.elapsedMs ?? null,
    done: !!op.done,
    error: op.error ?? null,
    credits: slot === "images2PosedRGBD" ? poseCost : op.creditsChargedOnSuccess ?? null,
  }));
  const report = {
    kind: "full-run",
    at: new Date().toISOString(),
    apiBase: API_BASE,
    inputs: listNormViews().map((v) => ({ view: v.n, file: v.file, bytes: statSync(v.file).size, sha256: sha256File(v.file) })),
    pose: { operationId: pose.operationId, stats: pose.stats },
    splats,
    operations,
    credits: {
      documented: SPLAT_COST_CREDITS,
      posePerImage: POSE_COST_CREDITS_PER_IMAGE,
      poseTotal: poseCost,
      draftTotal: draftCost,
      splatsTotal: splats.credits.chargedOnSuccess,
      totalDocumented: poseCost + draftCost + splats.credits.chargedOnSuccess,
    },
    timings,
    totalMs: Date.now() - runStarted,
  };
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  log(`报告：${REPORT_FILE}`);
}

function showStatus(state) {
  console.log(JSON.stringify({
    stateFile: STATE_FILE,
    apiBase: state.apiBase,
    assets: Object.values(state.assets || {}).map((a) => ({ assetId: a.assetId, file: basename(a.file), bytes: a.bytes, uploadedAt: a.uploadedAt })),
    operations: state.operations,
    results: state.results,
    files: existsSync(OUT_DIR) ? readdirSync(OUT_DIR).map((f) => ({ name: f, bytes: statSync(join(OUT_DIR, f)).size })) : [],
  }, null, 2));
}

const HELP = `用法：
  node design/atlas-splat.mjs --dry-run      health + 认证 + 上传 1 张 + credits 说明
  node design/atlas-splat.mjs --pose-only    上传 11 张 + images2PosedRGBD + 校验位姿
  node design/atlas-splat.mjs --splat-only   用已有 posed-rgbd.json 跑 posedImages2Splats
  node design/atlas-splat.mjs --run          两步连跑（断点续跑，不会重复提交）
  node design/atlas-splat.mjs --status       看本地 state/产物
  --draft / --allow-pure-rotation 见文件头`;

let args;
let state;
try {
  args = parseArgs(process.argv);
  if (args.mode === "help") {
    console.log(HELP);
    process.exit(0);
  }
  if (args.mode === "status") {
    state = loadState();
    showStatus(state);
    process.exit(0);
  }
  const { key, source } = loadApiKey();
  state = loadState();
  state.keySource = source;
  saveState(state);
  log(`Atlas ${args.mode} · API ${API_BASE} · key ${source} · out ${OUT_DIR}`);

  if (args.mode === "dry-run") {
    await dryRun(key, state);
  } else if (args.mode === "pose-only") {
    const assets = await step("上传 11 张归一图", () => ensureAssets(key, state));
    const pose = await step("images2PosedRGBD：估位姿 + 深度", () => runPose(key, state, assets));
    log(`pose-only 完成：${POSED_FILE}`);
    log(`位姿统计：${JSON.stringify(pose.stats)}`);
    const report = { kind: "pose-only", at: new Date().toISOString(), pose: { operationId: pose.operationId, stats: pose.stats }, timings, totalMs: Date.now() - runStarted };
    writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  } else if (args.mode === "splat-only") {
    const splats = await step(`posedImages2Splats：${args.draft ? "draft 500" : "refined 5,000"} credits`, () => runSplats(key, state));
    log(`splat-only 完成：${splats.path}`);
  } else if (args.mode === "run") {
    await runAll(key, state);
  }
} catch (err) {
  log(`FAILED: ${err.message}`);
  if (err instanceof ApiError && err.status === 402) {
    log("提示：402 是 credits / spend limit 问题；本脚本不会自动重试付费任务。");
  }
  try {
    if (state) {
      writeFileSync(REPORT_FILE, JSON.stringify({ kind: args?.mode, at: new Date().toISOString(), error: err.message, timings, totalMs: Date.now() - runStarted }, null, 2) + "\n");
    }
  } catch {
    // ignore
  }
  process.exitCode = 1;
}
