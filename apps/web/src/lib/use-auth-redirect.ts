"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"

import { useI18n } from "./i18n"
import { useSession } from "./session"

export function useRequireSignIn() {
  const { me, loading } = useSession()
  const router = useRouter()
  const path = usePathname()
  const { href } = useI18n()
  useEffect(() => { if (!loading && !me) router.replace(href(`/sign-in?next=${encodeURIComponent(path)}`)) }, [loading, me, router, path, href])
  return { me, loading }
}

/** The last known state stays visible when the network drops (ch. 29.1 "Resilience"). */
export function cacheGet<T>(key: string): { at: string; data: T } | null {
  try { const v = localStorage.getItem(`ut_cache:${key}`); return v ? JSON.parse(v) : null } catch { return null }
}
export function cacheSet(key: string, data: unknown) {
  try { localStorage.setItem(`ut_cache:${key}`, JSON.stringify({ at: new Date().toISOString(), data })) } catch { /* storage may be unavailable */ }
}
