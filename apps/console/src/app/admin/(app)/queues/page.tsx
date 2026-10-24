"use client"

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Bookmark, SlidersHorizontal, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { FormDialog } from "@/components/form-dialog"
import { EmptyState, Skeleton, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, SlaChip, StateChip } from "@/components/case"
import { api, errText } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useFallbackInterval, useQueueSummary } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { CargoListItem, FlightDetail, FlightListItem, Page, QueueSummary } from "@/lib/types"
import { readViews, useSavedViews, writeViews } from "@/lib/views"

const TABS = [
  { key: "new", label: "New", count: (s: QueueSummary) => s.new },
  { key: "mine", label: "Mine", count: (s: QueueSummary) => s.mine },
  { key: "awaiting", label: "Awaiting customer", count: (s: QueueSummary) => s.awaitingCustomer },
  { key: "quoted", label: "Quoted", count: (s: QueueSummary) => s.quoted },
  { key: "reserved", label: "Reserved", count: (s: QueueSummary) => s.reserved },
  { key: "cargo", label: "Cargo" },
  { key: "all", label: "All" },
] as const
const FLIGHT_STATUSES = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DECLINED", "CANCELLED", "EXPIRED"]
const CARGO_TABS = [{ key: "open", label: "Open" }, { key: "new", label: "New" }, { key: "hold", label: "Compliance hold" }, { key: "", label: "All" }]

type Row = { ref: string; kind: "FLIGHT" | "CARGO"; flight?: FlightListItem; cargo?: CargoListItem }

function QueuesInner() {
  const params = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()
  const { can } = useSession()
  const t = useT()
  const tab = params.get("tab") ?? (can("flight_request.read.any") ? "new" : "cargo")
  const isCargo = tab === "cargo"
  const filters = { q: params.get("q") ?? "", status: params.get("status") ?? "", from: params.get("from") ?? "", to: params.get("to") ?? "", flags: params.get("flags") ?? "", ctab: params.get("ctab") ?? "open" }
  const [draft, setDraft] = useState(filters)
  useEffect(() => { setDraft(filters) }, [params.toString()]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useQueueSummary()
  const listInterval = useFallbackInterval(20_000)

  const qs = (cursor?: string) => {
    const u = new URLSearchParams({ limit: "40" })
    if (isCargo) { if (filters.ctab) u.set("tab", filters.ctab); if (filters.status) u.set("status", filters.status) } else {
      if (tab !== "all") u.set("tab", tab)
      for (const k of ["q", "status", "from", "to", "flags"] as const) if (filters[k]) u.set(k, filters[k])
    }
    if (cursor) u.set("cursor", cursor)
    return u.toString()
  }
  const list = useInfiniteQuery({
    queryKey: [isCargo ? "cargo-list" : "fr", tab, filters],
    queryFn: ({ pageParam }): Promise<Page<FlightListItem | CargoListItem>> => isCargo ? api<Page<CargoListItem>>(`/v1/admin/cargo/requests?${qs(pageParam)}`) : api<Page<FlightListItem>>(`/v1/admin/flight-requests?${qs(pageParam)}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: listInterval,
  })
  const rows: Row[] = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items.map((i) => (isCargo ? { ref: i.ref, kind: "CARGO" as const, cargo: i as CargoListItem } : { ref: i.ref, kind: "FLIGHT" as const, flight: i as FlightListItem }))), [list.data, isCargo])

  const [focus, setFocus] = useState(0)
  useEffect(() => { setFocus(0) }, [tab, params.toString()])
  const focused = rows[Math.min(focus, rows.length - 1)]
  const preview = useQuery({ queryKey: ["fr-detail", focused?.ref], queryFn: () => api<FlightDetail>(`/v1/admin/flight-requests/${focused!.ref}`), enabled: !!focused && focused.kind === "FLIGHT" })
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const tableRef = useRef<HTMLTableSectionElement>(null)

  const claim = async (ref: string) => {
    try {
      const d = preview.data?.ref === ref ? preview.data : await api<FlightDetail>(`/v1/admin/flight-requests/${ref}`)
      const a = d.actions.find((x) => x.command === "claim")
      if (!a?.allowed) { toast.error(a?.reason ?? "Claim is not available for this request"); return }
      await api(`/v1/admin/flight-requests/${ref}/commands/claim`, { body: {}, headers: { "if-match": String(d.version) } })
      toast.success(`${ref} claimed`)
      await Promise.all([qc.invalidateQueries({ queryKey: ["fr"] }), qc.invalidateQueries({ queryKey: ["fr-detail", ref] }), qc.invalidateQueries({ queryKey: ["queue-summary"] })])
    } catch (e) { toast.error(errText(e)) }
  }
  const open = (r: Row) => router.push(r.kind === "CARGO" ? `/cargo/${r.ref}` : `/requests/${r.ref}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(f + 1, rows.length - 1)) }
      else if (e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)) }
      else if (e.key === "Enter" && focused) open(focused)
      else if (e.key === "c" && focused?.kind === "FLIGHT") void claim(focused.ref)
      else if (e.key === "n" && focused) { e.preventDefault(); setNote(""); setNoteFor(focused.ref) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })
  useEffect(() => { tableRef.current?.querySelector<HTMLElement>(`[data-idx="${focus}"]`)?.scrollIntoView({ block: "nearest" }) }, [focus])

  const apply = (next: Partial<typeof filters> & { tab?: string }) => {
    const u = new URLSearchParams()
    const merged = { ...draft, ...next }
    u.set("tab", next.tab ?? tab)
    for (const [k, v] of Object.entries(merged)) if (v && k !== "tab") u.set(k, v)
    router.replace(`/queues?${u.toString()}`)
  }
  const [saving, setSaving] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const views = useSavedViews()
  const activeFilters = [filters.q, filters.status, filters.from, filters.to, filters.flags].filter(Boolean).length
  const currentQuery = params.toString() || `tab=${tab}`
  const startSave = () => setSaving(`${TABS.find((x) => x.key === tab)?.label ?? tab}${filters.q ? ` · ${filters.q}` : ""}`)
  const commitSave = () => {
    const name = saving?.trim()
    setSaving(null)
    if (!name) return
    writeViews([...readViews().filter((v) => v.name !== name), { name, query: currentQuery }])
    toast.success(t("q.views.saved"))
  }

  const s = summary.data
  const hrefOf = (r: Row) => (r.kind === "CARGO" ? `/cargo/${r.ref}` : `/requests/${r.ref}`)
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col md:h-[calc(100dvh-3rem)]">
      <div className="border-b border-rule bg-surface-raised px-4 pt-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-[22px]">Queues</h1>
          <p className="hidden text-[11px] text-steel lg:block"><span className="kbd">j</span>/<span className="kbd">k</span> {t("q.keys")} · <span className="kbd">Enter</span> open · <span className="kbd">c</span> claim · <span className="kbd">n</span> note</p>
        </div>
        <nav className="-mb-px mt-2 flex gap-4 overflow-x-auto" aria-label="Queue tabs">
          {TABS.filter((x) => (x.key === "cargo" ? can("cargo_request.read.any") : can("flight_request.read.any"))).map((x) => (
            <Link key={x.key} href={`/queues?tab=${x.key}`} aria-current={tab === x.key ? "page" : undefined} className={cn("inline-flex min-h-9 items-center border-b-2 whitespace-nowrap", tab === x.key ? "border-orange font-medium text-ink" : "border-transparent text-steel hover:text-ink")}>
              {x.label}{"count" in x && s ? <span className="num ms-1.5 rounded-full bg-hover px-1.5 text-[11px] text-ink">{x.count(s)}</span> : null}
            </Link>
          ))}
        </nav>
      </div>
      <div className="z-10 border-b border-rule bg-ledger" data-testid="queue-filters">
        <div className="flex items-center gap-2 px-4 py-1.5 md:hidden">
          <Button size="sm" variant="outline" type="button" aria-expanded={filtersOpen} aria-controls="queue-filter-form" onClick={() => setFiltersOpen((o) => !o)}><SlidersHorizontal /> {t("q.filters")}{activeFilters > 0 && <StatusChip tone="info" className="ms-1">{t("q.filters.active", { n: activeFilters })}</StatusChip>}</Button>
        </div>
        <form id="queue-filter-form" className={cn("flex-wrap items-end gap-2 px-4 py-2 md:flex", filtersOpen ? "flex" : "hidden")} onSubmit={(e) => { e.preventDefault(); apply({}) }}>
          {isCargo ? (
            <div className="flex flex-wrap gap-1">{CARGO_TABS.map((c) => <button key={c.key} type="button" onClick={() => apply({ ctab: c.key })} aria-pressed={filters.ctab === c.key} className={cn("min-h-8 rounded-sm border px-2.5", filters.ctab === c.key ? "border-ink bg-ink text-surface" : "border-rule-strong hover:bg-hover")}>{c.label}</button>)}</div>
          ) : (
            <>
              <input aria-label="Search reference or phone" placeholder="Ref or phone" className="field-input min-h-8 w-full font-mono sm:w-44" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} dir="ltr" />
              <NativeSelect aria-label="Status" className="field-input min-h-8 w-full sm:w-40" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">Any status</option>{FLIGHT_STATUSES.map((x) => <option key={x}>{x}</option>)}</NativeSelect>
              <label className="flex flex-wrap items-center gap-1 text-steel">Travel<input type="date" aria-label="Travel from" className="field-input min-h-8 w-36" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />–<input type="date" aria-label="Travel to" className="field-input min-h-8 w-36" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
              <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" className="size-4" checked={draft.flags === "urgent"} onChange={(e) => setDraft({ ...draft, flags: e.target.checked ? "urgent" : "" })} /> Urgent only</label>
              <Button size="sm" type="submit">Filter</Button>
              {activeFilters > 0 && <Button size="sm" variant="ghost" type="button" onClick={() => router.replace(`/queues?tab=${tab}`)}>Clear</Button>}
            </>
          )}
        </form>
        <div className="flex items-center gap-2 border-t border-rule/60 px-4 py-1.5" role="group" aria-label={t("q.views")}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            <Bookmark className="size-3.5 shrink-0 text-steel" aria-hidden />
            {views.map((v) => (
              <span key={v.name} className={cn("inline-flex shrink-0 items-center rounded-full border", v.query === currentQuery ? "border-orange bg-warning-subtle" : "border-rule-strong")}>
                <button type="button" onClick={() => router.replace(`/queues?${v.query}`)} aria-current={v.query === currentQuery ? "true" : undefined} className="min-h-8 rounded-s-full ps-3 pe-1.5 hover:bg-hover">{v.name}</button>
                <button type="button" aria-label={t("q.views.remove", { name: v.name })} onClick={() => writeViews(readViews().filter((x) => x.name !== v.name))} className="grid min-h-8 min-w-8 place-items-center rounded-e-full text-steel hover:bg-hover hover:text-ink"><X className="size-3.5" /></button>
              </span>
            ))}
            {!views.length && !saving && <span className="truncate text-[12px] text-steel">{t("q.views.none")}</span>}
          </div>
          {saving !== null ? (
            <form className="flex shrink-0 items-center gap-1" onSubmit={(e) => { e.preventDefault(); commitSave() }}>
              <input aria-label={t("q.views.name")} className="field-input min-h-8 w-32 sm:w-44" value={saving} onChange={(e) => setSaving(e.target.value)} autoFocus maxLength={40} dir="auto" />
              <Button size="sm" type="submit">{t("common.save")}</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setSaving(null)}>{t("common.cancel")}</Button>
            </form>
          ) : <Button size="sm" variant="outline" type="button" className="shrink-0" onClick={startSave}>{t("q.views.save")}</Button>}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto bg-surface md:bg-surface-raised">
          {list.error ? <TileError message={errText(list.error)} onRetry={() => void list.refetch()} /> : list.isLoading ? <ListSkeleton rows={8} /> : !rows.length ? (
            <EmptyState title={t("q.empty")} hint={t("q.empty.hint")} className="py-12" action={activeFilters > 0 ? <Button size="sm" variant="outline" onClick={() => router.replace(`/queues?tab=${tab}`)}>{t("q.empty.clear")}</Button> : undefined} />
          ) : (
            <>
              <table className="hidden w-full border-collapse md:table" data-testid="queue-table">
                <thead className="sticky top-0 z-10 bg-surface-raised text-start">
                  <tr className="border-b border-rule">{(isCargo ? ["Ref", "Customer", "Lane", "Service", "Ready", "Status", "SLA"] : ["Ref", "Customer", "Route", "Travel", "Pax", "Status", "SLA", "Assignee"]).map((h) => <th key={h} className="cap px-3 py-1.5 text-start font-normal">{h}</th>)}</tr>
                </thead>
                <tbody ref={tableRef}>
                  {rows.map((r, i) => (
                    <tr key={r.ref} data-idx={i} data-ref={r.ref} onClick={() => setFocus(i)} onDoubleClick={() => open(r)} className={cn("cursor-default border-b border-rule/70 hover:bg-hover/60", i === focus && "row-focus")} aria-selected={i === focus}>
                      <td className="px-3 py-1.5 whitespace-nowrap"><Link href={hrefOf(r)} className="num inline-block py-1 text-[12px] hover:underline">{r.ref}</Link>{r.flight?.urgent && <StatusChip tone="danger" className="ms-1.5">{t("q.urgent")}</StatusChip>}</td>
                      <td className="max-w-48 truncate px-3 py-1.5" dir="auto">{(r.flight ?? r.cargo)?.customer ?? "—"}</td>
                      {r.flight ? (
                        <>
                          <td className="max-w-56 truncate px-3 py-1.5">{r.flight.routeLabel}{r.flight.hasSnapshot && <span className="ms-1.5 font-mono text-[10px] text-success" title="Has an offer snapshot">SNAP</span>}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(r.flight.firstTravelDate)}</td>
                          <td className="num px-3 py-1.5">{r.flight.travellers}</td>
                          <td className="px-3 py-1.5"><StateChip value={r.flight.status} /></td>
                          <td className="px-3 py-1.5"><SlaChip dueAt={r.flight.slaDueAt} startAt={r.flight.submittedAt} breached={r.flight.slaBreached} /></td>
                          <td className="max-w-32 truncate px-3 py-1.5 text-steel">{r.flight.assignee ?? "—"}</td>
                        </>
                      ) : r.cargo ? (
                        <>
                          <td className="px-3 py-1.5">{r.cargo.lane}</td>
                          <td className="px-3 py-1.5 font-mono text-[11px]">{r.cargo.service}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(r.cargo.readyDate)}</td>
                          <td className="px-3 py-1.5"><StateChip value={r.cargo.status} /></td>
                          <td className="px-3 py-1.5"><SlaChip dueAt={r.cargo.slaDueAt} startAt={r.cargo.submittedAt} /></td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="space-y-2 p-3 md:hidden" data-testid="queue-cards" aria-label={t("q.cards")}>
                {rows.map((r) => {
                  const it = r.flight ?? r.cargo!
                  return (
                    <li key={r.ref}>
                      <Link href={hrefOf(r)} className="block min-h-11 rounded-xl border border-rule bg-surface-raised p-3 shadow-[var(--tile-shadow)] active:bg-hover">
                        <span className="flex items-center justify-between gap-2"><span className="num font-medium">{r.ref}</span><span className="flex items-center gap-1.5">{r.flight?.urgent && <StatusChip tone="danger">{t("q.urgent")}</StatusChip>}<StateChip value={it.status} /></span></span>
                        <span className="mt-1 block font-medium" dir="auto">{it.customer ?? "—"}</span>
                        <span className="block text-steel">{r.flight ? `${r.flight.routeLabel} · ${fmtDate(r.flight.firstTravelDate)}` : `${r.cargo!.lane} · ${r.cargo!.service}`}</span>
                        <span className="mt-2 flex items-center justify-between gap-2"><SlaChip dueAt={it.slaDueAt} startAt={it.submittedAt} breached={r.flight?.slaBreached} />{r.flight && <span className="truncate text-[12px] text-steel">{r.flight.assignee ?? "—"}</span>}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {list.hasNextPage && <div className="p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>}
            </>
          )}
        </div>
        {!isCargo && focused && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-s border-rule bg-surface-raised p-4 xl:block" aria-label="Preview" data-testid="queue-preview">
            {!preview.data ? <div className="space-y-3" aria-busy><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-56" /><Skeleton className="h-16" /></div> : (
              <div className="space-y-3">
                <div>
                  <p className="num">{preview.data.ref}</p>
                  <p className="font-display text-lg leading-snug">{preview.data.routeLabel}</p>
                  <p className="text-steel">{fmtDate(preview.data.firstTravelDate)} · {preview.data.travellers.length} traveller{preview.data.travellers.length === 1 ? "" : "s"} · {preview.data.kind.toLowerCase()} request</p>
                </div>
                <div className="flex flex-wrap items-center gap-2"><StateChip value={preview.data.status} />{preview.data.assignee && <span className="text-steel">→ {preview.data.assignee.name}</span>}</div>
                <dl className="ledger-rows">
                  <div className="flex justify-between py-1"><dt className="text-steel">Customer</dt><dd dir="auto">{preview.data.customer.nameLatin || preview.data.customer.displayName}{preview.data.customer.nameFa && <span className="ms-1 font-fa" dir="rtl">· {preview.data.customer.nameFa}</span>}</dd></div>
                  <div className="flex justify-between py-1"><dt className="text-steel">Phone</dt><dd className="num" dir="ltr">{preview.data.customer.phone}</dd></div>
                  <div className="flex justify-between py-1"><dt className="text-steel">Language</dt><dd>{preview.data.customer.preferredLocale === "fa" ? "Persian" : "English"}</dd></div>
                  <div className="flex items-center justify-between py-1"><dt className="text-steel">SLA</dt><dd><SlaChip dueAt={preview.data.sla.dueAt} startAt={preview.data.submittedAt} done={!!preview.data.sla.firstContactAt} /></dd></div>
                </dl>
                {preview.data.customerNote && <p className="rounded-sm border border-rule bg-surface-raised p-2" dir="auto">“{preview.data.customerNote}”</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => open(focused)}>Open case</Button>
                  {(() => { const a = preview.data.actions.find((x) => x.command === "claim"); return a ? <Button size="sm" variant="outline" disabled={!a.allowed} title={a.reason} onClick={() => void claim(focused.ref)}>Claim <span className="kbd ms-1">c</span></Button> : null })()}
                  <Button size="sm" variant="ghost" onClick={() => { setNote(""); setNoteFor(focused.ref) }}>Note <span className="kbd ms-1">n</span></Button>
                </div>
                {preview.data.notes[0] && <div><p className="cap">Last internal note</p><p className="mt-1" dir="auto">{preview.data.notes[0].body}</p><p className="text-[11px] text-steel">{preview.data.notes[0].author}</p></div>}
              </div>
            )}
          </aside>
        )}
      </div>
      <FormDialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)} title="Internal note" description={<>On <span className="num">{noteFor}</span>. Never visible to the customer.</>} submitLabel="Add note"
        onSubmit={async () => { const ref = noteFor!; await api(`/v1/admin/${ref.startsWith("UT-C-") ? "cargo/requests" : "flight-requests"}/${ref}/notes`, { body: { body: note } }); await qc.invalidateQueries({ queryKey: ["fr-detail", ref] }) }}>
        <textarea className="field-input min-h-28" value={note} onChange={(e) => setNote(e.target.value)} required autoFocus dir="auto" aria-label="Note" />
      </FormDialog>
    </div>
  )
}

export default function QueuesPage() {
  return <Suspense><QueuesInner /></Suspense>
}
