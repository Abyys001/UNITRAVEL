"use client"

import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { Skeleton, StatusChip, TileError } from "@/components/bento"
import { useConfirm } from "@/components/confirm"
import { DataTable, Section } from "@/components/dev-ui"
import { amount, DeadlineWarning, FareStatusBadge, FB, FB_KEYS, flightsOf, FreshnessBadge, hasPrice, routeOf, SeatsCell, useFbOptions } from "@/components/flight-builder/shared"
import { QuotaBanner } from "@/components/flight-builder/usage"
import { Arrow, Empty, PageHead, RouteText } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Captured Flight Builder options (ADR-0037): staff-recorded fares only; nothing here was fetched from the panel. */
export default function FlightBuilderOptionsPage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const [status, setStatus] = useState("")
  const q = useFbOptions(status)
  const confirm = useConfirm()
  const capture = can("catalog.capture")
  const rows = (q.data ?? []).flatMap((o) => o.fares.map((f) => ({ o, f })))
  return (
    <div>
      <PageHead kicker={<Link href="/catalog" className="hover:underline"><Arrow back /> {t("cat.title")}</Link>} title={t("fb.title")}>
        <span className="text-meta text-steel">{t("fb.desc")}</span>
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href="/catalog/flight-builder/usage" />}>{t("fb.usage.open")}</Button>
        {capture && <Button size="sm" nativeButton={false} render={<Link href="/catalog/flight-builder/new" />} data-testid="fb-new">{t("fb.new")}</Button>}
      </PageHead>
      <div className="space-y-4 px-4 pb-8 md:px-6" data-testid="fb-page">
        <QuotaBanner />
        <Section title={t("fb.list.title")} flush aside={
          <label className="flex items-center gap-2 text-meta"><span className="text-steel">{t("fb.filter.status")}</span>
            <NativeSelect className="field-input h-8 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("fb.filter.all")}</option>
              {(["LIVE", "STALE", "EXPIRED", "RETIRED"] as const).map((s) => <option key={s} value={s}>{t(`fb.status.${s}` as MsgKey)}</option>)}
            </NativeSelect>
          </label>}>
          {q.isError ? <div className="p-4"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <div className="space-y-2 p-4"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div> : !rows.length ? (
            <div className="p-4"><Empty>{t("fb.list.empty")}</Empty>{capture && <p className="text-center"><Link href="/catalog/flight-builder/new" className="font-medium text-link hover:underline">{t("fb.new")}</Link></p>}</div>
          ) : (
            <DataTable data-testid="fb-table">
              <thead><tr>
                <th scope="col">{t("fb.col.route")}</th><th scope="col">{t("fb.col.flights")}</th><th scope="col">{t("fb.col.class")}</th><th scope="col">{t("fb.col.seats")}</th>
                <th scope="col">{t("fb.col.deadline")}</th><th scope="col">{t("fb.col.fresh")}</th><th scope="col">{t("fb.col.status")}</th>
                {rows.some((r) => hasPrice(r.f)) && <th scope="col" className="text-end">{t("fb.col.supplier")}</th>}
                {capture && <th scope="col"><span className="sr-only">{t("fb.col.actions")}</span></th>}
              </tr></thead>
              <tbody>
                {rows.map(({ o, f }) => (
                  <tr key={f.id} data-testid="fb-row">
                    <td><RouteText className="num font-semibold">{routeOf(o)}</RouteText><div className="text-caption text-steel num">{fmtDateTime(o.segments[0]?.departLocal)}</div></td>
                    <td><RouteText className="num">{flightsOf(o)}</RouteText></td>
                    <td><span className="num" dir="ltr">{f.cabin} · {f.bookingClasses.join("/")}</span></td>
                    <td><SeatsCell seats={f.seats} /></td>
                    <td><DeadlineWarning deadline={f.ticketingDeadline} warn={f.deadlineWarning} /></td>
                    <td><FreshnessBadge value={f.freshness} /><div className="mt-0.5 text-caption text-steel">{fmtDateTime(f.observedAt)}</div></td>
                    <td><FareStatusBadge value={f.status} />{o.capture === "STAFF" && o.requestRef && <Link href={`/requests/${o.requestRef}`} className="mt-0.5 block ref text-caption text-link hover:underline">{o.requestRef}</Link>}</td>
                    {rows.some((r) => hasPrice(r.f)) && <td className="num text-end" dir="ltr">{hasPrice(f) ? amount(f.totalMinor, f.currency) : "—"}</td>}
                    {capture && <td className="text-end">{f.status !== "RETIRED" && <Button size="xs" variant="ghost" className="text-danger" data-testid="fb-retire"
                      onClick={() => confirm.ask({ title: t("fb.retire.title"), description: t("fb.retire.desc", { route: routeOf(o), flights: flightsOf(o) }), label: t("fb.retire"), destructive: true, run: async () => { await api(`${FB}/options/${o.resultId}/retire`, { body: {} }); await qc.invalidateQueries({ queryKey: FB_KEYS.all }) } })}>{t("fb.retire")}</Button>}</td>}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
        <p className="text-caption text-steel"><StatusChip tone="neutral">{t("fb.staffOnly")}</StatusChip> {t("fb.list.note")}</p>
      </div>
      {confirm.dialog}
    </div>
  )
}
