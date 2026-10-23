"use client"

import { useQuery } from "@tanstack/react-query"

import { Field } from "@/components/ui"
import { api } from "@/lib/api"
import { human } from "@/lib/format"
import type { StaffDirectoryEntry } from "@/lib/types"

/**
 * Assignee picker backed by GET /v1/admin/staff (needs flight_request.assign); on-duty staff are listed first. Staff
 * without access to the directory (cargo admins) keep the plain id field.
 */
export function StaffSelect({ value, onChange, hint }: { value: string; onChange: (id: string) => void; hint?: string }) {
  const q = useQuery({ queryKey: ["staff-directory"], queryFn: () => api<{ items: StaffDirectoryEntry[] }>("/v1/admin/staff"), staleTime: 60_000, retry: false })
  const staff = [...(q.data?.items ?? [])].sort((a, b) => Number(b.onDuty) - Number(a.onDuty))
  if (q.error) return <Field label="Staff user id" hint={hint}><input className="field-input font-mono" value={value} onChange={(e) => onChange(e.target.value)} required pattern="[0-9a-fA-F-]{36}" dir="ltr" /></Field>
  return (
    <Field label="Assign to" hint={hint}>
      <select className="field-input" value={value} onChange={(e) => onChange(e.target.value)} required disabled={q.isPending} data-testid="staff-select">
        <option value="" disabled>{q.isPending ? "Loading staff…" : "Choose a staff member"}</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.roles.map(human).join(", ")}{s.onDuty ? " · on duty" : ""}</option>)}
      </select>
    </Field>
  )
}
