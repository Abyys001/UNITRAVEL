"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Suspense, useMemo, useState } from "react"

import { RUN_STATUSES, type ResearchRunView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { codeLabel } from "@/components/club"
import { Chips, ListPage, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { Country, DocName, VisaStatusChip } from "@/components/visa"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

const RUN_TONE = { QUEUED: "neutral", RUNNING: "info", DONE: "ok", FAILED: "danger", NOT_CONFIGURED: "warn" } as const

function RunCard({ r }: { r: ResearchRunView }) {
  const t = useT()
  const secs = r.startedAt && r.finishedAt ? Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null
  return (
    <li className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 text-meta shadow-[var(--tile-shadow)]" data-run-status={r.status}>
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip tone={RUN_TONE[r.status]}>{codeLabel(t, "vz.r", r.status)}</StatusChip>
          <span className="font-medium"><Country code={r.destination} /> · <DocName code={r.documentType} /> · <span className="font-mono" dir="ltr">{r.issuingCountry}</span> · {codeLabel(t, "vz.p", r.purpose)}</span>
        </span>
        <span className="text-caption text-steel">{codeLabel(t, "vz.trig", r.trigger)} · {fmtDateTime(r.createdAt)}{secs !== null && ` · ${secs}s`}</span>
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-steel">
        {r.resultStatus && <span className="flex items-center gap-1">{t("vz.result")}: <VisaStatusChip s={r.resultStatus} /></span>}
        {r.resultVerification && <span>{codeLabel(t, "vz.v", r.resultVerification)}</span>}
        <span>{t("vz.dropped", { n: r.droppedClaims })}</span>
        {r.model && <span className="font-mono" dir="ltr">{r.model}</span>}
        {r.inputTokens != null && <span className="num">{t("vz.tokens", { i: r.inputTokens, o: r.outputTokens ?? 0 })}</span>}
        {r.ruleId && <Link className="text-royal underline" href={`/visa/rules/${r.ruleId}`}>{t("vz.openRule")}</Link>}
      </p>
      {r.error && <p className="mt-2 rounded-md bg-danger-subtle px-2.5 py-1.5 break-words text-danger" role="note">{r.error}</p>}
      {r.fetches.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-steel">{t("vz.fetches", { n: r.fetches.length })}</summary>
          <div className="mt-1 overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>URL</th><th>{t("vz.fetch.status")}</th><th>ms</th><th>{t("vz.fetch.chars")}</th></tr></thead>
              <tbody>{r.fetches.map((f, i) => (
                <tr key={i}><td className="max-w-md truncate font-mono text-caption" dir="ltr" title={f.url}>{f.url}</td><td className={f.status === "OK" ? "text-success" : "text-danger"}>{f.status}</td><td className="num">{f.ms}</td><td className="num">{f.chars ?? "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
    </li>
  )
}

function RunsInner() {
  const t = useT()
  const params = useSearchParams()
  const [status, setStatus] = useState(params.get("status") ?? "")
  const [destination, setDestination] = useState(params.get("destination") ?? "")
  const dest = /^[A-Za-z]{2}$/.test(destination) ? destination.toUpperCase() : ""
  const list = useInfiniteQuery({
    queryKey: ["visa", "runs", status, dest],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "50" })
      if (status) u.set("status", status)
      if (dest) u.set("destination", dest)
      if (pageParam) u.set("cursor", pageParam)
      return api<{ items: ResearchRunView[]; nextCursor: string | null }>(`/v1/admin/visa/runs?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some((r) => r.status === "QUEUED" || r.status === "RUNNING")) ? 5000 : false),
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={t("nav.visaRuns")} />
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("vz.runs.note")}</p>
      <Toolbar query={destination} onQuery={setDestination} placeholder={t("vz.filter.destination")} count={list.data && !list.hasNextPage ? rows.length : undefined}>
        <Chips label={t("pg.c.status")} value={status} options={[{ value: "", label: t("pg.all") }, ...RUN_STATUSES.map((s) => ({ value: s as string, label: codeLabel(t, "vz.r", s) }))]} onChange={setStatus} />
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("vz.runs.none")} /> : (
        <ul className="space-y-2 px-4 pb-6 md:px-6" data-testid="visa-runs">
          {rows.map((r) => <RunCard key={r.id} r={r} />)}
          {list.hasNextPage && <li className="flex justify-center"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></li>}
        </ul>
      )}
    </ListPage>
  )
}

/** Research history (ADR-0029): every run with its fetch log, dropped claims, model, tokens and error. */
export default function VisaRunsPage() { return <Suspense><RunsInner /></Suspense> }
