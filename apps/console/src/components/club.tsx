"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Info } from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import type { LoyaltyBenefitView, LoyaltyMemberView, LoyaltyTierView, Money } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { StatusChip } from "@/components/bento"
import { statusTone } from "@/components/case"
import { FormDialog } from "@/components/form-dialog"
import { Field, useAct } from "@/components/ui"
import { api, ApiError, errText } from "@/lib/api"
import { fmtDate, human, money, toMinor } from "@/lib/format"
import { hasMsg, type T, useT } from "@/lib/i18n"
import { useLocale } from "@/lib/prefs"
import { useSession } from "@/lib/session"
import { useSiteConfig } from "@/lib/site"

/**
 * Customer club building blocks for the Admin Panel (ADR-0016): labels, the "club is off" notice, benefit list and
 * dialogs shared by the Benefits tab and the member page. The server decides every permission and rule (four eyes,
 * credit never below zero); these components only collect input and explain the server's answer.
 */

export const CURRENCIES = ["GBP", "EUR", "USD"] as const
export const MEMBER_STATUSES = ["ACTIVE", "SUSPENDED", "REMOVED"] as const
export const BENEFIT_STATUSES = ["PENDING_APPROVAL", "ACTIVE", "EXPIRED", "REVOKED"] as const
const BENEFIT_KINDS = ["DISCOUNT_PERCENT", "DISCOUNT_FIXED", "BONUS_CREDIT", "PERK"] as const
const APPLIES_TO = ["ANY", "FLIGHT", "CARGO", "SERVICE"] as const

/** A message for a server code (`prefix.CODE`), falling back to the code in plain words. */
export const codeLabel = (t: T, prefix: string, code: string) => { const k = `${prefix}.${code}`; return hasMsg(k) ? t(k) : human(code) }

/** "yyyy-MM-ddTHH:mm" in local time for <input type="datetime-local">. */
export const localInput = (d: Date) => { const x = new Date(d); x.setSeconds(0, 0); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
export const inDays = (n: number) => localInput(new Date(Date.now() + n * 86_400_000))

export function useClubLabels() {
  const t = useT()
  const [locale] = useLocale()
  return {
    t,
    locale,
    memberStatus: (s: string) => codeLabel(t, "club.ms", s),
    benefitStatus: (s: string) => codeLabel(t, "club.bs", s),
    kind: (s: string) => codeLabel(t, "club.k", s),
    appliesTo: (s: string) => codeLabel(t, "club.a", s),
    ledgerKind: (s: string) => codeLabel(t, "club.l", s),
    tierName: (tier: Pick<LoyaltyTierView, "nameEn" | "nameFa"> | undefined | null) => (tier ? (locale === "fa" ? tier.nameFa : tier.nameEn) : "—"),
    desc: (b: Pick<LoyaltyBenefitView, "description">) => (locale === "fa" ? b.description.fa : b.description.en),
    value: (b: Pick<LoyaltyBenefitView, "kind" | "value" | "currency">) => benefitValue(b, t),
  }
}

export function benefitValue(b: Pick<LoyaltyBenefitView, "kind" | "value" | "currency">, t: T) {
  if (b.kind === "DISCOUNT_PERCENT") return `${b.value}%`
  if (b.kind === "PERK") return t("club.b.perk")
  return b.currency ? money({ amountMinor: b.value, currency: b.currency }) : String(b.value)
}

export const Chip = ({ value, label }: { value: string; label: string }) => <StatusChip tone={statusTone(value)}><span data-status={value}>{label}</span></StatusChip>

export const credit = (list: Money[], none: string) => (list.length ? list.map((m) => money(m)).join(" · ") : none)

/** Explains the server's answer for club writes in plain words; anything else keeps the API's own text. */
export function clubError(e: unknown, t: T, context: "approve" | "ledger" | "other" = "other"): Error {
  if (!(e instanceof ApiError)) return e instanceof Error ? e : new Error(String(e))
  if (e.code === "FOUR_EYES_REQUIRED") return new Error(context === "ledger" ? t("club.err.fourEyesGrant") : t("club.err.fourEyesApprove"))
  const codes = e.problem.errors?.map((x) => x.code) ?? []
  if (codes.includes("INSUFFICIENT_CREDIT")) return new Error(t("club.err.insufficient"))
  if (codes.includes("NOT_A_MEMBER")) return new Error(t("club.err.notMember"))
  if (context === "ledger" && e.problem.errors?.some((x) => x.path === "invoiceId" || x.code === "CURRENCY")) return new Error(t("club.err.invoice"))
  if (e.problem.errors?.some((x) => x.path === "tierId" && x.code === "INVALID")) return new Error(t("club.err.tier"))
  return new Error(errText(e))
}

/** Shown on the club pages when the flag is off; the rail hides them, but a bookmarked page still opens. */
export function ClubOffNotice() {
  const t = useT()
  const site = useSiteConfig()
  if (site.data?.menu.club !== false) return null
  // With the flag off the rail (and so the hub tabs) hide the club; these links keep the pages reachable for preparation.
  return (
    <div role="status" className="mx-4 mb-3 rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-warning-subtle-fg md:mx-6" data-testid="club-off">
      <p className="flex items-start gap-2"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{t("club.off")}</p>
      <nav aria-label={t("nav.club")} className="mt-1 flex flex-wrap gap-x-4 ps-6">
        <Link href="/club" className="inline-flex min-h-8 items-center font-medium underline-offset-2 hover:underline">{t("nav.clubMembers")}</Link>
        <Link href="/club/benefits" className="inline-flex min-h-8 items-center font-medium underline-offset-2 hover:underline">{t("nav.clubBenefits")}</Link>
        <Link href="/club/tiers" className="inline-flex min-h-8 items-center font-medium underline-offset-2 hover:underline">{t("nav.clubTiers")}</Link>
      </nav>
    </div>
  )
}

export function ClubExplain({ className }: { className?: string }) {
  const t = useT()
  return <p className={className ?? "mx-4 mb-3 text-meta text-steel md:mx-6"} data-testid="club-explain">{t("club.explain")}</p>
}

/** Refresh the given queries after a dialog saved (FormDialog shows its own success and error, so no useAct toast). */
export function useRefresh(keys: unknown[][]) {
  const qc = useQueryClient()
  return async () => { for (const k of keys) await qc.invalidateQueries({ queryKey: k }) }
}

export const useTiers = () => useQuery({ queryKey: ["club", "tiers"], queryFn: () => api<LoyaltyTierView[]>("/v1/admin/club/tiers"), staleTime: 30_000 })
export const useMembers = (filters: { status?: string; tierId?: string } = {}) => {
  const qs = new URLSearchParams({ limit: "200" })
  if (filters.status) qs.set("status", filters.status)
  if (filters.tierId) qs.set("tierId", filters.tierId)
  return useQuery({ queryKey: ["club", "members", filters.status ?? "", filters.tierId ?? ""], queryFn: () => api<LoyaltyMemberView[]>(`/v1/admin/club/members?${qs.toString()}`) })
}

/* ---------- benefits list ---------- */

/**
 * Benefits as cards on phones and a table from md. Approve shows for holders of `loyalty.benefit.approve` on benefits the
 * server marked `needsApproval` (it still refuses the author); Revoke for `loyalty.manage`, behind a reason dialog.
 */
export function BenefitList({ benefits, tiers, members, invalidate, testId = "benefits", layout = "both" }: { benefits: LoyaltyBenefitView[]; tiers: LoyaltyTierView[]; members?: LoyaltyMemberView[]; invalidate: unknown[][]; testId?: string; layout?: "both" | "cards" | "table" }) {
  const L = useClubLabels()
  const { t } = L
  const { can } = useSession()
  const [revoking, setRevoking] = useState<LoyaltyBenefitView | null>(null)
  const approve = useAct((id: string) => api<LoyaltyBenefitView>(`/v1/admin/club/benefits/${id}/approve`, { body: {} }).catch((e: unknown) => { throw clubError(e, t, "approve") }), { success: t("club.b.approved"), invalidate })
  const target = (b: LoyaltyBenefitView) => b.userId ? (members?.find((m) => m.userId === b.userId)?.name ?? t("club.b.target.member")) : `${t("club.c.tier")}: ${L.tierName(tiers.find((x) => x.id === b.tierId))}`
  const actions = (b: LoyaltyBenefitView) => (
    <span className="flex flex-wrap items-center gap-1.5">
      {b.status === "PENDING_APPROVAL" && b.needsApproval && can("loyalty.benefit.approve") && <Button size="xs" variant="outline" onClick={() => approve.mutate(b.id)} loading={approve.isPending && approve.variables === b.id} data-testid="benefit-approve">{t("club.b.approve")}</Button>}
      {(b.status === "ACTIVE" || b.status === "PENDING_APPROVAL") && can("loyalty.manage") && <Button size="xs" variant="ghost" className="text-danger" onClick={() => setRevoking(b)} data-testid="benefit-revoke">{t("club.b.revoke")}</Button>}
    </span>
  )
  const status = (b: LoyaltyBenefitView) => (
    <span className="flex flex-wrap items-center gap-1.5"><Chip value={b.status} label={L.benefitStatus(b.status)} />{b.status === "PENDING_APPROVAL" && b.needsApproval && <span className="text-caption text-orange-700">{t("club.b.needsApproval")}</span>}</span>
  )
  return (
    <>
      {layout !== "table" && <ul className={cn("space-y-2", layout === "both" && "md:hidden")} data-testid={`${testId}-cards`}>
        {benefits.map((b) => (
          <li key={b.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
            <p className="flex items-start justify-between gap-2"><span className="font-medium" dir="auto">{L.desc(b)}</span><span className="num shrink-0 font-semibold">{L.value(b)}</span></p>
            <p className="mt-1 text-meta text-steel">{L.kind(b.kind)} · {L.appliesTo(b.appliesTo)} · <span dir="auto">{target(b)}</span></p>
            <p className="num mt-1 text-meta text-steel">{fmtDate(b.validFrom)} – {fmtDate(b.validTo)}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{status(b)}{actions(b)}</div>
          </li>
        ))}
      </ul>}
      {layout !== "cards" && <div className={layout === "both" ? "hidden md:block" : undefined}>
        <table className="data-table" data-testid={testId}>
          <thead><tr><th>{t("club.c.benefit")}</th><th>{t("club.c.kind")}</th><th className="cell-num">{t("club.c.value")}</th><th>{t("club.c.appliesTo")}</th><th>{t("club.c.for")}</th><th>{t("club.c.valid")}</th><th>{t("pg.c.status")}</th><th>{t("club.c.by")}</th><th><span className="sr-only">{t("club.c.actions")}</span></th></tr></thead>
          <tbody>
            {benefits.map((b) => (
              <tr key={b.id}>
                <td className="max-w-72"><span dir="auto">{L.desc(b)}</span></td>
                <td className="whitespace-nowrap">{L.kind(b.kind)}</td>
                <td className="cell-num whitespace-nowrap font-medium">{L.value(b)}</td>
                <td>{L.appliesTo(b.appliesTo)}</td>
                <td dir="auto">{target(b)}</td>
                <td className="num whitespace-nowrap text-steel">{fmtDate(b.validFrom)} – {fmtDate(b.validTo)}</td>
                <td>{status(b)}</td>
                <td className="text-meta text-steel"><span dir="auto">{b.createdBy}</span>{b.approvedBy && <> / <span dir="auto">{b.approvedBy}</span></>}</td>
                <td>{actions(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      <RevokeDialog benefit={revoking} onClose={() => setRevoking(null)} invalidate={invalidate} />
    </>
  )
}

function RevokeDialog({ benefit, onClose, invalidate }: { benefit: LoyaltyBenefitView | null; onClose: () => void; invalidate: unknown[][] }) {
  const L = useClubLabels()
  const { t } = L
  const [reason, setReason] = useState("")
  const refresh = useRefresh(invalidate)
  useEffect(() => { if (benefit) setReason("") }, [benefit])
  if (!benefit) return null
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t("club.b.revoke.title")} destructive submitLabel={t("club.b.revoke")} testId="dlg-revoke-benefit"
      description={<><span className="block font-medium text-ink" dir="auto">{L.desc(benefit)} · {L.value(benefit)}</span>{t("club.b.revoke.desc")}</>}
      onSubmit={async () => { try { await api(`/v1/admin/club/benefits/${benefit.id}/revoke`, { body: { reason: reason.trim() } }) } catch (e) { throw clubError(e, t) } await refresh() }}>
      <Field label={t("club.m.reason")} hint={t("club.m.reason.hint")}><textarea className="field-input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={500} dir="auto" /></Field>
    </FormDialog>
  )
}

/* ---------- create benefit ---------- */

/**
 * LoyaltyBenefitBody: exactly one of tier or member (bonus credit: member only); value is a percent (1–100), an amount
 * entered in major units and sent in minor units, or 0 for a perk. Whether a second approver is needed is the server's call.
 */
export function BenefitDialog({ open, onOpenChange, tiers, members, fixedUserId, invalidate }: { open: boolean; onOpenChange: (o: boolean) => void; tiers: LoyaltyTierView[]; members?: LoyaltyMemberView[]; fixedUserId?: string; invalidate: unknown[][] }) {
  const L = useClubLabels()
  const { t } = L
  const blank = useMemo(() => ({ kind: "DISCOUNT_PERCENT" as (typeof BENEFIT_KINDS)[number], value: "", currency: "GBP", appliesTo: "ANY" as (typeof APPLIES_TO)[number], target: (fixedUserId ? "member" : "tier") as "tier" | "member", tierId: tiers.find((x) => x.active)?.id ?? "", userId: fixedUserId ?? "", en: "", fa: "", from: localInput(new Date()), to: inDays(30) }), [fixedUserId, tiers])
  const [f, setF] = useState(blank)
  useEffect(() => { if (open) setF(blank) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useRefresh(invalidate)
  const memberOnly = f.kind === "BONUS_CREDIT"
  const target = memberOnly || fixedUserId ? "member" : f.target
  const isMoney = f.kind === "DISCOUNT_FIXED" || f.kind === "BONUS_CREDIT"
  const submit = async () => {
    const value = f.kind === "PERK" ? 0 : f.kind === "DISCOUNT_PERCENT" ? Math.round(Number(f.value)) : toMinor(f.value, f.currency)
    const body = {
      kind: f.kind, value, currency: isMoney ? f.currency : undefined, appliesTo: f.appliesTo,
      ...(target === "member" ? { userId: f.userId } : { tierId: f.tierId }),
      description: { en: f.en.trim(), fa: f.fa.trim() }, validFrom: new Date(f.from).toISOString(), validTo: new Date(f.to).toISOString(),
    }
    try { await api<LoyaltyBenefitView>("/v1/admin/club/benefits", { body }) } catch (e) { throw clubError(e, t) }
    await refresh()
  }
  const set = <K extends keyof typeof f>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide title={fixedUserId ? t("club.b.grant") : t("club.b.new")} description={t("club.b.approval")} submitLabel={t("club.save")} onSubmit={submit} testId="dlg-benefit">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("club.c.kind")}><NativeSelect className="field-input" value={f.kind} onChange={set("kind")} data-testid="benefit-kind">{BENEFIT_KINDS.map((k) => <option key={k} value={k}>{L.kind(k)}</option>)}</NativeSelect></Field>
        <Field label={t("club.c.appliesTo")}><NativeSelect className="field-input" value={f.appliesTo} onChange={set("appliesTo")}>{APPLIES_TO.map((k) => <option key={k} value={k}>{L.appliesTo(k)}</option>)}</NativeSelect></Field>
        {f.kind === "DISCOUNT_PERCENT" && <Field label={t("club.b.value.percent")}><input className="field-input num" type="number" inputMode="numeric" min={1} max={100} step={1} value={f.value} onChange={set("value")} required dir="ltr" /></Field>}
        {isMoney && (
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field label={t("club.b.value.amount")}><input className="field-input num" inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={f.value} onChange={set("value")} required placeholder="0.00" dir="ltr" /></Field>
            <Field label={t("q.currency")}><NativeSelect className="field-input" value={f.currency} onChange={set("currency")}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</NativeSelect></Field>
          </div>
        )}
        {!fixedUserId && (
          <Field label={t("club.b.target")} hint={memberOnly ? t("club.b.creditMemberOnly") : undefined}>
            <NativeSelect className="field-input" value={target} onChange={set("target")} disabled={memberOnly}>
              <option value="tier">{t("club.b.target.tier")}</option><option value="member">{t("club.b.target.member")}</option>
            </NativeSelect>
          </Field>
        )}
        {!fixedUserId && target === "tier" && <Field label={t("club.c.tier")}><NativeSelect className="field-input" value={f.tierId} onChange={set("tierId")} required><option value="" disabled>{t("club.b.tier.choose")}</option>{tiers.map((x) => <option key={x.id} value={x.id} disabled={!x.active}>{L.tierName(x)} ({x.code}){x.active ? "" : ` · ${t("club.tier.inactive")}`}</option>)}</NativeSelect></Field>}
        {!fixedUserId && target === "member" && <Field label={t("club.b.member")}><NativeSelect className="field-input" value={f.userId} onChange={set("userId")} required><option value="" disabled>{t("club.b.member.choose")}</option>{(members ?? []).filter((m) => m.status === "ACTIVE").map((m) => <option key={m.userId} value={m.userId}>{m.name} · {L.tierName(m.tier)}</option>)}</NativeSelect></Field>}
        <Field label={t("club.b.descEn")}><input className="field-input" value={f.en} onChange={set("en")} required maxLength={200} dir="ltr" lang="en" /></Field>
        <Field label={t("club.b.descFa")}><input className="field-input font-fa" value={f.fa} onChange={set("fa")} required maxLength={200} dir="rtl" lang="fa" /></Field>
        <Field label={t("club.b.from")}><input type="datetime-local" className="field-input" value={f.from} onChange={set("from")} required /></Field>
        <Field label={t("club.b.to")}><input type="datetime-local" className="field-input" value={f.to} onChange={set("to")} required min={f.from} /></Field>
      </div>
    </FormDialog>
  )
}
