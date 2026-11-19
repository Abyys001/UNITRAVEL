"use client"

import type { CapturedBaggage } from "@unitravel/contracts"

import { StatusChip } from "@/components/bento"
import { KV, KVRow } from "@/components/dev-ui"
import { fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { FlightDetail } from "@/lib/types"

import { amount, DeadlineWarning, FreshnessBadge, hasPrice, SeatsCell } from "./shared"

type StaffFareView = NonNullable<NonNullable<FlightDetail["snapshot"]>["staffFare"]>

function bagText(b: CapturedBaggage, t: ReturnType<typeof useT>): string {
  if (b.checked.status === "UNKNOWN") return t("fb.tri.unknown")
  const v = b.checked.value
  if (v.pieces === 0) return t("fb.tri.notIncluded")
  return [v.pieces ? t("fb.bag.pieces", { n: v.pieces }) : t("fb.tri.included"), v.kgPerPiece ? `${v.kgPerPiece} kg` : null, v.totalKg ? t("fb.bag.total", { n: v.totalKg }) : null].filter(Boolean).join(" · ")
}
const condText = (c: { state: string }, t: ReturnType<typeof useT>) => (c.state === "KNOWN_ALLOWED" ? t("fb.tri.allowed") : c.state === "NOT_ALLOWED" ? t("fb.tri.notAllowed") : t("fb.tri.unknown"))

/** Staff view of the catalog fare behind a request's snapshot: seats, class, baggage and conditions for all staff; supplier price only with `pricing.read.internal` (ADR-0004). */
export function StaffFarePanel({ fare }: { fare: StaffFareView }) {
  const t = useT()
  const { can } = useSession()
  const priced = can("pricing.read.internal") && hasPrice(fare)
  const anyUnknown = fare.baggage.some((b) => b.checked.status === "UNKNOWN") || fare.change.state === "UNKNOWN" || fare.refund.state === "UNKNOWN"
  return (
    <div className="mt-3 rounded-md border border-rule bg-surface-sunk p-3" data-testid="staff-fare">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-meta font-semibold text-ink">{t("fb.sf.title")}</h3>
        <StatusChip tone="neutral">{t("fb.staffOnly")}</StatusChip>
        <FreshnessBadge value={fare.freshness} />
        {anyUnknown && <StatusChip tone="warn">{t("fb.sf.unknown")}</StatusChip>}
      </div>
      <KV className="text-meta">
        <KVRow k={t("fb.f.cabin")}>{t(`fb.cabin.${fare.cabin}` as MsgKey)} · <span className="num" dir="ltr">{fare.bookingClasses.join("/")}</span></KVRow>
        <KVRow k={t("fb.col.seats")}><SeatsCell seats={fare.seats} /></KVRow>
        {fare.fareBasis.length > 0 && <KVRow k={t("fb.f.fareBasis")}><span className="num" dir="ltr">{fare.fareBasis.join(" / ")}</span></KVRow>}
        <KVRow k={t("fb.f.fareType")}>{t(`fb.fareType.${fare.fareType}` as MsgKey)}{fare.fareTypeRaw ? <span className="text-steel" dir="auto"> ({fare.fareTypeRaw})</span> : null}</KVRow>
        {fare.baggage.map((b, i) => <KVRow key={i} k={t("fb.sf.bag", { n: i + 1 })}><span dir="auto">{bagText(b, t)}</span>{b.sourceText && <span className="block text-caption text-steel" dir="auto">“{b.sourceText}”</span>}</KVRow>)}
        <KVRow k={t("fb.f.change")}>{condText(fare.change, t)}{priced && hasPrice(fare) && fare.change.penaltyMinor != null && <span className="num"> · {amount(fare.change.penaltyMinor, fare.currency)}</span>}{fare.change.sourceText && <span className="block text-caption text-steel" dir="auto">“{fare.change.sourceText}”</span>}</KVRow>
        <KVRow k={t("fb.f.refund")}>{condText(fare.refund, t)}{priced && hasPrice(fare) && fare.refund.penaltyMinor != null && <span className="num"> · {amount(fare.refund.penaltyMinor, fare.currency)}</span>}{fare.refund.sourceText && <span className="block text-caption text-steel" dir="auto">“{fare.refund.sourceText}”</span>}</KVRow>
        <KVRow k={t("fb.f.deadline")}><DeadlineWarning deadline={fare.ticketingDeadline} warn={fare.deadlineWarning} /></KVRow>
        <KVRow k={t("fb.f.observedAt")}><span className="num">{fmtDateTime(fare.observedAt)}</span></KVRow>
        {fare.sourceRecordId && <KVRow k={t("fb.f.recordId")}><span className="font-mono" dir="ltr">{fare.sourceRecordId}</span></KVRow>}
      </KV>
      {fare.rulesText && <details className="mt-2 text-meta"><summary className="cursor-pointer font-medium">{t("fb.f.rules")}</summary><p className="mt-1 whitespace-pre-wrap" dir="auto">{fare.rulesText}</p></details>}
      {priced && hasPrice(fare) && (
        <div className="mt-3 border-t border-rule pt-3" data-testid="staff-fare-price">
          <p className="mb-1 text-meta font-semibold text-ink">{t("fb.sf.supplier")}</p>
          <KV className="num text-meta">
            <KVRow k={t("fb.f.base")}><span dir="ltr">{amount(fare.baseMinor, fare.currency)}</span></KVRow>
            <KVRow k={t("fb.f.taxes")}><span dir="ltr">{amount(fare.taxesMinor, fare.currency)}</span></KVRow>
            <KVRow k={t("fb.f.total")}><b dir="ltr">{amount(fare.totalMinor, fare.currency)}</b></KVRow>
          </KV>
        </div>
      )}
    </div>
  )
}
