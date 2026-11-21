"use client"

import { DirectionProvider } from "@base-ui/react/direction-provider"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check } from "lucide-react"

import { dir } from "@unitravel/i18n"
import { Select, SelectContent, SelectGroup, SelectLabel, SelectTrigger, SelectValue } from "@unitravel/ui/components/select"

import { useI18n } from "@/lib/i18n"

import { fieldAria, FieldShell, type FieldMessages } from "./field-shell"

export interface SelectOption { value: string; label: string; hint?: string; disabled?: boolean }
export interface SelectOptionGroup { label: string; options: SelectOption[] }

export interface SelectFieldProps extends FieldMessages {
  id: string
  name?: string
  label: React.ReactNode
  options: SelectOption[] | SelectOptionGroup[]
  /** "" shows the placeholder. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  labelClassName?: string
  hideLabel?: boolean
  className?: string
  triggerClassName?: string
}

const isGroups = (o: SelectOption[] | SelectOptionGroup[]): o is SelectOptionGroup[] => o.length > 0 && "options" in o[0]!

/**
 * Base UI Select styled as a customer-site control (ADR-0041 replaces NativeSelect here). The hidden input carries the
 * value under `id`/`name`, so form-draft snapshots and native posts see it like a native select.
 */
export function SelectField({ id, name, label, options, value, onChange, placeholder, disabled, hint, error, required, optional, labelClassName, hideLabel, className, triggerClassName = "" }: SelectFieldProps) {
  const { t, locale } = useI18n()
  const groups = isGroups(options) ? options : [{ label: "", options }]
  const flat = groups.flatMap((g) => g.options)
  const labelOf = (v: unknown) => flat.find((o) => o.value === v)?.label
  const controlId = `${id}-control`
  return (
    <FieldShell id={id} controlId={controlId} label={label} hint={hint} error={error} required={required} optional={optional} labelClassName={labelClassName} hideLabel={hideLabel} className={className}>
      <input id={id} name={name} hidden value={value} onChange={(e) => { if (flat.some((o) => o.value === e.target.value)) onChange(e.target.value) }} />
      {/* Base UI reads direction from context, not the document; without it the popup aligns and types ahead as LTR. */}
      <DirectionProvider direction={dir(locale)}>
        <Select value={value === "" ? null : value} onValueChange={(v) => { if (typeof v === "string") onChange(v) }} items={flat} disabled={disabled} required={required}>
          <SelectTrigger
            id={controlId} {...fieldAria(id, { hint, error, required })}
            className={`h-11 w-full rounded-xl border-line bg-cloud px-3 text-start text-base text-navy-950 shadow-none hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger data-[popup-open]:border-orange data-[popup-open]:bg-white [&>svg]:transition-transform data-[popup-open]:[&>svg]:rotate-180 ${triggerClassName}`}
          >
            <SelectValue className="min-w-0 truncate data-[placeholder]:text-steel">{(v: unknown) => labelOf(v) ?? placeholder ?? t("guide.common.selectPlaceholder")}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} sideOffset={6} style={{ background: "#fff", backdropFilter: "none" }} className="max-h-[min(var(--available-height),20rem)] rounded-xl border-line p-0 shadow-[var(--shadow-lift)]">
            {groups.map((g, gi) => (
              <SelectGroup key={gi}>
                {g.label ? <SelectLabel className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-steel">{g.label}</SelectLabel> : null}
                {g.options.map((o) => (
                  <SelectPrimitive.Item
                    key={o.value} value={o.value} disabled={o.disabled} label={o.label}
                    className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pe-8 ps-3 text-sm text-navy-950 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-orange/10 data-[selected]:font-semibold pointer-coarse:min-h-11"
                  >
                    <span className="min-w-0">
                      <SelectPrimitive.ItemText className="block">{o.label}</SelectPrimitive.ItemText>
                      {o.hint ? <span className="block text-xs font-normal text-steel">{o.hint}</span> : null}
                    </span>
                    <SelectPrimitive.ItemIndicator className="absolute end-2.5 flex text-orange-700"><Check className="size-4" aria-hidden /></SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </DirectionProvider>
    </FieldShell>
  )
}
