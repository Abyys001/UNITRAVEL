"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { Button } from "@unitravel/ui/components/button"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

interface Inbox { items: { id: string; title: string; body: string; readAt: string | null; createdAt: string; critical: boolean; data: { linkPath?: string } }[]; unread: number }

/** The in-app inbox is the system of record for every notification (ch. 17.1). */
export default function InboxPage() {
  const { t, href, date } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["inbox"], queryFn: () => api<Inbox>("/v1/notifications?limit=50"), enabled: !!me, refetchInterval: 30_000 })
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-end justify-between"><h1 className="font-display text-3xl">{t("inbox.title")}</h1>{!!q.data?.unread && <Button variant="outline" size="sm" onClick={async () => { await api("/v1/notifications/read", { body: { all: true } }); void q.refetch() }}>{t("inbox.markAll")}</Button>}</div>
      {!q.data?.items.length && <p className="mt-6 text-slate">{t("inbox.empty")}</p>}
      <ul className="mt-6 space-y-2">{q.data?.items.map((n) => (
        <li key={n.id}><Link href={n.data.linkPath ? href(n.data.linkPath) : "#"} className={`block rounded-lg border bg-white px-4 py-3 ${n.readAt ? "border-border" : "border-copper"}`}>
          <p className={`${n.readAt ? "" : "font-semibold"}`}>{n.title}</p><p className="text-sm text-slate">{n.body}</p><p className="mt-1 text-xs text-slate">{date(n.createdAt, { withTime: true })}</p>
        </Link></li>
      ))}</ul>
    </div>
  )
}
