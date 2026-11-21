"use client"

import { ArrowRight, CalendarDays } from "lucide-react"
import { useRef, useState } from "react"

import { nightsBetween } from "@unitravel/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { Calendar, useDateParts } from "@/components/calendar"
import { useI18n } from "@/lib/i18n"

import { fieldAria, FieldShell, type FieldMessages } from "./field-shell"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export interface DateRangeFieldProps extends FieldMessages {
  idIn: string
  idOut: string
  checkIn: string
  checkOut: string
  min: string
  max?: string
  onChange: (patch: { checkIn?: string; checkOut?: string }) => void
  /** Defaults to check-in / check-out. */
  labels?: { start: string; end: string; pickStart?: string; pickEnd?: string }
  /** Text between the two dates for a span of `n` days; defaults to nights, `false` hides it. */
  countLabel?: false | ((n: number) => string)
  /** Shortest span in days (1 for nights, 0 for a same-day return). */
  minSpan?: number
  /** Optional field label; without it the caller labels the control (Stays does). */
  label?: React.ReactNode
  testId?: string
  calendarTestId?: string
}

/**
 * Two dates as one control, in the visitor's calendar (Solar Hijri or Gregorian) with the other calendar's
 * months under each title. The hidden inputs carry the values for the sign-in draft (form-draft), which restores by id.
 */
export function DateRangeField({ idIn, idOut, checkIn, checkOut, min, max, onChange, labels, countLabel, minSpan = 1, label, hint, error, required, optional, testId = "stay-dates", calendarTestId = "stay-calendar" }: DateRangeFieldProps) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const cursorRef = useRef<HTMLButtonElement | null>(null)
  const nights = nightsBetween(checkIn, checkOut)
  const parts = useDateParts()
  const show = (iso: string) => { const p = parts(iso); return `${p.weekday} ${p.date}` }
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(nights)
  const startLabel = labels?.start ?? t("services.checkIn")
  const endLabel = labels?.end ?? t("services.checkOut")
  const count = countLabel === false ? null : countLabel ? countLabel(nights) : nights === 1 ? t("stays.nightOne") : t("stays.nights", { n })
  const ariaLabel = labels ? `${startLabel}: ${show(checkIn)}, ${endLabel}: ${show(checkOut)}` : t("stays.changeDates", { checkIn: show(checkIn), checkOut: show(checkOut) })
  const part = (l: string, iso: string) => (
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-medium text-steel">{l} · {parts(iso).weekday}</span>
      <span className="mt-0.5 block font-semibold text-navy-950">{parts(iso).date}</span>
    </span>
  )
  const controlId = `${idIn}-control`
  const control = (
    <div>
      <input id={idIn} hidden value={checkIn} onChange={(e) => ISO_DATE.test(e.target.value) && onChange({ checkIn: e.target.value })} />
      <input id={idOut} hidden value={checkOut} onChange={(e) => ISO_DATE.test(e.target.value) && onChange({ checkOut: e.target.value })} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button" id={controlId} data-testid={testId} aria-label={ariaLabel} {...(label ? fieldAria(idIn, { hint, error, required }) : {})}
          className="flex w-full items-center gap-3 rounded-xl border border-line bg-cloud px-3 py-2.5 text-start text-sm outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger data-[popup-open]:border-orange data-[popup-open]:bg-white"
        >
          <CalendarDays className="size-5 shrink-0 text-orange-700" aria-hidden />
          {part(startLabel, checkIn)}
          <span className="flex shrink-0 flex-col items-center gap-0.5 px-1 text-xs font-semibold text-orange-700">
            <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
            {count ? <span className="whitespace-nowrap">{count}</span> : null}
          </span>
          {part(endLabel, checkOut)}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} initialFocus={cursorRef} style={{ background: "#fff", backdropFilter: "none" }} className="w-[min(calc(100vw-2rem),22rem)] rounded-2xl p-4 md:w-[42rem]">
          <Calendar
            mode="range" start={checkIn} end={checkOut} min={min} max={max} today={min} minSpan={minSpan} cursorRef={cursorRef} testId={calendarTestId}
            labels={{ start: startLabel, end: endLabel, pickStart: labels?.pickStart ?? t("stays.pickCheckIn"), pickEnd: labels?.pickEnd ?? t("stays.pickCheckOut") }}
            onCommit={(a, b) => { if (b) { onChange({ checkIn: a, checkOut: b }); setOpen(false) } }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
  return label ? <FieldShell id={idIn} controlId={controlId} label={label} hint={hint} error={error} required={required} optional={optional}>{control}</FieldShell> : control
}
