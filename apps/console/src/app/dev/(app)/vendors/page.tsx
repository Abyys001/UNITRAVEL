"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState } from "@/components/bento"
import { DataTable, DevPage, Section } from "@/components/dev-ui"
import { SecretDialog } from "@/components/secret-form"
import { ErrorLine, Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/**
 * What each vendor needs, mirroring apps/api/src/modules/notifications/vendor-schemas.ts (the API validates and refuses
 * anything else). Host, port and the like are settings, so they are typed in the clear; user, pass and keys stay masked.
 * Everything integration-related is entered here only (ADR-0019, ADR-0020): there is no environment-variable path on deployed hosts.
 */
const VENDOR_INFO: Record<string, { name: MsgKey; hint: MsgKey; required: string[]; plain: string[] }> = {
  "email:smtp": { name: "vend.smtp.name", hint: "vend.smtp.hint", required: ["host", "port", "user", "pass"], plain: ["host", "port", "secure", "from"] },
  "telephony:bonline": { name: "vend.bonline.name", hint: "vend.bonline.hint", required: ["webhookSecret"], plain: ["baseUrl"] },
}

interface Vendor { vendor: string; fields: string[]; credentials: { rotatedAt: string; rotatedBy: string | null } | null }

/** SMS, push and email vendor credentials — write-only, like provider credentials. */
export default function VendorsPage() {
  const { can } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/v1/dev/vendors") })
  const [open, setOpen] = useState<string | null>(null)
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker={t("dnav.integrations")} title={t("vend.title")}><span className="text-meta text-steel">{t("vend.desc")}</span></PageHead>
      <DevPage>
        <Section title={t("vend.section")} hint={t("vend.hint")} flush>
          {!q.data.length ? <EmptyState title={t("vend.none")} /> : (
            <DataTable data-testid="vendors">
              <thead><tr>{[t("vend.c.vendor"), t("vend.c.fields"), t("vend.c.status"), t("vend.c.rotated"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{q.data.map((v) => <tr key={v.vendor}><td><span className="font-medium" dir="ltr">{v.vendor}</span>{VENDOR_INFO[v.vendor] && <span className="block text-caption text-steel">{t(VENDOR_INFO[v.vendor]!.name)}</span>}</td><td className="font-mono text-caption text-steel" dir="ltr">{v.fields.join(", ") || "—"}</td><td><Tag value={v.credentials ? t("prov.set") : t("prov.notSet")} className={v.credentials ? "border-success text-success" : "border-danger text-danger"} /></td><td className="text-meta text-steel">{v.credentials ? <>{fmtDateTime(v.credentials.rotatedAt)}{v.credentials.rotatedBy && ` · ${v.credentials.rotatedBy}`}</> : "—"}</td><td className="text-end">{can("provider.config.write") && <Button size="xs" variant="outline" onClick={() => setOpen(v.vendor)}>{v.credentials ? t("prov.rotate") : t("prov.enter")}</Button>}</td></tr>)}</tbody>
            </DataTable>
          )}
        </Section>
      </DevPage>
      {open && <SecretDialog open onOpenChange={(o) => !o && setOpen(null)} title={t("prov.credsTitle", { name: open })} hintKeys={q.data.find((v) => v.vendor === open)?.fields ?? []} fixedKeys
        plainKeys={VENDOR_INFO[open]?.plain} requiredKeys={VENDOR_INFO[open]?.required} optionalKeys={(q.data.find((v) => v.vendor === open)?.fields ?? []).filter((f) => VENDOR_INFO[open] && !VENDOR_INFO[open].required.includes(f))}
        hint={VENDOR_INFO[open] ? t(VENDOR_INFO[open].hint) : undefined} onSave={async (values) => { await api(`/v1/dev/vendors/${encodeURIComponent(open)}/credentials`, { method: "PUT", body: { values } }); await q.refetch() }} />}
    </div>
  )
}
