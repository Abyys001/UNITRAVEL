"use client"

import { useQuery } from "@tanstack/react-query"
import { CalendarClock, MapPin, Package, Phone, Printer } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { formatTn, KIND_KEY, openApiPdf } from "@/components/cargo-ops"
import { Directions, RouteAll } from "@/components/directions"
import { PageHead } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"

export type Manifest = {
  agent: { id: string; agentCode: string; displayName: string; vehicle: string | null }; date: string
  stops: { assignmentId: string; kind: "COLLECTION" | "HANDLING" | "DELIVERY"; status: string; ref: string; trackingNumber: string | null; scheduledFor: string | null; overdue: boolean; name: string; company: string | null; phone: string | null; address: string; mapQuery: string | null; pieces: number; weightKg: number; handlingInstructions: string | null; attempts: number }[]
  totals: { stops: number; pieces: number; weightKg: number }
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date())

/** ADR-0046 D3: the agent's run sheet for a day, in stop order, with map and call links and a printable PDF. */
export default function AgentManifest() {
  const t = useT()
  const [date, setDate] = useState(today)
  const q = useQuery({ queryKey: ["agent-manifest", date], queryFn: () => api<Manifest>(`/v1/agent/manifest?date=${date}`), refetchInterval: 60_000 })
  const m = q.data
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 md:px-6">
      <PageHead title={t("man.title")} />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-meta font-medium">{t("man.date")}<Input type="date" value={date} onChange={(e) => setDate(e.target.value || today())} className="w-44" /></label>
        <Button variant="outline" onClick={() => void openApiPdf(`/v1/agent/manifest.pdf?date=${date}`)} data-testid="manifest-pdf"><Printer className="size-4" aria-hidden />{t("man.pdf")}</Button>
      </div>
      {m && <div className="mb-3"><RouteAll addresses={m.stops.map((x) => x.mapQuery).filter((x): x is string => !!x)} /></div>}
      {m && <p className="mb-2 text-meta font-medium">{t("man.totals", { stops: m.totals.stops, pieces: m.totals.pieces, kg: m.totals.weightKg })}</p>}
      {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !m ? <ListSkeleton rows={4} /> : !m.stops.length ? <EmptyState title={t("man.none")} /> : (
        <ol className="grid gap-3" data-testid="manifest-stops">
          {m.stops.map((s, i) => (
            <li key={s.assignmentId} className="rounded-[var(--radius-card)] border border-rule bg-surface-raised p-4 shadow-[var(--tile-shadow)]">
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-900 text-meta font-bold text-white">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">{t(KIND_KEY[s.kind])}{s.overdue && <span className="rounded-full bg-danger-subtle px-2 text-caption text-danger">{t("man.late")}</span>}{s.status === "OFFERED" && <span className="rounded-full bg-orange/15 px-2 text-caption text-orange-700">{t("agt.offered")}</span>}</p>
                  <p className="ref text-meta" dir="ltr">{s.trackingNumber ? formatTn(s.trackingNumber) : s.ref}</p>
                  <p className="mt-2 flex gap-1.5"><MapPin className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden /><span><span className="block font-medium" dir="auto">{s.name}{s.company && ` · ${s.company}`}</span><span className="text-meta text-steel" dir="auto">{s.address}</span></span></p>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-steel">
                    <span className="flex items-center gap-1"><Package className="size-3.5" aria-hidden />{t("ops.c.piecesN", { n: s.pieces, kg: s.weightKg })}</span>
                    {s.scheduledFor && <span className="flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden />{fmtDateTime(s.scheduledFor)}</span>}
                    {s.attempts > 0 && <span className="text-danger">{t("ops.job.attempts", { n: s.attempts })}</span>}
                  </p>
                  {s.handlingInstructions && <p className="mt-2 rounded-md bg-danger-subtle px-2 py-1 text-meta font-medium text-danger" dir="auto">{s.handlingInstructions}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {s.mapQuery && <Directions address={s.mapQuery} />}
                    {s.phone && <a href={`tel:${s.phone}`} className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-rule-strong px-3 text-meta font-medium" dir="ltr"><Phone className="size-4" aria-hidden />{t("man.call")}</a>}
                    <Link href={`/agent/${s.assignmentId}`} className="inline-flex h-11 items-center rounded-lg border border-rule-strong px-3 text-meta font-medium">{t("man.open")}</Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
