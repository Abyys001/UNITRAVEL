"use client"

import type { AdminCatalogResult, CatalogCoverage, CatalogSettings, SlotStatus } from "@unitravel/contracts"
import { SLOT_STATUSES } from "@unitravel/contracts"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, Skeleton, StatusChip, TileError } from "@/components/bento"
import { useConfirm } from "@/components/confirm"
import { Section } from "@/components/dev-ui"
import { FormDialog } from "@/components/form-dialog"
import { RouteText } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, ltrIsolate, money } from "@/lib/format"
import { hasMsg, useT } from "@/lib/i18n"

import { CATALOG, KEYS, SLOT_CLASS, usd } from "./shared"

type CoverageSlot = CatalogCoverage["routes"][number]["slots"][number]
// The contracts export the SlotRefreshQuote schema but not its type.
interface SlotRefreshQuote { slotId: string; estimatedUsd: number; reserveLeftUsd: number; confirmToken: string }
interface Picked { id: string; label: string; date: string }

const dayNum = (iso: string) => iso.slice(8, 10)
const monthDay = (iso: string) => iso.slice(5, 10)

export const useCatalogCoverage = () =>
  useQuery({ queryKey: KEYS.coverage, queryFn: () => api<CatalogCoverage & { warnings?: string[] }>(`${CATALOG}/coverage`), refetchInterval: 60_000 })

function Legend() {
  const t = useT()
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("cat.cov.legend")}>
      {SLOT_STATUSES.map((s) => <li key={s} className={cn("rounded-full border px-2 py-0.5 text-caption font-medium", SLOT_CLASS[s])}>{t(`cat.st.${s}`)}</li>)}
    </ul>
  )
}

/** Per-route strip of dates coloured by slot status, the slots that are in back-off or error, and the picked slot's results (spec §7.2). */
export function CoverageSection({ settings, canManage, onAdd }: { settings: CatalogSettings | undefined; canManage: boolean; onAdd: (origin: string, destination: string) => void }) {
  const t = useT()
  const q = useCatalogCoverage()
  const [picked, setPicked] = useState<Picked | null>(null)
  const c = q.data
  const backoff = settings?.emptyBackoffAfter ?? 2
  const problems = (c?.routes ?? []).flatMap((r) => r.slots.filter((s) => s.status === "ERROR" || s.consecutiveErrors > 0 || s.consecutiveEmpty >= backoff).map((s) => ({ r: r.route, s })))
  return (
    <Section title={t("cat.cov.title")} hint={t("cat.cov.hint")} aside={<Legend />} data-testid="catalog-coverage">
      {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !c ? <Skeleton className="h-24" /> : (
        <div className="space-y-5">
          {c.warnings?.map((w, i) => <p key={i} role="status" className="rounded-md bg-warning-subtle px-2.5 py-1.5 text-meta text-warning-subtle-fg">{w}</p>)}
          {!c.routes.length && <EmptyState title={t("cat.cov.none")} hint={t("cat.cov.noneHint")} />}
          {c.routes.map(({ route, slots }) => {
            const via = route.kind === "COMBINED" ? (settings?.connections.hubs.filter((h) => h.enabled).map((h) => h.iata).join(" / ") || "—") : null
            return (
              <div key={route.id} data-testid={`cov-route-${route.origin}-${route.destination}`}>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="num font-semibold text-ink"><RouteText>{route.origin} → {route.destination}</RouteText></h3>
                  {via && <StatusChip tone="info">{t("cat.cov.combined", { hub: via })}</StatusChip>}
                  {!route.enabled && <StatusChip>{t("cat.cov.disabled")}</StatusChip>}
                  <span className="text-caption text-steel">{t("cat.cov.summary", { n: slots.reduce((a, s) => a + s.resultCount, 0), d: slots.length })}</span>
                </div>
                {!slots.length ? <p className="text-meta text-steel">{t("cat.cov.noSlots")}</p> : (
                  <ul className="flex flex-wrap gap-1.5">
                    {slots.map((s) => (
                      <li key={s.id}>
                        <button type="button" onClick={() => setPicked({ id: s.id, label: `${route.origin} → ${route.destination}`, date: s.date })} aria-pressed={picked?.id === s.id}
                          aria-label={t("cat.cov.slotLabel", { date: s.date, status: t(`cat.st.${s.status}`), n: s.resultCount })}
                          title={t("cat.cov.slotTitle", { fetched: fmtDateTime(s.lastFetchedAt), demand: s.demand.toFixed(1), tier: s.tier })}
                          className={cn("flex min-h-14 w-14 flex-col items-center justify-center rounded-md border px-1 py-1 text-center leading-tight focus-visible:outline-2 focus-visible:outline-offset-2 pointer-coarse:min-h-14", SLOT_CLASS[s.status], picked?.id === s.id && "ring-2 ring-royal")}>
                          <span className="num text-meta font-semibold">{dayNum(s.date)}</span>
                          <span className="text-2xs">{t(`cat.st.${s.status}`)}</span>
                          <span className="num text-2xs opacity-80">{s.resultCount}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {slots.length > 0 && <p className="mt-1 text-caption text-steel">{t("cat.cov.dates", { a: monthDay(slots[0]!.date), b: monthDay(slots[slots.length - 1]!.date) })}</p>}
              </div>
            )
          })}

          {problems.length > 0 && (
            <div data-testid="cov-problems">
              <h3 className="mb-1.5 font-semibold text-ink">{t("cat.cov.problems")}</h3>
              <ul className="divide-y divide-rule rounded-md border border-rule text-meta">
                {problems.map(({ r, s }) => (
                  <li key={s.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface-sunk" onClick={() => setPicked({ id: s.id, label: `${r.origin} → ${r.destination}`, date: s.date })}>
                    <span className="num"><RouteText>{r.origin} → {r.destination}</RouteText> · {s.date}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={s.status === "ERROR" || s.consecutiveErrors > 0 ? "danger" : "neutral"}>{s.consecutiveErrors > 0 ? t("cat.cov.errors", { n: s.consecutiveErrors }) : t("cat.cov.empties", { n: s.consecutiveEmpty })}</StatusChip>
                      {s.lastError && <span className="max-w-xs truncate text-caption text-danger" title={s.lastError}>{s.lastError}</span>}
                      <span className="num text-caption text-steel">{t("cat.cov.next", { t: fmtDateTime(s.nextDueAt) })}</span>
                    </span>
                  </button></li>
                ))}
              </ul>
            </div>
          )}

          {picked && <SlotPanel key={picked.id} picked={picked} slot={c.routes.flatMap((r) => r.slots).find((s) => s.id === picked.id)} canManage={canManage} onClose={() => setPicked(null)} />}

          <div data-testid="cov-untracked">
            <h3 className="mb-1.5 font-semibold text-ink">{t("cat.untracked")}</h3>
            {!c.untracked.length ? <p className="text-meta text-steel">{t("cat.untracked.none")}</p> : (
              <ul className="divide-y divide-rule rounded-md border border-rule text-meta">
                {c.untracked.map((u) => (
                  <li key={`${u.origin}-${u.destination}`} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="num"><RouteText>{u.origin} → {u.destination}</RouteText></span>
                    <span className="flex items-center gap-3"><span className="text-steel">{t("cat.untracked.demand", { n: u.demand.toFixed(1) })}</span>
                      {canManage && <Button size="xs" variant="outline" onClick={() => onAdd(u.origin, u.destination)}>{t("cat.untracked.add")}</Button>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}

const riskText = (t: ReturnType<typeof useT>, f: string) => (hasMsg(`cat.risk.${f}`) ? t(`cat.risk.${f}` as never) : f.replace(/_/g, " ").toLowerCase())

function SlotPanel({ picked, slot, canManage, onClose }: { picked: Picked; slot: CoverageSlot | undefined; canManage: boolean; onClose: () => void }) {
  const t = useT()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [quote, setQuote] = useState<SlotRefreshQuote | null>(null)
  const results = useQuery({ queryKey: [...KEYS.all, "results", picked.id], queryFn: () => api<{ results: AdminCatalogResult[] }>(`${CATALOG}/slots/${picked.id}/results`) })
  const getQuote = useMutation({ mutationFn: () => api<SlotRefreshQuote>(`${CATALOG}/slots/${picked.id}/refresh/quote`, { body: {} }), onSuccess: setQuote, onError: (e) => toast.error(errText(e)) })
  const done = () => qc.invalidateQueries({ queryKey: KEYS.all })
  const status: SlotStatus | undefined = slot?.status
  return (
    <div className="rounded-lg border border-rule-strong bg-surface p-3" data-testid="slot-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink"><RouteText>{picked.label}</RouteText> · <span className="num">{picked.date}</span> {status && <span className={cn("ms-1 rounded-full border px-2 py-0.5 text-caption font-medium", SLOT_CLASS[status])}>{t(`cat.st.${status}`)}</span>}</h3>
        <div className="flex gap-2">
          {canManage && <Button size="xs" variant="outline" loading={getQuote.isPending} onClick={() => getQuote.mutate()} data-testid="slot-refresh">{t("cat.slot.refresh")}</Button>}
          <Button size="xs" variant="ghost" onClick={onClose}>{t("cat.close")}</Button>
        </div>
      </div>
      {slot && <p className="mb-2 text-caption text-steel">{t("cat.slot.meta", { fetched: fmtDateTime(slot.lastFetchedAt), next: fmtDateTime(slot.nextDueAt), demand: slot.demand.toFixed(1) })}{slot.lastError ? ` · ${slot.lastError}` : ""}</p>}
      {results.error ? <TileError error={results.error} onRetry={() => void results.refetch()} /> : !results.data ? <Skeleton className="h-16" /> : !results.data.results.length ? <p className="text-meta text-steel">{t("cat.slot.none")}</p> : (
        <ul className="divide-y divide-rule" data-testid="slot-results">
          {results.data.results.map((r) => {
            const p = r.price
            const changed = p && p.previousAmountMinor != null && p.previousAmountMinor !== p.amountMinor
            return (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-2 text-meta">
                <div className="min-w-0 space-y-1">
                  <p className="num font-medium text-ink" dir="ltr">{r.departLocal.slice(11, 16)} → {r.arriveLocal.slice(11, 16)} · {r.carriers.join(", ")} {r.flightNumbers.join(" + ")}</p>
                  <p className="text-steel">{t("cat.res.shape", { stops: r.stops, h: Math.floor(r.durationMin / 60), m: r.durationMin % 60 })}{!r.isCurrent && ` · ${t("cat.res.notCurrent")}`}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.selfTransfer && <StatusChip tone="warn">{t("cat.res.selfTransfer")}</StatusChip>}
                    {r.complianceReview && <StatusChip tone="danger">{t("cat.res.review")}</StatusChip>}
                    {r.layovers.map((l, i) => <StatusChip key={i}>{t("cat.res.layover", { at: l.at, h: Math.floor(l.minutes / 60), m: l.minutes % 60 })}</StatusChip>)}
                    {r.riskFlags.map((f) => <StatusChip key={f} tone="warn">{riskText(t, f)}</StatusChip>)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p ? <p className="num text-body font-semibold text-ink" data-testid="result-price">{ltrIsolate(money({ amountMinor: p.amountMinor, currency: p.currency }))} <span className="text-caption font-normal text-steel">{t("cat.indicativeShort")}</span></p> : <p className="text-steel">—</p>}
                  {changed && p && <p className="num text-caption text-orange-700 dark:text-orange-300">{t("cat.res.was", { was: ltrIsolate(money({ amountMinor: p.previousAmountMinor!, currency: p.currency })), at: fmtDateTime(p.changedAt) })}</p>}
                  {canManage && <Button size="xs" variant="outline" data-testid="result-revalidate"
                    onClick={() => confirm.ask({ title: t("cat.res.revalidate.title"), description: t("cat.res.revalidate.desc"), label: t("cat.res.revalidate"), run: async () => { await api(`${CATALOG}/results/${r.id}/revalidate`, { body: {} }); await done() } })}>{t("cat.res.revalidate")}</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <FormDialog open={!!quote} onOpenChange={(o) => { if (!o) setQuote(null) }} title={t("cat.slot.confirm.title")} submitLabel={t("cat.slot.confirm")} testId="dlg-slot-refresh"
        description={quote && t("cat.slot.confirm.desc", { date: picked.date, route: picked.label, cost: usd(quote.estimatedUsd), left: usd(quote.reserveLeftUsd) })}
        onSubmit={async () => { if (!quote) return; await api(`${CATALOG}/slots/${picked.id}/refresh`, { body: { confirmToken: quote.confirmToken } }); await done() }}>
        {null}
      </FormDialog>
      {confirm.dialog}
    </div>
  )
}
