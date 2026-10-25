"use client"

import { useQuery } from "@tanstack/react-query"
import { Inbox as InboxIcon } from "lucide-react"
import Link from "next/link"

import { Button } from "@unitravel/ui/components/button"
import { EmptyState } from "@unitravel/ui/product/states"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { useRequireSignIn } from "@/lib/use-auth-redirect"

interface Inbox { items: { id: string; title: string; body: string; readAt: string | null; createdAt: string; critical: boolean; data: { linkPath?: string } }[]; unread: number }

/** The in-app inbox is the system of record for every notification (ch. 17.1). */
export default function InboxPage() {
  const { t, href, date, locale } = useI18n()
  const { me } = useRequireSignIn()
  const q = useQuery({ queryKey: ["inbox", locale], queryFn: () => api<Inbox>(`/v1/notifications?limit=50&locale=${locale}`), enabled: !!me, refetchInterval: 30_000 })
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="font-display text-3xl md:text-4xl">{t("inbox.title")}</h1>{!!q.data?.unread && <Button variant="outline" className="rounded-xl border-navy-900 text-navy-900" size="sm" onClick={async () => { await api("/v1/notifications/read", { body: { all: true } }); void q.refetch() }}>{t("inbox.markAll")}</Button>}</div>
      {!q.data?.items.length && <EmptyState className="mt-6" icon={<InboxIcon />} title={t("inbox.empty")} />}
      <ul className="mt-6 space-y-3">{q.data?.items.map((n) => {
        const cls = `card-brand block px-5 py-4 ${n.data.linkPath ? "card-lift" : ""} ${n.readAt ? "" : "!border-orange border-s-4"}`
        const inner = <><p className={n.readAt ? "" : "font-bold"}>{n.title}</p><p className="text-sm text-steel">{n.body}</p><p className="mt-1 text-xs text-steel">{date(n.createdAt, { withTime: true })}</p></>
        // Notifications without a target (for example "new sign-in") are not links.
        return <li key={n.id}>{n.data.linkPath ? <Link href={href(n.data.linkPath)} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>}</li>
      })}</ul>
    </div>
  )
}
