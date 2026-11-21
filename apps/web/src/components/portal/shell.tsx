"use client"

import { Bell, ClipboardList, LayoutDashboard, LifeBuoy, type LucideIcon, ReceiptText, SearchCheck, Star, Ticket, Truck, UserRound } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { useI18n } from "@/lib/i18n"
import { useUnread } from "@/lib/portal-api"
import { useSession } from "@/lib/session"
import { useSite } from "@/lib/site"

interface NavItem { to: string; label: string; icon: LucideIcon; also?: string[] }

/** Locale digits, never capped: balances, weights and counts of things. */
export function useNum() {
  const { locale } = useI18n()
  return (n: number) => n.toLocaleString(locale === "fa" ? "fa-IR" : "en")
}

/** Badge number formatted for the locale and capped, so a long count never breaks the bar. */
export function useCount() {
  const { locale, t } = useI18n()
  return (n: number) => (n > 99 ? t("portal.more") : n.toLocaleString(locale === "fa" ? "fa-IR" : "en"))
}

/** A count as text in a pill: the number is the signal, colour is only emphasis (WCAG 1.4.1). */
function Badge({ n, label }: { n: number; label: string }) {
  const fmt = useCount()
  if (n <= 0) return null
  return (
    <>
      <span aria-hidden className="ms-1 inline-flex min-w-5 items-center justify-center rounded-full bg-orange-700 px-1.5 text-xs font-bold leading-5 text-white">{fmt(n)}</span>
      <span className="sr-only">{label}</span>
    </>
  )
}

/**
 * Frame for every signed-in customer page (ADR-0040 D8): sticky bar with inbox and support badges, a side rail from 1024 px and a
 * scrolling tab bar below. Content surfaces are solid (`[data-portal]` in the UI styles). `optional` pages (track, support, club) are public:
 * they render bare until a session exists.
 */
export function PortalShell({ children, optional = false }: { children: ReactNode; optional?: boolean }) {
  const { t, href, locale } = useI18n()
  const path = usePathname()
  const { me, loading } = useSession()
  const { on } = useSite()
  const unread = useUnread()
  if (optional && !loading && !me) return <>{children}</>
  const nav: NavItem[] = [
    { to: "/dashboard", label: t("portal.dashboard"), icon: LayoutDashboard },
    { to: "/requests", label: t("nav.requests"), icon: ClipboardList, also: ["/services"] },
    { to: "/track", label: t("nav.track"), icon: SearchCheck },
    ...(on("cargo") ? [{ to: "/shipments", label: t("nav.shipments"), icon: Truck, also: ["/cargo"] }] : []),
    { to: "/inbox", label: t("nav.inbox"), icon: Bell },
    { to: "/support", label: t("nav.support"), icon: LifeBuoy },
    ...(on("club") ? [{ to: "/club", label: t("nav.club"), icon: Star }] : []),
    { to: "/billing", label: t("nav.billing"), icon: ReceiptText },
    { to: "/account/tickets", label: t("nav.tickets"), icon: Ticket },
    { to: "/account", label: t("nav.account"), icon: UserRound },
  ]
  const rest = path.replace(/^\/(en|fa)(?=\/|$)/, "") || "/"
  const hit = (p: string) => rest === p || rest.startsWith(`${p}/`)
  // Longest match wins, so /account/tickets does not also light up /account.
  const current = nav.flatMap((n) => [n.to, ...(n.also ?? [])].filter(hit).map((p) => ({ to: n.to, len: p.length }))).sort((a, b) => b.len - a.len)[0]?.to
  const fmt = (n: number) => n.toLocaleString(locale === "fa" ? "fa-IR" : "en")
  const barLink = "relative inline-flex h-10 items-center gap-1.5 rounded-full border border-(--rule-strong) bg-(--surface-raised) px-3 text-sm font-semibold text-(color:--ink) hover:bg-(--hover) pointer-coarse:min-h-11"
  return (
    <div data-portal className="bg-(--surface) text-(color:--ink)">
      <div className="sticky top-14 z-30 border-b border-(--rule-strong) bg-(--surface-raised) lg:top-16">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t("portal.barTitle")}{me && <span className="font-normal text-(color:--ink-muted)"> · <bdi dir="auto">{me.displayName}</bdi></span>}</p>
          <Link href={href("/inbox")} className={barLink}><Bell aria-hidden className="size-4" /><span className="max-sm:sr-only">{t("nav.inbox")}</span><Badge n={unread.inbox} label={t("portal.unreadCount", { n: fmt(unread.inbox) })} /></Link>
          <Link href={href("/support")} className={barLink}><LifeBuoy aria-hidden className="size-4" /><span className="max-sm:sr-only">{t("nav.support")}</span><Badge n={unread.support} label={t("portal.unreadCount", { n: fmt(unread.support) })} /></Link>
          <span role="status" className="sr-only">{unread.inbox > 0 ? `${t("nav.inbox")}: ${t("portal.unreadCount", { n: fmt(unread.inbox) })}` : ""}</span>
        </div>
        <nav aria-label={t("portal.sectionNav")} className="border-t border-(--rule) lg:hidden">
          <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1.5">
            {nav.map((n) => {
              const active = n.to === current
              return (
                <li key={n.to} className="shrink-0">
                  <Link href={href(n.to)} aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold pointer-coarse:min-h-11 ${active ? "bg-(--ink) text-white" : "text-(color:--ink) hover:bg-(--hover)"}`}><n.icon aria-hidden className="size-4" />{n.label}</Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-8">
        <nav aria-label={t("portal.sectionNav")} className="hidden lg:sticky lg:top-36 lg:block lg:self-start">
          <ul className="space-y-1">
            {nav.map((n) => {
              const active = n.to === current
              return (
                <li key={n.to}>
                  <Link href={href(n.to)} aria-current={active ? "page" : undefined} className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${active ? "bg-(--surface-raised) text-(color:--ink) ring-1 ring-(--rule-strong) before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-orange" : "text-(color:--ink-muted) hover:bg-(--hover) hover:text-(color:--ink)"}`}>
                    <n.icon aria-hidden className="size-4" />{n.label}
                    {(n.to === "/inbox" ? unread.inbox : n.to === "/support" ? unread.support : 0) > 0 && <span aria-hidden className="ms-auto size-2 rounded-full bg-orange-700" />}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}

/** Page heading used inside the shell. */
export function PortalTitle({ title, lead, action }: { title: string; lead?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
        {lead && <p className="mt-2 max-w-2xl text-(color:--ink-muted)">{lead}</p>}
      </div>
      {action}
    </header>
  )
}

