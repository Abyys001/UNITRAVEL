"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { PRIVILEGED_ROLES } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { useConfirm } from "@/components/confirm"
import { FormDialog } from "@/components/form-dialog"
import { DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { EmptyState } from "@/components/bento"
import { ErrorLine, Field, Loading, PageHead, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
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
  const t = useT()
  const { ask, dialog } = useConfirm()
  const key = ["dev-user", id]
  const q = useQuery({ queryKey: key, queryFn: () => api<Detail>(`/v1/dev/users/${id}`) })
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: Role[] }>("/v1/dev/roles") })
  const [sel, setSel] = useState<string[]>([])
  useEffect(() => { if (q.data) setSel(q.data.roles) }, [q.data])
  const [suspend, setSuspend] = useState(false)
  const [reason, setReason] = useState("")
  const [roleErr, setRoleErr] = useState<string | null>(null)
  const inv = { invalidate: [key] }
  const saveRoles = useAct(() => api(`/v1/dev/users/${id}/roles`, { method: "PUT", body: { roles: sel } }), { ...inv, success: t("ud.rolesSaved") })
  const reactivate = useAct(() => api(`/v1/dev/users/${id}/reactivate`, { body: {} }), { ...inv, success: t("ud.reactivated") })
  const revokeAll = useAct(() => api<{ revoked: number }>(`/v1/dev/users/${id}/sessions/revoke`, { body: {} }), { ...inv, onDone: (r) => toast.success(t("ud.revoked", { n: r.revoked })) })
  const reverify = useAct(() => api(`/v1/dev/users/${id}/force-reverify`, { body: {} }), { ...inv, success: t("ud.reverified") })
  const unlink = useAct((identityId: string) => api(`/v1/dev/users/${id}/identities/${identityId}/unlink`, { body: {} }), { ...inv, success: t("ud.unlinked") })
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const u = q.data
  const all = roles.data?.roles ?? []
  const privileged = (k: string) => all.find((r) => r.key === k)?.privileged || (PRIVILEGED_ROLES as readonly string[]).includes(k)
  const changed = [...sel].sort().join() !== [...u.roles].sort().join()
  const touchesPriv = [...sel.filter((r) => !u.roles.includes(r)), ...u.roles.filter((r) => !sel.includes(r))].some(privileged)
  const none = <EmptyState title={t("ud.none")} className="py-4" />
  return (
    <div>
      <PageHead kicker={<>{t("ud.user")} · <span className="font-mono" dir="ltr">{u.id}</span> · {t("ud.joined", { at: fmtDateTime(u.createdAt) })} · {t("ud.perm", { v: u.permVersion })}</>} title={<span dir="auto">{u.displayName}</span>}>
        <Tag value={u.status} />
        {can("user.role.assign") && u.id !== me?.id && (u.status === "SUSPENDED" ? <Button size="sm" variant="outline" onClick={() => reactivate.mutate()}>{t("ud.reactivate")}</Button> : <Button size="sm" variant="destructive" onClick={() => setSuspend(true)}>{t("ud.suspend")}</Button>)}
        {can("user.role.assign") && <Button size="sm" variant="outline" onClick={() => ask({ title: t("confirm.revoke.title"), description: t("confirm.revoke.body"), label: t("confirm.revoke.label"), destructive: true, run: () => revokeAll.mutateAsync() })}>{t("ud.revokeAll")}</Button>}
        {can("user.role.assign") && <Button size="sm" variant="ghost" onClick={() => ask({ title: t("confirm.reverify.title"), description: t("confirm.reverify.body"), label: t("confirm.reverify.label"), run: () => reverify.mutateAsync() })}>{t("ud.reverify")}</Button>}
      </PageHead>
      <DevPage>
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("ud.roles")} hint={t("ud.rolesHint")} aside={touchesPriv && <span className="rounded-full bg-warning-subtle px-2.5 py-0.5 text-warning-subtle-fg">{t("ud.privChange")}</span>} className="lg:col-span-2">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="role-editor">
              {all.map((r) => <label key={r.key} className={cn("flex min-w-0 items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 pointer-coarse:min-h-11", sel.includes(r.key) ? "border-navy-900 dark:border-white/70" : "border-rule")}><input type="checkbox" checked={sel.includes(r.key)} onChange={(e) => { setRoleErr(null); setSel(e.target.checked ? [...sel, r.key] : sel.filter((x) => x !== r.key)) }} disabled={!can("user.role.assign")} /><span className="min-w-0 font-mono text-meta break-all" dir="ltr">{r.key}</span>{privileged(r.key) && <span className="ms-auto shrink-0 rounded-full bg-warning-subtle px-1.5 text-2xs font-semibold text-warning-subtle-fg">{t("ud.priv")}</span>}</label>)}
            </div>
            {can("user.role.assign") && <div className="mt-4 flex items-center gap-2"><Button size="sm" disabled={!changed} loading={saveRoles.isPending} onClick={() => saveRoles.mutate(undefined, { onError: (e) => setRoleErr(errText(e)) })}>{t("ud.saveRoles")}</Button>{changed && <Button size="sm" variant="ghost" onClick={() => setSel(u.roles)}>{t("ud.reset")}</Button>}</div>}
            {roleErr && <p role="alert" className="mt-2 rounded-md bg-danger-subtle px-3 py-2 text-danger" data-testid="role-error">{roleErr}</p>}
            <p className="mt-3 text-meta text-steel">{t("ud.lastOwner")}</p>
            <details className="mt-2"><summary className="cursor-pointer text-meta text-steel">{t("ud.effective", { n: u.permissions.length })}</summary><p className="mt-2 flex flex-wrap gap-1">{u.permissions.map((p) => <span key={p} className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption" dir="ltr">{p}</span>)}</p></details>
          </Section>
          <Section title={t("ud.identities")} flush>
            <ul className="divide-y divide-rule">{u.identities.map((i) => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 md:px-5"><span className="min-w-0"><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption">{i.type}</span> <span className="num" dir="ltr">{i.value}</span>{i.isPrimary && <span className="ms-1.5 text-caption text-steel">{t("ud.primary")}</span>}{i.revokedAt && <span className="ms-1.5 text-caption text-danger">{t("ud.unlinkedTag")}</span>}</span><span className="flex items-center gap-2">{i.verifiedAt ? <span className="text-meta text-success">{t("ud.verifiedAt", { at: fmtDateTime(i.verifiedAt) })}</span> : <span className="text-meta text-danger">{t("users.unverified")}</span>}{!i.revokedAt && can("user.role.assign") && <Button size="xs" variant="ghost" onClick={() => ask({ title: t("confirm.unlink.title"), description: t("confirm.unlink.body", { value: i.value }), label: t("confirm.unlink.label"), destructive: true, run: () => unlink.mutateAsync(i.id) })}>{t("ud.unlink")}</Button>}</span></li>)}</ul>
          </Section>
          <Section title={t("ud.sessions", { n: u.sessions.length })} flush={u.sessions.length > 0}>
            {!u.sessions.length ? none : <ul className="divide-y divide-rule">{u.sessions.map((s) => <li key={s.id} className="px-4 py-2.5 md:px-5"><p className="flex flex-wrap items-baseline justify-between gap-2"><span><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption">{s.client}</span> <span className="num" dir="ltr">{s.ip}</span></span><span className="text-meta text-steel">MFA {s.mfaLevel} · {t("ud.seen", { at: fmtDateTime(s.lastSeenAt) })}</span></p><p className="mt-0.5 truncate text-caption text-steel" dir="ltr">{s.userAgent}</p></li>)}</ul>}
            {u.devices.length > 0 && <p className="border-t border-rule px-4 py-2.5 text-meta text-steel md:px-5">{t("ud.devices")}: <span dir="ltr">{u.devices.map((d) => `${d.platform}/${d.pushProvider}${d.appVersion ? ` ${d.appVersion}` : ""}`).join(" · ")}</span></p>}
          </Section>
          <Section title={t("ud.events")} flush={u.securityEvents.length > 0}>
            {!u.securityEvents.length ? none : <KV className="px-4 py-3 text-meta md:px-5">{u.securityEvents.map((e, i) => <KVRow key={i} k={<span className="font-mono text-meta" dir="ltr">{e.action}</span>}><span className="text-steel">{e.ip ?? ""} · {fmtDateTime(e.at)}</span></KVRow>)}</KV>}
          </Section>
          <Section title={t("ud.requests")} flush={u.requests.length > 0}>
            {!u.requests.length ? none : <ul className="divide-y divide-rule">{u.requests.map((r) => <li key={r.ref} className="flex items-center justify-between gap-2 px-4 py-2.5 md:px-5"><span className="ref" dir="ltr">{r.ref}</span><span className="flex items-center gap-2"><span className="text-meta text-steel">{fmtDateTime(r.submittedAt)}</span><Tag value={r.status} /></span></li>)}</ul>}
          </Section>
        </div>
      </DevPage>
      {dialog}
      <FormDialog open={suspend} onOpenChange={setSuspend} title={t("ud.suspendTitle")} description={t("ud.suspendBody")} submitLabel={t("ud.suspendLabel")} destructive onSubmit={async () => { await api(`/v1/dev/users/${id}/suspend`, { body: { reason } }); await qc.invalidateQueries({ queryKey: key }) }}>
        <Field label={t("ud.reason")}><textarea className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required /></Field>
      </FormDialog>
    </div>
  )
}
