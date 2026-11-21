"use client"

import { Navigation, Route } from "lucide-react"
import { useEffect, useState } from "react"

import { useT } from "@/lib/i18n"

/**
 * ADR-0046 D3 (amended): driving directions from the agent's current position, opened in a navigation app on the phone.
 * These are plain outbound links the agent taps; nothing from a map provider is loaded into our pages.
 */
type Os = "ios" | "android" | "other"
const os = (): Os => (/iPhone|iPad/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "other")
const q = encodeURIComponent

export const directionLinks = (address: string, platform: Os) => [
  // The phone's own app first: Apple Maps on iOS; on Android a geo: link lets the agent pick their usual app.
  ...(platform === "ios" ? [{ key: "apple", label: "Apple Maps", href: `https://maps.apple.com/?daddr=${q(address)}&dirflg=d` }] : []),
  ...(platform === "android" ? [{ key: "phone", label: "dir.phoneApp", href: `geo:0,0?q=${q(address)}` }] : []),
  { key: "google", label: "Google Maps", href: `https://www.google.com/maps/dir/?api=1&destination=${q(address)}&travelmode=driving` },
  { key: "waze", label: "Waze", href: `https://waze.com/ul?q=${q(address)}&navigate=yes` },
  { key: "osm", label: "OpenStreetMap", href: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=%3B${q(address)}` },
]

const btn = "inline-flex h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 font-medium"

/** One stop: a Directions button with a choice of navigation app. */
export function Directions({ address, className }: { address: string; className?: string }) {
  const t = useT()
  const [platform, setPlatform] = useState<Os>("other")
  useEffect(() => setPlatform(os()), [])
  const links = directionLinks(address, platform)
  return (
    <details className={`group relative ${className ?? ""}`} data-testid="directions">
      <summary className={`${btn} cursor-pointer list-none bg-navy-900 text-white [&::-webkit-details-marker]:hidden`}><Navigation className="size-4" aria-hidden />{t("dir.go")}</summary>
      <ul className="absolute start-0 z-20 mt-1 min-w-48 overflow-hidden rounded-lg border border-rule bg-surface-raised shadow-lg">
        {links.map((l) => <li key={l.key}><a href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="block px-3 py-2.5 font-medium hover:bg-hover">{l.label === "dir.phoneApp" ? t("dir.phoneApp") : l.label}</a></li>)}
      </ul>
    </details>
  )
}

/**
 * The whole day in one route, in run-sheet order. Only Google Maps takes several stops in a link (up to 9 waypoints and
 * the destination), so longer days are split into legs of 10 stops.
 */
export function RouteAll({ addresses }: { addresses: string[] }) {
  const t = useT()
  if (addresses.length < 2) return null
  const legs: string[][] = []
  for (let i = 0; i < addresses.length; i += 10) legs.push(addresses.slice(i, i + 10))
  return (
    <div className="flex flex-wrap gap-2" data-testid="route-all">
      {legs.map((leg, i) => {
        const dest = leg[leg.length - 1]!
        const way = leg.slice(0, -1)
        const href = `https://www.google.com/maps/dir/?api=1&destination=${q(dest)}${way.length ? `&waypoints=${way.map(q).join("%7C")}` : ""}&travelmode=driving`
        return <a key={i} href={href} target="_blank" rel="noopener noreferrer" className={`${btn} bg-navy-900 text-white`}><Route className="size-4" aria-hidden />{legs.length > 1 ? t("dir.routeLeg", { n: i + 1, from: i * 10 + 1, to: i * 10 + leg.length }) : t("dir.routeAll", { n: leg.length })}</a>
      })}
    </div>
  )
}
