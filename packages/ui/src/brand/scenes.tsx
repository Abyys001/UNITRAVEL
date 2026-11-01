import type { ReactNode } from "react"

export type SceneKind = "flight" | "train" | "bus" | "stay" | "visa" | "cip" | "cargo"

const sky = "#11b7ff"
const navy = "#061f4c"
const orange = "#ff8617"
const royal = "#0c67b9"

function Frame({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 400 240" className="h-full w-full" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} fill="none">
      <defs>
        <linearGradient id="sc-sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={sky} stopOpacity=".28" /><stop offset="1" stopColor={sky} stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="400" height="240" rx="28" fill="url(#sc-sky)" />
      {children}
    </svg>
  )
}

const Cloud = ({ x, y, d }: { x: number; y: number; d: number }) => (
  <g className="scene-drift" style={{ "--d": `${d}s`, transform: `translate(${x}px, ${y}px)` } as React.CSSProperties}>
    <ellipse cx="0" cy="0" rx="26" ry="9" fill="#fff" opacity=".85" /><ellipse cx="14" cy="-7" rx="16" ry="9" fill="#fff" opacity=".85" />
  </g>
)

/**
 * Decorative animated scenes, one per service. Pure SVG + CSS (compositor-only transforms), no dependency; motion stops
 * under prefers-reduced-motion and the end state stays readable. Original artwork drawn for Uni Travel (no third-party licence).
 */
export function ServiceScene({ kind, className, label }: { kind: SceneKind; className?: string; label?: string }) {
  return (
    <div className={className}>
      <Frame label={label}>
        {kind === "flight" && (<>
          <Cloud x={70} y={60} d={14} /><Cloud x={300} y={40} d={18} />
          <path d="M30 190C120 60 280 40 372 100" stroke={royal} strokeWidth="2.5" strokeDasharray="6 9" strokeLinecap="round" className="animate-dash" />
          <circle cx="372" cy="100" r="8" fill={orange} /><circle cx="372" cy="100" r="8" fill={orange} className="animate-pulse-ring" style={{ transformOrigin: "372px 100px" }} />
          <g className="fly-path" style={{ offsetPath: 'path("M30 190C120 60 280 40 372 100")', ["--fly-duration" as string]: "7s" }}>
            <path d="M-14 0 4 -4 16 0 4 4Z M-2 0-10-12-5-12 6 0-5 12-10 12Z" fill={navy} />
          </g>
        </>)}
        {kind === "train" && (<>
          <Cloud x={90} y={50} d={16} />
          <g className="scene-slide" style={{ ["--d" as string]: "20s" }}>{[0, 1, 2, 3].map((i) => <path key={i} d={`M${i * 140 - 10} 170l30-60 30 60Z`} fill={royal} opacity=".18" />)}</g>
          <rect x="0" y="176" width="400" height="6" fill={navy} opacity=".7" />
          <g className="scene-bob">
            <rect x="110" y="120" width="190" height="52" rx="14" fill={navy} /><rect x="262" y="124" width="38" height="30" rx="10" fill={sky} />
            {[126, 160, 194, 228].map((x) => <rect key={x} x={x} y="132" width="24" height="18" rx="5" fill="#fff" opacity=".9" />)}
            <rect x="110" y="160" width="190" height="6" fill={orange} />
          </g>
          {[140, 170, 240, 270].map((x) => <circle key={x} cx={x} cy="176" r="7" fill={orange} className="scene-spin" style={{ transformOrigin: `${x}px 176px` }} />)}
        </>)}
        {kind === "bus" && (<>
          <Cloud x={300} y={50} d={19} />
          <g className="scene-slide" style={{ ["--d" as string]: "9s" }}>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={i * 90} y="186" width="46" height="4" rx="2" fill="#fff" opacity=".7" />)}</g>
          <rect x="0" y="180" width="400" height="14" fill={navy} opacity=".55" />
          <g className="scene-bob">
            <rect x="96" y="104" width="208" height="68" rx="16" fill={navy} />
            {[112, 148, 184, 220].map((x) => <rect key={x} x={x} y="116" width="28" height="22" rx="6" fill="#fff" opacity=".9" />)}
            <rect x="260" y="116" width="34" height="38" rx="8" fill={sky} /><rect x="96" y="152" width="208" height="6" fill={orange} />
          </g>
          {[134, 264].map((x) => <g key={x}><circle cx={x} cy="174" r="12" fill="#10213f" /><circle cx={x} cy="174" r="5" fill="#fff" className="scene-spin" style={{ transformOrigin: `${x}px 174px` }} /></g>)}
        </>)}
        {kind === "stay" && (<>
          <circle cx="320" cy="56" r="20" fill={orange} className="scene-glow" />
          <path d="M60 190h280" stroke={navy} strokeWidth="4" strokeLinecap="round" opacity=".5" />
          <g className="scene-bob"><path d="M110 190v-66l90-56 90 56v66Z" fill="#fff" stroke={navy} strokeWidth="4" strokeLinejoin="round" /><rect x="176" y="136" width="48" height="54" rx="8" fill={royal} /><rect x="130" y="130" width="28" height="26" rx="5" fill={sky} className="scene-twinkle" /><rect x="242" y="130" width="28" height="26" rx="5" fill={sky} className="scene-twinkle" style={{ animationDelay: "1.2s" }} /></g>
          <path d="M60 190c0-18 12-28 20-28s20 10 20 28Z" fill="#2fb36d" opacity=".9" /><path d="M300 190c0-20 14-32 24-32s24 12 24 32Z" fill="#2fb36d" opacity=".9" />
        </>)}
        {kind === "visa" && (<>
          <g className="scene-bob"><rect x="130" y="52" width="140" height="150" rx="14" fill={navy} /><circle cx="200" cy="112" r="28" stroke={orange} strokeWidth="3" /><path d="M172 112h56M200 84c-14 16-14 44 0 56M200 84c14 16 14 44 0 56" stroke={orange} strokeWidth="2" /><rect x="156" y="158" width="88" height="8" rx="4" fill="#fff" opacity=".7" /><rect x="170" y="174" width="60" height="6" rx="3" fill="#fff" opacity=".4" /></g>
          <g className="scene-stamp"><circle cx="276" cy="168" r="30" stroke="#d93025" strokeWidth="4" /><path d="M262 168l10 10 20-22" stroke="#d93025" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></g>
        </>)}
        {kind === "cip" && (<>
          <g className="scene-bob"><path d="M96 168c0-30 20-48 48-48h112c28 0 48 18 48 48v14H96Z" fill={navy} /><rect x="116" y="146" width="168" height="18" rx="9" fill={royal} /></g>
          <circle cx="200" cy="82" r="22" fill={orange} className="scene-glow" /><path d="M200 62l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2Z" fill="#fff" />
        </>)}
        {kind === "cargo" && (<>
          <g className="scene-slide" style={{ ["--d" as string]: "11s" }}>{[0, 1, 2, 3].map((i) => <path key={i} d={`M${i * 120} 196h60`} stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".7" />)}</g>
          <rect x="0" y="190" width="400" height="10" fill={navy} opacity=".55" />
          <g className="scene-bob">{([[120, 134], [176, 134], [148, 94]] as [number, number][]).map(([x, y], i) => <g key={i}><rect x={x} y={y} width="54" height="52" rx="6" fill={i === 2 ? orange : "#fff"} stroke={navy} strokeWidth="3" /><path d={`M${x} ${y + 18}h54`} stroke={navy} strokeWidth="3" /></g>)}</g>
        </>)}
      </Frame>
    </div>
  )
}
