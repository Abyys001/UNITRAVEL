"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Bell, ChevronRight, Circle, Ellipsis, KeyRound, Keyboard, LogOut, PanelLeftClose, PanelLeftOpen, Search, UserRound, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { Logo, LogoMark } from "@unitravel/ui/brand/logo"

import { api } from "@/lib/api"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import { useCrumbLabels } from "@/lib/crumb"
import { useLive } from "@/lib/live"
import { applyPrefs, type Density, type Locale, type Theme, useDensity, useLocale, useRailCollapsed, useTheme } from "@/lib/prefs"
import { type Surface, useSession } from "@/lib/session"

import { CommandPalette, type PaletteItem } from "./command-palette"
import { StepUpProvider, TotpEnrol, TotpVerify } from "./mfa"

export function Brand({ surface, compact = false, tone = "onDark" }: { surface: Surface; compact?: boolean; tone?: "onDark" | "onLight" }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-2.5">
      {compact ? <LogoMark size={24} className="shrink-0" /> : <Logo variant="horizontal" tone={tone} size={26} />}
      {!compact && (
        <span className={cn("border-s ps-2.5 font-mono text-[11px] tracking-[0.14em] uppercase", tone === "onDark" ? "border-white/20 text-orange-300" : "border-navy-950/20 text-orange-700 dark:border-white/20 dark:text-orange-300")}>
          {surface === "dev" ? t("dnav.workshop") : t("signin.panel.adminShort")}
        </span>
      )}
    </span>
  )
}

export interface NavTab { href: string; label: string }
/**
 * One top-level destination. Related pages sit behind it as `tabs` (rendered by the shell under the header), and `match`
 * lists extra path prefixes that belong to it (a request page belongs to Requests), so the rail stays a short flat list.
 */
export interface NavItem { href: string; label: string; count?: number | null; alert?: boolean; mobile?: boolean; icon?: React.ReactNode; match?: string[]; tabs?: NavTab[]; short?: string }
/** One line in the alerts bell, derived by the frame from data it already loads (queue summary / SSE). */
export interface ShellAlert { id: string; label: string; count: number; href: string; tone: "danger" | "warn" | "info" }

const pathOf = (href: string) => href.split("?")[0]!
const under = (pathname: string, p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`))
const itemPaths = (i: NavItem) => [pathOf(i.href), ...(i.match ?? []), ...(i.tabs ?? []).map((t) => pathOf(t.href))]
/** The tab whose path is the longest prefix of the current page ("/compliance/policies" beats "/compliance"). */
/** The destination owning this page: the one with the longest matching path, so "/" (home) never shadows "/jobs". */
const currentItem = (pathname: string, items: NavItem[]) => items
  .map((i) => [i, Math.max(-1, ...itemPaths(i).filter((p) => under(pathname, p)).map((p) => p.length))] as const)
  .filter(([, n]) => n >= 0).sort((a, b) => b[1] - a[1])[0]?.[0]
const activeTab = (pathname: string, tabs: NavTab[]) => tabs.filter((t) => under(pathname, pathOf(t.href))).sort((a, b) => pathOf(b.href).length - pathOf(a.href).length)[0]

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
function Popover({ label, trigger, children, testId, className }: { label: string; trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; testId?: string; className?: string }) {
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
      <button ref={btn} type="button" aria-haspopup="true" aria-expanded={open} aria-label={label} data-testid={testId} onClick={() => setOpen((o) => !o)} className={className}>{trigger}</button>
      {open && <div className="absolute end-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-rule-strong bg-surface-raised p-2 text-ink shadow-2xl">{children(() => setOpen(false))}</div>}
    </div>
  )
}

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="px-1 py-1.5">
      <p className="cap mb-1">{label}</p>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-surface-sunk p-0.5" onKeyDown={(e) => {
        // Radio group semantics: one tab stop, arrows move and select (mirrored in RTL).
        const i = options.findIndex((o) => o.value === value)
        const rtl = document.documentElement.dir === "rtl"
        const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
        if (!step) return
        e.preventDefault()
        const group = e.currentTarget
        const to = options[(i + step + options.length) % options.length]!
        onChange(to.value)
        requestAnimationFrame(() => group.querySelector<HTMLElement>("[aria-checked=true]")?.focus())
      }}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)} className={cn("min-h-8 pointer-coarse:min-h-11 rounded-[5px] px-2 text-[12px]", value === o.value ? "bg-surface-raised font-medium shadow-sm ring-1 ring-rule-strong" : "text-steel hover:text-ink")}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

const crumbText = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** Segments with no page of their own (only /<seg>/<id> exists), so they are labelled but never linked. */
const CRUMB_SEG: Record<string, MsgKey> = { requests: "crumb.requests", customers: "crumb.customers", cargo: "crumb.cargo", quote: "crumb.quote" }
const NO_INDEX = new Set(["requests", "customers", "cargo"])

function useCrumbs(pathname: string, items: NavItem[], homeLabel: string, t: T) {
  const named = useCrumbLabels()
  return useMemo(() => {
    const crumbs: { label: string; href?: string; mono?: boolean }[] = [{ label: homeLabel, href: pathname === "/" ? undefined : "/" }]
    if (pathname === "/") return crumbs
    const hit = currentItem(pathname, items)
    const tab = hit?.tabs ? activeTab(pathname, hit.tabs) : undefined
    const base = tab ? pathOf(tab.href) : hit ? [pathOf(hit.href), ...(hit.match ?? [])].find((p) => under(pathname, p)) : undefined
    const rest = pathname.split("/").filter(Boolean)
    if (hit && pathOf(hit.href) !== "/") crumbs.push({ label: hit.label, href: pathname === pathOf(hit.href) ? undefined : hit.href })
    if (tab && pathOf(tab.href) !== pathOf(hit!.href)) crumbs.push({ label: tab.label, href: pathname === pathOf(tab.href) ? undefined : tab.href })
    const tail = base && base !== "/" ? pathname.slice(base.length).split("/").filter(Boolean) : rest
    const prefix = base && base !== "/" ? base : ""
    tail.forEach((seg, n) => {
      const last = n === tail.length - 1
      const key = CRUMB_SEG[seg]
      const linkable = !last && !(!prefix && n === 0 && NO_INDEX.has(seg))
      crumbs.push({ label: last && named[pathname] ? named[pathname] : key ? t(key) : crumbText(seg), mono: !(last && named[pathname]) && !key, href: linkable ? `${prefix}/${tail.slice(0, n + 1).join("/")}` : undefined })
    })
    return crumbs
  }, [pathname, items, homeLabel, t, named])
}

const SHORTCUTS: [string, MsgKey][] = [["⌘K · Ctrl K · /", "help.palette"], ["j / k", "help.next"], ["Enter", "help.open"], ["c", "help.claim"], ["n", "help.note"], ["m", "help.msg"], ["?", "help.help"]]

/**
 * Console frame: a full-height navy rail with a short flat list of destinations (related pages become tabs under the
 * header, so the rail never needs section headings), a light top bar (breadcrumbs, palette trigger, alerts bell, user
 * menu) and, on phones, a bottom bar plus "More" sheet (mobile admin mode, ch. 15.8). The rail collapses to icons
 * (html[data-rail], set before paint). The dev host carries the hatched workshop strip on every screen.
 */
export function Shell({ surface, items, children, onGoTo, goToHint, alerts }: { surface: Surface; items: NavItem[]; children: React.ReactNode; onGoTo: (q: string) => string | null; goToHint: string; alerts?: ShellAlert[] }) {
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
  const [help, setHelp] = useState(false)
  const [more, setMore] = useState(false)
  const [palette, setPalette] = useState(false)
  useEffect(() => { setMore(false) }, [pathname])
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
  const palItems = useMemo<PaletteItem[]>(() => [
    ...items.flatMap((i) => [
      { id: `nav:${i.href}`, label: i.label, group: t("search.pages"), icon: i.icon ?? <Circle className="size-3" />, hint: i.count ? String(i.count) : undefined, run: () => router.push(i.href) },
      ...(i.tabs ?? []).filter((x) => pathOf(x.href) !== pathOf(i.href)).map((x) => ({ id: `nav:${x.href}`, label: x.label, group: i.label, icon: i.icon ?? <Circle className="size-3" />, run: () => router.push(x.href) })),
    ]),
    { id: "nav:/account", label: t("user.account"), group: t("search.pages"), icon: <KeyRound className="size-4" />, run: () => router.push("/account") },
    { id: "act:theme", label: t("action.theme", { v: themeName(nextTheme) }), group: t("search.actions"), keywords: "dark light mode theme", run: () => setTheme(nextTheme) },
    { id: "act:density", label: t("action.density", { v: densityName(density === "compact" ? "comfortable" : "compact") }), group: t("search.actions"), keywords: "compact comfortable", run: () => setDensity(density === "compact" ? "comfortable" : "compact") },
    { id: "act:lang", label: t("action.language", { v: locale === "fa" ? t("lang.en") : t("lang.fa") }), group: t("search.actions"), keywords: "persian farsi english language", run: () => setLocale(locale === "fa" ? "en" : "fa") },
    { id: "act:help", label: t("action.shortcuts"), group: t("search.actions"), hint: "?", keywords: "keyboard help", run: () => setHelp(true) },
    { id: "act:signout", label: t("action.signout"), group: t("search.actions"), icon: <LogOut className="size-4" />, run: () => void signOut() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [items, t, router, theme, density, locale, signOut])
  const goTo = useCallback((q: string): PaletteItem | null => {
    const to = onGoTo(q)
    return to ? { id: "goto", label: t("search.go", { q }), group: t("search.actions"), icon: <Search className="size-4" />, run: () => router.push(to) } : null
  }, [onGoTo, router, t])

  const crumbs = useCrumbs(pathname, items, surface === "dev" ? t("dnav.workshop") : t("crumb.home"), t)
  const current = currentItem(pathname, items)
  const tabs = current?.tabs && current.tabs.length > 1 ? current.tabs : null
  const tab = tabs ? activeTab(pathname, tabs) : undefined
  const mobileItems = items.filter((i) => i.mobile)
  const alertTotal = (alerts ?? []).filter((a) => a.count > 0).length
  const barBtn = "relative inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-steel hover:bg-hover hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"

  return (
    <div className="flex min-h-dvh flex-col" data-surface={surface}>
      {surface === "dev" && <div className="workshop-strip h-1 shrink-0" data-testid="workshop-strip" />}
      <div className="flex flex-1">
        {/* The navy column spans the whole page height; the nav inside it sticks to the viewport. */}
        <div className="hidden shrink-0 bg-chrome md:block">
        <nav aria-label={t("nav.sections")} className="rail sticky top-0 flex h-dvh flex-col text-white" data-testid="rail">
          <Link href="/" className="rail-brand flex h-14 shrink-0 items-center px-4" aria-label={t("crumb.home")}>
            <span className="rail-brand-full flex items-center gap-2.5 whitespace-nowrap"><Logo variant="horizontal" tone="onDark" size={20} /><span className={cn("rounded-full px-1.5 py-px text-[9.5px] font-semibold tracking-[0.08em] uppercase", surface === "dev" ? "bg-cyan/15 text-cyan" : "bg-orange/15 text-orange-300")}>{surface === "dev" ? t("dnav.workshop") : t("signin.panel.adminShort")}</span></span>
            <span className="rail-brand-mark"><LogoMark size={26} /></span>
          </Link>
          <ul className="flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto px-2.5 py-3">
            {items.map((i) => {
              const active = i === current
              return (
                <li key={i.href}>
                  <Link href={i.href} title={i.label} aria-current={active ? "page" : undefined} className={cn("rail-link relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] text-white/72 transition-colors hover:bg-white/8 hover:text-white", active && "rail-active bg-white/12 font-semibold text-white")}>
                    <span className={cn("grid size-[18px] shrink-0 place-items-center", active ? "text-[var(--indicator)]" : "text-white/60")} aria-hidden>{i.icon ?? <Circle className="size-2.5" />}</span>
                    <span className="rail-label min-w-0 flex-1 truncate">{i.label}</span>
                    {i.count != null && i.count > 0 && <span data-testid="nav-count" data-alert={!!i.alert} className={cn("rail-count num rounded-full px-1.5 text-[11px] leading-5", i.alert ? "bg-danger text-white" : "bg-white/10 text-white/80")}>{i.count}</span>}
                    {i.count === 0 && <span data-testid="nav-count" data-alert="false" className="sr-only">0</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="shrink-0 border-t border-white/10 p-2.5">
            <button type="button" onClick={() => setCollapsed(!collapsed)} className="rail-link flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-[12.5px] text-white/60 hover:bg-white/8 hover:text-white" aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} aria-pressed={collapsed} data-testid="rail-toggle">
              {collapsed ? <PanelLeftOpen className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden /> : <PanelLeftClose className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />}
              <span className="rail-label">{t("nav.collapse")}</span>
            </button>
          </div>
        </nav>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-rule bg-surface-raised/90 px-3 backdrop-blur md:px-5">
            <Link href="/" className="shrink-0 md:hidden" aria-label={t("crumb.home")}><Brand surface={surface} compact tone="onLight" /></Link>
            <nav aria-label={t("crumb.label")} className="hidden min-w-0 md:block">
              <ol className="flex items-center gap-1.5 text-[13px] text-steel">
                {crumbs.map((c, n) => (
                  <li key={`${n}:${c.label}`} className="flex min-w-0 items-center gap-1.5">
                    {n > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-60 rtl:-scale-x-100" aria-hidden />}
                    {c.href ? <Link href={c.href} className="truncate hover:text-ink">{c.label}</Link> : <span aria-current={n === crumbs.length - 1 ? "page" : undefined} className={cn("truncate", n === crumbs.length - 1 && "font-semibold text-ink", c.mono && "font-mono text-[12px]")} dir={c.mono ? "ltr" : undefined}>{c.label}</span>}
                  </li>
                ))}
              </ol>
            </nav>
            <button type="button" onClick={() => setPalette(true)} data-testid="palette-trigger" className="ms-auto flex min-h-9 min-w-9 items-center justify-center gap-2 rounded-lg border border-rule bg-surface-sunk px-2.5 text-steel hover:border-rule-strong hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 md:w-80 md:justify-start" aria-label={t("search.open")} aria-haspopup="dialog">
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="hidden min-w-0 flex-1 truncate text-start text-[12.5px] md:block" dir="ltr">{goToHint}</span>
              <span className="kbd hidden md:inline" dir="ltr">⌘K</span>
            </button>
            <div className="flex items-center gap-0.5">
              <button type="button" className={cn(barBtn, "hidden md:inline-flex")} onClick={() => setHelp(true)} aria-label={t("action.shortcuts")}><Keyboard className="size-4" aria-hidden /></button>
              {alerts && (
                <Popover label={t("bell.title")} testId="bell" className={barBtn} trigger={<><Bell className="size-4" aria-hidden />{alertTotal > 0 && <span className="num absolute end-0.5 top-0.5 min-w-4 rounded-full bg-orange px-1 text-center text-[10px] leading-4 text-navy-950" data-testid="bell-count">{alertTotal > 99 ? "99+" : alertTotal}</span>}</>}>
                  {(close) => (
                    <div>
                      <div className="flex items-center justify-between px-2 pb-1.5"><p className="text-[13px] font-semibold">{t("bell.title")}</p><span className="flex items-center gap-1.5 text-[11.5px] text-steel"><span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-steel")} />{live ? t("bell.live") : t("bell.polling")}</span></div>
                      {alertTotal === 0 ? <p className="px-2 py-3 text-steel">{t("bell.none")}</p> : (
                        <ul className="space-y-0.5">
                          {(alerts ?? []).filter((a) => a.count > 0).map((a) => (
                            <li key={a.id}><Link href={a.href} onClick={close} className="flex min-h-10 pointer-coarse:min-h-11 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover"><span className={cn("num min-w-7 rounded-full px-1.5 text-center text-[11.5px] leading-5", a.tone === "danger" ? "bg-danger text-white dark:text-navy-950" : a.tone === "warn" ? "bg-warning-subtle text-warning-subtle-fg" : "bg-info-subtle text-info-subtle-fg")}>{a.count}</span><span className="min-w-0 flex-1">{a.label}</span></Link></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </Popover>
              )}
              <Popover label={t("user.menu")} testId="user-menu" className={barBtn} trigger={<span className="grid size-7 place-items-center rounded-full bg-navy-900 text-[12px] font-semibold text-white uppercase dark:bg-white/15" aria-hidden dir="auto">{me?.displayName.trim().charAt(0) || <UserRound className="size-3.5" />}</span>}>
                {(close) => (
                  <div>
                    {me && <div className="px-2 pb-2"><p className="font-semibold" dir="auto">{me.displayName}</p><p className="text-[11.5px] text-steel">{me.roles.join(" · ")}</p></div>}
                    <Segmented label={t("user.theme")} value={theme} onChange={setTheme} options={(["light", "dark", "system"] as const).map((v) => ({ value: v, label: themeName(v) }))} />
                    <Segmented label={t("user.density")} value={density} onChange={setDensity} options={(["comfortable", "compact"] as const).map((v) => ({ value: v, label: densityName(v) }))} />
                    <Segmented<Locale> label={t("user.language")} value={locale} onChange={setLocale} options={[{ value: "en", label: t("lang.en") }, { value: "fa", label: t("lang.fa") }]} />
                    <div className="mt-1 border-t border-rule pt-1">
                      <Link href="/account" onClick={close} className="flex min-h-9 pointer-coarse:min-h-11 items-center gap-2 rounded-md px-2 hover:bg-hover"><KeyRound className="size-3.5" aria-hidden />{t("user.account")}</Link>
                      <button type="button" onClick={() => void signOut()} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-start hover:bg-hover pointer-coarse:min-h-11" data-testid="sign-out"><LogOut className="size-3.5" aria-hidden />{t("action.signout")}</button>
                    </div>
                  </div>
                )}
              </Popover>
            </div>
          </header>
          {tabs && (
            <nav aria-label={current!.label} className="flex gap-1 overflow-x-auto border-b border-rule bg-surface-raised px-3 md:px-5" data-testid="section-tabs">
              {tabs.map((x) => {
                const on = x === tab
                return <Link key={x.href} href={x.href} aria-current={on ? "page" : undefined} className={cn("relative flex min-h-11 shrink-0 items-center px-3 text-[13px] whitespace-nowrap", on ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--indicator)]" : "text-steel hover:text-ink")}>{x.label}</Link>
              })}
            </nav>
          )}
          <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
        </div>
      </div>
      <nav aria-label={t("nav.sections")} className="fixed inset-x-0 bottom-0 z-30 grid border-t border-rule bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))` }} data-testid="bottom-bar">
        {mobileItems.map((i) => {
          const on = i === current
          return (
            <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px]", on ? "font-semibold text-ink" : "text-steel")}>
              {on && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[var(--indicator)]" aria-hidden />}
              <span className="relative" aria-hidden>{i.icon}{i.count ? <span className={cn("num absolute -end-3.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[9.5px] leading-4", i.alert ? "bg-danger text-white" : "bg-orange text-navy-950")}>{i.count > 99 ? "99+" : i.count}</span> : null}</span>
              <span className="max-w-full truncate px-1">{i.short ?? i.label}</span>
            </Link>
          )
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" data-testid="more-button" className="flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] text-steel"><Ellipsis className="size-4" aria-hidden /><span>{t("nav.more")}</span></button>
      </nav>
      {more && (
        <Modal label={t("nav.more")} onClose={() => setMore(false)} className="mt-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-rule-strong bg-surface-raised p-4 pb-6 sm:mt-0 sm:max-w-md sm:rounded-2xl">
          <div className="mb-3 flex items-center justify-between"><p className="font-display text-lg">{t("nav.more")}</p><button type="button" data-autofocus onClick={() => setMore(false)} aria-label={t("nav.close")} className="grid min-h-11 min-w-11 place-items-center rounded-md hover:bg-hover"><X className="size-4" /></button></div>
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={i === current ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-hover", i === current && "bg-hover font-semibold")}><span className="shrink-0 text-steel" aria-hidden>{i.icon ?? <Circle className="size-3" />}</span><span className="min-w-0 flex-1">{i.label}</span>{i.count ? <span className={cn("num rounded-full px-1.5 text-[11px] leading-5", i.alert ? "bg-danger text-white" : "bg-hover text-steel")}>{i.count}</span> : null}</Link>
                {i.tabs && i.tabs.length > 1 && (
                  <ul className="ms-10 mb-1 flex flex-wrap gap-1.5">
                    {i.tabs.map((x) => <li key={x.href}><Link href={x.href} className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 text-[12px] text-steel hover:bg-hover hover:text-ink">{x.label}</Link></li>)}
                  </ul>
                )}
              </li>
            ))}
            <li><Link href="/account" className="flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-hover"><KeyRound className="size-4 shrink-0 text-steel" aria-hidden />{t("user.account")}</Link></li>
          </ul>
        </Modal>
      )}
      {help && (
        <Modal label={t("help.title")} onClose={() => setHelp(false)} className="w-full max-w-sm place-self-center rounded-xl border border-rule-strong bg-surface-raised p-5 shadow-2xl">
          <div className="flex items-center justify-between"><p className="font-display text-lg">{t("help.title")}</p><button type="button" data-autofocus onClick={() => setHelp(false)} aria-label={t("nav.close")} className="grid min-h-8 min-w-8 place-items-center rounded-md hover:bg-hover pointer-coarse:min-h-11 pointer-coarse:min-w-11"><X className="size-4" /></button></div>
          <dl className="ledger-rows mt-3">
            {SHORTCUTS.filter(([, v]) => surface === "admin" || v === "help.palette" || v === "help.help").map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt><span className="kbd">{k}</span></dt><dd className="text-end text-steel">{t(v)}</dd></div>)}
          </dl>
        </Modal>
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={palItems} goTo={goTo} t={t as T} />
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
  // Panel access first: a phone with no role here must not be walked through second-factor enrolment.
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
  return <StepUpProvider>{children}</StepUpProvider>
}
