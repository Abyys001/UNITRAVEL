"use client"

import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Bell, CalendarClock, ChevronRight, Circle, Ellipsis, Inbox, KeyRound, Keyboard, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, ShieldAlert, Sun, X } from "lucide-react"
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
import { Segmented, Tip } from "./controls"
import { StepUpProvider, TotpEnrol, TotpVerify } from "./mfa"

export function Brand({ surface, compact = false, tone = "onDark" }: { surface: Surface; compact?: boolean; tone?: "onDark" | "onLight" }) {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-2.5">
      {compact ? <LogoMark size={26} className="shrink-0" /> : <Logo variant="horizontal" tone={tone} size={26} />}
      {!compact && (
        <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold tracking-[0.06em] uppercase", tone === "onDark" ? "bg-orange/15 text-orange-300" : "bg-warning-subtle text-orange-700 dark:text-orange-300")}>
          {surface === "dev" ? t("dnav.workshop") : t("signin.panel.adminShort")}
        </span>
      )}
    </span>
  )
}

export interface NavTab { href: string; label: string }
/**
 * One top-level destination. Related pages sit behind it as `tabs` (rendered by the shell under the header), and `match`
 * lists extra path prefixes that belong to it (a request page belongs to Requests), so the rail stays a short list.
 * `group` puts destinations under a heading in the rail ("Work", "Records", "Tools").
 */
export interface NavItem { href: string; label: string; count?: number | null; alert?: boolean; mobile?: boolean; icon?: React.ReactNode; match?: string[]; tabs?: NavTab[]; short?: string; group?: string }
/** One line in the notification centre, derived by the frame from data it already loads (queue summary / SSE). */
export interface ShellAlert { id: string; label: string; count: number; href: string; tone: "danger" | "warn" | "info" }

const pathOf = (href: string) => href.split("?")[0]!
const under = (pathname: string, p: string) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`))
const itemPaths = (i: NavItem) => [pathOf(i.href), ...(i.match ?? []), ...(i.tabs ?? []).map((t) => pathOf(t.href))]
/** The destination owning this page: the one with the longest matching path, so "/" (home) never shadows "/jobs". */
const currentItem = (pathname: string, items: NavItem[]) => items
  .map((i) => [i, Math.max(-1, ...itemPaths(i).filter((p) => under(pathname, p)).map((p) => p.length))] as const)
  .filter(([, n]) => n >= 0).sort((a, b) => b[1] - a[1])[0]?.[0]
/** The tab whose path is the longest prefix of the current page ("/compliance/policies" beats "/compliance"). */
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
    <div className="fixed inset-0 z-modal grid bg-navy-950/50 p-3 backdrop-blur-[2px] sm:place-items-center" onMouseDown={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()} className={cn("animate-in", className)}>{children}</div>
    </div>
  )
}

/** Anchored popover (notification centre, user menu): click outside or Esc closes, aria-expanded on the trigger, focus returns. */
function Popover({ label, trigger, children, testId, className, width = "w-[min(22rem,calc(100vw-1.5rem))]", tip }: { label: string; trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; testId?: string; className?: string; width?: string; tip?: string }) {
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
  const button = <button ref={btn} type="button" aria-haspopup="true" aria-expanded={open} aria-label={label} data-testid={testId} onClick={() => setOpen((o) => !o)} className={className}>{trigger}</button>
  return (
    <div ref={root} className="relative">
      {tip ? <Tip label={tip} disabled={open}>{button}</Tip> : button}
      {open && <div role="region" aria-label={label} className={cn("pop-surface animate-in absolute end-0 top-full z-dropdown mt-2 p-1.5", width)}>{children(() => setOpen(false))}</div>}
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

const SHORTCUTS: [string, MsgKey][] = [["⌘ K · Ctrl K · /", "help.palette"], ["[", "help.rail"], ["j · k", "help.next"], ["Enter", "help.open"], ["c", "help.claim"], ["n", "help.note"], ["m", "help.msg"], ["?", "help.help"]]
const GROUP_LABEL: Record<string, MsgKey> = { work: "nav.group.work", records: "nav.group.records", tools: "nav.tools", operate: "dnav.group.operate", configure: "dnav.group.configure" }
const ALERT_ICON = { danger: AlertTriangle, warn: CalendarClock, info: Inbox } as const
const ALERT_HELP: Record<string, MsgKey> = { sla: "bell.d.sla", holds: "bell.d.holds", deadlines: "bell.d.deadlines", new: "bell.d.new" }

/** Rail link: full row when open; centred icon with a tooltip (label and count) when the rail is collapsed. */
function RailLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const count = item.count != null && item.count > 0 ? item.count : null
  const link = (
    <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={collapsed ? `${item.label}${count ? ` (${count})` : ""}` : undefined}
      className={cn("rail-link group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-body font-medium transition-colors",
        active ? "bg-chrome-raised text-white" : "text-chrome-ink hover:bg-white/[0.06] hover:text-white")}>
      {active && <span aria-hidden className="absolute inset-y-2 -start-2.5 w-[3px] rounded-e-full bg-[var(--indicator)]" />}
      <span className={cn("relative grid size-5 shrink-0 place-items-center [&_svg]:size-[18px] [&_svg]:stroke-[1.75]", active ? "text-[var(--indicator)]" : "text-chrome-muted group-hover:text-chrome-ink")} aria-hidden>
        {item.icon ?? <Circle className="size-2.5" />}
        {count && <span className={cn("rail-dot absolute -end-1 -top-1 size-2 rounded-full ring-2 ring-chrome", item.alert ? "bg-danger" : "bg-orange")} />}
      </span>
      <span className="rail-label min-w-0 flex-1 truncate">{item.label}</span>
      {count && <span data-testid="nav-count" data-alert={!!item.alert} className={cn("rail-count num min-w-6 rounded-full px-1.5 text-center text-caption leading-5 font-semibold", item.alert ? "bg-danger text-white" : "bg-white/10 text-chrome-ink")}>{count > 999 ? "999+" : count}</span>}
      {item.count === 0 && <span data-testid="nav-count" data-alert="false" className="sr-only">0</span>}
    </Link>
  )
  return <Tip side="right" disabled={!collapsed} label={<>{item.label}{count ? <span className="num ms-1.5 opacity-70">{count}</span> : null}</>}>{link}</Tip>
}

/**
 * Console frame. The page is a fixed-height app frame: the navy rail and the top bar never scroll, and <main> is the only
 * page scroller, so nothing can slide under the header and sticky table headers pin to a known edge. Related pages are tabs
 * under the header. On phones a bottom bar and a "More" sheet replace the rail (mobile admin mode, ch. 15.8). The rail
 * collapses to icons with tooltips (html[data-rail], set before paint; `[` toggles). The dev host carries the workshop strip.
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
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => { setMore(false); mainRef.current?.scrollTo({ top: 0 }) }, [pathname])
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
      if (e.key === "[") { e.preventDefault(); setCollapsed(document.documentElement.dataset.rail !== "collapsed") }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setCollapsed])
  const signOut = useCallback(async () => {
    try { await api("/v1/auth/logout", { method: "POST", body: {} }) } catch { /* the session may already be gone */ }
    qc.clear()
    router.replace("/sign-in")
  }, [qc, router])

  const themeName = (v: Theme) => t(`theme.${v}`)
  const densityName = (v: Density) => t(`density.${v}`)
  const nextTheme: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light"
  // Top-level pages first, then each destination's sub-pages under its own name, then actions (one heading per group).
  const palItems = useMemo<PaletteItem[]>(() => [
    ...items.map((i) => ({ id: `nav:${i.href}`, label: i.label, group: t("search.pages"), icon: i.icon ?? <Circle className="size-3" />, hint: i.count ? String(i.count) : undefined, run: () => router.push(i.href) })),
    { id: "nav:/account", label: t("user.account"), group: t("search.pages"), icon: <KeyRound className="size-4" />, run: () => router.push("/account") },
    ...items.flatMap((i) => (i.tabs ?? []).filter((x) => pathOf(x.href) !== pathOf(i.href)).map((x) => ({ id: `nav:${x.href}`, label: x.label, group: i.label, icon: i.icon ?? <Circle className="size-3" />, run: () => router.push(x.href) }))),
    { id: "act:theme", label: t("action.theme", { v: themeName(nextTheme) }), group: t("search.actions"), icon: nextTheme === "dark" ? <Moon className="size-4" /> : nextTheme === "light" ? <Sun className="size-4" /> : <Monitor className="size-4" />, keywords: "dark light mode theme", run: () => setTheme(nextTheme) },
    { id: "act:density", label: t("action.density", { v: densityName(density === "compact" ? "comfortable" : "compact") }), group: t("search.actions"), icon: <PanelLeftClose className="size-4" />, keywords: "compact comfortable", run: () => setDensity(density === "compact" ? "comfortable" : "compact") },
    { id: "act:lang", label: t("action.language", { v: locale === "fa" ? t("lang.en") : t("lang.fa") }), group: t("search.actions"), icon: <span className="text-caption font-semibold">{locale === "fa" ? "EN" : "فا"}</span>, keywords: "persian farsi english language", run: () => setLocale(locale === "fa" ? "en" : "fa") },
    { id: "act:rail", label: collapsed ? t("nav.expand") : t("nav.collapse"), group: t("search.actions"), icon: collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />, hint: "[", keywords: "sidebar rail", run: () => setCollapsed(!collapsed) },
    { id: "act:help", label: t("action.shortcuts"), group: t("search.actions"), icon: <Keyboard className="size-4" />, hint: "?", keywords: "keyboard help", run: () => setHelp(true) },
    { id: "act:signout", label: t("action.signout"), group: t("search.actions"), icon: <LogOut className="size-4" />, run: () => void signOut() },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [items, t, router, theme, density, locale, collapsed, signOut])
  const goTo = useCallback((q: string): PaletteItem | null => {
    const to = onGoTo(q)
    return to ? { id: "goto", label: t("search.go", { q }), group: t("search.actions"), icon: <Search className="size-4" />, run: () => router.push(to) } : null
  }, [onGoTo, router, t])

  const crumbs = useCrumbs(pathname, items, surface === "dev" ? t("dnav.workshop") : t("crumb.home"), t)
  const current = currentItem(pathname, items)
  const tabs = current?.tabs && current.tabs.length > 1 ? current.tabs : null
  const tab = tabs ? activeTab(pathname, tabs) : undefined
  const mobileItems = items.filter((i) => i.mobile)
  const activeAlerts = (alerts ?? []).filter((a) => a.count > 0)
  const urgent = activeAlerts.some((a) => a.tone === "danger")
  const groups = useMemo(() => {
    const out: { key: string; items: NavItem[] }[] = []
    for (const i of items) { const k = i.group ?? ""; const g = out.find((x) => x.key === k); if (g) g.items.push(i); else out.push({ key: k, items: [i] }) }
    return out
  }, [items])
  const barBtn = "relative inline-flex size-9 items-center justify-center rounded-lg text-steel transition-colors hover:bg-hover hover:text-ink pointer-coarse:size-11 [&_svg]:size-[18px] [&_svg]:stroke-[1.75]"
  const initials = (me?.displayName ?? "").trim().split(/\s+/).map((w) => w.charAt(0)).slice(0, 2).join("").toUpperCase()

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <a href="#main" className="sr-only z-tooltip rounded-md bg-surface-raised px-3 py-2 font-medium shadow-[var(--shadow-pop)] focus:not-sr-only focus:fixed focus:start-3 focus:top-3">{t("nav.skip")}</a>
      {surface === "dev" && <div className="workshop-strip h-1 shrink-0" data-testid="workshop-strip" />}
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("nav.sections")} className="rail z-rail hidden shrink-0 flex-col border-e border-white/[0.06] bg-chrome text-chrome-ink md:flex" data-testid="rail">
          <Link href="/" className="rail-brand flex h-[var(--header-h)] shrink-0 items-center border-b border-white/[0.07] px-5" aria-label={t("crumb.home")}>
            <span className="rail-brand-full flex items-center gap-2.5 whitespace-nowrap"><Logo variant="horizontal" tone="onDark" size={22} /><span className={cn("rounded-full px-1.5 py-px text-2xs font-semibold tracking-[0.06em] uppercase", surface === "dev" ? "bg-cyan/15 text-cyan" : "bg-orange/15 text-orange-300")}>{surface === "dev" ? t("dnav.workshop") : t("signin.panel.adminShort")}</span></span>
            <span className="rail-brand-mark"><LogoMark size={28} /></span>
          </Link>
          <div className="scroll-on-dark flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-4">
            {groups.map((g, gi) => (
              <div key={g.key || gi} className={cn(gi > 0 && "mt-5")}>
                {g.key && GROUP_LABEL[g.key] && <p className="rail-group-title mb-1.5 truncate px-3 text-2xs font-semibold tracking-[0.08em] text-chrome-muted uppercase">{t(GROUP_LABEL[g.key]!)}</p>}
                <ul className="space-y-0.5">
                  {g.items.map((i) => <li key={i.href}><RailLink item={i} active={i === current} collapsed={collapsed} /></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t border-white/[0.07] p-2.5">
            <Tip side="right" label={<>{t("nav.expand")} <span className="ms-1 opacity-70">[</span></>} disabled={!collapsed}>
              <button type="button" onClick={() => setCollapsed(!collapsed)} className="rail-link flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-meta text-chrome-muted transition-colors hover:bg-white/[0.06] hover:text-white" aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} aria-pressed={collapsed} data-testid="rail-toggle">
                {collapsed ? <PanelLeftOpen className="size-[18px] shrink-0 stroke-[1.75] rtl:-scale-x-100" aria-hidden /> : <PanelLeftClose className="size-[18px] shrink-0 stroke-[1.75] rtl:-scale-x-100" aria-hidden />}
                <span className="rail-label flex-1 text-start">{t("nav.collapse")}</span>
                <span className="rail-label kbd border-white/15 bg-white/5 text-chrome-muted" aria-hidden>[</span>
              </button>
            </Tip>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="z-header flex h-[var(--header-h)] shrink-0 items-center gap-3 border-b border-rule bg-surface-raised px-3 md:px-6">
            <Link href="/" className="shrink-0 md:hidden" aria-label={t("crumb.home")}><Brand surface={surface} compact tone="onLight" /></Link>
            <nav aria-label={t("crumb.label")} className="hidden min-w-0 flex-1 md:block">
              <ol className="flex min-w-0 items-center gap-1.5 text-body text-steel">
                {crumbs.map((c, n) => (
                  <li key={`${n}:${c.label}`} className="flex min-w-0 items-center gap-1.5">
                    {n > 0 && <ChevronRight className="size-4 shrink-0 opacity-50 rtl:-scale-x-100" aria-hidden />}
                    {c.href ? <Link href={c.href} className="truncate rounded-sm hover:text-ink">{c.label}</Link> : <span aria-current={n === crumbs.length - 1 ? "page" : undefined} className={cn("truncate", n === crumbs.length - 1 && "font-semibold text-ink", c.mono && "ref")} dir={c.mono ? "ltr" : undefined}>{c.label}</span>}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="ms-auto flex items-center gap-1">
              <button type="button" onClick={() => setPalette(true)} data-testid="palette-trigger" className="flex h-9 items-center gap-2 rounded-lg border border-rule bg-surface-sunk px-3 text-steel transition-colors hover:border-rule-strong hover:text-ink max-md:size-9 max-md:justify-center max-md:border-transparent max-md:bg-transparent max-md:px-0 md:w-64 lg:w-80 pointer-coarse:max-md:size-11" aria-label={t("search.open")} aria-haspopup="dialog">
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="hidden min-w-0 flex-1 truncate text-start text-meta md:block">{goToHint}</span>
                <span className="kbd hidden md:inline-flex" dir="ltr">⌘K</span>
              </button>
              <Tip label={t("action.shortcuts")}><button type="button" className={cn(barBtn, "hidden lg:inline-flex")} onClick={() => setHelp(true)} aria-label={t("action.shortcuts")}><Keyboard aria-hidden /></button></Tip>
              {alerts && (
                <Popover label={t("bell.center")} tip={t("bell.center")} testId="bell" className={barBtn} trigger={<><Bell aria-hidden />{activeAlerts.length > 0 && <span className={cn("num absolute end-1 top-1 grid min-w-[1.05rem] place-items-center rounded-full px-1 text-2xs leading-4 font-bold ring-2 ring-surface-raised", urgent ? "bg-danger text-white" : "bg-orange text-navy-950")} data-testid="bell-count">{activeAlerts.length}</span>}</>}>
                  {(close) => (
                    <div>
                      <div className="flex items-start justify-between gap-3 px-2.5 pt-1.5 pb-2">
                        <div><p className="font-semibold">{t("bell.center")}</p><p className="text-caption text-steel">{t("bell.hint")}</p></div>
                        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-caption text-steel"><span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-steel")} aria-hidden />{live ? t("bell.live") : t("bell.polling")}</span>
                      </div>
                      {activeAlerts.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-3 py-6 text-center"><span className="grid size-10 place-items-center rounded-full bg-success-subtle text-success" aria-hidden><Bell className="size-[18px]" /></span><p className="text-steel">{t("bell.none")}</p></div>
                      ) : (
                        <ul className="space-y-0.5 border-t border-rule pt-1.5">
                          {activeAlerts.map((a) => {
                            const Icon = ALERT_ICON[a.tone]
                            return (
                              <li key={a.id}>
                                <Link href={a.href} onClick={close} className="flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover">
                                  <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", a.tone === "danger" ? "bg-danger-subtle text-danger" : a.tone === "warn" ? "bg-warning-subtle text-warning-subtle-fg" : "bg-info-subtle text-info-subtle-fg")} aria-hidden><Icon className="size-4" /></span>
                                  <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{a.label}</span>{ALERT_HELP[a.id] && <span className="block text-caption text-steel">{t(ALERT_HELP[a.id]!)}</span>}</span>
                                  <ChevronRight className="mt-2 size-4 shrink-0 text-steel rtl:-scale-x-100" aria-hidden />
                                </Link>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </Popover>
              )}
              <Popover label={t("user.menu")} testId="user-menu" width="w-[min(18.5rem,calc(100vw-1.5rem))]" className="ms-1 grid size-9 place-items-center rounded-full transition hover:ring-2 hover:ring-rule-strong pointer-coarse:size-11" trigger={<span className="grid size-8 place-items-center rounded-full bg-navy-900 text-caption font-semibold text-white uppercase dark:bg-[#24324d]" aria-hidden dir="auto">{initials || "·"}</span>}>
                {(close) => (
                  <div>
                    {me && (
                      <div className="flex items-center gap-3 px-2.5 pt-1.5 pb-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900 font-semibold text-white dark:bg-[#24324d]" aria-hidden>{initials || "·"}</span>
                        <div className="min-w-0"><p className="truncate font-semibold" dir="auto">{me.displayName}</p><p className="truncate text-caption text-steel">{me.roles.map((r) => r.replace(/_/g, " ")).join(" · ")}</p></div>
                      </div>
                    )}
                    <div className="space-y-3 border-t border-rule px-2.5 py-3">
                      <Segmented label={t("user.theme")} value={theme} onChange={setTheme} options={[{ value: "light", label: themeName("light"), icon: <Sun /> }, { value: "dark", label: themeName("dark"), icon: <Moon /> }, { value: "system", label: themeName("system"), icon: <Monitor /> }]} />
                      <Segmented label={t("user.density")} value={density} onChange={setDensity} options={(["comfortable", "compact"] as const).map((v) => ({ value: v, label: densityName(v) }))} />
                      <Segmented<Locale> label={t("user.language")} value={locale} onChange={setLocale} options={[{ value: "en", label: t("lang.en") }, { value: "fa", label: <span className="font-fa">{t("lang.fa")}</span> }]} />
                    </div>
                    <div className="border-t border-rule pt-1.5">
                      <Link href="/account" onClick={close} className="menu-item"><KeyRound className="size-4 text-steel" aria-hidden />{t("user.account")}</Link>
                      <button type="button" onClick={() => void signOut()} className="menu-item" data-testid="sign-out"><LogOut className="size-4 text-steel" aria-hidden />{t("action.signout")}</button>
                    </div>
                  </div>
                )}
              </Popover>
            </div>
          </header>
          {tabs && (
            <nav aria-label={current!.label} className="flex shrink-0 gap-1 overflow-x-auto border-b border-rule bg-surface-raised px-3 md:px-6" data-testid="section-tabs">
              {tabs.map((x) => {
                const on = x === tab
                return <Link key={x.href} href={x.href} aria-current={on ? "page" : undefined} className={cn("relative flex min-h-11 shrink-0 items-center px-3 text-body whitespace-nowrap transition-colors", on ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--indicator)]" : "text-steel hover:text-ink")}>{x.label}</Link>
              })}
            </nav>
          )}
          <main ref={mainRef} id="main" tabIndex={-1} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] [scrollbar-gutter:stable] focus:outline-none md:pb-0">{children}</main>
        </div>
      </div>
      <nav aria-label={t("nav.sections")} className="fixed inset-x-0 bottom-0 z-header grid border-t border-rule bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))` }} data-testid="bottom-bar">
        {mobileItems.map((i) => {
          const on = i === current
          return (
            <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 text-caption [&_svg]:size-5 [&_svg]:stroke-[1.75]", on ? "font-semibold text-ink" : "text-steel")}>
              {on && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-[var(--indicator)]" aria-hidden />}
              <span className="relative" aria-hidden>{i.icon}{i.count ? <span className={cn("num absolute -end-3 -top-1.5 min-w-4 rounded-full px-1 text-center text-2xs leading-4 font-bold", i.alert ? "bg-danger text-white" : "bg-orange text-navy-950")}>{i.count > 99 ? "99+" : i.count}</span> : null}</span>
              <span className="max-w-full truncate px-1">{i.short ?? i.label}</span>
            </Link>
          )
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" data-testid="more-button" className="flex min-h-14 flex-col items-center justify-center gap-1 text-caption text-steel"><Ellipsis className="size-5" aria-hidden /><span>{t("nav.more")}</span></button>
      </nav>
      {more && (
        <Modal label={t("nav.more")} onClose={() => setMore(false)} className="mt-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border border-rule-strong bg-surface-overlay p-4 pb-6 shadow-[var(--shadow-pop)] sm:mt-0 sm:max-w-md sm:rounded-2xl">
          <div className="mb-3 flex items-center justify-between"><p className="font-display text-section font-bold">{t("nav.more")}</p><button type="button" data-autofocus onClick={() => setMore(false)} aria-label={t("nav.close")} className="grid size-11 place-items-center rounded-lg hover:bg-hover"><X className="size-5" /></button></div>
          <ul className="space-y-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={i === current ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-hover [&_svg]:size-5", i === current && "bg-selected font-semibold text-selected-ink")}><span className="shrink-0 text-steel" aria-hidden>{i.icon ?? <Circle className="size-3" />}</span><span className="min-w-0 flex-1">{i.label}</span>{i.count ? <span className={cn("num rounded-full px-2 text-caption leading-5 font-semibold", i.alert ? "bg-danger text-white" : "bg-hover text-steel")}>{i.count}</span> : null}</Link>
                {i.tabs && i.tabs.length > 1 && (
                  <ul className="ms-11 mb-1 flex flex-wrap gap-1.5">
                    {i.tabs.map((x) => <li key={x.href}><Link href={x.href} className="inline-flex min-h-11 items-center rounded-full border border-rule px-3 text-meta text-steel hover:bg-hover hover:text-ink">{x.label}</Link></li>)}
                  </ul>
                )}
              </li>
            ))}
            <li><Link href="/account" className="flex min-h-12 items-center gap-3 rounded-lg px-3 hover:bg-hover"><KeyRound className="size-5 shrink-0 text-steel" aria-hidden />{t("user.account")}</Link></li>
          </ul>
        </Modal>
      )}
      {help && (
        <Modal label={t("help.title")} onClose={() => setHelp(false)} className="w-full max-w-md place-self-center rounded-2xl border border-rule-strong bg-surface-overlay p-5 shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between"><p className="font-display text-section font-bold">{t("help.title")}</p><button type="button" data-autofocus onClick={() => setHelp(false)} aria-label={t("nav.close")} className="grid size-9 place-items-center rounded-lg hover:bg-hover pointer-coarse:size-11"><X className="size-4" /></button></div>
          <dl className="ledger-rows mt-3">
            {SHORTCUTS.filter(([, v]) => surface === "admin" || v === "help.palette" || v === "help.help" || v === "help.rail").map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 py-2.5"><dt className="flex flex-wrap gap-1" dir="ltr">{k.split(" · ").map((x) => <span key={x} className="kbd">{x}</span>)}</dt><dd className="text-end text-steel">{t(v)}</dd></div>)}
          </dl>
        </Modal>
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={palItems} goTo={goTo} t={t as T} />
    </div>
  )
}

function GateScreen({ surface, title, children }: { surface: Surface; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-surface p-6">
      <div className="w-full max-w-sm rounded-2xl border border-rule bg-surface-raised p-6 shadow-[var(--shadow-sm)]">
        <Brand surface={surface} tone="onLight" />
        <h1 className="mt-6 font-display text-title font-bold">{title}</h1>
        <div className="mt-2">{children}</div>
      </div>
    </main>
  )
}

/** Session gate for every console screen: signed in, second factor verified, and allowed on this host's surface. */
export function Gate({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  const { me, loading, reload } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const t = useT()
  useEffect(() => { if (!loading && !me) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`) }, [loading, me, router, pathname])
  if (loading || !me) return <div className="grid min-h-dvh place-items-center bg-surface text-steel" role="status" aria-busy><span className="flex items-center gap-3"><LogoMark size={28} className="animate-pulse" />{t("shell.loading")}</span></div>
  // Panel access first: a phone with no role here must not be walked through second-factor enrolment.
  const allowed = surface === "dev" ? me.surfaces.developer : me.surfaces.admin
  if (!allowed) {
    return (
      <GateScreen surface={surface} title={surface === "dev" ? t("shell.noAccess.dev") : t("shell.noAccess.admin")}>
        <p className="text-steel"><ShieldAlert className="me-1.5 inline size-4 align-[-3px]" aria-hidden />{t("shell.noAccess.body", { roles: me.roles.join(", ") || "—" })}</p>
      </GateScreen>
    )
  }
  if (me.mfa.level < 1) {
    return <GateScreen surface={surface} title={t("shell.mfa")}><div className="mt-2">{me.mfa.enrolled.length ? <TotpVerify onDone={reload} passkey /> : <TotpEnrol onDone={reload} />}</div></GateScreen>
  }
  return <StepUpProvider>{children}</StepUpProvider>
}
