"use client"

import { ChevronDown, Search } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"

import type { Item, Locale } from "@unitravel/i18n"

import { Blocks } from "@/components/content-blocks"
import { useI18n } from "@/lib/i18n"

const plain = (i: Item) => `${i.heading} ${i.blocks.map((b) => ("text" in b ? b.text : "items" in b ? JSON.stringify(b.items) : "")).join(" ")}`.toLowerCase()

/** Animated FAQ: height animates through grid rows (no layout JS), search filters, `#id` deep links open their item. Keyboard and AT: each heading is a button with aria-expanded controlling a labelled region. */
export function FaqAccordion({ items, locale }: { items: Item[]; locale: Locale }) {
  const { t } = useI18n()
  const base = useId()
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id && items.some((i) => i.id === id)) {
      setOpen(new Set([id]))
      document.getElementById(id)?.scrollIntoView({ block: "center" })
    }
  }, [items])
  const index = useMemo(() => items.map((i) => [i, plain(i)] as const), [items])
  const shown = q.trim() ? index.filter(([, text]) => text.includes(q.trim().toLowerCase())).map(([i]) => i) : items
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n })
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-steel" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("faq.search")} aria-label={t("faq.search")} className="field h-11 w-full ps-10" data-testid="faq-search" />
        </label>
        <button type="button" className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold text-royal hover:bg-cloud" onClick={() => setOpen(open.size ? new Set() : new Set(items.map((i) => i.id)))}>
          {open.size ? t("faq.collapseAll") : t("faq.expandAll")}
        </button>
      </div>
      <ol className="space-y-3">
        {shown.map((it, n) => {
          const isOpen = open.has(it.id)
          const panel = `${base}-${it.id}`
          return (
            <li key={it.id} id={it.id} data-testid="faq-item" data-open={isOpen} className={`group rounded-2xl border bg-white transition-[box-shadow,border-color,transform] duration-300 ${isOpen ? "border-orange/60 shadow-[0_14px_34px_-22px_rgb(6_31_76/0.45)]" : "border-line hover:-translate-y-0.5 hover:border-royal/40"}`}>
              <h3>
                <button type="button" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(it.id)} className="flex w-full items-start gap-4 rounded-2xl px-4 py-4 text-start md:px-6">
                  <span aria-hidden className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-sm font-extrabold transition-colors duration-300 ${isOpen ? "bg-orange text-white" : "bg-cloud text-royal"}`}>{n + 1}</span>
                  <span className="flex-1 font-bold leading-snug text-navy-950">{it.heading}</span>
                  <ChevronDown aria-hidden className={`mt-1 size-5 shrink-0 text-royal transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
                </button>
              </h3>
              <div id={panel} role="region" aria-label={it.heading} className={`grid transition-[grid-template-rows,visibility] duration-300 ease-out motion-reduce:transition-none ${isOpen ? "visible grid-rows-[1fr]" : "invisible grid-rows-[0fr]"}`} {...(!isOpen ? { inert: true } : {})}>
                <div className="overflow-hidden"><div className="px-4 pb-5 ps-[4.25rem] pe-4 md:pe-6"><Blocks blocks={it.blocks} locale={locale} /></div></div>
              </div>
            </li>
          )
        })}
      </ol>
      {shown.length === 0 && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-steel" role="status">{t("faq.noMatch")}</p>}
    </div>
  )
}
