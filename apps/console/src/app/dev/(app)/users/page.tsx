"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import type { Page } from "@/lib/types"

interface UserRow { id: string; displayName: string; status: string; roles: string[]; primaryPhone: string | null; email: string | null; phoneVerified: boolean; lastActiveAt: string | null; createdAt: string }

/** User directory (ch. 16.2 §1): search by name, phone, email or request reference. */
function Users() {
  const params = useSearchParams()
  const router = useRouter()
  const f = { q: params.get("q") ?? "", role: params.get("role") ?? "", status: params.get("status") ?? "", verified: params.get("verified") ?? "" }
  const [draft, setDraft] = useState(f)
  useEffect(() => setDraft(f), [params.toString()]) // eslint-disable-line react-hooks/exhaustive-deps
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: { key: string; name: string }[] }>("/v1/dev/roles") })
  const list = useInfiniteQuery({
    queryKey: ["dev-users", f],
    queryFn: ({ pageParam }) => { const u = new URLSearchParams({ limit: "50" }); for (const [k, v] of Object.entries(f)) if (v) u.set(k, v); if (pageParam) u.set("cursor", pageParam); return api<Page<UserRow>>(`/v1/dev/users?${u}`) },
    initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const apply = () => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(draft)) if (v) u.set(k, v); router.replace(`/users?${u}`) }
  return (
    <div>
      <PageHead kicker="People" title="Users" />
      <form className="flex flex-wrap items-end gap-2 border-b border-rule bg-ledger px-5 py-2" onSubmit={(e) => { e.preventDefault(); apply() }}>
        <input aria-label="Search" className="field-input w-72" placeholder="Name, phone, email or UT- reference" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} dir="auto" />
        <NativeSelect aria-label="Role" className="field-input w-40" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}><option value="">Any role</option>{roles.data?.roles.map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}</NativeSelect>
        <NativeSelect aria-label="Status" className="field-input w-32" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="">Any status</option><option>ACTIVE</option><option>SUSPENDED</option><option>DELETED</option></NativeSelect>
        <NativeSelect aria-label="Verified" className="field-input w-36" value={draft.verified} onChange={(e) => setDraft({ ...draft, verified: e.target.value })}><option value="">Any verification</option><option value="yes">Phone verified</option><option value="no">Unverified</option></NativeSelect>
        <Button size="sm" type="submit">Search</Button>
      </form>
      <div className="px-5 py-3">
        {list.error ? <TileError message={errText(list.error)} onRetry={() => void list.refetch()} /> : list.isLoading ? <ListSkeleton rows={8} className="p-0" /> : !rows.length ? <EmptyState title="No users match." /> : (
          <TableScroll><table className="w-full bg-surface-raised" data-testid="users">
            <thead className="bg-surface-raised"><tr className="border-b border-rule">{["Name", "Phone", "Email", "Roles", "Status", "Last active", "Joined"].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
            <tbody>{rows.map((u) => <tr key={u.id} className="border-b border-rule/70 hover:bg-line/30"><td className="px-2 py-1.5"><Link href={`/users/${u.id}`} className="hover:underline" dir="auto">{u.displayName}</Link></td><td className="num px-2 py-1.5" dir="ltr">{u.primaryPhone ?? "—"}{u.primaryPhone && !u.phoneVerified && <span className="ms-1 text-[10px] text-danger">unverified</span>}</td><td className="px-2 py-1.5 text-steel">{u.email ?? "—"}</td><td className="px-2 py-1.5"><span className="flex flex-wrap gap-1">{u.roles.map((r) => <span key={r} className="font-mono text-[11px]">{r}</span>)}</span></td><td className="px-2 py-1.5"><Tag value={u.status} /></td><td className="px-2 py-1.5 text-[12px] text-steel" title={fmtDateTime(u.lastActiveAt)}>{rel(u.lastActiveAt)}</td><td className="px-2 py-1.5 text-[12px] text-steel">{fmtDateTime(u.createdAt)}</td></tr>)}</tbody>
          </table></TableScroll>
        )}
        {list.hasNextPage && <Button size="sm" variant="outline" className="mt-2" onClick={() => void list.fetchNextPage()}>Load more</Button>}
      </div>
    </div>
  )
}

export default function UsersPage() { return <Suspense><Users /></Suspense> }
