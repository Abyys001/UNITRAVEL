"use client"

import { BookmarkCheck, Gavel, Hourglass, Home, IdCard, Inbox, KeyRound, ListChecks, Package, Plane, Receipt, ScrollText, Search, ShieldAlert, Tag, UserRound } from "lucide-react"

import { normaliseReference } from "@unitravel/domain"

import { useQueueSummary, useStaffStream } from "@/lib/live"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useSavedViews } from "@/lib/views"

import { Gate, type NavSection, Shell, type ShellAlert } from "./shell"

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
          { href: "/queues?tab=awaiting", label: "Awaiting customer", count: s?.awaitingCustomer, icon: <Hourglass className="size-4" /> },
          { href: "/queues?tab=quoted", label: "Quoted", count: s?.quoted, icon: <Tag className="size-4" /> },
          { href: "/queues?tab=reserved", label: "Reserved", count: s?.reserved, icon: <BookmarkCheck className="size-4" /> },
        ] : []),
        ...(can("cargo_request.read.any") ? [{ href: "/queues?tab=cargo", label: "Cargo", mobile: true, icon: <Package className="size-4" /> }] : []),
        ...(flights ? [{ href: "/queues?tab=all", label: "All flights", icon: <Plane className="size-4" /> }] : []),
      ],
    },
    ...(views.length ? [{ title: "Saved views", items: views.map((v) => ({ href: `/queues?${v.query}`, label: v.name, icon: <ListChecks className="size-4" /> })) }] : []),
    ...(can("compliance.case.read") ? [{
      title: "Compliance",
      items: [
        { href: "/compliance", label: "Cases", count: s?.complianceHolds, alert: true, mobile: true, icon: <ShieldAlert className="size-4" /> },
        { href: "/compliance/policies", label: "Policies", icon: <Gavel className="size-4" /> },
        { href: "/compliance/lists", label: "Sanctions lists", icon: <ScrollText className="size-4" /> },
      ],
    }] : []),
    ...(can("identity.verify") ? [{ title: "Identity", items: [{ href: "/verifications", label: "Passport verification", mobile: true, icon: <IdCard className="size-4" /> }] }] : []),
    ...(can("commercial_document.issue", "flight_request.read.any", "cargo_request.read.any") ? [{ title: "Billing", items: [{ href: "/invoices", label: "Invoices", icon: <Receipt className="size-4" /> }] }] : []),
    { title: "Tools", items: [...(can("flight_search.run") ? [{ href: "/search", label: "Staff flight search", icon: <Search className="size-4" /> }] : []), { href: "/account", label: "Sessions & second factor", icon: <KeyRound className="size-4" /> }] },
  ]
  const t = useT()
  const alerts: ShellAlert[] = s ? [
    { id: "sla", label: t("bell.sla", { n: s.slaBreaches }), count: s.slaBreaches, href: "/queues?tab=new", tone: "danger" },
    { id: "holds", label: t("bell.holds", { n: s.complianceHolds }), count: s.complianceHolds, href: "/compliance", tone: "danger" },
    { id: "deadlines", label: t("bell.deadlines", { n: s.deadlinesNext24h.length }), count: s.deadlinesNext24h.length, href: "/", tone: "warn" },
    { id: "new", label: t("bell.new", { n: s.new }), count: s.new, href: "/queues?tab=new", tone: "info" },
  ] : []
  const goTo = (q: string) => {
    if (!q) return null
    const ref = normaliseReference(q)
    if (ref?.startsWith("UT-F-")) return `/requests/${ref}`
    if (ref?.startsWith("UT-C-")) return `/cargo/${ref}`
    return `/queues?tab=all&q=${encodeURIComponent(q)}`
  }
  return <Shell surface="admin" sections={sections} onGoTo={goTo} goToHint="Reference or phone — UT-F-8K4Q7M" alerts={alerts}>{children}</Shell>
}

export function AdminFrame({ children }: { children: React.ReactNode }) {
  return <Gate surface="admin"><AdminShell>{children}</AdminShell></Gate>
}
