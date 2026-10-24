"use client"

import { useState } from "react"

import type { TravellerView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { VerificationBadge } from "@/components/verification-badge"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { uploadFile } from "@/lib/upload"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Passport scan upload and review-then-confirm for one traveller (ADR-0005). The server decides every state; this only asks. */
export function PassportVerification({ traveller, onChanged }: { traveller: TravellerView; onChanged: () => void }) {
  const { t } = useI18n()
  const v = traveller.verification
  const [busy, setBusy] = useState<"scan" | "confirm" | null>(null)
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const doc = traveller.document
  const canConfirm = !!doc && ["UNVERIFIED", "REJECTED", "CORRECTION_REQUIRED"].includes(v.status)

  const upload = async (file: File) => {
    setBusy("scan"); setMsg({ kind: "ok", text: t("identity.scanChecking") })
    try {
      const { documentId } = await uploadFile(file, "PASSPORT_SCAN")
      let status = "PENDING"
      for (let i = 0; i < 60 && status === "PENDING"; i++) { await wait(500); status = (await api<{ scanStatus: string }>(`/v1/uploads/${documentId}`)).scanStatus }
      if (status !== "CLEAN") { setMsg({ kind: "error", text: t("identity.scanFailed") }); return }
      await api(`/v1/me/travellers/${traveller.id}/identity/scan`, { body: { documentId } })
      setMsg({ kind: "ok", text: t("identity.scanReady") }); onChanged()
    } catch (e) { setMsg({ kind: "error", text: e instanceof ApiError ? e.problem.detail ?? e.problem.title : t("common.error") }) } finally { setBusy(null) }
  }
  const confirm = async () => {
    setBusy("confirm"); setMsg(null)
    try {
      await api(`/v1/me/travellers/${traveller.id}/identity/confirm`, { body: { reviewHash: v.reviewHash } })
      setMsg({ kind: "ok", text: t("identity.confirmed") }); onChanged()
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof ApiError && e.code === "VERSION_CONFLICT" ? t("identity.confirmChanged") : e instanceof ApiError ? e.problem.detail ?? e.problem.title : t("common.error") }); onChanged()
    } finally { setBusy(null) }
  }
  // Values are shown as they appear in the passport (ISO dates, Latin names), so they are compared like for like.
  const row = (label: string, value: string) => <div className="flex justify-between gap-4 py-1"><dt className="text-steel">{label}</dt><dd className="font-medium" dir="ltr">{value}</dd></div>

  return (
    <div className="space-y-4" data-testid="passport-verification">
      <div className="flex flex-wrap items-center gap-2"><VerificationBadge status={v.status} /><p className="text-sm text-steel">{t(`identity.statusHelp.${v.status}`)}</p></div>
      {v.reason && (
        <div role="note" className="rounded-xl border border-orange-700 bg-white p-3 text-sm">
          <p className="font-medium">{t("identity.reasonTitle")}</p>
          <p className="mt-1">{t(`identity.reason.${v.reason.code}`)}</p>
          {v.reason.text && <p className="mt-1 text-steel" dir="auto">{v.reason.text}</p>}
        </div>
      )}
      <div>
        <h3 className="text-sm font-medium">{t("identity.scanTitle")}</h3>
        <p className="mt-1 text-xs text-steel">{t("identity.scanHelp")}</p>
        <p className="mt-2 text-sm" aria-live="polite">{v.scan ? `${t("identity.scanReady")} · ${v.scan.filename}` : t("identity.scanNone")}</p>
        {v.status === "VERIFIED" && <p className="mt-1 text-xs text-steel">{t("identity.scanReplaceWarn")}</p>}
        <label className="mt-2 inline-block">
          <span className="sr-only">{v.scan ? t("identity.scanReplace") : t("identity.scanUpload")}</span>
          <input type="file" accept="image/jpeg,image/png" disabled={!doc || busy !== null} data-testid="scan-input" className="block text-sm file:me-3 file:rounded-xl file:border file:border-navy-900 file:bg-white file:px-3 file:py-2 file:text-navy-900" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = "" }} />
        </label>
      </div>
      {doc && canConfirm && (
        <section className="rounded-xl border border-line bg-white p-4" aria-labelledby={`review-${traveller.id}`}>
          <h3 id={`review-${traveller.id}`} className="text-sm font-medium">{t("identity.reviewTitle")}</h3>
          <p className="mt-1 text-xs text-steel">{t("identity.reviewHelp")}</p>
          <dl className="mt-2 text-sm">
            {row(t("identity.fieldName"), `${traveller.givenNames} ${traveller.surname}`)}
            {row(t("identity.fieldDob"), traveller.dateOfBirth)}
            {row(t("identity.fieldNationality"), traveller.nationality)}
            {row(t("identity.fieldNumber"), `••••${doc.last4}`)}
            {row(t("identity.fieldIssuing"), doc.issuingCountry)}
            {row(t("identity.fieldExpiry"), doc.expiryDate)}
          </dl>
          {!v.scan && <p className="mt-2 text-xs text-danger">{t("identity.confirmNeedScan")}</p>}
          <Button className="mt-3" disabled={!v.scan || busy !== null} onClick={() => void confirm()}>{t("identity.confirm")}</Button>
        </section>
      )}
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`text-sm ${msg.kind === "error" ? "text-danger" : "text-steel"}`}>{msg.text}</p>}
    </div>
  )
}
