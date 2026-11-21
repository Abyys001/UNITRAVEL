"use client"

import { Check, Info } from "lucide-react"
import { useId } from "react"

import { useI18n } from "@/lib/i18n"

export type IntroService = "hotels" | "trains" | "buses" | "stays" | "insurance" | "tours"

/** How many offers and steps each service has: the catalogue keys are o1..oN and s1..sN. */
const COUNTS: Record<IntroService, { offers: number; steps: number }> = {
  hotels: { offers: 4, steps: 4 }, trains: { offers: 3, steps: 4 }, buses: { offers: 3, steps: 4 },
  stays: { offers: 4, steps: 4 }, insurance: { offers: 3, steps: 4 }, tours: { offers: 4, steps: 4 },
}
const NEEDS = ["n1", "n2", "n3"] as const

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

/**
 * The same four-part introduction on every service page (ADR-0041): what you can ask for, how it works, what you need,
 * and what happens after you send. The copy never states a price, availability or guarantee, and says a request is not a booking.
 */
export function ServiceIntro({ service, className = "" }: { service: IntroService; className?: string }) {
  const { t, locale } = useI18n()
  const nf = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  const id = useId()
  const k = (rest: string) => t(`guide.services.intro.${rest}` as never)
  const { offers, steps } = COUNTS[service]
  const h = "font-display text-lg text-navy-950"
  return (
    <section aria-labelledby={`${id}-offers`} data-testid="service-intro" className={`card-brand min-w-0 p-5 md:p-6 ${className}`}>
      <h2 id={`${id}-offers`} className={h}>{k("offersTitle")}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {range(offers).map((n) => (
          <li key={n} className="flex min-w-0 gap-3 rounded-xl bg-cloud p-3">
            <Check className="mt-0.5 size-4 shrink-0 text-orange-700" aria-hidden />
            <span className="min-w-0 text-sm leading-6"><strong className="block font-semibold text-navy-950">{k(`${service}.offers.o${n}.t`)}</strong><span className="text-steel">{k(`${service}.offers.o${n}.d`)}</span></span>
          </li>
        ))}
      </ul>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          <h2 id={`${id}-steps`} className={h}>{k("stepsTitle")}</h2>
          <ol aria-labelledby={`${id}-steps`} className="mt-3 space-y-3">
            {range(steps).map((n) => (
              <li key={n} className="flex min-w-0 gap-3">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-navy-950 text-xs font-bold text-white">{nf.format(n)}</span>
                <span className="min-w-0 text-sm leading-6"><strong className="block font-semibold text-navy-950">{k(`${service}.steps.s${n}.t`)}</strong><span className="text-steel">{k(`${service}.steps.s${n}.d`)}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <h2 id={`${id}-need`} className={h}>{k("needTitle")}</h2>
            <ul aria-labelledby={`${id}-need`} className="mt-3 space-y-2">
              {NEEDS.map((n) => <li key={n} className="flex min-w-0 gap-2 text-sm leading-6"><Check className="mt-1 size-4 shrink-0 text-orange-700" aria-hidden /><span className="min-w-0">{k(`${service}.need.${n}`)}</span></li>)}
            </ul>
          </div>
          <div className="rounded-xl border-s-4 border-orange bg-orange/10 p-3 text-sm leading-6">
            <h2 className="flex items-center gap-2 font-semibold text-navy-950"><Info className="size-4 shrink-0" aria-hidden />{k("afterTitle")}</h2>
            <p className="mt-1">{k(`${service}.after`)}</p>
            <p className="mt-1 font-medium text-navy-950">{k("afterCommon")}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
