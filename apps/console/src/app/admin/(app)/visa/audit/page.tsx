"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { Button } from "@unitravel/ui/components/button"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { codeLabel } from "@/components/club"
import { ListPage } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

interface Entry { id: string; occurredAt: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null; before: unknown; after: unknown }

const json = (v: unknown) => (v == null ? "—" : JSON.stringify(v, null, 2))

/** Every manual change to visa rules, sources, document types and the research key (hash-chained audit log). */
export default function VisaAuditPage() {
  const t = useT()
  const list = useInfiniteQuery({
    queryKey: ["visa", "audit"],
    queryFn: ({ pageParam }) => api<{ items: Entry[]; nextCursor: string | null }>(`/v1/admin/visa/audit?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={t("nav.visaAudit")} />
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{t("vz.audit.note")}</p>
      {list.error ? <div className="px-4 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={t("vz.audit.none")} /> : (
        <ul className="space-y-2 px-4 pb-6 md:px-6" data-testid="visa-audit">
          {rows.map((e) => (
            <li key={e.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3 text-meta shadow-[var(--tile-shadow)]">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{codeLabel(t, "vz.a", e.action.replace(/\./g, "_"))}</span>
                <span className="num text-caption text-steel">{fmtDateTime(e.occurredAt)}</span>
              </p>
              <p className="text-caption text-steel"><span className="font-mono" dir="ltr">{e.entityType} {e.entityId ?? ""}</span> · {t("vz.audit.actor")}: <span className="font-mono" dir="ltr">{e.actorUserId ?? t("vz.audit.system")}</span></p>
              {(e.before != null || e.after != null) && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-steel">{t("vz.audit.changes")}</summary>
                  <div className="mt-1 grid gap-2 lg:grid-cols-2">
                    <div><p className="text-caption text-steel">{t("vz.audit.before")}</p><pre className="max-h-80 overflow-auto rounded-md bg-surface-sunk p-2 text-caption" dir="ltr">{json(e.before)}</pre></div>
                    <div><p className="text-caption text-steel">{t("vz.audit.after")}</p><pre className="max-h-80 overflow-auto rounded-md bg-surface-sunk p-2 text-caption" dir="ltr">{json(e.after)}</pre></div>
                  </div>
                </details>
              )}
            </li>
          ))}
          {list.hasNextPage && <li className="flex justify-center"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></li>}
        </ul>
      )}
    </ListPage>
  )
}
