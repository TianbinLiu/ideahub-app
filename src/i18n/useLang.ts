// 界面语言的 React 读法：偏好（null = 跟随系统）与当前生效的语言。任何一次 setLangPref 之后重渲。
import { useSyncExternalStore } from "react";
import { explicitLang, type Lang } from "./locale";
import { activeLang, subscribeLang } from "./switch";

export function useLang(): { pref: Lang | null; active: Lang } {
  const pref = useSyncExternalStore(subscribeLang, explicitLang, explicitLang);
  const active = useSyncExternalStore(subscribeLang, activeLang, activeLang);
  return { pref, active };
}
