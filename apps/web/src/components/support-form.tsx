"use client"

import { CheckCircle2 } from "lucide-react"
import { useState } from "react"

import { SUPPORT_TOPICS, type SupportTopic, type TicketCreated } from "@unitravel/contracts"

import { Ltr } from "@/components/badges"
import { Field, inputCls } from "@/components/service-form"
import { api, ApiError, newIdempotencyKey } from "@/lib/api"
import { deviceId } from "@/lib/device"
import { useI18n } from "@/lib/i18n"
import { type PowChallenge, solvePow } from "@/lib/pow"
import { useSession } from "@/lib/session"

/** Public contact form (POST /v1/support/tickets). Open to everyone; a signed-in customer's ticket joins their account. */
export function SupportForm({ onSent }: { onSent?: () => void }) {
  const { t, locale } = useI18n()
  const { me } = useSession()
  const [f, setF] = useState({ name: "", email: "", phone: "", topic: "BOOKING" as SupportTopic, requestRef: "", message: "" })
  const [key, setKey] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState<"send" | "check" | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [sent, setSent] = useState<TicketCreated | null>(null)
  const name = f.name || me?.displayName || ""
  const hasContact = !!(f.email.trim() || f.phone.trim())
  const valid = name.trim().length >= 2 && f.message.trim().length >= 10 && hasContact

  const submit = async () => {
    setBusy("send"); setErr(null)
    const body = {
      name: name.trim(), topic: f.topic, message: f.message.trim(), locale, deviceId: deviceId(),
      ...(f.email.trim() ? { email: f.email.trim() } : {}), ...(f.phone.trim() ? { phone: f.phone.trim() } : {}), ...(f.requestRef.trim() ? { requestRef: f.requestRef.trim().toUpperCase() } : {}),
    }
    const post = (challenge?: string) => api<TicketCreated>("/v1/support/tickets", { headers: { "idempotency-key": key }, body: challenge ? { ...body, challenge } : body })
    try {
      try { setSent(await post()) } catch (e) {
        if (!(e instanceof ApiError && e.code === "CHALLENGE_REQUIRED")) throw e
        setBusy("check")
        setSent(await post(await solvePow(e.problem.challenge as PowChallenge)))
      }
      onSent?.()
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError({ status: 0, code: "INTERNAL", title: String(e) }))
    } finally { setBusy(null) }
  }

  if (sent) {
    return (
      <div className="card-brand p-6 text-center" role="status" data-testid="support-sent">
        <CheckCircle2 aria-hidden className="mx-auto size-10 text-success" />
        <h2 className="mt-3 font-display text-2xl">{t("support.sentTitle")}</h2>
        <p className="mt-2 text-steel">{t("support.sentBody", { ref: "" })}<Ltr className="font-mono font-bold text-navy-950">{sent.ref}</Ltr></p>
        <button type="button" className="btn-orange mt-5" onClick={() => { setSent(null); setF({ ...f, message: "" }); setKey(newIdempotencyKey()) }}>{t("support.another")}</button>
      </div>
    )
  }
  return (
    <form className="card-brand space-y-4 p-5 md:p-6" noValidate onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void submit() }} data-testid="support-form">
      <div><h2 className="font-display text-2xl">{t("support.formTitle")}</h2><p className="mt-1 text-sm text-steel">{t("support.formLead")}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="sp-name" label={t("support.name")}><input id="sp-name" className={inputCls} dir="auto" maxLength={80} value={name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" required /></Field>
        <Field id="sp-topic" label={t("support.topic")}>
          <select id="sp-topic" data-slot="native-select" className={inputCls} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value as SupportTopic })}>
            {SUPPORT_TOPICS.map((k) => <option key={k} value={k}>{t(`support.topics.${k}`)}</option>)}
          </select>
        </Field>
        <Field id="sp-email" label={t("support.emailField")} optional><input id="sp-email" type="email" className={inputCls} dir="ltr" maxLength={254} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
        <Field id="sp-phone" label={t("support.phoneField")} optional><input id="sp-phone" type="tel" inputMode="tel" className={inputCls} dir="ltr" maxLength={24} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
        <div className="sm:col-span-2"><Field id="sp-ref" label={t("support.requestRef")} optional><input id="sp-ref" className={`${inputCls} font-mono uppercase`} dir="ltr" placeholder="UT-…" maxLength={20} value={f.requestRef} onChange={(e) => setF({ ...f, requestRef: e.target.value })} /></Field></div>
        <div className="sm:col-span-2"><Field id="sp-msg" label={t("support.messageField")}><textarea id="sp-msg" className="field min-h-32 w-full" dir="auto" maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required /></Field></div>
      </div>
      {!hasContact && f.message.length > 0 && <p className="text-sm text-steel">{t("support.needContact")}</p>}
      {err && <div role="alert" className="rounded-xl border-s-4 border-danger bg-danger-subtle px-4 py-3 text-sm"><p className="font-semibold">{err.message}</p>{err.problem.errors?.map((e) => <p key={e.path} dir="auto">{e.path}: {e.message ?? e.code}</p>)}</div>}
      <button type="submit" className="btn-orange" disabled={!valid || !!busy} aria-disabled={!valid || !!busy}>{busy === "check" ? t("support.checking") : busy ? t("support.sending") : t("support.send")}</button>
    </form>
  )
}
