"use client"

import { useState } from "react"

import { Button } from "@unitravel/ui/components/button"

import { FormDialog } from "./form-dialog"

/** Write-only secrets (ch. 16.2 §2): typed here once, sent to the API, never read back or kept in client state after. */
export function SecretDialog({ open, onOpenChange, title, hintKeys, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; hintKeys: string[]; onSave: (values: Record<string, string>) => Promise<unknown> }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>(hintKeys.map((k) => ({ k, v: "" })))
  const close = (o: boolean) => { if (!o) setRows(hintKeys.map((k) => ({ k, v: "" }))); onOpenChange(o) }
  return (
    <FormDialog open={open} onOpenChange={close} title={title} description="Encrypted at rest and never displayed again. Rotating needs a fresh second-factor check." submitLabel="Save credentials"
      onSubmit={async () => { await onSave(Object.fromEntries(rows.filter((r) => r.k && r.v).map((r) => [r.k, r.v]))); setRows(hintKeys.map((k) => ({ k, v: "" }))) }}>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[10rem_1fr] gap-2">
          <input aria-label="Key" className="field-input font-mono" value={r.k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} placeholder="apiKey" />
          <input aria-label={`Value for ${r.k || "key"}`} type="password" autoComplete="off" className="field-input font-mono" value={r.v} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
        </div>
      ))}
      <Button type="button" size="xs" variant="ghost" onClick={() => setRows([...rows, { k: "", v: "" }])}>+ Another value</Button>
    </FormDialog>
  )
}
