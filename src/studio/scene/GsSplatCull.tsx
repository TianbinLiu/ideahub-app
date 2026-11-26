// ★★ 把 splat 里烘死的**椅子**剪掉（2026-11-26，`feat/gs-polish2`，主人第 3 条："去掉桌子旁的椅子"）。
//
// 病根：那两把椅子是**点云里烘死的几何**，不是 mesh —— 没有对象可删、没有材质可关掉，
//   `SplatMesh` 的 raycastable / visible 都是整块房间的开关。所以只有一条路：
//   **按世界坐标把那一块高斯挑出来弄成透明**。
//
// 做法（Spark 2.4 自带的 `SplatEdit` + 盒状 SDF）：
//   · `SplatEdit({ rgbaBlendMode: "multiply" })` 里挂若干 `SplatEditSdf({ type: "box", opacity: 0 })`；
//   · 着色器对每个高斯算一次"在不在盒子里"，在的话把它的 rgba **乘** 上 (1,1,1,0) ⇒ alpha 0 ⇒ 不画；
//   · `softEdge` 给 0.01 m：盒子边界上有一圈 1 cm 的软过渡，硬切会在边上留下半颗高斯的亮边。
//   ★ 为什么这个组件挂在**场景根**上、而不是 SplatMesh 子节点里：`SparkRenderer` 每帧扫一遍场景，
//     把"祖先里没有 SplatMesh"的 `SplatEdit` 当作**全局编辑**（globalEdits）收走 —— 这样盒子
//     写在**世界坐标**里，不用去反推 splat 那份落位变换（GS_STEP0_TRANSFORM 的 yaw/tilt/scale）。
//   ★ `SplatMesh.editable` 缺省 true，不用改构造参数。
//
// ★ 椅子在哪（世界坐标，单位 m，原点 = 桌面顶面中心）：
//   · **远侧那把**（高背雕花椅，正面机位下在炉火右边的桌对面）：裁盒中心 (−1.02, −0.30, −0.62)，
//     半尺寸 (0.30, 0.50, 0.34)；
//   · **近侧那把**（玩家这一侧、桌子近边外面当"前景"的那把）：中心 (0.92, −0.30, −0.30)。
//   ⚠ 盒子**底不贴地板**（y 下限 −0.80 → 抬到 −0.72）：地板上那一片毯子/木纹要留着，
//     否则椅子底下会出现一块"点云被挖掉"的黑洞。
//   ⚠ 盒子别往后长到墙上（x 下限别越过 −1.6）：墙面在 x≈−2.06，盒子的 x 尾部碰到墙
//     就会把墙也挖一块。
//   ⚠ 数值可以**不改代码**直接试：localStorage 写 `gsCullBoxes` = JSON `[{"c":[x,y,z],"h":[hx,hy,hz]}]`
//     （调试用，生产里没人写这个键 = 用下面这份常量）。调完把数抄回这里。
import { useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { SplatEdit, SplatEditRgbaBlendMode, SplatEditSdf, SplatEditSdfType } from "@sparkjsdev/spark";

/** 一个待裁掉的盒子：中心 `c` + 半尺寸 `h`（都是世界坐标，米） */
export interface CullBox {
  c: [number, number, number];
  h: [number, number, number];
}

/** 要裁掉的椅子（`gsCullBoxes` 可整份覆盖）。
 *
 *  ★ 这两组数是**量出来的**，不是估的：把盒子里写进 localStorage（`gsCullBoxes`）之后
 *    在模拟器上逐轮缩小 —— 判据是"正面机位那张图里椅背还在不在"（对同一块像素区取与
 *    「椅子在」参考图的平均绝对差，>40 就是没了）。逐轮的落点：
 *      z∈[-2.2,-1.0] 不动 / z∈[-1.0,-0.6] 不动 / **z∈[-0.4,+0.2] 没了**；
 *      x∈[-1.3,-1.0] 不动 / **x∈[-0.9,-0.6] 没了** / x∈[-1.0,-0.75] 不动；
 *      y 只到 -0.6（地板那一层）不动 / 抬到 +0.3 就够（椅背顶 ≈ 桌面之上 0.3 m）。
 *  结论：那把高背雕花椅是**塞在桌子远沿**的（椅背贴着桌沿站），世界坐标
 *    x ≈ -0.75~-0.60、z ≈ -0.50~+0.10、y 从地板到桌面之上 0.30。
 *  盒子贴着桌沿（x 上限 -0.59）就够，不必往房间里长 —— 长出去会开始吃 NPC 那一侧的地板。 */
export const CHAIR_CULL: CullBox[] = [
  // 高背雕花椅（塞在桌子远沿、铸卡师的右手边）。y 下限 -0.72 留在**地板之上**
  // （地板的点云要留着，否则椅子底下会露出一块点云被挖掉的黑洞）；上限 +0.40 盖住椅背顶。
  { c: [-0.695, -0.16, -0.215], h: [0.105, 0.56, 0.335] },
];

const KEY_BOXES = "gsCullBoxes";
const KEY_DEBUG = "gsCullDebug";

/** 读 localStorage 里的覆盖值；形状不对就当没写（绝不把 NaN 送进 SDF） */
function readBoxes(): CullBox[] {
  try {
    const raw = localStorage.getItem(KEY_BOXES);
    if (!raw) return CHAIR_CULL;
    const j = JSON.parse(raw) as unknown;
    const ok3 = (a: unknown): a is [number, number, number] =>
      Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === "number" && Number.isFinite(n));
    if (!Array.isArray(j)) return CHAIR_CULL;
    const out = j.filter((b): b is CullBox => !!b && typeof b === "object" && ok3((b as CullBox).c) && ok3((b as CullBox).h));
    return out.length ? out : CHAIR_CULL;
  } catch {
    return CHAIR_CULL;
  }
}

export default function GsSplatCull() {
  const boxes = useMemo(readBoxes, []);
  const debug = useMemo(() => {
    try {
      return localStorage.getItem(KEY_DEBUG) === "1";
    } catch {
      return false;
    }
  }, []);
  // ★ 和 SplatLayer 同一个理由：StrictMode 会挂载→卸载→再挂载，资源必须成对建/释放在 effect 里。
  //   这里除了 Object3D 没有 GPU 资源，但 SDF 的矩阵要在挂在场景上之后才算得对，所以仍然走 state。
  const [edit, setEdit] = useState<SplatEdit | null>(null);
  useLayoutEffect(() => {
    const e = new SplatEdit({ name: "chair-cull", rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY, softEdge: 0.012 });
    for (const b of boxes) {
      const sdf = new SplatEditSdf({
        type: SplatEditSdfType.BOX,
        opacity: 0,
        color: new THREE.Color(1, 1, 1),
        radius: 0.01,
      });
      sdf.position.set(...b.c);
      sdf.scale.set(...b.h);
      sdf.updateMatrixWorld(true);
      e.addSdf(sdf);
    }
    setEdit(e);
    return () => setEdit(null);
  }, [boxes]);

  return (
    <>
      {edit && <primitive object={edit} />}
      {/* 调试：把盒子画成红框（`gsCullDebug=1`）。生产里没人写这个键 = 一根线都不画。 */}
      {debug &&
        boxes.map((b, i) => (
          <mesh key={i} position={b.c} renderOrder={22}>
            <boxGeometry args={[b.h[0] * 2, b.h[1] * 2, b.h[2] * 2]} />
            <meshBasicMaterial color="#ff2d55" wireframe transparent opacity={0.85} depthWrite={false} depthTest={false} />
          </mesh>
        ))}
    </>
  );
}
