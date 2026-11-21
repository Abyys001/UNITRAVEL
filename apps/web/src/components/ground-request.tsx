"use client"

import { ArrowDown, ArrowLeftRight, Headset, MapPinned, ReceiptText } from "lucide-react"
import { useMemo, useState } from "react"

import type { MessageKey } from "@unitravel/i18n"

import { ComboField, type ComboItem, CounterField, DateField } from "@/components/form"
import { ServiceIntro } from "@/components/service-intro"
import { ServiceHero } from "@/components/service-hero"
import { Field, inDays, ServiceFormFrame, today } from "@/components/service-form"
import { GROUND_CITIES, type GroundCity, type GroundMode } from "@/lib/ground-places"
import { useI18n } from "@/lib/i18n"

const COPY = {
  TRAIN: { menu: "trains", scene: "train", title: "services.trainsTitle", eyebrow: "services.trainsEyebrow", heroTitle: "services.trainsHeroTitle", accent: "services.trainsHeroAccent", lead: "services.trainsHeroLead" },
  BUS: { menu: "buses", scene: "bus", title: "services.busesTitle", eyebrow: "services.busesEyebrow", heroTitle: "services.busesHeroTitle", accent: "services.busesHeroAccent", lead: "services.busesHeroLead" },
} as const satisfies Record<GroundMode, { menu: "trains" | "buses"; scene: "train" | "bus"; title: MessageKey; eyebrow: MessageKey; heroTitle: MessageKey; accent: MessageKey; lead: MessageKey }>

const PERKS = [
  { icon: MapPinned, label: "services.groundPerkCities" },
  { icon: Headset, label: "services.groundPerkPerson" },
  { icon: ReceiptText, label: "services.groundPerkQuote" },
] as const

const controlCls = "h-12 w-full rounded-xl border border-line bg-cloud/60 px-3 text-base font-medium text-navy-950 focus:bg-white"

function CityCombo({ id, label, value, onChange, items, error }: { id: string; label: string; value: string; onChange: (id: string) => void; items: ComboItem[]; error?: string }) {
  const { t } = useI18n()
  // The hidden input carries the id so the sign-in draft (form-draft) can save and restore the route, as SelectField does.
  return (
    <div className="min-w-0">
      <input id={id} hidden value={value} onChange={(e) => { if (items.some((i) => i.value === e.target.value)) onChange(e.target.value) }} />
    <ComboField id={id} label={label} items={items} value={value} onChange={(v) => onChange(v)} placeholder={t("services.chooseCity")} error={error} required
      groupLabel={(g) => (g === "popular" ? t("services.popularCities") : t("services.allCities"))} triggerClassName={`group flex ${controlCls} items-center gap-2.5 text-start outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger data-[popup-open]:border-orange data-[popup-open]:bg-white`} />
    </div>
  )
}

/** Train and bus pages: a brand hero holding the route card, then the shared request frame (ADR-0015). Nothing here is a timetable or an offer. */
export function GroundRequest({ mode }: { mode: GroundMode }) {
  const copy = COPY[mode]
  const { t, locale } = useI18n()
  const [g, setG] = useState({ from: "", to: "", date: inDays(14), passengers: 1, note: "" })
  const { items, name } = useMemo(() => {
    const collate = new Intl.Collator(locale)
    const sorted = (xs: readonly GroundCity[]) => [...xs].sort((a, b) => collate.compare(a[locale], b[locale]))
    const { popular: p, other } = GROUND_CITIES[mode]
    // Both languages are searchable whichever one is shown, so a Persian keyboard finds "Tabriz" and a Latin one finds "تبریز".
    const item = (x: GroundCity, group: string): ComboItem => ({ value: x.id, label: x[locale], keywords: [x.en, x.fa], group })
    const byId = new Map([...p, ...other].map((x) => [x.id, x[locale]]))
    return { items: [...p.map((x) => item(x, "popular")), ...sorted(other).map((x) => item(x, "all"))], name: (id: string) => byId.get(id) ?? "" }
  }, [locale, mode])

  const same = !!g.from && g.from === g.to
  const note = g.note.trim()
  const details = { from: name(g.from), to: name(g.to), date: g.date, passengers: g.passengers, ...(note ? { note } : {}) }
  const valid = !!g.from && !!g.to && !same && !!g.date && g.passengers >= 1

  const hero = (
    <ServiceHero testId="ground-hero" eyebrow={t(copy.eyebrow)} title={t(copy.heroTitle)} accent={t(copy.accent)} lead={t(copy.lead)} scene={copy.scene}
      perks={PERKS.map(({ icon, label }) => ({ icon, label: t(label) }))}>
        <div className="mt-8 rounded-[24px] border border-white/60 bg-white p-4 text-navy-950 shadow-[var(--shadow-lift)] md:p-6" data-testid="ground-route">
          <h2 className="font-display text-xl md:text-2xl">{t("services.routeTitle")}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <CityCombo id="g-from" label={t("services.from")} value={g.from} onChange={(from) => setG((x) => ({ ...x, from }))} items={items} />
            <button type="button" className="grid size-11 place-items-center justify-self-center rounded-full border-2 border-orange bg-white text-navy-900 transition-transform hover:rotate-180 motion-reduce:transition-none md:mt-6 md:self-start" aria-label={t("services.swapCities")} onClick={() => setG((x) => ({ ...x, from: x.to, to: x.from }))}><ArrowLeftRight className="size-4" aria-hidden /></button>
            <CityCombo id="g-to" label={t("services.to")} value={g.to} onChange={(to) => setG((x) => ({ ...x, to }))} items={items} error={same ? t("services.sameCity") : undefined} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <DateField id="g-date" label={t("services.date")} value={g.date} min={today()} onChange={(date) => setG((x) => ({ ...x, date }))} required />
            <CounterField variant="field" id="g-pax" label={t("services.passengers")} value={g.passengers} min={1} max={20} onChange={(passengers) => setG((x) => ({ ...x, passengers }))} />
            <a href="#request-details" className="btn-orange h-12 sm:col-span-2 md:col-span-1">{t("services.continueDetails")}<ArrowDown className="size-4" aria-hidden /></a>
          </div>
          <p className="mt-4 text-sm leading-6 text-steel" data-testid="ground-note">{t("services.routeNote")}</p>
        </div>
    </ServiceHero>
  )

  return (
    <ServiceFormFrame type={mode} menuKey={copy.menu} title={t(copy.title)} lead="" hero={hero} details={details} valid={valid}>
      <ServiceIntro service={mode === "TRAIN" ? "trains" : "buses"} className="shadow-none sm:col-span-2" />
      <div className="sm:col-span-2">
        <Field id="g-note" label={t("services.note")} optional><textarea id="g-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={g.note} onChange={(e) => setG((x) => ({ ...x, note: e.target.value }))} /></Field>
      </div>
    </ServiceFormFrame>
  )
}
