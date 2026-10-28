"use client"

import { useState } from "react"

import type { MenuKey } from "@unitravel/contracts"
import type { MessageKey } from "@unitravel/i18n"

import { Field, inDays, inputCls, ServiceFormFrame, today } from "@/components/service-form"
import { useI18n } from "@/lib/i18n"

type Vertical = { type: "HOTEL" | "STAY"; kind: "stay" } | { type: "TRAIN" | "BUS"; kind: "ground" }
const TITLE: Record<Vertical["type"], MessageKey> = { HOTEL: "services.hotelsTitle", STAY: "services.staysTitle", TRAIN: "services.trainsTitle", BUS: "services.busesTitle" }
const MENU: Record<Vertical["type"], MenuKey> = { HOTEL: "hotels", STAY: "stays", TRAIN: "trains", BUS: "buses" }

/**
 * Hotels, villas and stays, trains and buses (ADR-0015 §verticals). No provider is contracted, so there are no listings:
 * with the flag off the page says the service is not available; with it on, the customer describes what they need and
 * staff find options. Listings are never faked (rule 2). When a provider exists, its results replace the form.
 */
export function VerticalRequest(v: Vertical) {
  const { t } = useI18n()
  const [stay, setStay] = useState({ location: "", checkIn: inDays(30), checkOut: inDays(33), guests: 2, rooms: 1, note: "" })
  const [ground, setGround] = useState({ from: "", to: "", date: inDays(14), passengers: 1, note: "" })
  const note = (s: string) => (s.trim() ? { note: s.trim() } : {})
  const details = v.kind === "stay"
    ? { location: stay.location.trim(), checkIn: stay.checkIn, checkOut: stay.checkOut, guests: stay.guests, rooms: stay.rooms, ...note(stay.note) }
    : { from: ground.from.trim(), to: ground.to.trim(), date: ground.date, passengers: ground.passengers, ...note(ground.note) }
  const valid = v.kind === "stay"
    ? stay.location.trim().length >= 2 && stay.checkOut > stay.checkIn && stay.guests >= 1 && stay.rooms >= 1
    : ground.from.trim().length >= 2 && ground.to.trim().length >= 2 && !!ground.date && ground.passengers >= 1
  return (
    <ServiceFormFrame type={v.type} menuKey={MENU[v.type]} title={t(TITLE[v.type])} lead={t("services.listingLead")} details={details} valid={valid}>
      {v.kind === "stay" ? (
        <>
          <div className="sm:col-span-2"><Field id="s-loc" label={t("services.location")}><input id="s-loc" className={inputCls} dir="auto" maxLength={120} value={stay.location} onChange={(e) => setStay({ ...stay, location: e.target.value })} required /></Field></div>
          <Field id="s-in" label={t("services.checkIn")}><input id="s-in" type="date" className={inputCls} min={today()} value={stay.checkIn} onChange={(e) => setStay({ ...stay, checkIn: e.target.value })} required /></Field>
          <Field id="s-out" label={t("services.checkOut")}><input id="s-out" type="date" className={inputCls} min={stay.checkIn} value={stay.checkOut} onChange={(e) => setStay({ ...stay, checkOut: e.target.value })} aria-invalid={stay.checkOut <= stay.checkIn} required /></Field>
          <Field id="s-guests" label={t("services.guests")}><input id="s-guests" type="number" inputMode="numeric" min={1} max={20} className={inputCls} value={stay.guests} onChange={(e) => setStay({ ...stay, guests: Number(e.target.value) })} /></Field>
          <Field id="s-rooms" label={t("services.rooms")}><input id="s-rooms" type="number" inputMode="numeric" min={1} max={10} className={inputCls} value={stay.rooms} onChange={(e) => setStay({ ...stay, rooms: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field id="s-note" label={t("services.note")} optional><textarea id="s-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={stay.note} onChange={(e) => setStay({ ...stay, note: e.target.value })} /></Field></div>
        </>
      ) : (
        <>
          <Field id="g-from" label={t("services.from")}><input id="g-from" className={inputCls} dir="auto" maxLength={120} value={ground.from} onChange={(e) => setGround({ ...ground, from: e.target.value })} required /></Field>
          <Field id="g-to" label={t("services.to")}><input id="g-to" className={inputCls} dir="auto" maxLength={120} value={ground.to} onChange={(e) => setGround({ ...ground, to: e.target.value })} required /></Field>
          <Field id="g-date" label={t("services.date")}><input id="g-date" type="date" className={inputCls} min={today()} value={ground.date} onChange={(e) => setGround({ ...ground, date: e.target.value })} required /></Field>
          <Field id="g-pax" label={t("services.passengers")}><input id="g-pax" type="number" inputMode="numeric" min={1} max={20} className={inputCls} value={ground.passengers} onChange={(e) => setGround({ ...ground, passengers: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2"><Field id="g-note" label={t("services.note")} optional><textarea id="g-note" className="field min-h-24 w-full" dir="auto" maxLength={1000} value={ground.note} onChange={(e) => setGround({ ...ground, note: e.target.value })} /></Field></div>
        </>
      )}
    </ServiceFormFrame>
  )
}
