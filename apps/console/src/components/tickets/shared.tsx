"use client"

import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Download, FileUp, Loader2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { type CodeIntegrityResult, type SignedFile, TICKET_ORIGINAL_MAX_BYTES, type TicketDocumentKind, type TicketPreview } from "@unitravel/contracts"
import { Button } from "@unitravel/ui/components/button"
import { cn } from "@unitravel/ui/lib/utils"

import { ApiError, api, errText } from "@/lib/api"
import { type MsgKey, type T, useT } from "@/lib/i18n"
import { uploadAndScan } from "@/lib/upload"

export const UPLOADS = "/v1/admin/ticket-documents/uploads"
export const kindLabel = (t: T, k: TicketDocumentKind) => t(k === "E_TICKET" ? "td.kind.E_TICKET" : "td.kind.BOARDING_PASS")

/** The two refusals staff must read rather than skim: a code that did not survive branding, and a stored file that changed. */
export function ticketError(e: unknown, t: T): string {
  if (e instanceof ApiError && e.code === "CODE_INTEGRITY_FAILED") return t("td.err.integrity")
  if (e instanceof ApiError && e.code === "INTEGRITY_ALERT") return t("td.err.alert")
  return errText(e)
}

export function TicketErrorLine({ error }: { error: unknown }) {
  const t = useT()
  if (!error) return null
  const severe = error instanceof ApiError && (error.code === "CODE_INTEGRITY_FAILED" || error.code === "INTEGRITY_ALERT")
  return (
    <p role="alert" className={cn("flex items-start gap-2 rounded-sm px-3 py-2", severe ? "border border-danger bg-danger-subtle font-medium text-danger" : "bg-danger-subtle text-danger")} data-testid="td-error">
      {severe && <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}<span>{ticketError(error, t)}</span>
    </p>
  )
}

/** Opens a fresh signed URL for one file (the API re-checks the sha256 and audits the read first). */
export async function downloadTicketFile(id: string, which: "original" | "branded", t: T) {
  try { const f = await api<SignedFile>(`/v1/admin/ticket-documents/${id}/files/${which}`); window.location.assign(f.url) } catch (e) { toast.error(ticketError(e, t)) }
}

export function DownloadButtons({ id, branded, size = "sm" }: { id: string; branded: boolean; size?: "xs" | "sm" }) {
  const t = useT()
  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button type="button" size={size} variant="outline" onClick={() => void downloadTicketFile(id, "original", t)} data-testid="dl-original"><Download aria-hidden />{t("td.dl.original")}</Button>
      {branded && <Button type="button" size={size} variant="outline" onClick={() => void downloadTicketFile(id, "branded", t)} data-testid="dl-branded"><Download aria-hidden />{t("td.dl.branded")}</Button>}
    </span>
  )
}

type Phase = { s: "idle" } | { s: "uploading"; pct: number } | { s: "scanning" } | { s: "clean"; documentId: string; filename: string } | { s: "infected"; filename: string } | { s: "error"; message: string }

/**
 * Drop zone for the provider's PDF (ADR-0038 D2): PDF only, 10 MB, uploaded to the write-once prefix, then held until the
 * virus check says CLEAN. Checks here only spare a round trip; the API and the storage signature enforce them.
 */
export function PdfDrop({ requestRef, onReady, testId = "pdf-drop" }: { requestRef: string; onReady: (doc: { documentId: string; filename: string } | null) => void; testId?: string }) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>({ s: "idle" })
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const take = async (file: File | undefined) => {
    if (!file) return
    onReady(null)
    if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) { setPhase({ s: "error", message: t("td.up.notPdf") }); return }
    if (file.size > TICKET_ORIGINAL_MAX_BYTES) { setPhase({ s: "error", message: t("td.up.tooBig") }); return }
    if (file.size === 0) { setPhase({ s: "error", message: t("td.up.empty") }); return }
    abort.current?.abort()
    abort.current = new AbortController()
    setPhase({ s: "uploading", pct: 0 })
    try {
      const r = await uploadAndScan(UPLOADS, { requestRef, filename: file.name, mime: "application/pdf", size: file.size }, file, { progress: (pct) => setPhase({ s: "uploading", pct }), scanning: () => setPhase({ s: "scanning" }) }, abort.current.signal)
      if (r.scanStatus === "CLEAN") { setPhase({ s: "clean", documentId: r.documentId, filename: r.filename }); onReady({ documentId: r.documentId, filename: r.filename }) }
      else setPhase({ s: "infected", filename: r.filename })
    } catch (e) { setPhase({ s: "error", message: errText(e) }) }
  }
  const busy = phase.s === "uploading" || phase.s === "scanning"
  return (
    <div data-testid={testId}>
      <div
        role="button" tabIndex={0} aria-disabled={busy} aria-describedby={`${testId}-hint`}
        onClick={() => !busy && input.current?.click()} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); input.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) void take(e.dataTransfer.files[0]) }}
        className={cn("grid cursor-pointer place-items-center gap-2 rounded-[var(--radius-card)] border-2 border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
          over ? "border-royal bg-info-subtle" : "border-rule-strong bg-surface hover:border-control", busy && "cursor-progress")}>
        <FileUp className="size-7 text-steel" aria-hidden />
        <p className="font-medium">{t("td.up.drop")}</p>
        <p id={`${testId}-hint`} className="text-meta text-steel">{t("td.up.hint")}</p>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-label={t("td.up.choose")} onChange={(e) => { void take(e.target.files?.[0]); e.target.value = "" }} data-testid={`${testId}-input`} />
      </div>
      <div aria-live="polite" className="mt-2 min-h-6 text-meta">
        {phase.s === "uploading" && (
          <div className="space-y-1"><p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" aria-hidden />{t("td.up.uploading", { n: phase.pct })}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunk" role="progressbar" aria-valuenow={phase.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("td.up.progress")}><div className="h-full bg-royal transition-[width]" style={{ width: `${phase.pct}%` }} /></div></div>
        )}
        {phase.s === "scanning" && <p className="flex items-center gap-2 text-steel"><Loader2 className="size-4 animate-spin" aria-hidden />{t("td.up.scanning")}</p>}
        {phase.s === "clean" && <p className="flex items-center gap-2 text-success" data-testid="scan-clean"><CheckCircle2 className="size-4" aria-hidden /><bdi dir="ltr" className="font-mono">{phase.filename}</bdi> · {t("td.up.clean")}</p>}
        {phase.s === "infected" && <p role="alert" className="flex items-center gap-2 rounded-sm bg-danger-subtle px-2 py-1.5 text-danger" data-testid="scan-failed"><XCircle className="size-4" aria-hidden />{t("td.up.infected", { f: phase.filename })}</p>}
        {phase.s === "error" && <p role="alert" className="rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{phase.message}</p>}
      </div>
    </div>
  )
}

const WRAP_REASON: Record<string, MsgKey> = { SIGNED: "td.wrap.SIGNED", ENCRYPTED: "td.wrap.ENCRYPTED", INTEGRITY_FAILED: "td.wrap.INTEGRITY_FAILED", UNREADABLE: "td.wrap.UNREADABLE" }

/** D4 result as staff need it before issuing: each decoded code with its match, the wrapper mode, and the text checks. */
export function IntegrityPanel({ v }: { v: CodeIntegrityResult }) {
  const t = useT()
  const missing = new Set(v.missing)
  const text = [...(v.textMatches.pnr ? [{ label: t("td.pnr"), m: v.textMatches.pnr }] : []), ...v.textMatches.ticketNumbers.map((m) => ({ label: t("td.ticketNo"), m }))]
  return (
    <div className="space-y-4" data-testid="integrity">
      <div className={cn("flex items-start gap-2 rounded-md border px-3 py-2.5", v.allMatched ? "border-success/40 bg-success-subtle" : "border-danger bg-danger-subtle")}>
        {v.allMatched ? <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />}
        <div>
          <p className={cn("font-semibold", v.allMatched ? "text-success" : "text-danger")} data-testid="integrity-verdict">{v.allMatched ? (v.codesOriginal.length ? t("td.int.ok", { n: v.codesOriginal.length }) : t("td.int.none")) : t("td.int.failed", { n: v.missing.length })}</p>
          <p className="text-meta text-steel">{t("td.int.pages", { o: v.pages.original, b: v.pages.branded })}{v.signed && ` · ${t("td.int.signed")}`}{v.encrypted && ` · ${t("td.int.encrypted")}`}</p>
        </div>
      </div>
      {v.codesOriginal.length > 0 && (
        <div>
          <h3 className="cap mb-1">{t("td.int.codes")}</h3>
          <ul className="divide-y divide-rule rounded-md border border-rule" data-testid="integrity-codes">
            {v.codesOriginal.map((c, i) => {
              const ok = !missing.has(i)
              return (
                <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2">
                  <span className="font-mono text-meta" dir="ltr">{c.format}</span>
                  <span className="min-w-0 truncate font-mono text-caption text-steel" dir="ltr" title={c.text}>{t("td.int.page", { n: c.page })} · {c.text || "—"}</span>
                  <span className={cn("inline-flex items-center gap-1 text-meta font-medium", ok ? "text-success" : "text-danger")}>{ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}{ok ? t("td.int.match") : t("td.int.mismatch")}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div>
        <h3 className="cap mb-1">{t("td.int.wrapper")}</h3>
        <p data-testid="wrapper-mode"><span className="font-medium">{v.wrapperMode === "FULL" ? t("td.wrap.FULL") : t("td.wrap.COVER_ONLY")}</span>{v.wrapperReason && <span className="text-steel"> · {t(WRAP_REASON[v.wrapperReason] ?? "td.wrap.UNREADABLE")}</span>}</p>
      </div>
      {text.length > 0 && (
        <div>
          <h3 className="cap mb-1">{t("td.int.text")}</h3>
          <ul className="space-y-1" data-testid="text-matches">
            {text.map(({ label, m }, i) => (
              <li key={i} className="flex items-center justify-between gap-2"><span>{label} <bdi dir="ltr" className="font-mono">{m.value}</bdi></span><span className={cn("text-meta font-medium", m.found ? "text-success" : "text-orange-700 dark:text-orange-300")}>{m.found ? `✓ ${t("td.int.found")}` : `! ${t("td.int.notFound")}`}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * The signed URLs are attachments (Content-Disposition), so an iframe would download them; the bytes are fetched and shown
 * from a blob: URL instead. Object URLs are revoked when the preview changes or unmounts.
 */
function useBlobUrl(file: SignedFile | null | undefined) {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null })
  useEffect(() => {
    if (!file) return
    let url: string | null = null
    let live = true
    fetch(file.url).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: "application/pdf" }))
      if (live) setState({ url, error: null })
    }).catch((e: unknown) => { if (live) setState({ url: null, error: errText(e) }) })
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [file])
  return state
}

function PdfFrame({ title, file, testId }: { title: string; file: SignedFile | null | undefined; testId: string }) {
  const t = useT()
  const { url, error } = useBlobUrl(file)
  return (
    <figure className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface-raised" data-testid={testId}>
      <figcaption className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2"><span className="font-medium">{title}</span>{url && <a href={url} target="_blank" rel="noopener" className="text-meta text-link hover:underline">{t("td.prev.open")}</a>}</figcaption>
      {file === null ? <p className="p-6 text-center text-steel">{t("td.prev.noBranded")}</p>
        : error ? <p role="alert" className="m-3 rounded-sm bg-danger-subtle px-2 py-1.5 text-danger">{t("td.prev.failed")} ({error})</p>
        : !url ? <div className="grid h-[28rem] place-items-center text-steel md:h-[36rem]"><Loader2 className="size-5 animate-spin" aria-label={t("td.prev.loading")} /></div>
        : <iframe src={url} title={title} className="h-[28rem] w-full bg-white md:h-[36rem]" />}
    </figure>
  )
}

/** Original and branded file next to each other (stacked on phones); both stay downloadable. */
export function PreviewPair({ id, branded }: { id: string; branded: boolean }) {
  const t = useT()
  const q = useQuery({ queryKey: ["td-preview", id], queryFn: () => api<TicketPreview>(`/v1/admin/ticket-documents/${id}/preview`), staleTime: 240_000, refetchOnWindowFocus: false })
  return (
    <div className="space-y-3">
      {q.error && <TicketErrorLine error={q.error} />}
      <div className="grid gap-3 lg:grid-cols-2" data-testid="preview-pair">
        <PdfFrame title={t("td.prev.original")} file={q.data?.original} testId="preview-original" />
        <PdfFrame title={t("td.prev.branded")} file={q.data ? q.data.branded : undefined} testId="preview-branded" />
      </div>
      <DownloadButtons id={id} branded={branded} />
    </div>
  )
}
