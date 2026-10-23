"use client"

import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useState } from "react"

import type { Me } from "@unitravel/contracts"

import { api, ApiError } from "./api"

const SessionCtx = createContext<{ me: Me | null; loading: boolean; reload: () => Promise<void> }>({ me: null, loading: true, reload: async () => {} })

function SessionInner({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try { return await api<Me>("/v1/me") } catch (e) { if (e instanceof ApiError && (e.problem.status === 401 || e.problem.status === 403)) return null; throw e }
    },
    staleTime: 60_000,
  })
  return <SessionCtx.Provider value={{ me: q.data ?? null, loading: q.isLoading, reload: async () => { await qc.invalidateQueries({ queryKey: ["me"] }) } }}>{children}</SessionCtx.Provider>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.problem.status < 500) && n < 2, refetchOnWindowFocus: false } } }))
  return <QueryClientProvider client={client}><SessionInner>{children}</SessionInner></QueryClientProvider>
}

export const useSession = () => useContext(SessionCtx)
