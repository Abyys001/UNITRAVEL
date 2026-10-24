"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import type { VerificationQueueItem } from "@unitravel/contracts"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton, StateChip, TableScroll } from "@/components/case"
import { PageHead } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime, rel } from "@/lib/format"
import { useT } from "@/lib/i18n"

/** Identity verification queue (ADR-0005): customers who confirmed their passport details, oldest first. */
export default function VerificationQueue() {
  const q = useQuery({ queryKey: ["verifications"], queryFn: () => api<VerificationQueueItem[]>("/v1/admin/verifications"), refetchInterval: 30_000 })
  const t = useT()
  return (
    <div>
      <PageHead kicker="Identity" title="Passport verification" />
      <div className="px-5 py-3">
        {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={5} className="p-0" /> : !q.data.length ? <EmptyState title="Nothing waiting for review." hint={t("list.updated")} className="py-10" /> : (
          <>
            <ul className="space-y-2 md:hidden" data-testid="verification-cards">
              {q.data.map((v) => (
                <li key={v.id}>
                  <Link href={`/verifications/${v.id}`} className="block min-h-11 rounded-xl border border-rule bg-surface-raised p-3 active:bg-hover">
                    <span className="flex items-center justify-between gap-2"><span className="font-medium" dir="ltr">{v.travellerName}</span><StateChip value="SUBMITTED" /></span>
                    <span className="mt-1 block text-steel">{v.nationality} · {v.documentType === "PASSPORT" ? "Passport" : "National ID"}</span>
                    <span className="num mt-1 block text-[12px] text-steel">{t("ver.waiting")} {rel(v.submittedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <TableScroll className="hidden md:block">
              <table className="w-full bg-surface-raised" data-testid="verifications">
                <thead><tr className="border-b border-rule">{["Traveller", "Nationality", "Document", "Waiting since"].map((h) => <th key={h} className="cap px-2 py-1.5 text-start font-normal">{h}</th>)}</tr></thead>
                <tbody>
                  {q.data.map((v) => (
                    <tr key={v.id} className="border-b border-rule/70 hover:bg-hover/60">
                      <td className="px-2 py-1.5"><Link href={`/verifications/${v.id}`} className="inline-block py-1 font-medium hover:underline" dir="ltr">{v.travellerName}</Link></td>
                      <td className="px-2 py-1.5">{v.nationality}</td>
                      <td className="px-2 py-1.5">{v.documentType === "PASSPORT" ? "Passport" : "National ID"}</td>
                      <td className="num px-2 py-1.5 text-[12px]" title={fmtDateTime(v.submittedAt)}>{rel(v.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </>
        )}
      </div>
    </div>
  )
}
