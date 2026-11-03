"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"

import { VERIFICATION_STATES, VISA_STATUSES, type VisaRuleView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { EmptyState, StatusChip, TileError } from "@/components/bento"
import { ListSkeleton, TableScroll } from "@/components/case"
import { codeLabel } from "@/components/club"
import { Chips, ListCard, ListPage, tableClass, Toolbar } from "@/components/data-list"
import { PageHead } from "@/components/ui"
import { Country, CreateRuleDialog, DocName, isStaleRule, useDocTypes, VerificationChip, VisaStatusChip } from "@/components/visa"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

/** Values each source gave for a contested field, side by side (the conflicts view). */
export function ConflictTable({ rule }: { rule: VisaRuleView }) {
  const t = useT()
  if (!rule.conflicts.length) return null
  return (
    <div className="space-y-2" data-testid="visa-conflicts">
      {rule.conflicts.map((c) => (
        <div key={c.field} className="rounded-lg border border-danger/30 bg-danger-subtle/40 p-2.5">
          <p className="text-meta font-semibold text-danger">{codeLabel(t, "vz.f", c.field)}</p>
          <ul className="mt-1 grid gap-1.5 sm:grid-cols-2">
            {c.values.map((v, i) => (
              <li key={i} className="rounded-md border border-rule bg-surface-raised p-2 text-meta">
                <span className="block font-medium" dir="auto">{c.field === "status" ? codeLabel(t, "vz.st", String(v.value)) : v.value == null ? t("vz.unknown") : String(v.value)}</span>
                <a href={v.url} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-caption text-royal underline" dir="ltr">{v.url}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function RulesInner({ conflictsOnly }: { conflictsOnly?: boolean }) {
  const t = useT()
  const { can } = useSession()
  const params = useSearchParams()
  const docs = useDocTypes()
  const [destination, setDestination] = useState(params.get("destination") ?? "")
  const [documentType, setDocumentType] = useState(params.get("documentType") ?? "")
  const [verification, setVerification] = useState(conflictsOnly ? "CONFLICT" : params.get("verification") ?? "")
  const [status, setStatus] = useState(params.get("status") ?? "")
  const [stale, setStale] = useState<"" | "true" | "false">((params.get("stale") as "true" | "false" | null) ?? "")
  const [creating, setCreating] = useState(false)
  const dest = /^[A-Za-z]{2}$/.test(destination) ? destination.toUpperCase() : ""
  const list = useInfiniteQuery({
    queryKey: ["visa", "rules", dest, documentType, verification, status, stale],
    queryFn: ({ pageParam }) => {
      const u = new URLSearchParams({ limit: "50" })
      if (dest) u.set("destination", dest)
      if (documentType) u.set("documentType", documentType)
      if (verification) u.set("verification", verification)
      if (status) u.set("status", status)
      if (stale) u.set("stale", stale)
      if (pageParam) u.set("cursor", pageParam)
      return api<{ items: VisaRuleView[]; nextCursor: string | null }>(`/v1/admin/visa/rules?${u.toString()}`)
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  })
  const rows = useMemo(() => (list.data?.pages ?? []).flatMap((p) => p.items), [list.data])
  const more = list.hasNextPage && <div className="flex justify-center border-t border-rule p-3"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>{t("common.loadMore")}</Button></div>
  const expiry = (r: VisaRuleView) => isStaleRule(r) ? <StatusChip tone="warn">{t("vz.stale")}</StatusChip> : <span className="num text-steel" title={r.expiresAt ? fmtDateTime(r.expiresAt) : undefined}>{r.expiresAt ? fmtDate(r.expiresAt) : "—"}</span>
  return (
    <ListPage>
      <PageHead kicker={t("nav.visa")} title={conflictsOnly ? t("nav.visaConflicts") : t("nav.visaRules")}>
        {!conflictsOnly && can("visa.write") && <Button size="sm" onClick={() => setCreating(true)} data-testid="new-visa-rule"><Plus aria-hidden />{t("vz.newRule")}</Button>}
      </PageHead>
      <p className="px-4 pb-3 text-meta text-steel md:px-6">{conflictsOnly ? t("vz.conflicts.note") : t("vz.rules.note")}</p>
      <Toolbar query={destination} onQuery={setDestination} placeholder={t("vz.filter.destination")} count={list.data && !list.hasNextPage ? rows.length : undefined}>
        <NativeSelect aria-label={t("vz.document")} className="field-input h-8 w-auto" value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          <option value="">{t("vz.allDocuments")}</option>{docs.data?.map((d) => <option key={d.code} value={d.code}>{d.name.en}</option>)}
        </NativeSelect>
        {!conflictsOnly && <Chips label={t("vz.verification")} value={verification} options={[{ value: "", label: t("pg.all") }, ...VERIFICATION_STATES.map((v) => ({ value: v as string, label: codeLabel(t, "vz.v", v) }))]} onChange={setVerification} />}
        {!conflictsOnly && (
          <NativeSelect aria-label={t("vz.f.status")} className="field-input h-8 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("vz.allStatuses")}</option>{VISA_STATUSES.map((s) => <option key={s} value={s}>{codeLabel(t, "vz.st", s)}</option>)}
          </NativeSelect>
        )}
        <Chips label={t("vz.freshness")} value={stale} options={[{ value: "", label: t("pg.all") }, { value: "true", label: t("vz.stale") }, { value: "false", label: t("vz.current") }]} onChange={(v) => setStale(v as typeof stale)} />
      </Toolbar>
      {list.error ? <div className="px-4 py-3 md:px-6"><TileError error={list.error} onRetry={() => void list.refetch()} /></div> : !list.data ? <ListSkeleton rows={5} className="px-4 md:px-6" /> : !rows.length ? <EmptyState title={conflictsOnly ? t("vz.conflicts.none") : t("vz.rules.none")} hint={conflictsOnly ? undefined : t("vz.rules.none.hint")} /> : conflictsOnly ? (
        <ul className="space-y-3 px-4 pb-6 md:px-6" data-testid="visa-conflict-list">
          {rows.map((r) => (
            <li key={r.id} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-3.5 shadow-[var(--tile-shadow)]">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/visa/rules/${r.id}`} className="font-medium underline-offset-2 hover:underline"><Country code={r.destination} /> · <DocName code={r.documentType} /> · {codeLabel(t, "vz.p", r.purpose)}</Link>
                <span className="text-caption text-steel">{t("vz.updated", { d: fmtDateTime(r.updatedAt) })}</span>
              </p>
              <div className="mt-2"><ConflictTable rule={r} /></div>
            </li>
          ))}
          {more && <li>{more}</li>}
        </ul>
      ) : (
        <ListCard fill>
          <TableScroll label={t("nav.visaRules")}>
            <table className={tableClass} data-testid="visa-rules">
              <thead><tr><th>{t("vz.destination")}</th><th>{t("vz.document")}</th><th>{t("vz.issuer")}</th><th>{t("vz.purpose")}</th><th>{t("vz.f.status")}</th><th>{t("vz.verification")}</th><th>{t("vz.verifiedAt")}</th><th>{t("vz.expires")}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><Link href={`/visa/rules/${r.id}`} className="font-medium underline-offset-2 hover:underline"><Country code={r.destination} /></Link></td>
                    <td className="max-w-64 truncate"><DocName code={r.documentType} /></td>
                    <td className="font-mono" dir="ltr">{r.issuingCountry}</td>
                    <td>{codeLabel(t, "vz.p", r.purpose)}</td>
                    <td className="whitespace-nowrap"><VisaStatusChip s={r.facts.status} /></td>
                    <td className="whitespace-nowrap"><VerificationChip v={r.verification} /></td>
                    <td className="num whitespace-nowrap text-steel">{r.verifiedAt ? fmtDate(r.verifiedAt) : "—"}</td>
                    <td className="whitespace-nowrap">{expiry(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {more}
        </ListCard>
      )}
      {creating && <CreateRuleDialog onOpenChange={(o) => !o && setCreating(false)} />}
    </ListPage>
  )
}

export { RulesInner }
