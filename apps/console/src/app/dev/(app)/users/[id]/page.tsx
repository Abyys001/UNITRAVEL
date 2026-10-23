"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { PRIVILEGED_ROLES } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "@/components/form-dialog"
import { Empty, ErrorLine, Field, Loading, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

interface Detail {
  id: string; displayName: string; status: string; roles: string[]; permissions: string[]; permVersion: number; createdAt: string
  identities: { id: string; type: string; value: string; verifiedAt: string | null; isPrimary: boolean; revokedAt: string | null }[]
  sessions: { id: string; client: string; ip: string | null; userAgent: string | null; lastSeenAt: string; createdAt: string; mfaLevel: number }[]
  devices: { id: string; platform: string; pushProvider: string; lastSuccessAt: string | null; appVersion: string | null }[]
  securityEvents: { at: string; action: string; ip: string | null }[]
  requests: { ref: string; status: string; submittedAt: string }[]
}
interface Role { key: string; name: string; builtIn: boolean; privileged: boolean }

export default function UserPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { me, can } = useSession()
  const key = ["dev-user", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/v1/dev/users/${id}`) })
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("/v1/dev/roles") })
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { if (q.data) setSel(q.data.roles) }, [q.data])
  const [suspend, setSuspend] = useState(false)
  const [reason, setReason] = useState("")
  const [roleErr, setRoleErr] = useState<string | null>(null)
  const inv = { invalidate: [key] }
  const saveRoles = useAct(() => api(`/v1/dev/users/${id}/roles`, { method: "PUT", body: { roles: sel } }), { ...inv, success: "Roles updated — the user's next request picks them up" })
  const reactivate = useAct(() => api(`/v1/dev/users/${id}/reactivate`, { body: {} }), { ...inv, success: "Reactivated" })
  const revokeAll = useAct(() => api<{ revoked: number }>(`/v1/dev/users/${id}/sessions/revoke`, { body: {} }), { ...inv, onDone: (r) => toast.success(`${r.revoked} sessions revoked`) })
  const reverify = useAct(() => api(`/v1/dev/users/${id}/force-reverify`, { body: {} }), { ...inv, success: "Phone must be verified again" })
  const unlink = useAct((identityId: string) => api(`/v1/dev/users/${id}/identities/${identityId}/unlink`, { body: {} }), { ...inv, success: "Identity unlinked" })
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const u = q.data
  const all = roles.data?.roles ?? []
  const privileged = (k: string) => all.find((r) => r.key === k)?.privileged || (PRIVILEGED_ROLES as readonly string[]).includes(k)
  const changed = [...sel].sort().join() !== [...u.roles].sort().join()
  const touchesPriv = [...sel.filter((r) => !u.roles.includes(r)), ...u.roles.filter((r) => !sel.includes(r))].some(privileged)
  return (
    <div>
      <PageHead kicker={<>User · <span className="font-mono">{u.id}</span> · joined {fmtDateTime(u.createdAt)} · perm v{u.permVersion}</>} title={<span dir="auto">{u.displayName}</span>}>
        <Tag value={u.status} />
        {can("user.role.assign") && u.id !== me?.id && (u.status === "SUSPENDED" ? <Button size="sm" variant="outline" onClick={() => reactivate.mutate()}>Reactivate</Button> : <Button size="sm" variant="destructive" onClick={() => setSuspend(true)}>Suspend…</Button>)}
        {can("user.role.assign") && <Button size="sm" variant="outline" onClick={() => revokeAll.mutate()}>Revoke all sessions</Button>}
        {can("user.role.assign") && <Button size="sm" variant="ghost" onClick={() => reverify.mutate()}>Force phone re-verification</Button>}
      </PageHead>
      <div className="grid gap-x-8 px-5 lg:grid-cols-2">
        <Panel title="Roles" aside={touchesPriv && <span className="text-[11px] text-copper-700">privileged change · step-up · owners alerted</span>}>
          <div className="grid grid-cols-2 gap-1" data-testid="role-editor">
            {all.map((r) => <label key={r.key} className="flex items-center gap-2 rounded-sm border border-rule bg-white px-2 py-1"><input type="checkbox" checked={sel.includes(r.key)} onChange={(e) => { setRoleErr(null); setSel(e.target.checked ? [...sel, r.key] : sel.filter((x) => x !== r.key)) }} disabled={!can("user.role.assign")} /><span className="font-mono text-[12px]">{r.key}</span>{privileged(r.key) && <span className="ms-auto font-mono text-[10px] text-copper-700">PRIV</span>}</label>)}
          </div>
          {can("user.role.assign") && <div className="mt-2 flex items-center gap-2"><Button size="sm" disabled={!changed} loading={saveRoles.isPending} onClick={() => saveRoles.mutate(undefined, { onError: (e) => setRoleErr(errText(e)) })}>Save roles</Button>{changed && <Button size="sm" variant="ghost" onClick={() => setSel(u.roles)}>Reset</Button>}</div>}
          {roleErr && <p role="alert" className="mt-1 rounded-sm bg-[#fbeee9] px-2 py-1 text-brick" data-testid="role-error">{roleErr}</p>}
          <p className="mt-2 text-[11px] text-slate">The last owner cannot be removed; the API refuses it (LAST_OWNER).</p>
          <details className="mt-1"><summary className="cursor-pointer text-[12px] text-slate">{u.permissions.length} effective permissions</summary><p className="mt-1 font-mono text-[11px]">{u.permissions.join(" · ")}</p></details>
        </Panel>
        <Panel title="Identities">
          <ul className="ledger-rows">{u.identities.map((i) => <li key={i.id} className="flex items-center justify-between py-1"><span><span className="font-mono text-[11px] text-slate">{i.type}</span> <span className="num" dir="ltr">{i.value}</span>{i.isPrimary && <span className="ms-1 text-[11px]">primary</span>}{i.revokedAt && <span className="ms-1 text-[11px] text-brick">unlinked</span>}</span><span className="flex items-center gap-2">{i.verifiedAt ? <span className="text-[11px] text-moss">verified {fmtDateTime(i.verifiedAt)}</span> : <span className="text-[11px] text-brick">unverified</span>}{!i.revokedAt && can("user.role.assign") && <Button size="xs" variant="ghost" onClick={() => unlink.mutate(i.id)}>Unlink</Button>}</span></li>)}</ul>
        </Panel>
        <Panel title={`Active sessions · ${u.sessions.length}`}>
          {!u.sessions.length ? <Empty>None.</Empty> : <ul className="ledger-rows">{u.sessions.map((s) => <li key={s.id} className="py-1"><span className="font-mono text-[11px]">{s.client}</span> <span className="num">{s.ip}</span> <span className="text-[11px] text-slate">MFA {s.mfaLevel} · seen {fmtDateTime(s.lastSeenAt)}</span><span className="block truncate text-[11px] text-slate">{s.userAgent}</span></li>)}</ul>}
          {u.devices.length > 0 && <p className="mt-1 text-[12px] text-slate">Devices: {u.devices.map((d) => `${d.platform}/${d.pushProvider}${d.appVersion ? ` ${d.appVersion}` : ""}`).join(" · ")}</p>}
        </Panel>
        <Panel title="Recent security events">
          {!u.securityEvents.length ? <Empty>None.</Empty> : <ul className="ledger-rows font-mono text-[11.5px]">{u.securityEvents.map((e, i) => <li key={i} className="flex justify-between py-1"><span>{e.action}</span><span className="text-slate">{e.ip ?? ""} · {fmtDateTime(e.at)}</span></li>)}</ul>}
        </Panel>
        <Panel title="Requests">
          {!u.requests.length ? <Empty>None.</Empty> : <ul className="ledger-rows">{u.requests.map((r) => <li key={r.ref} className="flex justify-between py-1"><span className="num">{r.ref}</span><span className="flex gap-2"><span className="text-[11px] text-slate">{fmtDateTime(r.submittedAt)}</span><Tag value={r.status} /></span></li>)}</ul>}
        </Panel>
      </div>
      <FormDialog open={suspend} onOpenChange={setSuspend} title="Suspend account…" description="Revokes every session immediately and disables push tokens." submitLabel="Suspend" destructive onSubmit={async () => { await api(`/v1/dev/users/${id}/suspend`, { body: { reason } }); await qc.invalidateQueries({ queryKey: key }) }}>
        <Field label="Reason"><textarea className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required /></Field>
      </FormDialog>
    </div>
  )
}
