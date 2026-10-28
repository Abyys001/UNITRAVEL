"use client"

import { useQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo, useState } from "react"

import type { LoyaltyBenefitView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { BENEFIT_STATUSES, BenefitDialog, BenefitList, ClubExplain, ClubOffNotice, useClubLabels, useMembers, useTiers } from "@/components/club"
import { Chips, ListCard, ListPage, Pager, Toolbar, usePaged } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

/** Club benefits (ADR-0016): filter by status, tier or member; create (loyalty.manage), approve (four eyes), revoke. */
export default function ClubBenefits() {
  const L = useClubLabels()
  const { t } = L
  const { can } = useSession()
  const [status, setStatus] = useState<(typeof BENEFIT_STATUSES)[number] | "">("")
  const [tierId, setTierId] = useState("")
  const [userId, setUserId] = useState("")
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const tiers = useTiers()
  const members = useMembers()
  const qs = new URLSearchParams({ limit: "200" })
  if (status) qs.set("status", status)
  if (tierId) qs.set("tierId", tierId)
  if (userId) qs.set("userId", userId)
  const key = ["club", "benefits", status, tierId, userId]
  const q = useQuery({ queryKey: key, queryFn: () => api<LoyaltyBenefitView[]>(`/v1/admin/club/benefits?${qs.toString()}`) })
  const rows = useMemo(() => { const n = search.trim().toLowerCase(); return (q.data ?? []).filter((b) => !n || b.description.en.toLowerCase().includes(n) || b.description.fa.includes(n)) }, [q.data, search])
  const paged = usePaged(rows)
  const pending = (q.data ?? []).filter((b) => b.status === "PENDING_APPROVAL").length
  return (
    <ListPage>
      <PageHead title={t("nav.clubBenefits")}>
        {can("loyalty.manage") && <Button size="sm" onClick={() => setCreating(true)} disabled={!tiers.data} data-testid="club-new-benefit"><Plus aria-hidden />{t("club.b.new")}</Button>}
      </PageHead>
      <ClubOffNotice />
      <ClubExplain />
      <Toolbar query={search} onQuery={setSearch} placeholder={t("list.search")} count={q.data ? rows.length : undefined}>
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "" as const, label: t("pg.all") }, ...BENEFIT_STATUSES.map((s) => ({ value: s, label: L.benefitStatus(s), count: s === "PENDING_APPROVAL" && !status ? pending : undefined }))]} onChange={setStatus} />
        <label className="w-full sm:w-44">
          <span className="sr-only">{t("club.c.tier")}</span>
          <NativeSelect className="field-input" value={tierId} onChange={(e) => { setTierId(e.target.value); if (e.target.value) setUserId("") }}>
            <option value="">{t("club.anyTier")}</option>
            {(tiers.data ?? []).map((x) => <option key={x.id} value={x.id}>{L.tierName(x)} ({x.code})</option>)}
          </NativeSelect>
        </label>
        <label className="w-full sm:w-52">
          <span className="sr-only">{t("club.b.member")}</span>
          <NativeSelect className="field-input" value={userId} onChange={(e) => { setUserId(e.target.value); if (e.target.value) setTierId("") }}>
            <option value="">{`${t("club.b.member")}: ${t("pg.all")}`}</option>
            {(members.data ?? []).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </NativeSelect>
        </label>
      </Toolbar>
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={6} className="px-6" /> : !rows.length ? <EmptyState title={t("club.b.none")} /> : (
        <>
          <div className="px-4 md:hidden"><BenefitList benefits={paged.rows} tiers={tiers.data ?? []} members={members.data} invalidate={[["club", "benefits"]]} layout="cards" /></div>
          <ListCard fill className="hidden md:flex">
            <div tabIndex={0} role="region" aria-label={t("nav.clubBenefits")} className="grid-scroll min-h-0 flex-1 focus-visible:outline-offset-[-2px]">
              <BenefitList benefits={paged.rows} tiers={tiers.data ?? []} members={members.data} invalidate={[["club", "benefits"]]} testId="benefits-table" layout="table" />
            </div>
            <Pager {...paged} className="border-t border-rule" />
          </ListCard>
          <div className="md:hidden"><Pager {...paged} /></div>
        </>
      )}
      {can("loyalty.manage") && tiers.data && <BenefitDialog open={creating} onOpenChange={setCreating} tiers={tiers.data} members={members.data} invalidate={[["club", "benefits"], ["club", "members"], ["club", "ledger"]]} />}
    </ListPage>
  )
}
