"use client"

import { Activity, Plane, ScrollText, Settings2, SlidersHorizontal, Users } from "lucide-react"

import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

import { Gate, type NavItem, type NavTab, Shell } from "./shell"

export const CONFIG_DOMAINS = [
  { domain: "ENGINE_RULES", slug: "engine", label: "Engine rules" },
  { domain: "HUBS", slug: "hubs", label: "Hubs & gateways" },
  { domain: "WORKFLOW", slug: "workflow", label: "Request workflow" },
  { domain: "NOTIFICATION_MATRIX", slug: "notifications", label: "Notification matrix" },
  { domain: "AUTH", slug: "auth", label: "Authentication" },
] as const

function DevShell({ children }: { children: React.ReactNode }) {
  const { can } = useSession()
  const t = useT()
  const tabsIf = (ok: boolean, tabs: NavTab[]) => (ok ? tabs : [])
  // Each destination is the first page you may open in it; the rest become tabs, so no permission loses a page.
  const hub = (label: string, icon: React.ReactNode, tabs: NavTab[], mobile = false, group = "operate"): NavItem[] => (tabs.length ? [{ href: tabs[0]!.href, label, icon, tabs, mobile, group }] : [])
  const items: NavItem[] = [
    ...hub(t("dnav.healthShort"), <Activity className="size-[18px]" />, [{ href: "/", label: t("dnav.overview") }, ...tabsIf(can("diagnostics.read"), [{ href: "/jobs", label: t("dnav.dead") }])], true),
    ...hub(t("dnav.people"), <Users className="size-[18px]" />, tabsIf(can("user.read"), [{ href: "/users", label: t("dnav.users") }, { href: "/roles", label: t("dnav.roles") }]), true),
    ...hub(t("dnav.audit"), <ScrollText className="size-[18px]" />, tabsIf(can("audit.read"), [{ href: "/audit", label: t("dnav.audit") }])),
    ...hub(t("dnav.integrations"), <Plane className="size-[18px]" />, [
      ...tabsIf(can("provider.config.read"), [{ href: "/providers", label: t("dnav.providers") }, { href: "/vendors", label: t("dnav.vendors") }, { href: "/payments", label: t("dnav.payments") }]),
      ...tabsIf(can("notification.template.write", "diagnostics.read"), [{ href: "/sms-routes", label: t("dnav.sms") }]),
    ], false, "configure"),
    ...hub(t("dnav.config"), <SlidersHorizontal className="size-[18px]" />, [
      ...CONFIG_DOMAINS.filter((d) => can(...(d.domain === "ENGINE_RULES" || d.domain === "HUBS" ? ["engine.rules.read", "engine.rules.publish"] as const : d.domain === "NOTIFICATION_MATRIX" ? ["notification.template.write"] as const : ["settings.write"] as const))).map((d) => ({ href: `/config/${d.slug}`, label: t(`dnav.${d.slug}` as MsgKey) })),
      ...tabsIf(can("notification.template.write", "diagnostics.read"), [{ href: "/templates", label: t("dnav.templates") }]),
      ...tabsIf(can("settings.write"), [{ href: "/lanes", label: t("dnav.lanes") }]),
    ], true, "configure"),
    ...hub(t("dnav.settings"), <Settings2 className="size-[18px]" />, tabsIf(can("settings.write", "flags.write", "diagnostics.read"), [{ href: "/settings", label: t("dnav.settings") }]), true, "configure"),
  ]
  const goTo = (q: string) => (!q ? null : /^[0-9a-f-]{36}$/i.test(q) ? `/users/${q}` : `/users?q=${encodeURIComponent(q)}`)
  return <Shell surface="dev" items={items} onGoTo={goTo} goToHint="Find a user — name, phone, email or UT- reference">{children}</Shell>
}

export function DevFrame({ children }: { children: React.ReactNode }) {
  return <Gate surface="dev"><DevShell>{children}</DevShell></Gate>
}
