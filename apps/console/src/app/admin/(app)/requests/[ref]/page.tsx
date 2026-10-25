"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Phone } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@unitravel/ui/components/button"
import { VerificationBadge } from "@unitravel/ui/product/verification-badge"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { StatusChip, TileError } from "@/components/bento"
import { ActionBar, CaseHeader, CaseTabs, CommandBar, ListSkeleton, paneClass, paneProps, SlaChip, StateChip, statusTone, SummaryItem, tallyOptions, Timeline, TruthTally } from "@/components/case"
import { CommandDialog, DIALOG_COMMANDS } from "@/components/flight/commands"
import { RecordPaymentTrigger } from "@/components/payment-panel"
import { ItineraryView } from "@/components/flight/itinerary"
import { InvoicesPanel } from "@/components/invoices-panel"
import { AfterSalesDialog, CreditOverrideDialog, PaymentDialog, ReservationDialog, TicketsDialog } from "@/components/flight/records"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Composer, MessagesList, NotesList } from "@/components/thread"
import { Empty, ErrorLine, Field, Loading, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, human, money } from "@/lib/format"
import { useIsMobile, useKeys } from "@/lib/hooks"
import { type MsgKey, useT } from "@/lib/i18n"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { FlightDetail } from "@/lib/types"

// Mobile admin mode (ch. 15.8) leaves quote sending and recording dialogs to the desktop.
const DESKTOP_ONLY = new Set(["send_quote", "record_acceptance", "record_reservation", "record_tickets"])
type Money2 = { amountMinor: number; currency: string }
type PriceCheck = { outcome: string; previousTotal: Money2; currentTotal?: Money2; checkedAt: string }
type Dlg = "contact" | "sms" | "reservation" | "tickets" | "payment" | "override" | "aftersales"

export default function FlightRequestPage() {
  const { ref } = useParams<{ ref: string }>()
  const qc = useQueryClient()
  const { me, can } = useSession()
  const mobile = useIsMobile()
  const key = ["fr-detail", ref]
  // The displayed case stays put while you work; the event stream (or, when it is down, a light poll) notices other
  // people's changes (ch. 20 concurrency, 29.2).
  const q = useQuery({ queryKey: key, queryFn: () => api<FlightDetail>(`/v1/admin/flight-requests/${ref}`), staleTime: Infinity, refetchOnWindowFocus: false })
  const poll = useQuery({ queryKey: ["fr-version", ref], queryFn: async () => (await api<FlightDetail>(`/v1/admin/flight-requests/${ref}`)).version, refetchInterval: useFallbackInterval(15_000), enabled: !!q.data })
  const d = q.data
  const refresh = async () => { await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: ["fr-version", ref] }); void qc.invalidateQueries({ queryKey: ["queue-summary"] }); void qc.invalidateQueries({ queryKey: ["fr"] }) }
  const [command, setCommand] = useState<string | null>(null)
  const dlg = useDialogs<Dlg>()
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const msgRef = useRef<HTMLTextAreaElement>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [contact, setContact] = useState({ outcome: "REACHED", note: "", callBackAt: "" })
  const [sms, setSms] = useState("tried_to_call")
  const [tab, setTab] = useState<"case" | "customer" | "records">("case")
  const t = useT()
  const tt = t // the travellers map below shadows `t`

  const run = (command: string) => {
    if (command === "record_reservation") return dlg.open("reservation")
    if (command === "record_tickets") return dlg.open("tickets")
    if (DIALOG_COMMANDS.has(command)) return setCommand(command)
    void claimOrSimple(command)
  }
  const claimOrSimple = async (command: string) => {
    try { await api(`/v1/admin/flight-requests/${ref}/commands/${command}`, { body: {}, headers: { "if-match": String(d!.version) } }); toast.success(`${human(command)} — done`); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  const claim = d?.actions.find((a) => a.command === "claim")
  useKeys({ c: () => { if (claim?.allowed) void claimOrSimple("claim") }, n: () => noteRef.current?.focus(), m: () => msgRef.current?.focus() }, !!d)

  const reveal = useAct(async (travellerId: string) => api<{ number: string; type: string; issuingCountry: string; expiryDate: string }>(`/v1/admin/customers/travellers/${travellerId}/reveal-document`, { body: { ref } }).then((r) => ({ travellerId, r })), {
    onDone: ({ travellerId, r }) => { setRevealed((x) => ({ ...x, [travellerId]: r.number })); setTimeout(() => setRevealed((x) => { const { [travellerId]: _, ...rest } = x; return rest }), 60_000) },
  })
  const verifyPayment = useAct((id: string) => api(`/v1/admin/payments/${id}/verify`, { body: {} }), { success: "Payment verified", invalidate: [key] })
  const approveOverride = useAct((id: string) => api(`/v1/admin/credit-overrides/${id}/approve`, { body: {} }), { success: "Credit override approved", invalidate: [key] })
  const recheck = useAct(() => api<PriceCheck>(`/v1/admin/itineraries/${encodeURIComponent(d!.snapshot!.itinerary.id)}/price-check`, { body: {} }), {
    onDone: (r) => {
      const delta = r.currentTotal ? r.currentTotal.amountMinor - r.previousTotal.amountMinor : 0
      const text = `${money(r.previousTotal)} → ${r.currentTotal ? money(r.currentTotal) : "no price"}${r.currentTotal ? ` (${delta >= 0 ? "+" : ""}${money({ ...r.currentTotal, amountMinor: delta })})` : ""}. ${t("case.priceCheck.note")}`
      ;(r.outcome === "CONFIRMED" ? toast.success : toast.warning)(`${t("case.priceCheck")}: ${human(r.outcome)} · ${fmtDateTime(r.checkedAt)}`, { description: text, duration: 12_000 })
    },
  })
  const download = async (id: string) => { try { const r = await api<{ url: string }>(`/v1/documents/${id}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) } }
  const asCommand = async (asRef: string, command: string) => {
    try { await api(`/v1/admin/after-sales/${asRef}/commands/${command}`, { body: command === "resolve" ? { resolutionNote: "Resolved by staff", ticketStatus: undefined } : {} }); await refresh() } catch (e) { toast.error(errText(e)) }
  }

  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!d) return <><Loading label={`Opening ${ref}…`} /><ListSkeleton rows={6} /></>
  const mineCase = d.assignee?.id === me?.id
  // Versions only grow; ">" keeps your own command's event from flashing the banner before the reload lands.
  const changed = poll.data !== undefined && poll.data > d.version
  const pax = d.query.passengers.reduce<Record<string, number>>((m, p) => ({ ...m, [p.type]: (m[p.type] ?? 0) + 1 }), {})
  const prefs = d.query.preferences
  const visibleActions = d.actions.filter((a) => !(mobile && DESKTOP_ONLY.has(a.command)))
  const draft = d.quotes.find((x) => x.status === "DRAFT")
  const latestQuote = [...d.quotes].sort((a, b) => b.version - a.version)[0]
  const tally = latestQuote ? tallyOptions(latestQuote.options) : null
  const canOverride = !mobile && can("ticket.record") && d.status === "RESERVED"

  return (
    <div className="pb-8">
      {changed && (
        <div role="status" className="flex items-center justify-between gap-3 bg-warning-subtle px-5 py-2 text-warning-subtle-fg">
          <span>Someone else changed this case (version {d.version} → {poll.data}).</span>
          <Button size="xs" variant="outline" onClick={() => void refresh()}>Reload case</Button>
        </div>
      )}
      <CaseHeader
        reference={<span className="ref text-lead font-semibold" data-testid="ref">{d.ref}</span>}
        title={d.routeLabel}
        meta={<>{Object.entries(pax).map(([k, n]) => `${n} ${k}`).join(" · ")} · {fmtDate(d.firstTravelDate)} · {human(d.tripType)} · {d.kind === "MANUAL" ? "manual request" : "itinerary request"} · submitted {fmtDateTime(d.submittedAt)} via {d.submittedVia.toLowerCase()} ({d.submittedLocale})</>}
        aside={mobile ? <a href={`tel:${d.customer.phone}`} className={buttonVariants({ size: "sm" })}><Phone /> Call</a> : undefined}
        summary={<>
          <div className="flex flex-wrap items-center gap-1.5">
            <span data-testid="status"><StateChip value={d.status} /></span>
            <StatusChip tone={statusTone(d.paymentStatus)} className="font-semibold">{t("case.payment", { status: d.paymentStatus.replace(/_/g, " ").toLowerCase() })}</StatusChip>
            {d.urgent && <StatusChip tone="danger" className="font-semibold">{t("case.urgent")}</StatusChip>}
          </div>
          <SummaryItem label={t("case.sla")}>
            <SlaChip dueAt={d.sla.dueAt} startAt={d.submittedAt} done={!!d.sla.firstContactAt} />
            <span className="text-meta text-steel">{d.sla.firstContactAt ? fmtDateTime(d.sla.firstContactAt) : d.sla.dueAt ? <>{t("case.firstContact.due")} <span className="num">{fmtDateTime(d.sla.dueAt)}</span></> : t("sla.none")}</span>
          </SummaryItem>
          <SummaryItem label={t("case.owner.short")}><span className="font-medium" data-testid="assignee">{d.assignee ? (mineCase ? t("case.assignedYou") : t("case.assignedTo", { name: d.assignee.name ?? "—" })) : <span className="text-danger">{t("case.unassigned")}</span>}</span></SummaryItem>
          <SummaryItem label={t("case.truth.short")} className={tally && tally.unknown > 0 ? "basis-full sm:basis-auto" : undefined}>
            {!tally ? <span className="text-steel">{t("case.truth.none")}</span> : (
              <>
                <TruthTally compact tally={tally} />
                <span className={cn("text-meta", tally.unknown > 0 ? "font-medium text-danger" : "text-steel")} data-testid="truth-note">{tally.unknown > 0 ? t("case.truth.blocks") : t("case.truth.clear")} <span className="text-steel">· {t("case.truth.quote", { v: latestQuote!.version })}</span></span>
              </>
            )}
          </SummaryItem>
        </>}
      />
      <ActionBar data-testid="actions" aria-label={t("case.actions")}>
        <CommandBar actions={visibleActions} onRun={run} none={t("case.actions.none", { status: d.status })} hint={<><span className="kbd">c</span> claim · <span className="kbd">n</span> note · <span className="kbd">m</span> message · {t("case.actions.hint")}</>} />
        {mobile && d.actions.some((a) => DESKTOP_ONLY.has(a.command)) && <p className="mt-1 text-caption text-steel">Quote sending and recording dialogs are desktop features in v1.</p>}
      </ActionBar>
      <CaseTabs label={t("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "case", label: t("case.tab.case") }, { key: "customer", label: t("case.tab.customer") }, { key: "records", label: t("case.tab.records"), count: d.reservations.length + d.tickets.length + d.payments.length }]} />

      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* LEFT — customer */}
        <div {...paneProps("customer")} className={paneClass(tab, "customer")}>
          <Panel title="Customer" aside={can("customer.read.pii") && <Link href={`/customers/${d.customer.id}?ref=${d.ref}`} className="font-medium text-link hover:underline">Context →</Link>}>
            <p className="text-lead font-medium" dir="auto" data-testid="customer-name">{d.customer.nameLatin || d.customer.displayName}</p>
            {d.customer.nameFa && <p className="w-fit font-fa text-lead" dir="rtl" lang="fa" data-testid="customer-name-fa">{d.customer.nameFa}</p>}
            <p className="text-steel">Prefers {d.customer.preferredLocale === "fa" ? "Persian" : "English"}{d.customer.contactTimePref && <> · best time {d.customer.contactTimePref}</>}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="num text-lead" dir="ltr">{d.customer.phone}</span>
              {d.customer.phoneVerified ? <Tag value="VERIFIED" className="border-success text-success" title={fmtDateTime(d.customer.phoneVerifiedAt)} /> : <Tag value="UNVERIFIED" className="border-danger text-danger" />}
              {d.customer.phoneVerifiedAt && <span className="text-caption text-steel" suppressHydrationWarning>{fmtDateTime(d.customer.phoneVerifiedAt)}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {!mobile && <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(d.customer.phone); toast.success("Number copied") }}><Copy /> Copy number</Button>}
              {can("flight_request.transition") && <Button size="sm" variant="outline" onClick={() => dlg.open("contact")}>Log call</Button>}
              {can("flight_request.transition") && <Button size="sm" variant="ghost" onClick={() => dlg.open("sms")}>SMS template</Button>}
            </div>
            {d.customer.alternativeContact && <p className="mt-2 text-steel">Alternative: <span dir="auto">{d.customer.alternativeContact.name}</span> ({d.customer.alternativeContact.relationship}) <span className="num" dir="ltr">{d.customer.alternativeContact.phone}</span></p>}
          </Panel>
          <Panel title={`Travellers · ${d.travellers.length}`}>
            <ul className="ledger-rows">
              {d.travellers.map((t, i) => (
                <li key={t.travellerId} className="py-1.5">
                  <p className="flex items-center justify-between gap-2"><span><span className="text-steel">{i + 1} · {t.passengerType}</span> {t.name.title} {t.name.givenNames} {t.name.surname}</span>{t.documentComplete ? <Tag value="COMPLETE" className="border-success text-success" /> : <Tag value="DOCS MISSING" className="border-danger text-danger" />}</p>
                  {t.name.nameFa && <p className="w-fit font-fa" dir="rtl">{t.name.nameFa}</p>}
                  {t.verificationStatus && <p className="mt-0.5"><VerificationBadge status={t.verificationStatus} label={tt(`vstatus.${t.verificationStatus}` as MsgKey)} /></p>}
                  {t.document ? (
                    <p className="mt-0.5 flex items-center gap-2 text-meta text-steel">
                      <span>{human(t.document.type)} <span className="num" data-testid="doc-number">{revealed[t.travellerId] ?? `•••••${t.document.last4}`}</span> · {t.document.issuingCountry} · expires {fmtDate(t.document.expiryDate)}</span>
                      {can("customer.read.documents") && !revealed[t.travellerId] && <button type="button" className="font-medium text-link underline-offset-4 hover:underline" onClick={() => reveal.mutate(t.travellerId)} title="Logged as customer.read.documents">Reveal</button>}
                    </p>
                  ) : <p className="text-meta text-danger">No passport on file</p>}
                </li>
              ))}
            </ul>
            {Object.keys(revealed).length > 0 && <p className="text-caption text-steel">Revealed numbers hide again after a minute. Each reveal is in the audit log.</p>}
          </Panel>
          <Panel title="Contact log">
            {!d.contacts.length ? <Empty>No calls logged.</Empty> : (
              <ul className="ledger-rows" data-testid="contacts">{d.contacts.map((c) => <li key={c.id} className="py-1"><span className="num text-meta">{fmtDateTime(c.createdAt)}</span> · <Tag value={c.outcome} />{c.channel === "SMS_TEMPLATE" && <span className="ms-1 text-steel">SMS</span>}{c.note && <p className="text-steel" dir="auto">“{c.note}”</p>}{c.callBackAt && <p className="text-caption text-orange-700">Call back {fmtDateTime(c.callBackAt)}</p>}</li>)}</ul>
            )}
          </Panel>
          <Panel title="History">
            {!d.customer.history.length ? <Empty>First request from this customer.</Empty> : <ul className="ledger-rows">{d.customer.history.map((h) => <li key={h.ref} className="flex justify-between py-1"><Link className="ref text-meta hover:underline" href={h.productType === "CARGO" ? `/cargo/${h.ref}` : `/requests/${h.ref}`}>{h.ref}</Link><Tag value={h.status} /></li>)}</ul>}
          </Panel>
        </div>

        {/* CENTRE — request, conversation, activity */}
        <div {...paneProps("case")} className={cn("min-w-0", paneClass(tab, "case"))}>
          <Panel title="Request">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
              <dt className="text-steel">Trip</dt><dd>{human(d.tripType)} · {human(d.query.cabin)} · {d.query.slices.map((s) => `${"city" in s.from ? s.from.city : s.from.airport}→${"city" in s.to ? s.to.city : s.to.airport} ${s.date}${s.flexDays ? ` ±${s.flexDays}` : ""}`).join(", ")}</dd>
              <dt className="text-steel">Preferences</dt><dd>{[prefs.allowSelfTransfer ? "self-transfer allowed" : "no self-transfer", prefs.allowAirportChange ? "airport change OK" : null, prefs.allowOvernight ? "overnight OK" : "no overnight", `max ${prefs.maxStops} stops`, prefs.preferredLayoverMin ? `layover ${prefs.preferredLayoverMin[0] / 60}–${prefs.preferredLayoverMin[1] / 60} h` : null, prefs.includeGateways ? "gateway departures accepted" : null, prefs.studentFare ? "student fare" : null].filter(Boolean).join(" · ")}</dd>
              {d.manual && <><dt className="text-steel">Manual</dt><dd>{[d.manual.flexibility, d.manual.budget ? `budget ${money(d.manual.budget)}` : null, d.manual.overlandAcceptable ? "overland OK" : null, d.manual.airlinesPrefer?.length ? `prefer ${d.manual.airlinesPrefer.join(", ")}` : null, d.manual.airlinesAvoid?.length ? `avoid ${d.manual.airlinesAvoid.join(", ")}` : null].filter(Boolean).join(" · ")}</dd></>}
              {(d.preferences as { seatPreference?: string }).seatPreference && <><dt className="text-steel">Seats</dt><dd>{human(String((d.preferences as { seatPreference?: string }).seatPreference))}</dd></>}
            </dl>
            {d.customerNote && <p className="mt-2 rounded-sm border border-rule bg-surface-raised px-2 py-1.5" dir="auto">“{d.customerNote}”</p>}
          </Panel>
          {d.snapshot && (
            <Panel title="Offer snapshot (immutable)" aside={can("pricing.read.internal") && <Button size="xs" variant="outline" onClick={() => recheck.mutate()} loading={recheck.isPending}>Re-check price</Button>}>
              <div className="rounded-md border border-rule bg-surface-raised p-3">
                <ItineraryView it={d.snapshot.itinerary} />
                <p className="mt-2 flex flex-wrap gap-x-4 text-meta text-steel">{d.snapshot.priceAtSubmit && <span>At submission <b className="num text-ink">{money(d.snapshot.priceAtSubmit)}</b></span>}{d.snapshot.priceRevalidated && <span>Revalidated <b className="num text-ink">{money(d.snapshot.priceRevalidated)}</b> {fmtDateTime(d.snapshot.revalidatedAt)}</span>}<span>Rules v{d.snapshot.ruleVersion} · {d.snapshot.engineVersion}</span><span className="font-mono">#{d.snapshot.contentHash.slice(0, 10)}</span></p>
                {recheck.error && <ErrorLine error={recheck.error} />}
              </div>
            </Panel>
          )}
          {d.compliance.length > 0 && (
            <Panel title="Compliance">
              <ul className="ledger-rows">{d.compliance.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><span dir="auto">{c.summary}</span><span className="flex items-center gap-2"><Tag value={c.status} />{can("compliance.case.read") && <Link className="font-medium text-link hover:underline" href={`/compliance/${c.id}`}>Open →</Link>}</span></li>)}</ul>
            </Panel>
          )}
          <Panel title={t("case.conversation")}>
            <MessagesList messages={d.messages} />
            {can("flight_request.transition") && <Composer ref={msgRef} hint={t("case.composer.message")} label="Send message" placeholder="Write a message to the customer… (m)" testId="message-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/messages`, { body: { body } }); toast.success("Message sent"); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
          <Panel title={t("case.notes")}>
            <NotesList notes={d.notes} />
            {can("flight_request.note.internal") && <Composer ref={noteRef} tone="note" label="Add note" hint={t("case.composer.note")} placeholder="Write an internal note… (n)" testId="note-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/notes`, { body: { body } }); toast.success("Note added"); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </Panel>
          <Panel title={t("case.activity")}>
            <Timeline data-testid="timeline" items={d.timeline.map((x, i) => ({ id: i, at: x.at, title: x.label, detail: x.detail, meta: x.actor?.toLowerCase(), tone: x.kind === "STATUS" ? "strong" : x.kind === "CONTACT" ? "accent" : "muted" }))} />
          </Panel>
        </div>

        {/* RIGHT — quotes, invoices, records, documents */}
        <div {...paneProps("records")} className={cn(paneClass(tab, "records"), "lg:col-span-2 xl:col-span-1")}>
          {!mobile && (can("quote.create") || can("pricing.write")) && (
            <Panel title="Quotes" aside={["IN_REVIEW", "QUOTED", "ACCEPTED"].includes(d.status) && <Link href={`/requests/${d.ref}/quote${draft ? `?quote=${draft.id}` : ""}`} className="font-medium text-link hover:underline" data-testid="open-quote-builder">{draft ? "Edit draft →" : "New quote →"}</Link>}>
              {!d.quotes.length ? <Empty>No quotes yet.</Empty> : (
                <ul className="ledger-rows" data-testid="quotes">
                  {d.quotes.map((qv) => (
                    <li key={qv.id} className="py-1.5">
                      <p className="flex items-center justify-between"><span>v{qv.version} · {qv.options.length} option{qv.options.length === 1 ? "" : "s"}{qv.validUntil && <span className="text-steel"> · valid until {fmtDateTime(qv.validUntil)}</span>}</span><Tag value={qv.status} /></p>
                      <ul className="text-meta">{qv.options.map((o) => <li key={o.id} className="flex justify-between gap-2"><span className="truncate">{o.id === qv.acceptedOptionId && "✓ "}{o.label}{o.source === "MANUAL" && <span className="ms-1 font-mono text-2xs text-orange-700">MANUAL</span>}{o.unknownFields.length > 0 && <span className="ms-1 text-danger">· {o.unknownFields.length} to confirm</span>}</span><span className="num">{money(o.priceBreakdown.total)}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {!mobile && ["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"].includes(d.status) && <InvoicesPanel requestRef={d.ref} />}
          <Panel title="Records">
            <dl className="ledger-rows">
              <div className="py-1.5">
                <dt className="flex justify-between"><span className="text-steel">Reservation</span></dt>
                {d.reservations.length ? d.reservations.map((r) => <dd key={r.id} className="flex flex-wrap items-center justify-between gap-1"><span><span className="num font-medium">{r.recordLocator}</span> <span className="text-steel">{r.system} · {Object.entries(r.airlineLocators).map(([k, v]) => `${k}:${v}`).join(" ")}</span></span><span className="flex items-center gap-2"><span className="num text-caption">TTL {fmtDateTime(r.ticketingDeadline)}</span><Tag value={r.status} /></span></dd>) : <dd>—</dd>}
              </div>
              <div className="py-1.5">
                <dt className="text-steel">Tickets</dt>
                {d.tickets.length ? d.tickets.map((t) => <dd key={t.id} className="flex justify-between"><span><span className="num">{t.ticketNumber}</span> {t.travellerName}</span><Tag value={t.status} /></dd>) : <dd>—</dd>}
              </div>
              <div className="py-1.5">
                <dt className="flex items-center justify-between"><span className="text-steel">Payments · {d.paymentStatus}</span>{!mobile && can("payment.record") && <RecordPaymentTrigger state={d.paymentRecording} onOpen={() => dlg.open("payment")} />}</dt>
                {d.payments.length ? d.payments.map((p) => (
                  <dd key={p.id} className="mt-1">
                    <p className="flex justify-between"><span className="num">{money(p.amount)}</span><Tag value={p.status} /></p>
                    <p className="text-caption text-steel">{p.method} · {p.externalReference} · <span dir="auto">{p.payerName}</span> · recorded by {p.recordedBy}{p.verifiedBy && ` · verified by ${p.verifiedBy}`}</p>
                    {p.status === "RECORDED" && can("payment.record") && <div className="mt-1 flex items-center gap-2"><Button size="xs" variant="outline" onClick={() => verifyPayment.mutate(p.id)} loading={verifyPayment.isPending}>Verify (second person)</Button>{p.needsSecondVerifier && <span className="text-caption text-orange-700">Above the four-eyes threshold</span>}</div>}
                  </dd>
                )) : <dd>—</dd>}
              </div>
              {(canOverride || d.creditOverrides.length > 0) && (
                <div className="py-1.5" data-testid="credit-overrides">
                  <dt className="flex justify-between"><span className="text-steel">Credit override</span>{canOverride && <button type="button" className="font-medium text-link underline-offset-4 hover:underline" onClick={() => dlg.open("override")}>Request override</button>}</dt>
                  {d.creditOverrides.map((o) => (
                    <dd key={o.id} className="mt-1">
                      <p className="flex flex-wrap items-center justify-between gap-2"><span dir="auto">“{o.reason}”</span>{o.approvedAt ? <Tag value="APPROVED" className="border-success text-success" /> : <Tag value="PENDING" />}</p>
                      <p className="text-caption text-steel">requested by {o.requestedBy} · {fmtDateTime(o.createdAt)}{o.approvedBy && ` · approved by ${o.approvedBy} ${fmtDateTime(o.approvedAt)}`}</p>
                      {!o.approvedAt && !o.requestedByMe && can("user.role.assign.privileged") && <Button size="xs" variant="outline" className="mt-1" onClick={() => approveOverride.mutate(o.id)} loading={approveOverride.isPending}>Approve (owner)</Button>}
                    </dd>
                  ))}
                </div>
              )}
              {(d.afterSales.length > 0 || (["TICKETED", "COMPLETED"].includes(d.status) && can("flight_request.transition"))) && (
                <div className="py-1.5" data-testid="after-sales">
                  <dt className="flex justify-between"><span className="text-steel">After-sales</span>{["TICKETED", "COMPLETED"].includes(d.status) && can("flight_request.transition") && <button type="button" className="font-medium text-link underline-offset-4 hover:underline" onClick={() => dlg.open("aftersales")}>Open case</button>}</dt>
                  {d.afterSales.map((a) => (
                    <dd key={a.ref} className="mt-1">
                      <p className="flex flex-wrap items-center gap-1.5"><span className="ref">{a.ref}</span><span className="text-steel">{a.type}</span><Tag value={a.status} /><span className="num text-caption text-steel">{fmtDate(a.createdAt)}</span></p>
                      {a.note && <p className="text-meta text-steel" dir="auto">“{a.note}”</p>}
                      {can("flight_request.transition") && !["RESOLVED", "REJECTED"].includes(a.status) && <p className="flex flex-wrap gap-1">{["start", "request_info", "resolve", "reject"].map((c) => <Button key={c} size="xs" variant="ghost" onClick={() => void asCommand(a.ref, c)}>{human(c)}</Button>)}</p>}
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          </Panel>
          <Panel title="Documents">
            {!d.documents.length ? <Empty>No documents.</Empty> : <ul className="ledger-rows">{d.documents.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-2 py-1"><button type="button" className="truncate text-start underline-offset-2 hover:underline" onClick={() => void download(doc.id)}>{doc.filename}</button><span className="flex gap-1"><Tag value={doc.type} /><Tag value={doc.visibility} /></span></li>)}</ul>}
          </Panel>
        </div>
      </div>

      <CommandDialog command={command} d={d} onClose={() => setCommand(null)} done={refresh} />
      <ReservationDialog {...dlg.bind("reservation")} d={d} done={refresh} />
      <TicketsDialog {...dlg.bind("tickets")} d={d} done={refresh} />
      <PaymentDialog {...dlg.bind("payment")} d={d} done={refresh} />
      <CreditOverrideDialog {...dlg.bind("override")} d={d} done={refresh} />
      <AfterSalesDialog {...dlg.bind("aftersales")} d={d} done={refresh} />
      <FormDialog {...dlg.bind("contact")} title="Log call…" description="Outcomes feed SLA reporting (ch. 15.4)." submitLabel="Log call" onSubmit={async () => { await api(`/v1/admin/flight-requests/${ref}/contact-attempts`, { body: { channel: "PHONE", outcome: contact.outcome, note: contact.note || undefined, callBackAt: contact.outcome === "CALL_BACK_REQUESTED" && contact.callBackAt ? new Date(contact.callBackAt).toISOString() : undefined } }); setContact({ outcome: "REACHED", note: "", callBackAt: "" }); await refresh() }}>
        <Field label="Outcome"><NativeSelect className="field-input" value={contact.outcome} onChange={(e) => setContact({ ...contact, outcome: e.target.value })}>{["REACHED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "CALL_BACK_REQUESTED"].map((o) => <option key={o}>{o}</option>)}</NativeSelect></Field>
        {contact.outcome === "CALL_BACK_REQUESTED" && <Field label="Call back at"><input type="datetime-local" className="field-input" value={contact.callBackAt} onChange={(e) => setContact({ ...contact, callBackAt: e.target.value })} required /></Field>}
        <Field label="Note"><textarea className="field-input min-h-20" value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} dir="auto" /></Field>
      </FormDialog>
      <FormDialog {...dlg.bind("sms")} title="Send SMS template…" description="Pre-approved templates only; free-text SMS is off by default." submitLabel="Send SMS" onSubmit={async () => { await api(`/v1/admin/flight-requests/${ref}/contact-attempts`, { body: { channel: "SMS_TEMPLATE", outcome: "NO_ANSWER", templateKey: sms } }); await refresh() }}>
        <Field label="Template"><NativeSelect className="field-input" value={sms} onChange={(e) => setSms(e.target.value)}><option value="tried_to_call">We tried to call you about {d.ref}…</option><option value="please_contact">Please contact us about {d.ref}…</option></NativeSelect></Field>
      </FormDialog>
    </div>
  )
}
