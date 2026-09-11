// 头像。有图走图；没有图时按名字哈希出一个固定色相 + 首字母，
// 而不是所有人都渲染同一个 emoji——那会让连刷五支不同作者的作品在视觉上
// 变成「同一个人发的」。色相哈希是 Gmail / Slack / Linear 的通用做法。
//
// src 这个口子先留好：接了头像上传之后只改这一个文件。

/** 名字 → 稳定色相（0-359）。同一个名字永远同一个颜色。 */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** 首字，中文取第一个汉字，英文取首字母大写 */
function initialOf(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  const c = [...s][0];
  return /[a-z]/i.test(c) ? c.toUpperCase() : c;
}

export interface AvatarProps {
  /**
   * 身份名：没有图时按它哈希色相（同一个名字永远同一个颜色）。
   * ★ 传存进库里的**原值**（作品 / 评论的 author），别传翻过的显示名 —— 否则切一次语言颜色就变了。
   */
  name: string;
  /**
   * 画出来的名字（首字、图片的 alt），缺省 = name。
   * ★ 多语言（2026-09-11）：离线作者「我」、兜底名「匿名」在英文界面显示成 Me / Anonymous（videos.authorDisplayName），
   *   首字与 alt 跟着显示名走，色相仍按 name 算。
   */
  label?: string;
  /** 图片 URL，或单个 emoji（本地账号阶段头像就是 emoji） */
  src?: string;
  size?: number;
  className?: string;
  ring?: boolean;
}

export default function Avatar({ name, label, src, size = 36, className = "", ring = false }: AvatarProps) {
  const base = "flex shrink-0 items-center justify-center overflow-hidden rounded-full";
  const border = ring ? "ring-2 ring-white/80" : "";
  const box = { width: size, height: size };
  /** 画出来的名字（首字 / alt）；色相仍按 name 算，见 AvatarProps.label */
  const shown = label ?? name;

  // emoji 头像（本地账号）：单个字符且非 URL
  if (src && !/^(https?:|data:|\/)/.test(src) && [...src].length <= 2) {
    return (
      <span className={`${base} ${border} bg-panel ${className}`} style={{ ...box, fontSize: size * 0.55 }}>
        {src}
      </span>
    );
  }

  if (src) {
    return <img src={src} alt={shown} className={`${base} ${border} object-cover ${className}`} style={box} />;
  }

  const h = hueOf(name);
  return (
    <span
      className={`${base} ${border} font-semibold ${className}`}
      style={{
        ...box,
        fontSize: size * 0.42,
        background: `hsl(${h} 42% 26%)`,
        color: `hsl(${h} 72% 78%)`,
      }}
    >
      {initialOf(shown)}
    </span>
  );
}
