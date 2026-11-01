"use client"

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useState } from "react"

import type { Me, Permission } from "@unitravel/contracts"

import { SessionVeil } from "@/components/session-veil"

import { hasRecentInput, isPaused, markInput, setSignedIn } from "./activity"
import { api, ApiError, forgetSessionHint, mayHaveSession, SESSION_PAUSED } from "./api"

export type Surface = "admin" | "dev"

interface SessionValue { me: Me | null; loading: boolean; reload: () => Promise<void>; can: (...p: Permission[]) => boolean }
const SessionCtx = createContext<SessionValue>({ me: null, loading: true, reload: async () => {}, can: () => false })

const HEARTBEAT_MS = 60_000
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const

/** Keeps the session alive while someone works without calling the API, and notices when it has lapsed while they were away (ADR-0022). */
function useActivityTracking(enabled: boolean) {
  useEffect(() => {
    setSignedIn(enabled)
    if (!enabled) return
    let lastBeat = Date.now()
    const onInput = () => {
      markInput()
      if (Date.now() - lastBeat < HEARTBEAT_MS || isPaused()) return
      lastBeat = Date.now()
      void api("/v1/auth/activity", { method: "POST", body: {} }).catch(() => undefined)
    }
    const onVisible = () => { if (document.visibilityState === "visible") onInput() }
    for (const e of INPUT_EVENTS) window.addEventListener(e, onInput, { passive: true })
    window.addEventListener("focus", onInput)
    document.addEventListener("visibilitychange", onVisible)
    // The event stream can replace polling entirely, so something has to ask.
    const watch = setInterval(() => { if (!hasRecentInput() && !isPaused()) void api("/v1/me").catch(() => undefined) }, HEARTBEAT_MS)
    return () => {
      for (const e of INPUT_EVENTS) window.removeEventListener(e, onInput)
      window.removeEventListener("focus", onInput)
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(watch)
    }
  }, [enabled])
}

function SessionInner({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      if (!(await mayHaveSession())) return null
      try { return await api<Me>("/v1/me") } catch (e) {
        if (e instanceof ApiError && e.code === SESSION_PAUSED) throw e
        if (e instanceof ApiError && e.problem.status === 401) forgetSessionHint()
        if (e instanceof ApiError && (e.problem.status === 401 || e.problem.status === 403)) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
  const me = q.data ?? null
  useActivityTracking(!!me)
  // Display only: every mutation is still authorised by the API (ch. 20.4) — hiding a button is never the control.
  const can = (...p: Permission[]) => !!me && p.some((x) => me.permissions.includes(x))
  return <SessionCtx.Provider value={{ me, loading: q.isLoading, reload: async () => { await qc.invalidateQueries({ queryKey: ["me"] }) }, can }}>{children}</SessionCtx.Provider>
}

export function Providers({ children }: { children: React.ReactNode }) {
  // A session that ended server-side (revoked, suspended, device no longer remembered) sends everyone back to sign-in.
  const onError = (e: unknown) => { if (e instanceof ApiError && e.code === "UNAUTHENTICATED") void client.invalidateQueries({ queryKey: ["me"] }) }
  const [client] = useState(() => new QueryClient({ queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }), defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.problem.status < 500) && n < 2, refetchOnWindowFocus: true, staleTime: 5_000 } } }))
  return <QueryClientProvider client={client}><SessionInner>{children}</SessionInner><SessionVeil /></QueryClientProvider>
}

export const useSession = () => useContext(SessionCtx)
