"use client"

import { Inbox, Menu, Plane, Package, UserRound, X } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

export function Logo({ className = "" }: { className?: string }) {
  const { locale } = useI18n()
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <circle cx="16" cy="16" r="15" fill="#13263f" />
        <path d="M7 21 C 11 9, 21 9, 25 13" stroke="#c98d5b" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="7" cy="21" r="2.2" fill="#fbf9f5" /><circle cx="25" cy="13" r="2.2" fill="#c98d5b" />
      </svg>
      <span className="font-display text-lg tracking-tight">{locale === "fa" ? "یونی‌تراول" : "Uni Travel"}</span>
    </span>
  )
}

export function Header() {
  const { t, href, locale } = useI18n()
  const { me } = useSession()
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const other = locale === "en" ? "fa" : "en"
  const switchTo = `/${other}${path.replace(/^\/(en|fa)/, "")}`
  const links = [
    { href: href("/"), label: t("nav.search"), icon: Plane },
    { href: href("/cargo"), label: t("nav.cargo"), icon: Package },
    { href: href("/requests"), label: t("nav.requests"), icon: UserRound },
  ]
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Link href={href("/")} aria-label="Uni Travel home"><Logo /></Link>
        <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Main">
          {links.map((l) => <Link key={l.href} href={l.href} className={`hover:text-copper-700 ${path === l.href ? "text-copper-700 font-medium" : ""}`}>{l.label}</Link>)}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link href={switchTo} hrefLang={other} className="rounded-md px-2 py-1 hover:bg-muted" lang={other}>{t("nav.language")}</Link>
          {me ? (
            <>
              <Link href={href("/inbox")} aria-label={t("nav.inbox")} className="rounded-md p-2 hover:bg-muted"><Inbox className="size-4" /></Link>
              <Link href={href("/account")} className="hidden rounded-md px-3 py-1.5 hover:bg-muted sm:inline">{me.displayName}</Link>
            </>
          ) : (
            <Link href={href(`/sign-in?next=${encodeURIComponent(path)}`)} className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground hover:bg-deep">{t("nav.signIn")}</Link>
          )}
          <button className="rounded-md p-2 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border px-4 py-3 md:hidden" aria-label="Mobile">
          {[...links, ...(me ? [{ href: href("/inbox"), label: t("nav.inbox"), icon: Inbox }, { href: href("/account"), label: t("nav.account"), icon: UserRound }] : [])].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center gap-3 py-2.5"><l.icon className="size-4 text-copper-700" />{l.label}</Link>
          ))}
        </nav>
      )}
    </header>
  )
}

export function Footer() {
  const { t, href } = useI18n()
  return (
    <footer className="mt-16 border-t border-border bg-sand">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm text-slate md:grid-cols-3">
        <div><Logo className="text-ink" /><p className="mt-3 max-w-xs">{t("brand.tagline")}</p></div>
        <p className="max-w-sm">{t("footer.notAtol")}</p>
        <div className="flex flex-col gap-2 md:items-end">
          <Link href={href("/terms")} className="hover:text-ink">{t("footer.terms")}</Link>
          <Link href={href("/privacy")} className="hover:text-ink">{t("footer.privacy")}</Link>
          <span>{t("footer.company")}</span>
        </div>
      </div>
    </footer>
  )
}
