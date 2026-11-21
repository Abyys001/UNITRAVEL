"use client"

import { Baby, Ban, ChevronDown, Clock, Handshake, Info, UsersRound } from "lucide-react"

import { useI18n } from "@/lib/i18n"

import { CIP_OPTIONS, WHEN_TONE } from "./cip-options"

// ADR-0041 D6: options backed by the operator's pages are stated plainly; FAST_TRACK is "subject to confirmation".
// No prices, and nothing here is a booking.

/** One card per CIP option, with when it applies. */
export function CipServices() {
  const { t } = useI18n()
  return (
    <section id="cip-services" aria-labelledby="cip-services-title" className="scroll-mt-24">
      <h2 id="cip-services-title" className="font-display text-2xl md:text-3xl">{t("guide.cip.servicesTitle")}</h2>
      <p className="mt-2 max-w-3xl leading-7 text-steel">{t("guide.cip.servicesLead")}</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="cip-services">
        {CIP_OPTIONS.map(({ id, icon: Icon, when }) => (
          <li key={id} className="card-brand flex min-w-0 flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-3">
              <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-950 text-white"><Icon className="size-5" /></span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${WHEN_TONE[when]}`}>{t(`guide.cip.when.${when}`)}</span>
            </div>
            <h3 className="font-display text-lg text-navy-950">{t(`guide.cip.options.${id}.name`)}</h3>
            <p className="text-sm leading-6 text-navy-900">{t(`guide.cip.options.${id}.body`)}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Rules the operator states, said plainly; the lead time is a warning in the wizard, never a block. */
export function CipGoodToKnow() {
  const { t } = useI18n()
  const rows: [React.ComponentType<{ className?: string }>, string][] = [
    [Clock, t("guide.cip.good.leadTime")], [Baby, t("guide.cip.good.infants")], [UsersRound, t("guide.cip.good.companions")],
    [Ban, t("guide.cip.good.exclusions")], [Handshake, t("guide.cip.good.operator")],
  ]
  return (
    <section aria-labelledby="cip-good-title" className="rounded-3xl bg-navy-950 p-5 text-white md:p-8">
      <h2 id="cip-good-title" className="font-display text-2xl">{t("guide.cip.goodTitle")}</h2>
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {rows.map(([Icon, text], i) => (
          <li key={i} className="flex gap-3 text-sm leading-6 text-white/90">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-orange/80"><Icon className="size-4 text-cyan" /></span>
            <span className="pt-1.5">{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-start gap-2 border-t border-white/15 pt-4 text-sm text-white/80"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("guide.cip.noPrices")}</p>
      <p className="mt-2 text-xs text-white/60">{t("guide.cip.source")}</p>
    </section>
  )
}

export function CipHowItWorks() {
  const { t, locale } = useI18n()
  const n = new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB")
  const steps = [t("guide.cip.how1"), t("guide.cip.how2"), t("guide.cip.how3"), t("guide.cip.how4")]
  return (
    <section aria-labelledby="cip-how-title">
      <h2 id="cip-how-title" className="font-display text-2xl md:text-3xl">{t("guide.cip.howTitle")}</h2>
      <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className="relative rounded-2xl border border-line bg-white p-5 text-sm leading-6 text-navy-900">
            <span aria-hidden className="mb-3 grid size-9 place-items-center rounded-full bg-orange font-bold text-navy-950">{n.format(i + 1)}</span>
            {s}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function CipFaq() {
  const { t } = useI18n()
  const items = (["1", "2", "3", "4", "5"] as const).map((k) => [t(`guide.cip.faq.q${k}`), t(`guide.cip.faq.a${k}`)] as const)
  return (
    <section aria-labelledby="cip-faq-title">
      <h2 id="cip-faq-title" className="font-display text-2xl md:text-3xl">{t("guide.cip.faqTitle")}</h2>
      <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-white">
        {items.map(([q, a]) => (
          <details key={q} className="group px-5">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-navy-950 outline-none focus-visible:ring-[3px] focus-visible:ring-royal/50 [&::-webkit-details-marker]:hidden">
              {q}<ChevronDown className="size-4 shrink-0 text-steel transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="pb-4 text-sm leading-6 text-steel">{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
