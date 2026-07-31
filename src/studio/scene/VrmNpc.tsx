// VRM 铸卡师：VRoid Studio 导出的真人形模型（card-forger.vrm），替换程序化剪影。
// 姿态：双臂自然放下、左前臂抬起（对应胸前持卡位）、躯干慵懒前倾；周期眨眼 + 浅笑。
import { useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { useStudio } from "../studioStore";

export default function VrmNpc() {
  const gltf = useLoader(GLTFLoader, "/models/npc/card-forger.vrm", (loader) => {
    (loader as GLTFLoader).register((parser) => new VRMLoaderPlugin(parser));
  });
  const vrm = (gltf as unknown as { userData: { vrm: VRM } }).userData.vrm;

  useMemo(() => {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
    });
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
    // 表情：浅笑 + 周期眨眼
    const em = vrm.expressionManager;
    if (em) {
      em.setValue("happy", 0.35);
      em.setValue("relaxed", 0.4);
      const cycle = t % 4.3;
      em.setValue("blink", cycle > 4.0 ? Math.sin(((cycle - 4.0) / 0.3) * Math.PI) : 0);
    }
    vrm.update(dt);
  });

  // VRoid 尺度为米（身高 1.65）；场景是巨桌尺度 → 放大 2.6，脚踩地面、胸口贴桌沿
  return <primitive object={vrm.scene} position={[0, -2.55, -3.78]} scale={2.6} />;
}
