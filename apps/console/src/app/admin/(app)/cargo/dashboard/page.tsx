"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Input } from "@unitravel/ui/components/input"

import { TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { Kpi } from "@/components/kpi"
import { Empty, PageHead, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { human, money } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"

type Dash = {
  from: string; to: string
  counts: { total: number; awaitingDispatch: number; inTransit: number; delivered: number; delayed: number; customsIssues: number; customsAwaitingApproval: number; failedDeliveries: number; returned: number; exceptions: number }
  money: { currency: string; revenueMinor: number; costMinor: number; profitMinor: number }[]
  series: { date: string; created: number; dispatched: number; delivered: number }[]
  couriers: { name: string; consignments: number }[]
  openConsignments: { ref: string; shipmentNo: string; courier: string; serviceLevel: string; shipDate: string | null; direction: string }[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** One series per chart (small multiples): one hue, no legend needed, a tooltip per bar, a table view below. */
function DayBars({ title, data, k }: { title: string; data: Dash["series"]; k: "created" | "dispatched" | "delivered" }) {
  const max = Math.max(1, ...data.map((d) => d[k]))
  const W = 300, H = 72, gap = 2
  const bw = Math.max(2, (W - gap * (data.length - 1)) / data.length)
  const total = data.reduce((n, d) => n + d[k], 0)
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 flex items-baseline justify-between text-meta"><span className="font-medium">{title}</span><span className="num text-steel">{total}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 1}`} className="h-20 w-full text-navy-700 dark:text-sky-300" role="img" aria-label={`${title}: ${total}`} preserveAspectRatio="none">
        <line x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} className="stroke-rule" strokeWidth="1" />
        {data.map((d, i) => {
          const h = d[k] ? Math.max(2, (d[k] / max) * (H - 4)) : 0
          const x = i * (bw + gap)
          return (
            <g key={d.date}>
              {/* Hit target taller than the bar, so small values are still easy to hover. */}
              <rect x={x} y={0} width={bw} height={H} fill="transparent"><title>{`${d.date}: ${d[k]}`}</title></rect>
              {h > 0 && <path d={`M${x},${H} v${-(h - Math.min(4, h / 2, bw / 2))} q0,${-Math.min(4, h / 2, bw / 2)} ${Math.min(4, h / 2, bw / 2)},${-Math.min(4, h / 2, bw / 2)} h${bw - 2 * Math.min(4, h / 2, bw / 2)} q${Math.min(4, h / 2, bw / 2)},0 ${Math.min(4, h / 2, bw / 2)},${Math.min(4, h / 2, bw / 2)} v${h - Math.min(4, h / 2, bw / 2)} z`} fill="currentColor" pointerEvents="none" />}
            </g>
          )
        })}
      </svg>
      <div className="mt-0.5 flex justify-between text-caption text-steel num"><span>{data[0]?.date.slice(5)}</span><span>{data.at(-1)?.date.slice(5)}</span></div>
    </figure>
  )
}

/** ADR-0047 D5: shipping dashboard for a date range (staff-only money figures). */
export default function ShippingDashboard() {
  const t = useT()
  const [to, setTo] = useState(() => iso(new Date()))
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 86_400_000)))
  const q = useQuery({ queryKey: ["cargo-dash", from, to], queryFn: () => api<Dash>(`/v1/admin/cargo/dashboard?from=${from}&to=${to}`), refetchInterval: 60_000 })
  const d = q.data
  const tiles: [MsgKey, number, string | null, "danger" | undefined][] = d ? [
    ["dash.total", d.counts.total, "/cargo", undefined], ["dash.awaiting", d.counts.awaitingDispatch, null, undefined], ["dash.transit", d.counts.inTransit, null, undefined], ["dash.delivered", d.counts.delivered, null, undefined],
    ["dash.delayed", d.counts.delayed, null, d.counts.delayed ? "danger" : undefined], ["dash.customs", d.counts.customsIssues, null, d.counts.customsIssues ? "danger" : undefined], ["dash.customsApproval", d.counts.customsAwaitingApproval, null, undefined],
    ["dash.failed", d.counts.failedDeliveries, null, d.counts.failedDeliveries ? "danger" : undefined], ["dash.returned", d.counts.returned, null, undefined], ["dash.exceptions", d.counts.exceptions, null, d.counts.exceptions ? "danger" : undefined],
  ] : []
  return (
    <div className="px-4 pb-10 md:px-6">
      <PageHead title={t("dash.title")} />
      {/* Filters in one row above everything they control. */}
      <div className="mb-4 flex flex-wrap items-end gap-3" data-testid="dash-range">
        <label className="grid gap-1 text-meta font-medium">{t("dash.from")}<Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-44" /></label>
        <label className="grid gap-1 text-meta font-medium">{t("dash.to")}<Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-44" /></label>
        {[7, 30, 90].map((n) => <button key={n} type="button" className="h-10 rounded-lg border border-rule-strong px-3 text-meta font-medium hover:bg-hover" onClick={() => { setTo(iso(new Date())); setFrom(iso(new Date(Date.now() - (n - 1) * 86_400_000))) }}>{n}d</button>)}
      </div>
      {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !d ? <ListSkeleton rows={4} /> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="dash-kpis">
            {tiles.map(([k, v, href, tone]) => <Kpi key={k} compact loading={false} label={t(k)} value={v} href={href} tone={tone} />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title={t("dash.money")}>
              {!d.money.length ? <Empty>{t("dash.noMoney")}</Empty> : (
                <table className="w-full text-meta" data-testid="dash-money">
                  <thead><tr className="text-start text-steel"><th className="py-1 text-start font-medium" /><th className="py-1 text-end font-medium">{t("dash.revenue")}</th><th className="py-1 text-end font-medium">{t("dash.cost")}</th><th className="py-1 text-end font-medium">{t("dash.profit")}</th></tr></thead>
                  <tbody>{d.money.map((m) => <tr key={m.currency} className="border-t border-rule"><td className="py-1.5 font-medium">{m.currency}</td><td className="num py-1.5 text-end">{money({ amountMinor: m.revenueMinor, currency: m.currency })}</td><td className="num py-1.5 text-end">{money({ amountMinor: m.costMinor, currency: m.currency })}</td><td className={`num py-1.5 text-end font-semibold ${m.profitMinor < 0 ? "text-danger" : ""}`}>{money({ amountMinor: m.profitMinor, currency: m.currency })}</td></tr>)}</tbody>
                </table>
              )}
            </Panel>
            <Panel title={t("dash.daily")}>
              <div className="grid gap-4 sm:grid-cols-3" data-testid="dash-chart">
                <DayBars title={t("dash.created")} data={d.series} k="created" />
                <DayBars title={t("dash.dispatchedS")} data={d.series} k="dispatched" />
                <DayBars title={t("dash.deliveredS")} data={d.series} k="delivered" />
              </div>
              <details className="mt-3 text-meta">
                <summary className="cursor-pointer text-steel">Table</summary>
                <table className="mt-2 w-full num"><thead><tr className="text-steel"><th className="text-start font-medium">Date</th><th className="text-end font-medium">{t("dash.created")}</th><th className="text-end font-medium">{t("dash.dispatchedS")}</th><th className="text-end font-medium">{t("dash.deliveredS")}</th></tr></thead>
                  <tbody>{d.series.filter((x) => x.created || x.dispatched || x.delivered).map((x) => <tr key={x.date} className="border-t border-rule"><td>{x.date}</td><td className="text-end">{x.created}</td><td className="text-end">{x.dispatched}</td><td className="text-end">{x.delivered}</td></tr>)}</tbody></table>
              </details>
            </Panel>
            <Panel title={t("dash.couriers")}>
              {!d.couriers.length ? <Empty>{t("dash.none")}</Empty> : <ul className="ledger-rows">{d.couriers.map((c) => <li key={c.name} className="flex justify-between py-1"><span>{c.name}</span><span className="num">{c.consignments}</span></li>)}</ul>}
            </Panel>
            <Panel title={t("dash.open")}>
              {!d.openConsignments.length ? <Empty>{t("dash.none")}</Empty> : <ul className="ledger-rows" data-testid="dash-open">{d.openConsignments.map((c) => <li key={c.shipmentNo} className="flex flex-wrap justify-between gap-2 py-1"><Link href={`/cargo/${c.ref}`} className="font-medium text-link hover:underline"><span className="ref">{c.shipmentNo}</span> · {c.ref}</Link><span className="text-steel">{c.courier} · {human(c.serviceLevel)}{c.shipDate ? ` · ${c.shipDate}` : ""}</span></li>)}</ul>}
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
