"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useSyncExternalStore } from "react"

import { api } from "@/lib/api"
import type { QueueSummary } from "@/lib/types"

/**
 * Console live updates (ch. 29.2): one EventSource on GET /v1/admin/events pushes queue counts and request versions
 * into the query cache. While it is open, polling is off; when it drops, the queries fall back to their intervals.
 */
let live = false
const subscribers = new Set<() => void>()
const setLive = (v: boolean) => { if (live !== v) { live = v; for (const s of subscribers) s() } }
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn) } }

/** True while the event stream is connected. */
export function useLive(): boolean {
  return useSyncExternalStore(subscribe, () => live, () => false)
}

/** Poll interval to use for a query that the stream keeps fresh: none while live, the fallback otherwise. */
export function useFallbackInterval(ms: number): number | false {
  return useLive() ? false : ms
}

/**
 * What arrived over the stream in this tab, newest first (dashboard activity feed). Only real events are recorded:
 * a queue-counts push stores the counts that changed, a request-changed push stores the reference.
 */
export type ActivityEntry =
  | { id: number; at: number; kind: "queue"; changes: { key: keyof Omit<QueueSummary, "deadlinesNext24h">; from: number; to: number }[] }
  | { id: number; at: number; kind: "request"; requestType: "FLIGHT" | "CARGO"; ref: string; status?: string }
const COUNT_KEYS = ["new", "mine", "awaitingCustomer", "quoted", "reserved", "complianceHolds", "slaBreaches"] as const
const NO_ACTIVITY: ActivityEntry[] = []
let activity = NO_ACTIVITY
let activitySeq = 0
const activitySubs = new Set<() => void>()
const pushActivity = (e: ActivityEntry extends infer E ? (E extends unknown ? Omit<E, "id" | "at"> : never) : never) => { activity = [{ ...e, id: ++activitySeq, at: Date.now() } as ActivityEntry, ...activity].slice(0, 25); for (const f of activitySubs) f() }
export function useActivity(): ActivityEntry[] {
  return useSyncExternalStore((fn) => { activitySubs.add(fn); return () => { activitySubs.delete(fn) } }, () => activity, () => NO_ACTIVITY)
}

export function useQueueSummary(enabled = true) {
  const interval = useFallbackInterval(15_000)
  return useQuery({ queryKey: ["queue-summary"], queryFn: () => api<QueueSummary>("/v1/admin/queues/summary"), refetchInterval: interval, enabled })
}

export function useStaffStream(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return
    let lists: ReturnType<typeof setTimeout> | undefined
    const es = new EventSource("/api/v1/admin/events")
    es.onopen = () => {
      setLive(true)
      // Anything may have changed while the stream was down.
      void qc.invalidateQueries({ queryKey: ["fr-version"] })
    }
    es.onerror = () => setLive(es.readyState === EventSource.OPEN)
    es.addEventListener("queue-counts", (e) => {
      const next = JSON.parse((e as MessageEvent<string>).data) as QueueSummary
      const prev = qc.getQueryData<QueueSummary>(["queue-summary"])
      const changes = prev ? COUNT_KEYS.filter((k) => prev[k] !== next[k]).map((key) => ({ key, from: prev[key], to: next[key] })) : []
      if (changes.length) pushActivity({ kind: "queue", changes })
      qc.setQueryData(["queue-summary"], next)
    })
    es.addEventListener("request-changed", (e) => {
      const r = JSON.parse((e as MessageEvent<string>).data) as { requestType: "FLIGHT" | "CARGO"; ref: string; version: number; status: string; statusLabel: string }
      pushActivity({ kind: "request", requestType: r.requestType, ref: r.ref, status: r.statusLabel })
      if (r.requestType === "FLIGHT") qc.setQueryData(["fr-version", r.ref], r.version)
      else void qc.invalidateQueries({ queryKey: ["cargo-detail", r.ref] })
      lists ??= setTimeout(() => { lists = undefined; void qc.invalidateQueries({ queryKey: ["fr"] }); void qc.invalidateQueries({ queryKey: ["cargo-list"] }) }, 500)
    })
    return () => { es.close(); setLive(false); if (lists) clearTimeout(lists) }
  }, [enabled, qc])
}
