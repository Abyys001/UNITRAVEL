"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import type { PublicTrackView, TrackItem } from "@unitravel/contracts"
import type { MessageKey } from "@unitravel/i18n"
import { EmptyState, LoadingState } from "@unitravel/ui/product/states"
import { Timeline } from "@unitravel/ui/product/timeline"

import { Auto, Ltr } from "@/components/badges"
import { api, ApiError } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { useI18n } from "@/lib/i18n"
import { type PowChallenge, solvePow } from "@/lib/pow"
import { useSession } from "@/lib/session"

const KINDS = ["ALL", "FLIGHT", "CARGO", "SERVICE", "INVOICE"] as const

/** Signed in: one list of the customer's own requests and invoices (GET /v1/track). */
function Mine() {
  const { t, href, date, sep } = useI18n()
  const [kind, setKind] = useState<(typeof KINDS)[number]>("ALL")
  const q = useQuery({ queryKey: ["track"], queryFn: () => api<TrackItem[]>("/v1/track"), refetchInterval: 30_000 })
  const items = (q.data ?? []).filter((i) => kind === "ALL" || i.kind === kind)
  const link = (i: TrackItem) => href(i.kind === "FLIGHT" ? `/requests/${i.ref}` : i.kind === "CARGO" ? `/cargo/${i.ref}` : i.kind === "SERVICE" ? `/services/${i.ref}` : `/billing/${i.ref}`)
  const label = (i: TrackItem) => (i.kind === "SERVICE" ? t(`services.status.${i.status}` as MessageKey) : i.kind === "INVOICE" ? t(`billing.status.${i.status}` as MessageKey) : i.statusLabel)
  return (
    <section aria-labelledby="mine-h">
      <h2 id="mine-h" className="font-display text-2xl">{t("track.mineTitle")}</h2>
      <div role="group" aria-label={t("track.mineTitle")} className="mt-4 flex flex-wrap gap-2">
        {KINDS.map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`rounded-full border px-4 py-1.5 text-sm font-semibold pointer-coarse:min-h-11 ${kind === k ? "border-navy-950 bg-navy-950 text-white" : "border-line bg-white text-navy-900 hover:bg-cloud"}`}>{t(`track.kinds.${k}`)}</button>)}
      </div>
      {q.isLoading && <LoadingState className="mt-4" label={t("common.loading")} rows={2} />}
      {!q.isLoading && !items.length && <EmptyState className="mt-4" compact title={t("track.empty")} />}
      {items.length > 0 && (
        <ul className="card-brand mt-4 divide-y divide-line overflow-hidden" data-testid="track-list">
          {items.map((i) => (
            <li key={`${i.kind}:${i.ref}`}>
              <Link href={link(i)} className="flex items-center justify-between gap-4 px-4 py-3.5 hover:bg-cloud focus-visible:outline-2 focus-visible:outline-orange sm:px-5">
                <span><span className="block font-semibold">{i.kind === "SERVICE" && i.serviceType ? t(`services.types.${i.serviceType}`) : <Auto>{i.title}</Auto>}</span><span className="text-xs text-steel">{t(`track.kinds.${i.kind}`)}{sep}<Ltr className="font-mono">{i.ref}</Ltr>{sep}{date(i.updatedAt, { dateOnly: true })}</span></span>
                <span className="rounded-full border border-navy-900/30 bg-cloud px-3 py-1 text-xs font-semibold text-navy-900">{label(i)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Signed out (spec §4.5): reference + phone → a code to that phone → the status timeline only. Never says whether they matched. */
function Lookup() {
  const { t, date } = useI18n()
  const [ref, setRef] = useState("")
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<"form" | "code" | "done">("form")
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<PublicTrackView | null>(null)
  const message = (e: unknown) => {
    const c = e instanceof ApiError ? e.code : ""
    return c === "RATE_LIMITED" ? t("track.rateLimited") : c === "OTP_INVALID" ? t("track.otpInvalid") : c === "OTP_EXPIRED" ? t("track.otpExpired") : c === "OTP_LOCKED" ? t("track.otpLocked") : e instanceof Error ? e.message : String(e)
  }
  const lookup = async () => {
    setErr(null); setBusy("send")
    const body = { ref: ref.trim().toUpperCase(), phone: phone.trim(), deviceId: deviceId() }
    try {
      try { await api("/v1/track/lookup", { body }) } catch (e) {
        if (!(e instanceof ApiError && e.code === "CHALLENGE_REQUIRED")) throw e
        setBusy("pow")
        await api("/v1/track/lookup", { body: { ...body, challenge: await solvePow(e.problem.challenge as PowChallenge) } })
      }
      setStage("code")
    } catch (e) { setErr(message(e)) } finally { setBusy(null) }
  }
  const verify = async () => {
    setErr(null); setBusy("verify")
    try {
      setView(await api<PublicTrackView>("/v1/track/verify", { body: { ref: ref.trim().toUpperCase(), phone: phone.trim(), code, deviceId: deviceId() } }))
      setStage("done")
    } catch (e) { setErr(message(e)) } finally { setBusy(null) }
  }
  const statusLabel = (s: string) => (view?.kind === "SERVICE" ? t(`services.status.${s}` as MessageKey) : s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()))
  return (
    <section aria-labelledby="lookup-h" className="card-brand p-5 md:p-6">
      <h2 id="lookup-h" className="font-display text-2xl">{t("track.lookupTitle")}</h2>
      <p className="mt-2 text-sm leading-6 text-steel">{t("track.lookupLead")}</p>
      {stage !== "done" && (
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void (stage === "form" ? lookup() : verify()) }}>
          <label className="text-sm font-medium">{t("track.ref")}<input className="field mt-1 h-10 w-full font-mono" dir="ltr" placeholder={t("track.refHint")} value={ref} onChange={(e) => setRef(e.target.value)} disabled={stage === "code"} required minLength={6} /></label>
          <label className="text-sm font-medium">{t("track.phone")}<input className="field mt-1 h-10 w-full" dir="ltr" type="tel" inputMode="tel" autoComplete="tel" placeholder="+98 912 …" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={stage === "code"} required minLength={6} /></label>
          {stage === "code" && (
            <>
              <p role="status" className="sm:col-span-2 rounded-xl bg-cloud px-4 py-2.5 text-sm">{t("track.sent")}</p>
              <label className="text-sm font-medium">{t("track.code")}<input className="field mt-1 h-10 w-full font-mono tracking-[0.4em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></label>
            </>
          )}
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-orange" disabled={!!busy || (stage === "code" && code.length !== 6)}>{stage === "form" ? t("track.sendCode") : t("track.verify")}</button>
            {busy === "pow" && <span role="status" className="text-sm text-steel">{t("track.checking")}</span>}
          </div>
          {err && <p role="alert" className="sm:col-span-2 text-sm text-danger">{err}</p>}
        </form>
      )}
      {stage === "done" && view && (
        <div className="mt-4" data-testid="track-result">
          <h3 className="font-semibold">{t("track.result", { ref: view.ref })}</h3>
          <div className="mt-3"><Timeline live items={view.timeline.map((x, i) => ({ id: String(i), title: statusLabel(x.status), meta: date(x.at, { withTime: true }) }))} /></div>
          <button type="button" className="mt-4 text-sm font-semibold text-royal underline underline-offset-4" onClick={() => { setStage("form"); setView(null); setCode("") }}>{t("track.again")}</button>
        </div>
      )}
    </section>
  )
}

export default function TrackPage() {
  const { t } = useI18n()
  const { me, loading } = useSession()
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-4 py-8 md:py-10">
      <h1 className="font-display text-3xl md:text-4xl">{t("track.title")}</h1>
      {!loading && me && <Mine />}
      <Lookup />
    </div>
  )
}
