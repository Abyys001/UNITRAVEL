"use client"

import { Minus, Plus } from "lucide-react"
import { useId } from "react"

import { useI18n } from "@/lib/i18n"

import { fieldAria, FieldShell, type FieldMessages } from "./field-shell"

export interface CounterFieldProps extends FieldMessages {
  label: string
  value: number
  onChange: (n: number) => void
  min?: number
  max: number
  icon?: React.ComponentType<{ className?: string }>
  /**
   * `row`: icon, label and hint beside a −/+ pill (Flights travellers).
   * `field`: labelled box with an editable number between −/+ (service forms); `id` names the input for drafts.
   * `inline`: the pill alone, named by `label` (layover hours).
   */
  variant?: "row" | "field" | "inline"
  /** Shown value; defaults to the number in the locale's digits. */
  format?: (n: number) => string
  id?: string
  name?: string
  className?: string
}

const pillBtn = "grid size-8 place-items-center rounded-full text-navy-900 outline-none transition-colors enabled:hover:bg-white enabled:hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:text-steel/40 pointer-coarse:size-11"
const inlineBtn = "grid size-7 place-items-center rounded-full outline-none enabled:hover:bg-white focus-visible:ring-[3px] focus-visible:ring-royal/50 disabled:text-steel/40 pointer-coarse:size-11"
const boxBtn = "flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-navy-950 transition-colors hover:bg-cloud disabled:opacity-40 pointer-coarse:size-11"

/** A bounded count with −/+ buttons; the value is announced politely as it changes. */
export function CounterField({ label, hint, error, required, optional, icon: Icon, value, onChange, min = 0, max, variant = "row", format, id, name, className = "" }: CounterFieldProps) {
  const { t, locale } = useI18n()
  const autoId = useId()
  const show = format ?? ((n: number) => new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-GB").format(n))
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  if (variant === "field") {
    const inputId = id ?? autoId
    return (
      <FieldShell id={inputId} label={label} hint={hint} error={error} required={required} optional={optional} className={`text-sm ${className}`}>
        <div className={`flex h-12 items-center justify-between gap-1 rounded-xl border bg-cloud px-1 focus-within:border-orange focus-within:ring-[3px] focus-within:ring-orange/35 ${error ? "border-danger" : "border-line"}`}>
          <button type="button" className={boxBtn} disabled={value <= min} aria-label={t("stays.decrease", { label })} onClick={() => onChange(clamp(value - 1))}><Minus className="size-4" aria-hidden /></button>
          <input
            id={inputId} name={name} type="number" inputMode="numeric" min={min} max={max} {...fieldAria(inputId, { hint, error, required })}
            className="w-full min-w-0 bg-transparent text-center text-base font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            value={value} onChange={(e) => onChange(Number(e.target.value))}
          />
          <button type="button" className={boxBtn} disabled={value >= max} aria-label={t("stays.increase", { label })} onClick={() => onChange(clamp(value + 1))}><Plus className="size-4" aria-hidden /></button>
        </div>
      </FieldShell>
    )
  }

  // Row and inline counters have no text box, so a hidden one gives form-draft and native posts a value to read and restore.
  const hidden = id || name ? <input id={id} name={name} hidden value={value} onChange={(e) => { const n = Number(e.target.value); if (Number.isInteger(n)) onChange(clamp(n)) }} /> : null
  if (variant === "inline") {
    return (
      <span role="group" aria-label={label} className={`flex items-center gap-1 rounded-full border border-line bg-cloud p-0.5 ${className}`}>
        {hidden}
        <button type="button" aria-label={`− ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={inlineBtn}><Minus className="size-3.5" /></button>
        <output aria-live="polite" className="min-w-12 text-center text-sm font-semibold tabular-nums text-navy-950">{show(value)}</output>
        <button type="button" aria-label={`+ ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={inlineBtn}><Plus className="size-3.5" /></button>
      </span>
    )
  }

  const labelId = `${id ?? autoId}-label`
  return (
    <div className={`flex items-center gap-3 py-2.5 ${className}`}>
      {hidden}
      {Icon ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-navy-900/5 text-navy-900"><Icon className="size-5" /></span> : null}
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-sm font-semibold text-navy-950">{label}</span>
        {hint ? <span className="block text-xs text-steel">{hint}</span> : null}
        {error ? <span role="alert" className="block text-xs font-medium text-danger">{error}</span> : null}
      </span>
      <span role="group" aria-labelledby={labelId} aria-invalid={error ? true : undefined} className="flex items-center gap-1 rounded-full border border-line bg-cloud p-0.5">
        <button type="button" className={pillBtn} aria-label={`− ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus className="size-4" /></button>
        <output aria-live="polite" className="w-6 text-center text-sm font-bold tabular-nums text-navy-950">{show(value)}</output>
        <button type="button" className={pillBtn} aria-label={`+ ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus className="size-4" /></button>
      </span>
    </div>
  )
}
