"use client"

import { CheckCheck } from "lucide-react"
import { useState } from "react"

import { STAFF_NOTIFICATION_CATEGORIES, type StaffNotificationCategory } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { Chips } from "@/components/data-list"
import { CATEGORY_LABEL, NotificationRow } from "@/components/notifications"
import { PageHead } from "@/components/ui"
import { Check } from "@/components/controls"
import { useT } from "@/lib/i18n"
import { useMarkStaffRead, useStaffNotifications, useStaffNotificationSummary } from "@/lib/notifications"

/** ADR-0039 D1: the signed-in staff member's notifications, by area, with read state. */
export default function NotificationsPage() {
  const t = useT()
  const [category, setCategory] = useState<StaffNotificationCategory | "">("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const summary = useStaffNotificationSummary()
  const list = useStaffNotifications({ category: category || undefined, unread: unreadOnly, limit: 100 })
  const mark = useMarkStaffRead()
  const u = summary.data?.unread
  const scopeUnread = category ? u?.[category] ?? 0 : u?.total ?? 0
  return (
    <div>
      <PageHead kicker={t("notif.kicker")} title={t("notif.title")}>
        <Button size="sm" variant="outline" disabled={!scopeUnread} loading={mark.isPending} onClick={() => mark.mutate(category ? { category } : { all: true })} data-testid="notif-page-read-all">
          <CheckCheck className="size-4" aria-hidden />{category ? t("notif.readCategory") : t("notif.readAll")}
        </Button>
      </PageHead>
      <div className="max-w-4xl space-y-4 px-4 pb-10 md:px-6">
        <p className="text-meta text-steel">{t("notif.help")}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Chips label={t("notif.filter")} value={category} onChange={setCategory}
            options={[{ value: "", label: t("notif.cat.all"), count: u?.total }, ...STAFF_NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_LABEL[c]), count: u?.[c] }))]} />
          <Check label={t("notif.unreadOnly")} checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
        </div>
        <section className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-2 shadow-[var(--shadow-xs)]" data-testid="notif-list">
          {list.isError ? <TileError error={list.error} onRetry={() => void list.refetch()} />
            : !list.data ? <div className="space-y-2 p-2" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-sunk" />)}</div>
              : !list.data.items.length ? <EmptyState title={unreadOnly ? t("notif.emptyUnread") : t("notif.empty")} className="py-10" />
                : <ul className="space-y-0.5">{list.data.items.map((n) => <li key={n.id}><NotificationRow n={n} /></li>)}</ul>}
        </section>
      </div>
    </div>
  )
}
