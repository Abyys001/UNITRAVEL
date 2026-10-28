"use client"

import { useQuery } from "@tanstack/react-query"

import type { SiteConfig } from "@unitravel/contracts"

import { api } from "./api"

/**
 * Public site configuration (`GET /v1/site`): the customer menu flags. The console uses it only to decide what to show
 * (the customer club pages appear when `menu.club` is on); the API still authorises every call.
 */
export function useSiteConfig() {
  return useQuery({ queryKey: ["site-config"], queryFn: () => api<SiteConfig>("/v1/site"), staleTime: 60_000, retry: false })
}

/** True only when the server says the customer club is switched on (flag `loyalty.enabled`). */
export function useClubOn() {
  return useSiteConfig().data?.menu.club === true
}
