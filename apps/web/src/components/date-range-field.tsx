"use client"

import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { addDays, calendarLocale, type CalendarKind, firstOfMonth, monthWeeks, nightsBetween, shiftMonth, weekdaySample } from "@unitravel/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { useI18n } from "@/lib/i18n"

const noon = (iso: string) => new Date(`${iso}T12:00:00Z`)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

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
  const { start, end, min, cursor, today } = panel
  const reach = end ?? (panel.hover && panel.hover > start ? panel.hover : null)
  return (
    <div className="min-w-0 flex-1">
      <div className="px-10 text-center">
        <p className="text-base font-bold text-navy-950">{title}</p>
        <p className="text-xs text-steel">{other.formatRange(noon(first), noon(last))}</p>
      </div>
      <table role="grid" aria-label={title} className="mt-3 w-full table-fixed border-collapse">
        <thead><tr>{weekdaySample(calendar).map((d) => <th key={d} scope="col" abbr={fmt({ weekday: "long" }).format(noon(d))} className="pb-1 text-xs font-medium text-steel">{fmt({ weekday: "narrow" }).format(noon(d))}</th>)}</tr></thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d, j) => {
                if (!d) return <td key={j} />
                const isEdge = d === start || d === end
                const inRange = !!reach && d >= start && d <= reach && start !== reach
                return (
                  <td key={d} className={`p-0 py-0.5 ${inRange ? `bg-orange/15 ${d === start ? "rounded-s-full" : ""} ${d === reach ? "rounded-e-full" : ""}` : ""}`}>
                    <button
                      type="button" data-day={d} ref={d === cursor ? cursorRef : undefined} tabIndex={d === cursor ? 0 : -1} disabled={d < min}
                      aria-label={full.format(noon(d))} aria-pressed={isEdge} aria-current={d === today ? "date" : undefined}
                      onClick={() => panel.pick(d)} onMouseEnter={() => panel.setHover(d)} onFocus={() => panel.setHover(d)}
                      className={`mx-auto flex aspect-square w-full max-w-11 items-center justify-center rounded-full text-sm tabular-nums outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:cursor-not-allowed disabled:text-steel/40 pointer-coarse:min-h-11 ${isEdge ? "bg-orange font-bold text-navy-950" : "text-navy-950 enabled:hover:bg-orange/25"} ${d === today && !isEdge ? "ring-1 ring-inset ring-royal/60" : ""}`}
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

interface Panel { start: string; end: string | null; min: string; cursor: string; today: string; hover: string | null; setHover: (d: string | null) => void; pick: (d: string) => void }

function CalendarPanel({ checkIn, checkOut, min, today, onCommit, cursorRef }: { checkIn: string; checkOut: string; min: string; today: string; onCommit: (a: string, b: string) => void; cursorRef: React.RefObject<HTMLButtonElement | null> }) {
  const { t, calendar, locale } = useI18n()
  const [range, setRange] = useState<{ start: string; end: string | null }>({ start: checkIn, end: checkOut })
  const [picking, setPicking] = useState<"start" | "end">("start")
  const [cursor, setCursor] = useState(checkIn)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState(firstOfMonth(checkIn, calendar))
  // Set once when the panel opens: a resize while it is open should not rearrange the months under the pointer.
  const [count] = useState(() => (window.matchMedia("(min-width: 768px)").matches ? 2 : 1))
  const moved = useRef(false)
  const months = Array.from({ length: count }, (_, i) => shiftMonth(view, i, calendar))
  const canGoBack = view > firstOfMonth(min, calendar)

  useEffect(() => {
    if (moved.current) cursorRef.current?.focus()
    moved.current = false
  }, [cursor, view, cursorRef])

  const pick = (d: string) => {
    setCursor(d)
    if (picking === "end" && d > range.start) {
      setRange({ start: range.start, end: d })
      onCommit(range.start, d)
      return
    }
    setRange({ start: d, end: null })
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
  const panel: Panel = { start: range.start, end: range.end, min, cursor, today, hover, setHover, pick }
  const navBtn = "absolute top-0 z-10 flex size-9 items-center justify-center rounded-full border border-line bg-white text-navy-950 outline-none transition-colors hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:opacity-40 pointer-coarse:size-11"
  return (
    <div onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)} data-testid="stay-calendar">
      <div className="relative">
        <button type="button" className={`${navBtn} start-0`} disabled={!canGoBack} aria-label={t("stays.prevMonth")} onClick={() => setView(shiftMonth(view, -1, calendar))}><ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /></button>
        <button type="button" className={`${navBtn} end-0`} aria-label={t("stays.nextMonth")} onClick={() => setView(shiftMonth(view, 1, calendar))}><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></button>
        <div className="flex gap-6">{months.map((m) => <Month key={m} first={m} panel={panel} cursorRef={cursorRef} />)}</div>
      </div>
      <p role="status" className="mt-3 border-t border-line pt-3 text-center text-sm font-medium text-steel">{picking === "end" ? t("stays.pickCheckOut") : t("stays.pickCheckIn")}</p>
    </div>
  )
}

/**
 * Check-in and check-out as one control, in the visitor's calendar (Solar Hijri or Gregorian) with the other calendar's
 * months under each title. The hidden inputs carry the values for the sign-in draft (form-draft), which restores by id.
 */
export function DateRangeField({ idIn, idOut, checkIn, checkOut, min, onChange }: { idIn: string; idOut: string; checkIn: string; checkOut: string; min: string; onChange: (patch: { checkIn?: string; checkOut?: string }) => void }) {
  const { t, calendar, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const cursorRef = useRef<HTMLButtonElement | null>(null)
  const nights = nightsBetween(checkIn, checkOut)
  // Composed from parts: fa-IR's own pattern for these options reads "۱۴۰۵ آذر ۱۰, سه‌شنبه".
  const parts = (iso: string) => {
    const p = new Intl.DateTimeFormat(calendarLocale(locale, calendar), { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(noon(iso))
    const get = (type: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === type)?.value ?? ""
    return { weekday: get("weekday"), date: `${get("day")} ${get("month")} ${get("year")}` }
  }
  const show = (iso: string) => { const p = parts(iso); return `${p.weekday} ${p.date}` }
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(nights)
  const part = (label: string, iso: string) => (
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-medium text-steel">{label} · {parts(iso).weekday}</span>
      <span className="mt-0.5 block font-semibold text-navy-950">{parts(iso).date}</span>
    </span>
  )
  return (
    <div>
      <input id={idIn} hidden value={checkIn} onChange={(e) => ISO_DATE.test(e.target.value) && onChange({ checkIn: e.target.value })} />
      <input id={idOut} hidden value={checkOut} onChange={(e) => ISO_DATE.test(e.target.value) && onChange({ checkOut: e.target.value })} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button" data-testid="stay-dates" aria-label={t("stays.changeDates", { checkIn: show(checkIn), checkOut: show(checkOut) })}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-cloud px-3 py-2.5 text-start text-sm outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 data-[popup-open]:border-orange data-[popup-open]:bg-white"
        >
          <CalendarDays className="size-5 shrink-0 text-orange-700" aria-hidden />
          {part(t("services.checkIn"), checkIn)}
          <span className="flex shrink-0 flex-col items-center gap-0.5 px-1 text-xs font-semibold text-orange-700">
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            <span className="whitespace-nowrap">{nights === 1 ? t("stays.nightOne") : t("stays.nights", { n })}</span>
          </span>
          {part(t("services.checkOut"), checkOut)}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} initialFocus={cursorRef} style={{ background: "#fff", backdropFilter: "none" }} className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl p-4 md:w-[42rem]">
          <CalendarPanel checkIn={checkIn} checkOut={checkOut} min={min} today={min} cursorRef={cursorRef} onCommit={(a, b) => { onChange({ checkIn: a, checkOut: b }); setOpen(false) }} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
