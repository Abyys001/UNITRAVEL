"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { addDays, calendarLocale, type CalendarKind, firstOfMonth, monthWeeks, shiftMonth, weekdaySample } from "@unitravel/i18n"

import { useI18n } from "@/lib/i18n"

export const noon = (iso: string) => new Date(`${iso}T12:00:00Z`)

/** Weekday, and day month year composed from parts: fa-IR's own pattern for these options reads "۱۴۰۵ آذر ۱۰, سه‌شنبه". */
export function useDateParts() {
  const { locale, calendar } = useI18n()
  return (iso: string) => {
    const p = new Intl.DateTimeFormat(calendarLocale(locale, calendar), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(noon(iso))
    const get = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? ""
    return { weekday: get("weekday"), date: `${get("day")} ${get("month")} ${get("year")}` }
  }
}

// Friday is the Iranian weekend; Saturday and Sunday the UK one.
const isWeekend = (iso: string, cal: CalendarKind) => { const d = noon(iso).getUTCDay(); return cal === "JALALI" ? d === 5 : d === 0 || d === 6 }

interface Panel { start: string | null; end: string | null; min: string; cursor: string; today: string; hover: string | null; range: boolean; setHover: (d: string | null) => void; pick: (d: string) => void }

function Month({ first, panel, cursorRef }: { first: string; panel: Panel; cursorRef: React.RefObject<HTMLButtonElement | null> }) {
  const { locale, calendar } = useI18n()
  const fmt = (o: Intl.DateTimeFormatOptions, cal: CalendarKind = calendar) => new Intl.DateTimeFormat(calendarLocale(locale, cal), { timeZone: "UTC", ...o })
  const weeks = monthWeeks(first, calendar)
  const last = addDays(shiftMonth(first, 1, calendar), -1)
  const other = fmt({ month: "short", year: "numeric" }, calendar === "JALALI" ? "GREGORIAN" : "JALALI")
  // fa-IR orders this as year then month; Persian calendars and readers expect "آذر ۱۴۰۵".
  const titleParts = fmt({ month: "long", year: "numeric" }).formatToParts(noon(first))
  const title = `${titleParts.find((p) => p.type === "month")?.value} ${titleParts.find((p) => p.type === "year")?.value}`
  const day = fmt({ day: "numeric" })
  const full = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const { start, end, min, cursor, today, range } = panel
  const reach = range && start ? (end ?? (panel.hover && panel.hover > start ? panel.hover : null)) : null
  return (
    <div className="min-w-0 flex-1">
      <div className="px-10 text-center">
        <p className="text-base font-bold text-navy-950">{title}</p>
        <p className="text-xs text-steel">{other.formatRange(noon(first), noon(last))}</p>
      </div>
      <table role="grid" aria-label={title} className="mt-3 w-full table-fixed border-collapse">
        <thead><tr>{weekdaySample(calendar).map((d) => <th key={d} scope="col" abbr={fmt({ weekday: "long" }).format(noon(d))} className={`pb-1 text-xs font-medium ${isWeekend(d, calendar) ? "text-orange-700" : "text-steel"}`}>{fmt({ weekday: "narrow" }).format(noon(d))}</th>)}</tr></thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d, j) => {
                if (!d) return <td key={j} />
                const isEdge = d === start || d === end
                const inRange = !!reach && !!start && d >= start && d <= reach && start !== reach
                return (
                  <td key={d} className={`p-0 py-0.5 ${inRange ? `bg-orange/15 ${d === start ? "rounded-s-full" : ""} ${d === reach ? "rounded-e-full" : ""}` : ""}`}>
                    <button
                      type="button" data-day={d} ref={d === cursor ? cursorRef : undefined} tabIndex={d === cursor ? 0 : -1} disabled={d < min}
                      aria-label={full.format(noon(d))} aria-pressed={isEdge} aria-current={d === today ? "date" : undefined}
                      onClick={() => panel.pick(d)} onMouseEnter={() => panel.setHover(d)} onFocus={() => panel.setHover(d)}
                      className={`mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-sm tabular-nums outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:cursor-not-allowed disabled:text-steel/40 pointer-coarse:min-h-11 ${isEdge ? "bg-orange font-bold text-navy-950 shadow-[0_4px_12px_-4px_rgb(247_148_29/0.7)]" : `${isWeekend(d, calendar) ? "text-orange-700" : "text-navy-950"} enabled:hover:bg-orange/25`} ${d === today && !isEdge ? "ring-1 ring-inset ring-royal/60" : ""}`}
                    >{day.format(noon(d))}</button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface CalendarProps {
  /** `single` commits on the first pick; `range` commits once an end on or after `start + minSpan` days is picked. */
  mode: "single" | "range"
  start: string
  end?: string | null
  /** Range mode only: start the panel on the end date (the visitor opened the second half of the trigger). */
  initialPicking?: "start" | "end"
  min: string
  today: string
  /** Shortest range in days: 1 for hotel nights, 0 for a same-day return flight. */
  minSpan?: number
  labels: { start: string; end?: string; pickStart: string; pickEnd?: string }
  onCommit: (start: string, end: string | null) => void
  cursorRef: React.RefObject<HTMLButtonElement | null>
  footer?: React.ReactNode
  testId?: string
}

/**
 * Month grid in the visitor's calendar (Solar Hijri or Gregorian) with the other calendar's months under each title,
 * roving-focus keyboard navigation (arrows, PageUp/PageDown) and two months side by side from 768px.
 */
export function Calendar({ mode, start: initialStart, end: initialEnd = null, initialPicking = "start", min, today, minSpan = 1, labels, onCommit, cursorRef, footer, testId }: CalendarProps) {
  const { t, calendar, locale } = useI18n()
  const parts = useDateParts()
  const range = mode === "range"
  const [sel, setSel] = useState<{ start: string; end: string | null }>({ start: initialStart, end: range ? initialEnd : null })
  const [picking, setPicking] = useState<"start" | "end">(range ? initialPicking : "start")
  const [cursor, setCursor] = useState(picking === "end" && initialEnd ? initialEnd : initialStart)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState(firstOfMonth(cursor, calendar))
  // Set once when the panel opens: a resize while it is open should not rearrange the months under the pointer.
  const [count] = useState(() => (window.matchMedia("(min-width: 768px)").matches ? 2 : 1))
  const moved = useRef(false)
  const months = Array.from({ length: count }, (_, i) => shiftMonth(view, i, calendar))
  const canGoBack = view > firstOfMonth(min, calendar)
  const endMin = addDays(sel.start, minSpan)

  useEffect(() => {
    if (moved.current) cursorRef.current?.focus()
    moved.current = false
  }, [cursor, view, cursorRef])

  const pick = (d: string) => {
    setCursor(d)
    if (!range) { setSel({ start: d, end: null }); onCommit(d, null); return }
    if (picking === "end" && d >= endMin) {
      setSel({ start: sel.start, end: d })
      onCommit(sel.start, d)
      return
    }
    setSel({ start: d, end: null })
    setPicking("end")
  }

  const moveTo = (d: string) => {
    const next = d < min ? min : d
    moved.current = true
    setCursor(next)
    const lastShown = addDays(shiftMonth(view, count, calendar), -1)
    if (next < view) setView(firstOfMonth(next, calendar))
    else if (next > lastShown) setView(shiftMonth(next, 1 - count, calendar))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.target as HTMLElement).dataset.day) return
    const back = locale === "fa" ? 1 : -1
    const to = { ArrowLeft: addDays(cursor, back), ArrowRight: addDays(cursor, -back), ArrowUp: addDays(cursor, -7), ArrowDown: addDays(cursor, 7), PageUp: shiftMonth(cursor, -1, calendar), PageDown: shiftMonth(cursor, 1, calendar) }[e.key]
    if (to) { e.preventDefault(); moveTo(to) }
  }
  const panel: Panel = { start: sel.start, end: sel.end, min, cursor, today, hover, range, setHover, pick }
  const navBtn = "absolute top-0 z-10 flex size-9 items-center justify-center rounded-full border border-line bg-white text-navy-950 outline-none transition-colors hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:opacity-40 pointer-coarse:size-11"
  const chip = (which: "start" | "end", label: string, iso: string | null) => (
    <button
      type="button" aria-pressed={picking === which} onClick={() => { setPicking(which); if (iso) moveTo(iso) }}
      className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-start outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-royal/50 ${picking === which ? "border-orange bg-orange/10" : "border-line bg-cloud/60 hover:border-steel/50"}`}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-steel">{label}</span>
      <span className={`block truncate text-sm font-semibold ${iso ? "text-navy-950" : "text-steel/70"}`}>{iso ? `${parts(iso).weekday} ${parts(iso).date}` : "—"}</span>
    </button>
  )
  return (
    <div onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)} data-testid={testId}>
      {range && labels.end ? <div className="mb-4 flex gap-2">{chip("start", labels.start, sel.start)}{chip("end", labels.end, sel.end)}</div> : null}
      <div className="relative">
        <button type="button" className={`${navBtn} start-0`} disabled={!canGoBack} aria-label={t("stays.prevMonth")} onClick={() => setView(shiftMonth(view, -1, calendar))}><ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /></button>
        <button type="button" className={`${navBtn} end-0`} aria-label={t("stays.nextMonth")} onClick={() => setView(shiftMonth(view, 1, calendar))}><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></button>
        <div className="flex gap-6">{months.map((m) => <Month key={m} first={m} panel={panel} cursorRef={cursorRef} />)}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p role="status" className="text-sm font-medium text-steel">{range && picking === "end" ? labels.pickEnd : labels.pickStart}</p>
        {footer}
      </div>
    </div>
  )
}
