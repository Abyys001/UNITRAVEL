"use client"

import { forwardRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

import { Empty } from "./ui"

/** Internal notes and customer messages side by side but visually distinct: notes are hatched orange, never sent. */
export function NotesList({ notes }: { notes: { id: string; body: string; author: string | null; createdAt: string }[] }) {
  if (!notes.length) return <Empty>No internal notes yet.</Empty>
  return (
    <ul className="space-y-2" data-testid="notes">
      {notes.map((n) => (
        <li key={n.id} className="rounded-md border border-s-[3px] border-warning-border border-s-orange bg-warning-subtle px-3 py-2">
          <p className="whitespace-pre-wrap" dir="auto">{n.body}</p>
          <p className="mt-1 text-caption text-steel">{n.author ?? "Staff"} · {fmtDateTime(n.createdAt)}</p>
        </li>
      ))}
    </ul>
  )
}

export function MessagesList({ messages }: { messages: { id: string; direction: string; body: string; authorName: string; createdAt: string }[] }) {
  if (!messages.length) return <Empty>No messages with the customer.</Empty>
  return (
    <ul className="space-y-2" data-testid="messages">
      {messages.map((m) => {
        const out = m.direction === "TO_CUSTOMER"
        return (
          <li key={m.id} className={cn("max-w-[88%] rounded-lg border px-3 py-2", out ? "ms-auto border-info-border bg-info-subtle" : "border-rule bg-surface-raised")}>
            <p className="whitespace-pre-wrap" dir="auto">{m.body}</p>
            <p className="mt-1 text-caption text-steel">{out ? `${m.authorName} → customer` : <span dir="auto">{m.authorName}</span>} · {fmtDateTime(m.createdAt)}</p>
          </li>
        )
      })}
    </ul>
  )
}

export const Composer = forwardRef<HTMLTextAreaElement, { placeholder: string; label: string; onSend: (body: string) => Promise<unknown>; tone?: "note" | "message"; testId?: string; hint?: string }>(function Composer({ placeholder, label, onSend, tone = "message", testId, hint }, ref) {
  const t = useT()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!body.trim()) return
    setBusy(true)
    try { await onSend(body.trim()); setBody("") } finally { setBusy(false) }
  }
  return (
    <form onSubmit={send} className={cn("mt-3 rounded-lg border bg-surface-raised p-2 focus-within:border-ink-muted", tone === "note" ? "border-s-[3px] border-warning-border border-s-orange" : "border-rule")} data-testid={testId}>
      {hint && <p className="px-1 pb-1 text-meta font-medium text-ink">{hint}</p>}
      <textarea ref={ref} aria-label={label} placeholder={placeholder} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" rows={2} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e) ; if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur() }}
        className="field-input min-h-16 w-full" />
      <div className="mt-2 flex items-center justify-between gap-2"><span className="text-caption text-steel max-md:hidden pointer-coarse:hidden"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> {t("case.composer.send")}</span><Button size="sm" type="submit" loading={busy} disabled={!body.trim()}>{label}</Button></div>
    </form>
  )
})
