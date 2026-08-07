// VRChat 角色（BOOTH 购入的 FBX + 散装贴图）→ 工坊可用的玩家形象 GLB。
//
// 用法（仓库根目录）：
//   npm i --no-save fbx2gltf
//   node design/convert-vrc-avatar.mjs <解压后的模型目录> <输出.glb>
// 例：node design/convert-vrc-avatar.mjs D:/dl/Tsumire_ver1.30 design/out/tsumire-player.glb
//
// 做三件事，每一件都是踩出来的：
//  ① FBX→GLB（fbx2gltf）
//  ② 贴回贴图：VRChat 的 FBX 里材质是**不带贴图的 Phong 空壳**，贴图绑定在
//     unitypackage 的 Unity 材质里（lilToon/Poiyomi）。转出来 9 个材质会全指向同一张
//     1×1 白图，必须按 mesh 语义手工映射 PNG。
//  ③ 骨骼改名成 mixamo 规范：仓库约定所有玩家模型都用 mixamo 骨名
//     （rin/gratia 那两个 MMD 档也是转换时改过名的），这样 PlayerArms.tsx 的
//     BONES 表可以保持模块级常量，新模型直接落进现有取骨路径。
//
// ⚠️ 已知未解决：fbx2gltf 输出的 mesh 节点带 scale=100（FBX 厘米单位）而骨架是米制。
// 绑定姿势下看不出来（静态预览完全正常），但一旦摆姿势或跑弹簧骨，蒙皮位移会被
// 放大 100 倍、角色炸成一团。glTF 规范要求忽略蒙皮网格的节点变换、three.js 靠
// bindMatrix/bindMatrixInverse 抵消，这个 100× 打破了抵消。
// 修法是把 100× 烘进几何（POSITION ×100、节点 scale 置 1、inverseBindMatrices 同步
// 折算），或者在 Blender 里 Apply Scale 后重导——本脚本尚未实现，见 README-tsumire.md。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const [, , SRC_DIR, OUT] = process.argv;
if (!SRC_DIR || !OUT) {
  console.error("用法: node design/convert-vrc-avatar.mjs <模型目录> <输出.glb>");
  process.exit(1);
}

// ── ① FBX → GLB ────────────────────────────────────────────────
function findFbx(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFbx(p);
      if (hit) return hit;
    } else if (e.name.toLowerCase().endsWith(".fbx")) return p;
  }
  return null;
}
const fbx = findFbx(SRC_DIR);
if (!fbx) {
  console.error("目录里没找到 .fbx");
  process.exit(1);
}
console.log("① FBX→GLB:", fbx);
const tmp = OUT.replace(/\.glb$/, "-raw.glb");
const convert = (await import("fbx2gltf")).default;
await convert(fbx, tmp, ["--binary", "--pbr-metallic-roughness"]);

// ── ② 贴回贴图 ─────────────────────────────────────────────────
// 材质→贴图的映射按 mesh 语义定；换模型时改这里
const MAP = {
  "マテリアル.002": "tex_hair.png",
  h: "tex_hair.png",
  "costume.001": "tex_Costume.png",
  "マテリアル.004": "tex_body.png",
  "マテリアル.006": "tex_face.png",
  "マテリアル.005": "tex_face.png",
  "マテリアル.008": "tex_face.png",
  "マテリアル.014": "tex_face.png",
};
// 发丝/睫毛这类"靠贴图切形状"的面片必须开 alpha 裁切，否则整片实心糊成一坨
const ALPHA_MASK = new Set(Object.keys(MAP).filter((k) => MAP[k] !== "tex_Costume.png"));

function findTexDir(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (existsSync(join(p, "tex_body.png"))) return p;
      const hit = findTexDir(p);
      if (hit) return hit;
    }
  }
  return null;
}
const TEX = findTexDir(SRC_DIR);
if (!TEX) {
  console.error("找不到贴图目录（应含 tex_body.png）");
  process.exit(1);
}

function readGlb(p) {
  const buf = readFileSync(p);
  const jsonLen = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8")), bin: buf.slice(20 + jsonLen) };
}
function writeGlb(p, json, bin) {
  const j = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (j.length % 4)) % 4;
  const jp = Buffer.concat([j, Buffer.alloc(pad, 0x20)]);
  const h = Buffer.alloc(12);
  h.write("glTF", 0, "ascii");
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(12 + 8 + jp.length + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jp.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  writeFileSync(p, Buffer.concat([h, jh, jp, bin]));
}

console.log("② 贴回贴图…");
const { json, bin } = readGlb(tmp);
const files = [...new Set(Object.values(MAP))];
json.images = files.map((f) => ({ name: f, uri: `data:image/png;base64,${readFileSync(resolve(TEX, f)).toString("base64")}` }));
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
json.textures = files.map((f, i) => ({ name: f, sampler: 0, source: i }));
for (const m of json.materials) {
  const f = MAP[m.name];
  if (!f) continue;
  m.pbrMetallicRoughness = { ...(m.pbrMetallicRoughness ?? {}), baseColorTexture: { index: files.indexOf(f), texCoord: 0 }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 };
  if (ALPHA_MASK.has(m.name)) {
    m.alphaMode = "MASK";
    m.alphaCutoff = 0.5;
  }
  m.doubleSided = true;
}

// ── ③ 骨骼改名成 mixamo ────────────────────────────────────────
const RENAME = {
  Hips: "mixamorig:Hips", Spine: "mixamorig:Spine", Chest: "mixamorig:Spine1",
  Neck: "mixamorig:Neck", head: "mixamorig:Head",
  "Shoulder.L": "mixamorig:LeftShoulder", "upper_arm.L": "mixamorig:LeftArm",
  "lower_arm.L": "mixamorig:LeftForeArm", "hand.L": "mixamorig:LeftHand",
  "Shoulder.R": "mixamorig:RightShoulder", "upper_arm.R": "mixamorig:RightArm",
  "lower_arm.R": "mixamorig:RightForeArm", "hand.R": "mixamorig:RightHand",
  "upper_leg.L": "mixamorig:LeftUpLeg", "lower_leg.L": "mixamorig:LeftLeg",
  "foot.L": "mixamorig:LeftFoot", "toe.L": "mixamorig:LeftToeBase",
  "upper_leg.R": "mixamorig:RightUpLeg", "lower_leg.R": "mixamorig:RightLeg",
  "foot.R": "mixamorig:RightFoot", "toe.R": "mixamorig:RightToeBase",
};
console.log("③ 骨骼改名…");
let renamed = 0;
for (const n of json.nodes) if (RENAME[n.name]) (n.name = RENAME[n.name]), renamed++;

writeGlb(OUT, json, bin);
console.log(`完成：贴图 ${files.length} 张 / 改名 ${renamed} 根骨 → ${OUT}`);
console.log("⚠️ 记得处理 mesh 节点 scale=100 的单位问题（见文件头注释），否则一摆姿势就炸。");
