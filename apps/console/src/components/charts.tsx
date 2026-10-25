"use client"

/**
 * Dashboard charts (audit P2 #14). Plain SVG on the theme tokens (--viz-*, --viz-grid), so light/dark and RTL need no
 * chart library. Every chart renders real data only, has a screen-reader table with the same numbers, a tooltip that
 * also opens on keyboard focus, and an empty state when every value is zero.
 *
 *   <BarChart data series height />     stacked daily bars (one <g> per day, focusable), y grid with 3 ticks
 *   <Donut segments total label />      share of a whole with the total in the middle
 *   <SplitBar segments />               one-line proportional bar with a legend (SLA outcome)
 *   <Legend items />
 */
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

export interface Series { key: string; label: string; color: string }
export interface Point { label: string; short: string; values: Record<string, number> }

const niceMax = (n: number) => {
  if (n <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(n))
  const m = [1, 2, 2.5, 5, 10].find((x) => x * p >= n)!
  return m * p
}

export function Legend({ items, className }: { items: { label: React.ReactNode; color: string; value?: React.ReactNode }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-steel", className)}>
      {items.map((i, n) => <li key={n} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />{i.label}{i.value != null && <span className="num font-semibold text-ink">{i.value}</span>}</li>)}
    </ul>
  )
}

/** Width of an element, kept current with a ResizeObserver (charts draw in real pixels, so text is never stretched). */
function useWidth<E extends HTMLElement>(): [React.RefObject<E | null>, number] {
  const ref = useRef<E>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function BarChart({ data, series, height = 200, caption, emptyLabel }: { data: Point[]; series: Series[]; height?: number; caption: string; emptyLabel: React.ReactNode }) {
  const id = useId()
  const [box, measured] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const totals = useMemo(() => data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0)), [data, series])
  const max = niceMax(Math.max(0, ...totals))
  const empty = totals.every((v) => v === 0)
  const W = Math.max(240, measured || 640), H = height, padL = 30, padB = 22, padT = 8
  const innerW = W - padL - 4, innerH = H - padB - padT
  const slot = innerW / Math.max(1, data.length)
  const bw = Math.max(2, Math.min(22, slot * 0.62))
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const every = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(W / 64))))
  const ticks = [0, max / 2, max]
  const h = hover != null ? data[hover] : null
  return (
    <figure className="relative">
      <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full overflow-visible" role="img" aria-labelledby={`${id}-cap`} aria-describedby={`${id}-tbl`}>
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={padL} x2={W - 4} y1={y(tv)} y2={y(tv)} stroke="var(--viz-grid)" strokeDasharray={tv === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
              <text x={padL - 8} y={y(tv)} dy="0.32em" textAnchor="end" className="num fill-[var(--ink-subtle)] text-2xs">{Math.round(tv)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = padL + slot * i + slot / 2
            let acc = 0
            return (
              <g key={d.label} tabIndex={0} role="presentation" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="cursor-default outline-none">
                <rect x={cx - slot / 2} y={padT} width={slot} height={innerH} fill={hover === i ? "var(--hover)" : "transparent"} />
                {series.map((s) => {
                  const v = d.values[s.key] ?? 0
                  if (!v) return null
                  const top = y(acc + v), bottom = y(acc)
                  acc += v
                  return <rect key={s.key} x={cx - bw / 2} y={top} width={bw} height={Math.max(1, bottom - top - 1)} rx={Math.min(3, bw / 3)} fill={s.color} />
                })}
                {i % every === 0 && <text x={cx} y={H - 6} textAnchor="middle" className="fill-[var(--ink-subtle)] text-2xs">{d.short}</text>}
              </g>
            )
          })}
        </svg>
        {empty && <div className="absolute inset-0 grid place-items-center text-meta text-steel"><span className="rounded-full border border-rule bg-surface-raised px-3 py-1">{emptyLabel}</span></div>}
        {h && hover != null && !empty && (
          <div aria-hidden className="pop-surface pointer-events-none absolute z-dropdown min-w-36 -translate-x-1/2 px-3 py-2 text-meta" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%`, top: 0 }}>
            <p className="mb-1 font-semibold text-ink">{h.label}</p>
            {series.map((s) => <p key={s.key} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-steel"><span className="size-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span><span className="num font-semibold">{h.values[s.key] ?? 0}</span></p>)}
          </div>
        )}
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">{caption}</figcaption>
      <table id={`${id}-tbl`} className="sr-only">
        <thead><tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{d.values[s.key] ?? 0}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  )
}

export function Donut({ segments, total, label, size = 148, thickness = 16 }: { segments: { key: string; label: string; value: number; color: string }[]; total?: number; label: React.ReactNode; size?: number; thickness?: number }) {
  const id = useId()
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2, c = 2 * Math.PI * r
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0
  let offset = 0
  return (
    <figure className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-labelledby={`${id}-cap`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-grid)" strokeWidth={thickness} />
        {sum > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / sum) * c
          const el = <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} />
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><p className="num text-display leading-none font-semibold text-ink">{sum}</p><p className="mt-1 text-caption text-steel">{label}</p></div>
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">{`${sum}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}</figcaption>
    </figure>
  )
}

export function SplitBar({ segments, label }: { segments: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const sum = segments.reduce((s, x) => s + x.value, 0)
  return (
    <div>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--viz-grid)]" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
        {sum > 0 && segments.filter((s) => s.value > 0).map((s) => <span key={s.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(s.value / sum) * 100}%`, background: s.color }} />)}
      </div>
    </div>
  )
}
