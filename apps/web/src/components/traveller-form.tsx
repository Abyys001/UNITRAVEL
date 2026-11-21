"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { TravellerInput, TravellerView } from "@unitravel/contracts"
import { toAsciiDigits } from "@unitravel/i18n"
import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { CountrySelect } from "@unitravel/ui/product/country"
import { Auto } from "@/components/badges"
import { DateField, SelectField } from "@/components/form"
import { api, ApiError } from "@/lib/api"
import { COUNTRIES, countryName } from "@/lib/countries"
import { useI18n } from "@/lib/i18n"

/** Names exactly as in the passport (Latin); passport fields are optional until a quote is accepted (ch. 11.6). */
export function TravellerForm({ initial, onSaved, withDocument = false, prefill }: { initial?: TravellerView; onSaved: (t: TravellerView) => void; withDocument?: boolean; prefill?: { givenNames: string; surname: string; nameFa: string } }) {
  const { t, sep, locale } = useI18n()
  // One SELF per customer: offer it only while none exists (the API enforces it separately).
  const hasSelf = useQuery({ queryKey: ["travellers"], queryFn: () => api<TravellerView[]>("/v1/me/travellers"), enabled: !initial }).data?.some((x) => x.relationship === "SELF") ?? false
  const [f, setF] = useState({ title: initial?.title ?? "MR", givenNames: initial?.givenNames ?? prefill?.givenNames ?? "", surname: initial?.surname ?? prefill?.surname ?? "", nameFa: initial?.nameFa ?? prefill?.nameFa ?? "", dateOfBirth: initial?.dateOfBirth ?? "", genderOnDocument: initial?.genderOnDocument ?? "M", nationality: initial?.nationality ?? "IR", relationship: initial?.relationship ?? (hasSelf ? "FAMILY" : "SELF") })
  const [doc, setDoc] = useState({ number: "", issuingCountry: "IR", expiryDate: "" })
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setTried(true)
    const needsExpiry = withDocument || !!doc.number
    if (!f.dateOfBirth || (needsExpiry && !doc.expiryDate)) return
    if ((withDocument || doc.number) && !/^[A-Z0-9]{5,20}$/.test(doc.number)) { setLocalErr(t("flow.passportDigits")); return }
    setLocalErr(null); setBusy(true)
    const body: Partial<TravellerInput> = { ...f, nameFa: f.nameFa || null, title: f.title as TravellerInput["title"], genderOnDocument: f.genderOnDocument as "M", relationship: f.relationship as "SELF" }
    if (withDocument || doc.number) body.document = { type: "PASSPORT", ...doc }
    try { onSaved(await api<TravellerView>(initial ? `/v1/me/travellers/${initial.id}` : "/v1/me/travellers", { method: initial ? "PATCH" : "POST", body })) } catch (x) { setErr(x as ApiError) } finally { setBusy(false) }
  }
  const field = "mt-1 h-10"
  const todayIso = new Date().toISOString().slice(0, 10)
  const plusYears = `${new Date().getUTCFullYear() + 20}-12-31`
  return (
    <form onSubmit={save} className="grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2">
      <SelectField id="tf-title" label={t("account.honorific")} value={f.title} onChange={(v) => set("title", v)} options={["MR", "MRS", "MS", "MISS", "MSTR", "DR"].map((x) => ({ value: x, label: t(`honorifics.${x}` as never) }))} />
      <SelectField id="tf-rel" label={t("account.relationship")} value={f.relationship} onChange={(v) => set("relationship", v)} options={[{ value: "SELF", label: t("account.self") }, { value: "FAMILY", label: t("account.family") }, { value: "OTHER", label: t("account.other") }]} />
      <label className="text-sm">{t("auth.given")}<Input className={field} dir="ltr" required value={f.givenNames} onChange={(e) => set("givenNames", e.target.value)} aria-invalid={!!err?.field("givenNames")} /></label>
      <label className="text-sm">{t("auth.surname")}<Input className={field} dir="ltr" required value={f.surname} onChange={(e) => set("surname", e.target.value)} aria-invalid={!!err?.field("surname")} /></label>
      <label className="text-sm">{t("auth.nameFa")}<Input className={field} dir="rtl" lang="fa" value={f.nameFa} onChange={(e) => set("nameFa", e.target.value)} /></label>
      <DateField id="tf-dob" label={t("account.dob")} value={f.dateOfBirth} max={todayIso} yearJump required error={tried && !f.dateOfBirth ? t("guide.common.required") : undefined} onChange={(v) => set("dateOfBirth", v)} />
      <SelectField id="tf-gender" label={t("account.gender")} value={f.genderOnDocument} onChange={(v) => set("genderOnDocument", v)} options={(["M", "F", "X"] as const).map((x) => ({ value: x, label: t(`genders.${x}`) }))} />
      <label className="text-sm">{t("account.nationality")}<CountrySelect wrapperClassName="mt-1" className="field h-10 w-full" value={f.nationality} onChange={(e) => set("nationality", e.target.value)}>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}</CountrySelect></label>
      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
        <legend className="mb-1 text-sm font-medium">{t("account.passport")} {!withDocument && <span className="font-normal text-steel">({t("common.optional")})</span>}</legend>
        <label className="text-sm">{t("account.passportNumber")}<Input className={field} dir="ltr" required={withDocument} value={doc.number} autoComplete="off" onChange={(e) => setDoc({ ...doc, number: toAsciiDigits(e.target.value).replace(/\s+/g, "").toUpperCase() })} aria-invalid={!!localErr} /></label>
        <label className="text-sm">{t("account.issuing")}<CountrySelect wrapperClassName="mt-1" className="field h-10 w-full" value={doc.issuingCountry} onChange={(e) => setDoc({ ...doc, issuingCountry: e.target.value })}>{COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, locale)}</option>)}</CountrySelect></label>
        <DateField id="tf-expiry" label={t("account.expiry")} value={doc.expiryDate} min={todayIso} max={plusYears} yearJump required={withDocument || !!doc.number} optional={!(withDocument || doc.number)} error={tried && (withDocument || doc.number) && !doc.expiryDate ? t("guide.common.required") : undefined} onChange={(expiryDate) => setDoc({ ...doc, expiryDate })} />
      </fieldset>
      {localErr && <p role="alert" className="text-sm text-danger sm:col-span-2">{localErr}</p>}
      {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err.code === "SELF_TRAVELLER_EXISTS" ? t("account.selfExists") : err.problem.errors?.some((x) => x.path.endsWith("document.number")) ? t("flow.passportDigits") : <Auto>{err.problem.errors?.map((x) => `${x.path}: ${x.message}`).join(sep) || err.message}</Auto>}</p>}
      <div className="sm:col-span-2"><Button type="submit" disabled={busy}>{t("common.save")}</Button></div>
    </form>
  )
}
