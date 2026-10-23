"use client"

import { useState } from "react"

import type { TravellerInput, TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

const COUNTRIES = ["IR", "GB", "TR", "AM", "DE", "NL", "FR", "AT", "IQ", "AE", "AF", "US", "CA"]

/** Names exactly as in the passport (Latin); passport fields are optional until a quote is accepted (ch. 11.6). */
export function TravellerForm({ initial, onSaved, withDocument = false }: { initial?: TravellerView; onSaved: (t: TravellerView) => void; withDocument?: boolean }) {
  const { t, sep } = useI18n()
  const [f, setF] = useState({ title: initial?.title ?? "MR", givenNames: initial?.givenNames ?? "", surname: initial?.surname ?? "", nameFa: initial?.nameFa ?? "", dateOfBirth: initial?.dateOfBirth ?? "", genderOnDocument: initial?.genderOnDocument ?? "M", nationality: initial?.nationality ?? "IR", relationship: initial?.relationship ?? "SELF" })
  const [doc, setDoc] = useState({ number: "", issuingCountry: "IR", expiryDate: "" })
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    const body: Partial<TravellerInput> = { ...f, nameFa: f.nameFa || null, title: f.title as TravellerInput["title"], genderOnDocument: f.genderOnDocument as "M", relationship: f.relationship as "SELF" }
    if (withDocument || doc.number) body.document = { type: "PASSPORT", ...doc }
    try { onSaved(await api<TravellerView>(initial ? `/v1/me/travellers/${initial.id}` : "/v1/me/travellers", { method: initial ? "PATCH" : "POST", body })) } catch (x) { setErr(x as ApiError) } finally { setBusy(false) }
  }
  const field = "mt-1 h-10"
  return (
    <form onSubmit={save} className="grid gap-3 rounded-lg border border-border bg-white p-4 sm:grid-cols-2">
      <label className="text-sm">{t("account.honorific")}<select className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" value={f.title} onChange={(e) => set("title", e.target.value)}>{["MR", "MRS", "MS", "MISS", "MSTR", "DR"].map((x) => <option key={x}>{x}</option>)}</select></label>
      <label className="text-sm">{t("account.relationship")}<select className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" value={f.relationship} onChange={(e) => set("relationship", e.target.value)}><option value="SELF">{t("account.self")}</option><option value="FAMILY">{t("account.family")}</option><option value="OTHER">{t("account.other")}</option></select></label>
      <label className="text-sm">{t("auth.given")}<Input className={field} dir="ltr" required value={f.givenNames} onChange={(e) => set("givenNames", e.target.value)} aria-invalid={!!err?.field("givenNames")} /></label>
      <label className="text-sm">{t("auth.surname")}<Input className={field} dir="ltr" required value={f.surname} onChange={(e) => set("surname", e.target.value)} aria-invalid={!!err?.field("surname")} /></label>
      <label className="text-sm">{t("auth.nameFa")}<Input className={field} dir="rtl" value={f.nameFa} onChange={(e) => set("nameFa", e.target.value)} /></label>
      <label className="text-sm">{t("account.dob")}<Input className={field} type="date" required value={f.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></label>
      <label className="text-sm">{t("account.gender")}<select className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" value={f.genderOnDocument} onChange={(e) => set("genderOnDocument", e.target.value)}><option>M</option><option>F</option><option>X</option></select></label>
      <label className="text-sm">{t("account.nationality")}<select className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" value={f.nationality} onChange={(e) => set("nationality", e.target.value)}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">{t("account.passport")} {!withDocument && <span className="font-normal text-slate">({t("common.optional")})</span>}</legend>
        <label className="text-sm">{t("account.passportNumber")}<Input className={field} dir="ltr" required={withDocument} value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value.toUpperCase() })} /></label>
        <label className="text-sm">{t("account.issuing")}<select className="mt-1 h-10 w-full rounded-md border border-border bg-white px-2" value={doc.issuingCountry} onChange={(e) => setDoc({ ...doc, issuingCountry: e.target.value })}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm">{t("account.expiry")}<Input className={field} type="date" required={withDocument || !!doc.number} value={doc.expiryDate} onChange={(e) => setDoc({ ...doc, expiryDate: e.target.value })} /></label>
      </fieldset>
      {err && <p role="alert" className="text-sm text-brick sm:col-span-2">{err.problem.errors?.map((x) => `${x.path}: ${x.message}`).join(sep) || err.message}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{t("common.save")}</Button></div>
    </form>
  )
}
