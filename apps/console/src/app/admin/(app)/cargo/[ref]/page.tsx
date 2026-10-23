"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { CargoCommandDialog, CargoQuoteDialog, TrackingDialog } from "@/components/cargo-dialogs"
import { useDialogs } from "@/components/form-dialog"
import { Composer, MessagesList, NotesList } from "@/components/thread"
import { CommandButton, Empty, ErrorLine, Loading, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, human, money } from "@/lib/format"
import { useIsMobile, useKeys } from "@/lib/hooks"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { CargoDetail, CargoPartyView } from "@/lib/types"

function Party({ title, p }: { title: string; p: CargoPartyView }) {
  return (
    <Panel title={title}>
      <p className="font-medium" dir="auto">{p.name}{p.company && <span className="text-slate"> · {p.company}</span>}</p>
      <p className="text-slate" dir="auto">{p.address.line1}{p.address.line2 && `, ${p.address.line2}`}, {p.address.city}{p.address.postcode && ` ${p.address.postcode}`}, {p.address.country}</p>
      <p className="num" dir="ltr">{p.phone}{p.email && ` · ${p.email}`}</p>
    </Panel>
  )
}

export default function CargoPage() {
  const { ref } = useParams<{ ref: string }>()
  const qc = useQueryClient()
  const { can } = useSession()
  const mobile = useIsMobile()
  const key = ["cargo-detail", ref]
  const q = useQuery({ queryKey: key, queryFn: () => api<CargoDetail>(`/v1/admin/cargo/requests/${ref}`), refetchInterval: useFallbackInterval(20_000) })
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["cargo-list"] }) }
  const [command, setCommand] = useState<string | null>(null)
  const dlg = useDialogs<"quote" | "tracking">()
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const msgRef = useRef<HTMLTextAreaElement>(null)
  const gen = useAct(() => api(`/v1/admin/cargo/requests/${ref}/documents/generate`, { body: {} }), { success: "Shipment summary and invoice template generated", invalidate: [key] })
  const d = q.data
  const run = async (c: string) => {
    if (c !== "claim") return setCommand(c)
    try { await api(`/v1/admin/cargo/requests/${ref}/commands/claim`, { body: {}, headers: { "if-match": String(d!.version) } }); toast.success("Claimed"); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  useKeys({ c: () => { if (d?.actions.find((a) => a.command === "claim")?.allowed) void run("claim") }, n: () => noteRef.current?.focus(), m: () => msgRef.current?.focus() }, !!d)
  const download = async (id: string) => { try { const r = await api<{ url: string }>(`/v1/documents/${id}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) } }
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!d) return <Loading label={`Opening ${ref}…`} />
  const reviewLines = d.items.filter((i) => i.screeningOutcome !== "ALLOWED").length
  return (
    <div className="pb-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-paper px-5 py-3">
        <div>
          <p className="flex items-baseline gap-2"><span className="num text-[15px] font-medium">{d.ref}</span><span className="font-display text-[20px]">{d.lane.label}</span></p>
          <p className="text-slate">{human(d.service)} · ready {fmtDate(d.readyDate)} · {human(d.handoverMode)} · declared {money(d.declaredTotal)} · submitted {fmtDateTime(d.submittedAt)}</p>
        </div>
        <div className="flex items-center gap-2"><Tag value={d.status} className="text-[12px]" />{d.exceptionReason && <Tag value={d.exceptionReason} className="border-brick text-brick" />}<Tag value={`PAYMENT ${d.paymentStatus}`} /></div>
      </header>
      <div className="grid gap-x-6 px-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <div className="order-2 lg:order-1">
          <Panel title="Customer" aside={can("customer.read.pii") && <Link className="text-copper-700" href={`/customers/${d.customer.id}?ref=${d.ref}`}>Context →</Link>}><p dir="auto" className="font-medium">{d.customer.displayName}</p>{d.customerNote && <p className="mt-1 text-slate" dir="auto">“{d.customerNote}”</p>}</Panel>
          <Party title="Shipper" p={d.shipper} />
          <Party title="Consignee" p={d.consignee} />
          <Panel title="Declarations">
            <ul className="grid grid-cols-2 gap-x-2">{Object.entries(d.declarations).map(([k, v]) => <li key={k} className={v ? "text-brick" : "text-slate"}>{v ? "■" : "□"} {human(k.replace(/([A-Z])/g, "_$1"))}</li>)}</ul>
            {d.commercial && <p className="mt-1 text-slate">Incoterm {d.commercial.incoterm ?? "—"}{d.commercial.exportLicenceRef && ` · licence ${d.commercial.exportLicenceRef}`}</p>}
          </Panel>
        </div>
        <div className="order-3 min-w-0 lg:order-2">
          <Panel title={`Goods · screening ${reviewLines ? `${reviewLines} line${reviewLines === 1 ? " needs" : "s need"} review` : "all allowed"}`}>
            <table className="w-full bg-white" data-testid="goods">
              <thead><tr className="border-b border-rule">{["Description", "Category", "Qty", "Value", "Origin", "HS", "Screening"].map((h) => <th key={h} className="cap px-1.5 py-1 text-start font-normal">{h}</th>)}</tr></thead>
              <tbody>{d.items.map((i) => <tr key={i.id} className={cn("border-b border-rule/70 align-top", i.screeningOutcome === "PROHIBITED" && "bg-[#fbeee9]")}><td className="px-1.5 py-1" dir="auto">{i.description}</td><td className="px-1.5 py-1 font-mono text-[10.5px]">{i.category}</td><td className="num px-1.5 py-1">{i.quantity}</td><td className="num px-1.5 py-1">{money({ ...i.unitValue, amountMinor: i.unitValue.amountMinor * i.quantity })}</td><td className="px-1.5 py-1">{i.originCountry}</td><td className="num px-1.5 py-1">{i.hsCode ?? "—"}</td><td className="px-1.5 py-1"><Tag value={i.screeningOutcome} />{i.matchedRule && <span className="block text-[11px] text-slate">{i.matchedRule}</span>}</td></tr>)}</tbody>
            </table>
          </Panel>
          <Panel title="Pieces and weight">
            <ul className="ledger-rows">{d.pieces.map((p, i) => <li key={p.id} className="flex justify-between py-1"><span>Piece {i + 1} · <span className="num">{p.lengthCm}×{p.widthCm}×{p.heightCm} cm</span></span><span className="num">{p.weightKg} kg{p.verifiedWeightKg != null && <span className={cn("ms-2", p.verifiedWeightKg !== p.weightKg ? "text-brick" : "text-moss")}>verified {p.verifiedWeightKg} kg</span>}</span></li>)}</ul>
            <p className="mt-1 num">Actual {d.weights.actualKg} kg · volumetric {d.weights.volumetricKg} kg (÷{d.weights.divisor}) · <b>chargeable {d.weights.chargeableKg} kg</b> <span className="text-slate">(estimate until re-weighed)</span></p>
          </Panel>
          <Panel title="Tracking" aside={can("cargo_request.transition") && <Button size="xs" variant="outline" onClick={() => dlg.open("tracking")}>Add event</Button>}>
            {!d.tracking.length ? <Empty>No tracking events.</Empty> : <ol className="ledger-rows">{d.tracking.map((t) => <li key={t.id} className="grid grid-cols-[8rem_7rem_1fr] gap-2 py-1"><span className="num text-[12px]">{fmtDateTime(t.occurredAt)}</span><span className="font-mono text-[11px]">{t.eventCode}</span><span>{t.location}{t.description && <span className="text-slate"> · {t.description}</span>}<span className="ms-1 text-[10px] text-slate">{t.source}</span></span></li>)}</ol>}
          </Panel>
          <Panel title="Timeline"><ol className="ledger-rows">{d.timeline.map((t, i) => <li key={i} className="py-1"><span className="num text-[11.5px] text-slate">{fmtDateTime(t.at)}</span> {t.label}{t.detail && <span className="text-slate"> — {t.detail}</span>}</li>)}</ol></Panel>
          <Panel title="Messages with the customer">
            <MessagesList messages={d.messages} />
            {can("cargo_request.transition") && <Composer ref={msgRef} label="Send message" placeholder="Write a message to the customer… (m)" onSend={async (body) => { try { await api(`/v1/admin/cargo/requests/${ref}/messages`, { body: { body } }); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
        </div>
        <div className="order-1 lg:order-3 lg:col-span-2 xl:col-span-1">
          <Panel title="Actions" aside={<span className="text-[11px] text-slate">computed by the server</span>}>
            <div className="grid gap-1.5" data-testid="actions">{d.actions.length ? d.actions.filter((a) => !(mobile && ["send_quote", "record_booking", "receive"].includes(a.command))).map((a) => <CommandButton key={a.command} action={a} onRun={() => void run(a.command)} variant={a.command === "claim" ? "default" : "outline"} />) : <Empty>No commands in {d.status}.</Empty>}</div>
          </Panel>
          {d.compliance.length > 0 && <Panel title="Compliance"><ul className="ledger-rows">{d.compliance.map((c) => <li key={c.id} className="flex justify-between gap-2 py-1"><span dir="auto">{c.summary}</span><Tag value={c.status} /></li>)}</ul></Panel>}
          <Panel title="Partner quotes" aside={!mobile && can("cargo_request.transition") && ["IN_REVIEW", "QUOTED", "EXCEPTION"].includes(d.status) && <Button size="xs" variant="outline" onClick={() => dlg.open("quote")}>Draft quote</Button>}>
            {!d.quotes.length ? <Empty>No quotes.</Empty> : <ul className="ledger-rows">{d.quotes.map((x) => <li key={x.id} className="py-1"><p className="flex justify-between"><span>v{x.version} · {x.partnerName}</span><Tag value={x.status} /></p><p className="num text-[12px]">{money(x.lines.total)} · {x.lines.freight.chargeableKg} kg × {money(x.lines.freight.ratePerKg)}{x.lines.dutiesTaxes === "PAYABLE_BY_CONSIGNEE" ? " · duties payable by consignee" : ""}</p></li>)}</ul>}
            <p className="mt-1 text-[11px] text-slate">Eligible partners: {d.eligiblePartners.map((p) => `${p.name} (${p.complianceStatus.toLowerCase()})`).join(", ") || "none for this lane and service"}</p>
          </Panel>
          <Panel title="Booking">{d.booking ? <p>{d.booking.partnerName} · ref <span className="num">{d.booking.partnerReference ?? "—"}</span> · AWB <span className="num">{d.booking.awbNumber ?? "—"}</span></p> : <Empty>Not booked.</Empty>}</Panel>
          <Panel title="Documents" aside={can("cargo_request.transition") && <Button size="xs" variant="outline" onClick={() => gen.mutate()} loading={gen.isPending}>Generate PDFs</Button>}>
            {!d.documents.length ? <Empty>No documents.</Empty> : <ul className="ledger-rows">{d.documents.map((doc) => <li key={doc.id} className="flex justify-between gap-2 py-1"><button type="button" className="truncate text-start hover:underline" onClick={() => void download(doc.id)}>{doc.filename}</button><Tag value={doc.type} /></li>)}</ul>}
          </Panel>
          <Panel title="Internal notes">
            <NotesList notes={d.notes} />
            {can("flight_request.note.internal", "cargo_request.transition") && <Composer ref={noteRef} tone="note" label="Add note" placeholder="Internal note (n)" onSend={async (body) => { try { await api(`/v1/admin/cargo/requests/${ref}/notes`, { body: { body } }); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
        </div>
      </div>
      <CargoCommandDialog command={command} d={d} onClose={() => setCommand(null)} done={refresh} />
      <CargoQuoteDialog {...dlg.bind("quote")} d={d} done={refresh} />
      <TrackingDialog {...dlg.bind("tracking")} d={d} done={refresh} />
    </div>
  )
}
