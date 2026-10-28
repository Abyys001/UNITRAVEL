"use client"

import { useQuery } from "@tanstack/react-query"
import { Star } from "lucide-react"

import type { CustomerClubView } from "@unitravel/contracts"
import { EmptyState, ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto } from "@/components/badges"
import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

/** Customer club (ADR-0016): the customer's tier, usable benefits and credit. Amounts reach money only on a staff-built quote. */
export default function ClubPage() {
  const { t, date, money, locale, sep } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["club"], queryFn: () => api<CustomerClubView>("/v1/me/club"), enabled: !!me })
  const off = q.data?.enabled === false
  const c = q.data
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("club.title")}</h1>
      {(q.isLoading || !me) && <LoadingState className="mt-6" label={t("common.loading")} rows={2} />}
      {off && <EmptyState className="mt-6" icon={<Star />} title={t("club.unavailable")} />}
      {q.isError && <ErrorState className="mt-6" title={t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {c && !off && !c.member && <EmptyState className="mt-6" icon={<Star />} title={t("club.notMember")} />}
      {c?.member && (
        <div className="mt-6 space-y-6" data-testid="club-member">
          <section className="card-brand flex items-center gap-4 p-6">
            <span className="grid size-12 place-items-center rounded-full bg-orange text-navy-950"><Star aria-hidden className="size-6" /></span>
            <div><p className="text-sm text-steel">{t("club.level")}</p><p className="font-display text-2xl">{locale === "fa" ? c.member.tier.nameFa : c.member.tier.nameEn}</p><p className="text-xs text-steel">{t("club.since", { date: date(c.member.joinedAt, { dateOnly: true, year: true }) })}</p></div>
          </section>
          {c.member.status === "SUSPENDED" && <p role="status" className="rounded-xl bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-fg">{t("club.suspended")}</p>}
          <section>
            <h2 className="font-display text-xl">{t("club.benefits")}</h2>
            {!c.benefits.length && <p className="mt-2 text-sm text-steel">{t("club.noBenefits")}</p>}
            <ul className="mt-3 space-y-2">
              {c.benefits.map((b) => (
                <li key={b.id} className="card-brand p-4">
                  <p className="font-semibold">{b.kind === "DISCOUNT_PERCENT" ? t("club.percent", { value: b.value }) : b.kind === "DISCOUNT_FIXED" && b.currency ? t("club.fixed", { amount: money({ amountMinor: b.value, currency: b.currency }) }) : b.kind === "BONUS_CREDIT" ? t("club.credit") : t("club.perk")}</p>
                  <p className="text-sm"><Auto>{locale === "fa" ? b.description.fa : b.description.en}</Auto></p>
                  <p className="mt-1 text-xs text-steel">{t(`club.appliesTo.${b.appliesTo}`)}{sep}{t("club.validUntil", { date: date(b.validTo, { dateOnly: true, year: true }) })}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-steel">{t("club.howItWorks")}</p>
          </section>
          {c.creditBalance.length > 0 && (
            <section className="card-brand p-5">
              <h2 className="font-display text-xl">{t("club.credit")}</h2>
              <p className="mt-2 text-2xl font-bold tabular-nums">{c.creditBalance.map((m) => money(m)).join(sep)}</p>
              <p className="mt-2 text-sm text-steel">{t("club.creditNote")}</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
