// 角色模型画质分档：从 high 档 GLB 派生 mid / low 档。
//
//   npm i --no-save sharp
//   node design/make-lod.mjs <输入.glb> <输出.glb> --tex 0.5 [--tex-min 512] [--keep-morphs a,b,c]
//
// ## 为什么不减面
//
// 常规 LOD 的第一手是减面，这里**不能减**：两个角色的表情系统建在形键上
// （见 faceExpr.ts），而减面会让形键失效——Blender 的 Decimate 修改器遇到带形键的
// 网格直接拒绝执行，任何重拓扑也一样：形键是"每顶点位移"，顶点没了位移就无处安放。
//
// 好在实测下来减面本来也不是重点。Tsumire 的 13.62MB 里：
//   贴图 7.38MB (54%) · morph 3.18MB (23%) · 顶点+索引 2.7MB (20%)
// 几何只占五分之一，砍一半也就省 1.3MB，代价却是整套表情。所以分档只做两件事：
//   ① 贴图降采样（--tex）——省的是大头，且完全不碰几何
//   ② 裁掉用不上的形键（--keep-morphs）——只在 low 档做
//
// ## 为什么是 Node 改写而不是 Blender 重导
//
// 走 Blender 导入→改→导出更省事，但它会重排顶点、重建材质，而**贴图名是运行时的
// 语义锚点**：cameraFade 靠 `tex_face`/`tex_body` 判定皮肤（决定单面剔除与淡出分支），
// toonify 的 outlineSkip 也按贴图名跳过脸部描边。这些名字一旦被重导改掉，画面会以
// "黑眼圈 / 镜头穿模看到内壁"的形式炸掉，而且不会有任何报错。这里逐字节改写 GLB：
// 只动被点名的部分，其余原样搬运。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const [SRC, DST] = args.filter((a) => !a.startsWith("--"));
const flag = (n) => {
  const i = args.indexOf("--" + n);
  return i < 0 ? null : args[i + 1];
};
if (!SRC || !DST) {
  console.error("用法: node design/make-lod.mjs <输入.glb> <输出.glb> --tex 0.5 [--tex-min 512] [--keep-morphs a,b,c]");
  process.exit(1);
}
const TEX = Number(flag("tex") ?? 1);
const TEX_MIN = Number(flag("tex-min") ?? 64); // 边长下限
const KEEP = flag("keep-morphs") ? new Set(flag("keep-morphs").split(",").map((s) => s.trim())) : null;

// ── 读 GLB ────────────────────────────────────────────────────
function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error("不是 GLB");
  let off = 12, json = null, bin = null;
  while (off < b.length) {
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    const body = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString("utf8"));
    else if (type === 0x004e4942) bin = body;
    off += 8 + len;
  }
  return { json, bin };
}

/** 按 4 字节对齐拼 chunk——glTF 规范强制要求，不补齐的文件 three.js 会读到错位数据 */
function writeGlb(file, json, bin) {
  const js = Buffer.from(JSON.stringify(json), "utf8");
  const jsPad = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
  const total = 12 + 8 + jsPad.length + 8 + binPad.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsPad.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPad.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, jsPad, bh, binPad]));
}

const { json: g, bin } = readGlb(SRC);
const srcSize = fs.statSync(SRC).size;

// meshopt 压缩过的文件必须挡住：它的 bufferView 把真实数据挪进
// extensions.EXT_meshopt_compression（外层只剩一个 fallback 壳），下面那套
// "按 byteOffset/byteLength 原样搬运"会搬到空气，而且不会报错——产出的是一个能
// 加载但内容错乱的模型。NPC 的 milltina-opt 正是这种档，实测撞上过。
if ((g.extensionsUsed ?? []).includes("EXT_meshopt_compression")) {
  console.error("拒绝处理：这个 GLB 用了 EXT_meshopt_compression——它已经是压缩过的产物。");
  console.error("要处理必须先解压：gltf-transform meshopt --decode <in> <out>");
  process.exit(2);
}

// ── ① 形键裁剪 ───────────────────────────────────────────────
// 只删 primitive 上的 target 引用与 extras.targetNames，访问器/bufferView 交给后面的
// GC 统一回收——手工删会牵出一串下标重映射，正是这种活最容易悄悄错位。
let droppedMorphs = 0;
if (KEEP) {
  for (const mesh of g.meshes ?? []) {
    const names = mesh.extras?.targetNames;
    if (!names) continue;
    const keepIdx = names.map((n, i) => (KEEP.has(n) ? i : -1)).filter((i) => i >= 0);
    droppedMorphs += names.length - keepIdx.length;
    mesh.extras.targetNames = keepIdx.map((i) => names[i]);
    for (const p of mesh.primitives) {
      if (p.targets) p.targets = keepIdx.map((i) => p.targets[i]);
    }
    // weights 是与 targets 等长的默认权重数组，长度对不上 three.js 会读到 undefined
    if (mesh.weights) mesh.weights = keepIdx.map((i) => mesh.weights[i] ?? 0);
  }
}

// ── ② 贴图降采样 ─────────────────────────────────────────────
// 只改分辨率**不改格式**：换格式要动 EXT_texture_webp 之类的扩展声明，多一个
// "加载器支不支持"的变量，而降采样已经拿到大头。编码参数拉满换时间，反正离线跑。
const newImages = new Map(); // imageIndex → Buffer
if (TEX < 1) {
  for (const [i, img] of (g.images ?? []).entries()) {
    if (img.bufferView == null) continue;
    const bv = g.bufferViews[img.bufferView];
    const raw = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    const meta = await sharp(raw).metadata();
    // 下限按边长而不是按比例：脸本来就比别的贴图小一档（Tsumire 是 1024 vs 4096），
    // 统一乘系数会把它压得最狠，而脸恰恰是特写里最经不起糊的那张。
    const w = Math.max(TEX_MIN, Math.round(meta.width * TEX));
    const h = Math.max(TEX_MIN, Math.round(meta.height * TEX));
    // **保留源格式**。一律转 PNG 会让本来就是 WebP/JPEG 的贴图不降反增——
    // 实测 NPC 的 2048² WebP 只有 99KB，转成 1024² PNG 反而涨到 172KB。
    let pipe = sharp(raw).resize(w, h, { fit: "fill" });
    if (img.mimeType === "image/webp") pipe = pipe.webp({ quality: 88, effort: 6 });
    else if (img.mimeType === "image/jpeg") pipe = pipe.jpeg({ quality: 88, mozjpeg: true });
    else pipe = pipe.png({ compressionLevel: 9, effort: 10 });
    const out = await pipe.toBuffer();
    newImages.set(i, out);
    console.log(
      `  贴图 ${img.name ?? i}: ${meta.width}×${meta.height} ${(bv.byteLength / 1024).toFixed(0)}KB` +
        ` → ${w}×${h} ${(out.length / 1024).toFixed(0)}KB`,
    );
  }
}

// ── ③ 垃圾回收 + 重建 BIN ────────────────────────────────────
// 走一遍"谁还在被引用"，把活着的 bufferView 按新顺序搬进新 BIN，然后统一重映射下标。
// 这样上面两步只管删引用，不用碰任何下标。
const usedAcc = new Set();
const useAcc = (i) => {
  if (i != null) usedAcc.add(i);
};
for (const mesh of g.meshes ?? [])
  for (const p of mesh.primitives) {
    for (const v of Object.values(p.attributes)) useAcc(v);
    useAcc(p.indices);
    for (const t of p.targets ?? []) for (const v of Object.values(t)) useAcc(v);
  }
for (const s of g.skins ?? []) useAcc(s.inverseBindMatrices);
for (const a of g.animations ?? [])
  for (const s of a.samplers) {
    useAcc(s.input);
    useAcc(s.output);
  }

const usedBv = new Set();
for (const i of usedAcc) {
  const a = g.accessors[i];
  if (a.bufferView != null) usedBv.add(a.bufferView);
  if (a.sparse) {
    usedBv.add(a.sparse.indices.bufferView);
    usedBv.add(a.sparse.values.bufferView);
  }
}
for (const img of g.images ?? []) if (img.bufferView != null) usedBv.add(img.bufferView);

const bvOrder = [...usedBv].sort((a, b) => a - b);
const bvMap = new Map();
const chunks = [];
let cursor = 0;
for (const old of bvOrder) {
  const bv = g.bufferViews[old];
  const imgIdx = (g.images ?? []).findIndex((im) => im.bufferView === old);
  const data =
    imgIdx >= 0 && newImages.has(imgIdx)
      ? newImages.get(imgIdx)
      : bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  // 顶点/索引 bufferView 必须 4 字节对齐（访问器的 componentType 最大 4 字节）
  const pad = (4 - (cursor % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad, 0));
    cursor += pad;
  }
  bvMap.set(old, { index: bvMap.size, byteOffset: cursor, byteLength: data.length });
  chunks.push(data);
  cursor += data.length;
}

const newBv = bvOrder.map((old) => {
  const src = g.bufferViews[old];
  const m = bvMap.get(old);
  const out = { buffer: 0, byteOffset: m.byteOffset, byteLength: m.byteLength };
  // byteStride 只对顶点属性有意义；图片 bufferView 带 stride 会被校验器判错
  if (src.byteStride != null) out.byteStride = src.byteStride;
  if (src.target != null) out.target = src.target;
  if (src.extensions) out.extensions = src.extensions;
  return out;
});

const remap = (i) => bvMap.get(i).index;
// 访问器也要一并回收：裁掉形键后有大批访问器无人引用，留着它们会指向已经不存在的
// bufferView 下标——不是"多占点体积"而是**越界引用**，加载器读到什么全看运气。
const accOrder = [...usedAcc].sort((a, b) => a - b);
const accMap = new Map(accOrder.map((old, i) => [old, i]));
const newAcc = accOrder.map((old) => {
  const a = g.accessors[old];
  if (a.bufferView != null) a.bufferView = remap(a.bufferView);
  if (a.sparse) {
    a.sparse.indices.bufferView = remap(a.sparse.indices.bufferView);
    a.sparse.values.bufferView = remap(a.sparse.values.bufferView);
  }
  return a;
});
const ra = (i) => accMap.get(i);
for (const mesh of g.meshes ?? [])
  for (const p of mesh.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = ra(p.attributes[k]);
    if (p.indices != null) p.indices = ra(p.indices);
    for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] = ra(t[k]);
  }
for (const s of g.skins ?? []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = ra(s.inverseBindMatrices);
for (const an of g.animations ?? [])
  for (const s of an.samplers) {
    s.input = ra(s.input);
    s.output = ra(s.output);
  }
for (const img of g.images ?? []) if (img.bufferView != null) img.bufferView = remap(img.bufferView);

g.accessors = newAcc;
g.bufferViews = newBv;
const newBin = Buffer.concat(chunks);
g.buffers = [{ byteLength: newBin.length }];

fs.mkdirSync(path.dirname(path.resolve(DST)), { recursive: true });
writeGlb(DST, g, newBin);
const dstSize = fs.statSync(DST).size;
console.log(
  `\n${path.basename(SRC)} ${(srcSize / 1048576).toFixed(2)}MB → ${path.basename(DST)} ` +
    `${(dstSize / 1048576).toFixed(2)}MB（省 ${(100 - (dstSize / srcSize) * 100).toFixed(0)}%）` +
    (droppedMorphs ? ` · 裁掉 ${droppedMorphs} 个形键` : ""),
);
