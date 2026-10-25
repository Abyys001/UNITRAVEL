"use client"

import { ClipboardList, Inbox, Menu, Plane, Package, ReceiptText, Truck, UserRound, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef, useState } from "react"

import { Ribbon } from "@unitravel/ui/brand/art"
import { Logo as BrandLogo } from "@unitravel/ui/brand/logo"

import { useI18n } from "@/lib/i18n"
import { useSession } from "@/lib/session"

export function Logo({ className = "", tone = "onDark" }: { className?: string; tone?: "onDark" | "onLight" }) {
  return <BrandLogo tone={tone} size={38} className={className} />
}

/** Same page in the other language: path and query (search, itinerary and request state live there) are kept. */
function LanguageLink({ other, path, label, query = "" }: { other: "en" | "fa"; path: string; label: string; query?: string }) {
  return <Link href={`/${other}${path.replace(/^\/(en|fa)/, "")}${query ? `?${query}` : ""}`} hrefLang={other} className="inline-flex items-center whitespace-nowrap rounded-full px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white pointer-coarse:min-h-11" lang={other}>{label}</Link>
}

function LanguageLinkWithQuery(props: { other: "en" | "fa"; path: string; label: string }) {
  return <LanguageLink {...props} query={useSearchParams().toString()} />
}

export function Header() {
  const { t, href, locale } = useI18n()
  const { me } = useSession()
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)
  const home = /^\/(en|fa)\/?$/.test(path)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>("a")?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(false)
      menuBtn.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  const other = locale === "en" ? "fa" : "en"
  const links = [
    { href: href("/"), label: t("nav.search"), icon: Plane },
    { href: href("/cargo"), label: t("nav.cargo"), icon: Package },
    { href: href("/shipments"), label: t("nav.shipments"), icon: Truck },
    { href: href("/requests"), label: t("nav.requests"), icon: ClipboardList },
    ...(me ? [{ href: href("/billing"), label: t("nav.billing"), icon: ReceiptText }] : []),
  ]
  // Over the home hero the bar starts transparent; everywhere else (and once scrolled) it is solid navy glass.
  const solid = !home || scrolled || open
  return (
    <>
      <header className={`${home ? "fixed inset-x-0" : "sticky"} top-0 z-40 text-white transition-[background-color,box-shadow] duration-300 ${solid ? "bg-navy-950/92 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.6)] backdrop-blur-md" : "bg-transparent"}`}>
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-2 px-4 min-[400px]:gap-4 md:px-6">
          <Link href={href("/")} aria-label="Uni Travel home" className="shrink-0 rounded-lg">
            <BrandLogo variant="mark" tone="onDark" size={38} className="min-[400px]:hidden" />
            <Logo className="hidden min-[400px]:inline-flex" />
          </Link>
          <nav className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 text-sm font-semibold lg:flex" aria-label="Main">
            {links.map((l) => {
              const active = path === l.href
              return <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={`rounded-full px-4 py-2 transition-colors ${active ? "bg-white text-navy-950" : "text-white/85 hover:bg-white/10 hover:text-white"}`}>{l.label}</Link>
            })}
          </nav>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Suspense fallback={<LanguageLink other={other} path={path} label={t("nav.language")} />}><LanguageLinkWithQuery other={other} path={path} label={t("nav.language")} /></Suspense>
            {me ? (
              <>
                <Link href={href("/inbox")} aria-label={t("nav.inbox")} className="inline-flex items-center justify-center rounded-full p-2.5 hover:bg-white/10 pointer-coarse:min-h-11 pointer-coarse:min-w-11"><Inbox className="size-4" /></Link>
                <Link href={href("/account")} className="btn-glass hidden max-w-44 !py-2 sm:inline-flex"><span className="truncate">{me.displayName}</span></Link>
              </>
            ) : (
              <Link href={href(`/sign-in?next=${encodeURIComponent(path)}`)} className="btn-orange whitespace-nowrap !rounded-full !px-5 !py-2 pointer-coarse:min-h-11">{t("nav.signIn")}</Link>
            )}
            <button ref={menuBtn} className="inline-flex items-center justify-center rounded-full p-2.5 hover:bg-white/10 pointer-coarse:min-h-11 pointer-coarse:min-w-11 lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          </div>
        </div>
        {open && (
          <nav ref={menuRef} className="border-t border-white/10 px-4 pb-4 pt-2 lg:hidden" aria-label="Mobile">
            {[...links, ...(me ? [{ href: href("/inbox"), label: t("nav.inbox"), icon: Inbox }, { href: href("/account"), label: t("nav.account"), icon: UserRound }] : [])].map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-3 font-semibold hover:bg-white/10"><span className="grid size-9 place-items-center rounded-full border-2 border-orange/80"><l.icon className="size-4" /></span>{l.label}</Link>
            ))}
          </nav>
        )}
      </header>
      {!home && (
        <div aria-hidden className="relative bg-brand">
          <div className="bg-dots h-6 md:h-8" />
          <Ribbon className="relative -mt-px" />
        </div>
      )}
    </>
  )
}

export function Footer() {
  const { t, href } = useI18n()
  return (
    <footer className="relative mt-20 overflow-hidden bg-navy-950 text-white/80">
      <Ribbon className="relative rotate-180" fill="var(--background)" />
      <div aria-hidden className="pointer-events-none absolute -end-32 top-48 size-[420px] rounded-full bg-royal/25 blur-3xl" />
      <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-8 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-6">
        <div>
          <Logo />
          <p className="mt-5 max-w-sm text-sm leading-relaxed">{t("brand.tagline")}</p>
          <p className="mt-5 max-w-sm border-s-2 border-orange ps-3 text-xs leading-relaxed text-white/65">{t("footer.notAtol")}</p>
        </div>
        <FooterCol title={t("footer.explore")} links={[[href("/"), t("nav.search")], [href("/cargo"), t("nav.cargo")], [href("/shipments"), t("nav.shipments")]]} />
        <FooterCol title={t("footer.help")} links={[[href("/requests"), t("nav.requests")], [href("/billing"), t("nav.billing")], [href("/inbox"), t("nav.inbox")]]} />
        <FooterCol title={t("footer.legal")} links={[[href("/terms"), t("footer.terms")], [href("/privacy"), t("footer.privacy")], [href("/credits"), t("footer.credits")]]} />
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-white/60 md:flex-row md:items-center md:px-6">
          <span>{t("footer.company")}</span>
          <span dir="ltr">unitravels.co.uk</span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-orange-300">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map(([h, l]) => <li key={h}><Link href={h} className="inline-flex items-center hover:text-white pointer-coarse:min-h-11">{l}</Link></li>)}
      </ul>
    </div>
  )
}
