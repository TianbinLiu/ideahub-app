// 相机穿模淡出：镜头贴近/穿过模型时，把靠近相机的部分逐像素抖动淡出（Bayer 网点
// discard）。比 opacity 透明的优势：不改渲染队列、无透明排序伪影、逐片元生效——
// 只有"离镜头近的那部分"消失，远处的部分照常渲染（穿头时后脑勺还在）。
import * as THREE from "three";

const BAYER_GLSL = `
float _cfBayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float _cfBayer4(vec2 a){ return _cfBayer2(0.5 * a) * 0.25 + _cfBayer2(a); }
`;

/**
 * 给 root 下所有网格材质注入"近相机淡出"。
 * @param near 视距 ≤ near 完全消失（世界单位）
 * @param far  视距 ≥ far 完全不受影响；near→far 之间网点渐隐
 */
export function applyCameraFade(root: THREE.Object3D, near = 0.32, far = 0.85): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || (m as unknown as Record<string, unknown>).__camFade) continue;
      (m as unknown as Record<string, unknown>).__camFade = true;
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
            `void main() {
  {
    float cfF = smoothstep(${near.toFixed(3)}, ${far.toFixed(3)}, vCamFadeDist);
    if (cfF < 0.999 && cfF < _cfBayer4(gl_FragCoord.xy)) discard;
  }`,
          );
      };
      // 注入改变了着色器源码：必须给独立的程序缓存键，否则与未注入的同类材质共享程序
      const prevKey = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () => `${prevKey?.() ?? ""}|camfade:${near}:${far}`;
      m.needsUpdate = true;
    }
  });
}
