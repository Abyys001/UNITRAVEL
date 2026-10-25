"use client"

import { useQuery } from "@tanstack/react-query"
import { Fragment, useState } from "react"

import { PERMISSIONS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState } from "@/components/bento"
import { useConfirm } from "@/components/confirm"
import { ListCard, Toolbar } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { ErrorLine, Field, Loading, PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Role { id: string; key: string; name: string; builtIn: boolean; privileged: boolean; permissions: string[]; members: number }

const group = (p: string) => p.split(".")[0]!

/** Permission matrix (Table 10.1) and the role editor: built-in roles can be cloned, not edited or deleted. */
export default function RolesPage() {
  const t = useT()
  const { can } = useSession()
  const q = useQuery({ queryKey: ["roles"], queryFn: () => api<{ catalogue: string[]; privilegedPermissions?: string[]; roles: Role[] }>("/v1/dev/roles") })
  const { ask, dialog } = useConfirm()
  const [text, setText] = useState("")
  const [edit, setEdit] = useState<{ mode: "create" | "edit"; key: string; name: string; permissions: string[]; clonedFrom?: string } | null>(null)
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const { roles } = q.data
  const catalogue = q.data.catalogue.length ? q.data.catalogue : [...PERMISSIONS]
  const shown = catalogue.filter((p) => !text || p.includes(text.toLowerCase()))
  const groups = [...new Set(shown.map(group))]
  const privPerms = new Set(q.data.privilegedPermissions ?? [])
  const priv = can("user.role.assign.privileged")
  const act = "inline-flex min-h-7 items-center rounded-md px-1.5 text-caption font-medium hover:bg-hover pointer-coarse:min-h-11"
  return (
    <div>
      <PageHead kicker={t("dpage.people")} title={t("dpage.roles.title")}><span className="text-meta text-steel">{t("roles.desc")}</span>{priv && <Button size="sm" onClick={() => setEdit({ mode: "create", key: "", name: "", permissions: [] })}>{t("roles.new")}</Button>}</PageHead>
      <Toolbar query={text} onQuery={setText} placeholder={t("roles.search")} count={shown.length} />
      <ListCard>
        <div tabIndex={0} className="max-h-[70dvh] overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-meta" data-testid="permission-matrix">
            <thead>
              <tr>
                <th className="cap sticky start-0 top-0 z-20 min-w-64 border-b border-rule bg-surface-sunk px-4 py-2 text-start">{t("roles.permission")}</th>
                {roles.map((r) => (
                  <th key={r.key} className="sticky top-0 z-10 min-w-28 border-b border-s border-rule bg-surface-sunk px-2 py-2 align-bottom font-normal">
                    <span className="block font-mono text-meta font-semibold" dir="ltr">{r.key}</span>
                    <span className="block text-caption text-steel">{r.builtIn ? t("roles.builtIn") : t("roles.custom")}{r.privileged ? ` · ${t("ud.priv")}` : ""} · {t("roles.members", { n: r.members })}</span>
                    {priv && <span className="mt-1 flex justify-center gap-0.5">{!r.builtIn && <button type="button" className={cn(act, "text-orange-700 dark:text-orange-300")} onClick={() => setEdit({ mode: "edit", key: r.key, name: r.name, permissions: r.permissions })}>{t("roles.edit")}</button>}<button type="button" className={cn(act, "text-orange-700 dark:text-orange-300")} onClick={() => setEdit({ mode: "create", key: `${r.key}_copy`, name: `${r.name} (copy)`, permissions: r.permissions, clonedFrom: r.key })}>{t("roles.clone")}</button>{!r.builtIn && <button type="button" className={cn(act, "text-danger")} onClick={() => ask({ title: t("confirm.roledel.title", { key: r.key }), description: t("confirm.roledel.body"), label: t("confirm.roledel.label"), destructive: true, run: async () => { await api(`/v1/dev/roles/${r.key}`, { method: "DELETE" }); await q.refetch() } })}>{t("roles.delete")}</button>}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr><th colSpan={roles.length + 1} scope="colgroup" className="cap sticky start-0 border-b border-rule bg-surface-sunk/60 px-4 py-1.5 text-start">{g.replace("_", " ")}</th></tr>
                  {shown.filter((p) => group(p) === g).map((p) => (
                    <tr key={p} className="hover:bg-hover/60">
                      <th scope="row" className="sticky start-0 z-[1] border-b border-rule bg-surface-raised px-4 py-1.5 text-start font-mono text-meta font-normal" dir="ltr">{p}{privPerms.has(p) && <span className="ms-1.5 rounded-full bg-warning-subtle px-1.5 text-2xs font-semibold text-warning-subtle-fg" title={t("roles.privHint")}>{t("ud.priv")}</span>}</th>
                      {roles.map((r) => <td key={r.key} className={cn("border-b border-s border-rule text-center", r.permissions.includes(p) && "bg-success-subtle")}>{r.permissions.includes(p) ? <span className="text-success" aria-label={t("roles.granted")} role="img">●</span> : <span className="text-rule-strong" aria-label={t("roles.notGranted")} role="img">·</span>}</td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {!groups.length && <EmptyState title={t("list.noMatch")} className="py-8" />}
      </ListCard>
      <p className="mx-4 mb-4 max-w-3xl text-meta text-steel md:mx-6">{t("roles.privNote")} {t("roles.note")}</p>
      {dialog}
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} wide title={edit.mode === "create" ? (edit.clonedFrom ? t("roles.cloneTitle", { key: edit.clonedFrom }) : t("roles.newTitle")) : t("roles.editTitle", { key: edit.key })} description={t("roles.dialogBody")} submitLabel={t("roles.save")}
          onSubmit={async () => { if (edit.mode === "create") await api("/v1/dev/roles", { body: { key: edit.key, name: edit.name, permissions: edit.permissions, clonedFrom: edit.clonedFrom } }); else await api(`/v1/dev/roles/${edit.key}`, { method: "PUT", body: { name: edit.name, permissions: edit.permissions } }); await q.refetch() }}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("roles.key")}><input className="field-input font-mono" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} pattern="[a-z][a-z0-9_]{2,39}" required disabled={edit.mode === "edit"} /></Field>
            <Field label={t("roles.name")}><input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required minLength={2} /></Field>
          </div>
          <div className="grid max-h-[50dvh] grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-rule p-3 sm:grid-cols-2">{catalogue.map((p) => <label key={p} className="flex items-center gap-1.5 font-mono text-caption" dir="ltr" title={privPerms.has(p) ? t("roles.privHint") : undefined}><input type="checkbox" checked={edit.permissions.includes(p)} onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p) })} />{p}{privPerms.has(p) && <span className="rounded-full bg-warning-subtle px-1.5 text-2xs font-semibold text-warning-subtle-fg">{t("ud.priv")}</span>}</label>)}</div>
        </FormDialog>
      )}
    </div>
  )
}
