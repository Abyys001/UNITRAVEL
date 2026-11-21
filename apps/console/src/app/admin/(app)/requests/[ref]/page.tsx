"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button, buttonVariants } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { ClipboardList, CreditCard, FileText, History, MessagesSquare, Paperclip, ReceiptText, ShieldCheck, StickyNote, Ticket, UserRound, Plane } from "lucide-react"

import { TileError } from "@/components/bento"
import { CaseSection, FactGrid, SectionNav, SubHead } from "@/components/case-section"
import { ActionBar, ActionMenu, CommandBar, commandLabelOf, DESTRUCTIVE, ListSkeleton, pickPrimary, StateChip, tallyOptions, Timeline } from "@/components/case"
import { codeLabel } from "@/components/club"
import { CommandDialog, DIALOG_COMMANDS } from "@/components/flight/commands"
import { RecordPaymentTrigger } from "@/components/payment-panel"
import { ItineraryView } from "@/components/flight/itinerary"
import { RequestHero } from "@/components/flight/request-hero"
import { InvoicesPanel } from "@/components/invoices-panel"
import { AmendDialog } from "@/components/flight/amend-dialog"
import { IndicativeSource } from "@/components/flight/apify-source"
import { CustomerCard, TravellerCard, TripSummary } from "@/components/flight/request-panels"
import { AfterSalesDialog, CreditOverrideDialog, PaymentDialog, ReservationDialog, TicketsDialog } from "@/components/flight/records"
import { StaffFarePanel } from "@/components/flight-builder/staff-fare-panel"
import { TicketDocumentsPanel } from "@/components/tickets/request-panel"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Composer, MessagesList, NotesList } from "@/components/thread"
import { Arrow, Empty, ErrorLine, Field, Loading, RouteText, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, ltrIsolate, money } from "@/lib/format"
import { useIsMobile, useKeys } from "@/lib/hooks"
import { type MsgKey, statusText, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { FlightDetail } from "@/lib/types"
import { useReadOnOpen } from "@/lib/notifications"

// Mobile admin mode (ch. 15.8) leaves quote sending and recording dialogs to the desktop.
const DESKTOP_ONLY = new Set(["send_quote", "record_acceptance", "record_reservation", "record_tickets"])
type Money2 = { amountMinor: number; currency: string }
type PriceCheck = { outcome: string; previousTotal: Money2; currentTotal?: Money2; checkedAt: string }
type Dlg = "contact" | "sms" | "reservation" | "tickets" | "payment" | "override" | "aftersales" | "amend"

export default function FlightRequestPage() {
  const { ref } = useParams<{ ref: string }>()
  useReadOnOpen(ref)
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
  const t = useT()
  const [locale] = useLocale()
  const tt = t // the travellers map below shadows `t`

  const run = (command: string) => {
    if (command === "record_reservation") return dlg.open("reservation")
    if (command === "record_tickets") return dlg.open("tickets")
    if (DIALOG_COMMANDS.has(command)) return setCommand(command)
    void claimOrSimple(command)
  }
  const claimOrSimple = async (command: string) => {
    try { await api(`/v1/admin/flight-requests/${ref}/commands/${command}`, { body: {}, headers: { "if-match": String(d!.version) } }); toast.success(t("rq.done", { what: commandLabelOf(command, locale).replace("…", "") })); await refresh() } catch (e) { toast.error(errText(e)) }
  }
  const claim = d?.actions.find((a) => a.command === "claim")
  // Both composers are always mounted in their own section, so the shortcut only scrolls to the field and focuses it.
  const focusThread = (ref: React.RefObject<HTMLTextAreaElement | null>) => { ref.current?.scrollIntoView({ block: "center" }); ref.current?.focus() }
  useKeys({ c: () => { if (claim?.allowed) void claimOrSimple("claim") }, n: () => focusThread(noteRef), m: () => focusThread(msgRef) }, !!d)

  const reveal = useAct(async (travellerId: string) => api<{ number: string; type: string; issuingCountry: string; expiryDate: string }>(`/v1/admin/customers/travellers/${travellerId}/reveal-document`, { body: { ref } }).then((r) => ({ travellerId, r })), {
    onDone: ({ travellerId, r }) => { setRevealed((x) => ({ ...x, [travellerId]: r.number })); setTimeout(() => setRevealed((x) => { const { [travellerId]: _, ...rest } = x; return rest }), 60_000) },
  })
  const verifyPayment = useAct((id: string) => api(`/v1/admin/payments/${id}/verify`, { body: {} }), { success: t("rq.paymentVerified"), invalidate: [key] })
  const approveOverride = useAct((id: string) => api(`/v1/admin/credit-overrides/${id}/approve`, { body: {} }), { success: t("rq.overrideApproved"), invalidate: [key] })
  const recheck = useAct(() => api<PriceCheck>(`/v1/admin/itineraries/${encodeURIComponent(d!.snapshot!.itinerary.id)}/price-check`, { body: {} }), {
    onDone: (r) => {
      const delta = r.currentTotal ? r.currentTotal.amountMinor - r.previousTotal.amountMinor : 0
      const text = `${ltrIsolate(`${money(r.previousTotal)} → ${r.currentTotal ? money(r.currentTotal) : t("rq.noPrice")}${r.currentTotal ? ` (${delta >= 0 ? "+" : ""}${money({ ...r.currentTotal, amountMinor: delta })})` : ""}`)}. ${t("case.priceCheck.note")}`
      ;(r.outcome === "CONFIRMED" ? toast.success : toast.warning)(`${t("case.priceCheck")}: ${codeLabel(t, "rq.outcome", r.outcome)} · ${fmtDateTime(r.checkedAt)}`, { description: text, duration: 12_000 })
    },
  })
  const download = async (id: string) => { try { const r = await api<{ url: string }>(`/v1/documents/${id}/download`); window.open(r.url, "_blank", "noopener") } catch (e) { toast.error(errText(e)) } }
  const asCommand = async (asRef: string, command: string) => {
    try { await api(`/v1/admin/after-sales/${asRef}/commands/${command}`, { body: command === "resolve" ? { resolutionNote: "Resolved by staff", ticketStatus: undefined } : {} }); await refresh() } catch (e) { toast.error(errText(e)) }
  }

  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!d) return <><Loading label={t("rq.opening", { ref })} /><ListSkeleton rows={6} /></>
  const mineCase = d.assignee?.id === me?.id
  // Versions only grow; ">" keeps your own command's event from flashing the banner before the reload lands.
  const changed = poll.data !== undefined && poll.data > d.version
  const pax = d.query.passengers.reduce<Record<string, number>>((m, p) => ({ ...m, [p.type]: (m[p.type] ?? 0) + 1 }), {})
  const visibleActions = d.actions.filter((a) => !(mobile && DESKTOP_ONLY.has(a.command)))
  const draft = d.quotes.find((x) => x.status === "DRAFT")
  const latestQuote = [...d.quotes].sort((a, b) => b.version - a.version)[0]
  const tally = latestQuote ? tallyOptions(latestQuote.options) : null
  const canOverride = !mobile && can("ticket.record") && d.status === "RESERVED"

  const allowedNow = visibleActions.filter((a) => a.allowed)
  // ADR-0044 D6: staff can price straight away (no claim, no customer reply needed); the server claims/resumes as audited
  // transitions. Until a draft is sendable, the quote builder is the next step, so it leads the action bar.
  const quoteNext = can("quote.create") && ["NEW", "IN_REVIEW", "AWAITING_CUSTOMER"].includes(d.status) && !d.actions.some((a) => a.command === "send_quote" && a.allowed)
  const quoteLead = quoteNext && <Link href={`/requests/${d.ref}/quote${draft ? `?quote=${draft.id}` : ""}`} className={cn(buttonVariants({ size: mobile ? "default" : "sm" }), mobile ? "w-full pointer-coarse:min-h-11" : "px-4")} data-testid="next-quote">{draft ? t("case.quote.edit") : t("case.quote.new")} <Arrow /></Link>
  const primary = quoteLead ? undefined : pickPrimary(allowedNow)
  const danger = allowedNow.filter((a) => DESTRUCTIVE.has(a.command))
  const mainRow = visibleActions.filter((a) => !(a.allowed && DESTRUCTIVE.has(a.command)))
  // Phones: one solid primary and a menu with everything else (also the commands that cannot run, with the server's reason).
  const phoneMenu = visibleActions.filter((a) => a !== primary)
  const desktopNote = mobile && d.actions.some((a) => DESKTOP_ONLY.has(a.command)) && <p className="mt-1 text-caption text-steel">{t("case.desktopOnly")}</p>
  const bar = mobile ? (
    <ActionBar edge="bottom" aria-label={t("case.actions")} className="bottom-[calc(4rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <div data-testid="actions" className="min-w-0 flex-1">
          {quoteLead || (primary ? <Button className="w-full pointer-coarse:min-h-11" onClick={() => run(primary.command)} data-command={primary.command}>{commandLabelOf(primary.command, locale)}</Button> : <p className="py-1 text-steel">{t("case.actions.none", { status: d.status })}</p>)}
        </div>
        <ActionMenu items={phoneMenu} onRun={run} />
      </div>
      {desktopNote}
    </ActionBar>
  ) : (
    <ActionBar aria-label={t("case.actions")} className="static rounded-[var(--radius-card)] border border-rule px-4 py-2.5 shadow-[var(--shadow-xs)] md:px-4">
      <div className="flex items-start gap-2">
        <div data-testid="actions" className="min-w-0 flex-1">
          <CommandBar actions={mainRow} onRun={run} lead={quoteLead || undefined} none={t("case.actions.none", { status: d.status })} hint={<><span className="kbd">c</span> claim · <span className="kbd">n</span> note · <span className="kbd">m</span> message · {t("case.actions.hint")}</>} />
        </div>
        <ActionMenu items={danger} onRun={run} />
      </div>
    </ActionBar>
  )

  const canAct = can("flight_request.transition")
  const showQuotes = !mobile && (can("quote.create") || can("pricing.write"))
  const navItems = [
    { id: "sec-overview", label: t("rq2.overview"), icon: ClipboardList },
    { id: "sec-customer", label: t("case.panel.customer"), icon: UserRound },
    { id: "sec-trip", label: t("rq2.trip"), icon: Plane },
    ...(showQuotes ? [{ id: "sec-quotes", label: t("case.panel.quotes"), icon: ReceiptText, count: d.quotes.length }] : []),
    { id: "sec-payment", label: t("rq2.payment"), icon: CreditCard },
    { id: "sec-tickets", label: t("rq2.tickets"), icon: Ticket },
    { id: "sec-documents", label: t("case.panel.documents"), icon: Paperclip, count: d.documents.length },
    { id: "sec-notes", label: t("rq2.notes"), icon: StickyNote, count: d.notes.length },
    { id: "sec-messages", label: t("case.conversation"), icon: MessagesSquare, count: d.messages.length },
    { id: "sec-timeline", label: t("rq2.timeline"), icon: History },
    ...(d.compliance.length > 0 ? [{ id: "sec-compliance", label: t("case.panel.compliance"), icon: ShieldCheck, count: d.compliance.length }] : []),
  ]
  const textLink = "font-medium text-link hover:underline"

  return (
    <div className={cn("min-h-full bg-surface-sunk", mobile ? "pb-2" : "pb-8")}>
      {changed && (
        <div role="status" className="flex items-center justify-between gap-3 bg-warning-subtle px-5 py-2 text-warning-subtle-fg">
          <span>{t("case.changed", { from: d.version, to: poll.data ?? "" })}</span>
          <Button size="xs" variant="outline" onClick={() => void refresh()}>{t("case.reload")}</Button>
        </div>
      )}
      <div className="space-y-3 px-3 pt-3 md:px-6 md:pt-4">
        <div id="sec-overview" className="scroll-mt-32"><RequestHero d={d} mobile={mobile} mineCase={mineCase} tally={tally} quoteVersion={latestQuote?.version ?? null} /></div>
      </div>
      <div className="sticky top-0 z-sticky mt-3 bg-surface-sunk/95 backdrop-blur-sm">
        {!mobile && <div className="px-6 pt-1 pb-2">{bar}</div>}
        <SectionNav label={t("rq2.nav")} items={navItems} className={cn(mobile ? "border-y border-rule bg-surface-raised" : "px-6 pb-2")} />
      </div>

      <div className="mt-3 flex flex-col gap-4 px-3 md:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Main column on lg+; on phones the order-* classes interleave both columns in reading order. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <CaseSection id="sec-trip" icon={Plane} title={t("rq2.trip")} description={t("rq2.trip.desc")} className="order-[30] lg:order-none"
            aside={canAct && !mobile ? (d.amendment?.allowed
              ? <Button size="xs" variant="outline" onClick={() => dlg.open("amend")} data-testid="amend-open">{t("rq.amend")}</Button>
              : <span className="text-caption text-steel" title={d.amendment?.reason}>{t("rq.amendWhy", { why: d.amendment?.reason ?? t("rq.notAvailable") })}</span>) : undefined}>
            <TripSummary d={d} />
            {d.snapshot && (
              <div className="rounded-md border border-rule bg-surface-sunk p-3">
                <SubHead className="mb-2" aside={can("pricing.read.internal") && <Button size="xs" variant="outline" onClick={() => recheck.mutate()} loading={recheck.isPending}>{t("rq.recheck")}</Button>}>{t("case.panel.snapshot")}</SubHead>
                <div className="rounded-md border border-rule bg-surface-raised p-3">
                  <ItineraryView it={d.snapshot.itinerary} />
                  <p className="mt-2 flex flex-wrap gap-x-4 text-meta text-steel">{d.snapshot.priceAtSubmit && <span>{t("rq.atSubmission")} <b className="num text-ink">{money(d.snapshot.priceAtSubmit)}</b></span>}{d.snapshot.priceRevalidated && <span>{t("rq.revalidated")} <b className="num text-ink">{money(d.snapshot.priceRevalidated)}</b> {fmtDateTime(d.snapshot.revalidatedAt)}</span>}<span>{t("rq.rules", { v: d.snapshot.ruleVersion })} · {d.snapshot.engineVersion}</span><span className="font-mono">#{d.snapshot.contentHash.slice(0, 10)}</span></p>
                  {recheck.error && <ErrorLine error={recheck.error} />}
                  <IndicativeSource d={d} />
                  {d.snapshot.staffFare && <StaffFarePanel fare={d.snapshot.staffFare} />}
                </div>
              </div>
            )}
            {d.serviceInterests.length > 0 && (
              <div>
                <SubHead className="mb-2">{t("rq.interests")}</SubHead>
                <ul className="flex flex-wrap gap-1.5" data-testid="service-interests">{d.serviceInterests.map((i) => <li key={i.code} className="rounded-sm border border-rule bg-surface-sunk px-1.5 py-0.5 text-meta"><span dir="auto">{locale === "fa" ? i.nameFa : i.nameEn}</span> <span className="num text-steel">{i.code}</span></li>)}</ul>
                <p className="mt-1.5 text-caption text-steel">{t("rq.interests.hint")}</p>
              </div>
            )}
          </CaseSection>

          {d.compliance.length > 0 && (
            <CaseSection id="sec-compliance" icon={ShieldCheck} title={t("case.panel.compliance")} description={t("rq2.compliance.desc")} count={d.compliance.length} className="order-[35] border-warning-border lg:order-none">
              <ul className="ledger-rows">{d.compliance.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><span dir="auto">{c.summary}</span><span className="flex items-center gap-2"><StateChip value={c.status} />{can("compliance.case.read") && <Link className={textLink} href={`/compliance/${c.id}`}>{t("case.open")} <Arrow /></Link>}</span></li>)}</ul>
            </CaseSection>
          )}

          <CaseSection id="sec-messages" icon={MessagesSquare} title={t("case.conversation")} description={t("rq2.messages.desc")} count={d.messages.length} className="order-[90] lg:order-none">
            <MessagesList messages={d.messages} />
            {canAct && <Composer ref={msgRef} hint={t("case.composer.message")} label={t("rq.sendMessage")} placeholder={t("rq.messagePlaceholder")} testId="message-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/messages`, { body: { body } }); toast.success(t("rq.messageSent")); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </CaseSection>

          <CaseSection id="sec-notes" icon={StickyNote} title={t("rq2.notes")} description={t("rq2.notes.desc")} count={d.notes.length} className="order-[80] lg:order-none">
            <NotesList notes={d.notes} />
            {can("flight_request.note.internal") && <Composer ref={noteRef} tone="note" label={t("rq.addNote")} hint={t("case.composer.note")} placeholder={t("rq.notePlaceholder")} testId="note-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/notes`, { body: { body } }); toast.success(t("rq.noteAdded")); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
          </CaseSection>

          <CaseSection id="sec-timeline" icon={History} title={t("rq2.timeline")} description={t("rq2.timeline.desc")} count={d.timeline.length} className="order-[100] lg:order-none">
            <Timeline data-testid="timeline" items={d.timeline.map((x, i) => ({ id: i, at: x.at, title: x.label, detail: x.detail, meta: x.actor?.toLowerCase(), tone: x.kind === "STATUS" ? "strong" : x.kind === "CONTACT" ? "accent" : "muted" }))} />
          </CaseSection>
        </div>

        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-4">
          <CaseSection id="sec-customer" icon={UserRound} title={t("case.panel.customer")} description={t("rq2.customer.desc")} className="order-[20] lg:order-none"
            aside={can("customer.read.pii") && <Link href={`/customers/${d.customer.id}?ref=${d.ref}`} className={textLink}>{t("case.context")} <Arrow /></Link>}>
            <CustomerCard d={d} mobile={mobile} canAct={canAct} onCopy={() => { void navigator.clipboard.writeText(d.customer.phone); toast.success(t("rq.copied")) }} onCall={() => dlg.open("contact")} onSms={() => dlg.open("sms")} />
            <div>
              <SubHead className="mb-2">{t("case.panel.travellers")} <span className="num text-steel">{d.travellers.length}</span></SubHead>
              <ul className="space-y-2">
                {d.travellers.map((t, i) => <TravellerCard key={t.travellerId} t={t} index={i} revealed={revealed[t.travellerId]} canReveal={can("customer.read.documents")} onReveal={() => reveal.mutate(t.travellerId)} verificationLabel={tt(`vstatus.${t.verificationStatus}` as MsgKey)} />)}
              </ul>
              {Object.keys(revealed).length > 0 && <p className="mt-2 text-caption text-steel">{t("case.reveal.note")}</p>}
            </div>
            <div>
              <SubHead className="mb-2">{t("case.panel.contacts")}</SubHead>
              {!d.contacts.length ? <Empty>{t("case.contacts.none")}</Empty> : (
                <ul className="ledger-rows" data-testid="contacts">{d.contacts.map((c) => <li key={c.id} className="py-1"><span className="num text-meta">{fmtDateTime(c.createdAt)}</span> · <StateChip value={c.outcome} />{c.channel === "SMS_TEMPLATE" && <span className="ms-1 text-steel">{t("rp.sms")}</span>}{c.note && <p className="text-steel" dir="auto">“{c.note}”</p>}{c.callBackAt && <p className="text-caption text-orange-700">{t("rq.callBack", { t: fmtDateTime(c.callBackAt) })}</p>}</li>)}</ul>
              )}
            </div>
            <div>
              <SubHead className="mb-2">{t("case.panel.history")}</SubHead>
              {!d.customer.history.length ? <Empty>{t("case.history.first")}</Empty> : <ul className="ledger-rows">{d.customer.history.map((h) => <li key={h.ref} className="flex items-center justify-between py-1"><Link className="ref text-meta hover:underline" href={h.productType === "CARGO" ? `/cargo/${h.ref}` : `/requests/${h.ref}`}>{h.ref}</Link><StateChip value={h.status} /></li>)}</ul>}
            </div>
          </CaseSection>

          {showQuotes && (
            <CaseSection id="sec-quotes" icon={ReceiptText} title={t("case.panel.quotes")} description={t("rq2.quotes.desc")} count={d.quotes.length} className="order-[50] lg:order-none"
              aside={["NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED"].includes(d.status) && <Link href={`/requests/${d.ref}/quote${draft ? `?quote=${draft.id}` : ""}`} className={textLink} data-testid="open-quote-builder">{draft ? t("case.quote.edit") : t("case.quote.new")} <Arrow /></Link>}>
              {!d.quotes.length ? <Empty>{t("case.quotes.none")}</Empty> : (
                <ul className="space-y-2" data-testid="quotes">
                  {d.quotes.map((qv) => (
                    <li key={qv.id} className="rounded-md border border-rule bg-surface-sunk p-2.5">
                      <p className="flex items-center justify-between gap-2"><span className="font-medium">v{qv.version} · {t(qv.options.length === 1 ? "rq.option.one" : "rq.options", { n: qv.options.length })}{qv.validUntil && <span className="font-normal text-steel"> · {t("rq.validUntil", { t: fmtDateTime(qv.validUntil) })}</span>}</span><StateChip value={qv.status} /></p>
                      <ul className="mt-1 text-meta">{qv.options.map((o) => <li key={o.id} className="flex justify-between gap-2 py-0.5"><span className="truncate">{o.id === qv.acceptedOptionId && "✓ "}<RouteText>{o.label}</RouteText>{o.source === "MANUAL" && <span className="ms-1 font-mono text-2xs text-orange-700">{statusText(t, "MANUAL")}</span>}{o.unknownFields.length > 0 && <span className="ms-1 text-danger">· {t("rq.toConfirm", { n: o.unknownFields.length })}</span>}</span><span className="num font-medium">{money(o.priceBreakdown.total)}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            </CaseSection>
          )}

          <CaseSection id="sec-payment" icon={CreditCard} title={t("rq2.payment")} description={t("rq2.payment.desc")} className="order-[40] lg:order-none">
            <FactGrid className="md:grid-cols-2" items={[{ label: t("rq2.payment.status"), value: <StateChip value={d.paymentStatus} /> }, { label: t("case.rec.payments"), value: <span className="num">{d.payments.length}</span> }]} />
            {!mobile && ["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"].includes(d.status) && <InvoicesPanel requestRef={d.ref} />}
            <div>
              <SubHead className="mb-2" aside={!mobile && can("payment.record") && <RecordPaymentTrigger state={d.paymentRecording} onOpen={() => dlg.open("payment")} />}>{t("case.rec.payments")}</SubHead>
              {d.payments.length ? (
                <ul className="space-y-2">
                  {d.payments.map((p) => (
                    <li key={p.id} className="rounded-md border border-rule bg-surface-sunk p-2.5">
                      <p className="flex items-center justify-between gap-2"><span className="num font-semibold">{money(p.amount)}</span><StateChip value={p.status} /></p>
                      <p className="mt-0.5 text-caption text-steel">{codeLabel(t, "pay.method", p.method)} · {p.externalReference} · <span dir="auto">{p.payerName}</span> · {t("rq.recordedBy", { n: p.recordedBy })}{p.verifiedBy && ` · ${t("rq.verifiedBy", { n: p.verifiedBy })}`}</p>
                      {p.status === "RECORDED" && can("payment.record") && <div className="mt-1.5 flex items-center gap-2"><Button size="xs" variant="outline" onClick={() => verifyPayment.mutate(p.id)} loading={verifyPayment.isPending}>{t("rq.verifySecond")}</Button>{p.needsSecondVerifier && <span className="text-caption text-orange-700">{t("rq.fourEyes")}</span>}</div>}
                    </li>
                  ))}
                </ul>
              ) : <Empty>—</Empty>}
            </div>
            {(canOverride || d.creditOverrides.length > 0) && (
              <div data-testid="credit-overrides">
                <SubHead className="mb-2" aside={canOverride && <button type="button" className={cn(textLink, "underline-offset-4")} onClick={() => dlg.open("override")}>{t("case.rec.requestOverride")}</button>}>{t("case.rec.override")}</SubHead>
                <ul className="space-y-2">
                  {d.creditOverrides.map((o) => (
                    <li key={o.id} className="rounded-md border border-rule bg-surface-sunk p-2.5">
                      <p className="flex flex-wrap items-center justify-between gap-2"><span dir="auto">“{o.reason}”</span>{o.approvedAt ? <StateChip value="APPROVED" /> : <StateChip value="PENDING" />}</p>
                      <p className="text-caption text-steel">{t("rq.requestedBy", { n: o.requestedBy })} · {fmtDateTime(o.createdAt)}{o.approvedBy && ` · ${t("rq.approvedBy", { n: o.approvedBy })} ${fmtDateTime(o.approvedAt)}`}</p>
                      {!o.approvedAt && !o.requestedByMe && can("user.role.assign.privileged") && <Button size="xs" variant="outline" className="mt-1" onClick={() => approveOverride.mutate(o.id)} loading={approveOverride.isPending}>{t("rq.approveOwner")}</Button>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CaseSection>

          <CaseSection id="sec-tickets" icon={Ticket} title={t("rq2.tickets")} description={t("rq2.tickets.desc")} className="order-[60] lg:order-none">
            <div>
              <SubHead className="mb-2">{t("case.rec.reservation")}</SubHead>
              {d.reservations.length ? (
                <ul className="space-y-2">{d.reservations.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-rule bg-surface-sunk p-2.5"><span><span className="num font-semibold">{r.recordLocator ?? r.externalReference}</span>{!r.recordLocator && <span className="text-caption text-steel"> ({t("res.noPnr")})</span>}{r.note && <span className="block text-caption text-steel" dir="auto">{r.note}</span>} <span className="text-steel">{r.system} · {Object.entries(r.airlineLocators).map(([k, v]) => `${k}:${v}`).join(" ")}</span></span><span className="flex items-center gap-2"><span className="num text-caption">{t("rq.ttl", { t: fmtDateTime(r.ticketingDeadline) })}</span><StateChip value={r.status} /></span></li>)}</ul>
              ) : <Empty>—</Empty>}
            </div>
            <div>
              <SubHead className="mb-2">{t("case.rec.tickets")}</SubHead>
              {d.tickets.length ? <ul className="ledger-rows">{d.tickets.map((tk) => <li key={tk.id} className="flex items-center justify-between py-1"><span><span className="num">{tk.ticketNumber}</span> {tk.travellerName}</span><StateChip value={tk.status} /></li>)}</ul> : <Empty>—</Empty>}
                {d.identityOverride && <p className="mt-1 rounded-md bg-warning-subtle px-2 py-1 text-caption" data-testid="identity-override-note">{t("tk.overrideShown", { by: d.identityOverride.by ?? "staff", at: d.identityOverride.at ? fmtDateTime(d.identityOverride.at) : "" })} <span dir="auto">“{d.identityOverride.reason}”</span></p>}
                {d.intake?.createdByStaff && <p className="mt-1 text-caption text-steel">{t("fnew.createdBy", { by: d.intake.createdByStaff, channel: d.intake.channel.toLowerCase().replace("_", " ") })}</p>}
            </div>
            {(d.afterSales.length > 0 || (["TICKETED", "COMPLETED"].includes(d.status) && canAct)) && (
              <div data-testid="after-sales">
                <SubHead className="mb-2" aside={["TICKETED", "COMPLETED"].includes(d.status) && canAct && <button type="button" className={cn(textLink, "underline-offset-4")} onClick={() => dlg.open("aftersales")}>{t("case.rec.openCase")}</button>}>{t("case.rec.afterSales")}</SubHead>
                <ul className="space-y-2">
                  {d.afterSales.map((a) => (
                    <li key={a.ref} className="rounded-md border border-rule bg-surface-sunk p-2.5">
                      <p className="flex flex-wrap items-center gap-1.5"><span className="ref">{a.ref}</span><span className="text-steel">{a.type}</span><StateChip value={a.status} /><span className="num text-caption text-steel">{fmtDate(a.createdAt)}</span></p>
                      {a.note && <p className="text-meta text-steel" dir="auto">“{a.note}”</p>}
                      {canAct && !["RESOLVED", "REJECTED"].includes(a.status) && <p className="flex flex-wrap gap-1">{["start", "request_info", "resolve", "reject"].map((c) => <Button key={c} size="xs" variant="ghost" onClick={() => void asCommand(a.ref, c)}>{codeLabel(t, "rq.as", c)}</Button>)}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <TicketDocumentsPanel requestRef={d.ref} status={d.status} />
          </CaseSection>

          <CaseSection id="sec-documents" icon={Paperclip} title={t("case.panel.documents")} description={t("rq2.docs.desc")} count={d.documents.length} className="order-[70] lg:order-none">
            {!d.documents.length ? <Empty>{t("case.docs.none")}</Empty> : <ul className="ledger-rows">{d.documents.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-2 py-1.5"><button type="button" className="inline-flex min-w-0 items-center gap-2 text-start underline-offset-2 hover:underline" onClick={() => void download(doc.id)}><FileText className="size-4 shrink-0 text-steel" aria-hidden /><span className="truncate">{doc.filename}</span></button><span className="flex gap-1"><Tag value={doc.type} /><Tag value={doc.visibility} /></span></li>)}</ul>}
          </CaseSection>
        </div>
      </div>

      {mobile && bar}
      <CommandDialog command={command} d={d} onClose={() => setCommand(null)} done={refresh} />
      <ReservationDialog {...dlg.bind("reservation")} d={d} done={refresh} />
      <TicketsDialog {...dlg.bind("tickets")} d={d} done={refresh} />
      <PaymentDialog {...dlg.bind("payment")} d={d} done={refresh} />
      <CreditOverrideDialog {...dlg.bind("override")} d={d} done={refresh} />
      <AfterSalesDialog {...dlg.bind("aftersales")} d={d} done={refresh} />
      <AmendDialog {...dlg.bind("amend")} d={d} done={refresh} />
      <FormDialog {...dlg.bind("contact")} title={t("case.log.title")} description={t("case.log.desc")} submitLabel={t("case.log.submit")} onSubmit={async () => { await api(`/v1/admin/flight-requests/${ref}/contact-attempts`, { body: { channel: "PHONE", outcome: contact.outcome, note: contact.note || undefined, callBackAt: contact.outcome === "CALL_BACK_REQUESTED" && contact.callBackAt ? new Date(contact.callBackAt).toISOString() : undefined } }); setContact({ outcome: "REACHED", note: "", callBackAt: "" }); await refresh() }}>
        <Field label={t("case.log.outcome")}><NativeSelect className="field-input" value={contact.outcome} onChange={(e) => setContact({ ...contact, outcome: e.target.value })}>{["REACHED", "NO_ANSWER", "BUSY", "WRONG_NUMBER", "CALL_BACK_REQUESTED"].map((o) => <option key={o} value={o}>{codeLabel(t, "rq.contact", o)}</option>)}</NativeSelect></Field>
        {contact.outcome === "CALL_BACK_REQUESTED" && <Field label={t("case.log.callback")}><input type="datetime-local" className="field-input" value={contact.callBackAt} onChange={(e) => setContact({ ...contact, callBackAt: e.target.value })} required /></Field>}
        <Field label={t("case.log.note")}><textarea className="field-input min-h-20" value={contact.note} onChange={(e) => setContact({ ...contact, note: e.target.value })} dir="auto" /></Field>
      </FormDialog>
      <FormDialog {...dlg.bind("sms")} title={t("case.sms.title")} description={t("case.sms.desc")} submitLabel={t("case.sms.submit")} onSubmit={async () => { await api(`/v1/admin/flight-requests/${ref}/contact-attempts`, { body: { channel: "SMS_TEMPLATE", outcome: "NO_ANSWER", templateKey: sms } }); await refresh() }}>
        <Field label={t("case.sms.template")}><NativeSelect className="field-input" value={sms} onChange={(e) => setSms(e.target.value)}><option value="tried_to_call">{t("rq.sms.tried", { ref: d.ref })}</option><option value="please_contact">{t("rq.sms.please", { ref: d.ref })}</option></NativeSelect></Field>
      </FormDialog>
    </div>
  )
}
