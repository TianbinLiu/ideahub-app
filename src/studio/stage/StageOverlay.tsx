// 导演台（2026-09-06，对标 LibTV 导演台 / updream 预演台）：摆人偶站位、拧机位，截一张构图示意图，
// 经融图（人物卡 / 场景卡）成为这一段的**开头帧**。工坊投影窗与工作流画布共用这一份（各自用本地 state 开关）。
//
// ★ 自己一个 <Canvas>，不碰 TableScene：桌面那台相机是演出用的（focusCam / 飞行），导演台的相机是导演手里的，
//   两套混在一个场景里会互相抢。短命浮层，frameloop 用默认的 always。
// ★ 截图要 preserveDrawingBuffer：不开的话 toDataURL 拿到的是一张黑图（WebGL 默认交换后清空）。
// ★ 人偶用自产的 player-f（quality.playerModelUrl("f")，普通 .glb，不涉第三方模型）；每个人偶 SkeletonUtils.clone
//   （蒙皮网格直接 clone 会共用骨架，两个人偶一起动）；材质整体换成灰白 —— 它就是"白模"。
// ★ 手势：点地面 = 把选中人偶挪过去（或"加人偶"模式下放一个新的）；在空处拖 = 环绕机位；两指 = 拉远拉近。
//   移动端一律 touch-action:none，否则竖向拖会被浏览器接管成页面滚动（RoleCastBoard 那条坑）。
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trans, useLingui } from "@lingui/react/macro";
import * as THREE from "three";
import { Canvas, ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { AI_REAL } from "../../ai";
import { CloseButton } from "../../components/IconTapButton";
import { ONE_IMAGE, fmtTokens } from "../../data/economy";
import { aspectOf, uid } from "../../types";
import { useFlow } from "../flowStore";
import { playerModelUrl } from "../quality";
import { loaderFor } from "../secureAssets";
import {
  FIGURE_HEIGHT,
  PITCH_PRESETS,
  SHOT_PRESETS,
  STAGE_LIMITS,
  STAGE_LOOK,
  StageState,
  camPosition,
  clampCam,
  defaultStage,
} from "./stageState";

// ★ 舞台配色是"浅灰影棚里的中灰泥偶"，不是深色 UI：第一、二发实测深色底 + 网格的截图被 Seedream 认成"手机截图"，
//   整张开头帧被画进了一只手机的屏幕里（real.fuseStageFrame 的 ★★）。浅底、淡网格、中灰人偶读起来才像一张 3D 草图。
const GREY = new THREE.MeshStandardMaterial({ color: "#9aa0a8", roughness: 0.85, metalness: 0 });
const GOLD = new THREE.MeshStandardMaterial({ color: "#f0b429", roughness: 0.7, metalness: 0 });
const STAGE_BG = "#e9eaee";
const FLOOR = "#d3d6dc";
const GRID = ["#b9bdc6", "#c8ccd3"] as const;

/** 一个人偶：自产模型的灰白克隆，归一到 FIGURE_HEIGHT 米高。选中的那个上金色 */
function Figure({ url, x, z, rotY, scale, selected, onPick }: { url: string; x: number; z: number; rotY: number; scale: number; selected: boolean; onPick: () => void }) {
  const gltf = useLoader(loaderFor(url), url, (loader) => {
    (loader as GLTFLoader).setMeshoptDecoder(MeshoptDecoder);
  });
  const { object, unit } = useMemo(() => {
    const obj = skeletonClone(gltf.scene) as THREE.Object3D;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = GREY;
        m.castShadow = false;
      }
    });
    // ★ 量身高不能直接 Box3.setFromObject：蒙皮网格的 computeBoundingBox 按骨骼矩阵算，而克隆出来还没渲染过、
    //   骨架一次都没 update —— 第一版量出 20.4 单位、实际画出来只有 9.6 单位（人偶被缩成 0.8 米，脚还在地板下面）。
    //   先把世界矩阵与骨架都算一遍，再逐个网格取**它自己**的包围盒并上去。
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    obj.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      if (m.isSkinnedMesh) {
        m.skeleton.update();
        m.computeBoundingBox();
        tmp.copy(m.boundingBox!);
      } else {
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        tmp.copy(m.geometry.boundingBox!);
      }
      box.union(tmp.applyMatrix4(m.matrixWorld));
    });
    const h = Math.max(0.01, box.max.y - box.min.y);
    // 脚底落地：把包围盒底边挪到 0。★ 写模型自己的单位——外层 group 会把它连同 position 一起缩到 FIGURE_HEIGHT，
    //   这里再乘一次 unit 就是缩两次（第一版就这么写的）
    obj.position.y = -box.min.y;
    return { object: obj, unit: FIGURE_HEIGHT / h };
  }, [gltf]);
  useEffect(() => {
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = selected ? GOLD : GREY;
    });
  }, [object, selected]);
  return (
    <group
      position={[x, 0, z]}
      // ★ 模型正面朝 -z（实测：思考姿势的手臂伸向 -z），相机在 +z —— 补半圈，rotY=0 才是"面朝镜头"
      rotation={[0, rotY + Math.PI, 0]}
      scale={[unit * scale, unit * scale, unit * scale]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <primitive object={object} />
    </group>
  );
}

/** 相机跟着机位状态走（每帧写，不做惯性——导演台要的是"拧到哪是哪"） */
function CamRig({ cam }: { cam: StageState["cam"] }) {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const [x, y, z] = camPosition(cam);
    camera.position.set(x, y, z);
    camera.lookAt(STAGE_LOOK[0], STAGE_LOOK[1], STAGE_LOOK[2]);
  });
  return null;
}

/** 截图口：把"截当前帧"的函数交到 capRef 上。★ 先 render 一次再读，别信"上一帧还在"。
 *  ★ 写成普通的 `function` 组件而不是 forwardRef(function …)：构建门禁 check-hook-order 只认行首的
 *    `function Name(`，包在 forwardRef 里的那份会被算到上一个组件头上、误报成"hook 排在早退之后"。 */
function Capturer({ capRef }: { capRef: React.MutableRefObject<(() => string) | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    capRef.current = () => {
    // ★ 屏幕上的画布只有两三百像素宽（dpr=1 省电）；当参考图喂给 Seedream 太糊。截图那一拍临时把像素比拉到
    //   长边 ≥ 1024，画一帧、读出来、再还原（setSize 的第三参 false = 不动 CSS 尺寸，不会闪）。
    const el = gl.domElement;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const prev = gl.getPixelRatio();
    const k = Math.max(1, Math.ceil(1024 / Math.max(w, h)));
    // ★ 选中的金色只给屏幕看：截图里一律灰白。第一发实测金色人偶被 Seedream 原样画成了一个黄色塑料人（real.fuseStageFrame 的 ★★）
    const golden: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === GOLD) {
        m.material = GREY;
        golden.push(m);
      }
    });
    try {
      gl.setPixelRatio(k);
      gl.setSize(w, h, false);
      gl.render(scene, camera);
      return el.toDataURL("image/jpeg", 0.85);
    } finally {
      for (const m of golden) m.material = GOLD;
      gl.setPixelRatio(prev);
      gl.setSize(w, h, false);
    }
    };
    return () => {
      capRef.current = null;
    };
  }, [gl, scene, camera, capRef]);
  // DEV 调试挂钩（与 __flow / __studio 同款）：量相机与人偶的真实尺寸用，正式包里没有
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__stage = { gl, scene, camera };
    return () => {
      delete (window as unknown as Record<string, unknown>).__stage;
    };
  }, [gl, scene, camera]);
  return null;
}

export default function StageOverlay({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const node = useFlow((s) => s.nodes.find((n) => n.id === nodeId));
  const { t } = useLingui();
  const [stage, setStageLocal] = useState<StageState>(() => node?.stage ?? defaultStage());
  const [selected, setSelected] = useState<string | null>(stage.figures[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const capRef = useRef<(() => string) | null>(null);
  const modelUrl = useMemo(() => playerModelUrl("f"), []);
  // 手势（全部走 ref，理由见下面 live 的 ★）：按下时 3D 那边先报上"命中了地面哪一点 / 哪个人偶"（R3F 的监听器挂在
  // canvas 上，先于外层冒泡），这边按"抬手没挪 = 点、挪了 = 拖"分派：点人偶选中、拖人偶挪位、点地面放 / 挪选中的、
  // 在别处拖环绕、两指缩放。★ 地面铺满整个视野，所以"拖"不能在按下那一拍就定性 —— 第一版按下即算命中，环绕永远拖不起来
  const press = useRef<{ x: number; y: number; yaw: number; pitch: number; floor: [number, number] | null; figure: string | null; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const floorHit = useRef<[number, number] | null>(null);
  const figureHit = useRef<string | null>(null);
  const lastFloor = useRef<[number, number] | null>(null);
  // 舞台框：宽 ≤ 容器宽、高 ≤ 52vh，按本段画幅取先撞上的那一边（渲染处的 ★ 说了为什么不用 CSS aspect-ratio）
  const wrapRef = useRef<HTMLDivElement>(null);
  const spec = aspectOf(node?.aspect);
  const [stageBox, setStageBox] = useState({ w: 320, h: Math.round((320 * spec.h) / spec.w) });
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const maxW = Math.max(120, el.clientWidth - 32); // px-4 两边
      const maxH = Math.max(120, window.innerHeight * 0.52);
      const r = spec.w / spec.h;
      const w = Math.min(maxW, maxH * r);
      setStageBox({ w: Math.round(w), h: Math.round(w / r) });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [spec.w, spec.h]);

  // 状态回写到节点：换段 / 关窗再开还在（草稿也随节点存）。拖动中只改本地，抬手才写 store —— 每一拍都写会让
  // 订阅 nodes 的整个投影窗 / 画布跟着重渲
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const setStage = (next: StageState) => {
    stageRef.current = next;
    setStageLocal(next);
    useFlow.getState().setStage(nodeId, next);
  };
  const setStageLive = (next: StageState) => {
    stageRef.current = next;
    setStageLocal(next);
  };
  // ★ 3D 事件里的闭包会过期（实测：点「加人偶」后紧接着点地面，地面的 onPointerDown 还拿着上一拍的 adding=false，
  //   把选中的人偶挪了、新人偶没加）—— R3F 那棵树的更新与这边不同拍。所以手势里读的一律是 ref，不读 state。
  const live = useRef({ adding, selected });
  live.current = { adding, selected };
  if (!node) return null;
  const prop = node.proposals.find((p) => p.id === node.chosenId);
  const sel = stage.figures.find((f) => f.id === selected) ?? null;

  /** 点地面：加人偶模式下放一个新的，否则把选中的挪过去 */
  const tapFloor = (x: number, z: number) => {
    const cur = stageRef.current;
    const { adding: add, selected: selId } = live.current;
    if (add) {
      if (cur.figures.length >= STAGE_LIMITS.figuresMax) {
        setErr(t`最多摆 ${STAGE_LIMITS.figuresMax} 个人偶`);
        setAdding(false);
        return;
      }
      const f = { id: uid("fig"), x, z, rotY: 0, scale: 1 };
      setStage({ ...cur, figures: [...cur.figures, f] });
      setSelected(f.id);
      setAdding(false);
      return;
    }
    if (selId) setStage({ ...cur, figures: cur.figures.map((f) => (f.id === selId ? { ...f, x, z } : f)) });
  };

  const onWrapPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
      press.current = null;
      return;
    }
    const cam = stageRef.current.cam;
    press.current = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, floor: floorHit.current, figure: figureHit.current, moved: false };
    floorHit.current = null;
    figureHit.current = null;
  };
  const onWrapPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = pinch.current / Math.max(1, d);
      pinch.current = d;
      const cur = stageRef.current;
      setStageLive({ ...cur, cam: clampCam({ ...cur.cam, dist: cur.cam.dist * k }) });
      return;
    }
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 6) return; // 手指的抖动不算拖
    p.moved = true;
    const cur = stageRef.current;
    if (p.figure) {
      // 拖人偶：跟着地面上的命中点走（地面的 onPointerMove 一直在更新 lastFloor，人偶挡不住它——R3F 把事件发给沿途每个物体）
      const fl = lastFloor.current;
      if (fl) setStageLive({ ...cur, figures: cur.figures.map((f) => (f.id === p.figure ? { ...f, x: fl[0], z: fl[1] } : f)) });
      return;
    }
    setStageLive({ ...cur, cam: clampCam({ ...cur.cam, yaw: p.yaw - dx * 0.008, pitch: p.pitch + dy * 0.006 }) });
  };
  const onWrapPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const p = press.current;
    press.current = null;
    if (!p) {
      useFlow.getState().setStage(nodeId, stageRef.current); // 两指缩放收尾
      return;
    }
    if (!p.moved) {
      if (p.figure) setSelected(p.figure);
      else if (p.floor) tapFloor(p.floor[0], p.floor[1]);
      return;
    }
    useFlow.getState().setStage(nodeId, stageRef.current); // 拖完写回节点
  };

  async function fuseAsFirst() {
    if (busy || !prop) return;
    const cap = capRef.current;
    if (!cap) return;
    setErr("");
    let shot = "";
    try {
      shot = cap();
    } catch (e) {
      setErr(t`截图失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // 只改本地：节点上的 stage.shot 由 applyStageShot 成功那一拍写（入口按钮拿它当"已融过"的记号，先写就是谎）
    setStageLive({ ...stage, shot });
    setBusy(t`融图中…`);
    try {
      const ok = await useFlow.getState().applyStageShot(nodeId, shot, (s) => setBusy(s));
      if (ok) onClose();
      else setErr(useFlow.getState().err || t`没融成`);
    } finally {
      setBusy("");
    }
  }

  const price = AI_REAL ? fmtTokens(ONE_IMAGE) : t`演示`;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink">
      <div className="safe-top flex h-[58px] flex-none items-center gap-2 px-4">
        <CloseButton chip="md" size={16} tone="text-slate-200" label={t`关闭导演台`} onClick={onClose} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-slate-100"><Trans>🎬 导演台</Trans></div>
          <div className="truncate text-[10px] text-slate-500"><Trans>摆站位、拧机位，截图融成这一段的开头帧</Trans></div>
        </div>
      </div>

      {/* 舞台：按本段画幅定框，截出来的图就是这个框。
          ★ 尺寸用 JS 量（stageBox）：CSS 的 aspect-ratio 一旦撞上 max-height 就被忽略（高定死、宽照旧），
            竖屏段在矮屏上截出来的会是一张"宽高都被夹过"的图，构图示意与出片画幅对不上 */}
      <div ref={wrapRef} className="flex flex-none items-center justify-center px-4">
        <div
          className="overflow-hidden rounded-xl border border-slate-700/70 bg-black"
          style={{ width: stageBox.w, height: stageBox.h, touchAction: "none" }}
          onPointerDown={onWrapPointerDown}
          onPointerMove={onWrapPointerMove}
          onPointerUp={onWrapPointerUp}
          onPointerCancel={onWrapPointerUp}
        >
          <Canvas dpr={1} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 42, near: 0.1, far: 100, position: camPosition(stage.cam) }}>
            <color attach="background" args={[STAGE_BG]} />
            <ambientLight intensity={0.9} />
            <directionalLight position={[3, 6, 4]} intensity={1.4} />
            <directionalLight position={[-4, 3, -2]} intensity={0.5} />
            <CamRig cam={stage.cam} />
            <Capturer capRef={capRef} />
            {/* 地面：只负责报"命中了哪一点"（按下那一点、以及一路拖过的点），怎么用由外层按点 / 拖分派 */}
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0, 0]}
              onPointerDown={(e: ThreeEvent<PointerEvent>) => {
                floorHit.current = [e.point.x, e.point.z];
              }}
              onPointerMove={(e: ThreeEvent<PointerEvent>) => {
                lastFloor.current = [e.point.x, e.point.z];
              }}
            >
              <planeGeometry args={[40, 40]} />
              <meshStandardMaterial color={FLOOR} roughness={1} />
            </mesh>
            <gridHelper args={[40, 40, GRID[0], GRID[1]]} position={[0, 0.005, 0]} />
            <Suspense fallback={null}>
              {stage.figures.map((f) => (
                <Figure
                  key={f.id}
                  url={modelUrl}
                  x={f.x}
                  z={f.z}
                  rotY={f.rotY}
                  scale={f.scale}
                  selected={f.id === selected}
                  onPick={() => {
                    figureHit.current = f.id; // 选中 / 拖动都在抬手时由外层定，见 onWrapPointerUp
                  }}
                />
              ))}
            </Suspense>
          </Canvas>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-6 pt-3">
        {err && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-rose-300">{err}</div>
        )}
        {/* 人偶 */}
        <div className="rounded-lg border border-slate-700/70 bg-panel p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300"><Trans>人偶 {stage.figures.length}</Trans></span>
            <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">
              {adding ? t`点地面放一个新人偶` : sel ? t`点地面把选中的挪过去；点人偶换选中` : t`点一个人偶选中它`}
            </span>
            <button
              onClick={() => setAdding((v) => !v)}
              disabled={stage.figures.length >= STAGE_LIMITS.figuresMax}
              className={`flex-none rounded-full px-2.5 py-1 text-[11px] ${adding ? "bg-brand font-semibold text-ink" : "bg-slate-700 text-slate-100"} disabled:opacity-40`}
            >
              {adding ? t`取消` : t`+ 加人偶`}
            </button>
            <button
              onClick={() => {
                if (!sel) return;
                const rest = stage.figures.filter((f) => f.id !== sel.id);
                setStage({ ...stage, figures: rest });
                setSelected(rest[0]?.id ?? null);
              }}
              disabled={!sel || stage.figures.length <= 1}
              className="flex-none rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300 disabled:opacity-40"
            >
              <Trans>删除</Trans>
            </button>
          </div>
          {sel && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="w-8 flex-none"><Trans>朝向</Trans></span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={Math.round((sel.rotY * 180) / Math.PI)}
                  onChange={(e) =>
                    setStage({
                      ...stage,
                      figures: stage.figures.map((f) => (f.id === sel.id ? { ...f, rotY: (Number(e.target.value) * Math.PI) / 180 } : f)),
                    })
                  }
                  className="min-w-0 flex-1 accent-brand"
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <span className="w-8 flex-none"><Trans>身高</Trans></span>
                <input
                  type="range"
                  min={60}
                  max={140}
                  value={Math.round(sel.scale * 100)}
                  onChange={(e) =>
                    setStage({ ...stage, figures: stage.figures.map((f) => (f.id === sel.id ? { ...f, scale: Number(e.target.value) / 100 } : f)) })
                  }
                  className="min-w-0 flex-1 accent-brand"
                />
              </label>
            </div>
          )}
        </div>

        {/* 机位 */}
        <div className="rounded-lg border border-slate-700/70 bg-panel p-3">
          <div className="mb-1.5 text-xs font-semibold text-slate-300"><Trans>机位 · 空处拖动环绕，两指拉远拉近</Trans></div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {PITCH_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setStage({ ...stage, cam: clampCam({ ...stage.cam, pitch: p.pitch }) })}
                className={`flex-none rounded-full px-3 py-1 text-[11px] ${Math.abs(stage.cam.pitch - p.pitch) < 0.05 ? "bg-brand font-semibold text-ink" : "bg-slate-700 text-slate-100"}`}
              >
                {p.label}
              </button>
            ))}
            <span className="w-px flex-none bg-slate-700" />
            {SHOT_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setStage({ ...stage, cam: clampCam({ ...stage.cam, dist: p.dist }) })}
                className={`flex-none rounded-full px-3 py-1 text-[11px] ${Math.abs(stage.cam.dist - p.dist) < 0.3 ? "bg-brand font-semibold text-ink" : "bg-slate-700 text-slate-100"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void fuseAsFirst()}
          disabled={!!busy || !prop}
          className="w-full rounded-xl bg-brand py-2.5 text-sm font-bold text-ink disabled:opacity-40"
        >
          {busy || t`📸 截图 → 融成这一段的开头帧（${price}）`}
        </button>
        <p className="text-[10px] leading-relaxed text-slate-500">
          <Trans>
            截图只是构图示意，会和你挂的人物卡 / 场景卡一起融成真正的开头帧（一张图的钱）；融好的帧会钉住，重推方案不会改它，想换就再截一次。人偶站位、机位都随这一段存着，下次打开还在。
          </Trans>
        </p>
      </div>
    </div>,
    document.body,
  );
}
