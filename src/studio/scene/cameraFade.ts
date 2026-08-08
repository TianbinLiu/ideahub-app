// 相机穿模淡出：镜头贴近/穿过模型时，把靠近相机的部分逐像素抖动淡出（Bayer 网点
// discard）。比 opacity 透明的优势：不改渲染队列、无透明排序伪影、逐片元生效——
// 只有"离镜头近的那部分"消失，远处的部分照常渲染（穿头时后脑勺还在）。
//
// **皮肤与衣服分开处理**（用户反馈：镜头进到体内后还能看到对面那层皮肤的内部构造、
// 颜色乃至骨骼）。只把近处淡出解决不了这个：对面那层皮肤离镜头有半个身子远，
// 落在淡出带之外，于是它的**背面**照样实心渲染，看到的就是皮肤内侧。
//   · 皮肤（脸/身体贴图）：**永远剔除背面** + 贴身距离整体消失。
//     「内壁颜色/内部构造」的本质就是背面被画出来了——人在体内看到的是对面那层
//     皮肤的背面。光靠距离治不干净：脸离镜头 1.0~1.2 时衣服已在网点化、脸却还实心
//     （实测截图就是这个组合，最难看）。单面渲染让"从内侧看皮肤"这件事从根上不成立，
//     而且对正常观看零影响（外面看到的本来就是正面）。
//   · 衣服 / 头发：保留双面 + 按距离网点半透明——用户要的"只看到半透明的衣服"
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

/** 皮肤背面剔除。**独立于网点淡出**，因为它不注入着色器、没有"整屏结网"的风险：
 *  玩家模型走的是硬剔除自遮挡（applySelfCull）而非 applyCameraFade，但同样需要这个。
 *  描边反壳本身就是 BackSide 的，必须放过——否则轮廓线整条消失。 */
export function cullSkinBackfaces(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.__isOutline) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m && isSkinMaterial(m) && m.side !== THREE.FrontSide) {
        m.side = THREE.FrontSide;
        n++;
      }
    }
  });
  return n;
}

// 淡出带必须**贴着穿模发生的那一刻**，不能提前。老参数是 0.55~1.45，而 NPC 轨道
// 的最小半径就是 1.2、此时最近的几何（裙子 0.70 / 前发 0.87）全落在带内——结果
// "凑近看一眼"就把头发和衣服打成筛子，透出后面实心的皮肤，正是用户看到的那一屏
// 网点。实测各部位到相机距离：脸 0.94/1.07、身体 0.55、裙子 0.70、前发 0.87。
// 收到 0.08~0.42 后，radius=1.2 的正常特写整屏零抖动，只有真的怼进去才起效。
export function applyCameraFade(
  root: THREE.Object3D,
  near = 0.08,
  far = 0.42,
  skinCut = 0.3,
  clothFloor = 0.24,
): void {
  // DEV 热改：window.__camFade = { near, far, skinCut, clothFloor } 可整体覆盖
  //（调虚化强度必须看画面，而这些值是编译进 GLSL 的常量，改一次要重编译，
  // 不做钩子就只能反复重载）
  if (import.meta.env.DEV) {
    const ov = (window as unknown as Record<string, unknown>).__camFade as
      | { near?: number; far?: number; skinCut?: number; clothFloor?: number }
      | undefined;
    if (ov) {
      near = ov.near ?? near;
      far = ov.far ?? far;
      skinCut = ov.skinCut ?? skinCut;
      clothFloor = ov.clothFloor ?? clothFloor;
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
      if (skin && !mesh.userData.__isOutline) m.side = THREE.FrontSide; // 见 cullSkinBackfaces
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
              ? // 皮肤：比衣服**更早**开始淡出、并且淡到全无（背面已由单面渲染剔掉，
                // 这里管的是正面）。更早很关键——衣服半透时它后面的皮肤必须已经没了，
                // 否则就是"透过纱一样的裙子看到实心的肉"。硬阈值会在临界距离上"啪"地
                // 整块消失，所以给一段 0.30 的斜坡过渡。
                `void main() {
  {
    float cfS = smoothstep(${skinCut.toFixed(3)}, ${(skinCut + 0.3).toFixed(3)}, vCamFadeDist);
    if (cfS < 0.999 && cfS < _cfBayer4(gl_FragCoord.xy)) discard;
  }`
              : // 衣服/头发：按距离网点半透明，但**留一个不透明度下限**。
                // 不留下限时镜头进到体内衣服会被抽干到几乎全透（实测只剩砖墙），
                // 而用户要的是"只能看到半透明的衣服"——衣服得还在，只是透。
                `void main() {
  {
    float cfF = max(${clothFloor.toFixed(3)}, smoothstep(${near.toFixed(3)}, ${far.toFixed(3)}, vCamFadeDist));
    if (cfF < 0.999 && cfF < _cfBayer4(gl_FragCoord.xy)) discard;
  }`,
          );
      };
      // 注入改变了着色器源码：必须给独立的程序缓存键，否则与未注入的同类材质共享程序
      const prevKey = m.customProgramCacheKey?.bind(m);
      m.customProgramCacheKey = () =>
        `${prevKey?.() ?? ""}|camfade:${near}:${far}:${skin ? "s" + skinCut : "c" + clothFloor}`;
      m.needsUpdate = true;
    }
  });
}
