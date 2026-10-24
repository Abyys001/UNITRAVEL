"use client"

import { useQuery } from "@tanstack/react-query"
import { Fragment, useState } from "react"

import { PERMISSIONS } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { FormDialog } from "@/components/form-dialog"
import { ErrorLine, Field, Loading, PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

interface Role { id: string; key: string; name: string; builtIn: boolean; privileged: boolean; permissions: string[]; members: number }

const group = (p: string) => p.split(".")[0]!

/** Permission matrix (Table 10.1) and the role editor: built-in roles can be cloned, not edited or deleted. */
export default function RolesPage() {
  const { can } = useSession()
  const q = useQuery({ queryKey: ["roles"], queryFn: () => api<{ catalogue: string[]; roles: Role[] }>("/v1/dev/roles") })
  const [edit, setEdit] = useState<{ mode: "create" | "edit"; key: string; name: string; permissions: string[]; clonedFrom?: string } | null>(null)
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!q.data) return <Loading />
  const { roles } = q.data
  const catalogue = q.data.catalogue.length ? q.data.catalogue : [...PERMISSIONS]
  const groups = [...new Set(catalogue.map(group))]
  const priv = can("user.role.assign.privileged")
  return (
    <div>
      <PageHead kicker="People" title="Roles & permissions">{priv && <Button size="sm" onClick={() => setEdit({ mode: "create", key: "", name: "", permissions: [] })}>New custom role</Button>}</PageHead>
      <div tabIndex={0} className="overflow-x-auto px-5 py-3">
        <table className="border-collapse bg-surface-raised text-[12px]" data-testid="permission-matrix">
          <thead className="sticky top-0 bg-surface-raised">
            <tr>
              <th className="cap min-w-64 border-b border-rule px-2 py-1 text-start font-normal">Permission</th>
              {roles.map((r) => (
                <th key={r.key} className="border-b border-s border-rule px-1.5 py-1 align-bottom">
                  <span className="block font-mono text-[11px] font-medium">{r.key}</span>
                  <span className="block text-[10px] font-normal text-steel">{r.builtIn ? "built-in" : "custom"}{r.privileged ? " · priv" : ""} · {r.members}</span>
                  {priv && <span className="mt-0.5 flex justify-center gap-1">{!r.builtIn && <button type="button" className="text-[10px] text-orange-700 underline" onClick={() => setEdit({ mode: "edit", key: r.key, name: r.name, permissions: r.permissions })}>edit</button>}<button type="button" className="text-[10px] text-orange-700 underline" onClick={() => setEdit({ mode: "create", key: `${r.key}_copy`, name: `${r.name} (copy)`, permissions: r.permissions, clonedFrom: r.key })}>clone</button></span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g}>
                <tr><td colSpan={roles.length + 1} className="cap bg-ledger px-2 pt-2 pb-0.5">{g.replace("_", " ")}</td></tr>
                {catalogue.filter((p) => group(p) === g).map((p) => (
                  <tr key={p} className="border-b border-rule/60 hover:bg-line/30">
                    <td className="px-2 py-0.5 font-mono text-[11.5px]">{p}</td>
                    {roles.map((r) => <td key={r.key} className={cn("border-s border-rule/60 text-center", r.permissions.includes(p) && "bg-success-subtle")}>{r.permissions.includes(p) ? <span className="text-success" aria-label="granted">●</span> : <span className="text-rule-strong" aria-label="not granted">·</span>}</td>)}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-steel">The backend checks permissions, never role names. Custom roles can only combine permissions the code already checks.</p>
      </div>
      {edit && (
        <FormDialog open onOpenChange={(o) => !o && setEdit(null)} wide title={edit.mode === "create" ? (edit.clonedFrom ? `Clone ${edit.clonedFrom}…` : "New custom role…") : `Edit ${edit.key}…`} description="Needs a fresh second-factor check. Holders pick up changes on their next request." submitLabel="Save role"
          onSubmit={async () => { if (edit.mode === "create") await api("/v1/dev/roles", { body: { key: edit.key, name: edit.name, permissions: edit.permissions, clonedFrom: edit.clonedFrom } }); else await api(`/v1/dev/roles/${edit.key}`, { method: "PUT", body: { name: edit.name, permissions: edit.permissions } }); await q.refetch() }}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Key"><input className="field-input font-mono" value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} pattern="[a-z][a-z0-9_]{2,39}" required disabled={edit.mode === "edit"} /></Field>
            <Field label="Name"><input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required minLength={2} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">{catalogue.map((p) => <label key={p} className="flex items-center gap-1.5 font-mono text-[11px]"><input type="checkbox" checked={edit.permissions.includes(p)} onChange={(e) => setEdit({ ...edit, permissions: e.target.checked ? [...edit.permissions, p] : edit.permissions.filter((x) => x !== p) })} />{p}</label>)}</div>
        </FormDialog>
      )}
    </div>
  )
}
