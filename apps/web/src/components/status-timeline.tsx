"use client"

import { useI18n } from "@/lib/i18n"

export function StatusTimeline({ items }: { items: { at: string; label: string; detail?: string }[] }) {
  const { date, sep } = useI18n()
  return (
    <ol className="relative ms-2 border-s border-copper/40" aria-live="polite">
      {items.map((x, i) => (
        <li key={i} className="mb-4 ms-4">
          <span className={`absolute -start-[5px] mt-1.5 size-2.5 rounded-full ${i === items.length - 1 ? "bg-copper ring-4 ring-copper/20" : "bg-copper/50"}`} />
          <p className={i === items.length - 1 ? "font-semibold" : ""}>{x.label}</p>
          <p className="text-xs text-slate">{date(x.at, { withTime: true })}{x.detail ? `${sep}${x.detail}` : ""}</p>
        </li>
      ))}
    </ol>
  )
}
