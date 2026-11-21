"use client"

import { ChevronDown, Search } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { toAsciiDigits } from "@unitravel/i18n"
import { Popover, PopoverContent, PopoverTrigger } from "@unitravel/ui/components/popover"

import { useI18n } from "@/lib/i18n"

import { fieldAria, FieldShell, type FieldMessages } from "./field-shell"

/** Case, accents, Arabic/Persian letter variants (ي/ى→ی, ك→ک), ZWNJ and Persian/Arabic digits all fold away, so either keyboard finds a match. */
export const foldSearch = (s: string) => toAsciiDigits(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " "))

export interface ComboItem { value: string; label: string; sublabel?: string; keywords?: string[]; group?: string; disabled?: boolean }

export interface ComboFieldProps<T extends ComboItem> extends FieldMessages {
  id: string
  label: React.ReactNode
  items: T[]
  value: string
  onChange: (value: string, item: T) => void
  /** Search box placeholder and accessible name. */
  placeholder?: string
  emptyText?: string
  /** Group heading content for an item's `group` key; groups keep the order of their first item. */
  groupLabel?: (group: string) => React.ReactNode
  renderItem?: (item: T, state: { active: boolean; selected: boolean }) => React.ReactNode
  /** Trigger content for the selected item (undefined when nothing is chosen); put `valueId` on the element that names it. */
  renderValue?: (item: T | undefined, valueId: string) => React.ReactNode
  /** Extra classes on each option row (Flights indents airports under their city). */
  itemClassName?: (item: T) => string
  labelClassName?: string
  className?: string
  triggerClassName?: string
  contentClassName?: string
  testId?: string
}

/** A searchable listbox in a popover: never free text, arrow keys move, Enter picks, Escape closes. */
export function ComboField<T extends ComboItem>({ id, label, items, value, onChange, placeholder, emptyText, groupLabel, renderItem, renderValue, itemClassName, hint, error, required, optional, labelClassName, className = "", triggerClassName, contentClassName, testId }: ComboFieldProps<T>) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const selectedItem = items.find((i) => i.value === value)
  const ids = { label: `${id}-label`, value: `${id}-value`, list: `${id}-list` }

  const groups = useMemo(() => {
    const needle = foldSearch(q.trim())
    const out = new Map<string, T[]>()
    for (const i of items) {
      if (needle && !foldSearch([i.label, i.sublabel ?? "", ...(i.keywords ?? [])].join(" ")).includes(needle)) continue
      const k = i.group ?? ""
      out.set(k, [...(out.get(k) ?? []), i])
    }
    return [...out.entries()]
  }, [items, q])
  const flat = groups.flatMap(([, g]) => g).filter((i) => !i.disabled)

  const pick = (i: T) => { onChange(i.value, i); setOpen(false) }
  const focusOption = (n: number) => {
    setActive(n)
    listRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: "nearest" })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); focusOption(Math.min(active + 1, flat.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusOption(Math.max(active - 1, 0)) }
    else if (e.key === "Home") { e.preventDefault(); focusOption(0) }
    else if (e.key === "End") { e.preventDefault(); focusOption(flat.length - 1) }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); pick(flat[active]!) }
  }
  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (o) { setQ(""); setActive(0) }
  }
  const optId = (i: T) => `${id}-opt-${i.value}`

  let index = -1
  return (
    <FieldShell id={id} controlId={`${id}-control`} label={label} hint={hint} error={error} required={required} optional={optional} labelClassName={labelClassName} className={className}>
      <Popover open={open} onOpenChange={onOpenChange}>
        {/* No aria-required: it is not allowed on a button (axe aria-allowed-attr). */}
        <PopoverTrigger
          type="button" id={`${id}-control`} aria-labelledby={`${ids.label} ${ids.value}`} aria-haspopup="listbox" data-testid={testId} {...fieldAria(id, { hint, error })}
          className={triggerClassName ?? "group flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-cloud px-3 text-start text-base outline-none transition-colors hover:border-steel/50 focus-visible:border-orange focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-orange/35 aria-invalid:border-danger data-[popup-open]:border-orange data-[popup-open]:bg-white"}
        >
          {renderValue ? renderValue(selectedItem, ids.value) : (
            <span id={ids.value} className={`min-w-0 flex-1 truncate ${selectedItem ? "font-semibold text-navy-950" : "text-steel"}`}>{selectedItem?.label ?? t("guide.common.selectPlaceholder")}</span>
          )}
          <ChevronDown className="size-4 shrink-0 text-steel transition-transform group-data-[popup-open]:rotate-180" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} initialFocus={inputRef} style={{ background: "#fff", backdropFilter: "none" }} className={contentClassName ?? "w-[min(calc(100vw-2rem),24rem)] gap-0 overflow-hidden rounded-2xl p-0"}>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-steel" aria-hidden />
            <input
              ref={inputRef} type="search" role="combobox" aria-expanded aria-controls={ids.list} aria-activedescendant={flat[active] ? optId(flat[active]!) : undefined}
              aria-label={placeholder ?? t("guide.common.searchPlaceholder")} placeholder={placeholder ?? t("guide.common.searchPlaceholder")} autoComplete="off" value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={onKeyDown}
              className="h-12 w-full bg-transparent text-base text-navy-950 outline-none placeholder:text-steel/70"
            />
          </div>
          <div ref={listRef} id={ids.list} role="listbox" aria-labelledby={ids.label} className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain py-1">
            {groups.length === 0 ? <p className="px-4 py-6 text-center text-sm text-steel">{emptyText ?? t("guide.common.noMatch")}</p> : groups.map(([key, g], gi) => {
              const rows = g.map((item) => {
                const i = item.disabled ? -1 : ++index
                const selected = item.value === value
                const isActive = i >= 0 && i === active
                return (
                  <div
                    key={item.value} id={optId(item)} data-index={i >= 0 ? i : undefined} role="option" aria-selected={selected} aria-disabled={item.disabled || undefined}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => !item.disabled && pick(item)} onMouseMove={() => i >= 0 && active !== i && setActive(i)}
                    className={`mx-1 flex items-center gap-3 rounded-lg py-2 ${item.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${isActive ? "bg-orange/10" : ""} ${selected ? "font-semibold" : ""} ${itemClassName ? itemClassName(item) : "px-3"}`}
                  >
                    {renderItem ? renderItem(item, { active: isActive, selected }) : (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-navy-950">{item.label}</span>
                        {item.sublabel ? <span className="block truncate text-xs text-steel">{item.sublabel}</span> : null}
                      </span>
                    )}
                  </div>
                )
              })
              if (!key) return <div key={`g-${gi}`} role="group">{rows}</div>
              return (
                <div key={key} role="group" aria-labelledby={`${id}-g-${gi}`}>
                  <div id={`${id}-g-${gi}`} className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-steel">{groupLabel ? groupLabel(key) : key}</div>
                  {rows}
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </FieldShell>
  )
}
