"use client"

import { useQuery } from "@tanstack/react-query"

import type { InboxPage, PortalOverview, TrackDetail, UnreadCounts } from "@unitravel/contracts"

import { api } from "./api"
import { useSession } from "./session"

/** One place for the portal endpoints (ADR-0040), so a path change on the API side is a one-line edit. */
export const INBOX_PATH = "/v1/notifications"
export type InboxFilter = "all" | "unread" | "important"

export const fetchOverview = () => api<PortalOverview>("/v1/me/overview")
export const fetchInbox = (o: { filter: InboxFilter; cursor?: string | null; locale: string; limit?: number }) => {
  const p = new URLSearchParams({ filter: o.filter, limit: String(o.limit ?? 30), locale: o.locale })
  if (o.cursor) p.set("cursor", o.cursor)
  return api<InboxPage>(`${INBOX_PATH}?${p}`)
}
export const markRead = (body: { ids: string[] } | { all: true }) => api("/v1/notifications/read", { body })
export const fetchTrackDetail = (ref: string) => api<TrackDetail>(`/v1/track/${encodeURIComponent(ref)}`)
export const searchTrack = (q: string) => api<{ ref: string | null }>(`/v1/track/search?q=${encodeURIComponent(q)}`)

export const UNREAD_KEY = ["unread"] as const

/** Header badges: polled every 30 s and, by react-query's default, paused while the tab is hidden. A failing endpoint just hides the badges. */
export function useUnread() {
  const { me } = useSession()
  const q = useQuery({ queryKey: UNREAD_KEY, queryFn: () => api<UnreadCounts>("/v1/me/unread"), enabled: !!me, refetchInterval: 30_000, refetchIntervalInBackground: false, retry: false })
  return q.data ?? { inbox: 0, support: 0 }
}

/** Where a notification or purchase goes when the API gave no `linkPath`: the tracking detail for the reference. */
export const trackPath = (ref: string) => `/track?ref=${encodeURIComponent(ref)}`
