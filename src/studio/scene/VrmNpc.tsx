// VRM 铸卡师：VRoid Studio 导出的真人形模型（card-forger.vrm），替换程序化剪影。
// 引擎侧补设定（VRoid 内做不了的部分）：裙子贴图重着色为深绿+金边、程序化松垮女巫帽
// 挂 head 骨（塌向角色右眼侧）、左眼下泪痣；姿态慵懒前倾 + 半眯眼 + 周期眨眼。
import { useMemo } from "react";
import * as THREE from "three";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { useStudio } from "../studioStore";

const GREEN = [18, 60, 42]; // #123C2A 深绿毡
const GOLD = [214, 178, 106]; // #D6B26A 金滚边

// 黑裙贴图 → 深绿；高亮部（白领口/袖口/扣线）→ 金。按亮度分段映射，保留原有明暗。
function recolorClothMaterial(mat: THREE.Material) {
  if (mat.userData.__recolored) return;
  const m = mat as THREE.Material & {
    map?: THREE.Texture | null;
    shadeMultiplyTexture?: THREE.Texture | null;
    shadeColorFactor?: THREE.Color;
  };
  const src = m.map?.image as CanvasImageSource & { width: number; height: number };
  if (!src || !src.width) return;
  const cv = document.createElement("canvas");
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 765;
    if (lum > 0.62) {
      const s = 0.72 + lum * 0.28;
      d[i] = GOLD[0] * s;
      d[i + 1] = GOLD[1] * s;
      d[i + 2] = GOLD[2] * s;
    } else {
      const s = 0.55 + lum * 1.7;
      d[i] = Math.min(255, GREEN[0] * s);
      d[i + 1] = Math.min(255, GREEN[1] * s);
      d[i + 2] = Math.min(255, GREEN[2] * s);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = m.map!.flipY;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = m.map!.wrapS;
  tex.wrapT = m.map!.wrapT;
  m.map = tex;
  if (m.shadeMultiplyTexture !== undefined) m.shadeMultiplyTexture = tex;
  if (m.shadeColorFactor) m.shadeColorFactor.setRGB(0.5, 0.58, 0.52);
  mat.userData.__recolored = true;
  mat.needsUpdate = true;
}

// 松垮女巫帽：下垂碟形帽檐 + 弯折塌陷帽冠 + 皮革帽带/黄铜方扣（按设定 35° 塌向角色右侧）
function buildWitchHat(): THREE.Group {
  const g = new THREE.Group();
  g.name = "witch-hat";
  const felt = new THREE.MeshStandardMaterial({ color: 0x123c2a, roughness: 0.92, metalness: 0.05 });
  const feltDark = new THREE.MeshStandardMaterial({
    color: 0x0b2a1d,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const goldM = new THREE.MeshStandardMaterial({ color: 0xd6b26a, roughness: 0.35, metalness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x46311f, roughness: 0.85 });

  const brimPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    brimPts.push(new THREE.Vector2(0.055 + t * 0.1, -0.038 * Math.pow(t, 1.7)));
  }
  const brimGeo = new THREE.LatheGeometry(brimPts, 48);
  {
    // 松垮塌陷：-X（角色右）侧帽檐大幅下垂，盖过右眼
    const bp = brimGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      if (x < -0.05) bp.setY(i, bp.getY(i) - (-x - 0.05) * 0.9);
    }
    brimGeo.computeVertexNormals();
  }
  const brim = new THREE.Mesh(brimGeo, feltDark);
  g.add(brim);

  const crownGeo = new THREE.ConeGeometry(0.085, 0.27, 24, 14, true);
  const pos = crownGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + 0.135) / 0.27;
    pos.setX(i, pos.getX(i) + t * t * 0.14);
    pos.setY(i, pos.getY(i) - t * t * 0.075);
  }
  crownGeo.computeVertexNormals();
  const crown = new THREE.Mesh(crownGeo, felt);
  crown.position.y = 0.12;
  g.add(crown);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.092, 0.028, 24, 1, true), leather);
  band.position.y = 0.014;
  g.add(band);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.008), goldM);
  buckle.position.set(0.02, 0.014, 0.085);
  g.add(buckle);
  return g;
}

export default function VrmNpc() {
  const gltf = useLoader(GLTFLoader, "/models/npc/card-forger.vrm", (loader) => {
    (loader as GLTFLoader).register((parser) => new VRMLoaderPlugin(parser));
  });
  const vrm = (gltf as unknown as { userData: { vrm: VRM } }).userData.vrm;

  useMemo(() => {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) if (/Tops|CLOTH/i.test(mat.name)) recolorClothMaterial(mat);
      }
    });
    const head = vrm.humanoid.getRawBoneNode("head");
    if (head && !head.getObjectByName("witch-hat")) {
      const hat = buildWitchHat();
      hat.position.set(-0.02, 0.175, -0.02);
      hat.rotation.set(-0.06, 0, 0.72); // 前檐微翘露左脸；z 正 = 塌向角色右侧（brim 压过无痣的右眼）
      head.add(hat);
      // 泪痣：角色左眼（+X 侧）下方
      const mole = new THREE.Mesh(
        new THREE.SphereGeometry(0.004, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x6e4f35 }),
      );
      mole.name = "tear-mole";
      mole.position.set(0.055, 0.047, 0.088);
      head.add(mole);
    }
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__vrm = vrm;
  }, [gltf, vrm]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const { dialogView } = useStudio.getState();
    const h = vrm.humanoid;
    const set = (name: Parameters<typeof h.getNormalizedBoneNode>[0], x: number, y: number, z: number) => {
      const n = h.getNormalizedBoneNode(name);
      if (n) n.rotation.set(x, y, z);
    };
    // 每帧强制姿势（防止被内部重置）：慵懒对坐——手臂放下、左前臂抬起持卡、前倾
    const lean = (dialogView ? 0.26 : 0.16) + Math.sin(t * 1.1) * 0.015;
    // 骨骼朝向实测：左臂(+X) z 负=垂下；右臂(-X) z 正=垂下
    set("leftUpperArm", 0.15, 0, -1.05);
    set("leftLowerArm", -0.3, -0.15, 0);
    set("rightUpperArm", 0.12, 0, 1.25);
    set("rightLowerArm", -1.15, -0.5, 0);
    set("spine", lean, 0, 0);
    set("chest", 0.1, 0, 0);
    set("neck", -0.06, 0, 0);
    // 表情：慵懒半眯眼（blink 常驻基线）+ 浅笑 + 周期眨眼
    const em = vrm.expressionManager;
    if (em) {
      em.setValue("happy", 0.12);
      em.setValue("relaxed", 0.55);
      const cycle = t % 4.3;
      const blink = cycle > 4.0 ? Math.sin(((cycle - 4.0) / 0.3) * Math.PI) : 0;
      em.setValue("blink", Math.max(0.3, blink));
    }
    vrm.update(dt);
  });

  // VRoid 尺度为米（身高 1.65）；场景是巨桌尺度 → 放大 2.6，脚踩地面、胸口贴桌沿
  return <primitive object={vrm.scene} position={[0, -2.55, -3.78]} scale={2.6} />;
}
