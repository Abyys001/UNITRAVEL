"use client"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@unitravel/ui/components/button"

import { AddPasskey } from "@/components/mfa"
import { Empty, ErrorLine, PageHead, Panel, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useSession } from "@/lib/session"

interface SessionRow { id: string; client: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean; mfaLevel: number }

/** Visible list of active sessions with Revoke, and second-factor management (ch. 16.1). */
export function AccountPage() {
  const { me } = useSession()
  const q = useQuery({ queryKey: ["my-sessions"], queryFn: () => api<SessionRow[]>("/v1/me/sessions") })
  const revoke = useAct((id: string) => api(`/v1/me/sessions/${id}`, { method: "DELETE" }), { success: "Session revoked", invalidate: [["my-sessions"]] })
  return (
    <div>
      <PageHead kicker="You" title="Sessions & second factor" />
      <div className="grid gap-x-8 px-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Active sessions">
          <ErrorLine error={q.error} />
          {!q.data ? <p className="text-slate">Loading…</p> : !q.data.length ? <Empty>No sessions.</Empty> : (
            <ul className="ledger-rows">{q.data.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 py-1.5"><span className="min-w-0"><span className="font-mono text-[11px]">{s.client}</span> <span className="num">{s.ip ?? "—"}</span>{s.current && <Tag value="THIS SESSION" className="ms-1 border-moss text-moss" />}<span className="block truncate text-[11px] text-slate">{s.userAgent} · since {fmtDateTime(s.createdAt)} · seen {fmtDateTime(s.lastSeenAt)} · MFA level {s.mfaLevel}</span></span>{!s.current && <Button size="xs" variant="outline" onClick={() => revoke.mutate(s.id)}>Revoke</Button>}</li>)}</ul>
          )}
        </Panel>
        <Panel title="Second factor">
          <p>Enrolled: {me?.mfa.enrolled.join(", ") || "none"}</p>
          <p className="text-slate">Step-up valid until {fmtDateTime(me?.mfa.stepUpValidUntil)}</p>
          <div className="mt-2"><AddPasskey /></div>
          <p className="mt-2 text-[11px] text-slate">Passkeys are preferred; the authenticator app stays as a fallback.</p>
        </Panel>
      </div>
    </div>
  )
}
