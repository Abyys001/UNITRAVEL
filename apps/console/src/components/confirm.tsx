"use client"

import { useState } from "react"

import { FormDialog } from "@/components/form-dialog"

export interface ConfirmSpec { title: string; description?: React.ReactNode; label: string; destructive?: boolean; run: () => Promise<unknown> }

/** Confirmation step for one-click global or irreversible actions: `ask({...})` opens it, `dialog` must be rendered once. */
export function useConfirm() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null)
  const dialog = (
    <FormDialog open={!!spec} onOpenChange={(o) => { if (!o) setSpec(null) }} title={spec?.title ?? ""} description={spec?.description} submitLabel={spec?.label} destructive={spec?.destructive} testId="dlg-confirm"
      onSubmit={async () => { await spec?.run() }}>
      {null}
    </FormDialog>
  )
  return { ask: setSpec, dialog }
}
