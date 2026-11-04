"use client"

import type { DevApifyTestResult, ProviderView } from "@unitravel/contracts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { ApifyHelp } from "@/components/apify"
import { KEYS, usd as usdBudget } from "@/components/catalog/shared"
import { useCatalogUsage } from "@/components/catalog/usage"
import { FormDialog } from "@/components/form-dialog"
import { useConfirm } from "@/components/confirm"
import { DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { APIFY } from "@/components/flight/apify-source"
import { SecretDialog } from "@/components/secret-form"
import { Arrow, ErrorLine, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { Page } from "@/lib/types"

const APPLY_WORD = "APPLY"
interface CatalogTest { ok: boolean; cycleEnd: string | null; monthlyUsageUsd: number | null; maxMonthlyUsageUsd: number | null }
const usd = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`)
interface AuditRow { id: string; occurredAt: string; actor: string | null; actorKind: string; action: string }

/** Developer Panel → Providers → Apify / Google Flights (ADR-0032 B2, ADR-0029 A8). */
export default function ApifyProviderPage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const write = can("provider.config.write")
  const q = useQuery({ queryKey: ["provider", APIFY], queryFn: () => api<ProviderView>(`/v1/dev/providers/${APIFY}`) })
  const audit = useQuery({ queryKey: ["provider-audit", APIFY], queryFn: () => api<Page<AuditRow>>(`/v1/dev/audit-log?entityType=provider&ref=${APIFY}&limit=20`), enabled: can("audit.read") })
  const [secret, setSecret] = useState(false)
  const [test, setTest] = useState<DevApifyTestResult | null>(null)
  const [testErr, setTestErr] = useState<unknown>(null)
  const [testing, setTesting] = useState(false)
  const confirm = useConfirm()
  const usage = useCatalogUsage(can("catalog.read"))
  const [capOpen, setCapOpen] = useState(false)
  const [capWord, setCapWord] = useState("")
  const [cap, setCap] = useState<CatalogTest | null>(null)
  const [capErr, setCapErr] = useState<unknown>(null)
  const [capTesting, setCapTesting] = useState(false)
  const runCapTest = async () => {
    setCapTesting(true); setCapErr(null)
    try { setCap(await api<CatalogTest>("/v1/admin/integrations/apify/test", { body: {} })) } catch (e) { setCap(null); setCapErr(e) } finally { setCapTesting(false) }
  }
  const reload = async () => { await qc.invalidateQueries({ queryKey: ["provider", APIFY] }); await qc.invalidateQueries({ queryKey: ["providers"] }); void qc.invalidateQueries({ queryKey: ["provider-audit", APIFY] }) }
  const runTest = async () => {
    setTesting(true); setTestErr(null)
    try { setTest(await api<DevApifyTestResult>(`/v1/dev/providers/${APIFY}/test`, { body: {} })); void qc.invalidateQueries({ queryKey: ["provider", APIFY] }) } catch (e) { setTest(null); setTestErr(e) } finally { setTesting(false) }
  }
  // PATCH answers STEP_UP_REQUIRED when the last second-factor check is stale; api() prompts and retries once.
  const setEnabled = async (enabled: boolean) => { await api(`/v1/dev/providers/${APIFY}`, { method: "PATCH", body: { enabled } }); toast.success(t(enabled ? "apify.key.enabledNow" : "apify.key.disabledNow")); await reload() }
  const p = q.data
  const c = p?.credentials
  return (
    <div>
      <PageHead kicker={<Link href="/providers" className="hover:underline"><Arrow back /> {t("dnav.providers")}</Link>} title={t("apify.page.title")}><span className="text-meta text-steel">{t("apify.page.desc")}</span></PageHead>
      <DevPage data-testid="apify-page">
        {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !p || !c ? <Loading /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t("apify.key")} aside={<><Tag value={p.enabled ? "ENABLED" : "DISABLED"} className={p.enabled ? "border-success text-success" : ""} /><Tag value={p.environment.toUpperCase()} /></>}>
              <KV className="text-meta" data-testid="apify-key">
                <KVRow k={t("apify.key.last4")}>{c.set ? <span className="num font-mono" dir="ltr">•••• {c.last4 ?? "—"}</span> : <span className="text-danger">{t("prov.notSet")}</span>}</KVRow>
                <KVRow k={t("apify.key.rotatedAt")}><span className="num">{fmtDateTime(c.rotatedAt)}</span></KVRow>
                <KVRow k={t("apify.key.rotatedBy")}>{c.rotatedBy ?? "—"}</KVRow>
              </KV>
              {c.invalidAt && <p role="alert" className="mt-3 rounded-md bg-danger-subtle px-2.5 py-1.5 text-meta text-danger">{t("apify.key.invalid", { t: fmtDateTime(c.invalidAt) })}</p>}
              {write && (
                <>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
                    <Button size="xs" variant="outline" onClick={() => setSecret(true)} data-testid="apify-replace">{c.set ? t("apify.key.replace") : t("apify.key.enter")}</Button>
                    {p.enabled
                      ? <Button size="xs" variant="ghost" className="text-danger" data-testid="apify-disable" onClick={() => confirm.ask({ title: t("apify.key.disable.title"), description: t("apify.key.disable.desc"), label: t("apify.key.disable"), destructive: true, run: () => setEnabled(false) })}>{t("apify.key.disable")}</Button>
                      : <Button size="xs" variant="ghost" data-testid="apify-enable" onClick={() => void setEnabled(true).catch((e) => toast.error(errText(e)))}>{t("apify.key.enable")}</Button>}
                  </div>
                  <p className="mt-2 text-caption text-steel">{t("apify.key.stepUp")}</p>
                </>
              )}
            </Section>

            <Section title={t("apify.test")} aside={write && <Button size="xs" variant="outline" onClick={() => void runTest()} loading={testing} data-testid="apify-test">{t("prov.test")}</Button>}>
              <KV className="text-meta" data-testid="apify-test-result">
                <KVRow k={t("apify.test.plan")}>{test?.plan ?? "—"}</KVRow>
                <KVRow k={t("apify.test.usage")}><span className="num">{usd(test?.monthlyUsageUsd ?? null)}</span></KVRow>
                <KVRow k={t("apify.test.limit")}><span className="num">{usd(test?.monthlyLimitUsd ?? null)}</span></KVRow>
                <KVRow k={t("apify.test.cycle")}><span className="num">{test?.cycleStart || test?.cycleEnd ? `${fmtDate(test.cycleStart)} – ${fmtDate(test.cycleEnd)}` : "—"}</span></KVRow>
                <KVRow k={t("apify.test.at")}><span className="num">{fmtDateTime(test?.testedAt ?? c.testedAt)}</span></KVRow>
              </KV>
              {testErr != null && <div className="mt-3"><ErrorLine error={testErr} /></div>}
              {!write && <p className="mt-2 text-caption text-steel">{t("apify.test.writeOnly")}</p>}
            </Section>
          </div>
        )}

        {usage.data?.schemaAlert && <p role="alert" className="rounded-md bg-danger-subtle px-3 py-2 text-meta text-danger" data-testid="apify-schema-alert">{t("cat.schemaAlert", { why: usage.data.schemaAlert })}</p>}

        {can("catalog.read") && (
          <Section title={t("cat.cap.title")} hint={t("cat.cap.hint")} aside={write && <Button size="xs" variant="outline" onClick={() => void runCapTest()} loading={capTesting} data-testid="apify-cap-test">{t("cat.cap.test")}</Button>}>
            <KV className="text-meta" data-testid="apify-cap">
              <KVRow k={t("cat.cap.status")}>{cap ? (cap.ok ? t("cat.cap.ok") : t("cat.cap.fail")) : "—"}</KVRow>
              <KVRow k={t("apify.test.usage")}><span className="num">{usd(cap?.monthlyUsageUsd ?? null)}</span></KVRow>
              <KVRow k={t("cat.cap.current")}><span className="num">{usd(cap?.maxMonthlyUsageUsd ?? usage.data?.accountCapUsd ?? null)}</span></KVRow>
              <KVRow k={t("cat.cap.budget")}><span className="num">{usdBudget(usage.data?.budgetUsd)}</span></KVRow>
              <KVRow k={t("cat.cap.cycleEnd")}><span className="num">{fmtDate(cap?.cycleEnd ?? usage.data?.cycleEnd)}</span></KVRow>
            </KV>
            {capErr != null && <div className="mt-3"><ErrorLine error={capErr} /></div>}
            {write && (
              <div className="mt-4 border-t border-rule pt-4">
                <p className="mb-2 text-meta text-steel">{t("cat.cap.explain")}</p>
                <Button size="xs" variant="outline" onClick={() => { setCapWord(""); setCapOpen(true) }} data-testid="apify-apply-cap">{t("cat.cap.apply")}</Button>
              </div>
            )}
          </Section>
        )}

        <ApifyHelp />

        {can("audit.read") && (
          <Section title={t("apify.audit")} flush={!!audit.data?.items.length}>
            {audit.error ? <TileError error={audit.error} onRetry={() => void audit.refetch()} /> : !audit.data ? <Loading /> : !audit.data.items.length ? <EmptyState title={t("apify.audit.none")} className="py-4" /> : (
              <ul className="divide-y divide-rule" data-testid="apify-audit">
                {audit.data.items.map((a) => <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-meta md:px-5"><span className="font-mono" dir="ltr">{a.action}</span><span className="text-steel">{a.actor ?? a.actorKind.toLowerCase()} · <span className="num">{fmtDateTime(a.occurredAt)}</span></span></li>)}
              </ul>
            )}
          </Section>
        )}
      </DevPage>
      <SecretDialog open={secret} onOpenChange={setSecret} title={t("prov.credsTitle", { name: p?.name ?? "Apify" })} hintKeys={["token"]} fixedKeys requiredKeys={["token"]} hint={t("apify.key.hint")}
        onSave={async (values) => { await api(`/v1/dev/providers/${APIFY}/credentials`, { method: "PUT", body: { values } }); toast.success(t("apify.key.saved")); await reload() }} />
      <FormDialog open={capOpen} onOpenChange={setCapOpen} title={t("cat.cap.confirm.title")} submitLabel={t("cat.cap.apply")} destructive testId="dlg-apply-cap"
        description={t("cat.cap.confirm.desc", { budget: usdBudget(usage.data?.budgetUsd) })}
        onSubmit={async () => {
          if (capWord.trim() !== APPLY_WORD) throw new Error(t("cat.cap.confirm.word", { word: APPLY_WORD }))
          const r = await api<{ maxMonthlyUsageUsd: number }>("/v1/admin/integrations/apify/apply-cap", { body: {} })
          setCap((c) => ({ ok: true, cycleEnd: c?.cycleEnd ?? null, monthlyUsageUsd: c?.monthlyUsageUsd ?? null, maxMonthlyUsageUsd: r.maxMonthlyUsageUsd }))
          void qc.invalidateQueries({ queryKey: KEYS.all })
        }}>
        <label className="block text-meta"><span className="font-medium">{t("cat.cap.confirm.label", { word: APPLY_WORD })}</span>
          <input className="field-input mt-1.5 font-mono" dir="ltr" autoComplete="off" value={capWord} onChange={(e) => setCapWord(e.target.value)} data-testid="apply-cap-word" /></label>
      </FormDialog>
      {confirm.dialog}
    </div>
  )
}
