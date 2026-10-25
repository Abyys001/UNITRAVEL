"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip, TileError } from "@/components/bento"
import { ActionBar, CaseHeader, CaseTabs, CommandBar, ListSkeleton, paneClass, paneProps, StateChip, statusTone, SummaryItem, TableScroll, Timeline } from "@/components/case"
import { CargoCommandDialog, CargoQuoteDialog, EstimateDialog, TrackingCorrectionDialog, TrackingDialog } from "@/components/cargo-dialogs"
import { PaymentDialog } from "@/components/flight/records"
import { useDialogs } from "@/components/form-dialog"
import { InvoicesPanel } from "@/components/invoices-panel"
import { RecordPaymentTrigger } from "@/components/payment-panel"
import { Composer, MessagesList, NotesList } from "@/components/thread"
import { Empty, Loading, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, human, money } from "@/lib/format"
import { useIsMobile, useKeys } from "@/lib/hooks"
import { useT } from "@/lib/i18n"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { CargoDetail, CargoPartyView } from "@/lib/types"

function Party({ title, p }: { title: string; p: CargoPartyView }) {
  return (
    <Panel title={title}>
      <p className="font-medium" dir="auto">{p.name}{p.company && <span className="text-steel"> · {p.company}</span>}</p>
      <p className="text-steel" dir="auto">{p.address.line1}{p.address.line2 && `, ${p.address.line2}`}, {p.address.city}{p.address.postcode && ` ${p.address.postcode}`}, {p.address.country}</p>
      <p className="num" dir="ltr">{p.phone}{p.email && ` · ${p.email}`}</p>
    </Panel>
  )
}

export default function CargoPage() {
  const { ref } = useParams<{ ref: string }>()
  const qc = useQueryClient()
  const { can } = useSession()
  const mobile = useIsMobile()
  const t = useT()
  const [tab, setTab] = useState<"case" | "people" | "records">("case")
  const key = ["cargo-detail", ref]
  const q = useQuery({ queryKey: key, queryFn: () => api<CargoDetail>(`/v1/admin/cargo/requests/${ref}`), refetchInterval: useFallbackInterval(20_000) })
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["cargo-list"] }) }
  const [command, setCommand] = useState<string | null>(null)
  const dlg = useDialogs<"quote" | "tracking" | "eta" | "payment">()
  const [correcting, setCorrecting] = useState<CargoDetail["tracking"][number] | null>(null)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const msgRef = useRef<HTMLTextAreaElement>(null)
  const gen = useAct(() => api(`/v1/admin/cargo/requests/${ref}/documents/generate`, { body: {} }), { success: "Shipment summary and invoice template generated", invalidate: [key] })
  const verifyPayment = useAct((id: string) => api(`/v1/admin/payments/${id}/verify`, { body: {} }), { success: "Payment verified", invalidate: [key] })
  const d = q.data
  const run = async (c: string) => {
    if (c !== "claim") return setCommand(c)
    try { await api(`/v1/admin/cargo/requests/${ref}/commands/claim`, { body: {}, headers: { "if-match": String(d!.version) } }); toast.success("Claimed"); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  useKeys({ c: () => { if (d?.actions.find((a) => a.command === "claim")?.allowed) void run("claim") }, n: () => noteRef.current?.focus(), m: () => msgRef.current?.focus() }, !!d)
  const download = async (id: string) => { try { const r = await api<{ url: string }>(`/v1/documents/${id}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) } }
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!d) return <><Loading label={`Opening ${ref}…`} /><ListSkeleton rows={6} /></>
  const reviewLines = d.items.filter((i) => i.screeningOutcome !== "ALLOWED").length
  const prohibited = d.items.filter((i) => i.screeningOutcome === "PROHIBITED").length
  return (
    <div className="pb-8">
      <CaseHeader
        reference={<span className="num text-[15px] font-semibold" data-testid="ref">{d.ref}</span>}
        title={d.lane.label}
        meta={<>{human(d.service)} · ready {fmtDate(d.readyDate)} · {human(d.handoverMode)} · declared {money(d.declaredTotal)} · submitted {fmtDateTime(d.submittedAt)}</>}
        summary={<>
          <div className="flex flex-wrap items-center gap-1.5">
            <span data-testid="status"><StateChip value={d.status} /></span>
            {d.exceptionReason && <StatusChip tone="danger" className="font-semibold">{d.exceptionReason.replace(/_/g, " ")}</StatusChip>}
            <StatusChip tone={statusTone(d.paymentStatus)} className="font-semibold">{t("case.payment", { status: d.paymentStatus.replace(/_/g, " ").toLowerCase() })}</StatusChip>
          </div>
          <SummaryItem label={t("cargo.screening")}>
            <span className={cn("num font-semibold", prohibited ? "text-danger" : "text-ink")}>{d.items.length - reviewLines}<span className="font-normal text-steel"> / {d.items.length} allowed</span></span>
            <span className={cn("text-[12px]", prohibited ? "font-medium text-danger" : "text-steel")}>{prohibited ? `${prohibited} PROHIBITED` : reviewLines ? t("cargo.screening.review", { n: reviewLines }) : t("cargo.screening.ok")}</span>
          </SummaryItem>
          <SummaryItem label={t("cargo.weight")}>
            <span className="num font-semibold">{d.weights.chargeableKg} kg</span>
            <span className="text-[12px] text-steel">{d.pieces.every((p) => p.verifiedWeightKg != null) ? "Verified by re-weigh" : t("cargo.weight.est")}</span>
          </SummaryItem>
          <SummaryItem label={t("cargo.eta")}>
            <span className="num font-medium">{d.estimatedDeliveryAt ? fmtDateTime(d.estimatedDeliveryAt) : t("cargo.eta.none")}</span>
            <span className="text-[12px] text-steel">{d.compliance.length ? `${d.compliance.length} compliance case${d.compliance.length === 1 ? "" : "s"}` : "No compliance case"}</span>
          </SummaryItem>
        </>}
      />
      <ActionBar data-testid="actions" aria-label={t("case.actions")}>
        <CommandBar actions={d.actions.filter((a) => !(mobile && ["send_quote", "record_booking", "receive"].includes(a.command)))} onRun={(c) => void run(c)} none={t("case.actions.none", { status: d.status })} hint={<><span className="kbd">c</span> claim · <span className="kbd">n</span> note · <span className="kbd">m</span> message · {t("case.actions.hint")}</>} />
      </ActionBar>
      <CaseTabs label={t("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "case", label: t("case.tab.case") }, { key: "people", label: t("case.tab.people") }, { key: "records", label: t("case.tab.records") }]} />
      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <div {...paneProps("people")} className={paneClass(tab, "people")}>
          <Panel title="Customer" aside={can("customer.read.pii") && <Link className="text-orange-700" href={`/customers/${d.customer.id}?ref=${d.ref}`}>Context →</Link>}><p dir="auto" className="font-medium">{d.customer.displayName}</p>{d.customerNote && <p className="mt-1 text-steel" dir="auto">“{d.customerNote}”</p>}</Panel>
          <Party title="Shipper" p={d.shipper} />
          <Party title="Consignee" p={d.consignee} />
          <Panel title="Declarations">
            <ul className="grid grid-cols-2 gap-x-2">{Object.entries(d.declarations).map(([k, v]) => <li key={k} className={v ? "text-danger" : "text-steel"}>{v ? "■" : "□"} {human(k.replace(/([A-Z])/g, "_$1"))}</li>)}</ul>
            {d.commercial && <p className="mt-1 text-steel">Incoterm {d.commercial.incoterm ?? "—"}{d.commercial.exportLicenceRef && ` · licence ${d.commercial.exportLicenceRef}`}</p>}
          </Panel>
        </div>
        <div {...paneProps("case")} className={cn("min-w-0", paneClass(tab, "case"))}>
          <Panel title={`Goods · screening ${reviewLines ? `${reviewLines} line${reviewLines === 1 ? " needs" : "s need"} review` : "all allowed"}`}>
            <TableScroll><table className="w-full bg-surface-raised" data-testid="goods">
              <thead><tr className="border-b border-rule">{["Description", "Category", "Qty", "Value", "Origin", "HS", "Screening"].map((h) => <th key={h} className="cap px-1.5 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{d.items.map((i) => <tr key={i.id} className={cn("border-b border-rule/70 align-top", i.screeningOutcome === "PROHIBITED" && "bg-danger-subtle")}><td className="px-1.5 py-1" dir="auto">{i.description}</td><td className="px-1.5 py-1 font-mono text-[10.5px]">{i.category}</td><td className="num px-1.5 py-1">{i.quantity}</td><td className="num px-1.5 py-1">{money({ ...i.unitValue, amountMinor: i.unitValue.amountMinor * i.quantity })}</td><td className="px-1.5 py-1">{i.originCountry}</td><td className="num px-1.5 py-1">{i.hsCode ?? "—"}</td><td className="px-1.5 py-1"><Tag value={i.screeningOutcome} />{i.matchedRule && <span className="block text-[11px] text-steel">{i.matchedRule}</span>}</td></tr>)}</tbody>
            </table></TableScroll>
          </Panel>
          <Panel title="Pieces and weight">
            <ul className="ledger-rows">{d.pieces.map((p, i) => <li key={p.id} className="flex justify-between py-1"><span>Piece {i + 1} · <span className="num">{p.lengthCm}×{p.widthCm}×{p.heightCm} cm</span></span><span className="num">{p.weightKg} kg{p.verifiedWeightKg != null && <span className={cn("ms-2", p.verifiedWeightKg !== p.weightKg ? "text-danger" : "text-success")}>verified {p.verifiedWeightKg} kg</span>}</span></li>)}</ul>
            <p className="mt-1 num">Actual {d.weights.actualKg} kg · volumetric {d.weights.volumetricKg} kg (÷{d.weights.divisor}) · <b>chargeable {d.weights.chargeableKg} kg</b> <span className="text-steel">(estimate until re-weighed)</span></p>
          </Panel>
          <Panel title="Tracking" aside={can("cargo_request.transition") && <Button size="xs" variant="outline" onClick={() => dlg.open("tracking")}>Add event</Button>}>
            {!d.tracking.length ? <Empty>No tracking events.</Empty> : <ol className="ledger-rows" data-testid="tracking-history">{d.tracking.map((t) => (
              <li key={t.id} className={cn("grid grid-cols-[8rem_7rem_1fr] gap-2 py-1", !t.effective && "text-steel")} data-effective={t.effective}>
                <span className="num text-[12px]">{fmtDateTime(t.occurredAt)}</span>
                <span className={cn("font-mono text-[11px]", !t.effective && "line-through")}>{t.eventCode}</span>
                <span>{t.location}{t.description && <span className="text-steel"> · {t.description}</span>}
                  <span className="ms-1 text-[10px] text-steel">{t.source}{t.externalEventId && ` · ${t.externalEventId}`}{t.correctsEventId && ` · correction by ${t.createdBy ?? "staff"}`}{!t.effective && " · superseded"}</span>
                  {t.correctionReason && <span className="block text-[11px] text-steel">Reason: {t.correctionReason}</span>}
                  {t.effective && can("cargo_request.transition") && <button type="button" className="ms-2 text-[11px] text-orange-700 hover:underline" onClick={() => setCorrecting(t)}>Correct</button>}
                </span>
              </li>))}</ol>}
          </Panel>
          <Panel title="Estimated delivery" aside={can("cargo_request.transition") && <Button size="xs" variant="outline" onClick={() => dlg.open("eta")}>{d.estimatedDeliveryAt ? "Change" : "Set"}</Button>}>
            <p data-testid="eta">{d.estimatedDeliveryAt ? fmtDateTime(d.estimatedDeliveryAt) : "No estimate set."} <span className="text-steel">Customers see it labelled as an estimate.</span></p>
          </Panel>
          <Panel title={t("case.conversation")}>
            <MessagesList messages={d.messages} />
            {can("cargo_request.transition") && <Composer ref={msgRef} hint={t("case.composer.message")} label="Send message" placeholder="Write a message to the customer… (m)" onSend={async (body) => { try { await api(`/v1/admin/cargo/requests/${ref}/messages`, { body: { body } }); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
          <Panel title={t("case.notes")}>
            <NotesList notes={d.notes} />
            {can("flight_request.note.internal", "cargo_request.transition") && <Composer ref={noteRef} tone="note" label="Add note" hint={t("case.composer.note")} placeholder="Write an internal note… (n)" onSend={async (body) => { try { await api(`/v1/admin/cargo/requests/${ref}/notes`, { body: { body } }); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
          <Panel title={t("case.activity")}><Timeline items={d.timeline.map((x, i) => ({ id: i, at: x.at, title: x.label, detail: x.detail, tone: "muted" }))} /></Panel>
        </div>
        <div {...paneProps("records")} className={cn(paneClass(tab, "records"), "lg:col-span-2 xl:col-span-1")}>
          {d.compliance.length > 0 && <Panel title="Compliance"><ul className="ledger-rows">{d.compliance.map((c) => <li key={c.id} className="flex justify-between gap-2 py-1"><span dir="auto">{c.summary}</span><Tag value={c.status} /></li>)}</ul></Panel>}
          <Panel title="Partner quotes" aside={!mobile && can("cargo_request.transition") && ["IN_REVIEW", "QUOTED", "EXCEPTION"].includes(d.status) && <Button size="xs" variant="outline" onClick={() => dlg.open("quote")}>Draft quote</Button>}>
            {!d.quotes.length ? <Empty>No quotes.</Empty> : <ul className="ledger-rows">{d.quotes.map((x) => <li key={x.id} className="py-1"><p className="flex justify-between"><span>v{x.version} · {x.partnerName}</span><Tag value={x.status} /></p><p className="num text-[12px]">{money(x.lines.total)} · {x.lines.freight.chargeableKg} kg × {money(x.lines.freight.ratePerKg)}{x.lines.dutiesTaxes === "PAYABLE_BY_CONSIGNEE" ? " · duties payable by consignee" : ""}</p></li>)}</ul>}
            <p className="mt-1 text-[11px] text-steel">Eligible partners: {d.eligiblePartners.map((p) => `${p.name} (${p.complianceStatus.toLowerCase()})`).join(", ") || "none for this lane and service"}</p>
          </Panel>
          {!mobile && d.quotes.some((x) => x.status === "ACCEPTED") && <InvoicesPanel requestRef={d.ref} />}
          <Panel title={`Payments · ${d.paymentStatus.replace(/_/g, " ")}`} aside={!mobile && can("payment.record") && <RecordPaymentTrigger state={d.paymentRecording} onOpen={() => dlg.open("payment")} />}>
            {!d.payments.length ? <Empty>No payments recorded.</Empty> : <ul className="ledger-rows" data-testid="cargo-payments">{d.payments.map((p) => (
              <li key={p.id} className="py-1">
                <p className="flex justify-between"><span className="num">{money(p.amount)}</span><Tag value={p.status} /></p>
                <p className="text-[11px] text-steel">{p.method} · {p.externalReference} · <span dir="auto">{p.payerName}</span> · recorded by {p.recordedBy}{p.verifiedBy && ` · verified by ${p.verifiedBy}`}</p>
                {p.status === "RECORDED" && can("payment.record") && <div className="mt-1 flex items-center gap-2"><Button size="xs" variant="outline" onClick={() => verifyPayment.mutate(p.id)} loading={verifyPayment.isPending}>Verify (second person)</Button>{p.needsSecondVerifier && <span className="text-[11px] text-orange-700">Above the four-eyes threshold</span>}</div>}
              </li>))}</ul>}
          </Panel>
          <Panel title="Booking">{d.booking ? <p>{d.booking.partnerName} · ref <span className="num">{d.booking.partnerReference ?? "—"}</span> · AWB <span className="num">{d.booking.awbNumber ?? "—"}</span></p> : <Empty>Not booked.</Empty>}</Panel>
          <Panel title="Documents" aside={can("cargo_request.transition") && <Button size="xs" variant="outline" onClick={() => gen.mutate()} loading={gen.isPending}>Generate PDFs</Button>}>
            {!d.documents.length ? <Empty>No documents.</Empty> : <ul className="ledger-rows">{d.documents.map((doc) => <li key={doc.id} className="flex justify-between gap-2 py-1"><button type="button" className="truncate text-start hover:underline" onClick={() => void download(doc.id)}>{doc.filename}</button><Tag value={doc.type} /></li>)}</ul>}
          </Panel>
        </div>
      </div>
      <CargoCommandDialog command={command} d={d} onClose={() => setCommand(null)} done={refresh} />
      <CargoQuoteDialog {...dlg.bind("quote")} d={d} done={refresh} />
      <TrackingDialog {...dlg.bind("tracking")} d={d} done={refresh} />
      <EstimateDialog {...dlg.bind("eta")} d={d} done={refresh} />
      <PaymentDialog {...dlg.bind("payment")} d={d} product="cargo" done={refresh} />
      <TrackingCorrectionDialog d={d} target={correcting} done={refresh} onClose={() => setCorrecting(null)} />
    </div>
  )
}
