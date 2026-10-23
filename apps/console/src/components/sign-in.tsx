"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { api, ApiError, errText } from "@/lib/api"
import { deviceId } from "@/lib/device"
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
  const [phone, setPhone] = useState("")
  const [challenge, setChallenge] = useState<Challenge | null>(null)
  const [code, setCode] = useState("")
  const [wait, setWait] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pow, setPow] = useState<number | null>(null)
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id) }, [wait])

  const send = async () => {
    setErr(null); setBusy(true)
    const body = { channel: "PHONE", value: phone, deviceId: deviceId(), client: "CONSOLE" }
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
      setChallenge(r); setWait(r.resendAfterSeconds); setStep("code"); setCode("")
    } catch (e) { setErr(errText(e)) } finally { setBusy(false); setPow(null) }
  }
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const r = await api<{ mfaRequired: boolean; mfaEnrolmentRequired: boolean }>("/v1/auth/otp/verify", { body: { challengeId: challenge!.challengeId, code, deviceId: deviceId(), client: "CONSOLE" } })
      if (r.mfaEnrolmentRequired) setStep("mfa-enrol")
      else if (r.mfaRequired) setStep("mfa-verify")
      else await finish()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] })
    router.replace(next)
  }

  return (
    <main className="grid min-h-dvh md:grid-cols-[1fr_minmax(380px,460px)]">
      <section className="relative hidden overflow-hidden bg-ink text-paper md:block" aria-hidden>
        {surface === "dev" && <div className="workshop-strip absolute inset-x-0 top-0 h-2" />}
        <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full opacity-60">
          {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M ${40 + i * 30} 520 C ${160 + i * 40} ${120 - i * 10}, ${380 + i * 20} ${90 + i * 12}, ${560 - i * 10} ${260 + i * 24}`} stroke={i % 2 ? "#5b6573" : "#c98d5b"} strokeWidth={i % 2 ? 0.8 : 1.4} fill="none" />)}
        </svg>
        <div className="absolute bottom-10 start-10 max-w-md">
          <p className="cap text-copper">{surface === "dev" ? "Developer Panel · workshop" : "Admin Panel"}</p>
          <p className="mt-3 font-display text-4xl leading-tight">{surface === "dev" ? "Every change versioned, validated and audited." : "Requests become reservations, tickets and shipments here."}</p>
        </div>
      </section>
      <section className="flex flex-col justify-center bg-paper px-8 py-12">
        <Brand surface={surface} />
        <h1 className="mt-8 font-display text-2xl">{step.startsWith("mfa") ? "Second factor" : "Staff sign-in"}</h1>
        <p className="mt-1 text-slate">{step === "mfa-enrol" ? "Staff accounts need an authenticator app. Set it up once." : step === "mfa-verify" ? "Enter the code from your authenticator app." : "One-time code to your work phone. No passwords."}</p>
        <div className="mt-6">
          {step === "phone" && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
              <label className="block"><span className="cap">Phone</span>
                <input name="phone" className="field-input mt-1 h-10 text-base" dir="ltr" inputMode="tel" autoComplete="tel" placeholder="+44 7700 900123" value={phone} onChange={(e) => setPhone(e.target.value)} required autoFocus />
              </label>
              <Button type="submit" className="w-full" loading={busy} disabled={!phone}>{pow !== null ? `Checking this browser ${Math.round(pow * 100)}%` : "Send code"}</Button>
            </form>
          )}
          {step === "code" && challenge && (
            <form className="space-y-3" onSubmit={verify}>
              <label className="block"><span className="cap">Code sent to <span className="ltr normal-case">{challenge.normalised}</span></span>
                <input name="otp" className="field-input mt-1 h-11 text-center font-mono text-xl tracking-[0.5em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required />
              </label>
              <Button type="submit" className="w-full" loading={busy} disabled={code.length < 6}>Verify</Button>
              <div className="flex justify-between text-slate">
                <button type="button" className="underline underline-offset-4" onClick={() => { setStep("phone"); setErr(null) }}>Change number</button>
                {wait > 0 ? <span className="num">Resend in {wait}s</span> : <button type="button" className="text-copper-700 underline underline-offset-4" onClick={() => void send()}>Resend code</button>}
              </div>
            </form>
          )}
          {step === "mfa-enrol" && <TotpEnrol onDone={finish} />}
          {step === "mfa-verify" && <TotpVerify onDone={finish} passkey />}
          {err && <p role="alert" className="mt-3 rounded-sm bg-[#fbeee9] px-3 py-2 text-brick">{err}</p>}
        </div>
        <p className="mt-10 text-[11px] text-slate">Sessions end after 30 minutes idle and 12 hours in total. Every action here is audited.</p>
      </section>
    </main>
  )
}

export function SignIn({ surface }: { surface: Surface }) {
  return <Suspense><SignInInner surface={surface} /></Suspense>
}
