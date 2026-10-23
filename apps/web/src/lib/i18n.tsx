"use client"

import { createContext, useContext, useMemo } from "react"

import { formatDate, formatDuration, formatMoney, listSep, localClock, type Locale, type MessageKey, translate } from "@unitravel/i18n"

interface I18n {
  locale: Locale
  t: (key: MessageKey, vars?: Record<string, string | number>) => string
  date: (iso: string, o?: { withTime?: boolean; weekday?: boolean; dateOnly?: boolean; timeZone?: string }) => string
  clock: (local: string) => string
  duration: (min: number) => string
  money: (m: { amountMinor: number; currency: string }) => string
  href: (path: string) => string
  calendar: "GREGORIAN" | "JALALI"
  /** List separator for the locale. */
  sep: string
}

const Ctx = createContext<I18n | null>(null)

export function I18nProvider({ locale, calendar, children }: { locale: Locale; calendar?: "GREGORIAN" | "JALALI"; children: React.ReactNode }) {
  const value = useMemo<I18n>(() => {
    const cal = calendar ?? (locale === "fa" ? "JALALI" : "GREGORIAN")
    return {
      locale, calendar: cal, sep: listSep(locale),
      t: (k, v) => translate(locale, k, v),
      date: (iso, o) => formatDate(iso, { locale, calendar: cal, ...o }),
      clock: (l) => localClock(l, locale),
      duration: (m) => formatDuration(m, locale),
      money: (m) => formatMoney(m, locale),
      href: (p) => `/${locale}${p.startsWith("/") ? p : `/${p}`}`,
    }
  }, [locale, calendar])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n(): I18n {
  const v = useContext(Ctx)
  if (!v) throw new Error("I18nProvider missing")
  return v
}
