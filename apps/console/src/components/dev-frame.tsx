"use client"

import { Activity, Settings2, SlidersHorizontal, Users } from "lucide-react"

import { useSession } from "@/lib/session"

import { Gate, type NavSection, Shell } from "./shell"

export const CONFIG_DOMAINS = [
  { domain: "ENGINE_RULES", slug: "engine", label: "Engine rules" },
  { domain: "HUBS", slug: "hubs", label: "Hubs & gateways" },
  { domain: "WORKFLOW", slug: "workflow", label: "Request workflow" },
  { domain: "NOTIFICATION_MATRIX", slug: "notifications", label: "Notification matrix" },
  { domain: "AUTH", slug: "auth", label: "Authentication" },
] as const

function DevShell({ children }: { children: React.ReactNode }) {
  const { can } = useSession()
  const sections: NavSection[] = [
    { title: "Control room", items: [{ href: "/", label: "Health & diagnostics", mobile: true, icon: <Activity className="size-4" /> }, ...(can("diagnostics.read") ? [{ href: "/jobs", label: "Dead letters" }] : [])] },
    { title: "People", items: can("user.read") ? [{ href: "/users", label: "Users", mobile: true, icon: <Users className="size-4" /> }, { href: "/roles", label: "Roles & permissions" }] : [] },
    { title: "Integrations", items: can("provider.config.read") ? [{ href: "/providers", label: "Flight providers" }, { href: "/vendors", label: "SMS, push & email vendors" }] : [] },
    { title: "Configuration", items: CONFIG_DOMAINS.filter((d) => can(...(d.domain === "ENGINE_RULES" || d.domain === "HUBS" ? ["engine.rules.read", "engine.rules.publish"] as const : d.domain === "NOTIFICATION_MATRIX" ? ["notification.template.write"] as const : ["settings.write"] as const))).map((d, i) => ({ href: `/config/${d.slug}`, label: d.label, ...(i === 0 ? { mobile: true, icon: <SlidersHorizontal className="size-4" /> } : {}) })) },
    { title: "Notifications", items: can("notification.template.write", "diagnostics.read") ? [{ href: "/templates", label: "Templates" }, { href: "/sms-routes", label: "SMS routes" }] : [] },
    {
      title: "Platform",
      items: [
        ...(can("settings.write", "flags.write", "diagnostics.read") ? [{ href: "/settings", label: "Settings & flags", mobile: true, icon: <Settings2 className="size-4" /> }] : []),
        ...(can("settings.write") ? [{ href: "/lanes", label: "Cargo lanes" }] : []),
        ...(can("audit.read") ? [{ href: "/audit", label: "Audit log" }] : []),
      ],
    },
    { title: "You", items: [{ href: "/account", label: "Sessions & second factor" }] },
  ].filter((s) => s.items.length)
  const goTo = (q: string) => (!q ? null : /^[0-9a-f-]{36}$/i.test(q) ? `/users/${q}` : `/users?q=${encodeURIComponent(q)}`)
  return <Shell surface="dev" sections={sections} onGoTo={goTo} goToHint="Find a user — name, phone, email or UT- reference">{children}</Shell>
}

export function DevFrame({ children }: { children: React.ReactNode }) {
  return <Gate surface="dev"><DevShell>{children}</DevShell></Gate>
}
