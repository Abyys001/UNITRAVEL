"use client"

import { CalendarDays, ChevronDown } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { addDays, type CalendarKind, shiftMonth } from "@unitravel/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { Calendar, noon } from "@/components/calendar"
import { useI18n } from "@/lib/i18n"

import { fieldAria, FieldShell, type FieldMessages } from "./field-shell"
import { SelectField } from "./select-field"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const todayIso = () => new Date().toISOString().slice(0, 10)

// Latin digits so the parts parse as numbers; the visible labels come from the locale formatter.
const numFmt = { GREGORIAN: new Intl.DateTimeFormat("en-u-ca-gregory-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric" }), JALALI: new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { timeZone: "UTC", year: "numeric", month: "numeric" }) }
function yearMonth(iso: string, cal: CalendarKind) {
  const p = numFmt[cal].formatToParts(noon(iso))
  return { y: Number(p.find((x) => x.type === "year")?.value), m: Number(p.find((x) => x.type === "month")?.value) }
}

export interface DateFieldProps extends FieldMessages {
  id: string
  name?: string
  label: React.ReactNode
  /** ISO yyyy-mm-dd, or "" for no date yet. */
  value: string
  onChange: (iso: string) => void
  /** Earliest pickable day; defaults to 1900-01-01 (dates of birth). */
  min?: string
  max?: string
  placeholder?: string
  /** Year and month selects above the grid. On by default when min and max are more than two years apart. */
  yearJump?: boolean
  labelClassName?: string
  className?: string
}

/** One date on the shared calendar in the visitor's calendar (Solar Hijri or Gregorian); native date inputs cannot show Jalali. */
export function DateField({ id, name, label, value, onChange, min = "1900-01-01", max, placeholder, yearJump, hint, error, required, optional, labelClassName, className }: DateFieldProps) {
  const { t, locale, calendar, date } = useI18n()
  const [open, setOpen] = useState(false)
  const cursorRef = useRef<HTMLButtonElement | null>(null)
  const today = todayIso()
  const upper = max ?? addDays(today, 365 * 20)
  const jump = yearJump ?? yearMonth(upper, calendar).y - yearMonth(min, calendar).y > 2
  // `jumpTo` remounts the grid on the chosen month; `view` follows the grid so the selects show where it is.
  const [jumpTo, setJumpTo] = useState<string | null>(null)
  const [view, setView] = useState<string | null>(null)
  const onViewChange = useCallback((first: string) => setView(first), [])
  const controlId = `${id}-control`
  const valueId = `${id}-value`

  const shown = view ?? (value || today)
  const cur = yearMonth(shown, calendar)
  const years = useMemo(() => {
    const lo = yearMonth(min, calendar).y
    const hi = yearMonth(upper, calendar).y
    const fmt = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", { useGrouping: false })
    return Array.from({ length: hi - lo + 1 }, (_, i) => hi - i).map((y) => ({ value: String(y), label: fmt.format(y) }))
  }, [min, upper, calendar, locale])
  const months = useMemo(() => {
    const first = shiftMonth(shown, 1 - cur.m, calendar)
    const fmt = new Intl.DateTimeFormat(locale === "fa" ? `fa-IR-u-ca-${calendar === "JALALI" ? "persian" : "gregory"}` : `en-GB-u-ca-${calendar === "JALALI" ? "persian" : "gregory"}`, { timeZone: "UTC", month: "long" })
    return Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: fmt.format(noon(shiftMonth(first, i, calendar))) }))
  }, [shown, cur.m, calendar, locale])
  const goto = (y: number, m: number) => {
    let target = shiftMonth(shown, (y - cur.y) * 12 + (m - cur.m), calendar)
    if (target < min) target = min
    if (target > upper) target = upper
    setJumpTo(target)
  }

  const onOpenChange = (o: boolean, details?: { reason?: string; event?: Event }) => {
    // The year/month popups are portalled outside this popover; picking from them is not a click outside.
    if (!o && details?.reason === "outside-press" && (details.event?.target as Element | null)?.closest?.("[data-slot=select-content]")) return
    setOpen(o)
    if (o) { setJumpTo(null); setView(null) }
  }

  return (
    <FieldShell id={id} controlId={controlId} label={label} hint={hint} error={error} required={required} optional={optional} labelClassName={labelClassName} className={className}>
      <input id={id} name={name} hidden value={value} onChange={(e) => { if (e.target.value === "" || ISO_DATE.test(e.target.value)) onChange(e.target.value) }} />
      <Popover open={open} onOpenChange={onOpenChange}>
        {/* No aria-required: it is not allowed on a button (axe aria-allowed-attr). */}
        <PopoverTrigger
          type="button" id={controlId} aria-labelledby={`${id}-label ${valueId}`} {...fieldAria(id, { hint, error })}
          className="group flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-cloud px-3 text-start text-base outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger data-[popup-open]:border-orange data-[popup-open]:bg-white"
        >
          <CalendarDays className="size-5 shrink-0 text-orange-700" aria-hidden />
          <span id={valueId} className={`min-w-0 flex-1 truncate ${value ? "font-semibold text-navy-950" : "text-steel"}`}>{value ? date(value, { dateOnly: true, year: true, weekday: true }) : (placeholder ?? t("guide.common.pickDate"))}</span>
          <ChevronDown className="size-4 shrink-0 text-steel transition-transform group-data-[popup-open]:rotate-180" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} initialFocus={cursorRef} style={{ background: "#fff", backdropFilter: "none" }} className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl p-4 md:w-[42rem]">
          {jump && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <SelectField id={`${id}-jump-month`} label={t("guide.common.month")} hideLabel value={String(cur.m)} options={months} onChange={(m) => goto(cur.y, Number(m))} triggerClassName="h-10 text-sm" />
              <SelectField id={`${id}-jump-year`} label={t("guide.common.year")} hideLabel value={String(cur.y)} options={years} onChange={(y) => goto(Number(y), cur.m)} triggerClassName="h-10 text-sm" />
            </div>
          )}
          {open && (
            <Calendar
              key={jumpTo ?? "initial"} mode="single" start={value} min={min} max={max} today={today} cursorRef={cursorRef} initialCursor={jumpTo ?? undefined} onViewChange={onViewChange}
              labels={{ start: typeof label === "string" ? label : t("guide.common.pickDate"), pickStart: t("guide.common.pickDate") }}
              onCommit={(d) => { onChange(d); setOpen(false) }}
              footer={value && !required ? <button type="button" onClick={() => { onChange(""); setOpen(false) }} className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-navy-950 outline-none hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11">{t("guide.common.clear")}</button> : undefined}
            />
          )}
        </PopoverContent>
      </Popover>
    </FieldShell>
  )
}
