"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"

import type { CustomerTicketView } from "@unitravel/contracts"
import { LoadingState } from "@unitravel/ui/product/states"

import { Ltr } from "@/components/badges"
import { api, ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

export default function TicketPage() {
  const { ref } = useParams<{ ref: string }>()
  const { t, href, date } = useI18n()
  const { me } = useRequireSignIn()
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const q = useQuery({ queryKey: ["support-ticket", ref], queryFn: () => api<CustomerTicketView>(`/v1/support/tickets/${ref}`), enabled: !!me, refetchInterval: 20_000 })
  const send = useMutation({
    mutationFn: () => api<CustomerTicketView>(`/v1/support/tickets/${ref}/messages`, { body: { body: body.trim() } }),
    onSuccess: (v) => { qc.setQueryData(["support-ticket", ref], v); setBody("") },
  })
  const d = q.data
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <Link href={href("/support")} className="inline-flex items-center gap-2 text-sm font-semibold text-royal"><ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("support.back")}</Link>
      {q.isLoading && <LoadingState className="mt-6" label={t("common.loading")} rows={3} />}
      {d && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <h1 className="font-display text-2xl md:text-3xl" dir="auto">{d.subject}</h1>
            <span className="rounded-full bg-cloud px-3 py-1 text-xs font-semibold">{t(`support.status.${d.status}`)}</span>
          </div>
          <p className="mt-1 text-xs text-steel"><Ltr className="font-mono">{d.ref}</Ltr></p>
          <ol className="mt-6 space-y-3" data-testid="ticket-thread">
            {d.messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${m.direction === "FROM_CUSTOMER" ? "ms-auto bg-navy-950 text-white" : "bg-white ring-1 ring-line"}`}>
                <p className="whitespace-pre-wrap leading-6" dir="auto">{m.body}</p>
                <p className={`mt-1 text-xs ${m.direction === "FROM_CUSTOMER" ? "text-white/70" : "text-steel"}`}>{m.authorName} · {date(m.createdAt, { withTime: true })}</p>
              </li>
            ))}
          </ol>
          {d.canReply ? (
            <form className="mt-6 space-y-3" onSubmit={(e) => { e.preventDefault(); if (body.trim() && !send.isPending) send.mutate() }}>
              <textarea aria-label={t("support.reply")} className="field min-h-24 w-full" dir="auto" maxLength={4000} placeholder={t("support.replyPlaceholder")} value={body} onChange={(e) => setBody(e.target.value)} />
              {send.isError && <p role="alert" className="text-sm text-danger">{send.error instanceof ApiError ? send.error.message : String(send.error)}</p>}
              <button type="submit" className="btn-orange" disabled={!body.trim() || send.isPending}>{t("support.reply")}</button>
            </form>
          ) : <p className="mt-6 rounded-xl bg-cloud px-4 py-3 text-sm text-steel">{t("support.closed")}</p>}
        </>
      )}
    </div>
  )
}
