"use client"

import { useState } from "react"

import { ACCOMMODATION_TYPES, MEAL_PLANS, ROOM_TYPES } from "@unitravel/contracts"

import { CounterField, DateRangeField, SelectField } from "@/components/form"
import { ServiceIntro } from "@/components/service-intro"
import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

/**
 * Hotel request form on the hotels page (ADR-0017): the five-step workflow's first two steps. Destination, dates and
 * guests are required; the preferences are optional and only sent when chosen. It creates a HOTEL service request
 * (ADR-0015); staff compare hotels and answer with a quote. No listing or price is ever shown here.
 */
export function HotelRequest() {
  const { t } = useI18n()
  const [f, setF] = useState({ location: "", checkIn: inDays(30), checkOut: inDays(33), guests: 2, rooms: 1, accommodationType: "", minStars: "", roomType: "", mealPlan: "", cheapestFirst: false, note: "" })
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }))
  const details = {
    location: f.location.trim(), checkIn: f.checkIn, checkOut: f.checkOut, guests: f.guests, rooms: f.rooms,
    ...(f.accommodationType ? { accommodationType: f.accommodationType } : {}),
    ...(f.minStars ? { minStars: Number(f.minStars) } : {}),
    ...(f.roomType ? { roomType: f.roomType } : {}),
    ...(f.mealPlan ? { mealPlan: f.mealPlan } : {}),
    ...(f.cheapestFirst ? { cheapestFirst: true } : {}),
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
  }
  const valid = f.location.trim().length >= 2 && f.checkOut > f.checkIn && f.guests >= 1 && f.rooms >= 1
  const NONE = "__none"
  const pref = (id: string, label: string, key: "accommodationType" | "minStars" | "roomType" | "mealPlan", options: { value: string; label: string }[]) => (
    <SelectField id={id} label={label} optional value={f[key] || NONE} onChange={(v) => set({ [key]: v === NONE ? "" : v })} options={[{ value: NONE, label: t("hotels.noPreference") }, ...options]} />
  )

  return (
    <>
    <ServiceIntro service="hotels" className="mb-6" />
    <ServiceFormFrame embedded type="HOTEL" menuKey="hotels" title={t("hotels.requestTitle")} lead={t("hotels.requestLead")} details={details} valid={valid}>
      <div className="sm:col-span-2"><Field id="h-loc" label={t("services.location")}><input id="h-loc" className={inputCls} dir="auto" maxLength={120} value={f.location} onChange={(e) => set({ location: e.target.value })} required /></Field></div>
      <div className="sm:col-span-2"><DateRangeField idIn="h-in" idOut="h-out" checkIn={f.checkIn} checkOut={f.checkOut} min={today()} onChange={set} required /></div>
      <CounterField variant="field" id="h-guests" label={t("services.guests")} value={f.guests} min={1} max={20} onChange={(guests) => set({ guests })} />
      <CounterField variant="field" id="h-rooms" label={t("services.rooms")} value={f.rooms} min={1} max={10} onChange={(rooms) => set({ rooms })} />
      {pref("h-type", t("hotels.accommodationType"), "accommodationType", ACCOMMODATION_TYPES.map((v) => ({ value: v, label: t(`hotels.accommodationTypes.${v}`) })))}
      {pref("h-stars", t("hotels.minStars"), "minStars", [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: t("hotels.stars", { n }) })))}
      {pref("h-room", t("hotels.roomType"), "roomType", ROOM_TYPES.map((v) => ({ value: v, label: t(`hotels.roomTypes.${v}`) })))}
      {pref("h-meal", t("hotels.mealPlan"), "mealPlan", MEAL_PLANS.map((v) => ({ value: v, label: `${t(`hotels.mealPlans.${v}`)} (${v})` })))}
      <label className="flex items-start gap-3 text-sm sm:col-span-2 pointer-coarse:min-h-11">
        <input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={f.cheapestFirst} onChange={(e) => set({ cheapestFirst: e.target.checked })} />
        {t("hotels.cheapestFirst")}
      </label>
      <div className="sm:col-span-2"><Field id="h-note" label={t("services.note")} optional><textarea id="h-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
    </>
  )
}
