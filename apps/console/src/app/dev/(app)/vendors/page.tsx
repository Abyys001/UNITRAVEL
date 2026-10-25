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
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

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
      <PageHead kicker={t("dnav.integrations")} title={t("vend.title")}><span className="text-[12px] text-steel">{t("vend.desc")}</span></PageHead>
      <DevPage>
        <Section title={t("vend.section")} hint={t("vend.hint")} flush>
          {!q.data.length ? <EmptyState title={t("vend.none")} /> : (
            <DataTable data-testid="vendors">
              <thead><tr>{[t("vend.c.vendor"), t("vend.c.fields"), t("vend.c.status"), t("vend.c.rotated"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{q.data.map((v) => <tr key={v.vendor}><td className="font-medium" dir="ltr">{v.vendor}</td><td className="font-mono text-[11.5px] text-steel" dir="ltr">{v.fields.join(", ") || "—"}</td><td><Tag value={v.credentials ? t("prov.set") : t("prov.notSet")} className={v.credentials ? "border-success text-success" : "border-danger text-danger"} /></td><td className="text-[12.5px] text-steel">{v.credentials ? <>{fmtDateTime(v.credentials.rotatedAt)}{v.credentials.rotatedBy && ` · ${v.credentials.rotatedBy}`}</> : "—"}</td><td className="text-end">{can("provider.config.write") && <Button size="xs" variant="outline" onClick={() => setOpen(v.vendor)}>{v.credentials ? t("prov.rotate") : t("prov.enter")}</Button>}</td></tr>)}</tbody>
            </DataTable>
          )}
        </Section>
      </DevPage>
      {open && <SecretDialog open onOpenChange={(o) => !o && setOpen(null)} title={t("prov.credsTitle", { name: open })} hintKeys={q.data.find((v) => v.vendor === open)?.fields ?? []} fixedKeys onSave={async (values) => { await api(`/v1/dev/vendors/${encodeURIComponent(open)}/credentials`, { method: "PUT", body: { values } }); await q.refetch() }} />}
    </div>
  )
}
