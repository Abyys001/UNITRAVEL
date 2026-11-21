"use client"

import { Pencil } from "lucide-react"

import { useI18n } from "@/lib/i18n"

export interface ReviewSection { stepId: string; title: string; rows: { label: string; value: React.ReactNode }[] }

/** The review step: what will be sent, one section per step, each with a way back to edit it. */
export function ReviewList({ sections, onEdit }: { sections: ReviewSection[]; onEdit: (stepId: string) => void }) {
  const { t } = useI18n()
  return (
    <div className="grid gap-4">
      {sections.map((s) => (
        <section key={s.stepId} aria-labelledby={`review-${s.stepId}`} className="rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
            <h3 id={`review-${s.stepId}`} className="text-sm font-bold text-navy-950">{s.title}</h3>
            <button type="button" onClick={() => onEdit(s.stepId)} aria-label={t("guide.common.editSection", { section: s.title })} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold text-royal outline-none hover:bg-cloud focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11">
              <Pencil className="size-3.5" aria-hidden />{t("guide.common.edit")}
            </button>
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
            {s.rows.map((r, i) => (
              <div key={i} className="contents">
                <dt className="text-steel">{r.label}</dt>
                <dd className="min-w-0 break-words font-medium text-navy-950">{r.value === "" || r.value == null ? "—" : r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
