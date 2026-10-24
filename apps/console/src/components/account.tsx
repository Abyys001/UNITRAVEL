"use client"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@unitravel/ui/components/button"

import { AddPasskey } from "@/components/mfa"
import { BentoGrid, BentoTile, EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api, errText } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface SessionRow { id: string; client: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean; mfaLevel: number }

/** Visible list of active sessions with Revoke, and second-factor management (ch. 16.1). */
export function AccountPage() {
  const { me } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["my-sessions"], queryFn: () => api<SessionRow[]>("/v1/me/sessions") })
  const revoke = useAct((id: string) => api(`/v1/me/sessions/${id}`, { method: "DELETE" }), { success: "Session revoked", invalidate: [["my-sessions"]] })
  return (
    <div>
      <PageHead kicker="You" title="Sessions & second factor" />
      <BentoGrid className="px-5 pt-4 pb-2 max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
        <BentoTile size="s" title={t("acct.sessions")}><p className="num text-[22px] leading-tight font-semibold">{q.data?.length ?? "—"}</p></BentoTile>
        <BentoTile size="s" title={t("acct.other")}><p className="num text-[22px] leading-tight font-semibold">{q.data ? q.data.filter((s) => !s.current).length : "—"}</p></BentoTile>
        <BentoTile size="s" title={t("acct.factors")}><p className="num text-[15px] font-medium">{me?.mfa.enrolled.join(", ") || "none"}</p></BentoTile>
      </BentoGrid>
      <div className="grid gap-x-8 px-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Active sessions">
          {q.error ? <TileError message={errText(q.error)} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={3} className="p-0" /> : !q.data.length ? <EmptyState title="No sessions." /> : (
            <ul className="ledger-rows">{q.data.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0"><span className="font-mono text-[11px]">{s.client}</span> <span className="num">{s.ip ?? "—"}</span>{s.current && <Tag value="THIS SESSION" className="ms-1 border-success text-success" />}<span className="block truncate text-[11px] text-steel">{s.userAgent} · since {fmtDateTime(s.createdAt)} · seen {fmtDateTime(s.lastSeenAt)} · MFA level {s.mfaLevel}</span></span>{!s.current && <Button size="sm" variant="outline" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}</li>)}</ul>
          )}
        </Panel>
        <Panel title="Second factor">
          <p>Enrolled: {me?.mfa.enrolled.join(", ") || "none"}</p>
          <p className="text-steel">Step-up valid until {fmtDateTime(me?.mfa.stepUpValidUntil)}</p>
          <div className="mt-2"><AddPasskey /></div>
          <p className="mt-2 text-[11px] text-steel">Passkeys are preferred; the authenticator app stays as a fallback.</p>
        </Panel>
      </div>
    </div>
  )
}
