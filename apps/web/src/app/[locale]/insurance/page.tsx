"use client"

import { useState } from "react"

import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

const REGIONS = ["UK", "SCHENGEN", "EUROPE", "WORLDWIDE_EXCL_AMERICAS", "WORLDWIDE"] as const

/** Travel insurance request (ADR-0015, O7): not a policy and no price before a quote; hidden until counsel clears it. */
export default function InsurancePage() {
  const { t } = useI18n()
  const [f, setF] = useState({ destinationRegion: "SCHENGEN" as (typeof REGIONS)[number], startDate: inDays(30), endDate: inDays(44), note: "" })
  const details = { destinationRegion: f.destinationRegion, startDate: f.startDate, endDate: f.endDate, ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  return (
    <ServiceFormFrame type="INSURANCE" menuKey="insurance" title={t("services.insuranceTitle")} lead={t("services.insuranceLead")} withTravellers details={details} valid={!!f.startDate && !!f.endDate && f.endDate >= f.startDate}>
      <Field id="i-region" label={t("services.region")}>
        <select id="i-region" className={inputCls} value={f.destinationRegion} onChange={(e) => setF({ ...f, destinationRegion: e.target.value as typeof f.destinationRegion })}>{REGIONS.map((r) => <option key={r} value={r}>{t(`services.regions.${r}`)}</option>)}</select>
      </Field>
      <span aria-hidden className="hidden sm:block" />
      <Field id="i-start" label={t("services.startDate")}><input id="i-start" type="date" className={inputCls} min={today()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></Field>
      <Field id="i-end" label={t("services.endDate")}><input id="i-end" type="date" className={inputCls} min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} aria-invalid={f.endDate < f.startDate} required /></Field>
      <div className="sm:col-span-2"><Field id="i-note" label={t("services.note")} optional><textarea id="i-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
