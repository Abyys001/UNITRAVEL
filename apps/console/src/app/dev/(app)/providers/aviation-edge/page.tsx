"use client"

import type { DevAviationEdgeCoverage, DevAviationEdgeStatus, DevAviationEdgeTestResult, ProviderView } from "@unitravel/contracts"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { EmptyState, TileError } from "@/components/bento"
import { useConfirm } from "@/components/confirm"
import { DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { SecretDialog } from "@/components/secret-form"
import { Arrow, ErrorLine, Loading, PageHead, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { type MsgKey, useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { Page } from "@/lib/types"

const AE = "aviation-edge"
interface AuditRow { id: string; occurredAt: string; actor: string | null; actorKind: string; action: string }
const YES = [1, 2, 3, 4, 5, 6] as const
const NO = [1, 2, 3, 4, 5] as const

/** Developer Panel → Providers → Aviation Edge (ADR-0036 E3, E10–E12). Schedules only: no prices, no seats. */
export default function AviationEdgePage() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const write = can("provider.config.write")
  const q = useQuery({ queryKey: ["provider", AE], queryFn: () => api<ProviderView>(`/v1/dev/providers/${AE}`) })
  const status = useQuery({ queryKey: ["provider-status", AE], queryFn: () => api<DevAviationEdgeStatus>(`/v1/dev/providers/${AE}/status`) })
  const audit = useQuery({ queryKey: ["provider-audit", AE], queryFn: () => api<Page<AuditRow>>(`/v1/dev/audit-log?entityType=provider&ref=${AE}&limit=20`), enabled: can("audit.read") })
  const [secret, setSecret] = useState(false)
  const [test, setTest] = useState<DevAviationEdgeTestResult | null>(null)
  const [testErr, setTestErr] = useState<unknown>(null)
  const [testing, setTesting] = useState(false)
  const [cov, setCov] = useState<DevAviationEdgeCoverage | null>(null)
  const [covErr, setCovErr] = useState<unknown>(null)
  const [probing, setProbing] = useState(false)
  const confirm = useConfirm()
  const refreshStatus = () => qc.invalidateQueries({ queryKey: ["provider-status", AE] })
  const reload = async () => { await qc.invalidateQueries({ queryKey: ["provider", AE] }); await qc.invalidateQueries({ queryKey: ["providers"] }); void refreshStatus(); void qc.invalidateQueries({ queryKey: ["provider-audit", AE] }) }
  const runTest = async () => {
    setTesting(true); setTestErr(null)
    try { setTest(await api<DevAviationEdgeTestResult>(`/v1/dev/providers/${AE}/test`, { body: {} })); void qc.invalidateQueries({ queryKey: ["provider", AE] }); void refreshStatus() } catch (e) { setTest(null); setTestErr(e) } finally { setTesting(false) }
  }
  // The confirm dialog shows errors itself, so the probe rethrows; api() handles the step-up prompt and retry.
  const runProbe = async () => {
    setProbing(true); setCovErr(null)
    try { setCov(await api<DevAviationEdgeCoverage>(`/v1/dev/providers/${AE}/coverage`, { body: {} })); void refreshStatus(); void qc.invalidateQueries({ queryKey: ["provider-audit", AE] }) } catch (e) { setCovErr(e); throw e } finally { setProbing(false) }
  }
  const setEnabled = async (enabled: boolean) => { await api(`/v1/dev/providers/${AE}`, { method: "PATCH", body: { enabled } }); toast.success(t(enabled ? "ae.key.enabledNow" : "ae.key.disabledNow")); await reload() }
  const p = q.data
  const c = p?.credentials
  const s = status.data
  const lastCov = cov ?? s?.lastCoverage ?? null
  return (
    <div>
      <PageHead kicker={<Link href="/providers" className="hover:underline"><Arrow back /> {t("dnav.providers")}</Link>} title={t("ae.page.title")}><span className="text-meta text-steel">{t("ae.page.desc")}</span></PageHead>
      <DevPage data-testid="ae-page">
        {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !p || !c ? <Loading /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t("apify.key")} aside={<><Tag value={p.enabled ? "ENABLED" : "DISABLED"} className={p.enabled ? "border-success text-success" : ""} /><Tag value={p.environment.toUpperCase()} /></>}>
              <KV className="text-meta" data-testid="ae-key">
                <KVRow k={t("apify.key.last4")}>{c.set ? <span className="num font-mono" dir="ltr">•••• {c.last4 ?? "—"}</span> : <span className="text-danger">{t("prov.notSet")}</span>}</KVRow>
                <KVRow k={t("apify.key.rotatedAt")}><span className="num">{fmtDateTime(c.rotatedAt)}</span></KVRow>
                <KVRow k={t("apify.key.rotatedBy")}>{c.rotatedBy ?? "—"}</KVRow>
              </KV>
              {c.invalidAt && <p role="alert" className="mt-3 rounded-md bg-danger-subtle px-2.5 py-1.5 text-meta text-danger" data-testid="ae-key-invalid">{t("ae.key.invalid", { t: fmtDateTime(c.invalidAt) })}</p>}
              {write && (
                <>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
                    <Button size="xs" variant="outline" onClick={() => setSecret(true)} data-testid="ae-replace">{c.set ? t("apify.key.replace") : t("apify.key.enter")}</Button>
                    {p.enabled
                      ? <Button size="xs" variant="ghost" className="text-danger" data-testid="ae-disable" onClick={() => confirm.ask({ title: t("ae.key.disable.title"), description: t("ae.key.disable.desc"), label: t("apify.key.disable"), destructive: true, run: () => setEnabled(false) })}>{t("apify.key.disable")}</Button>
                      : <Button size="xs" variant="ghost" data-testid="ae-enable" onClick={() => void setEnabled(true).catch((e) => toast.error(errText(e)))}>{t("apify.key.enable")}</Button>}
                  </div>
                  <p className="mt-2 text-caption text-steel">{t("apify.key.stepUp")} {t("ae.key.keptNote")}</p>
                </>
              )}
            </Section>

            <Section title={t("ae.test")} aside={write && <Button size="xs" variant="outline" onClick={() => void runTest()} loading={testing} data-testid="ae-test">{t("prov.test")}</Button>}>
              <p className="mb-3 text-caption text-steel">{t("ae.test.note")}</p>
              <div data-testid="ae-test-result" role="status" className={cn("rounded-md border border-rule p-3", test && (test.ok ? "bg-success-subtle" : "bg-danger-subtle"))}>
                {!test ? <p className="text-meta text-steel">{t("ae.test.none")} {t("ae.test.at")}: <span className="num">{fmtDateTime(c.testedAt)}</span></p> : (
                  <>
                    <p className={cn("mb-2 font-semibold", test.ok ? "text-success" : "text-danger")}>{test.ok ? t("ae.test.ok") : t("ae.test.fail")}</p>
                    <KV className="text-meta">
                      <KVRow k={t("ae.test.latency")}><span className="num">{test.latencyMs} ms</span></KVRow>
                      <KVRow k={t("ae.test.probe")}><span className="num" dir="ltr">{test.probe.from} → {test.probe.to} · {test.probe.date}</span></KVRow>
                      <KVRow k={t("ae.test.rows")}><span className="num">{test.rows}</span></KVRow>
                      <KVRow k={t("ae.test.carriers")}><span className="font-mono" dir="ltr">{test.carriers.join(", ") || "—"}</span></KVRow>
                      <KVRow k={t("ae.test.sample")}><span className="font-mono" dir="ltr">{test.sampleFlight ?? "—"}</span></KVRow>
                      {test.detail && <KVRow k={t("ae.test.detail")}><span className="break-words">{test.detail}</span></KVRow>}
                      <KVRow k={t("ae.test.at")}><span className="num">{fmtDateTime(test.testedAt)}</span></KVRow>
                    </KV>
                  </>
                )}
              </div>
              {testErr != null && <div className="mt-3"><ErrorLine error={testErr} /></div>}
              {!write && <p className="mt-2 text-caption text-steel">{t("apify.test.writeOnly")}</p>}
            </Section>
          </div>
        )}

        <Section title={t("ae.status")} aside={s && <Tag value={s.pause} className={s.pause === "NONE" ? "border-success text-success" : "border-danger text-danger"} />}>
          {status.error ? <TileError error={status.error} onRetry={() => void status.refetch()} /> : !s ? <Loading /> : (
            <>
              <KV className="text-meta" data-testid="ae-status">
                <KVRow k={t("ae.status.pause")}>{t(`ae.status.pause.${s.pause}` as MsgKey)}</KVRow>
                <KVRow k={t("ae.status.tick")}><span className="num">{fmtDateTime(s.lastTickAt)}</span></KVRow>
                <KVRow k={t("ae.status.used")}><span className="num">{s.callsUsedThisMonth.toLocaleString("en")}</span></KVRow>
                <KVRow k={t("ae.status.budget")}><span className="num">{s.monthlyCalls.toLocaleString("en")}</span></KVRow>
                <KVRow k={t("ae.status.reserve")}><span className="num">{s.reserveCalls.toLocaleString("en")}</span></KVRow>
                <KVRow k={t("ae.status.slots")}><span className="num">{s.slotsWithSchedules.toLocaleString("en")}</span></KVRow>
                <KVRow k={t("ae.status.current")}><span className="num">{s.schedulesCurrent.toLocaleString("en")}</span></KVRow>
              </KV>
              <p className="mt-3 text-caption text-steel">{t("ae.status.budgetEdit")} <span className="font-medium" data-testid="ae-catalog-where">{t("ae.status.budgetLink")}</span></p>
            </>
          )}
        </Section>

        <Section title={t("ae.cap.title")}>
          <div className="grid gap-4 text-meta md:grid-cols-3" data-testid="ae-capabilities">
            <div><h3 className="mb-1 font-semibold text-success">{t("ae.cap.yes")}</h3><ul className="list-disc space-y-1 ps-5">{YES.map((n) => <li key={n}>{t(`ae.cap.yes.${n}` as MsgKey)}</li>)}</ul></div>
            <div><h3 className="mb-1 font-semibold text-danger">{t("ae.cap.no")}</h3><ul className="list-disc space-y-1 ps-5">{NO.map((n) => <li key={n}>{t(`ae.cap.no.${n}` as MsgKey)}</li>)}</ul></div>
            <div><h3 className="mb-1 font-semibold text-steel">{t("ae.cap.note")}</h3><p>{t("ae.cap.note.1")}</p></div>
          </div>
        </Section>

        <Section title={t("ae.cov.title")} hint={t("ae.cov.hint")} aside={write && <Button size="xs" variant="outline" loading={probing} data-testid="ae-coverage-run"
          onClick={() => confirm.ask({ title: t("ae.cov.confirm.title"), description: t("ae.cov.confirm.desc"), label: t("ae.cov.run"), run: runProbe })}>{t("ae.cov.run")}</Button>}>
          {lastCov ? (
            <>
              <p className="mb-2 text-caption text-steel" data-testid="ae-coverage-last">{t("ae.cov.last", { t: fmtDateTime(lastCov.ranAt), who: lastCov.ranBy ?? "—", n: lastCov.callsUsed })} · <span className="num">{t("ae.cov.date")}: {fmtDate(lastCov.date)}</span></p>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-meta" data-testid="ae-coverage">
                  <thead><tr className="border-b border-rule text-steel">
                    <th scope="col" className="py-1 pe-3 text-start font-medium">{t("ae.cov.airport")}</th>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">{t("ae.cov.departures")}</th>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">{t("ae.cov.carriers")}</th>
                    <th scope="col" className="py-1 pe-3 text-start font-medium">{t("ae.cov.destinations")}</th>
                    <th scope="col" className="py-1 text-start font-medium">{t("ae.cov.error")}</th>
                  </tr></thead>
                  <tbody className="divide-y divide-rule">
                    {lastCov.airports.map((a) => (
                      <tr key={a.iata}>
                        <th scope="row" className="py-1 pe-3 text-start font-mono font-semibold" dir="ltr">{a.iata}</th>
                        <td className="num py-1 pe-3">{a.departures ?? "—"}</td>
                        <td className="py-1 pe-3 font-mono" dir="ltr">{a.carriers.length} {a.carriers.length ? `(${a.carriers.slice(0, 6).join(", ")}${a.carriers.length > 6 ? ", …" : ""})` : ""}</td>
                        <td className="num py-1 pe-3">{a.destinations}</td>
                        <td className={cn("py-1", a.error && "text-danger")}>{a.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="text-meta text-steel">{t("ae.cov.none")}</p>}
          {covErr != null && <div className="mt-3"><ErrorLine error={covErr} /></div>}
        </Section>

        {can("audit.read") && (
          <Section title={t("ae.audit")} flush={!!audit.data?.items.length}>
            {audit.error ? <TileError error={audit.error} onRetry={() => void audit.refetch()} /> : !audit.data ? <Loading /> : !audit.data.items.length ? <EmptyState title={t("ae.audit.none")} className="py-4" /> : (
              <ul className="divide-y divide-rule" data-testid="ae-audit">
                {audit.data.items.map((a) => <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-meta md:px-5"><span className="font-mono" dir="ltr">{a.action}</span><span className="text-steel">{a.actor ?? a.actorKind.toLowerCase()} · <span className="num">{fmtDateTime(a.occurredAt)}</span></span></li>)}
              </ul>
            )}
          </Section>
        )}
      </DevPage>
      <SecretDialog open={secret} onOpenChange={setSecret} title={t("prov.credsTitle", { name: p?.name ?? "Aviation Edge" })} hintKeys={["apiKey"]} fixedKeys requiredKeys={["apiKey"]} hint={t("ae.key.hint")}
        onSave={async (values) => { await api(`/v1/dev/providers/${AE}/credentials`, { method: "PUT", body: { values } }); toast.success(t("ae.key.saved")); await reload() }} />
      {confirm.dialog}
    </div>
  )
}
