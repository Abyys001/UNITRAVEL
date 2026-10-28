"use client"

import { useQuery } from "@tanstack/react-query"

import type { MenuKey, SiteConfig } from "@unitravel/contracts"

import { api } from "./api"

/** Until the API answers, only the items that never depend on a flag are shown, so a switched-off service never flashes in. */
export const SITE_FALLBACK: SiteConfig = {
  menu: { flights: true, track: true, support: true, cargo: false, club: false, hotels: false, stays: false, trains: false, buses: false, visa: false, tours: false, cip: false, insurance: false },
  support: { phone: null, email: null, hours: null },
  payments: { online: false },
}

/** Public site configuration (`GET /v1/site`, spec §4.1): which menu items are on, support contacts, online payment. */
export function useSite() {
  const q = useQuery({ queryKey: ["site"], queryFn: () => api<SiteConfig>("/v1/site"), staleTime: 60_000, refetchInterval: 5 * 60_000 })
  const site = q.data ?? SITE_FALLBACK
  return { site, loaded: !!q.data, on: (k: MenuKey) => site.menu[k] === true }
}
