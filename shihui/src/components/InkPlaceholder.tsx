import type { CSSProperties, ReactNode } from "react"
import { guessKeywords, hashStr, seededRand } from "../utils/keywords"
import { VerseOverlay } from "./VerseOverlay"

// 水墨占位画面：mock 构建下"演示视频"的替身。
// 按句子的画面关键词组装水墨元素（月/山/水/鸟/鹅/花/雨…），同一句永远长一样（种子伪随机），
// 让"每句一段、段段不同、上下句有承接感"在没有真视频时就能被看见、被讨论。
// 真视频接上后这个组件退化为 loading/失败态的兜底画面，不删。

interface Props {
  text: string
  keywords?: string[]
  gloss?: string
  /** 列表缩略图传 false：小图上跑十几个动画很浪费，也看不清 */
  animate?: boolean
  className?: string
}

export function InkPlaceholder({ text, keywords, gloss, animate = true, className = "" }: Props) {
  const kw = new Set(keywords ?? guessKeywords(text))
  const rand = seededRand(hashStr(text))
  const night = kw.has("夜")
  const el: ReactNode[] = []
  const anim = (name: string, dur: number, delay = 0): CSSProperties =>
    animate ? { animation: `${name} ${dur}s ease-in-out ${delay}s infinite` } : {}

  // —— 天空层 ——
  if (kw.has("月")) {
    const cx = 250 + rand() * 50
    el.push(
      <g key="moon" style={anim("ink-drift", 26)}>
        <circle cx={cx} cy={110} r={52} fill="#efe9d8" opacity={0.9} />
        <circle cx={cx} cy={110} r={52} fill="none" stroke="#8a877d" strokeWidth={1.2} opacity={0.6} />
        <circle cx={cx} cy={110} r={72} fill="#efe9d8" opacity={0.18} filter="url(#soft)" />
      </g>,
    )
  }
  if (kw.has("日") || kw.has("晨")) {
    el.push(
      <circle key="sun" cx={90 + rand() * 40} cy={120} r={40} fill="#d8a05a" opacity={0.55} filter="url(#soft)" />,
    )
  }
  if (kw.has("星")) {
    const stars: ReactNode[] = []
    for (let i = 0; i < 10; i++) {
      stars.push(
        <circle
          key={i}
          cx={20 + rand() * 320}
          cy={30 + rand() * 200}
          r={1.5 + rand() * 2}
          fill="#5a574c"
          style={anim("ink-fade", 3 + rand() * 3, rand() * 3)}
        />,
      )
    }
    el.push(<g key="stars">{stars}</g>)
  }
  if (kw.has("云") || kw.has("雾") || kw.has("风")) {
    for (let i = 0; i < 3; i++) {
      el.push(
        <ellipse
          key={`mist${i}`}
          cx={80 + rand() * 200}
          cy={150 + i * 90 + rand() * 40}
          rx={90 + rand() * 60}
          ry={14 + rand() * 8}
          fill="#8a877d"
          opacity={0.14}
          filter="url(#soft)"
          style={anim("ink-drift", 18 + i * 5, i * 2)}
        />,
      )
    }
  }
  if (kw.has("虹")) {
    el.push(
      <g key="rainbow" opacity={0.5}>
        {["#c96f5a", "#d8a05a", "#7d9471"].map((c, i) => (
          <path key={c} d={`M40,${300 + i * 10} Q180,${120 + i * 10} 320,${300 + i * 10}`} fill="none" stroke={c} strokeWidth={6} opacity={0.55} />
        ))}
      </g>,
    )
  }

  // —— 远景层 ——
  if (kw.has("山")) {
    el.push(
      <g key="mtn">
        <path d="M-20,470 Q80,340 170,455 T380,440 L380,640 L-20,640 Z" fill="#4a473d" opacity={0.5} />
        <path d="M-20,500 Q120,400 230,495 T380,480 L380,640 L-20,640 Z" fill="#2b2b28" opacity={0.32} />
      </g>,
    )
  }
  if (kw.has("楼")) {
    const x = 60 + rand() * 60
    el.push(
      <g key="tower" stroke="#2b2b28" strokeWidth={2.5} fill="#f7f3ea" opacity={0.85}>
        <path d={`M${x - 44},430 L${x + 44},430 L${x + 30},410 L${x - 30},410 Z`} />
        <rect x={x - 26} y={410} width={52} height={-34 + 60} fill="none" />
        <path d={`M${x - 38},376 L${x + 38},376 L${x + 24},356 L${x - 24},356 Z`} />
        <rect x={x - 20} y={356} width={40} height={-30 + 50} fill="none" transform="translate(0,-20)" />
        <path d={`M${x - 30},316 L${x + 30},316 L${x},290 Z`} />
      </g>,
    )
  }
  if (kw.has("屋") || kw.has("乡")) {
    const x = 240 + rand() * 50
    el.push(
      <g key="house" opacity={0.8}>
        <path d={`M${x - 40},480 L${x},445 L${x + 40},480 Z`} fill="#4a473d" />
        <rect x={x - 30} y={480} width={60} height={38} fill="#5a574c" opacity={0.65} />
        <rect x={x - 8} y={492} width={16} height={16} fill={night ? "#d8a05a" : "#f7f3ea"} opacity={0.9} />
      </g>,
    )
  }
  if (kw.has("树")) {
    el.push(
      <g key="tree" style={anim("ink-sway", 9)} opacity={0.75}>
        <path d="M40,640 C60,520 50,470 90,420" fill="none" stroke="#2b2b28" strokeWidth={7} strokeLinecap="round" />
        <path d="M70,500 Q110,470 150,480" fill="none" stroke="#2b2b28" strokeWidth={4} strokeLinecap="round" />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={90 + rand() * 80} cy={410 + rand() * 80} r={16 + rand() * 14} fill="#4a473d" opacity={0.28} filter="url(#soft)" />
        ))}
      </g>,
    )
  }

  // —— 水面层 ——
  const hasWater = kw.has("水") || kw.has("河")
  if (hasWater) {
    for (let i = 0; i < 4; i++) {
      const y = 520 + i * 26
      el.push(
        <path
          key={`wave${i}`}
          d={`M-20,${y} q45,-10 90,0 t90,0 t90,0 t90,0 t90,0`}
          fill="none"
          stroke="#5a574c"
          strokeWidth={2}
          opacity={0.5 - i * 0.09}
          style={anim("ink-drift", 10 + i * 3, i)}
        />,
      )
    }
  }
  if (kw.has("桥")) {
    el.push(
      <path key="bridge" d="M60,520 Q180,430 300,520" fill="none" stroke="#2b2b28" strokeWidth={8} opacity={0.7} strokeLinecap="round" />,
    )
  }
  if (kw.has("鹅")) {
    const x = 130 + rand() * 80
    el.push(
      <g key="goose" style={anim("ink-drift", 12)}>
        <ellipse cx={x} cy={545} rx={38} ry={22} fill="#fdfbf4" stroke="#2b2b28" strokeWidth={2.5} />
        <path d={`M${x + 26},540 C${x + 46},528 ${x + 44},498 ${x + 34},488`} fill="none" stroke="#2b2b28" strokeWidth={7} strokeLinecap="round" />
        <path d={`M${x + 30},486 l14,4 l-12,7 Z`} fill="#c96f5a" />
        <circle cx={x + 33} cy={484} r={1.8} fill="#2b2b28" />
      </g>,
    )
  }
  if (kw.has("舟")) {
    const x = 150 + rand() * 90
    el.push(
      <g key="boat" style={anim("ink-drift", 16)} opacity={0.85}>
        <path d={`M${x - 42},540 q42,18 84,0 l-10,12 q-32,10 -64,0 Z`} fill="#2b2b28" />
        <path d={`M${x + 8},540 q2,-16 -4,-26`} fill="none" stroke="#2b2b28" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={x - 12} cy={528} r={7} fill="#4a473d" />
        <path d={`M${x - 22},536 q10,-14 20,0`} fill="#4a473d" />
      </g>,
    )
  }
  if (kw.has("鱼")) {
    el.push(
      <g key="fish" opacity={0.6} style={anim("ink-drift", 8)}>
        <path d="M200,560 q14,-8 30,0 q-14,8 -30,0 Z" fill="#4a473d" />
        <path d="M230,560 l10,-6 v12 Z" fill="#4a473d" />
      </g>,
    )
  }

  // —— 天气/前景层 ——
  if (kw.has("鸟")) {
    for (let i = 0; i < 3; i++) {
      const x = 60 + rand() * 220
      const y = 140 + rand() * 120
      el.push(
        <path
          key={`bird${i}`}
          d={`M${x},${y} q7,-8 14,0 q7,-8 14,0`}
          fill="none"
          stroke="#2b2b28"
          strokeWidth={2.4}
          strokeLinecap="round"
          opacity={0.75}
          style={anim("ink-drift", 12 + i * 4, i * 1.5)}
        />,
      )
    }
  }
  if (kw.has("雨")) {
    const drops: ReactNode[] = []
    for (let i = 0; i < 14; i++) {
      drops.push(
        <line
          key={i}
          x1={rand() * 360}
          y1={rand() * 140}
          x2={rand() * 360 - 12}
          y2={rand() * 140 + 46}
          stroke="#5a574c"
          strokeWidth={1.4}
          opacity={0.4}
          style={anim("ink-rain", 1.6 + rand() * 1.4, rand() * 2)}
        />,
      )
    }
    el.push(<g key="rain">{drops}</g>)
  }
  if (kw.has("雪")) {
    const flakes: ReactNode[] = []
    for (let i = 0; i < 14; i++) {
      flakes.push(
        <circle
          key={i}
          cx={10 + rand() * 340}
          cy={rand() * 160}
          r={2 + rand() * 2}
          fill="#ffffff"
          stroke="#8a877d"
          strokeWidth={0.4}
          opacity={0.85}
          style={anim("ink-rain", 6 + rand() * 5, rand() * 6)}
        />,
      )
    }
    el.push(<g key="snow">{flakes}</g>)
  }
  if (kw.has("灯")) {
    const x = 80 + rand() * 60
    el.push(
      <g key="lantern" style={anim("ink-sway", 7)}>
        <line x1={x} y1={70} x2={x} y2={110} stroke="#2b2b28" strokeWidth={1.5} />
        <ellipse cx={x} cy={128} rx={16} ry={19} fill="#d8a05a" opacity={0.85} stroke="#b3432b" strokeWidth={1.5} />
        <ellipse cx={x} cy={128} rx={26} ry={29} fill="#d8a05a" opacity={0.25} filter="url(#soft)" />
      </g>,
    )
  }
  if (kw.has("花") || kw.has("落")) {
    const petals: ReactNode[] = []
    for (let i = 0; i < 8; i++) {
      petals.push(
        <ellipse
          key={i}
          cx={30 + rand() * 300}
          cy={60 + rand() * 120}
          rx={5}
          ry={3}
          fill="#c96f5a"
          opacity={0.7}
          style={anim("ink-fall", 7 + rand() * 6, rand() * 7)}
        />,
      )
    }
    el.push(<g key="petals">{petals}</g>)
  }
  if (kw.has("草")) {
    for (let i = 0; i < 6; i++) {
      const x = 20 + rand() * 320
      el.push(
        <path
          key={`grass${i}`}
          d={`M${x},640 q-4,-26 4,-42 M${x + 8},640 q2,-20 12,-32`}
          fill="none"
          stroke="#4a473d"
          strokeWidth={2}
          opacity={0.55}
          style={anim("ink-sway", 5 + rand() * 3, rand() * 2)}
        />,
      )
    }
  }
  if (kw.has("霜") || kw.has("地")) {
    el.push(<ellipse key="frost" cx={180} cy={620} rx={220} ry={40} fill="#e8e2d0" opacity={0.5} filter="url(#soft)" />)
  }

  return (
    <div className={`relative overflow-hidden bg-paper ${className}`}>
      <svg viewBox="0 0 360 640" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="paper-grain">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" />
            <feColorMatrix in="n" type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.06" />
            </feComponentTransfer>
            <feComposite operator="over" in2="SourceGraphic" />
          </filter>
        </defs>
        {/* 底色墨晕：任何句子都有，避免关键词全 miss 时一片空白 */}
        <circle cx={100 + rand() * 160} cy={200 + rand() * 200} r={130} fill="#8a877d" opacity={0.1} filter="url(#soft)" style={anim("ink-drift", 30)} />
        {el}
        {night && <rect x={0} y={0} width={360} height={640} fill="#1d2030" opacity={0.16} />}
        <rect x={0} y={0} width={360} height={640} fill="#f7f3ea" opacity={0.5} filter="url(#paper-grain)" style={{ mixBlendMode: "multiply" }} />
      </svg>
      <VerseOverlay text={text} gloss={gloss} />
    </div>
  )
}
