"use client"

import { useState } from "react"

import { DateRangeField, SelectField } from "@/components/form"
import { ServiceIntro } from "@/components/service-intro"
import { Field, inDays, ServiceFormFrame, today } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

const REGIONS = ["UK", "SCHENGEN", "EUROPE", "WORLDWIDE_EXCL_AMERICAS", "WORLDWIDE"] as const

/** Travel insurance request (ADR-0015, O7): not a policy and no price before a quote; hidden until counsel clears it. */
export default function InsurancePage() {
  const { t } = useI18n()
  const [f, setF] = useState({ destinationRegion: "SCHENGEN" as (typeof REGIONS)[number], startDate: inDays(30), endDate: inDays(44), note: "" })
  const details = { destinationRegion: f.destinationRegion, startDate: f.startDate, endDate: f.endDate, ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  return (
    <ServiceFormFrame type="INSURANCE" menuKey="insurance" title={t("services.insuranceTitle")} lead={t("services.insuranceLead")} withTravellers details={details} valid={!!f.startDate && !!f.endDate && f.endDate >= f.startDate}>
      <ServiceIntro service="insurance" className="shadow-none sm:col-span-2" />
      <SelectField id="i-region" label={t("services.region")} value={f.destinationRegion} onChange={(destinationRegion) => setF({ ...f, destinationRegion: destinationRegion as typeof f.destinationRegion })} options={REGIONS.map((r) => ({ value: r, label: t(`services.regions.${r}`) }))} />
      <span aria-hidden className="hidden sm:block" />
      <div className="sm:col-span-2"><DateRangeField idIn="i-start" idOut="i-end" checkIn={f.startDate} checkOut={f.endDate} min={today()} minSpan={0} countLabel={false} labels={{ start: t("services.startDate"), end: t("services.endDate") }} onChange={(p) => setF((x) => ({ ...x, startDate: p.checkIn ?? x.startDate, endDate: p.checkOut ?? x.endDate }))} required /></div>
      <div className="sm:col-span-2"><Field id="i-note" label={t("services.note")} optional><textarea id="i-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
