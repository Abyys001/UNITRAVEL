"use client"

import { CornerDownLeft, Search } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import { cn } from "@unitravel/ui/lib/utils"

import { type T } from "@/lib/i18n"

export interface PaletteItem { id: string; label: string; group: string; hint?: string; icon?: React.ReactNode; keywords?: string; run: () => void }

/**
 * Command palette (Cmd/Ctrl+K or `/`): jump to any section, run a console action, or type a reference/phone/name and
 * press Enter to use the surface's own go-to resolver. Combobox + listbox pattern, focus stays in the input, focus is
 * restored on close; the dialog is modal so page shortcuts (j/k/c/n) ignore it via [role=dialog].
 */
export function CommandPalette({ open, onClose, items, goTo, t }: { open: boolean; onClose: () => void; items: PaletteItem[]; goTo: (q: string) => PaletteItem | null; t: T }) {
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const returnTo = useRef<Element | null>(null)
  const uid = useId()

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hits = needle ? items.filter((i) => `${i.label} ${i.group} ${i.keywords ?? ""}`.toLowerCase().includes(needle)) : items
    const go = needle ? goTo(q.trim()) : null
    if (!go) return hits
    // A page whose own name contains the text ("lanes" → Cargo lanes) beats the surface's free-text search.
    const named = needle.length >= 3 ? hits.filter((i) => i.label.toLowerCase().includes(needle)) : []
    return [...named, go, ...hits.filter((i) => !named.includes(i))]
  }, [q, items, goTo])

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement
    setQ("")
    setActive(0)
    inputRef.current?.focus()
    return () => { (returnTo.current as HTMLElement | null)?.focus?.() }
  }, [open])
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" }) }, [active])

  if (!open) return null
  const run = (i: PaletteItem | undefined) => { if (!i) return; onClose(); i.run() }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose() }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === "Home") { e.preventDefault(); setActive(0) }
    else if (e.key === "End") { e.preventDefault(); setActive(results.length - 1) }
    else if (e.key === "Enter") { e.preventDefault(); run(results[active]) }
    else if (e.key === "Tab") e.preventDefault() // focus is kept in the dialog: the input is the only tab stop
  }
  let lastGroup = ""
  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-items-center bg-navy-950/55 p-3 pt-[12dvh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("search.open")} data-testid="palette" onKeyDown={onKey} onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xl overflow-hidden rounded-xl border border-rule-strong bg-surface-raised shadow-2xl">
        <div className="flex items-center gap-2 border-b border-rule px-3">
          <Search className="size-4 shrink-0 text-steel" aria-hidden />
          <input
            ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={results[active] ? `${uid}-${active}` : undefined} aria-autocomplete="list"
            placeholder={t("search.placeholder")} aria-label={t("search.open")}
            className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none focus-visible:outline-none placeholder:text-steel"
          />
          <span className="kbd">Esc</span>
        </div>
        <ul id={`${uid}-list`} ref={listRef} role="listbox" aria-label={t("search.open")} className="max-h-[50dvh] overflow-y-auto p-1.5">
          {results.length === 0 && <li role="presentation" className="px-3 py-6 text-center text-steel">{t("search.none")}</li>}
          {results.map((r, idx) => {
            const head = r.group !== lastGroup
            lastGroup = r.group
            return (
              <li key={r.id} role="presentation">
                {head && <p className="cap px-2 pt-2 pb-1" role="presentation">{r.group}</p>}
                <div
                  id={`${uid}-${idx}`} data-idx={idx} role="option" aria-selected={idx === active} onMouseMove={() => setActive(idx)} onClick={() => run(r)}
                  className={cn("flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5", idx === active && "bg-hover outline outline-1 -outline-offset-1 outline-orange/60")}
                >
                  <span className="grid size-5 shrink-0 place-items-center text-steel" aria-hidden>{r.icon}</span>
                  <span className="min-w-0 flex-1 truncate" dir="auto">{r.label}</span>
                  {r.hint && <span className="num text-[11px] text-steel">{r.hint}</span>}
                  {idx === active && <CornerDownLeft className="size-3.5 text-steel rtl:-scale-x-100" aria-hidden />}
                </div>
              </li>
            )
          })}
        </ul>
        <p className="border-t border-rule px-3 py-1.5 text-[11px] text-steel">{t("search.hint")}</p>
      </div>
    </div>
  )
}
