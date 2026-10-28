"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type { LoyaltyBenefitView, LoyaltyLedgerEntry, LoyaltyMemberView, StaffInvoiceListItem } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { TileError } from "@/components/bento"
import { ListSkeleton, SummaryItem, TableScroll } from "@/components/case"
import { BenefitDialog, BenefitList, Chip, ClubExplain, ClubOffNotice, clubError, credit, CURRENCIES, MEMBER_STATUSES, useClubLabels, useRefresh, useTiers } from "@/components/club"
import { FormDialog, useDialogs } from "@/components/form-dialog"
import { Empty, Field, Loading, PageHead, Panel } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, money, toMinor } from "@/lib/format"
import { useCrumbLabel } from "@/lib/crumb"
import { useSession } from "@/lib/session"

/** One club member (ADR-0016): membership, the member's own and tier benefits, and the insert-only credit ledger. */
export default function ClubMember() {
  const { userId } = useParams<{ userId: string }>()
  const L = useClubLabels()
  const { t } = L
  const { can } = useSession()
  const dlg = useDialogs<"member" | "ledger" | "benefit">()
  const tiers = useTiers()
  const q = useQuery({ queryKey: ["club", "members", "one", userId], queryFn: () => api<LoyaltyMemberView>(`/v1/admin/club/members/${userId}`) })
  const own = useQuery({ queryKey: ["club", "benefits", "user", userId], queryFn: () => api<LoyaltyBenefitView[]>(`/v1/admin/club/benefits?userId=${userId}&limit=200`) })
  const tierId = q.data?.tier.id
  const ofTier = useQuery({ queryKey: ["club", "benefits", "tier", tierId], queryFn: () => api<LoyaltyBenefitView[]>(`/v1/admin/club/benefits?tierId=${tierId}&limit=200`), enabled: !!tierId })
  const ledger = useQuery({ queryKey: ["club", "ledger", userId], queryFn: () => api<LoyaltyLedgerEntry[]>(`/v1/admin/club/ledger?userId=${userId}&limit=200`) })
  useCrumbLabel(q.data?.name)
  const manage = can("loyalty.manage")
  const invalidate = [["club", "benefits"], ["club", "members"], ["club", "ledger", userId]]
  if (q.error) return <div className="p-5"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!q.data) return <><Loading /><ListSkeleton rows={5} /></>
  const m = q.data
  return (
    <div className="pb-8">
      <PageHead kicker={t("nav.club")} title={<span dir="auto">{m.name}</span>}>
        {manage && <>
          <Button size="sm" variant="outline" onClick={() => dlg.open("member")} data-testid="member-change">{t("club.m.change")}</Button>
          <Button size="sm" variant="outline" onClick={() => dlg.open("benefit")} disabled={!tiers.data || m.status !== "ACTIVE"} data-testid="member-grant">{t("club.b.grant")}</Button>
        </>}
      </PageHead>
      <ClubOffNotice />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-rule bg-surface-raised px-5 py-3 md:px-6" data-testid="case-summary">
        <SummaryItem label={t("pg.c.status")}><Chip value={m.status} label={L.memberStatus(m.status)} /></SummaryItem>
        <SummaryItem label={t("club.c.tier")}><span className="font-medium">{L.tierName(m.tier)}</span><span className="ref text-meta text-steel">{m.tier.code}</span></SummaryItem>
        <SummaryItem label={t("club.c.credit")}><span className="num font-semibold" data-testid="member-credit">{credit(m.creditBalance, t("club.m.noCredit"))}</span></SummaryItem>
        <SummaryItem label={t("club.c.joined")}><span className="num">{fmtDate(m.joinedAt)}</span><span className="text-meta text-steel">{t("club.c.addedBy")} <span dir="auto">{m.addedBy}</span></span></SummaryItem>
      </div>
      {m.note && <p className="px-5 pt-3 text-steel md:px-6" dir="auto">“{m.note}”</p>}
      <div className="px-5 pt-2 md:px-6">
        <Panel title={t("club.b.memberBenefits")}>
          <ClubExplain className="mb-3 text-meta text-steel" />
          {own.error ? <TileError error={own.error} onRetry={() => void own.refetch()} /> : !own.data ? <ListSkeleton rows={2} className="p-0" /> : !own.data.length ? <Empty>{t("club.b.none")}</Empty> : <TableScroll><BenefitList benefits={own.data} tiers={tiers.data ?? []} members={[m]} invalidate={invalidate} testId="member-benefits" /></TableScroll>}
        </Panel>
        <Panel title={t("club.b.tierBenefits", { tier: L.tierName(m.tier) })}>
          {ofTier.error ? <TileError error={ofTier.error} onRetry={() => void ofTier.refetch()} /> : !ofTier.data ? <ListSkeleton rows={2} className="p-0" /> : !ofTier.data.length ? <Empty>{t("club.b.none")}</Empty> : <TableScroll><BenefitList benefits={ofTier.data} tiers={tiers.data ?? []} invalidate={invalidate} testId="tier-benefits" /></TableScroll>}
        </Panel>
        <Panel title={t("club.ledger")} aside={manage && <Button size="xs" variant="outline" onClick={() => dlg.open("ledger")} data-testid="ledger-add">{t("club.ledger.add")}</Button>}>
          <p className="mb-2 text-meta text-steel">{t("club.ledger.hint")}</p>
          {ledger.error ? <TileError error={ledger.error} onRetry={() => void ledger.refetch()} /> : !ledger.data ? <ListSkeleton rows={3} className="p-0" /> : !ledger.data.length ? <Empty>{t("club.ledger.none")}</Empty> : (
            <TableScroll label={t("club.ledger")}>
              <table className="data-table" data-testid="ledger">
                <thead><tr><th>{t("club.c.date")}</th><th>{t("club.ledger.kind")}</th><th className="cell-num">{t("club.c.amount")}</th><th>{t("club.c.reason")}</th><th>{t("club.c.invoice")}</th><th>{t("club.c.actor")}</th></tr></thead>
                <tbody>
                  {ledger.data.map((e) => (
                    <tr key={e.id}>
                      <td className="num whitespace-nowrap text-steel">{fmtDateTime(e.createdAt)}</td>
                      <td><Chip value={e.kind === "GRANTED" ? "ACTIVE" : e.kind === "USED" ? "SENT" : "NEUTRAL"} label={L.ledgerKind(e.kind)} /></td>
                      <td className={cn("cell-num whitespace-nowrap font-medium", e.kind !== "GRANTED" && "text-steel")}>{e.kind === "GRANTED" ? "+" : "−"}{money(e.amount)}</td>
                      <td dir="auto">{e.reason}</td>
                      <td>{e.invoiceNumber ? <span className="ref">{e.invoiceNumber}</span> : "—"}</td>
                      <td className="text-steel" dir="auto">{e.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      </div>
      {manage && <>
        <MemberDialog {...dlg.bind("member")} member={m} />
        <LedgerDialog {...dlg.bind("ledger")} member={m} />
        {tiers.data && <BenefitDialog {...dlg.bind("benefit")} tiers={tiers.data} fixedUserId={m.userId} invalidate={invalidate} />}
      </>}
    </div>
  )
}

/** PATCH /v1/admin/club/members/:userId — tier, status and note; the reason (5+ characters) goes to the audit log. */
function MemberDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: LoyaltyMemberView }) {
  const L = useClubLabels()
  const { t } = L
  const tiers = useTiers()
  const refresh = useRefresh([["club", "members"]])
  const [f, setF] = useState({ tierId: member.tier.id, status: member.status as string, note: member.note ?? "", reason: "" })
  useEffect(() => { if (open) setF({ tierId: member.tier.id, status: member.status, note: member.note ?? "", reason: "" }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const body = {
      tierId: f.tierId !== member.tier.id ? f.tierId : undefined,
      status: f.status !== member.status ? f.status : undefined,
      note: f.note.trim() !== (member.note ?? "") ? f.note.trim() : undefined,
      reason: f.reason.trim(),
    }
    try { await api<LoyaltyMemberView>(`/v1/admin/club/members/${member.userId}`, { method: "PATCH", body }) } catch (e) { throw clubError(e, t) }
    await refresh()
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("club.m.change")} submitLabel={t("club.save")} onSubmit={submit} testId="dlg-member">
      <Field label={t("club.c.tier")}>
        <NativeSelect className="field-input" value={f.tierId} onChange={(e) => setF({ ...f, tierId: e.target.value })}>
          {(tiers.data ?? [member.tier]).map((x) => <option key={x.id} value={x.id} disabled={!x.active && x.id !== member.tier.id}>{L.tierName(x)} ({x.code}){x.active ? "" : ` · ${t("club.tier.inactive")}`}</option>)}
        </NativeSelect>
      </Field>
      <Field label={t("club.m.status")}>
        <NativeSelect className="field-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{MEMBER_STATUSES.map((s) => <option key={s} value={s}>{L.memberStatus(s)}</option>)}</NativeSelect>
      </Field>
      <Field label={t("club.m.note")}><input className="field-input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} dir="auto" /></Field>
      <Field label={t("club.m.reason")} hint={t("club.m.reason.hint")}><textarea className="field-input min-h-16" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={500} dir="auto" /></Field>
    </FormDialog>
  )
}

/**
 * POST /v1/admin/club/ledger. A manual grant above the four-eyes limit is refused (FOUR_EYES_REQUIRED: use a bonus-credit
 * benefit); USED names an issued invoice of this customer; debits never take the balance below zero (INSUFFICIENT_CREDIT).
 */
function LedgerDialog({ open, onOpenChange, member }: { open: boolean; onOpenChange: (o: boolean) => void; member: LoyaltyMemberView }) {
  const { t, ledgerKind } = useClubLabels()
  const { can } = useSession()
  const refresh = useRefresh([["club", "ledger", member.userId], ["club", "members"]])
  const blank = { kind: "GRANTED" as "GRANTED" | "USED" | "REVERSED", amount: "", currency: member.creditBalance[0]?.currency ?? "GBP", reason: "", invoiceId: "" }
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(blank) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // Invoice picker: the list endpoint has no customer filter, so it lists issued and paid invoices and the server checks
  // that the chosen one belongs to this customer. Staff without invoice access type the invoice id instead.
  const invoicesAllowed = can("commercial_document.issue", "flight_request.read.any", "cargo_request.read.any")
  const invoices = useQuery({
    queryKey: ["invoices", "club-ledger"],
    queryFn: async () => (await Promise.all(["ISSUED", "PAID"].map((s) => api<StaffInvoiceListItem[]>(`/v1/admin/invoices?limit=100&status=${s}`)))).flat(),
    enabled: open && f.kind === "USED" && invoicesAllowed, retry: false,
  })
  const choices = useMemo(() => (invoices.data ?? []).filter((i) => i.number && i.currency === f.currency), [invoices.data, f.currency])
  const submit = async () => {
    const body = { userId: member.userId, kind: f.kind, amount: { amountMinor: toMinor(f.amount, f.currency), currency: f.currency }, reason: f.reason.trim(), invoiceId: f.kind === "USED" ? f.invoiceId.trim() : undefined }
    try { await api<LoyaltyLedgerEntry[]>("/v1/admin/club/ledger", { body }) } catch (e) { throw clubError(e, t, "ledger") }
    await refresh()
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t("club.ledger.add")} description={t("club.ledger.hint")} submitLabel={t("club.save")} onSubmit={submit} testId="dlg-ledger">
      <Field label={t("club.ledger.kind")} hint={f.kind === "GRANTED" ? t("club.ledger.grant.hint") : f.kind === "USED" ? t("club.ledger.used.hint") : undefined}>
        <NativeSelect className="field-input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })} data-testid="ledger-kind">{(["GRANTED", "USED", "REVERSED"] as const).map((k) => <option key={k} value={k}>{ledgerKind(k)}</option>)}</NativeSelect>
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-2">
        <Field label={t("club.c.amount")}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required placeholder="0.00" dir="ltr" /></Field>
        <Field label={t("q.currency")}><NativeSelect className="field-input" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value, invoiceId: "" })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
      </div>
      {f.kind === "USED" && (invoicesAllowed && !invoices.error ? (
        <Field label={t("club.c.invoice")}>
          <NativeSelect className="field-input" value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })} required disabled={invoices.isPending}>
            <option value="" disabled>{invoices.isPending ? t("state.loading") : t("club.ledger.invoice.choose")}</option>
            {choices.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.requestRef}{i.total ? ` · ${money(i.total)}` : ""}</option>)}
          </NativeSelect>
        </Field>
      ) : (
        <Field label={t("club.ledger.invoice.id")}><input className="field-input font-mono" value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })} required pattern="[0-9a-fA-F-]{36}" dir="ltr" /></Field>
      ))}
      <Field label={t("club.c.reason")} hint={t("club.m.reason.hint")}><textarea className="field-input min-h-16" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={500} dir="auto" /></Field>
    </FormDialog>
  )
}
