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
