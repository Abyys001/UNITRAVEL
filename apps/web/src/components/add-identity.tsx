"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"
import { NativeSelect } from "@unitravel/ui/components/native-select"

import { api, ApiError } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { useI18n } from "@/lib/i18n"
import { type PowChallenge, solvePow } from "@/lib/pow"

type Channel = "PHONE" | "EMAIL"

/** Add and verify another phone or email: POST /v1/me/identities, then the one-time code to /v1/auth/otp/verify (ADR-0005 V11). */
export function AddIdentity({ channels = ["PHONE", "EMAIL"], onDone }: { channels?: Channel[]; onDone?: () => void }) {
  const { t, locale } = useI18n()
  const qc = useQueryClient()
  const [channel, setChannel] = useState<Channel>(channels[0]!)
  const [value, setValue] = useState("")
  const [code, setCode] = useState("")
  const [challenge, setChallenge] = useState<{ challengeId: string; normalised: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    const body = { type: channel, value, deviceId: deviceId(), defaultCountry: channel === "PHONE" && locale === "fa" ? "IR" : undefined }
    try {
      let r
      try { r = await api<{ challengeId: string; normalised: string }>("/v1/me/identities", { body }) } catch (x) {
        if (x instanceof ApiError && x.code === "CHALLENGE_REQUIRED") r = await api<{ challengeId: string; normalised: string }>("/v1/me/identities", { body: { ...body, challenge: await solvePow(x.problem.challenge as PowChallenge) } })
        else throw x
      }
      setChallenge(r)
    } catch (x) { setErr(x instanceof ApiError ? x.problem.detail ?? x.problem.title : String(x)) } finally { setBusy(false) }
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      await api("/v1/auth/otp/verify", { body: { challengeId: challenge!.challengeId, code, deviceId: deviceId(), client: "WEB" } })
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["details"] })])
      setChallenge(null); setValue(""); setCode("")
      onDone?.()
    } catch (x) { setErr(x instanceof ApiError ? x.problem.title : String(x)) } finally { setBusy(false) }
  }

  if (challenge) {
    return (
      <form onSubmit={verify} className="flex flex-wrap items-end gap-2" aria-label={t("identity.verify")}>
        <p className="w-full text-sm text-steel" dir="auto">{t("identity.codeSent", { value: challenge.normalised })}</p>
        <label className="text-sm">{t("identity.code")}<Input className="mt-1 h-10 w-36" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <Button type="submit" disabled={busy}>{t("identity.verify")}</Button>
        {err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}
      </form>
    )
  }
  return (
    <form onSubmit={send} className="flex flex-wrap items-end gap-2" aria-label={t("identity.addContact")}>
      {channels.length > 1 && <label className="text-sm">{t("identity.addContact")}<NativeSelect className="field mt-1 h-10 w-full" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>{channels.map((c) => <option key={c} value={c}>{t(c === "PHONE" ? "identity.phone" : "identity.email")}</option>)}</NativeSelect></label>}
      <label className="text-sm">{channels.length === 1 ? t(channel === "PHONE" ? "identity.phone" : "identity.email") : " "}<Input className="mt-1 h-10 w-64" dir="ltr" type={channel === "EMAIL" ? "email" : "tel"} required value={value} onChange={(e) => setValue(e.target.value)} placeholder={t(channel === "PHONE" ? "identity.valuePlaceholderPhone" : "identity.valuePlaceholderEmail")} /></label>
      <Button type="submit" disabled={busy}>{t("identity.sendCode")}</Button>
      {err && <p role="alert" className="w-full text-sm text-danger">{err}</p>}
    </form>
  )
}
