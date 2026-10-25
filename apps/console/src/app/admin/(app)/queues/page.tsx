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
import { Chips, ListCard, tableClass, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, human } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useFallbackInterval, useQueueSummary } from "@/lib/live"
import { useSession } from "@/lib/session"
import type { CargoListItem, FlightDetail, FlightListItem, Page, QueueSummary } from "@/lib/types"
import { readViews, useSavedViews, writeViews } from "@/lib/views"

const TABS: readonly { key: string; label: MsgKey; count?: (s: QueueSummary) => number }[] = [
  { key: "new", label: "nav.new", count: (s: QueueSummary) => s.new },
  { key: "mine", label: "nav.mine", count: (s: QueueSummary) => s.mine },
  { key: "awaiting", label: "nav.awaiting", count: (s: QueueSummary) => s.awaitingCustomer },
  { key: "quoted", label: "nav.quoted", count: (s: QueueSummary) => s.quoted },
  { key: "reserved", label: "nav.reserved", count: (s: QueueSummary) => s.reserved },
  { key: "cargo", label: "nav.cargo" },
  { key: "all", label: "nav.all" },
] 
const FLIGHT_STATUSES = ["SUBMITTED", "COMPLIANCE_HOLD", "NEW", "IN_REVIEW", "AWAITING_CUSTOMER", "QUOTED", "ACCEPTED", "RESERVED", "TICKETED", "COMPLETED", "DECLINED", "CANCELLED", "EXPIRED"]
const CARGO_TABS: { key: string; label: MsgKey }[] = [{ key: "open", label: "cargo.tab.open" }, { key: "new", label: "nav.new" }, { key: "hold", label: "cargo.tab.hold" }, { key: "all", label: "nav.all" }]

type Row = { ref: string; kind: "FLIGHT" | "CARGO"; flight?: FlightListItem; cargo?: CargoListItem }

const submittedOf = (r: Row) => Date.parse((r.flight ?? r.cargo)!.submittedAt)
/**
 * The API orders by SLA due time, so old breached requests would bury new ones. Keep SLA state as the first key
 * (breached, then running by due time, then none) and put the newest first among breached and none; "newest" ignores SLA state.
 */
function compareRows(newest: boolean) {
  const state = (r: Row) => { const sla = r.flight ? (r.flight.slaBreached ? 0 : r.flight.slaDueAt ? 1 : 2) : r.cargo!.slaDueAt ? (Date.parse(r.cargo!.slaDueAt) < Date.now() ? 0 : 1) : 2; return sla }
  const due = (r: Row) => Date.parse((r.flight ?? r.cargo)!.slaDueAt ?? "") || 0
  return (a: Row, b: Row) => {
    if (newest) return submittedOf(b) - submittedOf(a)
    const sa = state(a)
    return sa - state(b) || (sa === 1 ? due(a) - due(b) : 0) || submittedOf(b) - submittedOf(a)
  }
}

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
  const newest = params.get("sort") === "newest"
  const toggleSort = () => { const u = new URLSearchParams(params.toString()); if (newest) u.delete("sort"); else u.set("sort", "newest"); router.replace(`/queues?${u.toString()}`) }
  const summary = useQueueSummary()
  const listInterval = useFallbackInterval(20_000)

  const qs = (cursor?: string) => {
    const u = new URLSearchParams({ limit: "40" })
    if (isCargo) { if (filters.ctab && filters.ctab !== "all") u.set("tab", filters.ctab); if (filters.status) u.set("status", filters.status) } else {
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
  const rows: Row[] = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items.map((i) => (isCargo ? { ref: i.ref, kind: "CARGO" as const, cargo: i as CargoListItem } : { ref: i.ref, kind: "FLIGHT" as const, flight: i as FlightListItem }))).sort(compareRows(newest)), [list.data, isCargo, newest])

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
  useEffect(() => {
    if (JSON.stringify(draft) === JSON.stringify(filters)) return
    const h = setTimeout(() => apply({}), 400)
    return () => clearTimeout(h)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const currentQuery = params.toString() || `tab=${tab}`
  const startSave = () => setSaving(`${t(TABS.find((x) => x.key === tab)?.label ?? "nav.queues")}${filters.q ? ` · ${filters.q}` : ""}`)
  const commitSave = () => {
    const name = saving?.trim()
    setSaving(null)
    if (!name) return
    writeViews([...readViews().filter((v) => v.name !== name), { name, query: currentQuery }])
    toast.success(t("q.views.saved"))
  }

  const s = summary.data
  const hrefOf = (r: Row) => (r.kind === "CARGO" ? `/cargo/${r.ref}` : `/requests/${r.ref}`)
  const activeView = views.find((v) => v.query === currentQuery)
  const th = (keys: MsgKey[]) => keys.map((k) => <th key={k}>{t(k)}</th>)
  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col md:h-[calc(100dvh-3.5rem)]">
      <PageHead title={t("nav.requests")}>
        <Button size="sm" variant="outline" type="button" aria-pressed={newest} onClick={toggleSort} data-testid="sort-newest" className={cn(newest && "bg-hover")}>{t("q.sortNewest")}</Button>
        <p className="hidden text-[11.5px] text-steel xl:block pointer-coarse:hidden"><span className="kbd">j</span>/<span className="kbd">k</span> {t("q.keys")} · <span className="kbd">Enter</span> open · <span className="kbd">c</span> claim · <span className="kbd">n</span> note</p>
      </PageHead>
      <nav className="flex gap-1 overflow-x-auto border-b border-rule bg-surface-raised px-4 md:px-6" aria-label={t("q.tabs")}>
        {TABS.filter((x) => (x.key === "cargo" ? can("cargo_request.read.any") : can("flight_request.read.any"))).map((x) => (
          <Link key={x.key} href={`/queues?tab=${x.key}`} aria-current={tab === x.key ? "page" : undefined} className={cn("-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-2.5 whitespace-nowrap pointer-coarse:min-h-11", tab === x.key ? "border-orange font-medium text-ink" : "border-transparent text-steel hover:text-ink")}>
            {t(x.label)}{x.count && s ? <span data-testid="nav-count" className="num rounded-full bg-hover px-1.5 text-[11px] text-ink">{x.count(s)}</span> : null}
          </Link>
        ))}
      </nav>
      <form className="z-10 border-b border-rule" data-testid="queue-filters" onSubmit={(e) => { e.preventDefault(); apply({}) }}>
        <Toolbar query={isCargo ? undefined : draft.q} onQuery={isCargo ? undefined : (q) => setDraft({ ...draft, q })} placeholder={t("pg.q.search")} count={rows.length}>
          {isCargo ? (
            <Chips label={t("cargo.tab.open")} value={filters.ctab} options={CARGO_TABS.map((c) => ({ value: c.key, label: t(c.label) }))} onChange={(v) => apply({ ctab: v })} />
          ) : (
            <>
              <Button size="sm" variant="outline" type="button" className="md:hidden" aria-expanded={filtersOpen} aria-controls="queue-filter-extra" onClick={() => setFiltersOpen((o) => !o)}><SlidersHorizontal /> {t("q.filters")}{activeFilters > 0 && <StatusChip tone="info" className="ms-1">{t("q.filters.active", { n: activeFilters })}</StatusChip>}</Button>
              <div id="queue-filter-extra" className={cn("w-full flex-wrap items-center gap-2 md:flex md:w-auto", filtersOpen ? "flex" : "hidden")}>
                <NativeSelect aria-label={t("pg.c.status")} className="field-input w-full sm:w-44" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">{t("pg.q.anyStatus")}</option>{FLIGHT_STATUSES.map((x) => <option key={x} value={x}>{human(x)}</option>)}</NativeSelect>
                <label className="flex items-center gap-1.5 text-[12px] text-steel">{t("pg.q.from")}<input type="date" className="field-input w-36" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
                <label className="flex items-center gap-1.5 text-[12px] text-steel">{t("pg.q.to")}<input type="date" className="field-input w-36" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
                <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" className="size-4" checked={draft.flags === "urgent"} onChange={(e) => setDraft({ ...draft, flags: e.target.checked ? "urgent" : "" })} /> {t("pg.q.urgentOnly")}</label>
                {activeFilters > 0 && <Button size="sm" variant="ghost" type="button" onClick={() => router.replace(`/queues?tab=${tab}`)}>{t("pg.q.clear")}</Button>}
              </div>
            </>
          )}
          <div className="flex items-center gap-1.5 md:ms-auto" role="group" aria-label={t("q.views")}>
            {saving !== null ? (
              <>
                <input aria-label={t("q.views.name")} className="field-input w-36 sm:w-44" value={saving} onChange={(e) => setSaving(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); commitSave() } }} autoFocus maxLength={40} dir="auto" />
                <Button size="sm" type="button" onClick={commitSave}>{t("common.save")}</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setSaving(null)}>{t("common.cancel")}</Button>
              </>
            ) : (
              <>
                {views.length > 0 && <NativeSelect aria-label={t("q.views")} className="field-input w-40" value={activeView?.name ?? ""} onChange={(e) => { const v = views.find((x) => x.name === e.target.value); if (v) router.replace(`/queues?${v.query}`) }}><option value="">{t("q.views")}</option>{views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</NativeSelect>}
                {activeView && <Button size="icon-sm" variant="ghost" type="button" aria-label={t("q.views.remove", { name: activeView.name })} onClick={() => writeViews(readViews().filter((x) => x.name !== activeView.name))}><X /></Button>}
                <Button size="sm" variant="outline" type="button" onClick={startSave}><Bookmark /> {t("q.views.save")}</Button>
              </>
            )}
          </div>
        </Toolbar>
      </form>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto bg-surface pt-3">
          {list.error ? <TileError error={list.error} onRetry={() => void list.refetch()} /> : list.isLoading ? <ListSkeleton rows={8} /> : !rows.length ? (
            <EmptyState title={t("q.empty")} hint={t("q.empty.hint")} className="py-12" action={activeFilters > 0 ? <Button size="sm" variant="outline" onClick={() => router.replace(`/queues?tab=${tab}`)}>{t("q.empty.clear")}</Button> : undefined} />
          ) : (
            <>
              <ListCard className="hidden overflow-clip xl:block">
                <table className={cn(tableClass, "[&_th]:sticky [&_th]:top-0 [&_th]:z-10")} data-testid="queue-table">
                  <thead><tr>{th(isCargo ? ["pg.c.ref", "pg.c.customer", "pg.c.lane", "pg.c.service", "pg.c.ready", "pg.c.status", "pg.c.sla"] : ["pg.c.ref", "pg.c.customer", "pg.c.route", "q.travel", "pg.c.pax", "pg.c.status", "pg.c.sla", "pg.c.assignee"])}</tr></thead>
                  <tbody ref={tableRef}>
                    {rows.map((r, i) => (
                      <tr key={r.ref} data-idx={i} data-ref={r.ref} onClick={() => setFocus(i)} onDoubleClick={() => open(r)} className={cn("cursor-default", i === focus && "row-focus")} aria-selected={i === focus}>
                        <td className="whitespace-nowrap"><Link href={hrefOf(r)} className="num inline-block py-1 text-[12.5px] hover:underline">{r.ref}</Link>{r.flight?.urgent && <StatusChip tone="danger" className="ms-1.5">{t("q.urgent")}</StatusChip>}</td>
                        <td className="max-w-48 truncate" dir="auto">{(r.flight ?? r.cargo)?.customer ?? "—"}</td>
                        {r.flight ? (
                          <>
                            <td className="max-w-56 truncate">{r.flight.routeLabel}{r.flight.hasSnapshot && <span className="ms-1.5 text-[11.5px] font-medium text-success" title={t("pg.q.snapshot")}>{t("pg.q.snap")}</span>}</td>
                            <td className="whitespace-nowrap">{fmtDate(r.flight.firstTravelDate)}</td>
                            <td className="num">{r.flight.travellers}</td>
                            <td><StateChip value={r.flight.status} /></td>
                            <td><SlaChip dueAt={r.flight.slaDueAt} startAt={r.flight.submittedAt} breached={r.flight.slaBreached} /></td>
                            <td className="max-w-32 truncate text-steel">{r.flight.assignee ?? "—"}</td>
                          </>
                        ) : r.cargo ? (
                          <>
                            <td>{r.cargo.lane}</td>
                            <td className="num text-[12px]">{r.cargo.service}</td>
                            <td className="whitespace-nowrap">{fmtDate(r.cargo.readyDate)}</td>
                            <td><StateChip value={r.cargo.status} /></td>
                            <td><SlaChip dueAt={r.cargo.slaDueAt} startAt={r.cargo.submittedAt} /></td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ListCard>
              <ul className="space-y-2 px-3 xl:hidden" data-testid="queue-cards" aria-label={t("q.cards")}>
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
              {list.hasNextPage && <div className="flex justify-center p-4"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>}
            </>
          )}
        </div>
        {!isCargo && focused && (
          <aside className="hidden w-[360px] shrink-0 overflow-y-auto border-s border-rule bg-surface-raised p-4 2xl:block" aria-label="Preview" data-testid="queue-preview">
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
                  {(() => { const a = preview.data.actions.find((x) => x.command === "claim"); return a ? <Button size="sm" variant="outline" disabled={!a.allowed} title={a.reason} onClick={() => void claim(focused.ref)}>Claim <span className="kbd ms-1 max-md:hidden pointer-coarse:hidden">c</span></Button> : null })()}
                  <Button size="sm" variant="ghost" onClick={() => { setNote(""); setNoteFor(focused.ref) }}>Note <span className="kbd ms-1 max-md:hidden pointer-coarse:hidden">n</span></Button>
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
