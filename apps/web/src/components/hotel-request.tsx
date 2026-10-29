"use client"

import { useState } from "react"

import { ACCOMMODATION_TYPES, MEAL_PLANS, ROOM_TYPES } from "@unitravel/contracts"

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
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
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
  const none = <option value="">{t("hotels.noPreference")}</option>

  return (
    <ServiceFormFrame embedded type="HOTEL" menuKey="hotels" title={t("hotels.requestTitle")} lead={t("hotels.requestLead")} details={details} valid={valid}>
      <div className="sm:col-span-2"><Field id="h-loc" label={t("services.location")}><input id="h-loc" className={inputCls} dir="auto" maxLength={120} value={f.location} onChange={(e) => set({ location: e.target.value })} required /></Field></div>
      <Field id="h-in" label={t("services.checkIn")}><input id="h-in" type="date" className={inputCls} min={today()} value={f.checkIn} onChange={(e) => set({ checkIn: e.target.value })} required /></Field>
      <Field id="h-out" label={t("services.checkOut")}><input id="h-out" type="date" className={inputCls} min={f.checkIn} value={f.checkOut} onChange={(e) => set({ checkOut: e.target.value })} aria-invalid={f.checkOut <= f.checkIn} required /></Field>
      <Field id="h-guests" label={t("services.guests")}><input id="h-guests" type="number" inputMode="numeric" min={1} max={20} className={inputCls} value={f.guests} onChange={(e) => set({ guests: Number(e.target.value) })} /></Field>
      <Field id="h-rooms" label={t("services.rooms")}><input id="h-rooms" type="number" inputMode="numeric" min={1} max={10} className={inputCls} value={f.rooms} onChange={(e) => set({ rooms: Number(e.target.value) })} /></Field>
      <Field id="h-type" label={t("hotels.accommodationType")} optional>
        <select id="h-type" className={inputCls} value={f.accommodationType} onChange={(e) => set({ accommodationType: e.target.value })}>{none}{ACCOMMODATION_TYPES.map((v) => <option key={v} value={v}>{t(`hotels.accommodationTypes.${v}`)}</option>)}</select>
      </Field>
      <Field id="h-stars" label={t("hotels.minStars")} optional>
        <select id="h-stars" className={inputCls} value={f.minStars} onChange={(e) => set({ minStars: e.target.value })}>{none}{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{t("hotels.stars", { n })}</option>)}</select>
      </Field>
      <Field id="h-room" label={t("hotels.roomType")} optional>
        <select id="h-room" className={inputCls} value={f.roomType} onChange={(e) => set({ roomType: e.target.value })}>{none}{ROOM_TYPES.map((v) => <option key={v} value={v}>{t(`hotels.roomTypes.${v}`)}</option>)}</select>
      </Field>
      <Field id="h-meal" label={t("hotels.mealPlan")} optional>
        <select id="h-meal" className={inputCls} value={f.mealPlan} onChange={(e) => set({ mealPlan: e.target.value })}>{none}{MEAL_PLANS.map((v) => <option key={v} value={v}>{t(`hotels.mealPlans.${v}`)} ({v})</option>)}</select>
      </Field>
      <label className="flex items-start gap-3 text-sm sm:col-span-2 pointer-coarse:min-h-11">
        <input type="checkbox" className="mt-0.5 size-4 accent-orange" checked={f.cheapestFirst} onChange={(e) => set({ cheapestFirst: e.target.checked })} />
        {t("hotels.cheapestFirst")}
      </label>
      <div className="sm:col-span-2"><Field id="h-note" label={t("services.note")} optional><textarea id="h-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field></div>
    </ServiceFormFrame>
  )
}
