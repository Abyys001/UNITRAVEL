import { Inject, Injectable, Logger } from "@nestjs/common"
import type { Redis } from "ioredis"
import nodemailer, { type Transporter } from "nodemailer"

import { env, isLocal } from "../../core/env"
import { REDIS } from "../../core/infra.module"
import { VendorCredentialsService } from "./vendor-credentials.service"

export interface SmsMessage { to: string; body: string; templateId?: string | null; tokens?: string[]; voice?: boolean; otp?: boolean }
export interface SendResult { provider: string; messageId: string }

export class ChannelError extends Error {
  constructor(message: string, readonly permanent = false) { super(message) }
}

const TIMEOUT_MS = 8000
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await res.text()
  if (!res.ok) throw new ChannelError(`HTTP ${res.status}: ${text.slice(0, 200)}`, res.status >= 400 && res.status < 500 && res.status !== 429)
  return text ? JSON.parse(text) : {}
}

/**
 * SMS providers (ch. 8.1). +98 routes go to Iranian providers (Kavenegar, SMS.ir), never through international ones;
 * other countries go to Sinch or Infobip. Credentials are vendor credentials from the Developer Panel.
 */
@Injectable()
export class SmsProviders {
  private readonly log = new Logger("Sms")

  constructor(private readonly creds: VendorCredentialsService, @Inject(REDIS) private readonly redis: Redis) {}

  async available(provider: string): Promise<boolean> {
    return provider === "console" ? env().APP_ENV !== "production" : !!(await this.creds.get(`sms:${provider}`))
  }

  supportsVoice(provider: string) {
    return provider === "kavenegar"
  }

  async send(provider: string, m: SmsMessage): Promise<SendResult> {
    if (provider === "console") return this.consoleSink(m)
    const c = await this.creds.get(`sms:${provider}`)
    if (!c) throw new ChannelError(`${provider} has no credentials`, true)
    switch (provider) {
      case "kavenegar": {
        // VerifyLookup: pre-approved template + up to three tokens (ch. 8.1); voice call option for OTP.
        const base = `https://api.kavenegar.com/v1/${encodeURIComponent(c.apiKey!)}`
        const url = m.otp && m.templateId
          ? `${base}/verify/lookup.json?receptor=${encodeURIComponent(m.to)}&token=${encodeURIComponent(m.tokens?.[0] ?? "")}&template=${encodeURIComponent(m.templateId)}${m.voice ? "&type=call" : ""}`
          : `${base}/sms/send.json?receptor=${encodeURIComponent(m.to)}&message=${encodeURIComponent(m.body)}${c.sender ? `&sender=${encodeURIComponent(c.sender)}` : ""}`
        const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) })
        const json = (await res.json()) as { return?: { status: number; message: string }; entries?: { messageid: number }[] }
        if (json.return?.status !== 200) throw new ChannelError(`kavenegar ${json.return?.status}: ${json.return?.message}`, (json.return?.status ?? 500) < 500)
        return { provider, messageId: String(json.entries?.[0]?.messageid ?? "") }
      }
      case "smsir": {
        if (m.otp && m.templateId) {
          const json = (await postJson("https://api.sms.ir/v1/send/verify", { mobile: m.to.replace(/^\+98/, "0"), templateId: Number(m.templateId), parameters: [{ name: "CODE", value: (m.tokens?.[0] ?? "").slice(0, 25) }] }, { "x-api-key": c.apiKey! })) as { data?: { messageId?: number } }
          return { provider, messageId: String(json.data?.messageId ?? "") }
        }
        const json = (await postJson("https://api.sms.ir/v1/send/bulk", { lineNumber: Number(c.lineNumber), messageText: m.body, mobiles: [m.to.replace(/^\+98/, "0")] }, { "x-api-key": c.apiKey! })) as { data?: { messageIds?: number[] } }
        return { provider, messageId: String(json.data?.messageIds?.[0] ?? "") }
      }
      case "sinch": {
        const region = c.region ?? "eu"
        const json = (await postJson(`https://${region}.sms.api.sinch.com/xms/v1/${c.servicePlanId}/batches`, { from: c.sender, to: [m.to], body: m.body, delivery_report: "per_recipient" }, { authorization: `Bearer ${c.apiToken}` })) as { id?: string }
        return { provider, messageId: json.id ?? "" }
      }
      case "infobip": {
        const json = (await postJson(`https://${c.baseUrl}/sms/2/text/advanced`, { messages: [{ from: c.sender, destinations: [{ to: m.to.replace(/^\+/, "") }], text: m.body, notifyUrl: `${env().PUBLIC_API_URL}/v1/webhooks/sms/infobip?secret=${encodeURIComponent(c.webhookSecret ?? "")}` }] }, { authorization: `App ${c.apiKey}` })) as { messages?: { messageId: string }[] }
        return { provider, messageId: json.messages?.[0]?.messageId ?? "" }
      }
      default:
        throw new ChannelError(`Unknown SMS provider ${provider}`, true)
    }
  }

  /** Local/staging sink (ch. 30.2 "console SMS sink"): never used in production. */
  private async consoleSink(m: SmsMessage): Promise<SendResult> {
    if (env().APP_ENV === "production") throw new ChannelError("Console sink refused in production", true)
    const id = `console-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    if (isLocal()) await this.redis.lpush("dev:sms", JSON.stringify({ id, to: m.to, body: m.body, at: new Date().toISOString() }))
    await this.redis.ltrim("dev:sms", 0, 199)
    this.log.log({ to: `${m.to.slice(0, 4)}••${m.to.slice(-2)}`, chars: m.body.length }, "SMS (console sink)")
    return { provider: "console", messageId: id }
  }
}

export interface PushMessage { token: string; title: string; body: string; data?: Record<string, unknown>; silent?: boolean }

/** Push via Expo (APNs/FCM) and Pushy (own MQTT gateway, no FCM) — critical messages never depend on push alone. */
@Injectable()
export class PushProviders {
  constructor(private readonly creds: VendorCredentialsService, @Inject(REDIS) private readonly redis: Redis) {}

  async send(provider: "EXPO" | "PUSHY" | "WEBPUSH", m: PushMessage): Promise<SendResult & { invalidToken?: boolean }> {
    if (provider === "EXPO") {
      const c = await this.creds.get("push:expo")
      if (!c && env().APP_ENV !== "production") return this.sink("expo", m)
      const json = (await postJson("https://exp.host/--/api/v2/push/send", m.silent ? { to: m.token, data: m.data, _contentAvailable: true } : { to: m.token, title: m.title, body: m.body, data: m.data, sound: "default" }, c?.accessToken ? { authorization: `Bearer ${c.accessToken}` } : {})) as { data?: { status: string; id?: string; details?: { error?: string } } }
      if (json.data?.status === "error") return { provider: "expo", messageId: "", invalidToken: json.data.details?.error === "DeviceNotRegistered" }
      return { provider: "expo", messageId: json.data?.id ?? "" }
    }
    if (provider === "PUSHY") {
      const c = await this.creds.get("push:pushy")
      if (!c && env().APP_ENV !== "production") return this.sink("pushy", m)
      if (!c) throw new ChannelError("pushy has no credentials", true)
      const json = (await postJson(`https://api.pushy.me/push?api_key=${encodeURIComponent(c.secretApiKey!)}`, { to: m.token, data: { title: m.title, message: m.body, ...m.data }, notification: m.silent ? undefined : { title: m.title, body: m.body } }, {})) as { id?: string }
      return { provider: "pushy", messageId: json.id ?? "" }
    }
    return this.sink("webpush", m)
  }

  private async sink(provider: string, m: PushMessage): Promise<SendResult> {
    const id = `${provider}-sink-${Date.now()}`
    if (isLocal()) {
      await this.redis.lpush("dev:push", JSON.stringify({ id, provider, title: m.title, body: m.body, silent: !!m.silent, at: new Date().toISOString() }))
      await this.redis.ltrim("dev:push", 0, 199)
    }
    return { provider: `${provider}-sink`, messageId: id }
  }
}

/** Email through SMTP: Mailpit locally, Brevo's SMTP relay (primary) or Mailjet (fallback) in production (ch. 8.3). */
@Injectable()
export class EmailSender {
  private transport?: Transporter

  constructor(private readonly creds: VendorCredentialsService, @Inject(REDIS) private readonly redis: Redis) {}

  private async transporter(): Promise<{ t: Transporter; provider: string }> {
    const c = await this.creds.get("email:brevo")
    if (c?.smtpUser && c.smtpKey) return { t: nodemailer.createTransport({ host: "smtp-relay.brevo.com", port: 587, auth: { user: c.smtpUser, pass: c.smtpKey } }), provider: "brevo" }
    this.transport ??= nodemailer.createTransport(env().SMTP_URL)
    return { t: this.transport, provider: env().APP_ENV === "production" ? "smtp" : "mailpit" }
  }

  async send(to: string, subject: string, text: string, locale: "en" | "fa"): Promise<SendResult> {
    const { t, provider } = await this.transporter()
    const dir = locale === "fa" ? "rtl" : "ltr"
    const html = `<!doctype html><html dir="${dir}" lang="${locale}"><body style="font-family:Vazirmatn,Inter,Arial,sans-serif;background:#f5f1ea;padding:24px"><div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:24px;color:#13263f"><p style="font-size:12px;letter-spacing:.2em;color:#b07a45">UNI TRAVEL</p><h1 style="font-size:20px">${escapeHtml(subject)}</h1><p style="font-size:15px;line-height:1.6">${escapeHtml(text).replace(/\n/g, "<br>")}</p></div></body></html>`
    const info = await t.sendMail({ from: env().MAIL_FROM, to, subject, text, html })
    // Mailpit also holds it, but the sign-in screens read this sink to fill email codes in test sessions.
    if (isLocal()) {
      await this.redis.lpush("dev:email", JSON.stringify({ id: info.messageId, to, subject, body: text, at: new Date().toISOString() }))
      await this.redis.ltrim("dev:email", 0, 199)
    }
    return { provider, messageId: info.messageId }
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}
