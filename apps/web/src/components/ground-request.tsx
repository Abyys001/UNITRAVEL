"use client"

import { ArrowDown, ArrowLeftRight, Headset, MapPinned, ReceiptText } from "lucide-react"
import { useMemo, useState } from "react"

import type { MessageKey } from "@unitravel/i18n"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { ServiceHero } from "@/components/service-hero"
import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
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

function CitySelect({ id, label, value, onChange, popular, others }: { id: string; label: string; value: string; onChange: (id: string) => void; popular: GroundCity[]; others: GroundCity[] }) {
  const { t, locale } = useI18n()
  const option = (x: GroundCity) => <option key={x.id} value={x.id}>{x[locale]}</option>
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-navy-950">{label}</label>
      <NativeSelect id={id} className={`mt-1 ${controlCls}`} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="" disabled>{t("services.chooseCity")}</option>
        <optgroup label={t("services.popularCities")}>{popular.map(option)}</optgroup>
        <optgroup label={t("services.allCities")}>{others.map(option)}</optgroup>
      </NativeSelect>
    </div>
  )
}

/** Train and bus pages: a brand hero holding the route card, then the shared request frame (ADR-0015). Nothing here is a timetable or an offer. */
export function GroundRequest({ mode }: { mode: GroundMode }) {
  const copy = COPY[mode]
  const { t, locale } = useI18n()
  const [g, setG] = useState({ from: "", to: "", date: inDays(14), passengers: 1, note: "" })
  const { popular, others, name } = useMemo(() => {
    const collate = new Intl.Collator(locale)
    const sorted = (xs: readonly GroundCity[]) => [...xs].sort((a, b) => collate.compare(a[locale], b[locale]))
    const { popular: p, other } = GROUND_CITIES[mode]
    const byId = new Map([...p, ...other].map((x) => [x.id, x[locale]]))
    return { popular: [...p], others: sorted(other), name: (id: string) => byId.get(id) ?? "" }
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
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto_1fr]">
            <CitySelect id="g-from" label={t("services.from")} value={g.from} onChange={(from) => setG((x) => ({ ...x, from }))} popular={popular} others={others} />
            <button type="button" className="mt-6 hidden size-11 place-items-center self-center rounded-full border-2 border-orange bg-white text-navy-900 transition-transform hover:rotate-180 motion-reduce:transition-none md:grid" aria-label={t("services.swapCities")} onClick={() => setG((x) => ({ ...x, from: x.to, to: x.from }))}><ArrowLeftRight className="size-4" aria-hidden /></button>
            <CitySelect id="g-to" label={t("services.to")} value={g.to} onChange={(to) => setG((x) => ({ ...x, to }))} popular={popular} others={others} />
          </div>
          {same && <p role="alert" className="mt-2 text-sm font-semibold text-danger">{t("services.sameCity")}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div>
              <label htmlFor="g-date" className="text-sm font-semibold text-navy-950">{t("services.date")}</label>
              <input id="g-date" type="date" className={`mt-1 ${controlCls}`} min={today()} value={g.date} onChange={(e) => setG((x) => ({ ...x, date: e.target.value }))} required />
            </div>
            <div>
              <label htmlFor="g-pax" className="text-sm font-semibold text-navy-950">{t("services.passengers")}</label>
              <input id="g-pax" type="number" inputMode="numeric" min={1} max={20} className={`mt-1 ${controlCls}`} value={g.passengers} onChange={(e) => setG((x) => ({ ...x, passengers: Number(e.target.value) }))} />
            </div>
            <a href="#request-details" className="btn-orange h-12 sm:col-span-2 md:col-span-1">{t("services.continueDetails")}<ArrowDown className="size-4" aria-hidden /></a>
          </div>
          <p className="mt-4 text-sm leading-6 text-steel" data-testid="ground-note">{t("services.routeNote")}</p>
        </div>
    </ServiceHero>
  )

  return (
    <ServiceFormFrame type={mode} menuKey={copy.menu} title={t(copy.title)} lead="" hero={hero} details={details} valid={valid}>
      <div className="sm:col-span-2">
        <Field id="g-note" label={t("services.note")} optional><textarea id="g-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={g.note} onChange={(e) => setG((x) => ({ ...x, note: e.target.value }))} /></Field>
      </div>
    </ServiceFormFrame>
  )
}
