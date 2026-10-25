"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Activity, Inbox, Package, ScrollText, Settings2, ShieldCheck } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { FlightPath, GlobeLines } from "@unitravel/ui/brand/art"
import { Logo } from "@unitravel/ui/brand/logo"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"
import { DevCode, otpFromSink } from "@unitravel/ui/product/dev-code"

import { api, ApiError, errText } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { type MsgKey, useT } from "@/lib/i18n"
import { type PowChallenge, solvePow } from "@/lib/pow"
import type { Surface } from "@/lib/session"

import { Brand } from "./shell"
import { TotpEnrol, TotpVerify } from "./mfa"

type Step = "phone" | "code" | "mfa-enrol" | "mfa-verify"
interface Challenge { challengeId: string; normalised: string; resendAfterSeconds: number }

/** Staff sign-in (ch. 16.1): phone OTP, then a mandatory second factor — TOTP enrolment on first use. */
function SignInInner({ surface }: { surface: Surface }) {
  const router = useRouter()
  const raw = useSearchParams().get("next")
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/"
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>("phone")
  const [email, setEmail] = useState("")
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState("")
  const [sentAt, setSentAt] = useState(0)
  const [totp, setTotp] = useState<string | undefined>()
  const [wait, setWait] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pow, setPow] = useState<number | null>(null)
  const t = useT()
  // The other panel lives on its sibling host (admin.* ↔ dev.*, ch. 29.2); known only in the browser.
  const [other, setOther] = useState<string | null>(null)
  useEffect(() => {
    const { protocol, host } = window.location
    const swapped = host.replace(/^(admin|dev)\./, (_, h: string) => (h === "admin" ? "dev." : "admin."))
    if (swapped !== host) setOther(`${protocol}//${swapped}/sign-in`)
  }, [])
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const send = async () => {
    setErr(null); setBusy(true)
    const body = { channel: "EMAIL", value: email, deviceId: deviceId(), client: "CONSOLE" }
    try {
      let r: Challenge
      try { r = await api<Challenge>("/v1/auth/otp/request", { body }) } catch (e) {
        // After several sends from one network the API asks for a proof-of-work check (ch. 25.1).
        if (e instanceof ApiError && e.code === "CHALLENGE_REQUIRED") {
          setPow(0)
          const solved = await solvePow(e.problem.challenge as PowChallenge, setPow)
          setPow(null)
          r = await api<Challenge>("/v1/auth/otp/request", { body: { ...body, challenge: solved } })
        } else throw e
      }
      setChallenge(r); setSentAt(Date.now()); setWait(r.resendAfterSeconds); setStep("code"); setCode("")
    } catch (e) { setErr(errText(e)) } finally { setBusy(false); setPow(null) }
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api<{ mfaRequired: boolean; mfaEnrolmentRequired: boolean }>("/v1/auth/otp/verify", { body: { challengeId: challenge!.challengeId, code, deviceId: deviceId(), client: "CONSOLE" } })
      if (r.mfaEnrolmentRequired) setStep("mfa-enrol")
      else if (r.mfaRequired) setStep("mfa-verify")
      else await finish()
    } catch (e2) {
      // The API refuses non-staff phones at this step; say so plainly instead of echoing a generic permission error.
      setErr(e2 instanceof ApiError && (e2.problem.status === 403 || ["NOT_STAFF", "NO_STAFF_ACCESS", "STAFF_ONLY", "FORBIDDEN"].includes(e2.code)) ? t("signin.noStaff") : errText(e2))
    } finally { setBusy(false) }
  }
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] })
    router.replace(next)
  }

  const steps: { id: Step[]; label: MsgKey }[] = [
    { id: ["phone"], label: "signin.step.email" }, { id: ["code"], label: "signin.step.code" }, { id: ["mfa-enrol", "mfa-verify"], label: "signin.step.mfa" },
  ]
  const at = steps.findIndex((s) => s.id.includes(step))
  const points = surface === "dev"
    ? [{ icon: <Settings2 />, text: t("signin.dev.p1") }, { icon: <ScrollText />, text: t("signin.dev.p2") }, { icon: <Activity />, text: t("signin.dev.p3") }]
    : [{ icon: <Inbox />, text: t("signin.admin.p1") }, { icon: <ShieldCheck />, text: t("signin.admin.p2") }, { icon: <Package />, text: t("signin.admin.p3") }]

  return (
    <main className="grid min-h-dvh md:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      <section className="bg-brand relative hidden flex-col overflow-hidden px-12 py-10 text-white md:flex lg:px-16" aria-hidden>
        {surface === "dev" && <div className="workshop-strip absolute inset-x-0 top-0 h-1.5" />}
        <GlobeLines className="absolute -bottom-32 -end-32 w-[420px] text-white/10" />
        <Logo variant="horizontal" tone="onDark" size={30} />
        <div className="relative my-auto py-10">
          <p className="cap text-orange-300">{t(surface === "dev" ? "signin.dev.kicker" : "signin.admin.kicker")}</p>
          <p className="mt-3 max-w-lg font-display text-[2.1rem] leading-tight">{t(surface === "dev" ? "signin.dev.tagline" : "signin.admin.tagline")}</p>
          <FlightPath className="mt-10 w-full max-w-xl opacity-90 rtl:-scale-x-100" />
          <ul className="mt-10 grid max-w-lg gap-3">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-white/85">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-orange/70 bg-white/5 [&>svg]:size-4">{p.icon}</span>{p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/55">{t("signin.audited")}</p>
      </section>

      <section className="flex flex-col bg-surface-raised px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between gap-4">
          <span className="md:invisible"><span className="sm:hidden"><Brand surface={surface} compact /></span><span className="hidden sm:inline"><Brand surface={surface} tone="onLight" /></span></span>
          <nav aria-label={t("signin.panels")} className="inline-flex shrink-0 rounded-full border border-rule bg-surface p-1 text-sm whitespace-nowrap">
            {(["admin", "dev"] as const).map((s) => s === surface
              ? <span key={s} aria-current="page" className="inline-flex min-h-9 items-center rounded-full bg-navy-950 px-3.5 py-1.5 font-medium text-white dark:bg-white dark:text-navy-950"><span className="sm:hidden">{t(s === "dev" ? "signin.panel.devShort" : "signin.panel.adminShort")}</span><span className="hidden sm:inline">{t(s === "dev" ? "signin.panel.dev" : "signin.panel.admin")}</span></span>
              : <a key={s} href={other ?? undefined} aria-disabled={!other} className="inline-flex min-h-9 items-center rounded-full px-3.5 py-1.5 text-steel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"><span className="sm:hidden">{t(s === "dev" ? "signin.panel.devShort" : "signin.panel.adminShort")}</span><span className="hidden sm:inline">{t(s === "dev" ? "signin.panel.dev" : "signin.panel.admin")}</span></a>)}
          </nav>
        </div>

        <div className="mx-auto my-auto w-full max-w-sm py-10">
          <h1 className="font-display text-3xl">{t(step.startsWith("mfa") ? "signin.title.mfa" : surface === "dev" ? "signin.title.dev" : "signin.title.admin")}</h1>
          <p className="mt-2 text-steel">{t(step === "mfa-enrol" ? "signin.lede.enrol" : step === "mfa-verify" ? "signin.lede.verify" : step === "code" ? "signin.lede.code" : "signin.lede.email")}</p>
          <ol className="mt-6 flex items-center gap-2 text-xs" aria-label={t("signin.progress")}>
            {steps.map((s, i) => (
              <li key={s.label} aria-current={i === at ? "step" : undefined} className={cn("flex flex-1 flex-col gap-1.5", i <= at ? "text-ink" : "text-steel")}>
                <span className={cn("h-1 rounded-full", i < at ? "bg-navy-950 dark:bg-white" : i === at ? "bg-orange" : "bg-rule")} />
                <span><span className="num">{i + 1}</span> · {t(s.label)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            {step === "phone" && (
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void send() }}>
                <label className="block"><span className="cap">{t("signin.email")}</span>
                  <input name="email" type="email" className="field-input mt-1 h-11 text-base" dir="ltr" inputMode="email" autoComplete="email" placeholder="you@unitravel.example" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </label>
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!email}>{pow !== null ? t("signin.pow", { n: Math.round(pow * 100) }) : t("signin.send")}</Button>
              </form>
            )}
            {step === "code" && challenge && (
              <form className="space-y-4" onSubmit={verify}>
                <label className="block"><span className="cap">{t("signin.codeTo")} <span className="ltr normal-case">{challenge.normalised}</span></span>
                  <input name="otp" className="field-input mt-1 h-12 text-center font-mono text-xl tracking-[0.5em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
                </label>
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length < 6}>{t("signin.verify")}</Button>
                <div className="flex justify-between text-steel">
                  <button type="button" className="underline underline-offset-4 hover:text-ink" onClick={() => { setStep("phone"); setErr(null) }}>{t("signin.change")}</button>
                  {wait > 0 ? <span className="num">{t("signin.resendIn", { n: wait })}</span> : <button type="button" className="text-orange-700 underline underline-offset-4 dark:text-orange-300" onClick={() => void send()}>{t("signin.resend")}</button>}
                </div>
              </form>
            )}
            {step === "code" && challenge && <DevCode key={sentAt} load={async () => otpFromSink(await api("/v1/dev-sink/email"), challenge.normalised, sentAt)} onCode={setCode} title={t("signin.dev.email")} waiting={t("signin.dev.waiting")} refill={t("signin.dev.refill")} />}
            {step === "mfa-enrol" && <TotpEnrol onDone={finish} prefill={totp} />}
            {step === "mfa-verify" && <TotpVerify onDone={finish} passkey prefill={totp} />}
            {step.startsWith("mfa") && <DevCode key={step} load={async () => (await api<{ code: string | null }>("/v1/auth/dev-sink/totp")).code} onCode={setTotp} title={t("signin.dev.totp")} waiting={t("signin.dev.waiting")} refill={t("signin.dev.refill")} />}
            {err && <p role="alert" className="mt-3 rounded-sm border border-danger/30 bg-danger-subtle px-3 py-2 text-danger">{err}</p>}
          </div>
        </div>

        <p className="mx-auto w-full max-w-sm text-xs text-steel">{t("signin.session")} <span className="md:hidden">{t("signin.audited")}</span></p>
      </section>
    </main>
  )
}

export function SignIn({ surface }: { surface: Surface }) {
  return <Suspense><SignInInner surface={surface} /></Suspense>
}
