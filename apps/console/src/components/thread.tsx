"use client"

import { forwardRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { fmtDateTime } from "@/lib/format"

import { Empty } from "./ui"

/** Internal notes and customer messages side by side but visually distinct: notes are hatched orange, never sent. */
export function NotesList({ notes }: { notes: { id: string; body: string; author: string | null; createdAt: string }[] }) {
  if (!notes.length) return <Empty>No internal notes yet.</Empty>
  return (
    <ul className="space-y-1.5" data-testid="notes">
      {notes.map((n) => (
        <li key={n.id} className="rounded-sm border-s-2 border-orange bg-warning-subtle px-2 py-1.5">
          <p className="whitespace-pre-wrap" dir="auto">{n.body}</p>
          <p className="mt-0.5 text-[11px] text-steel">{n.author ?? "Staff"} · {fmtDateTime(n.createdAt)}</p>
        </li>
      ))}
    </ul>
  )
}

export function MessagesList({ messages }: { messages: { id: string; direction: string; body: string; authorName: string; createdAt: string }[] }) {
  if (!messages.length) return <Empty>No messages with the customer.</Empty>
  return (
    <ul className="space-y-1.5" data-testid="messages">
      {messages.map((m) => {
        const out = m.direction === "TO_CUSTOMER"
        return (
          <li key={m.id} className={cn("max-w-[92%] rounded-md border px-2 py-1.5", out ? "ms-auto border-info-border bg-info-subtle" : "border-rule bg-surface-raised")}>
            <p className="whitespace-pre-wrap" dir="auto">{m.body}</p>
            <p className="mt-0.5 text-[11px] text-steel">{out ? `${m.authorName} → customer` : <span dir="auto">{m.authorName}</span>} · {fmtDateTime(m.createdAt)}</p>
          </li>
        )
      })}
    </ul>
  )
}

export const Composer = forwardRef<HTMLTextAreaElement, { placeholder: string; label: string; onSend: (body: string) => Promise<unknown>; tone?: "note" | "message"; testId?: string }>(function Composer({ placeholder, label, onSend, tone = "message", testId }, ref) {
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); if (!body.trim()) return
    setBusy(true)
    try { await onSend(body.trim()); setBody("") } finally { setBusy(false) }
  }
  return (
    <form onSubmit={send} className="mt-2 space-y-1.5" data-testid={testId}>
      <textarea ref={ref} aria-label={label} placeholder={placeholder} value={body} onChange={(e) => setBody(e.target.value)} dir="auto" rows={2} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(e) ; if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur() }}
        className={cn("field-input min-h-14", tone === "note" && "border-orange/60 bg-warning-subtle")} />
      <div className="flex items-center justify-between"><span className="text-[11px] text-steel"><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> to send</span><Button size="xs" type="submit" variant={body.trim() ? "default" : "outline"} loading={busy} disabled={!body.trim()}>{label}</Button></div>
    </form>
  )
})
