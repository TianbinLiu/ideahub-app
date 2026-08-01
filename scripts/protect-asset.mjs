// 资产加密管线：把 GLB 模型加密成 .glbx（AES-256-GCM），运行时在内存解密后直接
// 喂给 GLTFLoader.parse——磁盘/网络上永远没有明文模型。
//
// 用法：
//   node scripts/protect-asset.mjs <输入.glb> [更多输入...]
// 输出到 public/models/protected/<原名>.glbx
//
// 密钥管理：
// - 首次运行自动生成 256 位密钥写入 .env.local 的 VITE_ASSET_KEY（vite 构建时注入）
// - .env.local 与 public/models/protected/ 均已 gitignore——公开仓库里永远没有
//   密钥与受保护资产（购买的模型文件本体也绝不能提交公开仓库）
// - 换密钥：删掉 .env.local 里的 VITE_ASSET_KEY 重跑（所有 .glbx 需重新加密）
import { webcrypto as crypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
const outDir = path.join(root, "public", "models", "protected");

function loadOrCreateKey() {
  let env = "";
  if (fs.existsSync(envFile)) env = fs.readFileSync(envFile, "utf8");
  const m = env.match(/^VITE_ASSET_KEY=([A-Za-z0-9+/=]+)$/m);
  if (m) return Buffer.from(m[1], "base64");
  const raw = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const line = `VITE_ASSET_KEY=${raw.toString("base64")}`;
  fs.writeFileSync(envFile, env ? env.replace(/\n?$/, "\n") + line + "\n" : line + "\n");
  console.log("已生成新资产密钥 → .env.local（勿提交、自行备份）");
  return raw;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("用法: node scripts/protect-asset.mjs <输入.glb> [更多输入...]");
  process.exit(1);
}

const keyRaw = loadOrCreateKey();
const key = await crypto.subtle.importKey("raw", keyRaw, "AES-GCM", false, ["encrypt"]);
fs.mkdirSync(outDir, { recursive: true });

for (const f of files) {
  const abs = path.resolve(root, f);
  const data = fs.readFileSync(abs);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  // 格式：magic "GLBX1"(5B) + iv(12B) + AES-GCM 密文（含 16B tag）
  const out = Buffer.concat([Buffer.from("GLBX1"), Buffer.from(iv), Buffer.from(cipher)]);
  const dst = path.join(outDir, path.basename(abs).replace(/\.glb$/i, "") + ".glbx");
  fs.writeFileSync(dst, out);
  console.log(`${path.basename(abs)} (${(data.length / 1048576).toFixed(2)}MB) → ${path.relative(root, dst)}`);
}
