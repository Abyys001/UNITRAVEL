"use client"

import { CircleHelp } from "lucide-react"
import { useEffect, useState } from "react"

import { type MsgKey, useT } from "@/lib/i18n"

const STORE = "ut:guide-closed:"

/**
 * ADR-0039 D5: "How this works" on Admin Panel sections whose purpose is not obvious. Open until the person closes it
 * once (remembered per browser; storage failures just leave it open).
 */
export function PageGuide({ id, title, points }: { id: string; title: MsgKey; points: MsgKey[] }) {
  const t = useT()
  const [open, setOpen] = useState(true)
  useEffect(() => { try { if (localStorage.getItem(STORE + id) === "1") setOpen(false) } catch { /* private mode */ } }, [id])
  const toggle = (next: boolean) => { setOpen(next); try { localStorage.setItem(STORE + id, next ? "0" : "1") } catch { /* private mode */ } }
  return (
    <details open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; if (o !== open) toggle(o) }}
      className="mx-4 mb-4 rounded-[var(--radius-card)] border border-rule bg-surface-raised shadow-[var(--shadow-xs)] md:mx-6" data-testid={`guide-${id}`}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 font-medium text-ink [&::-webkit-details-marker]:hidden">
        <CircleHelp className="size-4 shrink-0 text-link" aria-hidden />
        <span className="flex-1">{t(title)}</span>
        <span className="text-caption font-normal text-steel">{open ? t("guide.hide") : t("guide.show")}</span>
      </summary>
      <ul className="grid gap-x-8 gap-y-2 border-t border-rule px-4 py-3 text-meta text-steel md:grid-cols-2">
        {points.map((p) => <li key={p} className="relative ps-4 before:absolute before:start-0 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-rule-strong">{t(p)}</li>)}
      </ul>
    </details>
  )
}
