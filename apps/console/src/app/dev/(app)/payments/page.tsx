"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { PaymentHealthView, PaymentsConfigView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"
import { cn } from "@unitravel/ui/lib/utils"

import { SecretDialog } from "@/components/secret-form"
import { DataTable, DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { ErrorLine, Loading, PageHead, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useConfirm } from "@/components/confirm"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/**
 * Developer Panel · Online payments (ADR-0007): provider, test-mode keys (write-only), mode change workflow (live is
 * blocked), webhook URL, recent events and failures, health check. Secrets are never shown after they are saved.
 */
export default function PaymentsPage() {
  const t = useT()
  const { can } = useSession()
  const q = useQuery({ queryKey: ["payments-config"], queryFn: () => api<PaymentsConfigView>("/v1/dev/payments"), refetchInterval: 10_000 })
  const [keys, setKeys] = useState(false)
  const { ask, dialog } = useConfirm()
  const [health, setHealth] = useState<PaymentHealthView | null>(null)
  const inv = [["payments-config"]]
  const provider = useAct((p: "STRIPE" | "FAKE") => api("/v1/dev/payments/config", { method: "PATCH", body: { provider: p } }), { invalidate: inv, success: t("paydev.saved") })
  const check = useAct(() => api<PaymentHealthView>("/v1/dev/payments/health-check", { body: {} }), { onDone: setHealth })
  const askLive = useAct(() => api("/v1/dev/payments/mode-requests", { body: { mode: "live" } }), { invalidate: inv })
  const approve = useAct(() => api("/v1/dev/payments/mode-requests/approve", { body: {} }), { invalidate: inv, success: t("paydev.saved") })
  const d = q.data
  if (q.error) return <div className="p-4 md:p-6"><ErrorLine error={q.error} /></div>
  if (!d) return <Loading />
  const cred = (label: string, set: boolean) => <KVRow k={label}><span className={cn("inline-flex items-center gap-1.5", set ? "text-success" : "text-steel")}><span aria-hidden className={cn("size-1.5 rounded-full", set ? "bg-success" : "bg-steel/50")} />{set ? t("paydev.set") : t("paydev.notSet")}</span></KVRow>
  return (
    <div>
      {dialog}
      <PageHead kicker={t("paydev.kicker")} title={t("paydev.title")}><span className="text-[12px] text-steel">{t("paydev.desc")}</span></PageHead>
      <DevPage data-testid="payments-config">
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("paydev.state")}>
            <KV>
              <KVRow k={t("paydev.flag")}><Tag value={d.flagEnabled ? t("paydev.on") : t("paydev.off")} /></KVRow>
              <KVRow k={t("paydev.provider")}>
                <span className="inline-flex items-center gap-2"><Tag value={d.provider} />
                  {can("payments.configure") && <NativeSelect aria-label={t("paydev.provider")} className="field-input w-28" value={d.provider} onChange={(e) => { const p = e.target.value as "STRIPE" | "FAKE"; ask({ title: t("confirm.provider.title", { p }), description: t("confirm.provider.body"), label: t("confirm.provider.label"), destructive: true, run: () => provider.mutateAsync(p) }) }}><option value="STRIPE">STRIPE</option>{d.fakeAvailable && <option value="FAKE">FAKE</option>}</NativeSelect>}
                </span></KVRow>
              <KVRow k={t("paydev.mode")}><Tag value={d.mode} /></KVRow>
            </KV>
            {d.liveBlocked && <p className="mt-3 rounded-md bg-surface-sunk px-3 py-2 text-[12.5px] text-steel" data-testid="live-blocked">{t("paydev.liveBlocked")}</p>}
            {d.provider === "FAKE" && <p className="mt-2 text-[12.5px] text-steel">{t("paydev.fakeOnly")}</p>}
            {d.pendingModeRequest && <p className="mt-2 rounded-md bg-warning-subtle px-3 py-2 text-[12.5px] text-warning-subtle-fg">{t("paydev.pending", { mode: d.pendingModeRequest.mode, by: d.pendingModeRequest.requestedBy })}</p>}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
              <Button size="sm" variant="outline" loading={check.isPending} onClick={() => check.mutate()} data-command="payments_health">{t("paydev.health")}</Button>
              {can("payments.configure") && <Button size="sm" variant="ghost" onClick={() => askLive.mutate()} data-command="request_live">{t("paydev.requestLive")}</Button>}
              {d.pendingModeRequest && can("payments.mode.approve") && <Button size="sm" onClick={() => approve.mutate()}>{t("paydev.approve")}</Button>}
            </div>
            {health && <p role="status" className={cn("mt-3 rounded-md px-3 py-2 text-[12.5px]", health.ok ? "bg-success-subtle text-success" : "bg-danger-subtle text-danger")} data-testid="payments-health">{health.ok ? t("paydev.healthy") : t("paydev.unhealthy")} · {health.provider} · {health.latencyMs} ms · {health.detail}</p>}
          </Section>
          <Section title={t("paydev.keys")} hint={d.credentials.rotatedAt ? fmtDateTime(d.credentials.rotatedAt) : undefined} aside={can("payments.configure") && <Button size="sm" variant="outline" onClick={() => setKeys(true)} data-command="payments_keys">{t("paydev.enter")}</Button>}>
            <KV>{cred(t("paydev.secretKey"), d.credentials.secretKey)}{cred(t("paydev.publishableKey"), d.credentials.publishableKey)}{cred(t("paydev.webhookSecret"), d.credentials.webhookSecret)}</KV>
            <div className="mt-4 border-t border-rule pt-4">
              <p className="text-[12.5px] text-steel">{t("paydev.webhook")}</p>
              <p className="num mt-1 rounded-md bg-surface-sunk px-3 py-2 text-[12.5px] break-all" dir="ltr" data-testid="webhook-url">{d.webhookUrl}</p>
            </div>
          </Section>
        </div>
        <Section title={t("paydev.events")} aside={<span className="text-steel">{t("paydev.failed", { n: d.failedEvents })} · {t("paydev.open", { n: d.openSessions })}</span>} flush={d.events.length > 0}>
          {!d.events.length ? <p className="text-[12.5px] text-steel">{t("paydev.noEvents")}</p> : (
            <DataTable data-testid="stripe-events">
              <thead><tr>{[t("paydev.c.event"), t("paydev.c.outcome"), t("paydev.c.received")].map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{d.events.map((e) => <tr key={e.id}><td className="num text-[12.5px]" dir="ltr">{e.type}</td><td><Tag value={e.outcome} title={e.error ?? undefined} /></td><td className="whitespace-nowrap text-[12.5px] text-steel">{fmtDateTime(e.receivedAt)}</td></tr>)}</tbody>
            </DataTable>
          )}
        </Section>
      </DevPage>
      {keys && (
        <SecretDialog open onOpenChange={(o) => !o && setKeys(false)} title={t("paydev.keys")} hintKeys={["secretKey", "publishableKey", "webhookSecret"]}
          onSave={async (values) => { await api("/v1/dev/payments/credentials", { method: "PUT", body: { mode: "test", ...values } }); await q.refetch() }} />
      )}
    </div>
  )
}
