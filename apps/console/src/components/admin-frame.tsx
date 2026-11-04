"use client"

import { BookCheck, CalendarRange, ConciergeBell, FileText, Gem, Headset, Home, IdCard, Inbox, ListChecks, Receipt, Search, ShieldAlert, Tags, Users } from "lucide-react"

import { normaliseReference } from "@unitravel/domain"

import { useQueueSummary, useStaffStream, useSupportOverview } from "@/lib/live"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { useClubOn } from "@/lib/site"

import { Gate, type NavItem, Shell, type ShellAlert } from "./shell"

function AdminShell({ children }: { children: React.ReactNode }) {
  const { can } = useSession()
  const t = useT()
  // Live counts come over the event stream; the summary polls only while the stream is down.
  const queues = can("flight_request.read.any", "cargo_request.read.any")
  useStaffStream(queues)
  const summary = useQueueSummary(queues)
  const support = useSupportOverview(can("support.read"))
  const s = summary.data
  const flights = can("flight_request.read.any")
  const cargo = can("cargo_request.read.any")
  // The club pages show only while the customer club is switched on (ADR-0016); the API still answers either way.
  const clubOn = useClubOn()
  // A short flat list; each queue is a tab on the Requests page and policies/lists are tabs under Compliance.
  const items: NavItem[] = [
    { href: "/", label: t("nav.home"), mobile: true, group: "work", icon: <Home className="size-[18px]" /> },
    ...(flights || cargo ? [{ href: flights ? "/queues?tab=new" : "/queues?tab=cargo", label: t("nav.requests"), match: ["/queues", "/requests", "/cargo"], group: "work", count: flights ? s?.new : undefined, alert: (s?.slaBreaches ?? 0) > 0, mobile: true, icon: <Inbox className="size-[18px]" /> }] : []),
    ...(can("service_request.read.any") ? [{ href: "/services", label: t("nav.services"), group: "work", icon: <ConciergeBell className="size-[18px]" /> }] : []),
    ...(can("customer.read") ? [{ href: "/customers", label: t("nav.customers"), group: "work", icon: <Users className="size-[18px]" /> }] : []),
    ...(can("support.read", "call.log") ? [{
      href: can("support.read") ? "/support" : "/support/calls", label: t("nav.support"), group: "work", count: support.data?.open, alert: (support.data?.overdue ?? 0) > 0, icon: <Headset className="size-[18px]" />,
      tabs: [...(can("support.read") ? [{ href: "/support", label: t("nav.supportInbox") }] : []), ...(can("call.log") ? [{ href: "/support/calls", label: t("nav.supportCalls") }] : [])],
    }] : []),
    ...(can("compliance.case.read") ? [{
      href: "/compliance", label: t("nav.compliance"), count: s?.complianceHolds, alert: true, mobile: true, group: "work", icon: <ShieldAlert className="size-[18px]" />,
      tabs: [{ href: "/compliance", label: t("nav.cases") }, { href: "/compliance/policies", label: t("nav.policies") }, { href: "/compliance/lists", label: t("nav.lists") }],
    }] : []),
    ...(can("identity.verify") ? [{ href: "/verifications", label: t("nav.identityChecks"), short: t("nav.identity"), mobile: true, group: "work", icon: <IdCard className="size-[18px]" /> }] : []),
    ...(can("commercial_document.issue", "flight_request.read.any", "cargo_request.read.any") ? [{ href: "/invoices", label: t("nav.invoices"), group: "records", icon: <Receipt className="size-[18px]" /> }] : []),
    ...(can("loyalty.read") && clubOn ? [{
      href: "/club", label: t("nav.club"), group: "records", icon: <Gem className="size-[18px]" />,
      tabs: [{ href: "/club", label: t("nav.clubMembers") }, { href: "/club/benefits", label: t("nav.clubBenefits") }, { href: "/club/tiers", label: t("nav.clubTiers") }],
    }] : []),
    ...(can("service_catalog.manage") ? [{ href: "/services/catalog", label: t("nav.servicesCatalog"), group: "records", icon: <Tags className="size-[18px]" /> }] : []),
    ...(can("listings.write") ? [{ href: "/listings", label: t("nav.listings"), group: "records", icon: <ListChecks className="size-[18px]" /> }] : []),
    ...(can("visa.read") ? [{
      href: "/visa", label: t("nav.visa"), group: "records", icon: <BookCheck className="size-[18px]" />,
      tabs: [
        { href: "/visa", label: t("nav.visaOverview") }, { href: "/visa/rules", label: t("nav.visaRules") }, { href: "/visa/conflicts", label: t("nav.visaConflicts") },
        { href: "/visa/runs", label: t("nav.visaRuns") }, { href: "/visa/sources", label: t("nav.visaSources") }, { href: "/visa/documents", label: t("nav.visaDocuments") },
        { href: "/visa/audit", label: t("nav.visaAudit") },
      ],
    }] : []),
    ...(can("cms.read") ? [{
      href: "/content", label: t("nav.content"), group: "records", icon: <FileText className="size-[18px]" />,
      tabs: [{ href: "/content", label: t("nav.contentEntries") }, { href: "/content/glossary", label: t("nav.contentGlossary") }],
    }] : []),
    ...(can("flight_search.run") ? [{ href: "/search", label: t("nav.flightSearch"), group: "tools", icon: <Search className="size-[18px]" /> }] : []),
    ...(can("catalog.read") ? [{ href: "/catalog", label: t("nav.catalog"), group: "tools", icon: <CalendarRange className="size-[18px]" /> }] : []),
  ]
  const alerts: ShellAlert[] = s ? [
    ...(flights ? [{ id: "sla", label: t("bell.sla", { n: s.slaBreaches }), count: s.slaBreaches, href: "/queues?tab=new", tone: "danger" as const }] : []),
    ...(can("compliance.case.read") ? [{ id: "holds", label: t("bell.holds", { n: s.complianceHolds }), count: s.complianceHolds, href: "/compliance", tone: "danger" as const }] : []),
    { id: "deadlines", label: t("bell.deadlines", { n: s.deadlinesNext24h.length }), count: s.deadlinesNext24h.length, href: "/", tone: "warn" },
    ...(flights ? [{ id: "new", label: t("bell.new", { n: s.new }), count: s.new, href: "/queues?tab=new", tone: "info" as const }] : []),
  ] : []
  const goTo = (q: string) => {
    if (!q) return null
    const ref = normaliseReference(q)
    if (ref?.startsWith("UT-F-")) return `/requests/${ref}`
    if (ref?.startsWith("UT-C-")) return `/cargo/${ref}`
    if (ref?.startsWith("UT-S-") && can("service_request.read.any")) return `/services/${ref}`
    return `/queues?tab=all&q=${encodeURIComponent(q)}`
  }
  return <Shell surface="admin" items={items} onGoTo={goTo} goToHint="Reference or phone — UT-F-8K4Q7M" alerts={alerts}>{children}</Shell>
}

export function AdminFrame({ children }: { children: React.ReactNode }) {
  return <Gate surface="admin"><AdminShell>{children}</AdminShell></Gate>
}
