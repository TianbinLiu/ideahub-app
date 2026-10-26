/**
 * @file bus.ts - 舞台（CompanionStage）与对话框（CompanionChat）之间的单例总线
 * @category Utility
 *
 * 两个组件在首页布局里是兄弟关系，谁也不包含谁；对话框只需要"有模型就演，没模型就只放声音/字幕"，
 * 所以这里是一个极简的模块级单例，而不是 context（避免每句话都让整棵首页树重渲染）。
 */

import type { CompanionModel } from "../live2d/companionModel";
import type { CompanionAction, CompanionFace } from "./protocol";

type ModelListener = (model: CompanionModel | null) => void;
type HitListener = (areas: string[]) => void;

let current: CompanionModel | null = null;
const listeners = new Set<ModelListener>();
const hitListeners = new Set<HitListener>();

export const companionBus = {
  get model() {
    return current;
  },
  setModel(model: CompanionModel | null) {
    current = model;
    listeners.forEach((fn) => fn(model));
  },
  onModel(fn: ModelListener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  face(face: CompanionFace) {
    current?.setFace(face);
  },
  action(action: CompanionAction) {
    current?.playAction(action);
  },
  /**
   * 换表情并保持到 releaseFace（客服页回答句：这一句念完才放，2026-10-25）。
   * face() 的老行为（按 FACE_POSES 的固定时长到点收回）原样保留：触摸反应、上传向导试跑、老师页都还走它。
   */
  holdFace(face: CompanionFace) {
    current?.holdFace(face);
  },
  /** 这一句念完了：holdFace 挂着的表情再留一小拍就回 normal；没挂着 = 空操作 */
  releaseFace() {
    current?.releaseFace();
  },
  /** 作废还没轮到的待播动作（压制窗口里到来的动作会排着，见 companionModel 的 pendingAction） */
  clearPendingAction() {
    current?.clearPendingAction();
  },
  /** 垫场动作（等第一句时的 think）：低优先级、不占语义动作的压制窗口，语义动作来了直接盖过去 */
  cue(action: CompanionAction) {
    current?.playCue(action);
  },
  /** 试演：直接播包里的某个动作组。返回 false = 这个组不在包里（调用方要说出来，别静默） */
  motionGroup(group: string): boolean {
    return current?.playMotionGroup(group) ?? false;
  },
  /** 试演：直接挂包里的某个 exp3 表情（null = 摘掉）。返回 false = 这个表情不在包里 */
  expression(name: string | null): boolean {
    return current?.setExpressionByName(name) ?? false;
  },
  mouth(level: number) {
    current?.setMouth(level);
  },
  speakSynthetic(durationMs: number) {
    current?.speakSynthetic(durationMs);
  },
  stopSpeaking() {
    current?.stopSpeaking();
  },
  /** 舞台里点到了模型的哪些命中区（HitAreas 名）；对话框据此演一句（protocol.ts 的 TOUCH_REACTIONS） */
  hit(areas: string[]) {
    if (!areas.length) return;
    hitListeners.forEach((fn) => fn(areas));
  },
  onHit(fn: HitListener) {
    hitListeners.add(fn);
    return () => {
      hitListeners.delete(fn);
    };
  },
};
