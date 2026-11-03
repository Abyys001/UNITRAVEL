"use client"

import type { RecheckStart, RecheckStatus } from "@unitravel/contracts"
import { useMutation, useQuery } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { Arrow } from "@/components/ui"
import { api, ApiError, errText } from "@/lib/api"
import { fmtDateTime, ltrIsolate, money } from "@/lib/format"
import { type T, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { FlightDetail, SnapshotSource } from "@/lib/types"

export const APIFY = "apify-google-flights"
type Snapshot = NonNullable<FlightDetail["snapshot"]>

/** Only an absolute https link is rendered: the URL comes from a third-party listing (ADR-0029). */
const safeHttps = (u: string | null | undefined) => { try { return u && new URL(u).protocol === "https:" ? u : null } catch { return null } }

/** "Source: Apify / Google Flights, fetched …" (ADR-0032 B7); price, price level and the Google link for `pricing.read.internal` only (ADR-0029 A5). */
export function SourceBadge({ sources }: { sources: SnapshotSource[] }) {
  const t = useT()
  const { can } = useSession()
  const internal = can("pricing.read.internal")
  const apify = sources.filter((s) => s.provider === APIFY)
  if (!apify.length) return null
  return (
    <ul className="mt-2 space-y-1.5" data-testid="source-badge">
      {apify.map((s, i) => {
        const href = internal ? safeHttps(s.googleFlightsUrl) : null
        return (
          <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
            <StatusChip tone="info">{t("apify.source", { t: fmtDateTime(s.fetchedAt) })}{apify.length > 1 && ` · ${t("apify.ticket", { n: i + 1 })}`}</StatusChip>
            {internal && s.price && <span data-testid="source-price">{t("apify.source.price")} <b className="num text-ink">{ltrIsolate(money(s.price))}</b></span>}
            {internal && s.priceLevel && <span data-testid="source-level">{t("apify.source.level")} <b className="text-ink" dir="ltr">{s.priceLevel}</b></span>}
            {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-link hover:underline" data-testid="source-link">{t("apify.source.link")}<ExternalLink aria-hidden className="size-3.5" /></a>}
          </li>
        )
      })}
    </ul>
  )
}

const recheckError = (t: T, e: unknown) => {
  if (e instanceof ApiError && e.code === "RATE_LIMITED") return t("apify.rv.budget")
  if (e instanceof ApiError && e.code === "VERSION_CONFLICT") return t("apify.rv.busy")
  return t("apify.rv.failed", { why: errText(e) })
}

/** "Revalidate now" (ADR-0029 A7): one staff-pool run, polled until the worker answers. */
export function RevalidateNow({ itineraryId }: { itineraryId: string }) {
  const t = useT()
  const [jobId, setJobId] = useState<string | null>(null)
  const base = `/v1/admin/itineraries/${encodeURIComponent(itineraryId)}/recheck`
  const start = useMutation({ mutationFn: () => api<RecheckStart>(base, { body: {} }), onSuccess: (r) => setJobId(r.jobId) })
  const job = useQuery({
    queryKey: ["recheck", itineraryId, jobId],
    queryFn: () => api<RecheckStatus>(`${base}/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data?.status === "DONE" || q.state.data?.status === "FAILED" || q.state.error ? false : 2_000),
    staleTime: Infinity, refetchOnWindowFocus: false,
  })
  const s = job.data
  const pending = start.isPending || (!!jobId && !job.error && (!s || s.status === "PENDING"))
  const r = s?.status === "DONE" ? s.result : undefined
  return (
    <div className="mt-2" data-testid="revalidate">
      <Button size="xs" variant="outline" onClick={() => { setJobId(null); start.mutate() }} loading={pending} data-testid="revalidate-now">{t("apify.rv.button")}</Button>
      <div aria-live="polite" className="mt-1.5 text-meta">
        {pending && <p className="text-steel" data-testid="revalidate-pending">{t("apify.rv.pending")}</p>}
        {r && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="revalidate-result">
            <StatusChip tone={r.stillListed ? "ok" : "danger"}>{r.stillListed ? t("apify.rv.listed") : t("apify.rv.notFound")}</StatusChip>
            <span className={cn(r.priceChanged && "font-medium text-orange-700 dark:text-orange-300")}>{t("apify.rv.price")} <span className="num">{ltrIsolate(`${money(r.old)} → ${money(r.new)}`)}</span></span>
            <span className="text-steel">{t("apify.rv.fetched", { t: fmtDateTime(r.fetchedAt) })}</span>
          </p>
        )}
        {r && r.components.length > 1 && <ul className="mt-1 text-caption text-steel">{r.components.map((c, i) => <li key={c.providerOfferId}>{t("apify.ticket", { n: i + 1 })}: {c.stillListed ? t("apify.rv.listed") : t("apify.rv.notFound")} · <span className="num">{ltrIsolate(`${money(c.old)} → ${money(c.new)}`)}</span></li>)}</ul>}
        {s?.status === "FAILED" && <p role="alert" className="text-danger" data-testid="revalidate-error">{t("apify.rv.failed", { why: s.error ?? "—" })}</p>}
        {(start.error || job.error) && <p role="alert" className="text-danger" data-testid="revalidate-error">{recheckError(t, start.error ?? job.error)}</p>}
      </div>
    </div>
  )
}

/** Which tri-state facts the snapshot leaves UNKNOWN (rule 3: nothing is inferred from an indicative source). */
export function snapshotUnknowns(s: Snapshot) {
  const comps = s.itinerary.components
  return {
    baggage: s.itinerary.baggage.some((b) => b.checked.status === "UNKNOWN") || comps.some((c) => c.baggage.some((b) => b.checked.status === "UNKNOWN")),
    conditions: comps.some((c) => c.conditions.change.status === "UNKNOWN" || c.conditions.refund.status === "UNKNOWN"),
    brand: comps.some((c) => c.brand.status === "UNKNOWN"),
  }
}

/**
 * Points staff to the booking panel and to the quote builder's "confirm every unknown" step, where sending stays
 * blocked (client and server) until each one is recorded. Display only: it never unlocks anything.
 */
export function UnknownBanner({ snapshot, quoteHref }: { snapshot: Snapshot; quoteHref?: string }) {
  const t = useT()
  const u = snapshotUnknowns(snapshot)
  const which = (["baggage", "conditions", "brand"] as const).filter((k) => u[k])
  if (!which.length) return null
  return (
    <div role="note" className="mt-3 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-meta text-warning-subtle-fg" data-testid="unknown-banner">
      <p className="font-semibold">{t("apify.unknown.title")}</p>
      <p className="mt-0.5">{t("apify.unknown.fields", { list: which.map((k) => t(`apify.unknown.${k}`)).join(" · ") })}. {t("apify.unknown.step")}</p>
      {quoteHref && <Link href={quoteHref} className="mt-1 inline-flex items-center gap-1 font-medium text-link hover:underline" data-testid="unknown-quote-link">{t("apify.unknown.open")} <Arrow /></Link>}
    </div>
  )
}

/** Everything ADR-0032 B7 adds under the request snapshot; the page mounts this one line. */
export function IndicativeSource({ d }: { d: FlightDetail }) {
  const { can } = useSession()
  const s = d.snapshot
  if (!s) return null
  const indicative = (s.sources ?? []).some((x) => x.provider === APIFY)
  const quoteHref = (can("quote.create") || can("pricing.write")) && ["IN_REVIEW", "QUOTED", "ACCEPTED"].includes(d.status) ? `/requests/${d.ref}/quote` : undefined
  return (
    <>
      <SourceBadge sources={s.sources ?? []} />
      {indicative && can("pricing.read.internal") && <RevalidateNow itineraryId={s.itinerary.id} />}
      <UnknownBanner snapshot={s} quoteHref={quoteHref} />
    </>
  )
}
