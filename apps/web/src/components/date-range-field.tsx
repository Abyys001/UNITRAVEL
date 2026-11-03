"use client"

import { ArrowRight, CalendarDays } from "lucide-react"
import { useRef, useState } from "react"

import { nightsBetween } from "@unitravel/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { useI18n } from "@/lib/i18n"

import { Calendar, useDateParts } from "./calendar"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Check-in and check-out as one control, in the visitor's calendar (Solar Hijri or Gregorian) with the other calendar's
 * months under each title. The hidden inputs carry the values for the sign-in draft (form-draft), which restores by id.
 */
export function DateRangeField({ idIn, idOut, checkIn, checkOut, min, onChange }: { idIn: string; idOut: string; checkIn: string; checkOut: string; min: string; onChange: (patch: { checkIn?: string; checkOut?: string }) => void }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const cursorRef = useRef<HTMLButtonElement | null>(null)
  const nights = nightsBetween(checkIn, checkOut)
  const parts = useDateParts()
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
          <Calendar
            mode="range" start={checkIn} end={checkOut} min={min} today={min} cursorRef={cursorRef} testId="stay-calendar"
            labels={{ start: t("services.checkIn"), end: t("services.checkOut"), pickStart: t("stays.pickCheckIn"), pickEnd: t("stays.pickCheckOut") }}
            onCommit={(a, b) => { if (b) { onChange({ checkIn: a, checkOut: b }); setOpen(false) } }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
