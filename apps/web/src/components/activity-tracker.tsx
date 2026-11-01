"use client"

import { usePathname } from "next/navigation"
import { useEffect } from "react"

import type { ActivityScreen } from "@unitravel/contracts"

import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

const REF = /^[A-Z0-9][A-Z0-9-]{2,31}$/
const TOP: Record<string, ActivityScreen> = {
  search: "search", itinerary: "itinerary", flights: "flights", hotels: "hotels", stays: "stays", trains: "trains", buses: "buses", visa: "visa", tours: "tours", cip: "cip",
  insurance: "insurance", shipments: "shipments", requests: "requests", track: "track", account: "account", billing: "billing", inbox: "inbox", support: "support", club: "club",
  faq: "faq", guides: "guides", blog: "blog", glossary: "glossary", "sign-in": "sign_in", cargo: "cargo",
}

/** Maps a path (ADR-0018 allow-list) to a screen name and an optional reference. Page content and query strings are never read. */
export function screenFor(path: string): { screen: ActivityScreen; ref?: string } | null {
  const [, , a, b, c] = path.split("/")
  if (!a) return { screen: "home" }
  const ref = b && REF.test(b.toUpperCase()) ? { ref: b.toUpperCase() } : {}
  if (a === "request" && b === "new") return { screen: "request_new" }
  if (a === "requests") return b ? { screen: "request_detail", ...ref } : { screen: "requests" }
  if (a === "services" || (a === "cargo" && b)) return { screen: "request_detail", ...ref }
  if (a === "account") return { screen: b === "details" ? "details" : "account" }
  if (a === "billing") return !b ? { screen: "billing" } : c === "pay" ? { screen: "pay", ...ref } : { screen: "invoice", ...ref }
  if (a === "support") return b ? { screen: "support_ticket", ...ref } : { screen: "support" }
  const screen = TOP[a]
  return screen ? { screen } : null
}

/** Reports the screen a signed-in customer opens (POST /v1/me/activity). The server drops it for Do Not Track, GPC or an opt-out, and throttles it; failures are ignored. */
export function ActivityTracker() {
  const path = usePathname()
  const { me } = useSession()
  useEffect(() => {
    if (!me) return
    const s = screenFor(path)
    if (!s) return
    const id = setTimeout(() => { void api("/v1/me/activity", { body: s }).catch(() => undefined) }, 800)
    return () => clearTimeout(id)
  }, [path, me])
  return null
}
