"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { TileError } from "@/components/bento"
import { ActionBar, ActionMenu, CaseTabs, CommandBar, commandLabelOf, DESTRUCTIVE, ListSkeleton, PanelTabs, paneClass, paneProps, pickPrimary, StateChip, tallyOptions, Timeline } from "@/components/case"
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
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Composer, MessagesList, NotesList } from "@/components/thread"
import { Arrow, Empty, ErrorLine, Field, Loading, Panel, RouteText, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime, ltrIsolate, money } from "@/lib/format"
import { useIsMobile, useKeys } from "@/lib/hooks"
import { type MsgKey, statusText, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useFallbackInterval } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { FlightDetail } from "@/lib/types"

// Mobile admin mode (ch. 15.8) leaves quote sending and recording dialogs to the desktop.
const DESKTOP_ONLY = new Set(["send_quote", "record_acceptance", "record_reservation", "record_tickets"])
type Money2 = { amountMinor: number; currency: string }
type PriceCheck = { outcome: string; previousTotal: Money2; currentTotal?: Money2; checkedAt: string }
type Dlg = "contact" | "sms" | "reservation" | "tickets" | "payment" | "override" | "aftersales" | "amend"

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
  const [thread, setThread] = useState<"messages" | "notes" | "timeline">("messages")
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
  // The composers stay mounted under their tab, so the shortcut first shows the tab, then focuses after the DOM update.
  const focusThread = (to: "messages" | "notes", ref: React.RefObject<HTMLTextAreaElement | null>) => { setTab("case"); setThread(to); requestAnimationFrame(() => ref.current?.focus()) }
  useKeys({ c: () => { if (claim?.allowed) void claimOrSimple("claim") }, n: () => focusThread("notes", noteRef), m: () => focusThread("messages", msgRef) }, !!d)

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
  const primary = pickPrimary(allowedNow)
  const danger = allowedNow.filter((a) => DESTRUCTIVE.has(a.command))
  const mainRow = visibleActions.filter((a) => !(a.allowed && DESTRUCTIVE.has(a.command)))
  // Phones: one solid primary and a menu with everything else (also the commands that cannot run, with the server's reason).
  const phoneMenu = visibleActions.filter((a) => a !== primary)
  const desktopNote = mobile && d.actions.some((a) => DESKTOP_ONLY.has(a.command)) && <p className="mt-1 text-caption text-steel">{t("case.desktopOnly")}</p>
  const bar = mobile ? (
    <ActionBar edge="bottom" aria-label={t("case.actions")} className="bottom-[calc(4rem+env(safe-area-inset-bottom))]">
      <div className="flex items-center gap-2">
        <div data-testid="actions" className="min-w-0 flex-1">
          {primary ? <Button className="w-full pointer-coarse:min-h-11" onClick={() => run(primary.command)} data-command={primary.command}>{commandLabelOf(primary.command, locale)}</Button> : <p className="py-1 text-steel">{t("case.actions.none", { status: d.status })}</p>}
        </div>
        <ActionMenu items={phoneMenu} onRun={run} />
      </div>
      {desktopNote}
    </ActionBar>
  ) : (
    <ActionBar aria-label={t("case.actions")}>
      <div className="flex items-start gap-2">
        <div data-testid="actions" className="min-w-0 flex-1">
          <CommandBar actions={mainRow} onRun={run} none={t("case.actions.none", { status: d.status })} hint={<><span className="kbd">c</span> claim · <span className="kbd">n</span> note · <span className="kbd">m</span> message · {t("case.actions.hint")}</>} />
        </div>
        <ActionMenu items={danger} onRun={run} />
      </div>
    </ActionBar>
  )

  return (
    <div className={cn(mobile ? "pb-2" : "pb-8")}>
      {changed && (
        <div role="status" className="flex items-center justify-between gap-3 bg-warning-subtle px-5 py-2 text-warning-subtle-fg">
          <span>{t("case.changed", { from: d.version, to: poll.data ?? "" })}</span>
          <Button size="xs" variant="outline" onClick={() => void refresh()}>{t("case.reload")}</Button>
        </div>
      )}
      <RequestHero d={d} mobile={mobile} mineCase={mineCase} tally={tally} quoteVersion={latestQuote?.version ?? null} />
      {!mobile && bar}
      <CaseTabs label={t("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "case", label: t("case.tab.case") }, { key: "customer", label: t("case.tab.customer") }, { key: "records", label: t("case.tab.records"), count: d.reservations.length + d.tickets.length + d.payments.length }]} />

      <div className="grid gap-x-8 px-5 pt-2 lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        {/* LEFT — customer */}
        <div {...paneProps("customer")} className={paneClass(tab, "customer")}>
          <Panel title={t("case.panel.customer")} aside={can("customer.read.pii") && <Link href={`/customers/${d.customer.id}?ref=${d.ref}`} className="font-medium text-link hover:underline">{t("case.context")} <Arrow /></Link>}>
            <CustomerCard d={d} mobile={mobile} canAct={can("flight_request.transition")} onCopy={() => { void navigator.clipboard.writeText(d.customer.phone); toast.success(t("rq.copied")) }} onCall={() => dlg.open("contact")} onSms={() => dlg.open("sms")} />
          </Panel>
          <Panel title={<>{t("case.panel.travellers")} <span className="num text-steel">{d.travellers.length}</span></>}>
            <ul className="space-y-2">
              {d.travellers.map((t, i) => <TravellerCard key={t.travellerId} t={t} index={i} revealed={revealed[t.travellerId]} canReveal={can("customer.read.documents")} onReveal={() => reveal.mutate(t.travellerId)} verificationLabel={tt(`vstatus.${t.verificationStatus}` as MsgKey)} />)}
            </ul>
            {Object.keys(revealed).length > 0 && <p className="text-caption text-steel">{t("case.reveal.note")}</p>}
          </Panel>
          <Panel title={t("case.panel.contacts")}>
            {!d.contacts.length ? <Empty>{t("case.contacts.none")}</Empty> : (
              <ul className="ledger-rows" data-testid="contacts">{d.contacts.map((c) => <li key={c.id} className="py-1"><span className="num text-meta">{fmtDateTime(c.createdAt)}</span> · <StateChip value={c.outcome} />{c.channel === "SMS_TEMPLATE" && <span className="ms-1 text-steel">{t("rp.sms")}</span>}{c.note && <p className="text-steel" dir="auto">“{c.note}”</p>}{c.callBackAt && <p className="text-caption text-orange-700">{t("rq.callBack", { t: fmtDateTime(c.callBackAt) })}</p>}</li>)}</ul>
            )}
          </Panel>
          <Panel title={t("case.panel.history")}>
            {!d.customer.history.length ? <Empty>{t("case.history.first")}</Empty> : <ul className="ledger-rows">{d.customer.history.map((h) => <li key={h.ref} className="flex justify-between py-1"><Link className="ref text-meta hover:underline" href={h.productType === "CARGO" ? `/cargo/${h.ref}` : `/requests/${h.ref}`}>{h.ref}</Link><StateChip value={h.status} /></li>)}</ul>}
          </Panel>
        </div>

        {/* CENTRE — request, conversation, activity */}
        <div {...paneProps("case")} className={cn("min-w-0", paneClass(tab, "case"))}>
          <Panel title={t("case.panel.request")} aside={can("flight_request.transition") && !mobile ? (d.amendment?.allowed
            ? <Button size="xs" variant="outline" onClick={() => dlg.open("amend")} data-testid="amend-open">{t("rq.amend")}</Button>
            : <span className="text-caption text-steel" title={d.amendment?.reason}>{t("rq.amendWhy", { why: d.amendment?.reason ?? t("rq.notAvailable") })}</span>) : undefined}>
            <TripSummary d={d} />
          </Panel>
          {d.snapshot && (
            <Panel title={t("case.panel.snapshot")} aside={can("pricing.read.internal") && <Button size="xs" variant="outline" onClick={() => recheck.mutate()} loading={recheck.isPending}>{t("rq.recheck")}</Button>}>
              <div className="rounded-md border border-rule bg-surface-raised p-3">
                <ItineraryView it={d.snapshot.itinerary} />
                <p className="mt-2 flex flex-wrap gap-x-4 text-meta text-steel">{d.snapshot.priceAtSubmit && <span>{t("rq.atSubmission")} <b className="num text-ink">{money(d.snapshot.priceAtSubmit)}</b></span>}{d.snapshot.priceRevalidated && <span>{t("rq.revalidated")} <b className="num text-ink">{money(d.snapshot.priceRevalidated)}</b> {fmtDateTime(d.snapshot.revalidatedAt)}</span>}<span>{t("rq.rules", { v: d.snapshot.ruleVersion })} · {d.snapshot.engineVersion}</span><span className="font-mono">#{d.snapshot.contentHash.slice(0, 10)}</span></p>
                {recheck.error && <ErrorLine error={recheck.error} />}
                <IndicativeSource d={d} />
              </div>
            </Panel>
          )}
          {d.serviceInterests.length > 0 && (
            <Panel title={t("rq.interests")}>
              <ul className="flex flex-wrap gap-1.5" data-testid="service-interests">{d.serviceInterests.map((i) => <li key={i.code} className="rounded-sm border border-rule bg-surface-sunk px-1.5 py-0.5 text-meta"><span dir="auto">{locale === "fa" ? i.nameFa : i.nameEn}</span> <span className="num text-steel">{i.code}</span></li>)}</ul>
              <p className="mt-1.5 text-caption text-steel">{t("rq.interests.hint")}</p>
            </Panel>
          )}
          {d.compliance.length > 0 && (
            <Panel title={t("case.panel.compliance")}>
              <ul className="ledger-rows">{d.compliance.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><span dir="auto">{c.summary}</span><span className="flex items-center gap-2"><StateChip value={c.status} />{can("compliance.case.read") && <Link className="font-medium text-link hover:underline" href={`/compliance/${c.id}`}>{t("case.open")} <Arrow /></Link>}</span></li>)}</ul>
            </Panel>
          )}
          <Panel title={t("case.activity")}>
            <PanelTabs id="thread" label={t("case.thread.tabs")} value={thread} onChange={setThread} tabs={[{ key: "messages", label: t("case.tab.messages"), count: d.messages.length }, { key: "notes", label: t("case.tab.notes"), count: d.notes.length }, { key: "timeline", label: t("case.tab.timeline"), count: d.timeline.length }]} />
            <div id="thread-pane-messages" role="tabpanel" aria-labelledby="thread-tab-messages" hidden={thread !== "messages"} className="pt-3">
              <MessagesList messages={d.messages} />
              {can("flight_request.transition") && <Composer ref={msgRef} hint={t("case.composer.message")} label={t("rq.sendMessage")} placeholder={t("rq.messagePlaceholder")} testId="message-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/messages`, { body: { body } }); toast.success(t("rq.messageSent")); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
            </div>
            <div id="thread-pane-notes" role="tabpanel" aria-labelledby="thread-tab-notes" hidden={thread !== "notes"} className="pt-3">
              <NotesList notes={d.notes} />
              {can("flight_request.note.internal") && <Composer ref={noteRef} tone="note" label={t("rq.addNote")} hint={t("case.composer.note")} placeholder={t("rq.notePlaceholder")} testId="note-composer" onSend={async (body) => { try { await api(`/v1/admin/flight-requests/${ref}/notes`, { body: { body } }); toast.success(t("rq.noteAdded")); await refresh() } catch (e) { toast.error(errText(e)); throw e } }} />}
            </div>
            <div id="thread-pane-timeline" role="tabpanel" aria-labelledby="thread-tab-timeline" hidden={thread !== "timeline"} className="pt-3">
              <Timeline data-testid="timeline" items={d.timeline.map((x, i) => ({ id: i, at: x.at, title: x.label, detail: x.detail, meta: x.actor?.toLowerCase(), tone: x.kind === "STATUS" ? "strong" : x.kind === "CONTACT" ? "accent" : "muted" }))} />
            </div>
          </Panel>
        </div>

        {/* RIGHT — quotes, invoices, records, documents */}
        <div {...paneProps("records")} className={cn(paneClass(tab, "records"), "lg:col-span-2 xl:col-span-1")}>
          {!mobile && (can("quote.create") || can("pricing.write")) && (
            <Panel title={t("case.panel.quotes")} aside={["IN_REVIEW", "QUOTED", "ACCEPTED"].includes(d.status) && <Link href={`/requests/${d.ref}/quote${draft ? `?quote=${draft.id}` : ""}`} className="font-medium text-link hover:underline" data-testid="open-quote-builder">{draft ? t("case.quote.edit") : t("case.quote.new")} <Arrow /></Link>}>
              {!d.quotes.length ? <Empty>{t("case.quotes.none")}</Empty> : (
                <ul className="ledger-rows" data-testid="quotes">
                  {d.quotes.map((qv) => (
                    <li key={qv.id} className="py-1.5">
                      <p className="flex items-center justify-between"><span>v{qv.version} · {t(qv.options.length === 1 ? "rq.option.one" : "rq.options", { n: qv.options.length })}{qv.validUntil && <span className="text-steel"> · {t("rq.validUntil", { t: fmtDateTime(qv.validUntil) })}</span>}</span><StateChip value={qv.status} /></p>
                      <ul className="text-meta">{qv.options.map((o) => <li key={o.id} className="flex justify-between gap-2"><span className="truncate">{o.id === qv.acceptedOptionId && "✓ "}<RouteText>{o.label}</RouteText>{o.source === "MANUAL" && <span className="ms-1 font-mono text-2xs text-orange-700">{statusText(t, "MANUAL")}</span>}{o.unknownFields.length > 0 && <span className="ms-1 text-danger">· {t("rq.toConfirm", { n: o.unknownFields.length })}</span>}</span><span className="num">{money(o.priceBreakdown.total)}</span></li>)}</ul>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {!mobile && ["ACCEPTED", "RESERVED", "TICKETED", "COMPLETED"].includes(d.status) && <InvoicesPanel requestRef={d.ref} />}
          <Panel title={t("case.panel.records")}>
            <dl className="ledger-rows">
              <div className="py-1.5">
                <dt className="flex justify-between"><span className="text-steel">{t("case.rec.reservation")}</span></dt>
                {d.reservations.length ? d.reservations.map((r) => <dd key={r.id} className="flex flex-wrap items-center justify-between gap-1"><span><span className="num font-medium">{r.recordLocator ?? r.externalReference}</span>{!r.recordLocator && <span className="text-caption text-steel"> ({t("res.noPnr")})</span>}{r.note && <span className="block text-caption text-steel" dir="auto">{r.note}</span>} <span className="text-steel">{r.system} · {Object.entries(r.airlineLocators).map(([k, v]) => `${k}:${v}`).join(" ")}</span></span><span className="flex items-center gap-2"><span className="num text-caption">{t("rq.ttl", { t: fmtDateTime(r.ticketingDeadline) })}</span><StateChip value={r.status} /></span></dd>) : <dd>—</dd>}
              </div>
              <div className="py-1.5">
                <dt className="text-steel">{t("case.rec.tickets")}</dt>
                {d.tickets.length ? d.tickets.map((tk) => <dd key={tk.id} className="flex justify-between"><span><span className="num">{tk.ticketNumber}</span> {tk.travellerName}</span><StateChip value={tk.status} /></dd>) : <dd>—</dd>}
              </div>
              <div className="py-1.5">
                <dt className="flex items-center justify-between"><span className="text-steel">{t("case.rec.payments")} · {statusText(t, d.paymentStatus)}</span>{!mobile && can("payment.record") && <RecordPaymentTrigger state={d.paymentRecording} onOpen={() => dlg.open("payment")} />}</dt>
                {d.payments.length ? d.payments.map((p) => (
                  <dd key={p.id} className="mt-1">
                    <p className="flex justify-between"><span className="num">{money(p.amount)}</span><StateChip value={p.status} /></p>
                    <p className="text-caption text-steel">{codeLabel(t, "pay.method", p.method)} · {p.externalReference} · <span dir="auto">{p.payerName}</span> · {t("rq.recordedBy", { n: p.recordedBy })}{p.verifiedBy && ` · ${t("rq.verifiedBy", { n: p.verifiedBy })}`}</p>
                    {p.status === "RECORDED" && can("payment.record") && <div className="mt-1 flex items-center gap-2"><Button size="xs" variant="outline" onClick={() => verifyPayment.mutate(p.id)} loading={verifyPayment.isPending}>{t("rq.verifySecond")}</Button>{p.needsSecondVerifier && <span className="text-caption text-orange-700">{t("rq.fourEyes")}</span>}</div>}
                  </dd>
                )) : <dd>—</dd>}
              </div>
              {(canOverride || d.creditOverrides.length > 0) && (
                <div className="py-1.5" data-testid="credit-overrides">
                  <dt className="flex justify-between"><span className="text-steel">{t("case.rec.override")}</span>{canOverride && <button type="button" className="font-medium text-link underline-offset-4 hover:underline" onClick={() => dlg.open("override")}>{t("case.rec.requestOverride")}</button>}</dt>
                  {d.creditOverrides.map((o) => (
                    <dd key={o.id} className="mt-1">
                      <p className="flex flex-wrap items-center justify-between gap-2"><span dir="auto">“{o.reason}”</span>{o.approvedAt ? <StateChip value="APPROVED" /> : <StateChip value="PENDING" />}</p>
                      <p className="text-caption text-steel">{t("rq.requestedBy", { n: o.requestedBy })} · {fmtDateTime(o.createdAt)}{o.approvedBy && ` · ${t("rq.approvedBy", { n: o.approvedBy })} ${fmtDateTime(o.approvedAt)}`}</p>
                      {!o.approvedAt && !o.requestedByMe && can("user.role.assign.privileged") && <Button size="xs" variant="outline" className="mt-1" onClick={() => approveOverride.mutate(o.id)} loading={approveOverride.isPending}>{t("rq.approveOwner")}</Button>}
                    </dd>
                  ))}
                </div>
              )}
              {(d.afterSales.length > 0 || (["TICKETED", "COMPLETED"].includes(d.status) && can("flight_request.transition"))) && (
                <div className="py-1.5" data-testid="after-sales">
                  <dt className="flex justify-between"><span className="text-steel">{t("case.rec.afterSales")}</span>{["TICKETED", "COMPLETED"].includes(d.status) && can("flight_request.transition") && <button type="button" className="font-medium text-link underline-offset-4 hover:underline" onClick={() => dlg.open("aftersales")}>{t("case.rec.openCase")}</button>}</dt>
                  {d.afterSales.map((a) => (
                    <dd key={a.ref} className="mt-1">
                      <p className="flex flex-wrap items-center gap-1.5"><span className="ref">{a.ref}</span><span className="text-steel">{a.type}</span><StateChip value={a.status} /><span className="num text-caption text-steel">{fmtDate(a.createdAt)}</span></p>
                      {a.note && <p className="text-meta text-steel" dir="auto">“{a.note}”</p>}
                      {can("flight_request.transition") && !["RESOLVED", "REJECTED"].includes(a.status) && <p className="flex flex-wrap gap-1">{["start", "request_info", "resolve", "reject"].map((c) => <Button key={c} size="xs" variant="ghost" onClick={() => void asCommand(a.ref, c)}>{codeLabel(t, "rq.as", c)}</Button>)}</p>}
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          </Panel>
          <Panel title={t("case.panel.documents")}>
            {!d.documents.length ? <Empty>{t("case.docs.none")}</Empty> : <ul className="ledger-rows">{d.documents.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-2 py-1"><button type="button" className="truncate text-start underline-offset-2 hover:underline" onClick={() => void download(doc.id)}>{doc.filename}</button><span className="flex gap-1"><Tag value={doc.type} /><Tag value={doc.visibility} /></span></li>)}</ul>}
          </Panel>
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
