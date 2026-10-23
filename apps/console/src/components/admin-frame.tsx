"use client"

import { Home, Inbox, Package, ShieldAlert, UserRound } from "lucide-react"

import { normaliseReference } from "@unitravel/domain"

import { useQueueSummary, useStaffStream } from "@/lib/live"
import { useSession } from "@/lib/session"
import { useSavedViews } from "@/lib/views"

import { Gate, type NavSection, Shell } from "./shell"

function AdminShell({ children }: { children: React.ReactNode }) {
  const { can } = useSession()
  const views = useSavedViews()
  // Live counts come over the event stream; the summary polls only while the stream is down.
  const queues = can("flight_request.read.any", "cargo_request.read.any")
  useStaffStream(queues)
  const summary = useQueueSummary(queues)
  const s = summary.data
  const flights = can("flight_request.read.any")
  const sections: NavSection[] = [
    { title: "Shift", items: [{ href: "/", label: "Home", mobile: true, icon: <Home className="size-4" /> }] },
    {
      title: "Queues",
      items: [
        ...(flights ? [
          { href: "/queues?tab=new", label: "New", count: s?.new, alert: (s?.slaBreaches ?? 0) > 0, mobile: true, icon: <Inbox className="size-4" /> },
          { href: "/queues?tab=mine", label: "Mine", count: s?.mine, mobile: true, icon: <UserRound className="size-4" /> },
          { href: "/queues?tab=awaiting", label: "Awaiting customer", count: s?.awaitingCustomer },
          { href: "/queues?tab=quoted", label: "Quoted", count: s?.quoted },
          { href: "/queues?tab=reserved", label: "Reserved", count: s?.reserved },
        ] : []),
        ...(can("cargo_request.read.any") ? [{ href: "/queues?tab=cargo", label: "Cargo", mobile: true, icon: <Package className="size-4" /> }] : []),
        ...(flights ? [{ href: "/queues?tab=all", label: "All flights" }] : []),
      ],
    },
    ...(views.length ? [{ title: "Saved views", items: views.map((v) => ({ href: `/queues?${v.query}`, label: v.name })) }] : []),
    ...(can("compliance.case.read") ? [{
      title: "Compliance",
      items: [
        { href: "/compliance", label: "Cases", count: s?.complianceHolds, alert: true, mobile: true, icon: <ShieldAlert className="size-4" /> },
        { href: "/compliance/policies", label: "Policies" },
        { href: "/compliance/lists", label: "Sanctions lists" },
      ],
    }] : []),
    { title: "Tools", items: [...(can("flight_search.run") ? [{ href: "/search", label: "Staff flight search" }] : []), { href: "/account", label: "Sessions & second factor" }] },
  ]
  const goTo = (q: string) => {
    if (!q) return null
    const ref = normaliseReference(q)
    if (ref?.startsWith("UT-F-")) return `/requests/${ref}`
    if (ref?.startsWith("UT-C-")) return `/cargo/${ref}`
    return `/queues?tab=all&q=${encodeURIComponent(q)}`
  }
  return <Shell surface="admin" sections={sections} onGoTo={goTo} goToHint="Reference or phone — UT-F-8K4Q7M">{children}</Shell>
}

export function AdminFrame({ children }: { children: React.ReactNode }) {
  return <Gate surface="admin"><AdminShell>{children}</AdminShell></Gate>
}
