// 穿行尽头那张背景的挂载点（2026-11-27，`feat/gs-tunnel-depth`）。
//
// 只做四件事：载两张贴图（各 <60 KB）、按当前皮肤挑一张、按画布 aspect 算平面尺寸、
// 每帧把 `FLY_U.backdrop` 写进材质。几何 / 材质 / 摆法全在 `flyBackdrop.ts`。
//
// ★ 为什么贴在 `WindowLook` 的子树里而不是单独懒加载：贴图 90 KB、一个 mesh、一个 draw call
//   （还只在转场里可见），把它拆成 lazy 反而多一次 chunk 往返；spark 的 16 MB 才是懒加载的边界。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BACKDROP, backdropPose, backdropSize, driveBackdrop, makeBackdropMaterial, type BackdropSkin } from "./flyBackdrop";

interface Props {
  /** 这一轮穿行是哪一档（夜 = 月亮 / 昼 = 云海） */
  skin: BackdropSkin;
}

export default function BackdropPlane({ skin }: Props) {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const pose = useMemo(() => backdropPose(skin), [skin]);
  const size = useMemo(() => backdropSize(aspect, skin), [aspect, skin]);
  const meshRef = useRef<THREE.Mesh>(null);

  // 两张贴图都载（各 <60 KB）：大厅里跨 19:00 / 07:00 换档时不必等第二张。
  const [tex, setTex] = useState<Record<BackdropSkin, THREE.Texture | null>>({ night: null, day: null });
  useLayoutEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const load = (url: string) =>
      new Promise<THREE.Texture | null>((resolve) =>
        loader.load(
          url,
          (t) => {
            t.colorSpace = THREE.SRGBColorSpace;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.magFilter = THREE.LinearFilter;
            t.anisotropy = 4;
            // cover 取样会采到 [0,1] 之外：夹边（边缘已经是雾色，不会露出重复的星）
            t.wrapS = THREE.ClampToEdgeWrapping;
            t.wrapT = THREE.ClampToEdgeWrapping;
            t.needsUpdate = true;
            resolve(t);
          },
          undefined,
          () => resolve(null), // 贴图缺了（被裁过的包）：这一层不画，穿行照旧由点云廊收尾
        ),
      );
    Promise.all([load(BACKDROP.tex.night), load(BACKDROP.tex.day)]).then(([n, d]) => {
      if (!alive) {
        n?.dispose();
        d?.dispose();
        return;
      }
      setTex({ night: n, day: d });
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(
    () => () => {
      tex.night?.dispose();
      tex.day?.dispose();
    },
    [tex],
  );

  const mat = useMemo(
    () => (tex[skin] ? makeBackdropMaterial(tex[skin]!, skin, aspect) : null),
    [tex, skin, aspect],
  );
  useEffect(() => () => mat?.dispose(), [mat]);

  useFrame(() => {
    driveBackdrop(mat, meshRef.current);
  });

  if (!mat) return null;
  return (
    <mesh
      ref={meshRef}
      position={pose.position}
      quaternion={pose.quaternion}
      // 必须在 Spark 的 splat pass（0）之前画：先铺"远处的画"，点云再叠上去
      renderOrder={-10}
      visible={false}
      frustumCulled={false}
      material={mat}
    >
      <planeGeometry args={[size.width, size.height]} />
    </mesh>
  );
}

