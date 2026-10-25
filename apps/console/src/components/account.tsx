"use client"

import { useQuery } from "@tanstack/react-query"

import { Button } from "@unitravel/ui/components/button"

import { AddPasskey } from "@/components/mfa"
import { BentoGrid, BentoTile, EmptyState, TileError } from "@/components/bento"
import { ListSkeleton } from "@/components/case"
import { DevPage, KV, KVRow, Section } from "@/components/dev-ui"
import { PageHead, Tag, useAct } from "@/components/ui"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"

interface SessionRow { id: string; client: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean; mfaLevel: number }

/** Visible list of active sessions with Revoke, and second-factor management (ch. 16.1). */
export function AccountPage() {
  const { me } = useSession()
  const t = useT()
  const q = useQuery({ queryKey: ["my-sessions"], queryFn: () => api<SessionRow[]>("/v1/me/sessions") })
  const revoke = useAct((id: string) => api(`/v1/me/sessions/${id}`, { method: "DELETE" }), { success: t("acct.revoked"), invalidate: [["my-sessions"]] })
  return (
    <div>
      <PageHead kicker={t("acct.you")} title={t("acct.title")}><span className="text-[12px] text-steel">{t("acct.desc")}</span></PageHead>
      <DevPage>
        <BentoGrid className="max-sm:grid-cols-2 max-sm:gap-2" data-testid="case-summary">
          <BentoTile size="s" title={t("acct.sessions")}><p className="num text-[24px] leading-tight font-semibold">{q.data?.length ?? "—"}</p></BentoTile>
          <BentoTile size="s" title={t("acct.other")}><p className="num text-[24px] leading-tight font-semibold">{q.data ? q.data.filter((s) => !s.current).length : "—"}</p></BentoTile>
          <BentoTile size="s" title={t("acct.factors")}><p className="text-[15px] font-medium" dir="ltr">{me?.mfa.enrolled.join(", ") || t("acct.none")}</p></BentoTile>
        </BentoGrid>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Section title={t("acct.active")} hint={t("acct.activeHint")} flush={!!q.data?.length}>
            {q.error ? <TileError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <ListSkeleton rows={3} className="p-0" /> : !q.data.length ? <EmptyState title={t("acct.noSessions")} /> : (
              <ul className="divide-y divide-rule">{q.data.map((s) => <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5"><span className="block min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-surface-sunk px-1.5 py-px font-mono text-[11px]">{s.client}</span><span className="num" dir="ltr">{s.ip ?? "—"}</span>{s.current && <Tag value="THIS SESSION" className="border-success text-success" />}</span><span className="mt-0.5 block truncate text-[11.5px] text-steel" dir="ltr">{s.userAgent}</span><span className="block text-[11.5px] text-steel">{t("acct.since", { at: fmtDateTime(s.createdAt) })} · {t("ud.seen", { at: fmtDateTime(s.lastSeenAt) })} · MFA {s.mfaLevel}</span></span>{!s.current && <Button size="sm" variant="outline" onClick={() => revoke.mutate(s.id)}>{t("acct.revoke")}</Button>}</li>)}</ul>
            )}
          </Section>
          <Section title={t("acct.second")} hint={t("acct.secondHint")}>
            <KV className="text-[12.5px]">
              <KVRow k={t("acct.enrolled")}><span dir="ltr">{me?.mfa.enrolled.join(", ") || t("acct.none")}</span></KVRow>
              <KVRow k={t("acct.stepUp")}>{fmtDateTime(me?.mfa.stepUpValidUntil)}</KVRow>
            </KV>
            <div className="mt-4 border-t border-rule pt-4"><AddPasskey /><p className="mt-2 text-[12px] text-steel">{t("mfa.prefer")}</p></div>
          </Section>
        </div>
      </DevPage>
    </div>
  )
}
