"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { useConfirm } from "@/components/confirm"
import { KV, KVRow, Section } from "@/components/dev-ui"
import { SecretDialog } from "@/components/secret-form"
import { ErrorLine, Tag } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface Status { set: boolean; rotatedAt: string | null; rotatedBy: string | null; model: string; ttlDays: number }

/**
 * Visa research step (ADR-0029 point 9): the Anthropic key is write-only like flight-provider credentials. It is typed once,
 * sent with step-up, encrypted at rest and never read back. Without it every visa result stays "unconfirmed".
 */
export function VisaResearchCard() {
  const t = useT()
  const qc = useQueryClient()
  const { can } = useSession()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: ["visa-research"], queryFn: () => api<Status>("/v1/dev/visa-research") })
  const s = q.data
  const write = can("provider.config.write")
  return (
    <Section title={<span className="flex flex-wrap items-center gap-2"><span>{t("vzr.title")}</span><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-caption font-normal text-steel" dir="ltr">visa-research</span></span>} hint={t("vzr.hint")}
      aside={s && <Tag value={s.set ? "CONFIGURED" : "NOT_CONFIGURED"} className={s.set ? "border-success text-success" : "border-danger text-danger"} />} data-testid="visa-research-card">
      {dialog}
      {q.error ? <ErrorLine error={q.error} /> : !s ? null : (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <KV className="text-meta">
            <KVRow k={t("prov.credentials")}>{s.set ? <>{t("prov.set")} · {t("prov.rotated", { at: fmtDateTime(s.rotatedAt) })}{s.rotatedBy && ` · ${s.rotatedBy}`}</> : <span className="text-danger">{t("prov.notSet")}</span>}</KVRow>
            <KVRow k={t("vzr.model")}><span className="font-mono" dir="ltr">{s.model}</span></KVRow>
            <KVRow k={t("vzr.ttl")}><span className="num">{t("vzr.days", { n: s.ttlDays })}</span></KVRow>
          </KV>
          {write && (
            <div className="flex flex-wrap items-start gap-2">
              <Button size="xs" variant="outline" onClick={() => setOpen(true)} data-testid="visa-research-key">{s.set ? t("prov.rotate") : t("prov.enter")}</Button>
              {s.set && <Button size="xs" variant="ghost" className="text-danger" onClick={() => ask({
                title: t("vzr.remove"), description: t("vzr.remove.desc"), label: t("vzr.remove"), destructive: true,
                run: async () => { await api("/v1/dev/visa-research/credentials", { method: "DELETE" }); await qc.invalidateQueries({ queryKey: ["visa-research"] }) },
              })}>{t("vzr.remove")}</Button>}
            </div>
          )}
        </div>
      )}
      <SecretDialog open={open} onOpenChange={setOpen} title={t("vzr.keyTitle")} hintKeys={["apiKey"]} fixedKeys requiredKeys={["apiKey"]} hint={t("vzr.keyHint")}
        onSave={async (values) => { await api("/v1/dev/visa-research/credentials", { method: "PUT", body: { apiKey: values.apiKey ?? "" } }); await qc.invalidateQueries({ queryKey: ["visa-research"] }) }} />
    </Section>
  )
}
