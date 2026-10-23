"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useQueueSummary } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { CaseView, FlightListItem, Page, QueueSummary } from "@/lib/types"
import { Empty, Panel, Tag, useAct } from "@/components/ui"

function Rows({ items }: { items: FlightListItem[] | undefined }) {
  if (!items) return <p className="text-slate">Loading…</p>
  if (!items.length) return <Empty>Nothing here.</Empty>
  return (
    <ul className="ledger-rows">
      {items.map((r) => (
        <li key={r.ref}>
          <Link href={`/requests/${r.ref}`} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 py-1.5 hover:bg-mist/40">
            <span className="num text-[12px]">{r.ref}</span>
            <span className="truncate"><span dir="auto">{r.customer ?? "—"}</span> <span className="text-slate">· {r.routeLabel}</span></span>
            <span className="flex items-center gap-2">
              {r.slaBreached ? <span className="num text-[11px] text-brick">SLA {rel(r.slaDueAt)}</span> : r.slaDueAt ? <span className="num text-[11px] text-slate">due {rel(r.slaDueAt)}</span> : null}
              <Tag value={r.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function Home() {
  const { me, can, reload } = useSession()
  const flights = can("flight_request.read.any")
  const summary = useQueueSummary()
  const mine = useQuery({ queryKey: ["fr", "mine-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=mine&limit=10"), enabled: flights })
  const fresh = useQuery({ queryKey: ["fr", "new-home"], queryFn: () => api<Page<FlightListItem>>("/v1/admin/flight-requests?tab=new&limit=10"), enabled: flights, refetchInterval: 30_000 })
  const holds = useQuery({ queryKey: ["cases", "OPEN"], queryFn: () => api<CaseView[]>("/v1/admin/compliance/cases?status=OPEN"), enabled: can("compliance.case.read") })
  const duty = useAct((on: boolean) => api("/v1/me", { method: "PATCH", body: { onDuty: on } }), { onDone: () => void reload(), success: "Duty status updated" })
  const s = summary.data
  const now = new Date()
  const hour = now.getHours()
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink pb-3">
        <div>
          <p className="cap">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now)} · start of shift</p>
          <h1 className="mt-1 font-display text-[30px] leading-none">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, <span dir="auto">{me?.displayName.split(" ")[0]}</span></h1>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-[#3f6b4f]" checked={!!me?.onDuty} onChange={(e) => duty.mutate(e.target.checked)} />
          <span>{me?.onDuty ? "On duty — new requests notify you" : "Off duty"}</span>
        </label>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed" data-testid="shift-line">
        {s ? (
          <>
            <Link className="underline decoration-copper underline-offset-4" href="/queues?tab=new"><b className="num">{s.new}</b> new</Link>
            {" · "}<span className={s.slaBreaches ? "text-brick" : ""}><b className="num">{s.slaBreaches}</b> breaching first-contact SLA</span>
            {" · "}<Link className="underline decoration-copper underline-offset-4" href="/queues?tab=mine"><b className="num">{s.mine}</b> yours open</Link>
            {" · "}<b className="num">{s.awaitingCustomer}</b> awaiting customers
            {" · "}<b className="num">{s.deadlinesNext24h.length}</b> ticketing deadlines in 24 h
            {" · "}<span className={s.complianceHolds ? "text-brick" : ""}><b className="num">{s.complianceHolds}</b> compliance holds</span>
          </>
        ) : "Counting the queues…"}
      </p>
      <div className="mt-6 grid gap-x-10 gap-y-2 lg:grid-cols-2">
        {flights && <Panel title="My open cases" aside={<Link href="/queues?tab=mine" className="text-copper-700">Queue →</Link>}><Rows items={mine.data?.items} /></Panel>}
        {flights && <Panel title="Unassigned · by SLA risk" aside={<Link href="/queues?tab=new" className="text-copper-700">Queue →</Link>}><Rows items={fresh.data?.items} /></Panel>}
        <Panel title="Reservations with deadlines in the next 24 h">
          {!s ? <p className="text-slate">Loading…</p> : !s.deadlinesNext24h.length ? <Empty>No ticketing deadlines in the next 24 hours.</Empty> : (
            <ul className="ledger-rows">{s.deadlinesNext24h.map((d) => <li key={d.ref} className="flex justify-between py-1.5"><Link className="num" href={`/requests/${d.ref}`}>{d.ref}</Link><span className="num text-brick">{fmtDateTime(d.deadline)} · {rel(d.deadline)}</span></li>)}</ul>
          )}
        </Panel>
        {can("compliance.case.read") && (
          <Panel title="Compliance holds" aside={<Link href="/compliance" className="text-copper-700">Cases →</Link>}>
            {!holds.data ? <p className="text-slate">Loading…</p> : !holds.data.length ? <Empty>No open holds.</Empty> : (
              <ul className="ledger-rows">{holds.data.slice(0, 8).map((c) => <li key={c.id}><Link href={`/compliance/${c.id}`} className="grid grid-cols-[auto_1fr_auto] gap-3 py-1.5 hover:bg-mist/40"><span className="num">{c.requestRef}</span><span className="truncate" dir="auto">{c.summary}</span><Tag value={c.trigger} /></Link></li>)}</ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
