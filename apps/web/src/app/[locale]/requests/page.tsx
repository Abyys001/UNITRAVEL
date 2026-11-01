"use client"

import { useQuery } from "@tanstack/react-query"
import { Bell, ConciergeBell, Hourglass, Layers, Package, Plane, Ticket } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import type { ServiceRequestSummary } from "@unitravel/contracts"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"

import { Ltr, RouteLabel } from "@/components/badges"
import { PanelShell, Stat } from "@/components/customer-panel"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { cacheGet, cacheSet, useRequireSignIn } from "@/lib/use-auth-redirect"

interface Item { ref: string; productType: "FLIGHT" | "CARGO"; status: string; statusLabel: string; routeLabel: string; firstDate: string | null; submittedAt: string; unread: number }

const DONE = new Set(["COMPLETED", "CANCELLED", "CLOSED_NO_RESPONSE", "DECLINED", "CLOSED", "TICKETED", "DELIVERED"])
type Row = { key: string; kind: "FLIGHT" | "CARGO" | "SERVICE"; to: string; title: React.ReactNode; ref: string; when: string | null; status: string; unread: number; open: boolean }
type Filter = "ALL" | "FLIGHT" | "SERVICE" | "CARGO" | "OPEN"

export default function RequestsPage() {
  const { t, href, date, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["requests"], queryFn: async () => { const r = await api<Item[]>("/v1/requests"); cacheSet("requests", r); return r }, enabled: !!me, refetchInterval: 30_000 })
  const cached = !q.data && q.isError ? cacheGet<Item[]>("requests") : null
  const items = q.data ?? cached?.data ?? []
  // Service requests (ADR-0015) live in their own list; it is empty until a service flag is switched on and used.
  const services = useQuery({ queryKey: ["service-requests"], queryFn: () => api<ServiceRequestSummary[]>("/v1/service-requests"), enabled: !!me, refetchInterval: 30_000 })
  const rows: Row[] = [
    ...items.map((r): Row => ({ key: r.ref, kind: r.productType, to: r.productType === "FLIGHT" ? `/requests/${r.ref}` : `/cargo/${r.ref}`, title: <RouteLabel label={r.routeLabel} />, ref: r.ref, when: r.firstDate, status: r.statusLabel, unread: r.unread, open: !DONE.has(r.status) })),
    ...(services.data ?? []).map((r): Row => ({ key: r.ref, kind: "SERVICE", to: `/services/${r.ref}`, title: t(`services.types.${r.type}`), ref: r.ref, when: r.createdAt, status: t(`services.status.${r.status}`), unread: 0, open: !DONE.has(r.status) })),
  ]
  const [filter, setFilter] = useState<Filter>("ALL")
  const shown = rows.filter((r) => filter === "ALL" || (filter === "OPEN" ? r.open : r.kind === filter))
  const stats = { all: rows.length, open: rows.filter((r) => r.open).length, unread: rows.reduce((n, r) => n + r.unread, 0) }
  const filters: [Filter, string][] = [["ALL", t("panel.all")], ["OPEN", t("panel.open")], ["FLIGHT", t("requests.flight")], ["SERVICE", t("services.listTitle")], ["CARGO", t("requests.cargo")]]
  const Icon = { FLIGHT: Plane, CARGO: Package, SERVICE: ConciergeBell }
  return (
    <PanelShell title={t("requests.title")} lead={t("panel.lead")}>
      {cached && <p className="mt-4 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning-subtle-fg">{t("requests.offline")} {t("requests.lastUpdated", { time: date(cached.at, { withTime: true }) })}</p>}
      <div className="mt-6 grid grid-cols-3 gap-3" data-testid="panel-stats">
        <Stat label={t("panel.all")} value={stats.all} icon={<Layers className="size-4" />} />
        <Stat label={t("panel.open")} value={stats.open} tone="royal" icon={<Hourglass className="size-4" />} />
        <Stat label={t("panel.unread")} value={stats.unread} tone="orange" icon={<Bell className="size-4" />} />
      </div>
      <div role="group" aria-label={t("panel.filter")} className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {filters.map(([k, label]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ring-1 transition-colors pointer-coarse:min-h-11 ${filter === k ? "bg-orange text-navy-950 ring-orange" : "bg-white/70 text-navy-900 ring-line hover:bg-cloud"}`}>{label}</button>)}
      </div>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {!q.isLoading && !shown.length && <EmptyState className="mt-6" icon={<Ticket />} title={t("requests.empty")} />}
      <ul className="mt-5 grid gap-3 lg:grid-cols-2" data-testid="request-list">
        {shown.map((r) => {
          const I = Icon[r.kind]
          return (
            <li key={r.key} data-testid={r.kind === "SERVICE" ? "service-requests" : undefined}>
              <Link href={href(r.to)} className="card-brand group relative flex h-full items-start gap-4 p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-orange">
                <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${r.open ? "bg-navy-950 text-white" : "bg-cloud text-steel"}`}><I className={`size-5 ${r.kind === "FLIGHT" ? "rotate-45 rtl:-rotate-45 rtl:-scale-x-100" : ""}`} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg">{r.title}</span>
                  <span className="mt-0.5 block text-xs text-steel"><Ltr className="font-mono">{r.ref}</Ltr>{r.when ? <>{sep}{date(r.when, { dateOnly: true })}</> : null}</span>
                  <span className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${r.open ? "bg-royal/10 text-royal" : "bg-cloud text-steel"}`}>{r.status}</span>
                    {r.unread > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-orange px-2.5 py-1 text-xs font-bold text-navy-950"><Bell className="size-3" aria-hidden />{r.unread}</span>}
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </PanelShell>
  )
}
