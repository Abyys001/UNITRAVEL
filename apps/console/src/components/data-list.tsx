"use client"

import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { useT } from "@/lib/i18n"

/**
 * Shared list kit for console tables: one toolbar (search, filter chips, extra controls, result count), a client-side
 * pager for lists the API returns whole, and the table classes every list uses so rows, headers and density match.
 */

export const tableClass = "data-table w-full"

export function Toolbar({ query, onQuery, placeholder, count, children, className }: { query?: string; onQuery?: (q: string) => void; placeholder?: string; count?: number; children?: React.ReactNode; className?: string }) {
  const t = useT()
  return (
    <div className={cn("flex flex-wrap items-center gap-2 px-4 py-3 md:px-6", className)} data-testid="list-toolbar">
      {onQuery && (
        <label className="relative min-w-48 flex-1 md:max-w-80">
          <span className="sr-only">{placeholder ?? t("list.search")}</span>
          <Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto size-4 text-steel" aria-hidden />
          <input type="search" className="field-input ps-8" value={query ?? ""} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder ?? t("list.search")} dir="auto" />
        </label>
      )}
      {children}
      {count != null && <span className="ms-auto text-[12px] text-steel" aria-live="polite">{t("list.count", { n: count })}</span>}
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
          <button key={o.value || "all"} type="button" aria-pressed={on} onClick={() => onChange(o.value)} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] pointer-coarse:min-h-11", on ? "border-navy-900 bg-navy-900 text-white dark:border-white/80 dark:bg-white/90 dark:text-navy-950" : "border-rule-strong text-steel hover:border-steel hover:text-ink")}>
            {o.label}{o.count != null && <span className="num text-[11px]">{o.count}</span>}
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
  const btn = "inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-rule-strong text-steel hover:text-ink disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
  return (
    <nav aria-label={t("list.pages")} className={cn("flex items-center justify-end gap-2 px-4 py-3 text-[12px] text-steel md:px-6", className)} data-testid="pager">
      <span className="num">{t("list.range", { a: page * size + 1, b: Math.min(total, (page + 1) * size), n: total })}</span>
      <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page === 0} aria-label={t("list.prev")}><ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden /></button>
      <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label={t("list.next")}><ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden /></button>
    </nav>
  )
}

/** A white card that holds a table (or list) under the toolbar, with the same gutters as the page head. */
export function ListCard({ children, className, ...rest }: React.ComponentProps<"div">) {
  return <div className={cn("mx-4 mb-4 overflow-hidden rounded-xl border border-rule bg-surface-raised shadow-[var(--tile-shadow)] md:mx-6", className)} {...rest}>{children}</div>
}
