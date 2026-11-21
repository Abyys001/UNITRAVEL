"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { CARGO_OPS_TABS } from "@unitravel/contracts"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { formatTn, KIND_KEY, milestoneTone, ServerPager } from "@/components/cargo-ops"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { Kpi } from "@/components/kpi"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, human } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Row {
  ref: string; trackingNumber: string | null; status: string; milestone: string; milestoneLabel: string; service: string; lane: string; shipperName: string; consigneeName: string; destinationCity: string
  readyDate: string; submittedAt: string; updatedAt: string; agents: { kind: "COLLECTION" | "HANDLING" | "DELIVERY"; name: string; agentCode: string; offered?: boolean }[]; failedAttempts: number; pieces: number; weightKg: number
}
interface Page { items: Row[]; total: number; page: number; pageSize: number; pages: number }
interface Stats { total: number; pending: number; pendingCollections: number; active: number; delivered: number; failed: number; cancelled: number; tabs: Record<string, number> }
type Tab = (typeof CARGO_OPS_TABS)[number]

/** ADR-0042 / brief section 8: cargo overview with the operational buckets, search, sort and pages (server-side). */
export default function CargoOverview() {
  const t = useT()
  const { can } = useSession()
  const router = useRouter()
  const sp = useSearchParams()
  const tab = (CARGO_OPS_TABS as readonly string[]).includes(sp.get("tab") ?? "") ? (sp.get("tab") as Tab) : "all"
  const [search, setSearch] = useState(sp.get("q") ?? "")
  const [debounced, setDebounced] = useState(search)
  const [sort, setSort] = useState("submitted_desc")
  const [page, setPage] = useState(1)
  useEffect(() => { const h = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(h) }, [search])
  useEffect(() => setPage(1), [tab, debounced, sort])
  const stats = useQuery({ queryKey: ["cargo-ops-stats"], queryFn: () => api<Stats>("/v1/admin/cargo/ops/stats"), refetchInterval: 30_000 })
  const q = useQuery({
    queryKey: ["cargo-list", tab, debounced, sort, page], placeholderData: keepPreviousData, refetchInterval: 30_000,
    queryFn: () => api<Page>(`/v1/admin/cargo/ops/requests?tab=${tab}&sort=${sort}&page=${page}&pageSize=25${debounced ? `&q=${encodeURIComponent(debounced)}` : ""}`),
  })
  const setTab = (v: string) => router.replace(`/cargo${v && v !== "all" ? `?tab=${v}` : ""}`)
  const s = stats.data
  const tabLabel: Record<Tab, MsgKey> = { all: "ops.tab.all", pending: "ops.tab.pending", confirmed: "ops.tab.confirmed", assigned: "ops.tab.assigned", in_transit: "ops.tab.in_transit", delivered: "ops.tab.delivered", failed: "ops.tab.failed", cancelled: "ops.tab.cancelled" }
  const d = q.data
  const cols: MsgKey[] = ["ops.c.ref", "ops.c.tn", "ops.c.status", "ops.c.route", "ops.c.parties", "ops.c.pieces", "ops.c.agent", "ops.c.ready", "ops.c.updated"]
  return (
    <ListPage>
      <PageHead title={t("ops.overview")} kicker={t("nav.cargo")}>{can("cargo_request.create.any") && <Link href="/cargo/new" className="inline-flex h-8 items-center rounded-lg bg-navy-900 px-3 text-meta font-medium text-white" data-testid="new-cargo-link">{t("ops.newRequest")}</Link>}</PageHead>
      <div className="grid grid-cols-2 gap-3 px-4 pb-3 md:grid-cols-5 md:px-6" data-testid="cargo-kpis">
        <Kpi compact label={t("ops.kpi.total")} value={s?.total} href="/cargo" loading={!s} />
        <Kpi compact label={t("ops.kpi.pendingCollections")} value={s?.pendingCollections} href="/cargo?tab=confirmed" loading={!s} sub={s ? t("ops.kpi.pending", { n: s.pending }) : undefined} />
        <Kpi compact label={t("ops.kpi.active")} value={s?.active} href="/cargo?tab=in_transit" loading={!s} />
        <Kpi compact label={t("ops.kpi.delivered")} value={s?.delivered} href="/cargo?tab=delivered" loading={!s} subTone="ok" />
        <Kpi compact label={t("ops.kpi.failed")} value={s?.failed} href="/cargo?tab=failed" loading={!s} tone={s?.failed ? "danger" : undefined} />
      </div>
      <Toolbar query={search} onQuery={setSearch} placeholder={t("ops.search")} count={d?.total}
        trailing={<label className="flex items-center gap-2 text-meta text-steel">{t("ops.sort")}<NativeSelect className="field-input h-8 w-auto" value={sort} onChange={(e) => setSort(e.target.value)} data-testid="cargo-sort">
          <option value="submitted_desc">{t("ops.sort.newest")}</option><option value="submitted_asc">{t("ops.sort.oldest")}</option><option value="updated_desc">{t("ops.sort.updated")}</option><option value="ready_asc">{t("ops.sort.ready")}</option>
        </NativeSelect></label>}>
        <Chips label={t("ops.buckets")} value={tab} onChange={(v) => setTab(v || "all")} options={CARGO_OPS_TABS.map((k) => ({ value: k, label: t(tabLabel[k]), count: s?.tabs[k] }))} />
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !d ? <ListSkeleton rows={6} className="px-6" /> : !d.items.length ? <EmptyState title={t("ops.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="cargo-cards">
            {d.items.map((r) => (
              <li key={r.ref} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
                <p className="flex items-center justify-between gap-2"><Link href={`/cargo/${r.ref}`} className="ref font-semibold text-link">{r.ref}</Link><StatusChip tone={milestoneTone(r.milestone)}>{r.milestoneLabel}</StatusChip></p>
                {r.trackingNumber && <p className="ref mt-1 text-meta" dir="ltr">{formatTn(r.trackingNumber)}</p>}
                <p className="mt-1 text-meta" dir="auto">{r.shipperName} → {r.consigneeName}, {r.destinationCity}</p>
                <p className="mt-1 text-meta text-steel">{r.lane} · {human(r.service)} · {t("ops.c.piecesN", { n: r.pieces, kg: r.weightKg })}</p>
                {r.agents.length > 0 && <p className="mt-1 text-meta">{r.agents.map((x) => `${t(KIND_KEY[x.kind])}: ${x.name} (${x.agentCode})`).join(" · ")}</p>}
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll><table className={tableClass} data-testid="cargo-table">
              <thead><tr>{cols.map((h) => <th key={h}>{t(h)}</th>)}</tr></thead>
              <tbody>{d.items.map((r) => (
                <tr key={r.ref} className="cursor-pointer" onClick={() => router.push(`/cargo/${r.ref}`)}>
                  <td className="whitespace-nowrap"><Link href={`/cargo/${r.ref}`} className="ref font-semibold text-link hover:underline" onClick={(e) => e.stopPropagation()}>{r.ref}</Link></td>
                  <td className="ref whitespace-nowrap" dir="ltr">{r.trackingNumber ? formatTn(r.trackingNumber) : <span className="text-steel">—</span>}</td>
                  <td className="whitespace-nowrap"><StatusChip tone={milestoneTone(r.milestone)}>{r.milestoneLabel}</StatusChip>{r.failedAttempts > 0 && <span className="ms-1 text-caption text-danger">×{r.failedAttempts}</span>}<span className="block text-2xs text-steel">{human(r.status)}</span></td>
                  <td><span className="block">{r.lane}</span><span className="text-caption text-steel">{human(r.service)}</span></td>
                  <td dir="auto"><span className="block">{r.shipperName}</span><span className="text-caption text-steel">→ {r.consigneeName}, {r.destinationCity}</span></td>
                  <td className="num whitespace-nowrap">{t("ops.c.piecesN", { n: r.pieces, kg: r.weightKg })}</td>
                  <td className="text-meta">{r.agents.length ? r.agents.map((x) => <span key={`${x.kind}${x.agentCode}`} className="block whitespace-nowrap">{x.name} <span className="text-steel">({t(KIND_KEY[x.kind]).toLowerCase()}{x.offered ? `, ${t("agt.offered").toLowerCase()}` : ""})</span></span>) : <span className="text-steel">—</span>}</td>
                  <td className="num whitespace-nowrap">{fmtDate(r.readyDate)}</td>
                  <td className="num whitespace-nowrap text-steel">{fmtDateTime(r.updatedAt)}</td>
                </tr>))}</tbody>
            </table></TableScroll>
            <ServerPager page={d.page} pages={d.pages} total={d.total} size={d.pageSize} setPage={setPage} />
          </ListCard>
          <div className="md:hidden"><ServerPager page={d.page} pages={d.pages} total={d.total} size={d.pageSize} setPage={setPage} /></div>
        </>
      )}
    </ListPage>
  )
}
