"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import type { Itinerary, SearchQuery, SearchState } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { TruthBadge } from "@/components/flight/itinerary"
import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Field, PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, minutes, money } from "@/lib/format"
import type { FlightDetail } from "@/lib/types"

const place = (code: string) => (code.length === 3 ? { city: code.toUpperCase() } : { airport: code.toUpperCase() })
const code = (p: SearchQuery["slices"][number]["from"]) => ("city" in p ? p.city : p.airport)

/** Staff search (ch. 15.2): the customer engine plus staff fields — provider, booking class, fare basis, offer id. */
function StaffSearch() {
  const params = useSearchParams()
  const router = useRouter()
  const ref = params.get("ref")
  const req = useQuery({ queryKey: ["fr-detail", ref], queryFn: () => api<FlightDetail>(`/v1/admin/flight-requests/${ref}`), enabled: !!ref })
  const [f, setF] = useState({ trip: "ONE_WAY", from: "THR", to: "LON", date: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10), back: "", adults: 1, cabin: "ECONOMY", selfTransfer: true, maxStops: 2, gateways: true })
  const [query, setQuery] = useState<SearchQuery | null>(null)
  useEffect(() => {
    const q = req.data?.query
    if (!q) return
    setF((x) => ({ ...x, trip: q.tripType === "RETURN" ? "RETURN" : "ONE_WAY", from: code(q.slices[0]!.from), to: code(q.slices[0]!.to), date: q.slices[0]!.date, back: q.slices[1]?.date ?? "", adults: q.passengers.length, cabin: q.cabin, selfTransfer: q.preferences.allowSelfTransfer, maxStops: q.preferences.maxStops, gateways: q.preferences.includeGateways ?? true }))
    setQuery(q)
  }, [req.data])
  const [searchId, setSearchId] = useState<string | null>(null)
  const [startErr, setStartErr] = useState<unknown>(null)
  const state = useQuery({
    queryKey: ["staff-search", searchId], enabled: !!searchId,
    queryFn: () => api<SearchState>(`/v1/admin/flight-searches/${searchId}?limit=40`),
    refetchInterval: (q) => (q.state.data && q.state.data.status !== "RUNNING" ? false : 1200),
  })
  const start = async (e?: React.FormEvent) => {
    e?.preventDefault(); setStartErr(null)
    const built: SearchQuery = query && ref ? { ...query, slices: query.slices.map((s, i) => ({ ...s, date: i === 0 ? f.date : f.back || s.date })) } : {
      tripType: f.trip as SearchQuery["tripType"], cabin: f.cabin as SearchQuery["cabin"],
      slices: [{ from: place(f.from), to: place(f.to), date: f.date, flexDays: 0 }, ...(f.trip === "RETURN" && f.back ? [{ from: place(f.to), to: place(f.from), date: f.back, flexDays: 0 }] : [])],
      passengers: Array.from({ length: f.adults }, () => ({ type: "ADT" as const })),
      preferences: { allowSelfTransfer: f.selfTransfer, allowAirportChange: false, allowOvernight: true, maxStops: f.maxStops, includeGateways: f.gateways, nearestCabin: false, studentFare: false },
    }
    try { const r = await api<{ id: string }>("/v1/admin/flight-searches", { body: built }); setSearchId(r.id) } catch (e2) { setStartErr(e2) }
  }
  const s = state.data
  return (
    <div>
      <PageHead kicker={ref ? <>Finding options for <Link className="num hover:underline" href={`/requests/${ref}`}>{ref}</Link>{req.data && ` · ${req.data.routeLabel}`}</> : "Same engine as customers, with staff fields"} title="Staff flight search" />
      <form onSubmit={start} className="sticky top-12 z-10 flex flex-wrap items-end gap-2 border-b border-rule bg-ledger px-5 py-3">
        {!ref && <Field label="Trip" className="w-28"><NativeSelect className="field-input" value={f.trip} onChange={(e) => setF({ ...f, trip: e.target.value })}><option value="ONE_WAY">One way</option><option value="RETURN">Return</option></NativeSelect></Field>}
        <Field label="From" className="w-20"><input className="field-input font-mono uppercase" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} maxLength={3} required disabled={!!ref} /></Field>
        <Field label="To" className="w-20"><input className="field-input font-mono uppercase" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} maxLength={3} required disabled={!!ref} /></Field>
        <Field label="Depart" className="w-36"><input type="date" className="field-input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
        {(f.trip === "RETURN") && <Field label="Return" className="w-36"><input type="date" className="field-input" value={f.back} onChange={(e) => setF({ ...f, back: e.target.value })} /></Field>}
        {!ref && <>
          <Field label="Adults" className="w-16"><input type="number" min={1} max={9} className="field-input num" value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) })} /></Field>
          <Field label="Cabin" className="w-36"><NativeSelect className="field-input" value={f.cabin} onChange={(e) => setF({ ...f, cabin: e.target.value })}>{["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"].map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
          <Field label="Max stops" className="w-20"><input type="number" min={0} max={3} className="field-input num" value={f.maxStops} onChange={(e) => setF({ ...f, maxStops: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-1 pb-1.5"><input type="checkbox" checked={f.selfTransfer} onChange={(e) => setF({ ...f, selfTransfer: e.target.checked })} /> Self-transfer</label>
          <label className="flex items-center gap-1 pb-1.5"><input type="checkbox" checked={f.gateways} onChange={(e) => setF({ ...f, gateways: e.target.checked })} /> Gateways</label>
        </>}
        {ref && <p className="pb-1.5 text-steel">Uses the request&apos;s passengers, cabin and preferences.</p>}
        <Button size="sm" type="submit" loading={state.isFetching && s?.status === "RUNNING"}>Search</Button>
      </form>
      <div className="px-5 py-3">
        {(startErr ?? state.error) ? <TileError message={errText(startErr ?? state.error)} /> : null}
        {s && s.status === "RUNNING" && !s.results.length && <ListSkeleton rows={4} className="p-0" />}
        {s && <p className="mb-2 text-steel" role="status" data-testid="search-status">{s.status === "RUNNING" ? `Searching… ${s.progress.sourcesDone}/${s.progress.sourcesTotal} sources` : `${s.results.length} results · ${s.status.toLowerCase()} · rules v${s.ruleVersion}`}{s.progress.removedByPolicy > 0 && ` · ${s.progress.removedByPolicy} removed by policy`}{s.notices.length > 0 && ` · ${s.notices.join(" · ")}`}</p>}
        {s && s.status !== "RUNNING" && !s.results.length && <EmptyState title="No itineraries." />}
        {s && s.results.length > 0 && (
          <TableScroll><table className="w-full border-collapse bg-surface-raised" data-testid="search-results">
            <thead className="bg-surface-raised"><tr className="border-b border-rule">{["Price", "Itinerary", "Duration", "Build", "Truth", "Staff fields", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {s.results.map((it: Itinerary) => (
                <tr key={it.id} className="border-b border-rule/70 align-top">
                  <td className="num px-2 py-1.5 font-medium whitespace-nowrap">{it.price ? money(it.price.total) : <span className="text-steel" title="Requires pricing.read.internal">Hidden</span>}{it.price?.isSumOfTickets && <span className="block text-[10px] font-normal text-steel">sum of tickets</span>}</td>
                  <td className="px-2 py-1.5">{it.components.flatMap((c) => c.slices).map((sl, i) => <p key={i} className="num text-[12px]">{sl.segments.map((g) => `${g.marketing.carrier}${g.marketing.flightNumber} ${g.origin.iata}–${g.destination.iata} ${g.departure.local.slice(5).replace("T", " ")}`).join(" · ")}</p>)}{it.riskFlags.length > 0 && <p className="font-mono text-[10px] text-danger">{it.riskFlags.join(" ")}</p>}</td>
                  <td className="num px-2 py-1.5 whitespace-nowrap">{minutes(it.durationMin)} · {it.stops} stop{it.stops === 1 ? "" : "s"}</td>
                  <td className="px-2 py-1.5"><span className={cn("font-mono text-[10.5px]", it.ticketing === "SEPARATE_TICKETS" && "text-danger")}>{it.construction}{it.ticketing === "SEPARATE_TICKETS" ? " · SEPARATE" : ""}</span></td>
                  <td className="px-2 py-1.5"><span className="flex flex-wrap gap-1">{it.truth.map((t, i) => <TruthBadge key={i} t={t} />)}</span></td>
                  <td className="px-2 py-1.5 font-mono text-[10.5px] text-steel">{it.components.map((c, i) => <p key={i}>{c.source.provider} · {c.source.providerOfferId.slice(0, 16)} · {c.slices.flatMap((x) => x.segments).map((g) => `${g.bookingClass ?? "?"}/${g.fareBasis ?? "?"}`).join(" ")} · {fmtDateTime(c.source.fetchedAt)}</p>)}</td>
                  <td className="px-2 py-1.5">{ref && it.price ? <Button size="xs" onClick={() => router.push(`/requests/${ref}/quote?add=${encodeURIComponent(it.id)}`)} data-testid="add-to-quote">Add to quote</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table></TableScroll>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return <Suspense><StaffSearch /></Suspense>
}
