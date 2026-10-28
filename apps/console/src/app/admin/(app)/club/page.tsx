"use client"

import { useQuery } from "@tanstack/react-query"
import { UserPlus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useId, useMemo, useState } from "react"

import type { ClubCandidate, LoyaltyMemberView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Chip, ClubOffNotice, clubError, credit, MEMBER_STATUSES, useClubLabels, useMembers, useRefresh, useTiers } from "@/components/club"
import { Chips, ListCard, ListPage, Pager, tableClass, Toolbar, usePaged } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { useSession } from "@/lib/session"

/** Customer club members (ADR-0016). Reading needs `loyalty.read`; adding a member needs `loyalty.manage`. */
export default function ClubMembers() {
  const L = useClubLabels()
  const { t } = L
  const { can } = useSession()
  const router = useRouter()
  const [status, setStatus] = useState<(typeof MEMBER_STATUSES)[number] | "">("ACTIVE")
  const [tierId, setTierId] = useState("")
  const [search, setSearch] = useState("")
  const [adding, setAdding] = useState(false)
  const tiers = useTiers()
  const q = useMembers({ status, tierId })
  const rows = useMemo(() => { const n = search.trim().toLowerCase(); return (q.data ?? []).filter((m) => !n || m.name.toLowerCase().includes(n) || m.tier.code.toLowerCase().includes(n)) }, [q.data, search])
  const paged = usePaged(rows)
  const href = (m: LoyaltyMemberView) => `/club/${m.userId}`
  return (
    <ListPage>
      <PageHead title={t("nav.club")}>
        {can("loyalty.manage") && <Button size="sm" onClick={() => setAdding(true)} disabled={!tiers.data?.some((x) => x.active)} data-testid="club-add-member"><UserPlus aria-hidden />{t("club.add")}</Button>}
      </PageHead>
      <ClubOffNotice />
      {tiers.data && !tiers.data.length && <p className="mx-4 mb-3 text-meta text-steel md:mx-6">{t("club.tiers.none")} <Link href="/club/tiers" className="font-medium text-link hover:underline">{t("nav.clubTiers")} →</Link></p>}
      <Toolbar query={search} onQuery={setSearch} placeholder={t("club.members.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("pg.c.status")} value={status} options={[...MEMBER_STATUSES.map((s) => ({ value: s, label: L.memberStatus(s) })), { value: "" as const, label: t("pg.all") }]} onChange={setStatus} />
        <label className="w-full sm:w-48">
          <span className="sr-only">{t("club.c.tier")}</span>
          <NativeSelect className="field-input" value={tierId} onChange={(e) => setTierId(e.target.value)} data-testid="club-tier-filter">
            <option value="">{t("club.anyTier")}</option>
            {(tiers.data ?? []).map((x) => <option key={x.id} value={x.id}>{L.tierName(x)} ({x.code})</option>)}
          </NativeSelect>
        </label>
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("club.members.none")} /> : (
        <>
          <ul className="space-y-2 px-4 md:hidden" data-testid="member-cards">
            {paged.rows.map((m) => (
              <li key={m.userId}>
                <Link href={href(m)} className="block min-h-11 rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)] active:bg-hover">
                  <span className="flex items-center justify-between gap-2"><span className="font-medium" dir="auto">{m.name}</span><Chip value={m.status} label={L.memberStatus(m.status)} /></span>
                  <span className="mt-1 block text-steel">{L.tierName(m.tier)} · <span className="num">{credit(m.creditBalance, t("club.m.noCredit"))}</span></span>
                  <span className="num mt-1 block text-meta text-steel">{t("club.c.joined")} {fmtDate(m.joinedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <ListCard fill className="hidden md:flex">
            <TableScroll>
              <table className={tableClass} data-testid="members">
                <thead><tr><th>{t("club.c.name")}</th><th>{t("club.c.tier")}</th><th>{t("pg.c.status")}</th><th className="cell-num">{t("club.c.credit")}</th><th>{t("club.c.joined")}</th><th>{t("club.c.addedBy")}</th></tr></thead>
                <tbody>
                  {paged.rows.map((m) => (
                    <tr key={m.userId} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a")) router.push(href(m)) }}>
                      <td><Link href={href(m)} className="inline-block py-1 font-medium hover:underline" dir="auto">{m.name}</Link></td>
                      <td>{L.tierName(m.tier)} <span className="ref text-meta text-steel">{m.tier.code}</span></td>
                      <td><Chip value={m.status} label={L.memberStatus(m.status)} /></td>
                      <td className="cell-num">{credit(m.creditBalance, "—")}</td>
                      <td className="num whitespace-nowrap text-steel">{fmtDate(m.joinedAt)}</td>
                      <td className="text-steel" dir="auto">{m.addedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...paged} /></div>
        </>
      )}
      {can("loyalty.manage") && <AddMemberDialog open={adding} onOpenChange={setAdding} onAdded={(id) => router.push(`/club/${id}`)} />}
    </ListPage>
  )
}

/** Customer search (`GET /v1/admin/club/candidates`, 2+ characters, debounced), then tier and an optional note. */
function AddMemberDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: (userId: string) => void }) {
  const L = useClubLabels()
  const { t } = L
  const tiers = useTiers()
  const refresh = useRefresh([["club", "members"]])
  const [text, setText] = useState("")
  const [term, setTerm] = useState("")
  const [picked, setPicked] = useState<ClubCandidate | null>(null)
  const [tierId, setTierId] = useState("")
  const [note, setNote] = useState("")
  const listId = useId()
  useEffect(() => { if (open) { setText(""); setTerm(""); setPicked(null); setNote(""); setTierId(tiers.data?.find((x) => x.active)?.id ?? "") } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const h = setTimeout(() => setTerm(text.trim()), 300); return () => clearTimeout(h) }, [text])
  const found = useQuery({ queryKey: ["club", "candidates", term], queryFn: () => api<ClubCandidate[]>(`/v1/admin/club/candidates?q=${encodeURIComponent(term)}`), enabled: open && term.length >= 2, retry: false })
  const submit = async () => {
    if (!picked) throw new Error(t("club.add.pick"))
    try { await api<LoyaltyMemberView>("/v1/admin/club/members", { body: { userId: picked.userId, tierId, note: note.trim() || undefined } }) } catch (e) { throw clubError(e, t) }
    await refresh()
    onAdded(picked.userId)
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide title={t("club.add")} submitLabel={t("club.add")} onSubmit={submit} testId="dlg-add-member">
      <Field label={t("club.add.search")} hint={t("club.add.search.hint")}>
        <input type="search" className="field-input" value={text} onChange={(e) => { setText(e.target.value); setPicked(null) }} minLength={2} maxLength={80} autoComplete="off" dir="auto" aria-controls={listId} data-testid="candidate-search" />
      </Field>
      <div id={listId} aria-live="polite">
        {term.length >= 2 && (found.isPending ? <ListSkeleton rows={2} className="p-0" /> : found.error ? <p role="alert" className="text-danger">{clubError(found.error, t).message}</p> : !found.data?.length ? <p className="text-steel">{t("club.add.none")}</p> : (
          <fieldset>
            <legend className="mb-1.5 text-meta font-medium text-ink">{t("club.add.results")}</legend>
            <ul className="max-h-64 space-y-1 overflow-y-auto" data-testid="candidates">
              {found.data.map((c) => (
                <li key={c.userId}>
                  <label className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2", picked?.userId === c.userId ? "border-navy-900 bg-info-subtle dark:border-[#bcd9ff]" : "border-rule hover:bg-hover", c.member && "cursor-not-allowed opacity-60")}>
                    <input type="radio" name="candidate" checked={picked?.userId === c.userId} disabled={c.member} onChange={() => setPicked(c)} />
                    <span className="min-w-0">
                      <span className="block font-medium" dir="auto">{c.name}{c.member && <span className="ms-2 text-caption font-normal text-steel">{t("club.add.member")}</span>}</span>
                      <span className="num block truncate text-meta text-steel" dir="ltr">{[c.email, c.phone].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("club.c.tier")}>
          <NativeSelect className="field-input" value={tierId} onChange={(e) => setTierId(e.target.value)} required>
            <option value="" disabled>{t("club.b.tier.choose")}</option>
            {(tiers.data ?? []).filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{L.tierName(x)} ({x.code})</option>)}
          </NativeSelect>
        </Field>
        <Field label={t("club.add.note")}><input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} dir="auto" /></Field>
      </div>
    </FormDialog>
  )
}
