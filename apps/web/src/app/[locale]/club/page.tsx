"use client"

import { useQuery } from "@tanstack/react-query"
import { Star } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { CustomerClubView } from "@unitravel/contracts"
import { EmptyState, ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { ctaClass, PortalSection } from "@/components/portal/parts"
import { PortalTitle, useNum } from "@/components/portal/shell"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface PointsMove { id: string; kind: "GRANTED" | "DEDUCTED"; delta: number; note: string | null; createdAt: string }
interface Points { balance: number; history: PointsMove[] }

/** Points arrive from the club API when it exposes them (ADR-0039); until the field exists at runtime nothing about points is shown. */
function readPoints(c: unknown): Points | null {
  const p = (c as { points?: unknown } | null)?.points
  if (!p || typeof p !== "object") return null
  const o = p as { balance?: unknown; history?: unknown }
  if (typeof o.balance !== "number") return null
  const history = (Array.isArray(o.history) ? o.history : []).filter((m): m is PointsMove => !!m && typeof m === "object" && typeof (m as PointsMove).id === "string" && ((m as PointsMove).kind === "GRANTED" || (m as PointsMove).kind === "DEDUCTED") && typeof (m as PointsMove).delta === "number" && typeof (m as PointsMove).createdAt === "string")
  return { balance: o.balance, history }
}

/** Customer club (ADR-0016): read-only. The customer sees tier, benefits, credit and points; only staff add members or change points. */
export default function ClubPage() {
  const { t, date, money, locale, sep, href } = useI18n()
  const fmt = useNum()
  const path = usePathname()
  const { me, loading } = useSession()
  const q = useQuery({ queryKey: ["club"], queryFn: () => api<CustomerClubView>("/v1/me/club"), enabled: !!me })
  const c = q.data
  const off = c?.enabled === false
  const points = readPoints(c)
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString(locale === "fa" ? "fa-IR" : "en")}`
  return (
    <div className={me ? "" : "mx-auto max-w-3xl px-4 py-8 md:py-10"}>
      <PortalTitle title={t("club.title")} />
      {(loading || (!!me && q.isLoading)) && <LoadingState label={t("common.loading")} rows={2} />}
      {!loading && !me && <EmptyState icon={<Star />} title={t("club.signInPrompt")} action={<Link href={href(`/sign-in?next=${encodeURIComponent(path)}`)} className="btn-orange mt-2 inline-flex">{t("club.signInCta")}</Link>} />}
      {off && <EmptyState icon={<Star />} title={t("club.unavailable")} />}
      {q.isError && <ErrorState title={t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {c && !off && !c.member && (
        <PortalSection id="nm-h" title={t("portal.club2.nonMemberTitle")}>
          <div data-testid="club-non-member">
            <p className="max-w-2xl leading-7">{t("portal.club2.nonMemberBody")}</p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-(color:--ink-muted)">{t("club.howItWorks")}</p>
            <Link href={href("/support")} className={`${ctaClass} mt-4`}>{t("portal.club2.contact")}</Link>
          </div>
        </PortalSection>
      )}
      {c?.member && !off && (
        <div className="space-y-6" data-testid="club-member">
          <section className="portal-card flex flex-wrap items-center gap-5 p-6" aria-label={t("portal.club2.status")}>
            <span aria-hidden className="grid size-14 place-items-center rounded-full bg-orange text-navy-950"><Star className="size-7" /></span>
            <dl className="grid flex-1 gap-4 sm:grid-cols-2">
              <div><dt className="text-sm text-(color:--ink-muted)">{t("club.level")}</dt><dd className="font-display text-2xl">{locale === "fa" ? c.member.tier.nameFa : c.member.tier.nameEn}</dd></div>
              <div><dt className="text-sm text-(color:--ink-muted)">{t("portal.club2.status")}</dt><dd className="text-lg font-semibold">{c.member.status === "ACTIVE" ? t("portal.club2.active") : t("portal.club2.SUSPENDED")}</dd></div>
            </dl>
            <p className="w-full text-sm text-(color:--ink-muted)">{t("club.since", { date: date(c.member.joinedAt, { dateOnly: true, year: true }) })}</p>
          </section>
          {c.member.status === "SUSPENDED" && <p role="status" className="rounded-xl border border-warning-border bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-fg">{t("club.suspended")}</p>}
          {(c.creditBalance.length > 0 || points) && (
            <div className="grid gap-6 md:grid-cols-2">
              {c.creditBalance.length > 0 && (
                <PortalSection id="cr-h" title={t("club.credit")}>
                  <p className="text-2xl font-bold tabular-nums">{c.creditBalance.map((m) => money(m)).join(sep)}</p>
                  <p className="mt-2 text-sm text-(color:--ink-muted)">{t("club.creditNote")}</p>
                </PortalSection>
              )}
              {points && (
                <PortalSection id="pt-h" title={t("portal.club2.pointsTitle")}>
                  <p className="text-sm text-(color:--ink-muted)">{t("portal.club2.pointsBalance")}</p>
                  <p className="text-2xl font-bold tabular-nums" data-testid="club-points">{fmt(points.balance)}</p>
                </PortalSection>
              )}
            </div>
          )}
          {points && (
            <PortalSection id="ph-h" title={t("portal.club2.history")}>
              {!points.history.length && <p className="text-sm text-(color:--ink-muted)">{t("portal.club2.historyNone")}</p>}
              <ul className="divide-y divide-(--rule)" data-testid="club-points-history">
                {points.history.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-semibold">{t(`portal.club2.${m.kind}`)}</p>
                      {m.note && <p className="text-sm" dir="auto"><span className="text-(color:--ink-muted)">{t("portal.club2.note")}: </span>{m.note}</p>}
                      <p className="text-xs text-(color:--ink-muted)">{date(m.createdAt, { withTime: true })}</p>
                    </div>
                    <Ltr className="shrink-0 font-semibold tabular-nums">{signed(m.delta)}</Ltr>
                  </li>
                ))}
              </ul>
            </PortalSection>
          )}
          <PortalSection id="bn-h" title={t("club.benefits")}>
            {!c.benefits.length && <p className="text-sm text-(color:--ink-muted)">{t("club.noBenefits")}</p>}
            <ul className="space-y-3">
              {c.benefits.map((b) => (
                <li key={b.id} className="rounded-xl border border-(--rule-strong) p-4">
                  <p className="font-semibold">{b.kind === "DISCOUNT_PERCENT" ? t("club.percent", { value: b.value }) : b.kind === "DISCOUNT_FIXED" && b.currency ? t("club.fixed", { amount: money({ amountMinor: b.value, currency: b.currency }) }) : b.kind === "BONUS_CREDIT" ? t("club.credit") : t("club.perk")}</p>
                  <p className="text-sm"><Auto>{locale === "fa" ? b.description.fa : b.description.en}</Auto></p>
                  <p className="mt-1 text-xs text-(color:--ink-muted)">{t(`club.appliesTo.${b.appliesTo}`)}{sep}{t("club.validUntil", { date: date(b.validTo, { dateOnly: true, year: true }) })}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-(color:--ink-muted)">{t("club.howItWorks")}</p>
          </PortalSection>
        </div>
      )}
    </div>
  )
}
