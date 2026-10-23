"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { Empty, ErrorLine, Field, Loading, PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

interface Route { id: string; prefix: string; providers: string[]; enabled: boolean; successRate: number | null; sent24h: number }

/** SMS routing by country prefix with fallback order (ch. 17.3). +98 never goes through international providers. */
export default function SmsRoutesPage() {
  const { can } = useSession()
  const q = useQuery({ queryKey: ["sms-routes"], queryFn: () => api<Route[]>("/v1/dev/sms-routes") })
  const [edit, setEdit] = useState<{ prefix: string; providers: string; enabled: boolean } | null>(null)
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker="Notifications" title="SMS routes">{can("notification.template.write") && <Button size="sm" variant="outline" onClick={() => setEdit({ prefix: "", providers: "", enabled: true })}>New route</Button>}</PageHead>
      <div className="px-5 py-3">
        {!q.data.length ? <Empty>No routes.</Empty> : (
          <table className="w-full bg-white" data-testid="sms-routes">
            <thead className="bg-paper"><tr className="border-b border-rule">{["Prefix", "Providers (fallback order)", "Enabled", "Success 24h", "Sent 24h", ""].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{q.data.map((r) => <tr key={r.id} className="border-b border-rule/70"><td className="num px-2 py-1.5">{r.prefix}</td><td className="px-2 py-1.5 font-mono text-[12px]">{r.providers.join(" → ")}</td><td className="px-2 py-1.5"><Tag value={r.enabled ? "ON" : "OFF"} className={r.enabled ? "border-moss text-moss" : ""} /></td><td className="num px-2 py-1.5">{r.successRate == null ? "—" : `${Math.round(r.successRate * 100)}%`}</td><td className="num px-2 py-1.5">{r.sent24h}</td><td className="px-2 py-1.5">{can("notification.template.write") && <Button size="xs" variant="ghost" onClick={() => setEdit({ prefix: r.prefix, providers: r.providers.join(", "), enabled: r.enabled })}>Edit</Button>}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} title={edit.prefix ? `Route ${edit.prefix}…` : "New route…"} submitLabel="Save route" onSubmit={async () => { await api("/v1/dev/sms-routes", { method: "PUT", body: { prefix: edit.prefix, providers: edit.providers.split(",").map((s) => s.trim()).filter(Boolean), enabled: edit.enabled } }); await q.refetch() }}>
          <Field label="Prefix" hint="+98, +44 … or default"><input className="field-input font-mono" value={edit.prefix} onChange={(e) => setEdit({ ...edit, prefix: e.target.value })} required /></Field>
          <Field label="Providers in fallback order" hint="kavenegar, smsir, sinch, infobip, console…"><input className="field-input font-mono" value={edit.providers} onChange={(e) => setEdit({ ...edit, providers: e.target.value })} required /></Field>
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Enabled</label>
        </FormDialog>
      )}
    </div>
  )
}
