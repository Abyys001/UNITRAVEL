"use client"

import { useQueryClient } from "@tanstack/react-query"
import { LogOut } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { api } from "@/lib/api"
import { type Surface, useSession } from "@/lib/session"

import { StepUpProvider, TotpEnrol, TotpVerify } from "./mfa"

export function Brand({ surface, compact = false }: { surface: Surface; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-6 shrink-0" aria-hidden><circle cx="16" cy="16" r="15" fill="#13263f" stroke="#c98d5b" strokeWidth="1" /><path d="M7 21 C 11 9, 21 9, 25 13" stroke="#c98d5b" strokeWidth="2.4" fill="none" strokeLinecap="round" /><circle cx="7" cy="21" r="2.4" fill="#fbf9f5" /><circle cx="25" cy="13" r="2.4" fill="#c98d5b" /></svg>
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase">Uni Travel{!compact && <span className="text-copper"> · {surface === "dev" ? "Workshop" : "Admin"}</span>}</span>
    </span>
  )
}

export interface NavItem { href: string; label: string; count?: number | null; alert?: boolean; mobile?: boolean; icon?: React.ReactNode }
export interface NavSection { title: string; items: NavItem[] }

function isActive(pathname: string, search: string, href: string) {
  const [p, q] = href.split("?")
  if (p === "/") return pathname === "/"
  if (q) return pathname === p && search.includes(q)
  return pathname === p || pathname.startsWith(`${p}/`)
}

/**
 * Console frame: a thin ink bar with the go-to box, a ledger-style index rail on desktop and a bottom bar on phones
 * (mobile admin mode, ch. 15.8). The dev host carries the hatched workshop strip on every screen.
 */
export function Shell({ surface, sections, children, onGoTo, goToHint }: { surface: Surface; sections: NavSection[]; children: React.ReactNode; onGoTo: (q: string) => string | null; goToHint: string }) {
  const { me } = useSession()
  const router = useRouter()
  const qc = useQueryClient()
  const pathname = usePathname()
  const [search, setSearch] = useState("")
  const [go, setGo] = useState("")
  const [help, setHelp] = useState(false)
  const goRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setSearch(window.location.search) }, [pathname])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return
      if (e.key === "/" ) { e.preventDefault(); goRef.current?.focus() }
      if (e.key === "?") setHelp((h) => !h)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const signOut = async () => {
    try { await api("/v1/auth/logout", { method: "POST", body: {} }) } catch { /* the session may already be gone */ }
    qc.clear()
    router.replace("/sign-in")
  }
  const mobileItems = sections.flatMap((s) => s.items).filter((i) => i.mobile)
  return (
    <div className="flex min-h-dvh flex-col">
      {surface === "dev" && <div className="workshop-strip h-1.5 shrink-0" data-testid="workshop-strip" />}
      <header className={cn("sticky top-0 z-30 flex h-11 shrink-0 items-center gap-3 px-3 text-paper", surface === "dev" ? "bg-[#1b2a22]" : "bg-ink")}>
        <Link href="/" className="shrink-0"><Brand surface={surface} /></Link>
        <form className="ms-2 hidden max-w-md flex-1 md:block" onSubmit={(e) => { e.preventDefault(); const to = onGoTo(go.trim()); if (to) { router.push(to); setGo(""); goRef.current?.blur() } }}>
          <label className="relative block">
            <span className="sr-only">Go to</span>
            <input ref={goRef} value={go} onChange={(e) => setGo(e.target.value)} placeholder={goToHint} className="h-7 w-full rounded-sm border border-white/15 bg-white/5 px-2 pe-8 font-mono text-[12px] text-paper placeholder:text-paper/45 focus-visible:outline-copper" dir="ltr" />
            <span className="kbd absolute end-1.5 top-1 bg-transparent text-paper/60">/</span>
          </label>
        </form>
        <div className="ms-auto flex items-center gap-3">
          <button type="button" className="hidden text-paper/60 hover:text-paper md:inline" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts"><span className="kbd bg-transparent text-paper/70">?</span></button>
          {me && <span className="hidden text-end leading-tight sm:block"><span className="block" dir="auto">{me.displayName}</span><span className="block font-mono text-[10px] text-paper/55">{me.roles.join(" · ")}</span></span>}
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-paper/80 hover:bg-white/10 hover:text-paper"><LogOut className="size-3.5" /><span className="hidden sm:inline">Sign out</span></button>
        </div>
      </header>
      <div className="flex flex-1">
        <nav aria-label="Sections" className="sticky top-11 hidden h-[calc(100dvh-2.75rem)] w-52 shrink-0 overflow-y-auto border-e border-rule bg-paper py-3 md:block">
          {sections.map((s) => (
            <div key={s.title} className="mb-4">
              <p className="cap px-4 pb-1">{s.title}</p>
              <ul>
                {s.items.map((i) => {
                  const active = isActive(pathname, search, i.href)
                  return (
                    <li key={i.href}>
                      <Link href={i.href} aria-current={active ? "page" : undefined} className={cn("flex items-center justify-between px-4 py-1 hover:bg-mist/50", active && "row-focus font-medium")}>
                        <span className="truncate">{i.label}</span>
                        {i.count != null && <span data-testid="nav-count" className={cn("num text-[11px]", i.alert && i.count > 0 ? "rounded-sm bg-brick px-1 text-paper" : "text-slate")}>{i.count}</span>}
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
      {mobileItems.length > 0 && (
        <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-rule bg-paper md:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}>
          {mobileItems.map((i) => (
            <Link key={i.href} href={i.href} className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px]", isActive(pathname, search, i.href) ? "text-ink font-medium" : "text-slate")}>
              {i.icon}
              <span>{i.label}{i.count ? <span className="num ms-1 text-copper-700">{i.count}</span> : null}</span>
            </Link>
          ))}
        </nav>
      )}
      {help && (
        <div role="dialog" aria-label="Keyboard shortcuts" className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-lg border border-rule bg-paper p-5" onClick={(e) => e.stopPropagation()}>
            <p className="font-display text-lg">Keyboard</p>
            <dl className="ledger-rows mt-3">
              {[["/", "Go to a reference or search"], ["j / k", "Next / previous row in a queue"], ["Enter", "Open the focused row"], ["c", "Claim the focused or open case"], ["n", "Add an internal note"], ["m", "Write a message to the customer"], ["?", "This help"]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5"><dt><span className="kbd">{k}</span></dt><dd className="text-slate">{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

/** Session gate for every console screen: signed in, second factor verified, and allowed on this host's surface. */
export function Gate({ surface, children }: { surface: Surface; children: React.ReactNode }) {
  const { me, loading, reload } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => { if (!loading && !me) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`) }, [loading, me, router, pathname])
  if (loading || !me) return <div className="grid min-h-dvh place-items-center text-slate" aria-busy>Loading…</div>
  if (me.mfa.level < 1) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-6">
        <div className="w-full max-w-sm">
          <Brand surface={surface} />
          <h1 className="mt-6 font-display text-2xl">Second factor</h1>
          <div className="mt-4">{me.mfa.enrolled.length ? <TotpVerify onDone={reload} passkey /> : <TotpEnrol onDone={reload} />}</div>
        </div>
      </main>
    )
  }
  const allowed = surface === "dev" ? me.surfaces.developer : me.surfaces.admin
  if (!allowed) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
        <div className="max-w-sm">
          <Brand surface={surface} />
          <h1 className="mt-6 font-display text-2xl">No access to the {surface === "dev" ? "Developer" : "Admin"} Panel</h1>
          <p className="mt-2 text-slate">Your roles ({me.roles.join(", ") || "none"}) do not include this panel. Ask an owner if you need it.</p>
        </div>
      </main>
    )
  }
  return <StepUpProvider>{children}</StepUpProvider>
}
