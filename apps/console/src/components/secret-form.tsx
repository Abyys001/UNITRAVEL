"use client"

import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { useT } from "@/lib/i18n"

import { FormDialog } from "./form-dialog"

/** Write-only secrets (ch. 16.2 §2): typed here once, sent to the API, never read back or kept in client state after. */
export function SecretDialog({ open, onOpenChange, title, hintKeys, fixedKeys = false, plainKeys = [], requiredKeys = [], optionalKeys = [], hint, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; hintKeys: string[]; /** Field names come from the server: no renaming, no extra rows. */ fixedKeys?: boolean
  /** Fields that are settings, not secrets (host, port): typed in the clear so a typo is visible. Still write-only: nothing is read back. */ plainKeys?: string[]
  /** Fields the form refuses to submit empty (the server schema decides what it accepts). */ requiredKeys?: string[]; optionalKeys?: string[]; hint?: React.ReactNode
  onSave: (values: Record<string, string>) => Promise<unknown>
}) {
  const t = useT()
  const [rows, setRows] = useState<{ k: string; v: string }[]>(hintKeys.map((k) => ({ k, v: "" })))
  const close = (o: boolean) => { if (!o) setRows(hintKeys.map((k) => ({ k, v: "" }))); onOpenChange(o) }
  return (
    <FormDialog open={open} onOpenChange={close} title={title} description={<>{t("sec.body")}{hint && <span className="mt-2 block">{hint}</span>}</>} submitLabel={t("sec.save")}
      onSubmit={async () => { await onSave(Object.fromEntries(rows.filter((r) => r.k && r.v).map((r) => [r.k, r.v]))); setRows(hintKeys.map((k) => ({ k, v: "" }))) }}>
      {rows.map((r, i) => {
        const plain = plainKeys.includes(r.k)
        return (
          <div key={i} className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <input aria-label="Key" readOnly={fixedKeys} dir="ltr" className="field-input font-mono" value={r.k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="apiKey" />
            <input aria-label={`Value for ${r.k || "key"}`} type={plain ? "text" : "password"} autoComplete="off" spellCheck={false} dir="ltr" className="field-input font-mono" value={r.v} required={requiredKeys.includes(r.k)} placeholder={optionalKeys.includes(r.k) ? t("sec.optional") : undefined} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
          </div>
        )
      })}
      {!fixedKeys && <Button type="button" size="xs" variant="ghost" onClick={() => setRows([...rows, { k: "", v: "" }])}>{t("sec.another")}</Button>}
    </FormDialog>
  )
}
