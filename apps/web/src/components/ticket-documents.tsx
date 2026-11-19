"use client"

import { Copy, Download, ExternalLink, FileText, Plane, QrCode, X } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

import type { CustomerTicketDocument, TicketFileWhich, TicketSegmentView } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@unitravel/ui/components/dialog"

import { Auto, Ltr } from "@/components/badges"
import { ApiError } from "@/lib/api"
import { useI18n } from "@/lib/i18n"
import { downloadTicketFile, openTicketFile, ticketCodeSrc } from "@/lib/ticket-documents"

/** Segment date and time at the airport, as recorded; falls back to the UTC instant in the visitor's zone. */
function useWhen() {
  const { date, clock, sep } = useI18n()
  return (local: string | null, utc: string | null) => {
    if (local) return `${date(local.slice(0, 10), { weekday: true, year: true })}${sep}${clock(local)}`
    return utc ? date(utc, { weekday: true, year: true, withTime: true }) : "—"
  }
}

export function KindBadge({ kind }: { kind: CustomerTicketDocument["kind"] }) {
  const { t } = useI18n()
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${kind === "BOARDING_PASS" ? "bg-orange text-navy-950" : "bg-navy-950 text-white"}`}>{t(`ticketDocuments.kind.${kind}`)}</span>
}

export function PnrCopy({ pnr }: { pnr: string }) {
  const { t } = useI18n()
  const copy = async () => {
    try { await navigator.clipboard.writeText(pnr); toast.success(t("ticketDocuments.portal.copied")) } catch { toast.error(t("common.error")) }
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Ltr className="font-mono text-base font-bold tracking-widest">{pnr}</Ltr>
      <Button type="button" variant="ghost" size="icon-sm" className="pointer-coarse:size-11" onClick={() => void copy()} aria-label={t("ticketDocuments.portal.copyPnr")} title={t("ticketDocuments.portal.copyPnr")}><Copy aria-hidden /></Button>
    </span>
  )
}

export function SegmentList({ segments, compact = false }: { segments: TicketSegmentView[]; compact?: boolean }) {
  const { t, sep } = useI18n()
  const when = useWhen()
  return (
    <ol className="space-y-3">
      {segments.map((s, i) => (
        <li key={i} className={compact ? "" : "rounded-xl border border-line bg-white p-4"}>
          <p className="text-sm font-semibold"><Ltr className="font-mono">{s.carrier}{s.flightNumber}</Ltr>{s.airlineName && <>{sep}<Auto>{s.airlineName}</Auto></>}</p>
          <div className="mt-1 grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 text-sm">
            <Ltr className="font-display text-xl font-bold">{s.origin}</Ltr>
            <span><span className="sr-only">{t("ticketDocuments.portal.departs")}: </span>{when(s.departureLocal, s.departureUtc)}</span>
            <Ltr className="font-display text-xl font-bold">{s.destination}</Ltr>
            <span><span className="sr-only">{t("ticketDocuments.portal.arrives")}: </span>{when(s.arrivalLocal, s.arrivalUtc)}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Summary card for lists (account tickets, request detail). */
export function TicketCard({ doc }: { doc: CustomerTicketDocument }) {
  const { t, href, sep } = useI18n()
  const airlines = doc.airlines.map((a) => a.name ?? a.code).join(sep)
  return (
    <article className="card-brand p-4 sm:p-5" data-testid="ticket-card" aria-labelledby={`td-${doc.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`td-${doc.id}`} className="font-display text-lg"><Auto>{airlines || "—"}</Auto></h3>
          <p className="text-xs text-steel"><Ltr className="font-mono">{doc.requestRef}</Ltr></p>
        </div>
        <KindBadge kind={doc.kind} />
      </div>
      <div className="mt-3"><SegmentList segments={doc.segments} compact /></div>
      <dl className="mt-3 grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-2">
        {doc.pnr && <div><dt className="text-xs text-steel">{t("ticketDocuments.portal.pnr")}</dt><dd><PnrCopy pnr={doc.pnr} /></dd></div>}
        <div><dt className="text-xs text-steel">{t("ticketDocuments.portal.passengers")}</dt>
          <dd><ul>{doc.passengers.map((p) => <li key={p.travellerId}><Auto>{p.name}</Auto>{p.ticketNumber && <>{sep}<Ltr className="font-mono">{p.ticketNumber}</Ltr></>}</li>)}</ul></dd>
        </div>
      </dl>
      <Link href={href(`/account/tickets/${doc.id}`)} className="btn-orange mt-4 w-full !py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 sm:w-auto">{t("ticketDocuments.portal.view")}</Link>
    </article>
  )
}

/** Downloads, the new-tab boarding pass and the code viewer. The original is always offered (ADR-0038 D3). */
export function TicketActions({ doc }: { doc: CustomerTicketDocument }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try { await fn() } catch (e) {
      toast.error(e instanceof ApiError && e.code === "INTEGRITY_ALERT" ? t("ticketDocuments.errors.INTEGRITY_ALERT") : t("ticketDocuments.portal.fileFailed"))
    } finally { setBusy(null) }
  }
  const dl = (which: TicketFileWhich) => run(which, () => downloadTicketFile(doc.id, which))
  const outline = "h-10 rounded-xl border-navy-900 text-sm text-navy-900 pointer-coarse:min-h-11"
  return (
    <div className="flex flex-col gap-2">
      {doc.files.branded && <button type="button" className="btn-orange !py-2 text-sm pointer-coarse:min-h-11 [&_svg]:size-4" disabled={!!busy} onClick={() => void dl("branded")}><Download aria-hidden />{t("ticketDocuments.portal.downloadBranded")}</button>}
      <Button variant="outline" className={outline} disabled={!!busy} onClick={() => void dl("original")}><FileText aria-hidden />{t("ticketDocuments.portal.downloadOriginal")}</Button>
      {doc.kind === "BOARDING_PASS" && (
        <Button variant="outline" className={outline} disabled={!!busy} onClick={() => void run("open", () => openTicketFile(doc.id, "original"))}>
          <ExternalLink aria-hidden className="rtl:-scale-x-100" />{t("ticketDocuments.portal.openBoardingPass")}<span className="sr-only"> ({t("ticketDocuments.portal.newTab")})</span>
        </Button>
      )}
      {doc.codes.length > 0 && <CodesDialog doc={doc} />}
    </div>
  )
}

function CodeImage({ id, index, format, page }: { id: string; index: number; format: string; page: number }) {
  const { t, sep } = useI18n()
  const [failed, setFailed] = useState(false)
  return (
    <figure className="rounded-xl bg-white p-3 ring-1 ring-line">
      {failed
        ? <p role="alert" className="p-4 text-sm text-danger">{t("ticketDocuments.portal.codeFailed")}</p>
        // Served as a PNG crop of the airline page; shown pixel for pixel, never redrawn (ADR-0038 D4).
        : <img src={ticketCodeSrc(id, index)} alt={t("ticketDocuments.portal.codeAlt", { format, page })} onError={() => setFailed(true)} className="mx-auto block h-auto w-full max-w-md bg-white [image-rendering:pixelated]" />}
      <figcaption className="mt-2 text-center text-xs font-semibold text-steel"><Ltr>{format}</Ltr>{sep}{t("ticketDocuments.portal.codePage", { page })}</figcaption>
    </figure>
  )
}

export function CodesDialog({ doc }: { doc: CustomerTicketDocument }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" className="h-10 rounded-xl border-navy-900 text-sm text-navy-900 pointer-coarse:min-h-11" onClick={() => setOpen(true)}><QrCode aria-hidden />{t("ticketDocuments.portal.showCodes")}</Button>
      <DialogContent showCloseButton={false} className="max-h-[92dvh] overflow-y-auto !bg-white p-4 sm:max-w-xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="font-display text-xl">{t("ticketDocuments.portal.codesTitle")}</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="icon-sm" className="pointer-coarse:size-11" aria-label={t("common.close")} />}><X aria-hidden /></DialogClose>
        </div>
        <DialogDescription className="text-sm text-navy-900">{t("ticketDocuments.portal.codesNote")}</DialogDescription>
        {open && <div className="space-y-4">{doc.codes.map((c) => <CodeImage key={c.index} id={doc.id} index={c.index} format={c.format} page={c.page} />)}</div>}
      </DialogContent>
    </Dialog>
  )
}

export function TicketIcon() {
  return <Plane className="rotate-45 rtl:-rotate-45 rtl:-scale-x-100" aria-hidden />
}
