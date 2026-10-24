"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { VerificationReasonCode, type VerificationDecision, type VerificationDetail } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { BentoGrid, BentoTile, StatusChip, TileError } from "@/components/bento"
import { ActionBar, CaseTabs, ListSkeleton, paneClass, StateChip } from "@/components/case"
import { Empty, ErrorLine, Field, Loading, PageHead, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

const REASON_LABEL: Record<string, string> = {
  UNREADABLE_SCAN: "Scan not readable", NAME_MISMATCH: "Name does not match", NUMBER_MISMATCH: "Passport number does not match", DOB_MISMATCH: "Date of birth does not match",
  NATIONALITY_MISMATCH: "Nationality does not match", EXPIRY_MISMATCH: "Expiry date does not match", EXPIRED_DOCUMENT: "Passport expired", NOT_A_PASSPORT: "Not a passport photo page",
  SCAN_INCOMPLETE: "Scan cut off or incomplete", OTHER: "Other",
}

/** Side by side: the scan on one side, the customer's confirmed fields on the other; the number only through the audited Reveal. */
export default function VerificationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const qc = useQueryClient()
  const { can } = useSession()
  const t0 = useT()
  const [tab, setTab] = useState<"scan" | "fields" | "decide">("scan")
  const q = useQuery({ queryKey: ["verification", id], queryFn: () => api<VerificationDetail>(`/v1/admin/verifications/${id}`) })
  const [scanUrl, setScanUrl] = useState<string | null>(null)
  const [scanErr, setScanErr] = useState<unknown>(null)
  const [number, setNumber] = useState<string | null>(null)
  const [revealErr, setRevealErr] = useState<unknown>(null)
  const [f, setF] = useState<{ decision: VerificationDecision; reasonCode: string; reasonText: string }>({ decision: "VERIFIED", reasonCode: "NAME_MISMATCH", reasonText: "" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => () => { if (scanUrl) URL.revokeObjectURL(scanUrl) }, [scanUrl])
  const d = q.data
  if (q.error) return <div className="p-5"><TileError message={errText(q.error)} onRetry={() => void q.refetch()} /></div>
  if (!d) return <><Loading /><ListSkeleton rows={5} /></>

  // Opening the scan is a deliberate, audited action, not something that happens on page load.
  const showScan = async () => {
    setScanErr(null)
    try { setScanUrl(URL.createObjectURL(await api<Blob>(`/v1/admin/verifications/${id}/scan`, { raw: true }))) } catch (e) { setScanErr(e) }
  }
  const reveal = async () => {
    setRevealErr(null)
    try { setNumber((await api<{ number: string }>(`/v1/admin/customers/travellers/${d.traveller.id}/reveal-document`, { body: { ref: d.id } })).number) } catch (e) { setRevealErr(e) }
  }
  const decide = async () => {
    setBusy(true); setErr(null)
    try {
      await api(`/v1/admin/verifications/${id}/decide`, { body: { decision: f.decision, reviewHash: d.reviewHash, reasonCode: f.decision === "VERIFIED" ? undefined : f.reasonCode, reasonText: f.decision === "VERIFIED" ? undefined : f.reasonText } })
      toast.success(`Recorded — ${f.decision.replace(/_/g, " ").toLowerCase()}`)
      void qc.invalidateQueries({ queryKey: ["verifications"] })
      router.push("/verifications")
    } catch (e) { setErr(e); void q.refetch() } finally { setBusy(false) }
  }
  const t = d.traveller
  const expired = d.document.expiryDate < new Date().toISOString().slice(0, 10)
  const row = (label: string, value: React.ReactNode) => <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5"><dt className="cap">{label}</dt><dd className="font-medium" dir="auto">{value}</dd></div>
  return (
    <div>
      <PageHead kicker={<Link className="hover:underline" href="/verifications">Passport verification</Link>} title={<span dir="ltr">{t.givenNames} {t.surname}</span>}>
        {d.confirmedAt && <span className="text-[11px] text-steel">Customer confirmed {fmtDateTime(d.confirmedAt)}</span>}
      </PageHead>
      <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
        <BentoTile size="s" title={t0("ver.state")}><StateChip value={d.status} className="text-[12px]" /></BentoTile>
        <BentoTile size="s" title={t0("ver.waiting")}><p className="num text-[15px] font-medium">{d.confirmedAt ? rel(d.confirmedAt) : "—"}</p><p className="mt-1 text-[12px] text-steel">{d.confirmedAt ? fmtDateTime(d.confirmedAt) : ""}</p></BentoTile>
        <BentoTile size="s" title={t0("ver.document")} tone={expired ? "alert" : "default"}>
          <p className="font-medium">{d.document.type === "PASSPORT" ? "Passport" : "National ID"} <span className="num" dir="ltr">••••{d.document.last4}</span></p>
          <p className={cn("mt-1 text-[12px]", expired ? "font-medium text-danger" : "text-steel")}>{expired ? `EXPIRED ${d.document.expiryDate}` : `Expires ${d.document.expiryDate}`} · {d.document.issuingCountry}</p>
        </BentoTile>
        <BentoTile size="s" title={t0("ver.scan")}><StatusChip tone={d.scan ? "ok" : "danger"}>{d.scan ? t0("ver.scan.onfile") : t0("ver.scan.none")}</StatusChip>{d.scan && <p className="mt-1.5 truncate text-[12px] text-steel">{d.scan.filename}</p>}</BentoTile>
      </BentoGrid>
      <CaseTabs label={t0("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "scan", label: t0("ver.tab.scan") }, { key: "fields", label: t0("ver.tab.fields") }, ...(d.status === "SUBMITTED" ? [{ key: "decide" as const, label: t0("ver.tab.decide") }] : [])]} />
      <div className="grid gap-x-8 px-5 lg:grid-cols-2">
        <Panel title="Scan" className={paneClass(tab, "scan")} aside={!scanUrl && d.scan && can("customer.read.documents") ? <Button size="sm" variant="outline" onClick={() => void showScan()}>Show scan (audited)</Button> : null}>
          {!d.scan ? <Empty>No scan on file. Ask the customer to upload one.</Empty> : !can("customer.read.documents") ? <Empty>Your role cannot open identity documents.</Empty> : scanUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the sanitised scan; next/image cannot optimise it
            <img src={scanUrl} alt={`Passport scan for ${t.givenNames} ${t.surname}`} className="max-h-[70vh] w-full rounded-sm border border-rule bg-surface-raised object-contain" data-testid="scan-image" />
          ) : <p className="text-steel">{d.scan.filename} · {d.scan.mime}. Every time the scan is opened it is written to the audit log.</p>}
          <ErrorLine error={scanErr} />
        </Panel>
        <div>
          <Panel title="Details the customer confirmed" className={paneClass(tab, "fields")}>
            <dl data-testid="verification-fields">
              {row("Surname", <span dir="ltr">{t.surname}</span>)}
              {row("Given names", <span dir="ltr">{t.givenNames}</span>)}
              {row("Persian name", t.nameFa ?? "—")}
              {row("Date of birth", <span dir="ltr">{t.dateOfBirth}</span>)}
              {row("Gender on document", t.genderOnDocument)}
              {row("Nationality", t.nationality)}
              {row("Document", d.document.type === "PASSPORT" ? "Passport" : "National ID")}
              {row("Number", <span className="num" dir="ltr">{number ?? `••••${d.document.last4}`}{can("customer.read.documents") && number === null && <button type="button" className="ms-3 text-[12px] font-normal text-royal underline" onClick={() => void reveal()}>Reveal (audited)</button>}</span>)}
              {row("Issuing country", d.document.issuingCountry)}
              {row("Expiry date", <span dir="ltr">{d.document.expiryDate}</span>)}
            </dl>
            <ErrorLine error={revealErr} />
          </Panel>
          {d.history.length > 0 && (
            <Panel title="Earlier decisions" className={paneClass(tab, "fields")}>
              <ul className="ledger-rows">{d.history.map((h, i) => <li key={i} className="py-1.5"><Tag value={h.decision} /> <span className="text-steel">{h.reviewerName} · {fmtDateTime(h.at)}</span>{h.reasonCode && <span className="block">{REASON_LABEL[h.reasonCode]}{h.reasonText ? ` — ${h.reasonText}` : ""}</span>}</li>)}</ul>
            </Panel>
          )}
          {d.status === "SUBMITTED" && (
            <Panel title={t0("ver.decide")} className={paneClass(tab, "decide")}>
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void decide() }}>
                <fieldset className="grid grid-cols-3 gap-1" aria-label="Decision">
                  {([["VERIFIED", "Verify"], ["CORRECTION_REQUIRED", "Needs correction"], ["REJECTED", "Reject"]] as const).map(([v, l]) => <label key={v} className={cn("flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1.5", f.decision === v ? "border-ink bg-surface-raised" : "border-rule")}><input type="radio" name="decision" value={v} checked={f.decision === v} onChange={() => setF({ ...f, decision: v })} />{l}</label>)}
                </fieldset>
                {f.decision !== "VERIFIED" && <>
                  <Field label="Reason"><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{VerificationReasonCode.options.map((c) => <option key={c} value={c}>{REASON_LABEL[c]}</option>)}</NativeSelect></Field>
                  <Field label="Message to the customer (shown to them as written)" hint="Do not include the passport number or other personal data."><textarea className="field-input min-h-20" dir="auto" required maxLength={300} value={f.reasonText} onChange={(e) => setF({ ...f, reasonText: e.target.value })} /></Field>
                </>}
                <ErrorLine error={err} />
                <ActionBar edge="bottom" className="-mx-1 px-1"><Button type="submit" size="sm" loading={busy} variant={f.decision === "REJECTED" ? "destructive" : "default"}>Record decision</Button></ActionBar>
              </form>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
