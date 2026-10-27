"use client"

import { ArrowRight, Copy, MessageSquareText, Phone, Plane } from "lucide-react"

import type { SearchQuery } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { Tag } from "@/components/ui"
import { fmtDate, fmtDateTime, human, money } from "@/lib/format"
import type { FlightDetail, StaffTraveller } from "@/lib/types"

export const PAX_LABEL: Record<string, string> = { ADT: "Adult", CHD: "Child", INF: "Infant (lap)", INS: "Infant (seat)", YTH: "Youth", STU: "Student" }

/** Label / value rows used across the case panels: label column fixed, values wrap on their own. */
export function Facts({ rows, className }: { rows: [string, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-meta", className)}>
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-steel">{k}</dt><dd className="min-w-0 text-ink">{v}</dd></div>)}
    </dl>
  )
}

const Chip = ({ children, tone = "quiet" }: { children: React.ReactNode; tone?: "quiet" | "ok" | "warn" }) => (
  <span className={cn("inline-flex h-6 items-center rounded-full border px-2.5 text-caption font-medium whitespace-nowrap",
    tone === "ok" ? "border-success-border bg-success-subtle text-success-subtle-fg" : tone === "warn" ? "border-warning-border bg-warning-subtle text-warning-subtle-fg" : "border-rule-strong bg-surface-sunk text-steel")}>{children}</span>
)

/* ---------- customer ---------- */

export function CustomerCard({ d, mobile, canAct, onCopy, onCall, onSms }: { d: FlightDetail; mobile: boolean; canAct: boolean; onCopy: () => void; onCall: () => void; onSms: () => void }) {
  const c = d.customer
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900 font-display text-meta font-bold text-white dark:bg-navy-700">
          {(c.nameLatin || c.displayName).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lead font-semibold text-ink" dir="auto" data-testid="customer-name">{c.nameLatin || c.displayName}</p>
          {c.nameFa && <p className="w-fit font-fa text-body text-steel" dir="rtl" lang="fa" data-testid="customer-name-fa">{c.nameFa}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-rule bg-surface-raised p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="num text-lead font-medium text-ink" dir="ltr">{c.phone}</span>
          {c.phoneVerified ? <Tag value="VERIFIED" title={c.phoneVerifiedAt ? `Verified ${fmtDateTime(c.phoneVerifiedAt)}` : undefined} /> : <Tag value="UNVERIFIED" className="border-danger/30 bg-danger-subtle text-danger" />}
        </div>
        {c.phoneVerifiedAt && <p className="mt-0.5 text-caption text-steel" suppressHydrationWarning>Verified {fmtDateTime(c.phoneVerifiedAt)}</p>}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {!mobile && <Button size="sm" variant="outline" onClick={onCopy}><Copy /> Copy</Button>}
          {canAct && <Button size="sm" variant="outline" onClick={onCall}><Phone /> Log call</Button>}
          {canAct && <Button size="sm" variant="outline" onClick={onSms}><MessageSquareText /> SMS</Button>}
        </div>
      </div>

      <Facts rows={[
        ["Language", c.preferredLocale === "fa" ? "Persian" : "English"],
        ...(c.contactTimePref ? [["Best time to call", <span key="t" dir="auto">{c.contactTimePref}</span>] as [string, React.ReactNode]] : []),
        ...(c.alternativeContact ? [["Alternative", <span key="a"><span dir="auto">{c.alternativeContact.name}</span> <span className="text-steel">({c.alternativeContact.relationship})</span><br /><span className="num" dir="ltr">{c.alternativeContact.phone}</span></span>] as [string, React.ReactNode]] : []),
      ]} />
    </div>
  )
}

/* ---------- travellers ---------- */

export function TravellerCard({ t, index, revealed, canReveal, onReveal, verificationLabel }: { t: StaffTraveller; index: number; revealed?: string; canReveal: boolean; onReveal: () => void; verificationLabel: string }) {
  return (
    <li className="rounded-lg border border-rule bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-caption text-steel">Traveller {index + 1} · {PAX_LABEL[t.passengerType] ?? t.passengerType}</p>
          <p className="truncate font-medium text-ink">{[t.name.title, t.name.givenNames, t.name.surname].filter(Boolean).join(" ")}</p>
          {t.name.nameFa && <p className="w-fit font-fa text-meta text-steel" dir="rtl" lang="fa">{t.name.nameFa}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {t.documentComplete ? <Tag value="DOCS_COMPLETE" className="border-success-border bg-success-subtle text-success-subtle-fg" /> : <Tag value="DOCS_MISSING" className="border-danger/30 bg-danger-subtle text-danger" />}
        {t.verificationStatus && <Tag value={t.verificationStatus} title={verificationLabel} />}
      </div>
      {t.document ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-rule pt-2 text-meta">
          <span className="min-w-0 text-steel">
            {human(t.document.type)} <span className="num text-ink" data-testid="doc-number">{revealed ?? `•••• ${t.document.last4}`}</span>
            <span className="block text-caption">{t.document.issuingCountry} · expires {fmtDate(t.document.expiryDate)}</span>
          </span>
          {canReveal && !revealed && <Button size="xs" variant="ghost" className="text-link" onClick={onReveal} title="Logged as customer.read.documents">Reveal</Button>}
        </div>
      ) : <p className="mt-2 border-t border-rule pt-2 text-meta text-danger">No passport on file</p>}
    </li>
  )
}

/* ---------- request ---------- */

type Prefs = SearchQuery["preferences"]
function preferenceChips(p: Prefs): { label: string; tone: "ok" | "quiet" | "warn" }[] {
  return [
    { label: p.allowSelfTransfer ? "Self-transfer OK" : "No self-transfer", tone: p.allowSelfTransfer ? "ok" : "quiet" },
    { label: p.allowOvernight ? "Overnight OK" : "No overnight", tone: p.allowOvernight ? "ok" : "quiet" },
    ...(p.allowAirportChange ? [{ label: "Airport change OK", tone: "ok" as const }] : []),
    { label: `Max ${p.maxStops} stop${p.maxStops === 1 ? "" : "s"}`, tone: "quiet" as const },
    ...(p.preferredLayoverMin ? [{ label: `Layover ${p.preferredLayoverMin[0] / 60}–${p.preferredLayoverMin[1] / 60} h`, tone: "quiet" as const }] : []),
    ...(p.includeGateways ? [{ label: "Gateway departures OK", tone: "ok" as const }] : []),
    ...(p.studentFare ? [{ label: "Student fare", tone: "warn" as const }] : []),
  ]
}

export function TripSummary({ d }: { d: FlightDetail }) {
  const code = (p: SearchQuery["slices"][number]["from"]) => ("city" in p ? p.city : p.airport)
  const name = (c: string) => d.places?.[c] ?? c
  const pax = Object.entries(d.query.passengers.reduce<Record<string, number>>((m, p) => ({ ...m, [p.type]: (m[p.type] ?? 0) + 1 }), {}))
  const seat = (d.preferences as { seatPreference?: string }).seatPreference
  const m = d.manual
  const brief: [string, React.ReactNode][] = [
    ...(m?.flexibility ? [["Flexibility", <span key="f" dir="auto">{m.flexibility}</span>] as [string, React.ReactNode]] : []),
    ...(m?.budget ? [["Budget", <span key="b" className="num">{money(m.budget)}</span>] as [string, React.ReactNode]] : []),
    ...(m?.airlinesPrefer?.length ? [["Prefer airlines", m.airlinesPrefer.join(", ")] as [string, React.ReactNode]] : []),
    ...(m?.airlinesAvoid?.length ? [["Avoid airlines", m.airlinesAvoid.join(", ")] as [string, React.ReactNode]] : []),
    ...(m ? [["Overland legs", m.overlandAcceptable ? "Acceptable" : "Not wanted"] as [string, React.ReactNode]] : []),
    ...(seat && seat !== "NONE" ? [["Seat", human(seat)] as [string, React.ReactNode]] : []),
  ]
  return (
    <div className="space-y-4" data-testid="trip-summary">
      <div className="flex flex-wrap gap-1.5">
        <Chip>{human(d.tripType)}</Chip>
        <Chip>{human(d.query.cabin)}</Chip>
        <Chip>{pax.map(([t, n]) => `${n} ${(PAX_LABEL[t] ?? t).toLowerCase()}${n > 1 ? "s" : ""}`).join(", ")}</Chip>
        {d.kind === "MANUAL" && <Chip tone="warn">Manual request</Chip>}
      </div>

      <ol className="overflow-hidden rounded-lg border border-rule">
        {d.query.slices.map((s, i) => (
          <li key={i} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-surface-raised px-3 py-2.5", i > 0 && "border-t border-rule")}>
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-surface-sunk text-steel"><Plane className={cn("size-4", i > 0 && d.tripType === "RETURN" && "-scale-x-100")} /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-1.5 font-medium text-ink">
                {name(code(s.from))} <span className="ref text-caption text-steel">{code(s.from)}</span>
                <ArrowRight aria-label="to" className="size-3.5 text-steel" />
                {name(code(s.to))} <span className="ref text-caption text-steel">{code(s.to)}</span>
              </span>
              <span className="block text-caption text-steel">Flight {i + 1}</span>
            </span>
            <span className="text-end">
              <span className="block num text-meta font-medium text-ink">{fmtDate(s.date)}</span>
              {s.flexDays ? <span className="block text-caption text-steel">± {s.flexDays} day{s.flexDays > 1 ? "s" : ""}</span> : <span className="block text-caption text-steel">Exact date</span>}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <p className="cap mb-1.5">Routing preferences</p>
        <div className="flex flex-wrap gap-1.5">{preferenceChips(d.query.preferences).map((c) => <Chip key={c.label} tone={c.tone}>{c.label}</Chip>)}</div>
      </div>

      {brief.length > 0 && (
        <div>
          <p className="cap mb-1.5">Customer's brief</p>
          <Facts rows={brief} />
        </div>
      )}

      {d.customerNote && (
        <figure className="rounded-lg border-s-4 border-orange bg-surface-raised px-3 py-2">
          <figcaption className="cap mb-0.5">Customer note</figcaption>
          <blockquote className="text-body text-ink" dir="auto">{d.customerNote}</blockquote>
        </figure>
      )}
    </div>
  )
}
