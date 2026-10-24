"use client"

import { useQuery } from "@tanstack/react-query"
import { MapPin } from "lucide-react"
import { useId, useState } from "react"

import type { LocationSuggestion } from "@unitravel/contracts"

import { api } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

export interface PlaceValue { kind: "CITY" | "AIRPORT"; code: string; label: string }

/** City or airport autocomplete in English and Persian; cities expand to their airports on the server (ch. 11.3). */
export function PlaceInput({ label, value, onChange, name }: { label: string; value: PlaceValue | null; onChange: (v: PlaceValue) => void; name: string }) {
  const { t, locale, sep } = useI18n()
  const id = useId()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const { data = [] } = useQuery({ queryKey: ["loc", q], queryFn: () => api<LocationSuggestion[]>(`/v1/locations?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2, staleTime: 300_000 })
  const pick = (s: LocationSuggestion) => {
    onChange({ kind: s.kind, code: s.code, label: locale === "fa" ? s.nameFa : s.nameEn })
    setQ("")
    setOpen(false)
  }
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs font-medium uppercase tracking-wide text-steel">{label}</label>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-cloud/60 px-3 transition-colors focus-within:border-orange focus-within:bg-white focus-within:ring-[3px] focus-within:ring-orange/35">
        <MapPin className="size-4 text-orange-700" aria-hidden />
        <input
          id={id} name={name} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off"
          className="h-11 w-full bg-transparent text-base outline-none placeholder:text-steel/70" placeholder={value ? `${value.label} (${value.code})` : t("search.placeholder")}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, data.length - 1)) }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === "Enter" && data[active]) { e.preventDefault(); pick(data[active]!) }
          }}
        />
        {value && !q && <span className="font-mono text-xs text-steel" dir="ltr">{value.code}</span>}
      </div>
      {open && data.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-white py-1 shadow-[var(--shadow-lift)]">
          {data.map((s, i) => (
            <li key={`${s.kind}${s.code}`} role="option" aria-selected={i === active} onMouseDown={() => pick(s)} className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-accent" : ""}`}>
              <span>{locale === "fa" ? s.nameFa : s.nameEn}{s.kind === "CITY" && <span className="text-steel">{sep}{s.airports?.join(", ")}</span>}</span>
              <span className="font-mono text-xs text-steel" dir="ltr">{s.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
