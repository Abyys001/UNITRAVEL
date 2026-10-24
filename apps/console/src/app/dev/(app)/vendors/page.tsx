"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { SecretDialog } from "@/components/secret-form"
import { ErrorLine, Loading, PageHead, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

interface Vendor { vendor: string; credentials: { rotatedAt: string; rotatedBy: string | null } | null }

/** SMS, push and email vendor credentials — write-only, like provider credentials. */
export default function VendorsPage() {
  const { can } = useSession()
  const q = useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/v1/dev/vendors") })
  const [open, setOpen] = useState<string | null>(null)
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  return (
    <div>
      <PageHead kicker="Integrations" title="SMS, push & email vendors" />
      <div className="px-5">
        <Panel title="Vendors">
          <ul className="ledger-rows">{q.data.map((v) => <li key={v.vendor} className="flex items-center justify-between py-1.5"><span className="font-mono">{v.vendor}</span><span className="flex items-center gap-3"><span className="text-[12px] text-steel">{v.credentials ? `rotated ${fmtDateTime(v.credentials.rotatedAt)}` : "not set"}</span>{can("provider.config.write") && <Button size="xs" variant="outline" onClick={() => setOpen(v.vendor)}>{v.credentials ? "Rotate" : "Enter"}…</Button>}</span></li>)}</ul>
        </Panel>
      </div>
      {open && <SecretDialog open onOpenChange={(o) => !o && setOpen(null)} title={`${open} credentials…`} hintKeys={["apiKey"]} onSave={async (values) => { await api(`/v1/dev/vendors/${encodeURIComponent(open)}/credentials`, { method: "PUT", body: { values } }); await q.refetch() }} />}
    </div>
  )
}
