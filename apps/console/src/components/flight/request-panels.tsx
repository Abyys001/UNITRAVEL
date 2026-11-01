"use client"

import { ArrowRight, Copy, MessageSquareText, Phone, Plane } from "lucide-react"

import type { SearchQuery } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { Country } from "@unitravel/ui/product/country"
import { StateChip } from "@/components/case"
import { codeLabel } from "@/components/club"
import { fmtDate, fmtDateTime, money } from "@/lib/format"
import { hasMsg, type MsgKey, statusText, type T, useT } from "@/lib/i18n"
import type { FlightDetail, StaffTraveller } from "@/lib/types"

const paxLabel = (t: T, type: string) => { const k = `case.pax.${type}`; return hasMsg(k) ? t(k) : type }

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
  const t = useT()
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
          {c.phoneVerified ? <span title={c.phoneVerifiedAt ? t("rp.verifiedAt", { t: fmtDateTime(c.phoneVerifiedAt) }) : undefined}><StateChip value="VERIFIED" /></span> : <StateChip value="UNVERIFIED" className="border-danger/30 bg-danger-subtle text-danger" />}
        </div>
        {c.phoneVerifiedAt && <p className="mt-0.5 text-caption text-steel" suppressHydrationWarning>{t("rp.verifiedAt", { t: fmtDateTime(c.phoneVerifiedAt) })}</p>}
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {!mobile && <Button size="sm" variant="outline" onClick={onCopy}><Copy /> {t("rp.copy")}</Button>}
          {canAct && <Button size="sm" variant="outline" onClick={onCall}><Phone /> {t("rp.logCall")}</Button>}
          {canAct && <Button size="sm" variant="outline" onClick={onSms}><MessageSquareText /> {t("rp.sms")}</Button>}
        </div>
      </div>

      <Facts rows={[
        [t("rp.language"), t(c.preferredLocale === "fa" ? "lang.name.fa" : "lang.name.en")],
        ...(c.contactTimePref ? [[t("rp.bestTime"), <span key="t" dir="auto">{c.contactTimePref}</span>] as [string, React.ReactNode]] : []),
        ...(c.alternativeContact ? [[t("rp.alternative"), <span key="a"><span dir="auto">{c.alternativeContact.name}</span> <span className="text-steel">({c.alternativeContact.relationship})</span><br /><span className="num" dir="ltr">{c.alternativeContact.phone}</span></span>] as [string, React.ReactNode]] : []),
      ]} />
    </div>
  )
}

/* ---------- travellers ---------- */

export function TravellerCard({ t: trav, index, revealed, canReveal, onReveal, verificationLabel }: { t: StaffTraveller; index: number; revealed?: string; canReveal: boolean; onReveal: () => void; verificationLabel: string }) {
  const t = useT()
  return (
    <li className="rounded-lg border border-rule bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-caption text-steel">{t("rp.traveller", { n: index + 1 })} · {paxLabel(t, trav.passengerType)}</p>
          <p className="truncate font-medium text-ink">{[trav.name.title, trav.name.givenNames, trav.name.surname].filter(Boolean).join(" ")}</p>
          {trav.name.nameFa && <p className="w-fit font-fa text-meta text-steel" dir="rtl" lang="fa">{trav.name.nameFa}</p>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {trav.documentComplete ? <StateChip value="DOCS_COMPLETE" /> : <StateChip value="DOCS_MISSING" className="border-danger/30 bg-danger-subtle text-danger" />}
        {trav.verificationStatus && <span title={verificationLabel}><StateChip value={trav.verificationStatus} /></span>}
      </div>
      {trav.document ? (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-rule pt-2 text-meta">
          <span className="min-w-0 text-steel">
            {codeLabel(t, "rp.doctype", trav.document.type)} <span className="num text-ink" data-testid="doc-number">{revealed ?? `•••• ${trav.document.last4}`}</span>
            <span className="block text-caption"><Country code={trav.document.issuingCountry} /> · {t("rp.expires", { d: fmtDate(trav.document.expiryDate) })}</span>
          </span>
          {canReveal && !revealed && <Button size="xs" variant="ghost" className="text-link" onClick={onReveal} title={t("rp.reveal.title")}>{t("rp.reveal")}</Button>}
        </div>
      ) : <p className="mt-2 border-t border-rule pt-2 text-meta text-danger">{t("rp.noPassport")}</p>}
    </li>
  )
}

/* ---------- request ---------- */

type Prefs = SearchQuery["preferences"]
function preferenceChips(p: Prefs, t: T): { label: string; tone: "ok" | "quiet" | "warn" }[] {
  return [
    { label: t(p.allowSelfTransfer ? "rp.pref.selfOk" : "rp.pref.selfNo"), tone: p.allowSelfTransfer ? "ok" : "quiet" },
    { label: t(p.allowOvernight ? "rp.pref.nightOk" : "rp.pref.nightNo"), tone: p.allowOvernight ? "ok" : "quiet" },
    ...(p.allowAirportChange ? [{ label: t("rp.pref.airportOk"), tone: "ok" as const }] : []),
    { label: t(p.maxStops === 1 ? "rp.pref.stop.one" : "rp.pref.stops", { n: p.maxStops }), tone: "quiet" as const },
    ...(p.preferredLayoverMin ? [{ label: t("rp.pref.layover", { a: p.preferredLayoverMin[0] / 60, b: p.preferredLayoverMin[1] / 60 }), tone: "quiet" as const }] : []),
    ...(p.includeGateways ? [{ label: t("rp.pref.gateway"), tone: "ok" as const }] : []),
    ...(p.studentFare ? [{ label: t("rp.pref.student"), tone: "warn" as const }] : []),
  ]
}

export function TripSummary({ d }: { d: FlightDetail }) {
  const t = useT()
  const code = (p: SearchQuery["slices"][number]["from"]) => ("city" in p ? p.city : p.airport)
  const name = (c: string) => d.places?.[c] ?? c
  const seat = (d.preferences as { seatPreference?: string }).seatPreference
  const m = d.manual
  const brief: [string, React.ReactNode][] = [
    ...(m?.flexibility ? [[t("rp.flexibility"), <span key="f" dir="auto">{m.flexibility}</span>] as [string, React.ReactNode]] : []),
    ...(m?.budget ? [[t("rp.budget"), <span key="b" className="num">{money(m.budget)}</span>] as [string, React.ReactNode]] : []),
    ...(m?.airlinesPrefer?.length ? [[t("rp.airlinesPrefer"), m.airlinesPrefer.join(", ")] as [string, React.ReactNode]] : []),
    ...(m?.airlinesAvoid?.length ? [[t("rp.airlinesAvoid"), m.airlinesAvoid.join(", ")] as [string, React.ReactNode]] : []),
    ...(m ? [[t("rp.overland"), t(m.overlandAcceptable ? "rp.acceptable" : "rp.notWanted")] as [string, React.ReactNode]] : []),
    ...(seat && seat !== "NONE" ? [[t("rp.seat"), codeLabel(t, "rp.seatPref", seat)] as [string, React.ReactNode]] : []),
  ]
  return (
    <div className="space-y-4" data-testid="trip-summary">
      <ol className="overflow-hidden rounded-lg border border-rule">
        {d.query.slices.map((s, i) => (
          <li key={i} className={cn("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 bg-surface-raised px-3 py-2.5", i > 0 && "border-t border-rule")}>
            <span aria-hidden className="grid size-8 place-items-center rounded-full bg-surface-sunk text-steel"><Plane className={cn("size-4", i > 0 && d.tripType === "RETURN" && "-scale-x-100")} /></span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-1.5 font-medium text-ink">
                {name(code(s.from))} <span className="ref text-caption text-steel">{code(s.from)}</span>
                <ArrowRight aria-hidden className="size-3.5 text-steel rtl:-scale-x-100" />
                {name(code(s.to))} <span className="ref text-caption text-steel">{code(s.to)}</span>
              </span>
              <span className="block text-caption text-steel">{t("rp.flightN", { n: i + 1 })}</span>
            </span>
            <span className="text-end">
              <span className="block num text-meta font-medium text-ink">{fmtDate(s.date)}</span>
              {s.flexDays ? <span className="block text-caption text-steel">{t(s.flexDays > 1 ? "rp.flex.days" : "rp.flex.day", { n: s.flexDays })}</span> : <span className="block text-caption text-steel">{t("rp.exactDate")}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div>
        <p className="cap mb-1.5">{t("rp.routingPrefs")}</p>
        <div className="flex flex-wrap gap-1.5">{preferenceChips(d.query.preferences, t).map((c) => <Chip key={c.label} tone={c.tone}>{c.label}</Chip>)}</div>
      </div>

      {brief.length > 0 && (
        <div>
          <p className="cap mb-1.5">{t("rp.brief")}</p>
          <Facts rows={brief} />
        </div>
      )}

      {d.customerNote && (
        <figure className="rounded-lg border-s-4 border-orange bg-surface-raised px-3 py-2">
          <figcaption className="cap mb-0.5">{t("rp.customerNote")}</figcaption>
          <blockquote className="text-body text-ink" dir="auto">{d.customerNote}</blockquote>
        </figure>
      )}
    </div>
  )
}
