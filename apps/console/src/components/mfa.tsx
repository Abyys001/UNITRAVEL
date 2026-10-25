"use client"

import { KeyRound } from "lucide-react"
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@unitravel/ui/components/dialog"

import { api, errText, setStepUpHandler } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { useSession } from "@/lib/session"
import { createPasskey, getPasskey, webauthnSupported } from "@/lib/webauthn"

/** Six-digit authenticator code entry; also the step-up path (a fresh verification refreshes the window). */
export function TotpVerify({ onDone, submitLabel, passkey = false, prefill }: { onDone: () => void | Promise<void>; submitLabel?: string; passkey?: boolean; prefill?: string }) {
  const t = useT()
  const [code, setCode] = useState("")
  useEffect(() => { if (prefill) setCode(prefill) }, [prefill])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { await api("/v1/auth/mfa/totp/verify", { body: { type: "TOTP", code } }); await onDone() } catch (e2) { setErr(errText(e2)); setCode("") } finally { setBusy(false) }
  }
  const withPasskey = async () => {
    setErr(null); setBusy(true)
    try {
      const opts = await api<Record<string, unknown>>("/v1/auth/mfa/webauthn/authentication-options", { body: {} })
      await api("/v1/auth/mfa/webauthn/authenticate", { body: { response: await getPasskey(opts) } })
      await onDone()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="cap">{t("mfa.code")}</span>
        <input name="totp" className="field-input mt-1 h-11 text-center font-mono text-xl tracking-[0.5em]" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus required aria-describedby={err ? "totp-err" : undefined} />
      </label>
      <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>{submitLabel ?? t("mfa.verify")}</Button>
      {passkey && webauthnSupported() && <Button type="button" variant="outline" className="w-full" onClick={() => void withPasskey()} disabled={busy}><KeyRound /> {t("mfa.passkey")}</Button>}
      {err && <p id="totp-err" role="alert" className="rounded-sm bg-danger-subtle px-3 py-2 text-danger">{err}</p>}
    </form>
  )
}

/** First sign-in: create the TOTP factor, show the secret once, confirm with a code. */
export function TotpEnrol({ onDone, prefill }: { onDone: () => void | Promise<void>; prefill?: string }) {
  const t = useT()
  const [enrol, setEnrol] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    api<{ secret: string; otpauthUrl: string }>("/v1/auth/mfa/totp/enrol", { body: {} }).then(setEnrol, (e) => setErr(errText(e)))
  }, [])
  if (err) return <p role="alert" className="rounded-sm bg-danger-subtle px-3 py-2 text-danger">{err}</p>
  if (!enrol) return <p className="text-steel">{t("mfa.preparing")}</p>
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 ps-5 text-steel">
        <li>{t("mfa.step1")}</li>
        <li>{t("mfa.step2")}</li>
      </ol>
      <div className="rounded-lg border border-rule bg-surface-sunk p-3">
        <p className="cap">{t("mfa.secret")}</p>
        <p className="mt-1 break-all font-mono text-base tracking-wider" dir="ltr" data-testid="totp-secret">{enrol.secret.match(/.{1,4}/g)?.join(" ")}</p>
        <a className="mt-2 inline-block text-orange-700 underline underline-offset-4" href={enrol.otpauthUrl}>{t("mfa.open")}</a>
      </div>
      <TotpVerify onDone={onDone} submitLabel={t("mfa.confirmContinue")} prefill={prefill} />
    </div>
  )
}

/** Adds a passkey to the account (preferred second factor, ch. 16.1). */
export function AddPasskey() {
  const t = useT()
  const [state, setState] = useState<string | null>(null)
  if (!webauthnSupported()) return null
  const add = async () => {
    try {
      const opts = await api<Record<string, unknown>>("/v1/auth/mfa/webauthn/registration-options", { body: {} })
      await api("/v1/auth/mfa/webauthn/register", { body: { response: await createPasskey(opts) } })
      setState(t("mfa.added"))
    } catch (e) { setState(errText(e)) }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button size="xs" variant="outline" onClick={() => void add()}><KeyRound /> {t("mfa.add")}</Button>
      {state && <span role="status" className="text-steel">{state}</span>}
    </span>
  )
}

const StepUpCtx = createContext<{ request: (reason: string) => Promise<boolean> }>({ request: async () => false })
export const useStepUp = () => useContext(StepUpCtx)

/**
 * Sensitive endpoints answer STEP_UP_REQUIRED when the last second-factor check is older than the window; the API
 * client calls this prompt and retries the original request once it succeeds.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const { me, reload } = useSession()
  const t = useT()
  const [pending, setPending] = useState<{ reason: string; resolve: (ok: boolean) => void } | null>(null)
  const request = useCallback((reason: string) => new Promise<boolean>((resolve) => setPending({ reason, resolve })), [])
  useEffect(() => { setStepUpHandler(request); return () => setStepUpHandler(null) }, [request])
  const close = (ok: boolean) => { pending?.resolve(ok); setPending(null) }
  return (
    <StepUpCtx.Provider value={{ request }}>
      {children}
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) close(false) }}>
        <DialogContent className="max-w-sm" data-testid="step-up">
          <DialogHeader>
            <DialogTitle>{t("mfa.confirmTitle")}</DialogTitle>
            <DialogDescription>{pending?.reason ?? t("mfa.confirmBody")}</DialogDescription>
          </DialogHeader>
          {pending && <TotpVerify passkey={!!me?.mfa.enrolled.includes("WEBAUTHN")} submitLabel={t("mfa.confirm")} onDone={async () => { await reload(); close(true) }} />}
        </DialogContent>
      </Dialog>
    </StepUpCtx.Provider>
  )
}
