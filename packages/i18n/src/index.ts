import { en } from "./en"
import { type DeepString, fa } from "./fa"

export type Locale = "en" | "fa"
export type Messages = DeepString<typeof en>
export const messages: Record<Locale, Messages> = { en, fa }
export const dir = (l: Locale) => (l === "fa" ? "rtl" : "ltr")

type Path<T, P extends string = ""> = { [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`> }[keyof T & string]
export type MessageKey = Path<Messages>

/** ICU-lite: {name} placeholders. Missing keys fall back to English so a gap never shows a raw key. */
export function translate(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const get = (m: unknown) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], m)
  const raw = (get(messages[locale]) ?? get(messages.en) ?? key) as string
  // Numbers render in the locale's digits; strings (codes, already formatted dates) are passed through as given.
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined) return `{${k}}`
    return typeof v === "number" && locale === "fa" ? toPersianDigits(String(v)) : String(v)
  })
}

/** A middle dot beside a Persian digit reads as Persian zero ("· ۱" looks like "۱۰"); Persian uses its comma. */
export const listSep = (l: Locale) => (l === "fa" ? "، " : " · ")

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
export const toPersianDigits = (s: string) => s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]!)

/** Storage is always ISO-8601 UTC; display follows the user's calendar (Gregorian/Jalali) and time zone (ch. 29.4). */
export function formatDate(iso: string | Date, opts: { locale: Locale; calendar?: "GREGORIAN" | "JALALI"; timeZone?: string; withTime?: boolean; weekday?: boolean; dateOnly?: boolean }) {
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : iso
  const cal = opts.calendar ?? (opts.locale === "fa" ? "JALALI" : "GREGORIAN")
  const loc = `${opts.locale === "fa" ? "fa-IR" : "en-GB"}-u-ca-${cal === "JALALI" ? "persian" : "gregory"}`
  return new Intl.DateTimeFormat(loc, {
    timeZone: opts.timeZone ?? (iso.toString().length === 10 ? "UTC" : undefined), day: "numeric", month: "short",
    ...(opts.weekday ? { weekday: "short" } : {}), ...(opts.dateOnly ? {} : opts.withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(d)
}

/** Flight times are always airport-local (local strings carry no offset). */
export function localClock(local: string, locale: Locale) {
  const hhmm = local.slice(11, 16)
  return locale === "fa" ? toPersianDigits(hhmm) : hhmm
}

export function formatDuration(min: number, locale: Locale) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return locale === "fa" ? toPersianDigits(`${h} ساعت${m ? ` و ${m} دقیقه` : ""}`) : `${h}h ${String(m).padStart(2, "0")}m`
}

export function formatMoney(m: { amountMinor: number; currency: string }, locale: Locale) {
  return new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB", { style: "currency", currency: m.currency, maximumFractionDigits: m.amountMinor % 100 === 0 ? 0 : 2 }).format(m.amountMinor / 100)
}

export { en, fa }
