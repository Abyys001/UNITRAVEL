import type { Money } from "@unitravel/contracts"
import { formatMoney, minorDigits } from "@unitravel/domain"

import { translate } from "./i18n"

export const money = (m: Money | null | undefined) => (m ? formatMoney(m) : "—")
export const toMinor = (major: string, currency: string) => Math.round(Number(major || 0) * 10 ** minorDigits(currency))
export const toMajor = (minor: number, currency: string) => (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency))

/**
 * Dates follow the console language: English keeps en-GB, Persian gets the Jalali calendar and Persian digits (the same
 * rule as formatDate in @unitravel/i18n, which the console does not depend on). The language is read from <html lang>,
 * which applyPrefs() sets before it notifies subscribers, so a language switch re-renders with the new format.
 */
const isFa = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("fa")
const formatters = new Map<string, Intl.DateTimeFormat>()
const intl = (fa: boolean, key: string, opts: Intl.DateTimeFormatOptions) => {
  const k = `${fa}|${key}`
  let f = formatters.get(k)
  if (!f) { f = new Intl.DateTimeFormat(fa ? "fa-IR-u-ca-persian" : "en-GB", opts); formatters.set(k, f) }
  return f
}
export const fmtDateTime = (iso: string | null | undefined) => (iso ? intl(isFa(), "dt", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—")
export const fmtDate = (iso: string | null | undefined) => (iso ? intl(isFa(), "d", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : "—")

export const fmtClock = (iso: string) => intl(isFa(), "clock", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

/** "in 1h 12m" / "3h 5m ago" / "just now" (Persian: "۱ ساعت ۱۲ دقیقه دیگر"): compact relative times for tables and SLA lines (exact time goes in a title). */
export function rel(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—"
  const fa = isFa()
  const locale = fa ? "fa" : "en"
  const diff = new Date(iso).getTime() - now
  const m = Math.round(Math.abs(diff) / 60000)
  if (m < 1) return translate(locale, "time.justNow")
  const n = (x: number) => (fa ? x.toLocaleString("fa-IR") : String(x))
  const u = (x: number, unit: string) => (fa ? `${n(x)} ${unit}` : `${n(x)}${unit}`)
  const d = translate(locale, "time.d"), h = translate(locale, "time.h"), mm = translate(locale, "time.m")
  const s = m >= 1440 ? `${u(Math.floor(m / 1440), d)} ${u(Math.floor((m % 1440) / 60), h)}` : m >= 60 ? `${u(Math.floor(m / 60), h)} ${u(m % 60, mm)}` : u(m, mm)
  return translate(locale, diff >= 0 ? "time.in" : "time.ago", { t: s })
}

export const minutes = (n: number) => `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`
/** Keeps a Latin run ("IKA → LHR", amounts) in reading order inside Persian text where only a string can be returned (toasts, dialog titles). */
export const ltrIsolate = (s: string) => `\u2066${s}\u2069`
export const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
