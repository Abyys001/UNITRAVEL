"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import type { PaymentHealthView, PaymentsConfigView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { SecretDialog } from "@/components/secret-form"
import { ErrorLine, Loading, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
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
  const [health, setHealth] = useState<PaymentHealthView | null>(null)
  const inv = [["payments-config"]]
  const provider = useAct((p: "STRIPE" | "FAKE") => api("/v1/dev/payments/config", { method: "PATCH", body: { provider: p } }), { invalidate: inv, success: t("paydev.saved") })
  const check = useAct(() => api<PaymentHealthView>("/v1/dev/payments/health-check", { body: {} }), { onDone: setHealth })
  const askLive = useAct(() => api("/v1/dev/payments/mode-requests", { body: { mode: "live" } }), { invalidate: inv })
  const approve = useAct(() => api("/v1/dev/payments/mode-requests/approve", { body: {} }), { invalidate: inv, success: t("paydev.saved") })
  const d = q.data
  if (q.error) return <div className="p-5"><ErrorLine error={q.error} /></div>
  if (!d) return <Loading />
  const cred = (label: string, set: boolean) => <li className="flex justify-between py-1.5"><span>{label}</span><span className={set ? "text-ok" : "text-steel"}>{set ? t("paydev.set") : t("paydev.notSet")}</span></li>
  return (
    <div>
      <PageHead kicker={t("paydev.kicker")} title={t("paydev.title")} />
      <div className="grid gap-4 px-5 lg:grid-cols-2" data-testid="payments-config">
        <Panel title={t("paydev.state")}>
          <ul className="ledger-rows">
            <li className="flex justify-between py-1.5"><span>{t("paydev.flag")}</span><Tag value={d.flagEnabled ? t("paydev.on") : t("paydev.off")} /></li>
            <li className="flex items-center justify-between py-1.5"><span>{t("paydev.provider")}</span>
              <span className="flex items-center gap-2"><Tag value={d.provider} />
                {can("payments.configure") && <NativeSelect aria-label={t("paydev.provider")} className="field-input w-28" value={d.provider} onChange={(e) => provider.mutate(e.target.value as "STRIPE" | "FAKE")}><option value="STRIPE">STRIPE</option>{d.fakeAvailable && <option value="FAKE">FAKE</option>}</NativeSelect>}
              </span></li>
            <li className="flex justify-between py-1.5"><span>{t("paydev.mode")}</span><Tag value={d.mode} /></li>
          </ul>
          {d.liveBlocked && <p className="mt-2 text-[12px] text-steel" data-testid="live-blocked">{t("paydev.liveBlocked")}</p>}
          {d.provider === "FAKE" && <p className="mt-1 text-[12px] text-steel">{t("paydev.fakeOnly")}</p>}
          {d.pendingModeRequest && <p className="mt-2 text-[12px]">{t("paydev.pending", { mode: d.pendingModeRequest.mode, by: d.pendingModeRequest.requestedBy })}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="xs" variant="outline" loading={check.isPending} onClick={() => check.mutate()} data-command="payments_health">{t("paydev.health")}</Button>
            {can("payments.configure") && <Button size="xs" variant="ghost" onClick={() => askLive.mutate()} data-command="request_live">{t("paydev.requestLive")}</Button>}
            {d.pendingModeRequest && can("payments.mode.approve") && <Button size="xs" onClick={() => approve.mutate()}>{t("paydev.approve")}</Button>}
          </div>
          {health && <p className="mt-2 text-[12px]" data-testid="payments-health">{health.ok ? t("paydev.healthy") : t("paydev.unhealthy")} · {health.provider} · {health.latencyMs} ms · {health.detail}</p>}
        </Panel>
        <Panel title={t("paydev.keys")} aside={can("payments.configure") && <Button size="xs" variant="outline" onClick={() => setKeys(true)} data-command="payments_keys">{t("paydev.enter")}</Button>}>
          <ul className="ledger-rows">
            {cred(t("paydev.secretKey"), d.credentials.secretKey)}{cred(t("paydev.publishableKey"), d.credentials.publishableKey)}{cred(t("paydev.webhookSecret"), d.credentials.webhookSecret)}
          </ul>
          {d.credentials.rotatedAt && <p className="mt-1 text-[12px] text-steel">{fmtDateTime(d.credentials.rotatedAt)}</p>}
          <p className="mt-3 text-[12px] text-steel">{t("paydev.webhook")}</p>
          <p className="num break-all text-[12.5px]" dir="ltr" data-testid="webhook-url">{d.webhookUrl}</p>
        </Panel>
        <Panel title={t("paydev.events")} className="lg:col-span-2" aside={<span className="text-[12px] text-steel">{t("paydev.failed", { n: d.failedEvents })} · {t("paydev.open", { n: d.openSessions })}</span>}>
          {!d.events.length ? <p className="text-[12.5px] text-steel">{t("paydev.noEvents")}</p> : (
            <ul className="ledger-rows" data-testid="stripe-events">
              {d.events.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span className="num text-[12px]" dir="ltr">{e.type}</span><span className="flex items-center gap-2"><Tag value={e.outcome} title={e.error ?? undefined} /><span className="text-[12px] text-steel">{fmtDateTime(e.receivedAt)}</span></span></li>)}
            </ul>
          )}
        </Panel>
      </div>
      {keys && (
        <SecretDialog open onOpenChange={(o) => !o && setKeys(false)} title={t("paydev.keys")} hintKeys={["secretKey", "publishableKey", "webhookSecret"]}
          onSave={async (values) => { await api("/v1/dev/payments/credentials", { method: "PUT", body: { mode: "test", ...values } }); await q.refetch() }} />
      )}
    </div>
  )
}
