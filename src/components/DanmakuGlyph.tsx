// 「弹」标记：一个圆角方框里写个弹字，右下角搭一支小笔（B 站同款）。
//
// ★ 为什么不做成 Icon 里的一条 path：它的主体是**汉字**。塞进 Icon 就得用 <text>，
//   而 Icon 统一是 stroke 描边渲染，描边的汉字在 24px 上糊成一团。用真字排版
//   既清晰又能跟着 currentColor 变色，还自动吃系统字体的中文字重。
//
// ★ 两处在用（首页右侧栏那颗键、弹幕输入条左边那个开关），所以单独成文件：
//   两边都要"同一个弹字"，各画一份改一处就会分叉（铁律六）。
import Icon from "./Icon";

export default function DanmakuGlyph({
  size = 26,
  /** 右下角那支小笔。开关态（输入条里）不画笔，画对勾/斜杠更说明问题 */
  pen = true,
  /** 关掉显示时打一道斜杠 —— 只把颜色变灰的话，"弹幕关了"和"这个键不能点"分不出来 */
  off = false,
}: {
  size?: number;
  pen?: boolean;
  off?: boolean;
}) {
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center rounded-[30%] border-2 border-current font-bold"
        // 0.58 是量出来的：再大一点「弹」的竖钩会顶到方框内壁，
        // 在 26px 上看就是一个糊住的方块
        style={{ fontSize: Math.round(size * 0.58), lineHeight: 1 }}
      >
        弹
      </span>
      {pen && (
        <Icon
          name="pen"
          size={Math.round(size * 0.52)}
          strokeWidth={2.5}
          className="absolute -bottom-[8%] -right-[14%]"
          // 笔压在方框边线上，不描一圈底色就和边线糊在一起
          style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,.9))" }}
        />
      )}
      {off && (
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[128%] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current"
          aria-hidden
        />
      )}
    </span>
  );
}
