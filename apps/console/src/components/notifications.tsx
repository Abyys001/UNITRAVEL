"use client"

import { BellRing, CheckCheck, ConciergeBell, Headset, IdCard, Inbox, Receipt } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import type { StaffNotification, StaffNotificationCategory, StaffNotificationPage } from "@unitravel/contracts"
import { cn } from "@unitravel/ui/lib/utils"

import { api } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useMarkStaffRead, useStaffNotifications, useStaffNotificationSummary } from "@/lib/notifications"

export const CATEGORY_ICON: Record<StaffNotificationCategory, typeof Inbox> = { REQUEST: Inbox, SERVICE: ConciergeBell, SUPPORT: Headset, PAYMENT: Receipt, IDENTITY: IdCard }
export const CATEGORY_LABEL: Record<StaffNotificationCategory, MsgKey> = { REQUEST: "notif.cat.REQUEST", SERVICE: "notif.cat.SERVICE", SUPPORT: "notif.cat.SUPPORT", PAYMENT: "notif.cat.PAYMENT", IDENTITY: "notif.cat.IDENTITY" }
const TONE: Record<StaffNotificationCategory, string> = {
  REQUEST: "bg-info-subtle text-info-subtle-fg", SERVICE: "bg-surface-sunk text-ink", SUPPORT: "bg-warning-subtle text-warning-subtle-fg", PAYMENT: "bg-success-subtle text-success", IDENTITY: "bg-surface-sunk text-steel",
}

/** One feed row: icon by category, title, body, age; unread rows carry a dot and a stronger title. Clicking opens and reads it. */
export function NotificationRow({ n, onOpen }: { n: StaffNotification; onOpen?: () => void }) {
  const t = useT()
  const mark = useMarkStaffRead()
  const Icon = CATEGORY_ICON[n.category]
  const unread = !n.readAt
  const open = () => { if (unread) mark.mutate({ ids: [n.id] }); onOpen?.() }
  const inner = (
    <>
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", TONE[n.category])} aria-hidden><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", unread ? "font-semibold text-ink" : "font-medium text-steel")} dir="auto">{n.title}</span>
        <span className="line-clamp-2 block text-caption text-steel" dir="auto">{n.body}</span>
        <span className="mt-0.5 block text-2xs text-steel"><span className="sr-only">{t(CATEGORY_LABEL[n.category])} · </span><time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>{rel(n.createdAt)}</time></span>
      </span>
      {unread && <span className="mt-2 size-2 shrink-0 rounded-full bg-orange" aria-label={t("notif.unread")} />}
    </>
  )
  const cls = cn("flex items-start gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-hover", unread && "bg-info-subtle/40")
  return n.linkPath
    ? <Link href={n.linkPath} onClick={open} className={cls} data-testid="notif-row" data-unread={unread}>{inner}</Link>
    : <button type="button" onClick={open} className={cn(cls, "w-full text-start")} data-testid="notif-row" data-unread={unread}>{inner}</button>
}

/** The bell's feed: the latest items, mark all read, and a link to the full page. */
export function BellFeed({ close }: { close: () => void }) {
  const t = useT()
  const list = useStaffNotifications({ limit: 8 })
  const summary = useStaffNotificationSummary()
  const mark = useMarkStaffRead()
  const unread = summary.data?.unread.total ?? 0
  return (
    <section aria-label={t("notif.title")} data-testid="bell-feed">
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1.5">
        <p className="cap">{t("notif.recent")}{unread > 0 && <span className="num ms-1.5 rounded-full bg-orange px-1.5 text-2xs font-bold text-navy-950">{unread}</span>}</p>
        {unread > 0 && <button type="button" className="inline-flex items-center gap-1 text-caption font-medium text-link hover:underline" onClick={() => mark.mutate({ all: true })} data-testid="notif-read-all"><CheckCheck className="size-3.5" aria-hidden />{t("notif.readAll")}</button>}
      </div>
      {list.isError ? <p className="px-2.5 py-3 text-caption text-danger">{t("notif.error")}</p>
        : !list.data ? <div className="space-y-2 px-2.5 py-2" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-sunk" />)}</div>
          : !list.data.items.length ? <p className="px-2.5 py-3 text-caption text-steel">{t("notif.empty")}</p>
            : <ul className="max-h-[min(22rem,50vh)] space-y-0.5 overflow-y-auto">{list.data.items.map((n) => <li key={n.id}><NotificationRow n={n} onOpen={close} /></li>)}</ul>}
      <Link href="/notifications" onClick={close} className="mt-1 block rounded-lg px-2.5 py-2 text-center text-meta font-medium text-link hover:bg-hover">{t("notif.all")}</Link>
    </section>
  )
}

/**
 * Shows a toast when the unread count grows, whether the stream pushed the change or polling found it. The first load
 * never toasts, so opening the console does not replay old items.
 */
export function NotificationToaster() {
  const t = useT()
  const router = useRouter()
  const summary = useStaffNotificationSummary()
  const last = useRef<number | null>(null)
  const total = summary.data?.unread.total
  useEffect(() => {
    if (total === undefined) return
    const prev = last.current
    last.current = total
    if (prev === null || total <= prev) return
    void api<StaffNotificationPage>("/v1/admin/notifications?unread=1&limit=1").then((p) => {
      const n = p.items[0]
      if (!n) return
      toast(n.title, {
        id: `notif-${n.id}`, description: n.body, icon: <BellRing className="size-4" aria-hidden />, duration: 8000,
        action: n.linkPath ? { label: t("notif.open"), onClick: () => router.push(n.linkPath!) } : undefined,
      })
    }).catch(() => undefined)
  }, [total, router, t])
  return null
}
