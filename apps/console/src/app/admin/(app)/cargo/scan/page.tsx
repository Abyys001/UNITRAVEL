"use client"

import { STAFF_BULK_COMMANDS } from "@unitravel/contracts"

import { BulkScan } from "@/components/bulk-scan"
import { commandLabelOf } from "@/components/case"
import { EmptyState } from "@/components/bento"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"

type ScanView = { ref: string; version: number; status: string; actions: { command: string; allowed: boolean; reason?: string }[] }

/** ADR-0046 D2: staff depot scan (departed, at customs, cleared, out for delivery) through the normal cargo commands. */
export default function CargoBulkScan() {
  const t = useT()
  const [locale] = useLocale()
  const { can } = useSession()
  if (!can("cargo_request.transition")) return <div className="p-6"><EmptyState title={t("ops.noAccess")} /></div>
  const apply = async (tn: string, command: string, input: { location: string; occurredAt?: string }) => {
    const v = await api<ScanView>(`/v1/admin/cargo/scan/${tn}`)
    const a = v.actions.find((x) => x.command === command)
    if (!a?.allowed) throw new Error(`${v.ref} · ${v.status}${a?.reason ? ` · ${a.reason}` : ""}`)
    await api(`/v1/admin/cargo/requests/${v.ref}/commands/${command}`, { body: { location: input.location, occurredAt: input.occurredAt ?? new Date().toISOString() }, headers: { "if-match": String(v.version) } })
    return v.ref
  }
  return <BulkScan actions={STAFF_BULK_COMMANDS} defaultAction="depart" labelOf={(c) => commandLabelOf(c, locale)} withTime apply={apply} />
}
