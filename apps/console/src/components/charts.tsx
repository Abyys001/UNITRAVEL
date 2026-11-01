"use client"

/**
 * Dashboard charts (audit P2 #14). Plain SVG on the theme tokens (--viz-*, --viz-grid), so light/dark and RTL need no
 * chart library. Every chart renders real data only, has a screen-reader table with the same numbers, a tooltip that
 * also opens on keyboard focus, and an empty state when every value is zero.
 *
 *   <BarChart data series height />     stacked daily bars (one <g> per day, focusable), y grid with 3 ticks
 *   <Donut segments total label />      share of a whole with the total in the middle
 *   <SplitBar segments />               one-line proportional bar with a legend (SLA outcome)
 *   <LineArea data series stacked />    lines with a soft area (optionally stacked), same axes/tooltip/table as BarChart
 *   <StackedRows rows />                horizontal stacked bars, one row per category (pipeline stages, mixes)
 *   <Legend items />
 *
 * RTL: time runs right to left and the value axis moves to the right edge, so a Persian reader sees the oldest day on
 * the right like every other timeline in the console; numbers use the locale's digits.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"

export interface Series { key: string; label: string; color: string }
export interface Point { label: string; short: string; values: Record<string, number> }

const niceMax = (n: number) => {
  if (n <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(n))
  const m = [1, 2, 2.5, 5, 10].find((x) => x * p >= n)!
  return m * p
}

const watchDir = (fn: () => void) => {
  const mo = new MutationObserver(fn)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] })
  return () => mo.disconnect()
}
/** True while the page is right to left (follows <html dir>, which the language switch changes). */
export const useRtl = () => useSyncExternalStore(watchDir, () => document.documentElement.dir === "rtl", () => false)
/** Number formatter in the console language (Persian digits in fa). */
export function useNum() {
  const [locale] = useLocale()
  return useMemo(() => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format, [locale])
}

/** Plot-area geometry for the time charts: the value axis sits on the reading-start edge (left, or right in RTL). */
function plotBox(W: number, rtl: boolean, axis = 30) {
  const plotL = rtl ? 4 : axis, plotR = rtl ? W - axis : W - 4
  return { plotL, plotR, innerW: plotR - plotL, axisX: rtl ? plotR + 8 : plotL - 8, anchor: (rtl ? "start" : "end") as "start" | "end" }
}

function ChartTip({ x, W, title, series, values, fmt }: { x: number; W: number; title: string; series: Series[]; values: Record<string, number>; fmt: (n: number) => string }) {
  return (
    <div aria-hidden className="pop-surface pointer-events-none absolute z-dropdown min-w-36 -translate-x-1/2 px-3 py-2 text-meta" style={{ left: Math.max(76, Math.min(W - 76, x)), top: 0 }}>
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {series.map((s) => <p key={s.key} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-steel"><span className="size-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</span><span className="num font-semibold">{fmt(values[s.key] ?? 0)}</span></p>)}
    </div>
  )
}

function ChartTable({ id, data, series, dateLabel, fmt }: { id: string; data: Point[]; series: Series[]; dateLabel: string; fmt: (n: number) => string }) {
  return (
    <table id={`${id}-tbl`} className="sr-only">
      <thead><tr><th>{dateLabel}</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
      <tbody>{data.map((d) => <tr key={d.label}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{fmt(d.values[s.key] ?? 0)}</td>)}</tr>)}</tbody>
    </table>
  )
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
  const t = useT()
  const rtl = useRtl()
  const fmt = useNum()
  const [box, measured] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const totals = useMemo(() => data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0)), [data, series])
  const max = niceMax(Math.max(0, ...totals))
  const empty = totals.every((v) => v === 0)
  const W = Math.max(240, measured || 640), H = height, padB = 22, padT = 8
  const { plotL, plotR, innerW, axisX, anchor } = plotBox(W, rtl)
  const innerH = H - padB - padT
  const slot = innerW / Math.max(1, data.length)
  const bw = Math.max(2, Math.min(22, slot * 0.62))
  const cxOf = (i: number) => (rtl ? plotR - slot * (i + 0.5) : plotL + slot * (i + 0.5))
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
              <line x1={plotL} x2={plotR} y1={y(tv)} y2={y(tv)} stroke="var(--viz-grid)" strokeDasharray={tv === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
              <text x={axisX} y={y(tv)} dy="0.32em" textAnchor={anchor} className="num fill-[var(--ink-subtle)] text-2xs">{fmt(Math.round(tv))}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = cxOf(i)
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
        {h && hover != null && !empty && <ChartTip x={cxOf(hover)} W={W} title={h.label} series={series} values={h.values} fmt={fmt} />}
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">{caption}</figcaption>
      <ChartTable id={id} data={data} series={series} dateLabel={t("chart.date")} fmt={fmt} />
    </figure>
  )
}

/**
 * Lines over a shared time axis. `stacked` adds the series up (areas stack, the top edge is the total); otherwise each
 * series is drawn from zero with a faint fill. Points are real values only: one day is a dot, never an invented slope.
 */
export function LineArea({ data, series, height = 200, caption, emptyLabel, stacked = false }: { data: Point[]; series: Series[]; height?: number; caption: string; emptyLabel: React.ReactNode; stacked?: boolean }) {
  const id = useId()
  const t = useT()
  const rtl = useRtl()
  const fmt = useNum()
  const [box, measured] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const peak = useMemo(() => Math.max(0, ...data.map((d) => (stacked ? series.reduce((n, x) => n + (d.values[x.key] ?? 0), 0) : Math.max(0, ...series.map((x) => d.values[x.key] ?? 0))))), [data, series, stacked])
  const max = niceMax(peak)
  const empty = peak === 0
  const W = Math.max(240, measured || 640), H = height, padB = 22, padT = 8
  const { plotL, plotR, innerW, axisX, anchor } = plotBox(W, rtl)
  const innerH = H - padB - padT
  const n = data.length
  const xOf = (i: number) => (n < 2 ? (plotL + plotR) / 2 : rtl ? plotR - (i / (n - 1)) * innerW : plotL + (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const every = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 64))))
  // Per series: the top edge at each point, and the baseline it sits on (zero, or the series below when stacked).
  const layers = useMemo(() => {
    const base = data.map(() => 0)
    return series.map((s) => {
      const top = data.map((d, i) => base[i]! + (d.values[s.key] ?? 0))
      const bottom = stacked ? [...base] : data.map(() => 0)
      if (stacked) top.forEach((v, i) => { base[i] = v })
      return { s, top, bottom }
    })
  }, [data, series, stacked])
  const pathsOf = (l: { top: number[]; bottom: number[] }) => {
    const line = l.top.map((v, i) => `${i ? "L" : "M"}${xOf(i).toFixed(1)},${y(v).toFixed(1)}`).join("")
    const back = l.bottom.map((v, i) => `L${xOf(n - 1 - i).toFixed(1)},${y(l.bottom[n - 1 - i]!).toFixed(1)}`).join("")
    return { line, area: `${line}${back}Z` }
  }
  const ticks = [0, max / 2, max]
  const h = hover != null ? data[hover] : null
  const col = Math.max(8, innerW / Math.max(1, n))
  return (
    <figure className="relative">
      <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block max-w-full overflow-visible" role="img" aria-labelledby={`${id}-cap`} aria-describedby={`${id}-tbl`}>
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={plotL} x2={plotR} y1={y(tv)} y2={y(tv)} stroke="var(--viz-grid)" strokeDasharray={tv === 0 ? undefined : "3 4"} vectorEffect="non-scaling-stroke" />
              <text x={axisX} y={y(tv)} dy="0.32em" textAnchor={anchor} className="num fill-[var(--ink-subtle)] text-2xs">{fmt(Math.round(tv))}</text>
            </g>
          ))}
          {!empty && n > 1 && layers.slice().reverse().map((l) => <path key={`a-${l.s.key}`} d={pathsOf(l).area} fill={l.s.color} fillOpacity={stacked ? 0.55 : 0.12} />)}
          {!empty && layers.map((l) => (
            n > 1 ? <path key={`l-${l.s.key}`} d={pathsOf(l).line} fill="none" stroke={l.s.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              : <circle key={`l-${l.s.key}`} cx={xOf(0)} cy={y(l.top[0]!)} r={3} fill={l.s.color} />
          ))}
          {data.map((d, i) => (
            <g key={d.label} tabIndex={0} role="presentation" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="cursor-default outline-none">
              <rect x={xOf(i) - col / 2} y={padT} width={col} height={innerH} fill="transparent" />
              {hover === i && !empty && (
                <>
                  <line x1={xOf(i)} x2={xOf(i)} y1={padT} y2={padT + innerH} stroke="var(--rule-strong)" vectorEffect="non-scaling-stroke" />
                  {layers.map((l) => <circle key={l.s.key} cx={xOf(i)} cy={y(l.top[i]!)} r={3.5} fill="var(--surface-raised)" stroke={l.s.color} strokeWidth={2} />)}
                </>
              )}
              {i % every === 0 && <text x={xOf(i)} y={H - 6} textAnchor="middle" className="fill-[var(--ink-subtle)] text-2xs">{d.short}</text>}
            </g>
          ))}
        </svg>
        {empty && <div className="absolute inset-0 grid place-items-center text-meta text-steel"><span className="rounded-full border border-rule bg-surface-raised px-3 py-1">{emptyLabel}</span></div>}
        {h && hover != null && !empty && <ChartTip x={xOf(hover)} W={W} title={h.label} series={series} values={h.values} fmt={fmt} />}
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">{caption}</figcaption>
      <ChartTable id={id} data={data} series={series} dateLabel={t("chart.date")} fmt={fmt} />
    </figure>
  )
}

export interface StackRow { key: string; label: React.ReactNode; segments: { key: string; label: string; value: number; color: string }[] }

/** One horizontal bar per category, all on the same scale, with the row total at the end. Screen readers get a list with the numbers. */
export function StackedRows({ rows, caption, className }: { rows: StackRow[]; caption: string; className?: string }) {
  const fmt = useNum()
  const totals = rows.map((r) => r.segments.reduce((n, x) => n + x.value, 0))
  const max = Math.max(1, ...totals)
  return (
    <ul className={cn("space-y-2", className)} aria-label={caption}>
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(5.5rem,9rem)_minmax(0,1fr)_2.5rem] items-center gap-x-3 text-meta">
          <span className="truncate text-steel">{r.label}</span>
          <span className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--viz-grid)]" aria-hidden>
            <span className="flex h-full gap-0.5" style={{ width: `${(totals[i]! / max) * 100}%` }}>
              {r.segments.filter((x) => x.value > 0).map((x) => <span key={x.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ flex: x.value, background: x.color }} />)}
            </span>
          </span>
          <span className="num text-end font-semibold text-ink">{fmt(totals[i]!)}<span className="sr-only">: {r.segments.map((x) => `${x.label} ${fmt(x.value)}`).join(", ")}</span></span>
        </li>
      ))}
    </ul>
  )
}

export function Donut({ segments, total, label, size = 148, thickness = 16 }: { segments: { key: string; label: string; value: number; color: string }[]; total?: number; label: React.ReactNode; size?: number; thickness?: number }) {
  const id = useId()
  const fmt = useNum()
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0)
  const r = (size - thickness) / 2, c = 2 * Math.PI * r
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 2 : 0
  let offset = 0
  return (
    <figure className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 rtl:-scale-x-100" role="img" aria-labelledby={`${id}-cap`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-grid)" strokeWidth={thickness} />
        {sum > 0 && segments.filter((s) => s.value > 0).map((s) => {
          const len = (s.value / sum) * c
          const el = <circle key={s.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness} strokeDasharray={`${Math.max(0, len - gap)} ${c}`} strokeDashoffset={-offset} />
          offset += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div><p className="num text-display leading-none font-semibold text-ink">{fmt(sum)}</p><p className="mt-1 text-caption text-steel">{label}</p></div>
      </div>
      <figcaption id={`${id}-cap`} className="sr-only">{`${fmt(sum)}: ${segments.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}`}</figcaption>
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
