"use client"

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { useT } from "@/lib/i18n"

/**
 * Shared list kit for console tables (audit P0 #1, #4):
 *   <ListPage>      page column that fills <main>; on md+ the list card takes the remaining height
 *   <Toolbar>       search, filter chips, extra controls; the result count sits in a fixed slot, so filtering never reflows it
 *   <Chips>         single-choice filter pills with counts
 *   <ListCard>      the card; holds <GridScroll> (the scroll container, both axes) and an optional <Pager> footer
 *   <GridScroll>    sticky header pins to its top edge with no gap; wide tables scroll sideways inside the card
 *   usePaged / <Pager>  client-side paging for lists the API returns whole
 */

export const tableClass = "data-table"

export function ListPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex min-h-full flex-col md:h-full", className)}>{children}</div>
}

export function Toolbar({ query, onQuery, placeholder, count, children, trailing, className }: { query?: string; onQuery?: (q: string) => void; placeholder?: string; count?: number; children?: React.ReactNode; trailing?: React.ReactNode; className?: string }) {
  const t = useT()
  return (
    <div className={cn("flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3 md:px-6", className)} data-testid="list-toolbar">
      {onQuery && (
        <label className="relative w-full sm:w-72">
          <span className="sr-only">{placeholder ?? t("list.search")}</span>
          <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-ink-subtle" aria-hidden />
          <input type="search" className="field-input field-search pe-8 [&::-webkit-search-cancel-button]:hidden" value={query ?? ""} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder ?? t("list.search")} dir="auto" />
          {query ? <button type="button" onClick={() => onQuery("")} aria-label={t("list.clearSearch")} className="absolute inset-y-0 end-1.5 my-auto grid size-6 place-items-center rounded-md text-steel hover:bg-hover hover:text-ink"><X className="size-3.5" aria-hidden /></button> : null}
        </label>
      )}
      {children}
      <div className="ms-auto flex items-center gap-2">
        {trailing}
        {/* Fixed slot: always rendered (empty until known) so nothing jumps when the count appears or changes. */}
        <span className="num min-w-20 text-end text-meta text-steel" aria-live="polite" data-testid="list-count">{count != null ? t("list.count", { n: count }) : ""}</span>
      </div>
    </div>
  )
}

/** Single-choice filter chips with optional counts (status, type). `value` "" means all. */
export function Chips<V extends string>({ label, value, options, onChange }: { label: string; value: V | ""; options: { value: V | ""; label: string; count?: number }[]; onChange: (v: V | "") => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value || "all"} type="button" aria-pressed={on} onClick={() => onChange(o.value)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-meta font-medium transition-colors pointer-coarse:min-h-11",
            on ? "border-navy-900 bg-navy-900 text-white dark:border-[#bcd9ff] dark:bg-[#bcd9ff] dark:text-[#0b1220]" : "border-rule-strong bg-surface-raised text-steel hover:border-control hover:text-ink")}>
            {o.label}{o.count != null && <span className={cn("num rounded-full px-1.5 text-2xs leading-4 font-semibold", on ? "bg-white/20" : "bg-surface-sunk text-steel")}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Client-side paging; resets to page 1 whenever the input list changes length (new filter or search). */
export function usePaged<R>(rows: R[], size = 25) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / size))
  useEffect(() => { setPage(0) }, [rows.length])
  const slice = useMemo(() => rows.slice(page * size, page * size + size), [rows, page, size])
  return { rows: slice, page, pages, setPage, total: rows.length, size }
}

export function Pager({ page, pages, setPage, total, size, className }: { page: number; pages: number; setPage: (p: number) => void; total: number; size: number; className?: string }) {
  const t = useT()
  if (pages <= 1) return null
  const btn = "inline-flex size-8 items-center justify-center rounded-lg border border-rule-strong bg-surface-raised text-steel transition-colors hover:border-control hover:text-ink disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-11"
  return (
    <nav aria-label={t("list.pages")} className={cn("flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-meta text-steel", className)} data-testid="pager">
      <span className="num">{t("list.range", { a: page * size + 1, b: Math.min(total, (page + 1) * size), n: total })}</span>
      <span className="flex items-center gap-1.5">
        <span className="num me-1.5 hidden sm:inline">{t("list.page", { p: page + 1, n: pages })}</span>
        <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page === 0} aria-label={t("list.prev")}><ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden /></button>
        <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label={t("list.next")}><ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden /></button>
      </span>
    </nav>
  )
}

/**
 * The list card. `className` styles the outer slot (spacing, visibility), `cardClassName` the card. With `fill` (full-page
 * lists inside <ListPage>) the slot takes the remaining height on md+ and the card is capped to it, so the table scrolls
 * inside the card with its header pinned; a short list is still a short card.
 */
export function ListCard({ children, className, cardClassName, fill, ...rest }: React.ComponentProps<"div"> & { cardClassName?: string; fill?: boolean }) {
  return (
    <div className={cn("mx-4 mb-4 flex min-h-0 flex-col md:mx-6 md:mb-6", fill && "md:flex-1", className)} {...rest}>
      <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface-raised shadow-[var(--tile-shadow)]", fill && "md:max-h-full", cardClassName)}>{children}</div>
    </div>
  )
}

/** Scroll container for a data table: header sticks at its top edge, wide content scrolls sideways inside the card. */
export function GridScroll({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return <div tabIndex={0} role="region" aria-label={label ?? "Table"} className={cn("grid-scroll min-h-0 flex-1 focus-visible:outline-offset-[-2px]", className)}>{children}</div>
}
