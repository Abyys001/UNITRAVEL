/** Hero chart after the booklet cover: copper arcs over a dotted night-navy grid (decorative, aria-hidden). */
export function RouteArt() {
  const pts: [string, number, number][] = [["LON", 70, 60], ["IST", 300, 230], ["EVN", 440, 300], ["TBZ", 520, 330], ["VAN", 470, 380], ["THR", 610, 410], ["NJF", 560, 490], ["MCT", 700, 520]]
  const p = (n: string) => pts.find((x) => x[0] === n)!
  const arc = (a: string, b: string, bend = -60) => { const [, x1, y1] = p(a); const [, x2, y2] = p(b); return `M${x1},${y1} Q${(x1 + x2) / 2 + bend / 2},${(y1 + y2) / 2 + bend} ${x2},${y2}` }
  return (
    <svg viewBox="0 0 760 580" className="h-full w-full" aria-hidden>
      <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#2a4566" /></pattern>
        <radialGradient id="glow" cx="60%" cy="45%" r="60%"><stop offset="0" stopColor="#1d3a5e" /><stop offset="1" stopColor="#0f2238" /></radialGradient></defs>
      <rect width="760" height="580" fill="url(#glow)" /><rect width="760" height="580" fill="url(#dots)" opacity=".6" />
      {[["LON", "IST", -40], ["IST", "VAN", 30], ["LON", "EVN", -90], ["MCT", "LON", -160], ["THR", "MCT", 20], ["NJF", "THR", -30]].map(([a, b, k], i) => (
        <path key={i} d={arc(a as string, b as string, k as number)} className="arc" style={{ animationDelay: `${i * 0.25}s` }} stroke={i % 2 ? "#e6c3a2" : "#c98d5b"} strokeWidth="1.8" fill="none" opacity=".9" />
      ))}
      {[["EVN", "TBZ"], ["TBZ", "VAN"], ["VAN", "THR"]].map(([a, b], i) => <path key={i} d={arc(a!, b!, 10)} stroke="#8fb0d6" strokeWidth="1.2" strokeDasharray="4 5" fill="none" opacity=".7" />)}
      {pts.map(([n, x, y]) => (
        <g key={n}><circle cx={x} cy={y} r="9" fill="#ffffff" opacity=".08" /><circle cx={x} cy={y} r="4" fill="#fbf9f5" />
          <text x={x + 10} y={y - 9} fill="#d8e2ee" fontSize="12" fontFamily="var(--font-jetbrains), monospace" letterSpacing="1.5">{n}</text></g>
      ))}
    </svg>
  )
}
