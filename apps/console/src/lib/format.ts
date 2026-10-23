import type { Money } from "@unitravel/contracts"
import { formatMoney, minorDigits } from "@unitravel/domain"

export const money = (m: Money | null | undefined) => (m ? formatMoney(m) : "—")
export const toMinor = (major: string, currency: string) => Math.round(Number(major || 0) * 10 ** minorDigits(currency))
export const toMajor = (minor: number, currency: string) => (minor / 10 ** minorDigits(currency)).toFixed(minorDigits(currency))

const dt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
const d = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : "—")
export const fmtDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)) : "—")

/** "in 1 h 12 m" / "3 h 5 m ago" — SLA style relative times. */
export function rel(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "—"
  const diff = new Date(iso).getTime() - now
  const m = Math.round(Math.abs(diff) / 60000)
  const s = m >= 1440 ? `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h` : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} m` : `${m} m`
  return diff >= 0 ? `in ${s}` : `${s} ago`
}

export const minutes = (n: number) => `${Math.floor(n / 60)}h ${String(n % 60).padStart(2, "0")}m`
export const human = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
