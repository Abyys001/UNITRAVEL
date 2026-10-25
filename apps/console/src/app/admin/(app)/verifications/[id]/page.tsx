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

import { StatusChip, TileError } from "@/components/bento"
import { ActionBar, CaseTabs, ListSkeleton, paneClass, paneProps, StateChip } from "@/components/case"
import { Empty, ErrorLine, Field, Loading, PageHead, Panel, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { useCrumbLabel } from "@/lib/crumb"
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
  useCrumbLabel(d ? `${d.traveller.givenNames} ${d.traveller.surname}` : null)
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
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
      <PageHead kicker={<Link className="hover:underline" href="/verifications">{t0("nav.passport")}</Link>} title={<span dir="ltr">{t.givenNames} {t.surname}</span>} />
      <dl className="mx-4 mt-4 grid grid-cols-2 divide-x divide-rule overflow-hidden rounded-xl border border-rule bg-surface-raised shadow-[var(--tile-shadow)] max-sm:divide-x-0 max-sm:gap-y-3 max-sm:p-3 md:mx-6 lg:grid-cols-4 rtl:divide-x-reverse" data-testid="case-summary">
        <div className="px-4 py-3 max-sm:p-0"><dt className="cap">{t0("ver.waiting")}</dt><dd className="num mt-1 font-medium">{d.confirmedAt ? rel(d.confirmedAt) : "—"}</dd><dd className="num text-[12px] text-steel">{d.confirmedAt ? fmtDateTime(d.confirmedAt) : ""}</dd></div>
        <div className="px-4 py-3 max-sm:p-0"><dt className="cap">{t0("ver.document")}</dt><dd className="mt-1 font-medium">{d.document.type === "PASSPORT" ? t0("pg.ver.passport") : t0("pg.ver.nid")} <span className="num" dir="ltr">••••{d.document.last4}</span></dd><dd className={cn("text-[12px]", expired ? "font-medium text-danger" : "text-steel")}>{expired ? `EXPIRED ${d.document.expiryDate}` : `Expires ${d.document.expiryDate}`} · {d.document.issuingCountry}</dd></div>
        <div className="px-4 py-3 max-sm:p-0"><dt className="cap">{t0("ver.scan")}</dt><dd className="mt-1"><StatusChip tone={d.scan ? "ok" : "danger"}>{d.scan ? t0("ver.scan.onfile") : t0("ver.scan.none")}</StatusChip></dd>{d.scan && <dd className="truncate text-[12px] text-steel">{d.scan.filename}</dd>}</div>
        <div className="px-4 py-3 max-sm:p-0"><dt className="cap">{t0("ver.state")}</dt><dd className="mt-1"><StateChip value={d.status} /></dd></div>
      </dl>
      <CaseTabs label={t0("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "scan", label: t0("ver.tab.scan") }, { key: "fields", label: t0("ver.tab.fields") }, ...(d.status === "SUBMITTED" ? [{ key: "decide" as const, label: t0("ver.tab.decide") }] : [])]} />
      <div className="grid items-start gap-x-6 px-4 pt-2 md:px-6 lg:grid-cols-2">
        <div {...paneProps("scan")} className={paneClass(tab, "scan")}>
        <Panel title="Scan" aside={!scanUrl && d.scan && can("customer.read.documents") ? <Button size="sm" variant="outline" onClick={() => void showScan()}>Show scan (audited)</Button> : null}>
          {!d.scan ? <Empty>No scan on file. Ask the customer to upload one.</Empty> : !can("customer.read.documents") ? <Empty>Your role cannot open identity documents.</Empty> : scanUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL of the sanitised scan; next/image cannot optimise it
            <img src={scanUrl} alt={`Passport scan for ${t.givenNames} ${t.surname}`} className="max-h-[70vh] w-full rounded-sm border border-rule bg-surface-raised object-contain" data-testid="scan-image" />
          ) : <p className="text-steel">{d.scan.filename} · {d.scan.mime}. Every time the scan is opened it is written to the audit log.</p>}
          <ErrorLine error={scanErr} />
        </Panel>
        </div>
        <div>
          <div {...paneProps("fields")} className={paneClass(tab, "fields")}>
          <Panel title="Details the customer confirmed">
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
            <Panel title="Earlier decisions">
              <ul className="ledger-rows">{d.history.map((h, i) => <li key={i} className="py-1.5"><Tag value={h.decision} /> <span className="text-steel">{h.reviewerName} · {fmtDateTime(h.at)}</span>{h.reasonCode && <span className="block">{REASON_LABEL[h.reasonCode]}{h.reasonText ? ` — ${h.reasonText}` : ""}</span>}</li>)}</ul>
            </Panel>
          )}
          </div>
          {d.status === "SUBMITTED" && (
            <div {...paneProps("decide")} className={cn(paneClass(tab, "decide"), "lg:sticky lg:top-16")}>
            <Panel title={t0("ver.decide")}>
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void decide() }}>
                <fieldset className="grid gap-1.5" aria-label="Decision">
                  {([["VERIFIED", "Verify"], ["CORRECTION_REQUIRED", "Needs correction"], ["REJECTED", "Reject"]] as const).map(([v, l]) => <label key={v} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2", f.decision === v ? "border-navy-900 bg-hover font-medium dark:border-white/80" : "border-rule hover:bg-hover")}><input type="radio" name="decision" value={v} checked={f.decision === v} onChange={() => setF({ ...f, decision: v })} />{l}</label>)}
                </fieldset>
                {f.decision !== "VERIFIED" && <>
                  <Field label="Reason"><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{VerificationReasonCode.options.map((c) => <option key={c} value={c}>{REASON_LABEL[c]}</option>)}</NativeSelect></Field>
                  <Field label="Message to the customer (shown to them as written)" hint="Do not include the passport number or other personal data."><textarea className="field-input min-h-20" dir="auto" required maxLength={300} value={f.reasonText} onChange={(e) => setF({ ...f, reasonText: e.target.value })} /></Field>
                </>}
                <ErrorLine error={err} />
                <ActionBar edge="bottom" className="-mx-1 px-1"><Button type="submit" size="sm" loading={busy} variant={f.decision === "REJECTED" ? "destructive" : "default"}>Record decision</Button></ActionBar>
              </form>
            </Panel>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
