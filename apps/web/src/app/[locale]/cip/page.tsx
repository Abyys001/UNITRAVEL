"use client"

import { useState } from "react"

import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

const FLIGHT_NO = /^[A-Z0-9]{2,3} ?\d{1,4}[A-Z]?$/

/** CIP at Tehran Imam Khomeini only (owner); hidden while services.cip.enabled is off (O9, counsel). */
export default function CipPage() {
  const { t } = useI18n()
  const [f, setF] = useState({ direction: "DEPARTURE" as "ARRIVAL" | "DEPARTURE", flightNumber: "", date: inDays(14), passengersCount: 1, note: "" })
  const flightNumber = f.flightNumber.trim().toUpperCase()
  const details = { airport: "IKA", direction: f.direction, flightNumber, date: f.date, passengersCount: f.passengersCount, ...(f.note.trim() ? { note: f.note.trim() } : {}) }
  const valid = FLIGHT_NO.test(flightNumber) && !!f.date && f.passengersCount >= 1 && f.passengersCount <= 20
  return (
    <ServiceFormFrame type="CIP" menuKey="cip" title={t("services.cipTitle")} lead={t("services.cipLead")} details={details} valid={valid}>
      <Field id="c-airport" label={t("services.airport")}><input id="c-airport" className={inputCls} value={t("services.airportIka")} readOnly aria-readonly /></Field>
      <Field id="c-dir" label={t("services.direction")}>
        <select id="c-dir" className={inputCls} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as typeof f.direction })}>{(["DEPARTURE", "ARRIVAL"] as const).map((d) => <option key={d} value={d}>{t(`services.directions.${d}`)}</option>)}</select>
      </Field>
      <Field id="c-flight" label={t("services.flightNumber")}><input id="c-flight" className={inputCls} dir="ltr" placeholder="TK 878" value={f.flightNumber} onChange={(e) => setF({ ...f, flightNumber: e.target.value })} aria-invalid={!!flightNumber && !FLIGHT_NO.test(flightNumber)} required /></Field>
      <Field id="c-date" label={t("services.date")}><input id="c-date" type="date" className={inputCls} min={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
      <Field id="c-count" label={t("services.passengersCount")}><input id="c-count" type="number" inputMode="numeric" min={1} max={20} className={inputCls} value={f.passengersCount} onChange={(e) => setF({ ...f, passengersCount: Number(e.target.value) })} required /></Field>
      <div className="sm:col-span-2"><Field id="c-note" label={t("services.note")} optional><textarea id="c-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
