"use client"

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useState } from "react"

import type { Me, Permission } from "@unitravel/contracts"

import { api, ApiError } from "./api"

export type Surface = "admin" | "dev"

interface SessionValue { me: Me | null; loading: boolean; reload: () => Promise<void>; can: (...p: Permission[]) => boolean }
const SessionCtx = createContext<SessionValue>({ me: null, loading: true, reload: async () => {}, can: () => false })

function SessionInner({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try { return await api<Me>("/v1/me") } catch (e) { if (e instanceof ApiError && (e.problem.status === 401 || e.problem.status === 403)) return null; throw e }
    },
    staleTime: 60_000,
  })
  const me = q.data ?? null
  // Display only: every mutation is still authorised by the API (ch. 20.4) — hiding a button is never the control.
  const can = (...p: Permission[]) => !!me && p.some((x) => me.permissions.includes(x))
  return <SessionCtx.Provider value={{ me, loading: q.isLoading, reload: async () => { await qc.invalidateQueries({ queryKey: ["me"] }) }, can }}>{children}</SessionCtx.Provider>
}

export function Providers({ children }: { children: React.ReactNode }) {
  // A session that ended server-side (idle timeout, revoked, suspended) sends everyone back to sign-in.
  const onError = (e: unknown) => { if (e instanceof ApiError && e.code === "UNAUTHENTICATED") void client.invalidateQueries({ queryKey: ["me"] }) }
  const [client] = useState(() => new QueryClient({ queryCache: new QueryCache({ onError }), mutationCache: new MutationCache({ onError }), defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.problem.status < 500) && n < 2, refetchOnWindowFocus: true, staleTime: 5_000 } } }))
  return <QueryClientProvider client={client}><SessionInner>{children}</SessionInner></QueryClientProvider>
}

export const useSession = () => useContext(SessionCtx)
