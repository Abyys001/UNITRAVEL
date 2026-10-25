"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { EmptyState } from "@/components/bento"
import { ListCard } from "@/components/data-list"
import { DataTable, DevPage } from "@/components/dev-ui"
import { ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Route { id: string; prefix: string; providers: string[]; enabled: boolean; successRate: number | null; sent24h: number }

/** SMS routing by country prefix with fallback order (ch. 17.3). +98 never goes through international providers. */
export default function SmsRoutesPage() {
  const { can } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["sms-routes"], queryFn: () => api<Route[]>("/v1/dev/sms-routes") })
  const [edit, setEdit] = useState<{ prefix: string; providers: string; enabled: boolean } | null>(null)
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const canWrite = can("notification.template.write")
  return (
    <div>
      <PageHead kicker={t("dnav.integrations")} title={t("dnav.sms")}><span className="text-meta text-steel">{t("sms.desc")}</span>{canWrite && <Button size="sm" onClick={() => setEdit({ prefix: "", providers: "", enabled: true })}>{t("sms.new")}</Button>}</PageHead>
      <DevPage>
        <p className="max-w-3xl rounded-lg border border-rule bg-surface-raised px-4 py-3 text-meta text-steel">{t("sms.rule")}</p>
        {!q.data.length ? <ListCard className="mx-0 mb-0 md:mx-0"><EmptyState title={t("sms.none")} className="py-10" /></ListCard> : (
          <ListCard className="mx-0 mb-0 md:mx-0"><DataTable data-testid="sms-routes">
            <thead><tr>{[t("sms.c.prefix"), t("sms.c.providers"), t("sms.c.enabled"), t("sms.c.success"), t("sms.c.sent"), ""].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{q.data.map((r) => <tr key={r.id}><td className="num font-medium" dir="ltr">{r.prefix}</td><td className="font-mono text-meta" dir="ltr">{r.providers.join(" → ")}</td><td><Tag value={r.enabled ? "ON" : "OFF"} className={r.enabled ? "border-success text-success" : ""} /></td><td className="num">{r.successRate == null ? "—" : `${Math.round(r.successRate * 100)}%`}</td><td className="num">{r.sent24h}</td><td className="text-end">{canWrite && <Button size="xs" variant="ghost" onClick={() => setEdit({ prefix: r.prefix, providers: r.providers.join(", "), enabled: r.enabled })}>{t("lanes.edit")}</Button>}</td></tr>)}</tbody>
          </DataTable></ListCard>
        )}
      </DevPage>
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} title={edit.prefix ? t("sms.editTitle", { p: edit.prefix }) : t("sms.newTitle")} submitLabel={t("sms.save")} onSubmit={async () => { await api("/v1/dev/sms-routes", { method: "PUT", body: { prefix: edit.prefix, providers: edit.providers.split(",").map((s) => s.trim()).filter(Boolean), enabled: edit.enabled } }); await q.refetch() }}>
          <Field label={t("sms.c.prefix")} hint={t("sms.prefixHint")}><input className="field-input font-mono" value={edit.prefix} onChange={(e) => setEdit({ ...edit, prefix: e.target.value })} required /></Field>
          <Field label={t("sms.fallback")} hint="kavenegar, smsir, sinch, infobip, console…"><input className="field-input font-mono" value={edit.providers} onChange={(e) => setEdit({ ...edit, providers: e.target.value })} required /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> {t("sms.c.enabled")}</label>
        </FormDialog>
      )}
    </div>
  )
}
