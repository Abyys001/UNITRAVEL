"use client"

import { AGENT_BULK_ACTIONS } from "@unitravel/contracts"

import { BulkScan } from "@/components/bulk-scan"
import { api, ApiError } from "@/lib/api"
import { type MsgKey, useT } from "@/lib/i18n"

type Found = { jobs: { assignmentId: string; kind: string; status: string }[] }

/** ADR-0046 D2: agent bulk scan. Each parcel goes through the agent's own job action (own jobs only, 404 otherwise). */
export default function AgentBulk() {
  const t = useT()
  const apply = async (tn: string, action: string, input: { location: string }) => {
    let found: Found
    try { found = await api<Found>(`/v1/agent/jobs/by-tracking/${tn}`) } catch (e) { if (e instanceof ApiError && e.problem.status === 404) throw new Error(t("bulk.noJob")); throw e }
    // Try each of the agent's open jobs on this parcel; the first one whose state allows the update takes it.
    let lastErr: unknown = null
    for (const j of found.jobs) {
      try { await api(`/v1/agent/jobs/${j.assignmentId}/actions/${action}`, { body: { location: input.location } }); return }
      catch (e) { lastErr = e }
    }
    throw lastErr ?? new Error(t("bulk.noJob"))
  }
  return <BulkScan actions={AGENT_BULK_ACTIONS} defaultAction="at_sorting_facility" labelOf={(a) => t(`agt.a.${a}` as MsgKey)} withTime={false} apply={apply} />
}
