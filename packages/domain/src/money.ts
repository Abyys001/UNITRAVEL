import type { Money } from "@unitravel/contracts"

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) throw new Error("Money must be integer minor units")
  return { amountMinor, currency }
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch ${a.currency}/${b.currency}`)
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency }
}

export function sumMoney(items: Money[], currency: string): Money {
  return items.reduce((acc, m) => addMoney(acc, m), { amountMinor: 0, currency })
}

const MINOR_DIGITS: Record<string, number> = { JPY: 0, KWD: 3, BHD: 3, OMR: 3, IQD: 3 }
export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2
}

export function formatMoney(m: Money, locale = "en-GB"): string {
  const digits = minorDigits(m.currency)
  return new Intl.NumberFormat(locale, { style: "currency", currency: m.currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(m.amountMinor / 10 ** digits)
}
