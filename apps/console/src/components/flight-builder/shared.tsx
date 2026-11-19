"use client"

import type { SeatsReported, FlightBuilderUsage, Freshness, FareStatus, StaffFare, StaffFareNoPrice, StaffFlightBuilderOption, UsageSummary } from "@unitravel/contracts"
import { useQuery } from "@tanstack/react-query"

import { StatusChip } from "@/components/bento"
import { api, ApiError } from "@/lib/api"
import { type MsgKey, useT } from "@/lib/i18n"
import { toMajor } from "@/lib/format"
import type { Page } from "@/lib/types"

export const FB = "/v1/admin/flight-builder"
export const FB_DEV = "/v1/dev/providers/flight-builder"
export const FB_KEYS = { all: ["flight-builder"] as const, options: ["flight-builder", "options"] as const, usage: ["flight-builder", "usage"] as const, state: ["flight-builder", "state"] as const, runs: ["flight-builder", "runs"] as const }

export type StaffFareAny = StaffFare | StaffFareNoPrice
/** The API omits every price field when the caller lacks `pricing.read.internal` (ADR-0004), so presence is the test, not the permission. */
export const hasPrice = (f: StaffFareAny): f is StaffFare => "totalMinor" in f && typeof (f as StaffFare).totalMinor === "number"
export const amount = (minor: number | null | undefined, currency: string) => (minor == null ? "—" : `${currency} ${toMajor(minor, currency)}`)

/** The list endpoint may answer a bare array or a page; both are accepted. */
export const asList = <T,>(r: T[] | Page<T> | undefined): T[] | undefined => (r === undefined ? undefined : Array.isArray(r) ? r : r.items)

export const useFbUsage = (enabled = true) =>
  useQuery({ queryKey: FB_KEYS.usage, queryFn: () => api<FlightBuilderUsage>(`${FB}/usage`), refetchInterval: 120_000, enabled })
export const useFbOptions = (status: string) =>
  useQuery({ queryKey: [...FB_KEYS.options, status], queryFn: () => api<StaffFlightBuilderOption[] | Page<StaffFlightBuilderOption>>(`${FB}/options${status ? `?status=${status}` : ""}`).then(asList) })

const FRESH_TONE: Record<Freshness, "ok" | "info" | "warn" | "danger"> = { FRESH: "ok", AGING: "info", STALE: "warn", EXPIRED: "danger" }
export function FreshnessBadge({ value }: { value: Freshness }) {
  const t = useT()
  return <StatusChip tone={FRESH_TONE[value]}>{t(`fb.fresh.${value}` as MsgKey)}</StatusChip>
}
const STATUS_TONE: Record<FareStatus, "ok" | "warn" | "danger" | "neutral"> = { LIVE: "ok", STALE: "warn", EXPIRED: "danger", RETIRED: "neutral" }
export function FareStatusBadge({ value }: { value: FareStatus }) {
  const t = useT()
  return <StatusChip tone={STATUS_TONE[value]}>{t(`fb.status.${value}` as MsgKey)}</StatusChip>
}
export function DeadlineWarning({ deadline, warn }: { deadline: string | null; warn: boolean }) {
  const t = useT()
  if (!deadline) return <span className="text-steel">—</span>
  return <span className="inline-flex flex-wrap items-center gap-1.5"><span className="num">{deadline}</span>{warn && <StatusChip tone="warn">{t("fb.deadline.soon")}</StatusChip>}</span>
}

const LEVEL_TONE: Record<UsageSummary["level"], "ok" | "warn" | "danger" | "neutral"> = { OK: "ok", WARNING: "warn", CRITICAL: "danger", UNKNOWN: "neutral" }
export const levelTone = (l: UsageSummary["level"]) => LEVEL_TONE[l]
export function LevelBadge({ level }: { level: UsageSummary["level"] }) {
  const t = useT()
  return <StatusChip tone={LEVEL_TONE[level]}>{t(`fb.level.${level}` as MsgKey)}</StatusChip>
}

/** 422 POLICY_BLOCKED and ROUTE_NOT_TRACKED and 409 AUTHORISATION_REQUIRED / SOURCE_NOT_AUTHORISED / NO_ADAPTER get their own words; anything else shows the API's detail. */
export function fbProblem(e: unknown, t: ReturnType<typeof useT>): { code: string | null; title: string; detail: string } | null {
  if (!e) return null
  if (!(e instanceof ApiError)) return { code: null, title: t("fb.err.generic"), detail: e instanceof Error ? e.message : String(e) }
  const known = ["POLICY_BLOCKED", "ROUTE_NOT_TRACKED", "AUTHORISATION_REQUIRED", "SOURCE_NOT_AUTHORISED", "NO_ADAPTER", "OFFER_EXPIRED"]
  const fields = e.problem.errors?.map((x) => `${x.path}: ${x.message ?? x.code}`).join("; ")
  const detail = [e.problem.detail ?? e.problem.title, fields].filter(Boolean).join(" — ")
  return known.includes(e.code) ? { code: e.code, title: t(`fb.err.${e.code}` as MsgKey), detail } : { code: e.code, title: t("fb.err.generic"), detail }
}
export function ProblemBox({ error }: { error: unknown }) {
  const t = useT()
  const p = fbProblem(error, t)
  if (!p) return null
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-meta text-danger" data-testid="fb-problem" data-code={p.code ?? undefined}>
      <p className="font-semibold">{p.title}</p>
      <p className="break-words" dir="auto">{p.detail}</p>
    </div>
  )
}

export const routeOf = (o: Pick<StaffFlightBuilderOption, "segments">) => `${o.segments[0]?.from ?? "?"} → ${o.segments[o.segments.length - 1]?.to ?? "?"}`
export const flightsOf = (o: Pick<StaffFlightBuilderOption, "segments">) => o.segments.map((s) => `${s.carrier}${s.flightNumber}`).join(" · ")

/** "9" is the panel's cap with an UNKNOWN meaning, so it is shown as written and flagged, never as a count. */
export function SeatsCell({ seats }: { seats: SeatsReported[] }) {
  const t = useT()
  return (
    <span className="num inline-flex flex-wrap gap-x-1.5" dir="ltr">
      {seats.map((s, i) => <span key={i} title={s.atCap ? t("fb.seats.cap") : undefined}>{s.raw}{s.atCap && <sup className="text-warning-subtle-fg">?</sup>}</span>)}
    </span>
  )
}

