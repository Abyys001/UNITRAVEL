"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { DEFAULT_WORKFLOW } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { BentoGrid, BentoTile, StatusChip, TileError } from "@/components/bento"
import { ActionBar, CaseTabs, ListSkeleton, paneClass, paneProps, StateChip, TableScroll } from "@/components/case"
import { Empty, ErrorLine, Field, Loading, PageHead, Panel, Tag } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useIsMobile } from "@/lib/hooks"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import type { CaseView } from "@/lib/types"

export default function CasePage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { can } = useSession()
  const mobile = useIsMobile()
  const t = useT()
  const [tab, setTab] = useState<"evidence" | "decide" | "history">("evidence")
  const q = useQuery({ queryKey: ["case", id], queryFn: () => api<CaseView>(`/v1/admin/compliance/cases/${id}`) })
  const [f, setF] = useState({ decision: "RELEASE", reason: "", reasonCode: DEFAULT_WORKFLOW.declineReasons[1]!.code, customerMessage: "", counselReference: "" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<Error | null>(null)
  const c = q.data
  const decide = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await api<{ status: string }>(`/v1/admin/compliance/cases/${id}/decide`, { body })
      toast.success(`Recorded — case ${r.status.toLowerCase()}`)
      await qc.invalidateQueries({ queryKey: ["case", id] }); void qc.invalidateQueries({ queryKey: ["cases"] }); void qc.invalidateQueries({ queryKey: ["queue-summary"] })
      setF({ ...f, reason: "", customerMessage: "" })
    } catch (e) { setErr(e as Error) } finally { setBusy(false) }
  }
  if (q.error) return <div className="p-5"><TileError message={errText(q.error)} onRetry={() => void q.refetch()} /></div>
  if (!c) return <><Loading /><ListSkeleton rows={5} /></>
  const open = c.status === "OPEN" || c.status === "ESCALATED"
  const hits = c.screenings.reduce((n, x) => n + x.hits.length, 0)
  const topScore = Math.max(0, ...c.screenings.flatMap((x) => x.hits.map((h) => h.score)))
  return (
    <div>
      <PageHead kicker={<>Compliance case · <Link className="num hover:underline" href={c.requestType === "CARGO" ? `/cargo/${c.requestRef}` : `/requests/${c.requestRef}`}>{c.requestRef}</Link> · opened {fmtDateTime(c.openedAt)}</>} title={<span dir="auto">{c.summary}</span>} />
      <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
        <BentoTile size="s" title={t("comp.state")} tone={open ? "alert" : "default"}><div className="flex flex-wrap gap-1.5"><StateChip value={c.status} className="text-[12px]" /><StateChip value={c.trigger} /></div></BentoTile>
        <BentoTile size="s" title={t("comp.opened")}><p className="num text-[15px] font-medium">{rel(c.openedAt)}</p><p className="mt-1 text-[12px] text-steel">{fmtDateTime(c.openedAt)}</p></BentoTile>
        <BentoTile size="s" title={t("comp.screening")}>
          <p className={cn("num text-[22px] leading-tight font-semibold", topScore >= 0.9 ? "text-danger" : "text-ink")}>{hits ? `${Math.round(topScore * 100)}%` : "—"}</p>
          <p className="mt-1 text-[12px] text-steel">{hits ? t("comp.hits", { n: hits }) : t("comp.clear")}</p>
        </BentoTile>
        <BentoTile size="s" title={t("comp.fourEyes")}>
          <StatusChip tone={c.requiresFourEyes ? "warn" : "neutral"}>{c.requiresFourEyes ? t("comp.fourEyes.required") : t("comp.fourEyes.no")}</StatusChip>
          {c.pendingOverride && <p className="mt-1.5 text-[12px] font-medium text-danger">{t("comp.override")}</p>}
        </BentoTile>
      </BentoGrid>
      <CaseTabs label={t("case.tabs")} value={tab} onChange={setTab} tabs={[{ key: "evidence", label: t("comp.tab.evidence") }, { key: "decide", label: t("comp.tab.decide") }, { key: "history", label: t("comp.tab.history"), count: c.decisions.length }]} />
      <div className="grid gap-x-8 px-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div {...paneProps("evidence")} className={paneClass(tab, "evidence")}>
          <Panel title="What triggered it">
            {!c.evidence.length ? <Empty>No evidence recorded.</Empty> : <ul className="ledger-rows">{c.evidence.map((e, i) => <li key={i} className="grid grid-cols-[7rem_1fr_auto] gap-2 py-1.5"><span className="font-mono text-[11px] text-steel">{e.kind}</span><span><span className="font-medium" dir="auto">{e.label}</span><span className="block text-steel" dir="auto">{e.detail}</span></span>{e.score != null && <span className="num">{Math.round(e.score * 100)}%</span>}</li>)}</ul>}
          </Panel>
          {c.screenings.map((s) => (
            <Panel key={s.id} title={`Screening · ${s.subjectType.toLowerCase()} · ${fmtDateTime(s.createdAt)}`} aside={<StatusChip tone={s.result === "CLEAR" ? "ok" : "danger"} className="font-mono text-[10.5px] uppercase">{s.result.replace(/_/g, " ")}</StatusChip>}>
              <p className="font-medium" dir="auto">{s.subjectName}</p>
              <p className="text-[11px] text-steel">Lists: {Object.entries(s.listsVersion).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
              {s.hits.length > 0 && (
                <TableScroll><table className="mt-1 w-full bg-surface-raised" data-testid="hits">
                  <thead><tr className="border-b border-rule">{["Matched name", "List", "Score", "Why", "Programmes"].map((h) => <th key={h} className="cap px-1.5 py-1 text-start font-normal">{h}</th>)}</tr></thead>
                  <tbody>{s.hits.map((h) => <tr key={h.entryId} className="border-b border-rule/70 align-top"><td className="px-1.5 py-1" dir="auto">{h.matchedName}</td><td className="px-1.5 py-1 font-mono text-[11px]">{h.listId} {h.externalId}</td><td className={cn("num px-1.5 py-1", h.score >= 0.9 ? "text-danger" : "")}>{Math.round(h.score * 100)}%</td><td className="px-1.5 py-1 text-[12px] text-steel">{h.reasons.join(", ")}</td><td className="px-1.5 py-1 text-[11px]">{h.programmes.join(", ")}</td></tr>)}</tbody>
                </table></TableScroll>
              )}
            </Panel>
          ))}
          </div>
          <div {...paneProps("history")} className={paneClass(tab, "history")}>
          <Panel title="Decisions (immutable)">
            {!c.decisions.length ? <Empty>No decisions yet.</Empty> : <ol className="ledger-rows">{c.decisions.map((x) => <li key={x.id} className="py-1.5"><p><Tag value={x.decision} /> <span className="num text-[12px] text-steel">{fmtDateTime(x.createdAt)}</span> · {x.decidedBy}{x.secondApprover && <> · second approver {x.secondApprover}</>}{x.counselReference && <> · counsel {x.counselReference}</>}</p><p dir="auto">{x.reason}</p></li>)}</ol>}
          </Panel>
          </div>
        </div>
        <div {...paneProps("decide")} className={paneClass(tab, "decide")}>
          {c.pendingOverride && (
            <Panel title="Override awaiting a second person">
              <p>Requested by {c.pendingOverride.requestedBy}. A different compliance officer or an owner must approve.</p>
              {can("compliance.case.decide") && !mobile && <Button size="sm" className="mt-2" loading={busy} onClick={() => void decide({ decision: "OVERRIDE", reason: f.reason || "Second approval of override", approveOverrideOf: c.pendingOverride!.decisionId })}>Approve override</Button>}
            </Panel>
          )}
          {open && can("compliance.case.decide") && (mobile ? <p className="py-3 text-steel">Compliance decisions are a desktop feature in v1.</p> : (
            <Panel title="Decide">
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void decide({ decision: f.decision, reason: f.reason, reasonCode: f.decision === "DECLINE" ? f.reasonCode : undefined, customerMessage: f.decision === "DECLINE" ? f.customerMessage || undefined : undefined, counselReference: f.counselReference || undefined }) }}>
                <fieldset className="grid grid-cols-2 gap-1" aria-label="Decision">
                  {[["RELEASE", c.requiresFourEyes ? "Release (needs second approver)" : "Release"], ["DECLINE", "Decline"], ["ESCALATE", "Escalate to owner"], ["OVERRIDE", "Override a block (four-eyes)"]].map(([v, l]) => <label key={v} className={cn("flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1.5", f.decision === v ? "border-ink bg-surface-raised" : "border-rule")}><input type="radio" name="decision" value={v} checked={f.decision === v} onChange={() => setF({ ...f, decision: v! })} />{l}</label>)}
                </fieldset>
                <Field label="Reason (recorded, internal)"><textarea className="field-input min-h-20" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} minLength={5} required /></Field>
                {f.decision === "DECLINE" && <>
                  <Field label="Reason code"><NativeSelect className="field-input" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}>{DEFAULT_WORKFLOW.declineReasons.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}</NativeSelect></Field>
                  <Field label="Neutral message to the customer"><textarea className="field-input min-h-16" value={f.customerMessage} onChange={(e) => setF({ ...f, customerMessage: e.target.value })} dir="auto" placeholder="We are unable to arrange this request." /></Field>
                </>}
                {(f.decision === "OVERRIDE" || f.decision === "RELEASE") && <Field label="Counsel reference (optional)"><input className="field-input font-mono" value={f.counselReference} onChange={(e) => setF({ ...f, counselReference: e.target.value })} /></Field>}
                <ErrorLine error={err} />
                <ActionBar edge="bottom" className="-mx-1 px-1"><Button type="submit" size="sm" loading={busy} variant={f.decision === "DECLINE" ? "destructive" : "default"}>Record decision</Button></ActionBar>
              </form>
            </Panel>
          ))}
        </div>
      </div>
    </div>
  )
}
