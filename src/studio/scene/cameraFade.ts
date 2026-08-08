// 相机穿模淡出：镜头贴近/穿过模型时，把靠近相机的部分逐像素抖动淡出（Bayer 网点
// discard）。比 opacity 透明的优势：不改渲染队列、无透明排序伪影、逐片元生效——
// 只有"离镜头近的那部分"消失，远处的部分照常渲染（穿头时后脑勺还在）。
//
// **皮肤与衣服分开处理**（用户反馈：镜头进到体内后还能看到对面那层皮肤的内部构造、
// 颜色乃至骨骼）。只把近处淡出解决不了这个：对面那层皮肤离镜头有半个身子远，
// 落在淡出带之外，于是它的**背面**照样实心渲染，看到的就是皮肤内侧。
//   · 皮肤（脸/身体贴图）：镜头一旦贴近就**整体硬剔除**，不留任何内构造
//   · 衣服 / 头发：保留但按距离网点半透明——用户要的"只看到半透明的衣服"
import * as THREE from "three";

const BAYER_GLSL = `
float _cfBayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float _cfBayer4(vec2 a){ return _cfBayer2(0.5 * a) * 0.25 + _cfBayer2(a); }
`;

/** 按 baseColor 贴图名判定是不是皮肤。两个角色都能干净分类：
 *  NPC = Milltina_Face / Milltina_Body，玩家 = tex_face / tex_body；
 *  衣服是 *Costume*、头发是 *Hair*，都不匹配。 */
const SKIN_TEX = /(^|_)(face|body)($|_|\.)/i;

export function isSkinMaterial(m: THREE.Material): boolean {
  const name = ((m as THREE.MeshStandardMaterial).map?.name ?? "").toLowerCase();
  return SKIN_TEX.test(name);
}

export function applyCameraFade(root: THREE.Object3D, near = 0.55, far = 1.45, skinCut = 0.95): void {
  // DEV 热改：window.__camFade = { near, far } 可整体覆盖（调虚化强度必须看画面，
  // 而 near/far 是编译进 GLSL 常量的，改一次要重编译，不做钩子就只能反复重载）
  if (import.meta.env.DEV) {
    const ov = (window as unknown as Record<string, unknown>).__camFade as { near?: number; far?: number } | undefined;
    if (ov) {
      near = ov.near ?? near;
      far = ov.far ?? far;
    }
  }
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || (m as unknown as Record<string, unknown>).__camFade) continue;
      (m as unknown as Record<string, unknown>).__camFade = true;
      const skin = isSkinMaterial(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader, renderer) => {
        prev?.call(m, shader, renderer);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying float vCamFadeDist;")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvCamFadeDist = -mvPosition.z;");
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", `#include <common>\nvarying float vCamFadeDist;\n${BAYER_GLSL}`)
          .replace(
            "void main() {",
            skin
              ? // 皮肤：贴身距离内整体消失。硬剔除而不是网点——网点会留下半透明的
                // 皮肤内侧，用户明确不要看到那个
                `void main() {
  if (vCamFadeDist < ${skinCut.toFixed(3)}) discard;`
              : // 衣服/头发：按距离网点半透明
                `void main() {
  {
    float cfF = smoothstep(${near.toFixed(3)}, ${far.toFixed(3)}, vCamFadeDist);
    if (cfF < 0.999 && cfF < _cfBayer4(gl_FragCoord.xy)) discard;
  }`,
          );
      };
      // 注入改变了着色器源码：必须给独立的程序缓存键，否则与未注入的同类材质共享程序
      const prevKey = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => `${prevKey?.() ?? ""}|camfade:${near}:${far}:${skin ? "s" + skinCut : "c"}`;
      m.needsUpdate = true;
    }
  });
}
