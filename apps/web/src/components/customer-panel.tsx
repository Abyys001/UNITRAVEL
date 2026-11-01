"use client"

import { Bell, ClipboardList, LifeBuoy, ReceiptText, UserRound } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"

import { useI18n } from "@/lib/i18n"

/** Section frame for the signed-in customer area: a sidebar from md up, a scrolling pill bar on phones. `enabled=false` renders the children bare (public pages). */
export function PanelFrame({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { t, href } = useI18n()
  const path = usePathname()
  if (!enabled) return <>{children}</>
  const nav = [
    { to: "/requests", label: t("nav.requests"), icon: ClipboardList },
    { to: "/billing", label: t("nav.billing"), icon: ReceiptText },
    { to: "/inbox", label: t("nav.inbox"), icon: Bell },
    { to: "/support", label: t("nav.support"), icon: LifeBuoy },
    { to: "/account", label: t("nav.account"), icon: UserRound },
  ]
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:grid-cols-[13rem_1fr] md:py-10">
      <nav aria-label={t("panel.nav")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:sticky md:top-24 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0">
        {nav.map((n) => {
          const active = path.includes(n.to)
          return (
            <Link key={n.to} href={href(n.to)} aria-current={active ? "page" : undefined} className={`inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition-colors pointer-coarse:min-h-11 md:rounded-xl ${active ? "bg-navy-950 text-white shadow-md" : "bg-white/70 text-navy-900 ring-1 ring-line hover:bg-cloud"}`}>
              <n.icon className="size-4" aria-hidden />{n.label}
            </Link>
          )
        })}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function PanelShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <PanelFrame>
      <h1 className="font-display text-3xl md:text-4xl">{title}</h1>
      {lead && <p className="mt-2 max-w-2xl text-steel">{lead}</p>}
      {children}
    </PanelFrame>
  )
}

export function Stat({ label, value, tone = "default", icon }: { label: string; value: number; tone?: "default" | "orange" | "royal"; icon: ReactNode }) {
  const bar = { default: "bg-navy-900", orange: "bg-orange", royal: "bg-royal" }[tone]
  return (
    <div className="card-brand relative overflow-hidden p-4">
      <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${bar}`} />
      <div className="flex items-center justify-between text-steel"><span className="text-xs font-semibold uppercase tracking-wider">{label}</span><span aria-hidden>{icon}</span></div>
      <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
    </div>
  )
}
