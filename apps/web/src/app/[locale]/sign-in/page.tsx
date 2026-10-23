"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Input } from "@unitravel/ui/components/input"

import { api, ApiError } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { useI18n } from "@/lib/i18n"
import { type PowChallenge, solvePow } from "@/lib/pow"

type Step = "identity" | "code" | "profile"

function SignIn() {
  const { t, href, locale } = useI18n()
  const router = useRouter()
  const next = useSearchParams().get("next") || href("/requests")
  const qc = useQueryClient()
  const [channel, setChannel] = useState<"PHONE" | "EMAIL">("PHONE")
  const [value, setValue] = useState("")
  const [step, setStep] = useState<Step>("identity")
  const [challenge, setChallenge] = useState<{ challengeId: string; normalised: string; resendAfterSeconds: number; voiceAvailable: boolean } | null>(null)
  const [code, setCode] = useState("")
  const [wait, setWait] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pow, setPow] = useState<number | null>(null)
  const [profile, setProfile] = useState({ givenNamesLatin: "", surnameLatin: "", nameFa: "" })
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const send = async (voice = false) => {
    setErr(null); setBusy(true)
    const body = { channel, value, deviceId: deviceId(), client: "WEB", voice, defaultCountry: locale === "fa" ? "IR" : undefined }
    try {
      let r
      try { r = await api<typeof challenge & object>("/v1/auth/otp/request", { body }) } catch (e) {
        // After several sends from one network the server asks for a proof-of-work check (ch. 25.1).
        if (e instanceof ApiError && e.code === "CHALLENGE_REQUIRED") {
          setPow(0)
          const solved = await solvePow(e.problem.challenge as PowChallenge, setPow)
          setPow(null)
          r = await api<typeof challenge & object>("/v1/auth/otp/request", { body: { ...body, challenge: solved } })
        } else throw e
      }
      setChallenge(r); setWait(r!.resendAfterSeconds); setStep("code")
    } catch (e) { setErr(e instanceof ApiError ? e.problem.detail ?? e.problem.title : String(e)) } finally { setBusy(false) }
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api<{ needsProfile: boolean }>("/v1/auth/otp/verify", { body: { challengeId: challenge!.challengeId, code, deviceId: deviceId(), client: "WEB" } })
      await qc.invalidateQueries({ queryKey: ["me"] })
      if (r.needsProfile) setStep("profile"); else router.replace(next)
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.title : String(e2)) } finally { setBusy(false) }
  }
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true)
    try {
      await api("/v1/me", { method: "PATCH", body: { givenNamesLatin: profile.givenNamesLatin, surnameLatin: profile.surnameLatin, nameFa: profile.nameFa || null, preferredLocale: locale } })
      await qc.invalidateQueries({ queryKey: ["me"] })
      router.replace(next)
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.problem.detail ?? e2.problem.title : String(e2)) } finally { setBusy(false) }
  }
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-display text-3xl">{step === "profile" ? t("auth.nameTitle") : t("auth.title")}</h1>
      <p className="mt-2 text-sm text-slate">{t("auth.noPassword")}</p>
      {step === "identity" && (
        <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <label className="block text-sm font-medium">{t(channel === "PHONE" ? "auth.phone" : "auth.email")}
            <Input className="mt-1 h-11 text-base" dir="ltr" inputMode={channel === "PHONE" ? "tel" : "email"} autoComplete={channel === "PHONE" ? "tel" : "email"} placeholder={channel === "PHONE" ? "0912 345 6789 · +44 7700 900123" : "you@example.com"} value={value} onChange={(e) => setValue(e.target.value)} required />
          </label>
          <Button type="submit" className="h-11 w-full" disabled={busy || !value}>{pow !== null ? `${t("auth.checking")} ${Math.round(pow * 100)}%` : t("auth.sendCode")}</Button>
          <button type="button" className="text-sm text-copper-700 underline underline-offset-4" onClick={() => { setChannel((c) => (c === "PHONE" ? "EMAIL" : "PHONE")); setValue("") }}>{t(channel === "PHONE" ? "auth.useEmail" : "auth.usePhone")}</button>
        </form>
      )}
      {step === "code" && challenge && (
        <form className="mt-6 space-y-4" onSubmit={verify}>
          <label className="block text-sm">{t("auth.code", { to: challenge.normalised })}
            <Input className="mt-2 h-12 text-center font-mono text-2xl tracking-[0.5em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9۰-۹]/g, ""))} autoFocus required />
          </label>
          <Button type="submit" className="h-11 w-full" disabled={busy || code.length < 6}>{t("auth.verify")}</Button>
          <div className="flex items-center justify-between text-sm">
            {wait > 0 ? <span className="text-slate">{t("auth.resendIn", { s: wait })}</span> : <button type="button" className="text-copper-700 underline" onClick={() => void send()}>{t("auth.resend")}</button>}
            {challenge.voiceAvailable && wait <= 0 && <button type="button" className="text-copper-700 underline" onClick={() => void send(true)}>{t("auth.voice")}</button>}
          </div>
        </form>
      )}
      {step === "profile" && (
        <form className="mt-6 space-y-4" onSubmit={saveProfile}>
          <label className="block text-sm font-medium">{t("auth.given")}<Input className="mt-1 h-11" dir="ltr" value={profile.givenNamesLatin} onChange={(e) => setProfile({ ...profile, givenNamesLatin: e.target.value })} required pattern="[A-Za-z][A-Za-z '\-]*" /></label>
          <label className="block text-sm font-medium">{t("auth.surname")}<Input className="mt-1 h-11" dir="ltr" value={profile.surnameLatin} onChange={(e) => setProfile({ ...profile, surnameLatin: e.target.value })} required pattern="[A-Za-z][A-Za-z '\-]*" /></label>
          <label className="block text-sm font-medium">{t("auth.nameFa")}<Input className="mt-1 h-11" dir="rtl" value={profile.nameFa} onChange={(e) => setProfile({ ...profile, nameFa: e.target.value })} /></label>
          <Button type="submit" className="h-11 w-full" disabled={busy}>{t("auth.save")}</Button>
        </form>
      )}
      {err && <p role="alert" className="mt-4 rounded-md bg-[#fbeee9] px-3 py-2 text-sm text-brick">{err}</p>}
    </div>
  )
}

export default function SignInPage() {
  return <Suspense><SignIn /></Suspense>
}
