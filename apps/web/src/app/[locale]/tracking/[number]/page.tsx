"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CircleX, Clock, PackageCheck, PackageSearch, ShieldCheck, TriangleAlert, Truck, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Suspense } from "react"

import type { CargoMilestone, PublicCargoTracking } from "@unitravel/contracts"
import { IconBadge } from "@unitravel/ui/brand/art"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"
import { Timeline } from "@unitravel/ui/product/timeline"

import { Auto, Ltr } from "@/components/badges"
import { CargoTrackingForm } from "@/components/cargo-tracking-form"
import { api, ApiError } from "@/lib/api"
import { isTrackingNumber, normaliseTrackingNumber } from "@/lib/cargo-tracking"
import { useI18n } from "@/lib/i18n"

type Tone = "brand" | "success" | "warning" | "danger"
const TONE: Record<Tone, { band: string; icon: LucideIcon }> = {
  brand: { band: "bg-navy-950 text-white", icon: Truck },
  success: { band: "bg-success text-white", icon: PackageCheck },
  warning: { band: "bg-warning-subtle text-warning-subtle-fg", icon: TriangleAlert },
  danger: { band: "bg-danger text-white", icon: CircleX },
}
const toneOf = (m: CargoMilestone): Tone =>
  m === "DELIVERED" ? "success" : m === "CANCELLED" ? "danger" : (["DELIVERY_FAILED", "COLLECTION_FAILED", "RETURNED_TO_SENDER", "ON_HOLD"] as CargoMilestone[]).includes(m) ? "warning" : "brand"

const Cap = ({ children }: { children: React.ReactNode }) => <p className="text-xs font-bold uppercase tracking-wide text-steel">{children}</p>

/** Six happy-path steps from the API. Off the path (failed, on hold…) no step is current; the status band says why. */
function Progress({ steps, delivered }: { steps: PublicCargoTracking["progress"]; delivered: boolean }) {
  const { t } = useI18n()
  const lastReached = steps.reduce((acc, s, i) => (s.reached ? i : acc), -1)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3"><Cap>{t("cargoTracking.progress")}</Cap>
        {lastReached >= 0 && <p className="text-xs font-semibold text-navy-900 sm:hidden" aria-hidden>{t("cargoTracking.stepOf", { n: lastReached + 1, total: steps.length })}{" "}{steps[lastReached]!.label}</p>}
      </div>
      <ol className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label={t("cargoTracking.progress")} data-testid="cargo-progress">
        {steps.map((s) => {
          const state = s.current ? "current" : s.reached ? "done" : "todo"
          const fill = !s.reached ? "bg-line" : delivered ? "bg-success" : s.current ? "bg-orange" : "bg-navy-900"
          return (
            <li key={s.milestone} aria-current={s.current ? "step" : undefined} data-state={state} className="min-w-0">
              <span aria-hidden className={`block h-2 rounded-full ${fill} ${s.current && !delivered ? "ring-4 ring-orange/25" : ""}`} />
              <span className={`sr-only text-xs leading-tight sm:not-sr-only sm:mt-2 sm:block ${s.current ? "font-bold text-navy-950" : s.reached ? "font-medium text-navy-900" : "text-steel"}`}>
                {s.label}<span className="sr-only"> ({t(state === "done" ? "cargoTracking.stepDone" : state === "current" ? "cargoTracking.stepCurrent" : "cargoTracking.stepTodo")})</span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Place({ label, p }: { label: string; p: { city: string | null; country: string } }) {
  return <div className="min-w-0"><Cap>{label}</Cap><p className="font-display truncate text-xl"><Auto>{p.city ?? p.country}</Auto></p>{p.city && <p className="text-sm text-steel"><Auto>{p.country}</Auto></p>}</div>
}

function Result({ d }: { d: PublicCargoTracking }) {
  const { t, date, sep } = useI18n()
  const tone = TONE[toneOf(d.milestone)]
  const Icon = tone.icon
  // The shared Timeline marks its last stop as the latest; the API lists newest first.
  const events = [...d.timeline].reverse()
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="cargo-tracking-result">
      <div className="min-w-0 space-y-6">
        <section className="card-brand overflow-hidden !p-0" aria-labelledby="status-h">
          <div className={`p-5 md:p-7 ${tone.band}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide opacity-85">{t("cargoTracking.current")}</p>
              {d.labelVerified === true && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-success" title={t("cargoTracking.verifiedNote")} data-testid="label-verified">
                  <ShieldCheck className="size-3.5" aria-hidden />{t("cargoTracking.verified")}<span className="sr-only">{sep}{t("cargoTracking.verifiedNote")}</span>
                </span>
              )}
            </div>
            <h1 id="status-h" className="font-display mt-2 flex items-center gap-3 text-3xl leading-tight md:text-[2.6rem]" aria-live="polite" data-testid="cargo-milestone">
              <Icon className={`size-8 shrink-0 md:size-10 ${toneOf(d.milestone) === "brand" ? "text-orange" : ""}`} aria-hidden />{d.milestoneLabel}
            </h1>
            <p className="mt-3 text-sm opacity-90">{t("cargoTracking.number")} <Ltr className="font-mono font-semibold tracking-wider">{d.trackingNumber}</Ltr>{sep}{t(`cargo.${d.service}` as never)}</p>
          </div>
          <div className="p-5 md:p-7"><Progress steps={d.progress} delivered={d.milestone === "DELIVERED"} /></div>
        </section>
        {d.labelVerified === false && <p role="status" className="rounded-xl border-s-4 border-warning-border bg-warning-subtle px-4 py-3 text-sm leading-6 text-warning-subtle-fg" data-testid="label-unverified">{t("cargoTracking.unverified")}</p>}
        <section className="card-brand p-5 md:p-6" aria-labelledby="history-h">
          <h2 id="history-h" className="font-display mb-4 text-xl">{t("cargoTracking.history")}</h2>
          <Timeline data-testid="cargo-public-timeline" empty={t("cargoTracking.noEvents")}
            items={events.map((e, i) => ({ id: `${i}-${e.occurredAt}`, title: e.label, meta: <><Auto>{e.location}</Auto>{e.agent && <>{sep}<span data-testid="event-agent">{t("cargoTracking.byAgent", { name: e.agent })}</span></>}{sep}{date(e.occurredAt, { withTime: true, year: true })}</> }))} />
        </section>
      </div>
      <aside className="space-y-6">
        {d.delivered && (
          <section className="card-brand !border-2 !border-success p-5" data-testid="delivery-confirmation">
            <p className="flex items-center gap-2 font-display text-lg text-success"><PackageCheck className="size-5" aria-hidden />{t("cargoTracking.deliveredTitle")}</p>
            <p className="mt-2 text-sm">{t("cargoTracking.deliveredOn", { date: date(d.delivered.at, { withTime: true, year: true }) })}</p>
            {d.delivered.receivedBy && <p className="mt-1 text-sm">{t("cargoTracking.receivedBy", { name: "⁨" + d.delivered.receivedBy + "⁩" })}</p>}
          </section>
        )}
        <section className="card-brand p-5" aria-label={t("cargoTracking.route")}>
          <div className="flex items-center gap-3">
            <Place label={t("cargoTracking.from")} p={d.origin} />
            <ArrowRight className="size-5 shrink-0 text-orange-700 rtl:rotate-180" aria-hidden />
            <Place label={t("cargoTracking.to")} p={d.destination} />
          </div>
        </section>
        <section className="card-brand space-y-4 p-5">
          {!d.delivered && d.estimatedDeliveryAt && (
            <div data-testid="cargo-eta"><Cap>{t("cargoTracking.eta")}</Cap><p className="font-display text-lg">{date(d.estimatedDeliveryAt, { dateOnly: true, weekday: true })}</p><p className="text-xs text-steel">{t("cargoTracking.etaNote")}</p></div>
          )}
          <div><Cap>{t("cargoTracking.lastUpdate")}</Cap><p className="flex items-center gap-1.5 text-sm"><Clock className="size-4 text-steel" aria-hidden />{date(d.lastUpdatedAt, { withTime: true, year: true })}</p><p className="mt-1 text-xs text-steel">{t("cargoTracking.refreshNote")}</p></div>
        </section>
        <p className="text-xs leading-5 text-steel">{t("cargoTracking.privacy")}</p>
        {d.agentUrl && <a href={d.agentUrl} className="inline-flex items-center gap-1.5 text-xs font-medium text-steel underline-offset-2 hover:underline" data-testid="agent-update-link"><Truck className="size-3.5" aria-hidden />{t("cargoTracking.agentUpdate")}</a>}
      </aside>
    </div>
  )
}

function TrackingResult() {
  const { t, locale, href } = useI18n()
  const raw = decodeURIComponent(useParams<{ number: string }>().number ?? "")
  const sig = useSearchParams().get("s")
  const number = normaliseTrackingNumber(raw)
  const valid = isTrackingNumber(number)
  const q = useQuery({
    queryKey: ["cargo-tracking", number, sig, locale],
    queryFn: () => api<PublicCargoTracking>(`/v1/public/cargo-tracking/${encodeURIComponent(number)}${sig ? `?s=${encodeURIComponent(sig)}` : ""}`, { locale }),
    enabled: valid, refetchInterval: (query) => (query.state.data?.delivered || query.state.error ? false : 120_000),
  })
  const status = q.error instanceof ApiError ? q.error.problem.status : undefined
  const notFound = !valid || status === 404
  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-6 md:pt-10">
      {valid && q.isLoading && <LoadingState label={t("common.loading")} rows={4} />}
      {q.data && <Result d={q.data} />}
      {notFound && (
        <div className="mx-auto max-w-2xl space-y-6" data-testid="cargo-tracking-not-found">
          <section className="card-brand flex flex-col items-center gap-2 p-8 text-center md:p-10">
            <IconBadge className="mb-1"><PackageSearch /></IconBadge>
            <h1 className="font-display text-2xl">{t("cargoTracking.notFoundTitle")}</h1>
            {raw && <p><Ltr className="font-mono text-steel">{raw}</Ltr></p>}
            <p className="max-w-md text-sm leading-6 text-steel">{t("cargoTracking.notFoundBody")}</p>
          </section>
          <CargoTrackingForm initial={raw} />
        </div>
      )}
      {q.isError && !notFound && (
        <div className="mx-auto max-w-2xl" data-testid="cargo-tracking-error">
          <ErrorState title={status === 429 ? t("cargoTracking.rateLimited") : t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />
        </div>
      )}
      {q.data && (
        <section className="mx-auto mt-10 max-w-2xl" aria-label={t("cargoTracking.another")}>
          <h2 className="font-display mb-3 text-lg">{t("cargoTracking.another")}</h2>
          <CargoTrackingForm />
          <p className="mt-4 text-center"><Link href={href("/shipments")} className="text-sm font-semibold text-royal underline underline-offset-4">{t("cargoTracking.mine")}</Link></p>
        </section>
      )}
    </div>
  )
}

/** Public cargo tracking result (ADR-0042): works signed out; `?s=` from the label QR proves the label is ours. */
export default function CargoTrackingResultPage() {
  return <Suspense><TrackingResult /></Suspense>
}
