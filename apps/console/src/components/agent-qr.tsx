"use client"

import { QrCode } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@unitravel/ui/components/dialog"

import { api, errText } from "@/lib/api"
import { useT } from "@/lib/i18n"

type Code = { url: string; expiresAt: string; qrSvg: string }

/** ADR-0045: staff show a single-use, 10-minute sign-in QR code to the agent in person. */
export function AgentQrButton({ agentId }: { agentId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<Code | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!open) return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i) }, [open])
  const issue = async () => {
    setBusy(true); setErr(null)
    try { setCode(await api<Code>(`/v1/admin/cargo/agents/${agentId}/sign-in-code`, { method: "POST", body: {} })); setNow(Date.now()) } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const left = code ? Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - now) / 1000)) : 0
  const close = (o: boolean) => { setOpen(o); if (!o) setCode(null) }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setOpen(true); void issue() }} data-testid="agent-qr"><QrCode className="size-4" aria-hidden />{t("agt.qr.button")}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md" data-testid="dlg-agent-qr">
          <DialogHeader>
            <DialogTitle>{t("agt.qr.title")}</DialogTitle>
            <DialogDescription>{t("agt.qr.desc")}</DialogDescription>
          </DialogHeader>
          {err && <p role="alert" className="rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{err}</p>}
          {code && (
            <div className="grid justify-items-center gap-3">
              {/* bwip-js SVG from our own API: no scripts, just paths. White plate so it scans in dark mode too. */}
              <div className={left ? "rounded-lg bg-white p-3" : "rounded-lg bg-white p-3 opacity-20"} style={{ width: 260 }} aria-label={t("agt.qr.title")} role="img" dangerouslySetInnerHTML={{ __html: code.qrSvg }} />
              <p className="text-meta font-medium" aria-live="polite">{left ? t("agt.qr.expires", { m: Math.floor(left / 60), s: String(left % 60).padStart(2, "0") }) : t("agt.qr.expired")}</p>
              <p className="rounded-md bg-surface-sunk px-2 py-1.5 text-caption text-steel">{t("agt.qr.warn")}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!left} onClick={() => { void navigator.clipboard.writeText(code.url).then(() => toast.success(t("agt.qr.copied"))) }}>{t("agt.qr.copy")}</Button>
                <Button size="sm" onClick={() => void issue()} disabled={busy}>{t("agt.qr.new")}</Button>
              </div>
            </div>
          )}
          {!code && !err && <div className="h-[260px] animate-pulse rounded-lg bg-surface-sunk" />}
        </DialogContent>
      </Dialog>
    </>
  )
}
