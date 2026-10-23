"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@unitravel/ui/components/dialog"
import { cn } from "@unitravel/ui/lib/utils"

import { errText } from "@/lib/api"

/**
 * One recording dialog pattern for every external action (ch. 15.2 "Record dialogs"): the form posts to the API and
 * shows the API's problem detail inline — the server validates, the dialog only collects.
 */
export function FormDialog({ open, onOpenChange, title, description, submitLabel = "Save", onSubmit, children, wide = false, destructive = false, testId }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; submitLabel?: string
  onSubmit: () => Promise<unknown>; children: React.ReactNode; wide?: boolean; destructive?: boolean; testId?: string
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await onSubmit(); toast.success(`${title.replace(/…$/, "")} — done`); onOpenChange(false) } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { setErr(null); onOpenChange(o) } }}>
      <DialogContent className={cn("max-h-[92dvh] gap-3 overflow-y-auto p-5", wide ? "sm:max-w-3xl" : "sm:max-w-md")} data-testid={testId}>
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-normal">{title}</DialogTitle>
          {description && <DialogDescription className="text-slate">{description}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {children}
          {err && <p role="alert" className="rounded-sm bg-[#fbeee9] px-2 py-1.5 text-brick">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" size="sm" variant={destructive ? "destructive" : "default"} loading={busy}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Small hook for dialogs keyed by name: `const d = useDialogs<"note" | "msg">(); d.open("note")`. */
export function useDialogs<K extends string>() {
  const [which, setWhich] = useState<K | null>(null)
  return { which, open: (k: K) => setWhich(k), close: () => setWhich(null), bind: (k: K) => ({ open: which === k, onOpenChange: (o: boolean) => setWhich(o ? k : null) }) }
}
