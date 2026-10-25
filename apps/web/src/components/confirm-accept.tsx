"use client"

import { useState } from "react"

import { useI18n } from "@/lib/i18n"

/** Accepting a quote is a commitment: one deliberate extra step, with the option and price restated. */
export function ConfirmAccept({ label, total, pending, onConfirm }: { label: string; total: string; pending: boolean; onConfirm: () => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className="btn-orange mt-4" onClick={() => setOpen(true)}>{t("requests.accept")}</button>
  return (
    <div role="alertdialog" aria-label={t("flow.acceptTitle")} className="mt-4 rounded-xl border-2 border-orange bg-warning-subtle p-4 text-sm" data-testid="confirm-accept">
      <p className="font-semibold">{t("flow.acceptTitle")}</p>
      <p className="mt-1">{t("flow.acceptBody", { label, total })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-orange" disabled={pending} onClick={onConfirm} autoFocus>{t("flow.acceptYes")}</button>
        <button type="button" className="rounded-xl border border-navy-900 bg-white px-4 py-2 font-semibold text-navy-900 pointer-coarse:min-h-11" disabled={pending} onClick={() => setOpen(false)}>{t("flow.acceptBack")}</button>
      </div>
    </div>
  )
}
