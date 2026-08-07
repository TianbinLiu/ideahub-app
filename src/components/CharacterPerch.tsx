// 「角色趴坐在图标上」——激活态才出现的 Q 版简笔画。
//
// 角色取自创作入口 /create 三张封面图（studio / workflow / simple）里的同一位少女：
//   银白长直发 · 左侧一绺薄荷挑染 · 金色星形发饰 · 藏蓝短披风 + 白立领衬衫 · 灰褶裙 · 青蓝大眼
//
// ★ 为什么只在激活时出现（而不是常驻）：
//   右侧栏 4 个按钮 + 底栏 4 个 Tab = 8 个位置。全挂角色会把画面塞满，
//   而首页是全出血视频，任何常驻装饰都在跟内容抢注意力。
//   只在「你刚点了赞/收藏」「你正在这个 Tab」时现身，角色就成了对操作的回应，
//   而不是背景噪音 —— 同样的绘制成本，换来记忆点而非干扰。
//
// ★ 为什么是 Q 版（头身比约 1:1）：
//   目标尺寸只有 24-28px。封面那种写实比例缩到这个尺寸会糊成一团色块，
//   只有大头小身能保住辨识度。
//
// ★ 在 26px 上只保留三个识别锚点，多画的都会互相糊掉：
//   ① 金色星形发饰（最强，封面三张都有）② 薄荷挑染那一绺 ③ 藏蓝披风
import { memo } from "react";

/* 配色取自 /create 封面图，深色视频上做了提亮（原色偏暗会糊进背景）。
   ★ 值直接写在下面的 SVG 里而不是抽成常量：这些颜色只此一处使用，
     抽成常量反而要在两个地方对照着看，改一次色得跳两趟。 */

/**
 * 趴坐在图标顶部的小人。
 *
 * 定位约定：调用方给父元素 `relative`，本组件绝对定位到图标【上边缘】，
 * 双腿垂到图标正面（bottom 取图标尺寸的比例），形成「坐在图标上」的关系。
 * bottom 用比例而非固定 px —— 24px 的 Tab 图标与 28px 的右栏图标若共用固定偏移，
 * 会一个悬空一个陷进去。
 */
function CharacterPerchImpl({ size = 28, className = "" }: { size?: number; className?: string }) {
  // 小人明显比图标宽（1.45×）：这是「特色化」而非点缀，太小就只是个看不清的斑点。
  // 靠它坐在图标【上方】而非覆盖其上，所以宽一点不影响图标本身的辨识。
  const w = Math.round(size * 1.45);

  return (
    <span
      className={`perch-pop pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 ${className}`}
      style={{ bottom: `${Math.round(size * 0.52)}px`, width: w }}
      aria-hidden
    >
      <svg viewBox="0 0 40 30" width={w} height={Math.round((w * 30) / 40)}>
        {/* 深色描边打底：整体轮廓先描一圈暗色，保证在明亮视频画面上也能看清剪影。
            没有这层的话，银白发 + 白衬衫在浅色背景里会直接消失。 */}
        <g stroke="#0E1A2E" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="#0E1A2E">
          <path d="M13 21 L11.5 27" />
          <path d="M27 21 L28.5 27" />
          <path d="M11.8 15 L28.2 15 L30.2 23.4 L9.8 23.4 Z" />
          <circle cx="20" cy="9.6" r="8.8" />
        </g>

        {/* 双腿 */}
        <g stroke="#F0DFCF" strokeWidth="2" strokeLinecap="round">
          <path d="M13 21 L11.5 26.6" />
          <path d="M27 21 L28.5 26.6" />
        </g>

        {/* 身体：藏蓝披风一整块。不再分衬衫/裙/扣子 ——
            在 26px 上那些只会并成一团，一个纯色块反而能读出「人」的体量。 */}
        <path d="M12.2 15.3 L27.8 15.3 L29.6 23 L10.4 23 Z" fill="#22407A" />
        {/* 双臂：两笔向下外张，做出环抱姿态 */}
        <path d="M13.4 17 Q9.4 19.4 11.4 22.4" fill="none" stroke="#22407A" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M26.6 17 Q30.6 19.4 28.6 22.4" fill="none" stroke="#22407A" strokeWidth="3.4" strokeLinecap="round" />

        {/* 银白长发：一大块盖住头顶与两侧，是第二识别锚点 */}
        <path d="M10.6 11.5 Q10.2 1.6 20 1.2 Q29.8 1.6 29.4 11.5 L29.4 17.8 L26.6 17.8 L26.6 9.6 Q20 6.6 13.4 9.6 L13.4 17.8 L10.6 17.8 Z" fill="#EDF2F8" />
        {/* 薄荷挑染：一笔粗线，位置对应封面里角色左侧那绺 */}
        <path d="M27.4 8 L27.4 17.4" stroke="#6FDCCB" strokeWidth="2.6" strokeLinecap="round" />

        {/* 脸 */}
        <circle cx="20" cy="10.2" r="6.2" fill="#FBE7D6" />
        {/* 眼睛：两个纯色圆点，不画高光也不画嘴 —— 26px 下多一笔就糊一分 */}
        <circle cx="17.6" cy="10.8" r="1.3" fill="#26405C" />
        <circle cx="22.4" cy="10.8" r="1.3" fill="#26405C" />

        {/* ★ 金色星形发饰：角色最强识别符号，画得又大又亮，最后绘制压在最上层 */}
        <path
          d="M13.9 4.5 L14.95 6.6 L17.25 6.95 L15.55 8.6 L15.95 10.9 L13.9 9.8 L11.85 10.9 L12.25 8.6 L10.55 6.95 L12.85 6.6 Z"
          fill="#F5CE63"
          stroke="#0E1A2E"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** memo：右侧栏与底栏在滚动/播放中频繁重渲染，小人无状态，不必跟着重画 */
export const CharacterPerch = memo(CharacterPerchImpl);
export default CharacterPerch;
