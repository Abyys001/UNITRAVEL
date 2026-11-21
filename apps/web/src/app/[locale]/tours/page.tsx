"use client"

import { useState } from "react"

import { CounterField } from "@/components/form"
import { ServiceIntro } from "@/components/service-intro"
import { Field, inputCls, ServiceFormFrame } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

/** Tours (ADR-0015, O10): a call-back request only; nothing is sold or booked on this page. */
export default function ToursPage() {
  const { t } = useI18n()
  const [f, setF] = useState({ destination: "", approxDates: "", travellersCount: 2, bestTimeToCall: "", note: "" })
  const details = { destination: f.destination.trim(), approxDates: f.approxDates.trim(), travellersCount: f.travellersCount, bestTimeToCall: f.bestTimeToCall.trim(), ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  const valid = details.destination.length >= 2 && !!details.approxDates && !!details.bestTimeToCall && f.travellersCount >= 1 && f.travellersCount <= 20
  return (
    <ServiceFormFrame type="TOUR_CALLBACK" menuKey="tours" title={t("services.toursTitle")} lead={t("services.toursLead")} details={details} valid={valid}>
      <ServiceIntro service="tours" className="shadow-none sm:col-span-2" />
      <Field id="t-dest" label={t("services.destination")}><input id="t-dest" className={inputCls} dir="auto" maxLength={120} value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} required /></Field>
      <Field id="t-dates" label={t("services.approxDates")}><input id="t-dates" className={inputCls} dir="auto" maxLength={120} value={f.approxDates} onChange={(e) => setF({ ...f, approxDates: e.target.value })} required /></Field>
      <CounterField variant="field" id="t-count" label={t("services.travellersCount")} value={f.travellersCount} min={1} max={20} onChange={(travellersCount) => setF({ ...f, travellersCount })} required />
      <Field id="t-call" label={t("services.bestTimeToCall")}><input id="t-call" className={inputCls} dir="auto" maxLength={120} value={f.bestTimeToCall} onChange={(e) => setF({ ...f, bestTimeToCall: e.target.value })} required /></Field>
      <div className="sm:col-span-2"><Field id="t-note" label={t("services.note")} optional><textarea id="t-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
