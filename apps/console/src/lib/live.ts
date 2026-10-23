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
    es.addEventListener("queue-counts", (e) => qc.setQueryData(["queue-summary"], JSON.parse((e as MessageEvent<string>).data) as QueueSummary))
    es.addEventListener("request-changed", (e) => {
      const r = JSON.parse((e as MessageEvent<string>).data) as { requestType: "FLIGHT" | "CARGO"; ref: string; version: number }
      if (r.requestType === "FLIGHT") qc.setQueryData(["fr-version", r.ref], r.version)
      else void qc.invalidateQueries({ queryKey: ["cargo-detail", r.ref] })
      lists ??= setTimeout(() => { lists = undefined; void qc.invalidateQueries({ queryKey: ["fr"] }); void qc.invalidateQueries({ queryKey: ["cargo-list"] }) }, 500)
    })
    return () => { es.close(); setLive(false); if (lists) clearTimeout(lists) }
  }, [enabled, qc])
}
