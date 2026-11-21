"use client"

import { CircleAlert } from "lucide-react"

import { useI18n } from "@/lib/i18n"

export interface FieldMessages { hint?: React.ReactNode; error?: string | null; required?: boolean; optional?: boolean }

export const fieldIds = (id: string) => ({ label: `${id}-label`, hint: `${id}-hint`, error: `${id}-error` })

/** ARIA for the focusable control inside a FieldShell: the hint and error are read after the label. */
export function fieldAria(id: string, { hint, error, required }: FieldMessages) {
  const ids = fieldIds(id)
  const describedBy = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean).join(" ")
  return { "aria-describedby": describedBy || undefined, "aria-invalid": error ? true : undefined, "aria-required": required || undefined } as const
}

export interface FieldShellProps extends FieldMessages {
  /** Id of the base control. The label points at `controlId` (defaults to `id`), the hint and error derive from `id`. */
  id: string
  controlId?: string
  label: React.ReactNode
  /** Flights use the small uppercase label; service forms the medium one. */
  labelClassName?: string
  /** Label for screen readers only (the control sits in a compact row that already shows context). */
  hideLabel?: boolean
  className?: string
  children: React.ReactNode
}

/** Label, hint and error around one control; the control itself takes `fieldAria(id, …)` so the three stay linked. */
export function FieldShell({ id, controlId, label, labelClassName = "", hideLabel, hint, error, required, optional, className = "text-sm", children }: FieldShellProps) {
  const { t } = useI18n()
  const ids = fieldIds(id)
  return (
    <div className={`min-w-0 ${className}`}>
      <label id={ids.label} htmlFor={controlId ?? id} className={hideLabel ? "sr-only" : `block font-medium ${labelClassName}`}>
        {label}
        {required && <span aria-hidden className="ms-0.5 text-danger">*</span>}
        {/* Picker triggers are buttons, where aria-required is not allowed; the label carries "required" for screen readers instead. */}
        {required && <span className="sr-only"> ({t("guide.common.required")})</span>}
        {optional && <span className="font-normal normal-case tracking-normal text-steel"> ({t("guide.common.optional")})</span>}
      </label>
      <div className={hideLabel ? undefined : "mt-1"}>{children}</div>
      {hint ? <p id={ids.hint} className="mt-1 text-xs text-steel">{hint}</p> : null}
      {error ? <p id={ids.error} className="mt-1 flex items-start gap-1 text-xs font-medium text-danger"><CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />{error}</p> : null}
    </div>
  )
}
