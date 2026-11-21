"use client"

import type { ReactNode } from "react"

import { PortalTitle } from "@/components/portal/shell"

/** Page heading inside the portal shell (the frame itself comes from each section's `layout.tsx`, ADR-0040 D8). */
export function PanelShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <PortalTitle title={title} lead={lead} />
      {children}
    </>
  )
}

export function Stat({ label, value, tone = "default", icon }: { label: string; value: number; tone?: "default" | "orange" | "royal"; icon: ReactNode }) {
  const bar = { default: "bg-navy-900", orange: "bg-orange", royal: "bg-royal" }[tone]
  return (
    <div className="portal-card relative overflow-hidden p-4">
      <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${bar}`} />
      <div className="flex items-center justify-between text-(color:--ink-muted)"><span className="text-xs font-semibold uppercase tracking-wider">{label}</span><span aria-hidden>{icon}</span></div>
      <p className="mt-2 font-display text-3xl tabular-nums">{value}</p>
    </div>
  )
}
