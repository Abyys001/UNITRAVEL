"use client"

import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CircleCheck, LifeBuoy, Star } from "lucide-react"
import Link from "next/link"

import type { PendingAction, PortalItem, PortalOverview, PurchaseItem } from "@unitravel/contracts"
import { ErrorState, LoadingState } from "@unitravel/ui/product/states"

import { Auto, Ltr } from "@/components/badges"
import { ctaClass, linkClass, PortalSection, requestPath, StatusPill, StepProgress, TravelCardTile } from "@/components/portal/parts"
import { useNum } from "@/components/portal/shell"
import { useI18n } from "@/lib/i18n"
import { fetchOverview, trackPath } from "@/lib/portal-api"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

const actionPath = (a: PendingAction) =>
  a.kind === "PAY_INVOICE" && a.ref ? `/billing/${a.ref}` : a.kind === "SUPPORT_REPLY" && a.ref ? `/support/${a.ref}` : a.kind === "COMPLETE_PROFILE" ? "/account/details" : a.ref ? requestPath(a.ref) : "/requests"
const purchasePath = (p: PurchaseItem) => (p.kind === "INVOICE_PAID" ? `/billing/${p.ref}` : trackPath(p.ref))
const missingPath = (code: string) => (code === "EMAIL" || code === "PHONE" ? "/account" : "/account/details")

function Row({ item, showSteps }: { item: PortalItem; showSteps: boolean }) {
  const { t, href, date, sep } = useI18n()
  return (
    <li className="py-4 first:pt-0 last:pb-0" data-testid="portal-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={href(requestPath(item.ref))} className="font-semibold text-(color:--ink) underline-offset-4 hover:underline"><Auto>{item.title}</Auto></Link>
          <p className="text-xs text-(color:--ink-muted)"><Ltr className="font-mono">{item.ref}</Ltr>{sep}{t("portal.updated", { date: date(item.updatedAt, { dateOnly: true }) })}</p>
        </div>
        <StatusPill>{item.statusLabel}</StatusPill>
      </div>
      {showSteps && item.steps.length > 0 && <div className="mt-3"><StepProgress steps={item.steps} title={item.title} /></div>}
      {showSteps && item.nextStep && <p className="mt-2 text-sm"><span className="font-semibold">{t("portal.nextStep")}:</span> <Auto>{item.nextStep}</Auto></p>}
      {showSteps && <p className="mt-2 text-sm"><Link href={href(trackPath(item.ref))} className={linkClass}>{t("portal.active.track")}</Link></p>}
    </li>
  )
}

export default function DashboardPage() {
  const { t, href, date, money, locale, sep } = useI18n()
  const fmt = useNum()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["overview"], queryFn: fetchOverview, enabled: !!me, refetchInterval: 60_000 })
  const o: PortalOverview | undefined = q.data
  const name = o?.profile.name ?? me?.displayName
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl md:text-4xl">{name ? t("portal.greeting", { name }) : t("portal.greetingAnon")}</h1>
        {o && <p className="mt-1 text-sm text-(color:--ink-muted)">{t("portal.memberSince", { date: date(o.profile.memberSince, { dateOnly: true, year: true }) })}</p>}
      </header>
      {q.isLoading && <LoadingState label={t("common.loading")} rows={4} />}
      {q.isError && <ErrorState title={t("common.error")} retryLabel={t("common.retry")} onRetry={() => void q.refetch()} />}
      {o && (
        <>
          {o.profile.missing.length > 0 ? (
            <PortalSection id="acct-h" title={t("portal.account.title")} action={<Link href={href("/account")} className={linkClass}>{t("portal.account.manage")}</Link>}>
              <p className="text-sm font-semibold">{t("portal.account.missingTitle")}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {o.profile.missing.map((m) => <li key={m}><Link href={href(missingPath(m))} className={`${ctaClass} !py-1.5`}>{t(`portal.account.missing.${m as "NAME"}`)}<ArrowRight aria-hidden className="ms-2 size-4 rtl:rotate-180" /></Link></li>)}
              </ul>
            </PortalSection>
          ) : (
            <p className="flex items-center gap-2 text-sm text-(color:--ink-muted)"><CircleCheck aria-hidden className="size-4 text-success" />{t("portal.account.complete")} <Link href={href("/account")} className={linkClass}>{t("portal.account.manage")}</Link></p>
          )}

          <PortalSection id="pending-h" title={t("portal.pending.title")} tone={o.pendingActions.length ? "urgent" : "default"}>
            {!o.pendingActions.length && <p className="text-sm text-(color:--ink-muted)"><span className="font-semibold text-(color:--ink)">{t("portal.pending.none")}</span> {t("portal.pending.noneBody")}</p>}
            <ul className="divide-y divide-(--rule)" data-testid="pending-actions">
              {o.pendingActions.map((a, i) => (
                <li key={`${a.kind}:${a.ref ?? i}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-semibold"><Auto>{a.label}</Auto></p>
                    <p className="text-sm text-(color:--ink-muted)">{a.dueAt ? t("portal.pending.due", { date: date(a.dueAt, { withTime: true }) }) : t("portal.pending.noDue")}{a.ref && <>{sep}<Ltr className="font-mono">{a.ref}</Ltr></>}</p>
                  </div>
                  <Link href={href(actionPath(a))} className="btn-orange !px-4 !py-2 text-sm">{t("portal.open")}<span className="sr-only">: {a.label}</span></Link>
                </li>
              ))}
            </ul>
          </PortalSection>

          <PortalSection id="active-h" title={t("portal.active.title")} action={<Link href={href("/requests")} className={linkClass}>{t("portal.viewAll")}</Link>}>
            {!o.active.length ? (
              <div><p className="font-semibold">{t("portal.active.none")}</p><p className="mt-1 text-sm text-(color:--ink-muted)">{t("portal.active.noneBody")}</p><Link href={href("/")} className={`${ctaClass} mt-3`}>{t("portal.active.cta")}</Link></div>
            ) : <ul className="divide-y divide-(--rule)">{o.active.map((i) => <Row key={`${i.kind}:${i.ref}`} item={i} showSteps />)}</ul>}
          </PortalSection>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <PortalSection id="buy-h" title={t("portal.purchases.title")} action={<Link href={href("/billing")} className={linkClass}>{t("portal.viewAll")}</Link>}>
              {!o.purchases.length && <p className="text-sm text-(color:--ink-muted)">{t("portal.purchases.none")}</p>}
              <ul className="divide-y divide-(--rule)">
                {o.purchases.map((p) => (
                  <li key={`${p.kind}:${p.ref}`} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={href(purchasePath(p))} className="font-semibold underline-offset-4 hover:underline"><Auto>{p.title}</Auto></Link>
                      <p className="text-xs text-(color:--ink-muted)">{t(`portal.purchases.${p.kind}`)}{sep}<Ltr className="font-mono">{p.ref}</Ltr>{sep}{date(p.at, { dateOnly: true })}</p>
                    </div>
                    {p.amount && <span className="shrink-0 font-semibold tabular-nums">{money(p.amount)}</span>}
                  </li>
                ))}
              </ul>
            </PortalSection>

            <PortalSection id="msg-h" title={t("portal.notifications.title")} action={<Link href={href("/inbox")} className={linkClass}>{t("portal.notifications.openInbox")}</Link>}>
              {!o.notifications.length && <p className="text-sm text-(color:--ink-muted)">{t("portal.notifications.none")}</p>}
              <ul className="divide-y divide-(--rule)">
                {o.notifications.map((n) => (
                  <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                    <Link href={href(`/inbox?m=${n.id}`)} className="block">
                      <p className={`flex items-center gap-2 ${n.readAt ? "" : "font-bold"}`}>
                        {!n.readAt && <><span aria-hidden className="size-2 shrink-0 rounded-full bg-orange-700" /><span className="sr-only">{t("portal.inbox.unread")}: </span></>}
                        <Auto>{n.title}</Auto>
                      </p>
                      <p className="text-xs text-(color:--ink-muted)">{date(n.createdAt, { withTime: true })}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </PortalSection>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <PortalSection id="sup-h" title={t("portal.support.title")}>
              <p className="flex items-center gap-2 text-sm"><LifeBuoy aria-hidden className="size-4" />{o.counts.openSupport ? t("portal.support.open", { n: fmt(o.counts.openSupport) }) : t("portal.support.none")}{o.counts.unreadSupport > 0 && <span className="rounded-full border border-orange-700 px-2 py-0.5 text-xs font-bold text-orange-700">{t("portal.support.unreadReplies", { n: fmt(o.counts.unreadSupport) })}</span>}</p>
              <ul className="mt-3 divide-y divide-(--rule)">
                {o.support.map((k) => (
                  <li key={k.ref}>
                    <Link href={href(`/support/${k.ref}`)} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0"><span className={`block truncate ${k.unread ? "font-bold" : "font-semibold"}`} dir="auto">{k.subject}</span><Ltr className="font-mono text-xs text-(color:--ink-muted)">{k.ref}</Ltr></span>
                      <span className="flex shrink-0 items-center gap-2">{k.unread && <span className="text-xs font-bold text-orange-700">{t("portal.support.unread")}</span>}<StatusPill>{t(`support.status.${k.status}`)}</StatusPill></span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={href("/support")} className={`${ctaClass} mt-4`}>{t("portal.support.cta")}</Link>
            </PortalSection>

            {o.club?.enabled && (
              <PortalSection id="club-h" title={t("portal.club.title")} action={<Link href={href("/club")} className={linkClass}>{t("portal.club.view")}</Link>}>
                {o.club.member ? (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div><dt className="text-(color:--ink-muted)">{t("portal.club.level")}</dt><dd className="flex items-center gap-1.5 font-display text-lg"><Star aria-hidden className="size-4 text-orange-700" />{locale === "fa" ? o.club.member.tierNameFa : o.club.member.tierNameEn}</dd></div>
                    <div><dt className="text-(color:--ink-muted)">{t("portal.club2.status")}</dt><dd className="font-semibold">{o.club.member.status === "ACTIVE" ? t("portal.club2.active") : t("portal.club2.SUSPENDED")}</dd></div>
                    {o.club.creditBalance.length > 0 && <div><dt className="text-(color:--ink-muted)">{t("portal.club.credit")}</dt><dd className="font-semibold tabular-nums">{o.club.creditBalance.map((m) => money(m)).join(sep)}</dd></div>}
                    {o.club.points !== null && <div><dt className="text-(color:--ink-muted)">{t("portal.club.points")}</dt><dd className="font-semibold tabular-nums">{fmt(o.club.points)}</dd></div>}
                  </dl>
                ) : <p className="text-sm leading-6 text-(color:--ink-muted)">{t("portal.club.notMember")}</p>}
              </PortalSection>
            )}
          </div>

          <TravelCardTile status={o.travelCard.status} />

          <PortalSection id="prev-h" title={t("portal.previous.title")}>
            {!o.previous.length ? <p className="text-sm text-(color:--ink-muted)">{t("portal.previous.none")}</p> : <ul className="divide-y divide-(--rule)">{o.previous.map((i) => <Row key={`${i.kind}:${i.ref}`} item={i} showSteps={false} />)}</ul>}
          </PortalSection>
        </>
      )}
    </div>
  )
}
