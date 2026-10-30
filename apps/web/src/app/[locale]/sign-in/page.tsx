"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { Logo } from "@unitravel/ui/brand/logo"
import { Input } from "@unitravel/ui/components/input"
import { DevCode, otpFromSink } from "@unitravel/ui/product/dev-code"
import { TestSignIn } from "@unitravel/ui/product/test-sign-in"

import { HeroVideo } from "@/components/hero-video"
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
  const [value, setValue] = useState("")
  const [step, setStep] = useState<Step>("identity")
  const [challenge, setChallenge] = useState<{ challengeId: string; normalised: string; resendAfterSeconds: number; voiceAvailable: boolean } | null>(null)
  const [sentAt, setSentAt] = useState(0)
  const [code, setCode] = useState("")
  const [wait, setWait] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pow, setPow] = useState<number | null>(null)
  // The media panel is hidden below md; do not download its poster and video on phones.
  const [wide, setWide] = useState(false)
  useEffect(() => setWide(window.matchMedia("(min-width: 768px)").matches), [])
  const [profile, setProfile] = useState({ givenNamesLatin: "", surnameLatin: "", nameFa: "" })
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const send = async () => {
    setErr(null); setBusy(true)
    const body = { channel: "EMAIL", value, deviceId: deviceId(), client: "WEB" }
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
      setChallenge(r); setSentAt(Date.now()); setWait(r!.resendAfterSeconds); setStep("code")
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
    <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
      <div className="card-brand grid overflow-hidden md:min-h-[600px] md:grid-cols-[1fr_1.05fr]">
        <div className="relative hidden overflow-hidden bg-navy-950 md:block">
          {wide && <HeroVideo name="signin" />}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-navy-950/85 via-navy-900/60 to-navy-950/90" />
          <div className="relative flex h-full flex-col items-center justify-between p-10 text-center text-white">
            <Logo variant="stacked" tone="onDark" size={64} />
            <p className="max-w-xs text-lg font-semibold leading-relaxed">{t("brand.tagline")}</p>
          </div>
        </div>
        <div>
          <div className="bg-brand px-6 py-3 md:hidden">
            <p className="text-sm font-semibold text-white">{t("brand.tagline")}</p>
          </div>
          <div className="p-6 sm:p-10">
        <h1 className="font-display text-3xl md:text-4xl">{step === "profile" ? t("auth.nameTitle") : t("auth.title")}</h1>
        <p className="mt-3 text-steel">{t("auth.noPassword")}</p>
        <p className="mt-1 text-sm text-steel" data-testid="remember-note">{t("auth.remember")}</p>
        {step === "identity" && (
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <label className="block text-sm font-medium">{t("auth.email")}
              <Input className="mt-1.5 h-12 rounded-xl bg-cloud text-base placeholder:text-sm" dir="ltr" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={value} onChange={(e) => setValue(e.target.value)} required />
            </label>
            <button type="submit" className="btn-orange h-12 w-full" disabled={busy || !value}>{pow !== null ? `${t("auth.checking")} ${Math.round(pow * 100)}%` : t("auth.sendCode")}</button>
          </form>
        )}
        {step === "identity" && (
          <TestSignIn<{ needsProfile: boolean }> client="WEB" deviceId={deviceId()} suggestions={["neda@student.example"]} api={api}
            labels={{ title: t("auth.test.title"), hint: t("auth.test.hint"), email: t("auth.test.email"), submit: t("auth.test.submit"), busy: t("auth.test.busy"), error: t("auth.test.error") }}
            onSignedIn={async (r) => { await qc.invalidateQueries({ queryKey: ["me"] }); if (r.needsProfile) setStep("profile"); else router.replace(next) }} />
        )}
        {step === "code" && challenge && (
          <form className="mt-6 space-y-4" onSubmit={verify}>
            <label className="block text-sm">{t("auth.code", { to: challenge.normalised })}
              <Input className="mt-2 h-14 rounded-xl bg-cloud text-center font-mono text-2xl tracking-[0.5em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9۰-۹]/g, ""))} autoFocus required />
            </label>
            <button type="submit" className="btn-orange h-12 w-full" disabled={busy || code.length < 6}>{t("auth.verify")}</button>
            <div className="flex items-center justify-between text-sm">
              {wait > 0 ? <span className="text-steel">{t("auth.resendIn", { s: wait })}</span> : <button type="button" className="font-semibold text-orange-700 underline underline-offset-4" onClick={() => void send()}>{t("auth.resend")}</button>}
            </div>
            <DevCode key={sentAt} load={async () => otpFromSink(await api("/v1/dev-sink/email"), challenge.normalised, sentAt)} onCode={setCode} title={t("auth.dev.title")} waiting={t("auth.dev.waiting")} refill={t("auth.dev.refill")} />
          </form>
        )}
        {step === "profile" && (
          <form className="mt-6 space-y-4" onSubmit={saveProfile}>
            <label className="block text-sm font-medium">{t("auth.given")}<Input className="mt-1.5 h-12 rounded-xl bg-cloud" dir="ltr" value={profile.givenNamesLatin} onChange={(e) => setProfile({ ...profile, givenNamesLatin: e.target.value })} required pattern="[A-Za-z][A-Za-z '\-]*" /></label>
            <label className="block text-sm font-medium">{t("auth.surname")}<Input className="mt-1.5 h-12 rounded-xl bg-cloud" dir="ltr" value={profile.surnameLatin} onChange={(e) => setProfile({ ...profile, surnameLatin: e.target.value })} required pattern="[A-Za-z][A-Za-z '\-]*" /></label>
            <label className="block text-sm font-medium">{t("auth.nameFa")}<Input className="mt-1.5 h-12 rounded-xl bg-cloud" dir="rtl" value={profile.nameFa} onChange={(e) => setProfile({ ...profile, nameFa: e.target.value })} /></label>
            <button type="submit" className="btn-orange h-12 w-full" disabled={busy}>{t("auth.save")}</button>
          </form>
        )}
        {err && <p role="alert" className="mt-4 rounded-xl bg-danger-subtle px-4 py-3 text-sm text-danger">{err}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SignInPage() {
  return <Suspense><SignIn /></Suspense>
}
