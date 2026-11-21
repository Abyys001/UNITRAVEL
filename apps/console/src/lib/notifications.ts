"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import type { MarkStaffNotificationsBody, StaffNotificationCategory, StaffNotificationPage, StaffNotificationSummary } from "@unitravel/contracts"

import { api } from "@/lib/api"
import { useFallbackInterval } from "@/lib/live"

/** ADR-0039 D1: the signed-in staff member's own feed. The stream's `notifications` event invalidates these keys. */
export const NOTIF_KEY = ["staff-notif"] as const

export function useStaffNotificationSummary(enabled = true) {
  const interval = useFallbackInterval(30_000)
  return useQuery({ queryKey: [...NOTIF_KEY, "summary"], queryFn: () => api<StaffNotificationSummary>("/v1/admin/notifications/summary"), refetchInterval: interval, enabled })
}

export function useStaffNotifications(q: { category?: StaffNotificationCategory; unread?: boolean; limit?: number }, enabled = true) {
  const params = new URLSearchParams({ limit: String(q.limit ?? 30), ...(q.category ? { category: q.category } : {}), ...(q.unread ? { unread: "1" } : {}) })
  return useQuery({ queryKey: [...NOTIF_KEY, "list", q.category ?? "all", !!q.unread, q.limit ?? 30], queryFn: () => api<StaffNotificationPage>(`/v1/admin/notifications?${params}`), enabled })
}

export function useMarkStaffRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: MarkStaffNotificationsBody) => api<{ updated: number }>("/v1/admin/notifications/read", { body }),
    onSuccess: (r) => { if (r.updated) void qc.invalidateQueries({ queryKey: NOTIF_KEY }) },
  })
}

/** Opening an item's page reads every notification about it, so the sidebar badge drops when the work is seen. */
export function useReadOnOpen(ref: string | null | undefined) {
  const mark = useMarkStaffRead()
  const { mutate } = mark
  useEffect(() => { if (ref) mutate({ ref }) }, [ref, mutate])
}
