"use client"

import { useState } from "react"

import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
import { COUNTRIES, countryName } from "@/lib/countries"
import { useI18n } from "@/lib/i18n"

const PURPOSES = ["TOURISM", "BUSINESS", "STUDY", "FAMILY", "TRANSIT"] as const

/** Visa services (ADR-0015, O6): a request for help, never a visa application. Hidden while services.visa.enabled is off. */
export default function VisaPage() {
  const { t, locale } = useI18n()
  const [f, setF] = useState({ destinationCountry: "GB", purpose: "TOURISM" as (typeof PURPOSES)[number], intendedTravelDate: inDays(30), linkedFlightRequestRef: "", note: "" })
  const details = { destinationCountry: f.destinationCountry, purpose: f.purpose, intendedTravelDate: f.intendedTravelDate, ...(f.linkedFlightRequestRef.trim() ? { linkedFlightRequestRef: f.linkedFlightRequestRef.trim().toUpperCase() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  return (
    <ServiceFormFrame type="VISA" menuKey="visa" title={t("services.visaTitle")} lead={t("services.visaLead")} withTravellers details={details} valid={!!f.intendedTravelDate}>
      <Field id="v-dest" label={t("services.destinationCountry")}>
        <select id="v-dest" className={inputCls} value={f.destinationCountry} onChange={(e) => setF({ ...f, destinationCountry: e.target.value })}>{COUNTRIES.filter((c) => c !== "IR").map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}</select>
      </Field>
      <Field id="v-purpose" label={t("services.purpose")}>
        <select id="v-purpose" className={inputCls} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as typeof f.purpose })}>{PURPOSES.map((p) => <option key={p} value={p}>{t(`services.purposes.${p}`)}</option>)}</select>
      </Field>
      <Field id="v-date" label={t("services.intendedTravelDate")}><input id="v-date" type="date" className={inputCls} min={today()} value={f.intendedTravelDate} onChange={(e) => setF({ ...f, intendedTravelDate: e.target.value })} required /></Field>
      <Field id="v-ref" label={t("services.linkedFlight")} optional><input id="v-ref" className={inputCls} dir="ltr" placeholder="UT-…" value={f.linkedFlightRequestRef} onChange={(e) => setF({ ...f, linkedFlightRequestRef: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field id="v-note" label={t("services.note")} optional><textarea id="v-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
