"use client"

import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { Chips, ListCard, Pager, Toolbar, usePaged } from "@/components/data-list"
import { DataTable } from "@/components/dev-ui"
import { PageHead, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { fmtDateTime, rel } from "@/lib/format"
import type { Page } from "@/lib/types"

interface UserRow { id: string; displayName: string; status: string; roles: string[]; primaryPhone: string | null; email: string | null; phoneVerified: boolean; lastActiveAt: string | null; createdAt: string }

/** User directory (ch. 16.2 §1): search by name, phone, email or request reference; filters live in the URL. */
function Users() {
  const t = useT()
  const params = useSearchParams()
  const router = useRouter()
  const f = useMemo(() => ({ q: params.get("q") ?? "", role: params.get("role") ?? "", status: params.get("status") ?? "", verified: params.get("verified") ?? "" }), [params])
  const [draft, setDraft] = useState(f)
  useEffect(() => setDraft(f), [f])
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<{ roles: { key: string; name: string }[] }>("/v1/dev/roles") })
  const list = useInfiniteQuery({
    queryKey: ["dev-users", f],
    queryFn: ({ pageParam }) => { const u = new URLSearchParams({ limit: "50" }); for (const [k, v] of Object.entries(f)) if (v) u.set(k, v); if (pageParam) u.set("cursor", pageParam); return api<Page<UserRow>>(`/v1/dev/users?${u}`) },
    initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const paged = usePaged(rows)
  const apply = (d = draft) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(d)) if (v) u.set(k, v); router.replace(`/users?${u}`) }
  const pick = (k: "status" | "verified", v: string) => { const d = { ...draft, [k]: v }; setDraft(d); apply(d) }
  const filtered = Object.values(f).some(Boolean)
  const lastPage = paged.page >= paged.pages - 1
  return (
    <div>
      <PageHead kicker={t("dpage.people")} title={t("dpage.users.title")}><span className="text-meta text-steel">{t("users.desc")}</span></PageHead>
      <form onSubmit={(e) => { e.preventDefault(); apply() }}>
        <Toolbar count={rows.length}>
          <label className="relative min-w-56 flex-1 md:max-w-80">
            <span className="sr-only">{t("list.search")}</span>
            <input type="search" aria-label="Search" className="field-input" placeholder={t("users.searchPh")} value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} dir="auto" />
          </label>
          <NativeSelect aria-label={t("users.role")} className="field-input w-40" value={draft.role} onChange={(e) => { const d = { ...draft, role: e.target.value }; setDraft(d); apply(d) }}><option value="">{t("users.anyRole")}</option>{roles.data?.roles.map((r) => <option key={r.key} value={r.key}>{r.key}</option>)}</NativeSelect>
          <Button size="sm" type="submit">{t("list.search")}</Button>
          {filtered && <Button size="sm" type="button" variant="ghost" onClick={() => router.replace("/users")}>{t("list.clear")}</Button>}
        </Toolbar>
        <div className="flex flex-wrap gap-x-6 gap-y-2 px-4 pb-3 md:px-6">
          <Chips label={t("users.status")} value={draft.status} onChange={(v) => pick("status", v)} options={[{ value: "", label: t("list.all") }, { value: "ACTIVE", label: t("users.active") }, { value: "SUSPENDED", label: t("users.suspended") }, { value: "DELETED", label: t("users.deleted") }]} />
          <Chips label={t("users.verification")} value={draft.verified} onChange={(v) => pick("verified", v)} options={[{ value: "", label: t("list.all") }, { value: "yes", label: t("users.verified") }, { value: "no", label: t("users.unverified") }]} />
        </div>
      </form>
      {list.error ? <div className="px-4 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : list.isLoading ? <ListSkeleton rows={8} /> : !rows.length ? <ListCard><EmptyState title={t("users.none")} hint={t("users.noneHint")} className="py-10" /></ListCard> : (
        <ListCard>
          <DataTable data-testid="users">
            <thead><tr>{[t("users.c.name"), t("users.c.phone"), t("users.c.email"), t("users.c.roles"), t("users.c.status"), t("users.c.active"), t("users.c.joined")].map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{paged.rows.map((u) => <tr key={u.id}><td className="font-medium"><Link href={`/users/${u.id}`} className="hover:underline" dir="auto">{u.displayName}</Link></td><td className="num whitespace-nowrap" dir="ltr">{u.primaryPhone ?? "—"}{u.primaryPhone && !u.phoneVerified && <span className="ms-1.5 rounded-full bg-danger-subtle px-1.5 text-2xs text-danger">{t("users.unverified")}</span>}</td><td className="text-steel" dir="ltr">{u.email ?? "—"}</td><td><span className="flex flex-wrap gap-1">{u.roles.map((r) => <span key={r} className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption" dir="ltr">{r}</span>)}</span></td><td><Tag value={u.status} /></td><td className="text-meta text-steel" title={fmtDateTime(u.lastActiveAt)}>{rel(u.lastActiveAt)}</td><td className="whitespace-nowrap text-meta text-steel">{fmtDateTime(u.createdAt)}</td></tr>)}</tbody>
          </DataTable>
          <Pager {...paged} className="border-t border-rule" />
          {list.hasNextPage && lastPage && <div className="border-t border-rule px-4 py-3 md:px-6"><Button size="sm" variant="outline" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{t("list.loadMore")}</Button></div>}
        </ListCard>
      )}
    </div>
  )
}

export default function UsersPage() { return <Suspense><Users /></Suspense> }
