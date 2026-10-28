"use client"

import { Plus } from "lucide-react"
import { useEffect, useState } from "react"

import type { LoyaltyTierView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { Chip, ClubOffNotice, clubError, useClubLabels, useRefresh, useTiers } from "@/components/club"
import { Check } from "@/components/controls"
import { ListCard, ListPage, tableClass } from "@/components/data-list"
import { FormDialog } from "@/components/form-dialog"
import { Field, PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"

/** Club tiers (ADR-0016). Reading needs `loyalty.read`; creating and editing need `loyalty.manage`. */
export default function ClubTiers() {
  const L = useClubLabels()
  const { t } = L
  const { can } = useSession()
  const q = useTiers()
  const [editing, setEditing] = useState<LoyaltyTierView | "new" | null>(null)
  const manage = can("loyalty.manage")
  return (
    <ListPage>
      <PageHead title={t("nav.clubTiers")}>
        {manage && <Button size="sm" onClick={() => setEditing("new")} data-testid="club-new-tier"><Plus aria-hidden />{t("club.tier.new")}</Button>}
      </PageHead>
      <ClubOffNotice />
      {q.error ? <div className="px-6 py-3"><TileError error={q.error} onRetry={() => void q.refetch()} /></div> : !q.data ? <ListSkeleton rows={4} className="px-6" /> : !q.data.length ? <EmptyState title={t("club.tiers.none")} /> : (
        <ListCard>
          <TableScroll>
            <table className={tableClass} data-testid="tiers">
              <thead><tr><th>{t("club.c.code")}</th><th>{t("club.c.nameEn")}</th><th>{t("club.c.nameFa")}</th><th>{t("pg.c.status")}</th>{manage && <th><span className="sr-only">{t("club.c.actions")}</span></th>}</tr></thead>
              <tbody>
                {q.data.map((x) => (
                  <tr key={x.id}>
                    <td><span className="ref font-semibold">{x.code}</span></td>
                    <td dir="ltr" lang="en">{x.nameEn}</td>
                    <td className="font-fa" dir="rtl" lang="fa">{x.nameFa}</td>
                    <td><Chip value={x.active ? "ACTIVE" : "INACTIVE"} label={x.active ? t("club.c.active") : t("club.tier.inactive")} /></td>
                    {manage && <td><Button size="xs" variant="outline" onClick={() => setEditing(x)} aria-label={`${t("club.edit")} ${x.code}`}>{t("club.edit")}</Button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </ListCard>
      )}
      {manage && <TierDialog tier={editing} onClose={() => setEditing(null)} />}
    </ListPage>
  )
}

const CODE = /^[A-Z][A-Z0-9_]{1,23}$/

function TierDialog({ tier, onClose }: { tier: LoyaltyTierView | "new" | null; onClose: () => void }) {
  const { t } = useClubLabels()
  const refresh = useRefresh([["club", "tiers"], ["club", "members"]])
  const [f, setF] = useState({ code: "", nameEn: "", nameFa: "", active: true })
  useEffect(() => { if (tier) setF(tier === "new" ? { code: "", nameEn: "", nameFa: "", active: true } : { code: tier.code, nameEn: tier.nameEn, nameFa: tier.nameFa, active: tier.active }) }, [tier])
  if (!tier) return null
  const isNew = tier === "new"
  const codeOk = CODE.test(f.code)
  const submit = async () => {
    const body = { code: f.code.trim(), nameEn: f.nameEn.trim(), nameFa: f.nameFa.trim(), active: f.active }
    try { await api<LoyaltyTierView>(isNew ? "/v1/admin/club/tiers" : `/v1/admin/club/tiers/${tier.id}`, { method: isNew ? "POST" : "PATCH", body }) } catch (e) { throw clubError(e, t) }
    await refresh()
  }
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={isNew ? t("club.tier.new") : t("club.tier.edit", { code: tier.code })} submitLabel={t("club.save")} onSubmit={submit} testId="dlg-tier">
      <Field label={t("club.c.code")} hint={t("club.tier.code.hint")}>
        <input className="field-input font-mono uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, "_") })} required pattern="[A-Z][A-Z0-9_]{1,23}" maxLength={24} aria-invalid={f.code ? !codeOk : undefined} dir="ltr" autoComplete="off" />
      </Field>
      <Field label={t("club.c.nameEn")}><input className="field-input" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} required maxLength={60} dir="ltr" lang="en" /></Field>
      <Field label={t("club.c.nameFa")}><input className="field-input font-fa" value={f.nameFa} onChange={(e) => setF({ ...f, nameFa: e.target.value })} required maxLength={60} dir="rtl" lang="fa" /></Field>
      <Check label={t("club.c.active")} checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
    </FormDialog>
  )
}
