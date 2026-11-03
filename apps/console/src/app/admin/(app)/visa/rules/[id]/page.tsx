"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ExternalLink } from "lucide-react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import type { VisaFacts, VisaRuleView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { StatusChip, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { codeLabel } from "@/components/club"
import { useConfirm } from "@/components/confirm"
import { Section } from "@/components/dev-ui"
import { ListPage } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { ConflictTable } from "@/components/visa-rules"
import { Country, DocName, ExpiryDialog, FACT_KEYS, factText, isStaleRule, OverrideDialog, ReasonDialog, VerificationChip, VisaStatusChip } from "@/components/visa"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

type Dlg = "override" | "verify" | "withdraw" | "expiry" | null

/** One rule: key, the facts customers see, evidence with quotes, conflicts, and the staff actions (all audited). */
export default function VisaRulePage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const { id } = useParams<{ id: string }>()
  const { ask, dialog } = useConfirm()
  const [dlg, setDlg] = useState<Dlg>(null)
  const q = useQuery({ queryKey: ["visa", "rule", id], queryFn: () => api<VisaRuleView>(`/v1/admin/visa/rules/${id}`) })
  const r = q.data
  if (q.error) return <div className="p-4 md:p-6"><TileError error={q.error} onRetry={() => void q.refetch()} /></div>
  if (!r) return <ListSkeleton rows={6} className="p-4 md:p-6" />
  const write = can("visa.write")
  const rerun = () => ask({
    title: t("vz.rerun"), description: t("vz.rerun.desc"), label: t("vz.rerun"),
    run: async () => {
      try { await api("/v1/admin/visa/research", { body: { destination: r.destination, documentType: r.documentType, issuingCountry: r.issuingCountry, purpose: r.purpose } }); toast.success(t("vz.rerun.done")); await qc.invalidateQueries({ queryKey: ["visa"] }) } catch (e) { toast.error(errText(e)); throw e }
    },
  })
  const close = (o: boolean) => { if (!o) setDlg(null) }
  return (
    <ListPage>
      {dialog}
      <PageHead kicker={<Link href="/visa/rules" className="underline-offset-2 hover:underline">{t("nav.visaRules")}</Link>} title={<span className="flex flex-wrap items-center gap-2"><Country code={r.destination} /><span className="text-steel">·</span><DocName code={r.documentType} /></span>}>
        {write && <>
          <Button size="sm" onClick={() => setDlg("override")} data-testid="visa-override">{t("vz.override")}</Button>
          {r.verification === "VERIFIED" && <Button size="sm" variant="outline" onClick={() => setDlg("verify")}>{t("vz.verify")}</Button>}
          {r.facts.status !== "UNCONFIRMED" && <Button size="sm" variant="outline" className="text-danger" onClick={() => setDlg("withdraw")}>{t("vz.withdraw")}</Button>}
          <Button size="sm" variant="outline" onClick={() => setDlg("expiry")}>{t("vz.setExpiry")}</Button>
          <Button size="sm" variant="outline" onClick={rerun} data-testid="visa-rerun">{t("vz.rerun")}</Button>
        </>}
      </PageHead>
      <div className="space-y-4 px-4 pb-6 md:px-6" data-testid="visa-rule">
        <Section title={t("vz.key")} aside={<><VisaStatusChip s={r.facts.status} /><VerificationChip v={r.verification} />{isStaleRule(r) && <StatusChip tone="warn">{t("vz.stale")}</StatusChip>}</>}>
          <dl className="grid gap-x-6 gap-y-2 text-meta sm:grid-cols-3">
            <div><dt className="text-steel">{t("vz.destination")}</dt><dd><Country code={r.destination} /></dd></div>
            <div><dt className="text-steel">{t("vz.document")}</dt><dd><DocName code={r.documentType} /> <span className="font-mono text-caption text-steel" dir="ltr">{r.documentType}</span></dd></div>
            <div><dt className="text-steel">{t("vz.issuer")}</dt><dd><Country code={r.issuingCountry} /></dd></div>
            <div><dt className="text-steel">{t("vz.purpose")}</dt><dd>{codeLabel(t, "vz.p", r.purpose)}</dd></div>
            <div><dt className="text-steel">{t("vz.origin")}</dt><dd>{codeLabel(t, "vz.o", r.origin)}</dd></div>
            <div><dt className="text-steel">{t("vz.verifiedAt")}</dt><dd className="num">{r.verifiedAt ? fmtDateTime(r.verifiedAt) : "—"}</dd></div>
            <div><dt className="text-steel">{t("vz.expires")}</dt><dd className="num">{r.expiresAt ? fmtDateTime(r.expiresAt) : t("vz.noExpiry")}</dd></div>
            <div><dt className="text-steel">{t("vz.updatedAt")}</dt><dd className="num">{fmtDateTime(r.updatedAt)} · v{r.version}</dd></div>
            {r.overrideReason && <div className="sm:col-span-3"><dt className="text-steel">{t("vz.overrideReason")}</dt><dd dir="auto">{r.overrideReason}</dd></div>}
          </dl>
        </Section>

        <Section title={t("vz.facts")} hint={t("vz.facts.customer")}>
          <dl className="grid gap-x-6 gap-y-2 text-meta sm:grid-cols-2 lg:grid-cols-3">
            {FACT_KEYS.map((k) => (
              <div key={k}><dt className="text-steel">{codeLabel(t, "vz.f", k)}</dt><dd className={r.facts[k] == null ? "text-steel italic" : ""} dir="auto">{factText(t, k as keyof VisaFacts, r.facts[k])}</dd></div>
            ))}
          </dl>
        </Section>

        {r.conflicts.length > 0 && <Section title={t("vz.conflicts")} hint={t("vz.conflicts.hint")}><ConflictTable rule={r} /></Section>}

        <Section title={t("vz.evidence", { n: r.evidence.length })} hint={t("vz.evidence.hint")} flush>
          {r.evidence.length === 0 ? <p className="p-4 text-meta text-steel">{t("vz.evidence.none")}</p> : (
            <ul className="divide-y divide-rule" data-testid="visa-evidence">
              {[...r.evidence].sort((a, b) => a.tier - b.tier).map((e, i) => (
                <li key={`${e.url}-${i}`} className="space-y-1.5 p-4 text-meta">
                  <p className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={e.official ? "ok" : "neutral"}>{e.official ? t("vz.official") : t("vz.unofficial")}</StatusChip>
                    <span className="font-medium">{codeLabel(t, "vz.k", e.kind)}</span>
                    <span className="text-caption text-steel">{t("vz.tier", { n: e.tier })} · {codeLabel(t, "vz.o", e.origin)}</span>
                    {e.covers.includes(r.documentType) ? <StatusChip tone="info">{t("vz.covers")}</StatusChip> : <StatusChip tone="warn">{t("vz.notCovers")}</StatusChip>}
                  </p>
                  <a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-royal underline" dir="ltr"><span className="truncate">{e.title || e.url}</span><ExternalLink className="size-3.5 shrink-0" aria-hidden /></a>
                  <p className="text-caption text-steel">{t("vz.fetched", { d: fmtDateTime(e.fetchedAt) })}{e.sourceUpdatedAt && ` · ${t("vz.pageUpdated", { d: fmtDateTime(e.sourceUpdatedAt) })}`}</p>
                  {Object.keys(e.claims).length > 0 && (
                    <p className="flex flex-wrap gap-x-3 gap-y-1">{Object.entries(e.claims).map(([k, v]) => <span key={k}><span className="text-steel">{codeLabel(t, "vz.f", k)}:</span> <span dir="auto">{factText(t, k as keyof VisaFacts, v)}</span></span>)}</p>
                  )}
                  <ul className="space-y-1">{e.quotes.map((qt, j) => <li key={j}><blockquote className="border-s-2 border-rule-strong ps-2 text-ink-subtle" dir="auto">“{qt}”</blockquote></li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      {dlg === "override" && <OverrideDialog key={r.version} rule={r} onOpenChange={close} />}
      {dlg === "verify" && <ReasonDialog rule={r} mode="VERIFIED" onOpenChange={close} />}
      {dlg === "withdraw" && <ReasonDialog rule={r} mode="UNVERIFIED" onOpenChange={close} />}
      {dlg === "expiry" && <ExpiryDialog rule={r} onOpenChange={close} />}
    </ListPage>
  )
}
