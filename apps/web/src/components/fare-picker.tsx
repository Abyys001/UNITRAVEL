"use client"

import { Clock, Info, Luggage } from "lucide-react"

import type { PublicCondition, PublicFare } from "@unitravel/contracts"

import { useI18n } from "@/lib/i18n"
import { ago } from "@/lib/relative-time"

import { Ltr } from "./badges"
import { BagText } from "./itinerary-view"

const CABIN_KEY = { ECONOMY: "fare.cabinEconomy", PREMIUM_ECONOMY: "fare.cabinPremium", BUSINESS: "fare.cabinBusiness", FIRST: "fare.cabinFirst" } as const
const STATE_KEY = { KNOWN_ALLOWED: "itinerary.allowed", NOT_ALLOWED: "itinerary.notAllowed", UNKNOWN: "fare.conditionUnknown" } as const

function Condition({ label, c }: { label: string; c: PublicCondition }) {
  const { t } = useI18n()
  return <p><span className="text-steel">{label}: </span><span className={c.state === "UNKNOWN" ? "font-semibold text-warning-subtle-fg" : "font-semibold"}>{t(STATE_KEY[c.state])}</span></p>
}

/** The fare as the customer saw it: seats, baggage, conditions, deadline and age. No prices anywhere (ADR-0037 D4). `9` is a cap, never a count. */
export function FareFacts({ fare }: { fare: PublicFare }) {
  const { t, locale, date, sep } = useI18n()
  // One line per segment: the adult entry when present, since the customer view carries no per-passenger prices or rules.
  const bags = [...new Set(fare.baggage.map((b) => b.segmentIndex))].sort((x, y) => x - y)
    .map((i) => fare.baggage.find((b) => b.segmentIndex === i && b.passengerType === "ADT") ?? fare.baggage.find((b) => b.segmentIndex === i)!)
  return (
    <div className="space-y-3 text-sm" data-testid="fare-facts">
      <ul className="space-y-1">
        {fare.seats.map((s, i) => (
          <li key={i}>
            <span className="text-steel">{t("fare.segment", { n: i + 1 })}{sep}</span>
            {s.atCap ? t("fare.seatsCap", { n: Number(s.raw) }) : s.count !== null ? t("fare.seats", { n: s.count }) : t("fare.seatsUnknown")}
          </li>
        ))}
      </ul>
      <ul className="space-y-1">
        {bags.map((b, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-1.5"><Luggage aria-hidden className="size-3.5 text-steel" /><span className="text-steel">{t("fare.segment", { n: b.segmentIndex + 1 })}{sep}</span><BagText b={b} />
            {b.sourceText && <span className="text-xs text-steel">({t("fare.source", { text: b.sourceText })})</span>}</li>
        ))}
      </ul>
      <div className="grid gap-1 sm:grid-cols-2">
        <Condition label={t("itinerary.change")} c={fare.conditions.change} />
        <Condition label={t("itinerary.refund")} c={fare.conditions.refund} />
      </div>
      {fare.ticketingDeadline && <p><span className="text-steel">{t("fare.deadline")}: </span><span className="font-semibold">{date(fare.ticketingDeadline, { dateOnly: true })}</span></p>}
      {fare.deadlineWarning && <p role="note" data-testid="deadline-warning" className="flex items-start gap-2 rounded-xl bg-warning-subtle px-3 py-2 text-warning-subtle-fg"><Info aria-hidden className="mt-0.5 size-4 shrink-0" />{t("fare.deadlineWarning")}</p>}
      <p className={`flex items-center gap-1.5 text-xs ${fare.freshness === "STALE" || fare.freshness === "EXPIRED" ? "font-semibold text-orange-700" : "text-steel"}`}><Clock aria-hidden className="size-3.5" />{t("fare.observed", { ago: ago(fare.observedAt, locale) })}{(fare.freshness === "STALE" || fare.freshness === "EXPIRED") && <>{sep}{t("fare.mayHaveChanged")}</>}</p>
    </div>
  )
}

function FareTitle({ fare }: { fare: PublicFare }) {
  const { t, sep } = useI18n()
  return <span className="font-semibold">{t(CABIN_KEY[fare.cabin])}{fare.bookingClasses.length > 0 && <>{sep}{t("fare.bookingClass")} <Ltr className="font-mono">{fare.bookingClasses.join(" / ")}</Ltr></>}</span>
}

export function FareSummary({ fare }: { fare: PublicFare }) {
  return <div className="rounded-xl border border-line bg-cloud px-4 py-3"><p className="mb-2"><FareTitle fare={fare} /></p><FareFacts fare={fare} /></div>
}

/** Accessible radio group of booking-class options, ordered by the API (cabin then class, never price). */
export function FarePicker({ fares, value, onChange }: { fares: PublicFare[]; value: string | null; onChange: (id: string) => void }) {
  const { t } = useI18n()
  return (
    <fieldset data-testid="fare-picker" className="mt-6">
      <legend className="font-display text-xl">{t("fare.pickTitle")}</legend>
      <p className="mb-3 mt-1 text-sm text-steel">{t("fare.snapshotNote")}</p>
      <div role="radiogroup" aria-label={t("fare.pickTitle")} className="space-y-3">
        {fares.map((f) => (
          <label key={f.id} data-testid="fare-option" className={`block cursor-pointer rounded-2xl border p-4 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange ${value === f.id ? "border-orange bg-white shadow-sm" : "border-line bg-white/60"}`}>
            <span className="flex items-center gap-3"><input type="radio" name="fare" value={f.id} checked={value === f.id} onChange={() => onChange(f.id)} className="size-4 accent-orange pointer-coarse:size-5" /><FareTitle fare={f} /></span>
            <span className="mt-3 block ps-7"><FareFacts fare={f} /></span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
