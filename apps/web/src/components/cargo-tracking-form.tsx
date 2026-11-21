"use client"

import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useId, useState } from "react"

import { isTrackingNumber, normaliseTrackingNumber } from "@/lib/cargo-tracking"
import { useI18n } from "@/lib/i18n"

/**
 * Tracking-number entry (ADR-0042): the format is checked here so a typo never spends a rate-limited look-up; the API
 * still answers the same 404 for a wrong check digit and an unknown number. Solid white field, also over the hero band.
 */
export function CargoTrackingForm({ initial = "", className = "" }: { initial?: string; className?: string }) {
  const { t, href } = useI18n()
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(initial)
  const [invalid, setInvalid] = useState(false)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const n = normaliseTrackingNumber(value)
    if (!isTrackingNumber(n)) { setInvalid(true); return }
    setInvalid(false)
    router.push(href(`/tracking/${n}`))
  }
  return (
    <form onSubmit={submit} noValidate className={`card-brand p-4 text-navy-950 md:p-5 ${className}`} data-testid="cargo-tracking-form" role="search">
      <label htmlFor={id} className="text-sm font-semibold">{t("cargoTracking.number")}</label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input id={id} name="number" className="field h-12 w-full min-w-0 font-mono sm:flex-1 text-lg uppercase tracking-wider" dir="ltr" inputMode="text" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder="UT12345678901" maxLength={24} value={value} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint${invalid ? ` ${id}-err` : ""}`}
          onChange={(e) => { setValue(e.target.value); if (invalid) setInvalid(false) }} />
        <button type="submit" className="btn-orange h-12 shrink-0 px-6">{t("cargoTracking.submit")}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></button>
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs text-steel">{t("cargoTracking.hint")}</p>
      {invalid && <p id={`${id}-err`} role="alert" className="mt-2 text-sm font-medium text-danger">{t("cargoTracking.invalid")}</p>}
    </form>
  )
}
