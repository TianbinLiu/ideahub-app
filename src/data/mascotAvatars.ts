// 官方 Q 版看板娘头像清单。
//
// ★★ 本文件由 `python design/gen-mascot-avatars.py` **自动生成，不要手改** ——
//   改了下次重跑就没了。要增删头像去改那个脚本里的 PICKS 表。
//
// 图本身是从底栏宠物那五张精灵图里裁的（design/gen-mascot-avatars.py 开头有说明），
// 所以头像里的人和底栏上那只、工坊里的铸卡师是**同一个角色**。

export interface MascotAvatar {
  key: string;
  /** 选择器里显示的中文名（一个词，说清是什么表情） */
  label: string;
  /** 站内静态路径。走 <img src> 直接能用 */
  src: string;
}

export const MASCOT_AVATARS: MascotAvatar[] = [
  { key: "smile", label: "微笑", src: "/avatars/mascot-smile.webp" },
  { key: "focus", label: "认真", src: "/avatars/mascot-focus.webp" },
  { key: "hi", label: "打招呼", src: "/avatars/mascot-hi.webp" },
  { key: "laugh", label: "大笑", src: "/avatars/mascot-laugh.webp" },
  { key: "wonder", label: "好奇", src: "/avatars/mascot-wonder.webp" },
  { key: "cheer", label: "欢呼", src: "/avatars/mascot-cheer.webp" },
  { key: "joy", label: "庆祝", src: "/avatars/mascot-joy.webp" },
  { key: "nap", label: "打盹", src: "/avatars/mascot-nap.webp" },
];
