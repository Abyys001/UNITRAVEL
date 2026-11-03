"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import {
  ENTRIES, RULE_PURPOSES, type RulePurpose, type StaffDocumentTypeView, type VisaFacts, type VisaRuleView, type VisaStatus, VISA_STATUSES, type VerificationState,
} from "@unitravel/contracts"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { StatusChip } from "@/components/bento"
import { codeLabel, localInput } from "@/components/club"
import { FormDialog } from "@/components/form-dialog"
import { Field } from "@/components/ui"
import { api } from "@/lib/api"
import { type T, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"

/**
 * Shared pieces of the visa console (ADR-0033): chips, the facts editor and the staff-change dialogs. Every change a person
 * makes here is audited by the API; an override needs a reason and an official source URL (the domain gate checks it too).
 */

const names: Record<string, Intl.DisplayNames> = {}
export function countryLabel(code: string | null | undefined, locale: string): string {
  if (!code) return "—"
  try { names[locale] ??= new Intl.DisplayNames([locale], { type: "region" }); return names[locale]!.of(code) ?? code } catch { return code }
}
export function Country({ code }: { code: string | null | undefined }) {
  const [locale] = useLocale()
  return <span title={code ?? undefined}>{countryLabel(code, locale)} <span className="font-mono text-caption text-steel" dir="ltr">{code}</span></span>
}

export const STATUS_TONE: Record<VisaStatus, "ok" | "info" | "warn" | "danger" | "neutral"> = {
  VISA_FREE: "ok", EVISA: "info", ETA: "info", VISA_ON_ARRIVAL: "warn", VISA_REQUIRED: "warn", TRANSIT_VISA: "warn", SPECIAL_PERMISSION: "warn", NOT_ACCEPTED: "danger", UNCONFIRMED: "neutral",
}
export const VERIFICATION_TONE: Record<VerificationState, "ok" | "info" | "warn" | "danger" | "neutral"> = { VERIFIED: "ok", OVERRIDDEN: "info", CONFLICT: "danger", UNVERIFIED: "neutral" }

export const VisaStatusChip = ({ s }: { s: VisaStatus }) => { const t = useT(); return <StatusChip tone={STATUS_TONE[s]}><span data-status={s}>{codeLabel(t, "vz.st", s)}</span></StatusChip> }
export const VerificationChip = ({ v }: { v: VerificationState }) => { const t = useT(); return <StatusChip tone={VERIFICATION_TONE[v]}><span data-verification={v}>{codeLabel(t, "vz.v", v)}</span></StatusChip> }

export const isStaleRule = (r: Pick<VisaRuleView, "expiresAt" | "verification">) => r.verification !== "OVERRIDDEN" && (!r.expiresAt || new Date(r.expiresAt).getTime() <= Date.now())

export function useDocTypes() {
  return useQuery({ queryKey: ["visa", "doc-types"], queryFn: () => api<StaffDocumentTypeView[]>("/v1/admin/visa/document-types"), staleTime: 60_000 })
}
export function DocName({ code }: { code: string }) {
  const [locale] = useLocale()
  const d = useDocTypes().data?.find((x) => x.code === code)
  return <span title={code}>{d ? (locale === "fa" ? d.name.fa : d.name.en) : code}</span>
}

/** Renders any fact value, with null shown as "not confirmed" (UNKNOWN). */
export function factText(t: T, k: keyof VisaFacts, v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return t("vz.unknown")
  if (typeof v === "boolean") return v ? t("vz.yes") : t("vz.no")
  if (k === "status") return codeLabel(t, "vz.st", String(v))
  if (k === "entries") return codeLabel(t, "vz.e", String(v))
  if (Array.isArray(v)) return v.join(" · ")
  return String(v)
}
export const FACT_KEYS: (keyof VisaFacts)[] = ["status", "documentAccepted", "maxStay", "entries", "passportValidity", "blankPages", "applyOnline", "embassyAppointment", "fee", "processingTime", "applicationUrl", "airsideTransitWithoutVisa", "conditions"]

// ---------------- facts editor ----------------

interface FactsDraft {
  status: VisaStatus; documentAccepted: string; maxStay: string; entries: string; passportValidity: string; blankPages: string; applyOnline: string; embassyAppointment: string
  fee: string; processingTime: string; applicationUrl: string; conditions: string; airsideTransitWithoutVisa: string
}
const tri = (b: boolean | null) => (b === null ? "" : b ? "true" : "false")
const untri = (s: string) => (s === "" ? null : s === "true")
const txt = (s: string) => (s.trim() ? s.trim() : null)
export const factsDraft = (f: VisaFacts): FactsDraft => ({
  status: f.status, documentAccepted: tri(f.documentAccepted), maxStay: f.maxStay ?? "", entries: f.entries ?? "", passportValidity: f.passportValidity ?? "", blankPages: f.blankPages ?? "",
  applyOnline: tri(f.applyOnline), embassyAppointment: tri(f.embassyAppointment), fee: f.fee ?? "", processingTime: f.processingTime ?? "", applicationUrl: f.applicationUrl ?? "",
  conditions: f.conditions.join("\n"), airsideTransitWithoutVisa: tri(f.airsideTransitWithoutVisa),
})
export const draftFacts = (d: FactsDraft): VisaFacts => ({
  status: d.status, documentAccepted: untri(d.documentAccepted), maxStay: txt(d.maxStay), entries: (d.entries || null) as VisaFacts["entries"], passportValidity: txt(d.passportValidity),
  blankPages: txt(d.blankPages), applyOnline: untri(d.applyOnline), embassyAppointment: untri(d.embassyAppointment), fee: txt(d.fee), processingTime: txt(d.processingTime),
  applicationUrl: txt(d.applicationUrl), conditions: d.conditions.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 20), airsideTransitWithoutVisa: untri(d.airsideTransitWithoutVisa),
})
export const EMPTY_DRAFT: FactsDraft = factsDraft({
  status: "UNCONFIRMED", documentAccepted: null, maxStay: null, entries: null, passportValidity: null, blankPages: null, applyOnline: null, embassyAppointment: null, fee: null,
  processingTime: null, applicationUrl: null, conditions: [], airsideTransitWithoutVisa: null,
})

function TriSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const t = useT()
  return (
    <Field label={label}>
      <NativeSelect className="field-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("vz.unknown")}</option><option value="true">{t("vz.yes")}</option><option value="false">{t("vz.no")}</option>
      </NativeSelect>
    </Field>
  )
}

export function FactsEditor({ d, set }: { d: FactsDraft; set: (d: FactsDraft) => void }) {
  const t = useT()
  const up = <K extends keyof FactsDraft>(k: K, v: FactsDraft[K]) => set({ ...d, [k]: v })
  const text = (k: "maxStay" | "passportValidity" | "blankPages" | "fee" | "processingTime", max: number) => (
    <Field label={codeLabel(t, "vz.f", k)}><input className="field-input" value={d[k]} onChange={(e) => up(k, e.target.value)} maxLength={max} dir="auto" placeholder={t("vz.unknown")} /></Field>
  )
  return (
    <fieldset className="space-y-3 rounded-lg border border-rule p-3">
      <legend className="px-1 text-meta font-medium text-ink">{t("vz.facts")}</legend>
      <p className="text-caption text-steel">{t("vz.facts.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("vz.f.status")}>
          <NativeSelect className="field-input" value={d.status} onChange={(e) => up("status", e.target.value as VisaStatus)} data-testid="visa-status">{VISA_STATUSES.map((s) => <option key={s} value={s}>{codeLabel(t, "vz.st", s)}</option>)}</NativeSelect>
        </Field>
        <TriSelect label={t("vz.f.documentAccepted")} value={d.documentAccepted} onChange={(v) => up("documentAccepted", v)} />
        <Field label={t("vz.f.entries")}>
          <NativeSelect className="field-input" value={d.entries} onChange={(e) => up("entries", e.target.value)}><option value="">{t("vz.unknown")}</option>{ENTRIES.map((x) => <option key={x} value={x}>{codeLabel(t, "vz.e", x)}</option>)}</NativeSelect>
        </Field>
        {text("maxStay", 200)}
        {text("passportValidity", 300)}
        {text("blankPages", 200)}
        <TriSelect label={t("vz.f.applyOnline")} value={d.applyOnline} onChange={(v) => up("applyOnline", v)} />
        <TriSelect label={t("vz.f.embassyAppointment")} value={d.embassyAppointment} onChange={(v) => up("embassyAppointment", v)} />
        <TriSelect label={t("vz.f.airsideTransitWithoutVisa")} value={d.airsideTransitWithoutVisa} onChange={(v) => up("airsideTransitWithoutVisa", v)} />
        {text("fee", 300)}
        {text("processingTime", 300)}
        <Field label={t("vz.f.applicationUrl")}><input type="url" className="field-input" value={d.applicationUrl} onChange={(e) => up("applicationUrl", e.target.value)} maxLength={500} dir="ltr" placeholder="https://" /></Field>
      </div>
      <Field label={t("vz.f.conditions")} hint={t("vz.f.conditions.hint")}><textarea className="field-input min-h-20" value={d.conditions} onChange={(e) => up("conditions", e.target.value)} dir="auto" /></Field>
    </fieldset>
  )
}

/** Reason + official URLs: both required for any override (ADR-0033 point 5). */
function Justification({ reason, setReason, urls, setUrls }: { reason: string; setReason: (s: string) => void; urls: string; setUrls: (s: string) => void }) {
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("vz.reason")} hint={t("vz.reason.hint")}><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} dir="auto" data-testid="visa-reason" /></Field>
      <Field label={t("vz.urls")} hint={t("vz.urls.hint")}><textarea className="field-input min-h-20 font-mono text-meta" value={urls} onChange={(e) => setUrls(e.target.value)} required dir="ltr" placeholder="https://" data-testid="visa-urls" /></Field>
    </div>
  )
}
const urlList = (s: string) => s.split(/\s+/).map((u) => u.trim()).filter(Boolean).slice(0, 10)

export function OverrideDialog({ rule, onOpenChange }: { rule: VisaRuleView; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [d, setD] = useState(factsDraft(rule.facts))
  const [reason, setReason] = useState("")
  const [urls, setUrls] = useState("")
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={t("vz.override")} description={t("vz.override.desc")} submitLabel={t("vz.override.save")} testId="dlg-visa-override"
      onSubmit={async () => {
        await api(`/v1/admin/visa/rules/${rule.id}`, { method: "PATCH", body: { version: rule.version, verification: "OVERRIDDEN", facts: draftFacts(d), reason: reason.trim(), officialUrls: urlList(urls) } })
        await qc.invalidateQueries({ queryKey: ["visa"] })
      }}>
      <FactsEditor d={d} set={setD} />
      <Justification reason={reason} setReason={setReason} urls={urls} setUrls={setUrls} />
    </FormDialog>
  )
}

export function CreateRuleDialog({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const docs = useDocTypes()
  const [key, setKey] = useState({ destination: "", documentType: "GB_CITIZEN_PASSPORT", issuingCountry: "GB", purpose: "VISIT" as RulePurpose })
  const [d, setD] = useState(EMPTY_DRAFT)
  const [reason, setReason] = useState("")
  const [urls, setUrls] = useState("")
  const [expires, setExpires] = useState("")
  const fixed = docs.data?.find((x) => x.code === key.documentType)?.issuingCountry ?? null
  return (
    <FormDialog open onOpenChange={onOpenChange} wide title={t("vz.newRule")} description={t("vz.newRule.desc")} submitLabel={t("vz.newRule.save")} testId="dlg-visa-new"
      onSubmit={async () => {
        await api("/v1/admin/visa/rules", { body: {
          destination: key.destination.toUpperCase(), documentType: key.documentType, issuingCountry: (fixed ?? key.issuingCountry).toUpperCase(), purpose: key.purpose,
          facts: draftFacts(d), reason: reason.trim(), officialUrls: urlList(urls), expiresAt: expires ? new Date(expires).toISOString() : null,
        } })
        await qc.invalidateQueries({ queryKey: ["visa"] })
      }}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={t("vz.destination")}><input className="field-input font-mono uppercase" value={key.destination} onChange={(e) => setKey({ ...key, destination: e.target.value })} required pattern="[A-Za-z]{2}" maxLength={2} dir="ltr" placeholder="TR" /></Field>
        <Field label={t("vz.document")}>
          <NativeSelect className="field-input" value={key.documentType} onChange={(e) => setKey({ ...key, documentType: e.target.value })}>{docs.data?.map((x) => <option key={x.code} value={x.code}>{x.name.en}</option>)}</NativeSelect>
        </Field>
        <Field label={t("vz.issuer")}><input className="field-input font-mono uppercase" value={fixed ?? key.issuingCountry} disabled={!!fixed} onChange={(e) => setKey({ ...key, issuingCountry: e.target.value })} required pattern="[A-Za-z]{2}" maxLength={2} dir="ltr" /></Field>
        <Field label={t("vz.purpose")}><NativeSelect className="field-input" value={key.purpose} onChange={(e) => setKey({ ...key, purpose: e.target.value as RulePurpose })}>{RULE_PURPOSES.map((p) => <option key={p} value={p}>{codeLabel(t, "vz.p", p)}</option>)}</NativeSelect></Field>
      </div>
      <FactsEditor d={d} set={setD} />
      <Justification reason={reason} setReason={setReason} urls={urls} setUrls={setUrls} />
      <Field label={t("vz.expires")} hint={t("vz.expires.hint")}><input type="datetime-local" className="field-input" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
    </FormDialog>
  )
}

/** Verify (confirm the researched answer) or withdraw (back to unconfirmed): a reason is always recorded. */
export function ReasonDialog({ rule, mode, onOpenChange }: { rule: VisaRuleView; mode: "VERIFIED" | "UNVERIFIED"; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [reason, setReason] = useState("")
  const verify = mode === "VERIFIED"
  return (
    <FormDialog open onOpenChange={onOpenChange} title={verify ? t("vz.verify") : t("vz.withdraw")} description={verify ? t("vz.verify.desc") : t("vz.withdraw.desc")} destructive={!verify}
      submitLabel={verify ? t("vz.verify") : t("vz.withdraw")} testId="dlg-visa-reason"
      onSubmit={async () => { await api(`/v1/admin/visa/rules/${rule.id}`, { method: "PATCH", body: { version: rule.version, verification: mode, reason: reason.trim() } }); await qc.invalidateQueries({ queryKey: ["visa"] }) }}>
      <Field label={t("vz.reason")}><textarea className="field-input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={1000} dir="auto" /></Field>
    </FormDialog>
  )
}

export function ExpiryDialog({ rule, onOpenChange }: { rule: VisaRuleView; onOpenChange: (o: boolean) => void }) {
  const t = useT()
  const qc = useQueryClient()
  const [v, setV] = useState(rule.expiresAt ? localInput(new Date(rule.expiresAt)) : "")
  return (
    <FormDialog open onOpenChange={onOpenChange} title={t("vz.setExpiry")} description={t("vz.expires.hint")} submitLabel={t("vz.save")}
      onSubmit={async () => { await api(`/v1/admin/visa/rules/${rule.id}`, { method: "PATCH", body: { version: rule.version, expiresAt: v ? new Date(v).toISOString() : null } }); await qc.invalidateQueries({ queryKey: ["visa"] }) }}>
      <Field label={t("vz.expires")}><input type="datetime-local" className="field-input" value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </FormDialog>
  )
}
