"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Bell, ChevronRight, Circle, Ellipsis, LogOut, PanelLeftClose, PanelLeftOpen, Search, UserRound, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { Logo, LogoMark } from "@unitravel/ui/brand/logo"

import { api } from "@/lib/api"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import { useLive } from "@/lib/live"
import { applyPrefs, type Density, type Locale, type Theme, useDensity, useLocale, useRailCollapsed, useTheme } from "@/lib/prefs"
import { type Surface, useSession } from "@/lib/session"

import { CommandPalette, type PaletteItem } from "./command-palette"
import { StepUpProvider, TotpEnrol, TotpVerify } from "./mfa"

export function Brand({ surface, compact = false, tone = "onDark" }: { surface: Surface; compact?: boolean; tone?: "onDark" | "onLight" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {compact ? <LogoMark size={24} className="shrink-0" /> : <Logo variant="horizontal" tone={tone} size={26} />}
      {!compact && (
        <span className={cn("border-s ps-2.5 font-mono text-[11px] tracking-[0.14em] uppercase", tone === "onDark" ? "border-white/20 text-orange-300" : "border-navy-950/20 text-orange-700 dark:border-white/20 dark:text-orange-300")}>
          {surface === "dev" ? "Workshop" : "Admin"}
        </span>
      )}
    </span>
  )
}

export interface NavItem { href: string; label: string; count?: number | null; alert?: boolean; mobile?: boolean; icon?: React.ReactNode }
export interface NavSection { title: string; items: NavItem[] }
/** One line in the alerts bell, derived by the frame from data it already loads (queue summary / SSE). */
export interface ShellAlert { id: string; label: string; count: number; href: string; tone: "danger" | "warn" | "info" }

function isActive(pathname: string, search: string, href: string) {
  const [p, q] = href.split("?")
  if (p === "/") return pathname === "/"
  if (q) return pathname === p && search.includes(q)
  return pathname === p || pathname.startsWith(`${p}/`)
}

/** Modal behaviour shared by the help dialog and the phone "More" sheet: Esc closes, Tab stays inside, focus returns. */
function Modal({ label, onClose, children, className }: { label: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus()
    return () => back?.focus?.()
  }, [])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return }
    if (e.key !== "Tab") return
    const f = [...(ref.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])") ?? [])]
    if (!f.length) return
    const first = f[0]!, last = f[f.length - 1]!
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className="fixed inset-0 z-50 grid bg-navy-950/55 p-3 sm:place-items-center" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()} className={className}>{children}</div>
    </div>
  )
}

/** Small anchored popover (alerts bell, user menu): click outside or Esc closes, aria-expanded on the trigger. */
function Popover({ label, trigger, children, testId }: { label: string; trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus() } }
    document.addEventListener("mousedown", down)
    document.addEventListener("keydown", key)
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key) }
  }, [open])
  return (
    <div ref={root} className="relative">
      <button ref={btn} type="button" aria-haspopup="true" aria-expanded={open} aria-label={label} data-testid={testId} onClick={() => setOpen((o) => !o)} className="relative inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm px-1.5 text-white/80 hover:bg-white/10 hover:text-white">{trigger}</button>
      {open && <div className="absolute end-0 top-full z-40 mt-1.5 w-[min(19rem,calc(100vw-1.5rem))] rounded-lg border border-rule-strong bg-surface-raised p-2 text-ink shadow-2xl">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="px-1 py-1.5">
      <p className="cap mb-1">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-surface-sunk p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("min-h-8 rounded-[5px] px-2 text-[12px]", value === o.value ? "bg-surface-raised font-medium shadow-sm ring-1 ring-rule-strong" : "text-steel hover:text-ink")}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

const crumbText = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

function useCrumbs(pathname: string, search: string, sections: NavSection[], homeLabel: string) {
  return useMemo(() => {
    const crumbs: { label: string; href?: string; mono?: boolean }[] = [{ label: homeLabel, href: pathname === "/" ? undefined : "/" }]
    if (pathname === "/") return crumbs
    const flat = sections.flatMap((s) => s.items.map((i) => ({ s, i, p: i.href.split("?")[0]! })))
    const hit = flat.filter((x) => x.p !== "/" && isActive(pathname, search, x.i.href)).sort((a, b) => b.p.length - a.p.length)[0]
    const rest = pathname.split("/").filter(Boolean)
    if (hit) {
      crumbs.push({ label: hit.s.title })
      const tail = pathname.slice(hit.p.length).split("/").filter(Boolean)
      crumbs.push({ label: hit.i.label, href: tail.length ? hit.i.href : undefined })
      tail.forEach((seg, n) => crumbs.push({ label: crumbText(seg), mono: true, href: n < tail.length - 1 ? `${hit.p}/${tail.slice(0, n + 1).join("/")}` : undefined }))
    } else {
      rest.forEach((seg, n) => crumbs.push({ label: n === 0 ? crumbText(seg).replace(/^\w/, (c) => c.toUpperCase()) : crumbText(seg), mono: n > 0, href: n < rest.length - 1 ? `/${rest.slice(0, n + 1).join("/")}` : undefined }))
    }
    return crumbs
  }, [pathname, search, sections, homeLabel])
}

const SHORTCUTS: [string, MsgKey][] = [["⌘K · Ctrl K · /", "help.palette"], ["j / k", "help.next"], ["Enter", "help.open"], ["c", "help.claim"], ["n", "help.note"], ["m", "help.msg"], ["?", "help.help"]]

/**
 * Console frame ("Control deck"): a thin chrome bar (breadcrumbs, palette trigger, alerts bell, user menu), a collapsible
 * icon rail on desktop (state in html[data-rail], persisted) and a bottom bar plus "More" sheet on phones (mobile admin
 * mode, ch. 15.8). The dev host carries the hatched workshop strip on every screen.
 */
export function Shell({ surface, sections, children, onGoTo, goToHint, alerts }: { surface: Surface; sections: NavSection[]; children: React.ReactNode; onGoTo: (q: string) => string | null; goToHint: string; alerts?: ShellAlert[] }) {
  const { me } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const pathname = usePathname()
  const t = useT()
  const live = useLive()
  const [theme, setTheme] = useTheme()
  const [density, setDensity] = useDensity()
  const [locale, setLocale] = useLocale()
  const [collapsed, setCollapsed] = useRailCollapsed()
  const [search, setSearch] = useState("")
  const [help, setHelp] = useState(false)
  const [more, setMore] = useState(false)
  const [palette, setPalette] = useState(false)
  useEffect(() => { setSearch(window.location.search) }, [pathname])
  useEffect(() => { setMore(false) }, [pathname, search])
  useEffect(() => {
    const mql = matchMedia("(prefers-color-scheme: dark)")
    mql.addEventListener("change", applyPrefs)
    return () => mql.removeEventListener("change", applyPrefs)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
      if (e.key === "/") { e.preventDefault(); setPalette(true) }
      if (e.key === "?") setHelp((h) => !h)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const signOut = useCallback(async () => {
    try { await api("/v1/auth/logout", { method: "POST", body: {} }) } catch { /* the session may already be gone */ }
    qc.clear()
    router.replace("/sign-in")
  }, [qc, router])

  const themeName = (v: Theme) => t(`theme.${v}`)
  const densityName = (v: Density) => t(`density.${v}`)
  const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
  const items = useMemo<PaletteItem[]>(() => [
    ...sections.flatMap((s) => s.items.map((i) => ({ id: `nav:${i.href}`, label: i.label, group: s.title, icon: i.icon ?? <Circle className="size-3" />, hint: i.count ? String(i.count) : undefined, run: () => router.push(i.href) }))),
    { id: "act:theme", label: t("action.theme", { v: themeName(nextTheme) }), group: t("search.actions"), keywords: "dark light mode theme", run: () => setTheme(nextTheme) },
    { id: "act:density", label: t("action.density", { v: densityName(density === "compact" ? "comfortable" : "compact") }), group: t("search.actions"), keywords: "compact comfortable", run: () => setDensity(density === "compact" ? "comfortable" : "compact") },
    { id: "act:lang", label: t("action.language", { v: locale === "fa" ? t("lang.en") : t("lang.fa") }), group: t("search.actions"), keywords: "persian farsi english language", run: () => setLocale(locale === "fa" ? "en" : "fa") },
    { id: "act:help", label: t("action.shortcuts"), group: t("search.actions"), hint: "?", keywords: "keyboard help", run: () => setHelp(true) },
    { id: "act:signout", label: t("action.signout"), group: t("search.actions"), icon: <LogOut className="size-4" />, run: () => void signOut() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sections, t, router, theme, density, locale, signOut])
  const goTo = useCallback((q: string): PaletteItem | null => {
    const to = onGoTo(q)
    return to ? { id: "goto", label: t("search.go", { q }), group: t("search.actions"), icon: <Search className="size-4" />, run: () => router.push(to) } : null
  }, [onGoTo, router, t])

  const crumbs = useCrumbs(pathname, search, sections, surface === "dev" ? "Workshop" : t("crumb.home"))
  const mobileItems = sections.flatMap((s) => s.items).filter((i) => i.mobile)
  const alertTotal = (alerts ?? []).filter((a) => a.count > 0).length
  const chromeBtn = "inline-flex min-h-8 min-w-8 items-center justify-center rounded-sm px-1.5 text-white/80 hover:bg-white/10 hover:text-white"

  return (
    <div className="flex min-h-dvh flex-col" data-surface={surface}>
      {surface === "dev" && <div className="workshop-strip h-1.5 shrink-0" data-testid="workshop-strip" />}
      <header className={cn("sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 bg-chrome px-2 text-white md:px-3", surface === "dev" ? "border-b-2 border-cyan" : "border-b-2 border-orange")}>
        <button type="button" onClick={() => setCollapsed(!collapsed)} className={cn(chromeBtn, "hidden md:inline-flex")} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} aria-pressed={collapsed} data-testid="rail-toggle">
          {collapsed ? <PanelLeftOpen className="size-4 rtl:-scale-x-100" /> : <PanelLeftClose className="size-4 rtl:-scale-x-100" />}
        </button>
        <Link href="/" className="shrink-0" aria-label="Home"><span className="hidden sm:inline"><Brand surface={surface} /></span><span className="sm:hidden"><Brand surface={surface} compact /></span></Link>
        <nav aria-label={t("crumb.label")} className="ms-2 hidden min-w-0 lg:block">
          <ol className="flex items-center gap-1 text-[12px] text-white/70">
            {crumbs.map((c, n) => (
              <li key={`${n}:${c.label}`} className="flex min-w-0 items-center gap-1">
                {n > 0 && <ChevronRight className="size-3 shrink-0 rtl:-scale-x-100" aria-hidden />}
                {c.href ? <Link href={c.href} className="truncate hover:text-white hover:underline">{c.label}</Link> : <span aria-current={n === crumbs.length - 1 ? "page" : undefined} className={cn("truncate", n === crumbs.length - 1 && "text-white", c.mono && "font-mono text-[11.5px]")}>{c.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
        <button type="button" onClick={() => setPalette(true)} data-testid="palette-trigger" className="ms-auto flex min-h-8 min-w-8 items-center justify-center gap-2 rounded-sm border border-white/15 bg-white/5 px-2 text-white/70 hover:bg-white/10 hover:text-white md:w-72 md:justify-start" aria-label={t("search.open")} aria-haspopup="dialog">
          <Search className="size-4 shrink-0" aria-hidden />
          <span className="hidden min-w-0 flex-1 truncate text-start font-mono text-[12px] md:block" dir="ltr">{goToHint}</span>
          <span className="kbd hidden bg-transparent text-white/60 md:inline">/</span>
        </button>
        <div className="flex items-center gap-1">
          <button type="button" className={cn(chromeBtn, "hidden md:inline-flex")} onClick={() => setHelp(true)} aria-label={t("action.shortcuts")}><span className="kbd bg-transparent text-white/70">?</span></button>
          {alerts && (
            <Popover label={t("bell.title")} testId="bell" trigger={<><Bell className="size-4" aria-hidden />{alertTotal > 0 && <span className="num absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-orange px-1 text-center text-[10px] leading-4 text-navy-950" data-testid="bell-count">{alertTotal > 99 ? "99+" : alertTotal}</span>}</>}>
              {(close) => (
                <div>
                  <div className="flex items-center justify-between px-2 pb-1.5"><p className="cap">{t("bell.title")}</p><span className="cap flex items-center gap-1"><span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-steel")} />{live ? t("bell.live") : t("bell.polling")}</span></div>
                  {alertTotal === 0 ? <p className="px-2 py-3 text-steel">{t("bell.none")}</p> : (
                    <ul className="ledger-rows">
                      {(alerts ?? []).filter((a) => a.count > 0).map((a) => (
                        <li key={a.id}><Link href={a.href} onClick={close} className="flex min-h-9 items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-hover"><span className={cn("num min-w-6 rounded-sm px-1 text-center", a.tone === "danger" ? "bg-danger text-white dark:text-navy-950" : a.tone === "warn" ? "bg-warning-subtle text-warning-subtle-fg" : "bg-info-subtle text-info-subtle-fg")}>{a.count}</span><span className="min-w-0 flex-1">{a.label}</span></Link></li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Popover>
          )}
          <Popover label={t("user.menu")} testId="user-menu" trigger={<><span className="grid size-6 place-items-center rounded-full bg-white/15 text-[11px] font-semibold uppercase" aria-hidden dir="auto">{me?.displayName.trim().charAt(0) || <UserRound className="size-3.5" />}</span></>}>
            {(close) => (
              <div>
                {me && <div className="px-2 pb-1.5"><p className="font-medium" dir="auto">{me.displayName}</p><p className="font-mono text-[10.5px] text-steel">{me.roles.join(" · ")}</p></div>}
                <Segmented label={t("user.theme")} value={theme} onChange={setTheme} options={(["light", "dark", "system"] as const).map((v) => ({ value: v, label: themeName(v) }))} />
                <Segmented label={t("user.density")} value={density} onChange={setDensity} options={(["comfortable", "compact"] as const).map((v) => ({ value: v, label: densityName(v) }))} />
                <Segmented<Locale> label={t("user.language")} value={locale} onChange={setLocale} options={[{ value: "en", label: t("lang.en") }, { value: "fa", label: t("lang.fa") }]} />
                <div className="mt-1 border-t border-rule pt-1">
                  <Link href="/account" onClick={close} className="flex min-h-8 items-center rounded-sm px-2 hover:bg-hover">{t("user.account")}</Link>
                  <button type="button" onClick={() => void signOut()} className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 text-start hover:bg-hover" data-testid="sign-out"><LogOut className="size-3.5" aria-hidden />{t("action.signout")}</button>
                </div>
              </div>
            )}
          </Popover>
        </div>
      </header>
      <div className="flex flex-1">
        <nav aria-label={t("nav.sections")} className="rail sticky top-12 hidden h-[calc(100dvh-3rem)] shrink-0 overflow-x-hidden overflow-y-auto border-e border-rule bg-surface-raised py-2 md:block" data-testid="rail">
          {sections.map((s, n) => (
            <div key={s.title} className="mb-2">
              {n > 0 && <div className="rail-sep" aria-hidden />}
              <p className="cap rail-title px-4 pt-1 pb-1">{s.title}</p>
              <ul>
                {s.items.map((i) => {
                  const active = isActive(pathname, search, i.href)
                  return (
                    <li key={i.href}>
                      <Link href={i.href} title={i.label} aria-current={active ? "page" : undefined} className={cn("rail-link flex min-h-8 items-center gap-2.5 px-4 py-1 hover:bg-hover", active && "row-focus font-medium")}>
                        <span className="grid size-4 shrink-0 place-items-center text-steel" aria-hidden>{i.icon ?? <Circle className="size-2.5" />}</span>
                        <span className="rail-label min-w-0 flex-1 truncate">{i.label}</span>
                        {i.count != null && <span data-testid="nav-count" data-alert={!!(i.alert && i.count > 0)} className={cn("rail-count num text-[11px]", i.alert && i.count > 0 ? "rounded-sm bg-danger px-1 text-white dark:text-navy-950" : "text-steel")}>{i.count}</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
        <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
      </div>
      <nav aria-label={t("nav.sections")} className="fixed inset-x-0 bottom-0 z-30 grid border-t border-rule bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))` }} data-testid="bottom-bar">
        {mobileItems.map((i) => (
          <Link key={i.href} href={i.href} aria-current={isActive(pathname, search, i.href) ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px]", isActive(pathname, search, i.href) ? "font-medium text-ink" : "text-steel")}>
            <span className="relative" aria-hidden>{i.icon}{i.count ? <span className="num absolute -end-3 -top-1.5 min-w-4 rounded-full bg-orange px-1 text-center text-[9.5px] leading-4 text-navy-950">{i.count}</span> : null}</span>
            <span className="max-w-full truncate px-1">{i.label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" data-testid="more-button" className="flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] text-steel"><Ellipsis className="size-4" aria-hidden /><span>{t("nav.more")}</span></button>
      </nav>
      {more && (
        <Modal label={t("nav.more")} onClose={() => setMore(false)} className="mt-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-rule-strong bg-surface-raised p-4 pb-6 sm:mt-0 sm:max-w-md sm:rounded-2xl">
          <div className="mb-2 flex items-center justify-between"><p className="font-display text-lg">{t("nav.more")}</p><button type="button" data-autofocus onClick={() => setMore(false)} aria-label={t("nav.close")} className="grid min-h-8 min-w-8 place-items-center rounded-sm hover:bg-hover"><X className="size-4" /></button></div>
          {sections.map((s) => (
            <div key={s.title} className="mb-3">
              <p className="cap pb-1">{s.title}</p>
              <ul className="grid grid-cols-2 gap-1.5">
                {s.items.map((i) => (
                  <li key={i.href}><Link href={i.href} aria-current={isActive(pathname, search, i.href) ? "page" : undefined} className={cn("flex min-h-10 items-center gap-2 rounded-md border border-rule px-2.5 py-1.5 hover:bg-hover", isActive(pathname, search, i.href) && "border-orange")}><span className="shrink-0 text-steel" aria-hidden>{i.icon ?? <Circle className="size-3" />}</span><span className="min-w-0 flex-1 truncate">{i.label}</span>{i.count ? <span className={cn("num text-[11px]", i.alert ? "text-danger" : "text-steel")}>{i.count}</span> : null}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </Modal>
      )}
      {help && (
        <Modal label={t("help.title")} onClose={() => setHelp(false)} className="w-full max-w-sm place-self-center rounded-lg border border-rule-strong bg-surface-raised p-5">
          <div className="flex items-center justify-between"><p className="font-display text-lg">{t("help.title")}</p><button type="button" data-autofocus onClick={() => setHelp(false)} aria-label={t("nav.close")} className="grid min-h-8 min-w-8 place-items-center rounded-sm hover:bg-hover"><X className="size-4" /></button></div>
          <dl className="ledger-rows mt-3">
            {SHORTCUTS.map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-1.5"><dt><span className="kbd">{k}</span></dt><dd className="text-end text-steel">{t(v)}</dd></div>)}
          </dl>
        </Modal>
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={items} goTo={goTo} t={t as T} />
    </div>
  )
}

/** Session gate for every console screen: signed in, second factor verified, and allowed on this host's surface. */
export function Gate({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  const { me, loading, reload } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => { if (!loading && !me) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`) }, [loading, me, router, pathname])
  if (loading || !me) return <div className="grid min-h-dvh place-items-center text-steel" aria-busy>Loading…</div>
  if (me.mfa.level < 1) {
    return (
      <main className="grid min-h-dvh place-items-center bg-surface-raised p-6">
        <div className="w-full max-w-sm">
          <Brand surface={surface} tone="onLight" />
          <h1 className="mt-6 font-display text-2xl">Second factor</h1>
          <div className="mt-4">{me.mfa.enrolled.length ? <TotpVerify onDone={reload} passkey /> : <TotpEnrol onDone={reload} />}</div>
        </div>
      </main>
    )
  }
  const allowed = surface === "dev" ? me.surfaces.developer : me.surfaces.admin
  if (!allowed) {
    return (
      <main className="grid min-h-dvh place-items-center bg-surface-raised p-6 text-center">
        <div className="max-w-sm">
          <Brand surface={surface} tone="onLight" />
          <h1 className="mt-6 font-display text-2xl">No access to the {surface === "dev" ? "Developer" : "Admin"} Panel</h1>
          <p className="mt-2 text-steel">Your roles ({me.roles.join(", ") || "none"}) do not include this panel. Ask an owner if you need it.</p>
        </div>
      </main>
    )
  }
  return <StepUpProvider>{children}</StepUpProvider>
}
