"use client"

import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CircleCheck, FileText, Loader2, Paperclip, ShieldX, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Auto } from "@/components/badges"
import { api } from "@/lib/api"
import { download } from "@/lib/documents"
import { useI18n } from "@/lib/i18n"
import { uploadFile } from "@/lib/upload"

// Uploads are signed-in only and ClamAV-scanned (ch. 24.3). Only CLEAN files are sent: the API serves nothing else, so a
// file still being scanned would sit invisible on the request.

export type UploadState = "uploading" | "scanning" | "ready" | "blocked" | "failed"
export interface UploadItem { key: string; filename: string; documentId?: string; state: UploadState }

const ACCEPT = "application/pdf,image/jpeg,image/png"
const MAX_BYTES = 10 * 1024 * 1024
const POLL_MS = 1000
const POLL_TRIES = 90
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Upload, then poll the scan; the list survives step changes because the caller holds it above the steps. */
export function useDocumentUploads(max: number) {
  const [items, setItems] = useState<UploadItem[]>([])
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const update = (key: string, p: Partial<UploadItem>) => { if (alive.current) setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))) }

  const one = async (file: File) => {
    const key = crypto.randomUUID()
    setItems((xs) => [...xs, { key, filename: file.name, state: "uploading" }])
    if (file.size > MAX_BYTES || !ACCEPT.split(",").includes(file.type)) { update(key, { state: "failed" }); return }
    try {
      const { documentId } = await uploadFile(file, "OTHER")
      update(key, { documentId, state: "scanning" })
      for (let i = 0; i < POLL_TRIES && alive.current; i++) {
        await wait(POLL_MS)
        const s = (await api<{ scanStatus: "PENDING" | "CLEAN" | "INFECTED" }>(`/v1/uploads/${documentId}`)).scanStatus
        if (s === "CLEAN") { update(key, { state: "ready" }); return }
        if (s === "INFECTED") { update(key, { state: "blocked" }); return }
      }
      // Still pending after the wait: it stays "scanning" and is not sent; the customer can remove it or add it later.
    } catch {
      update(key, { state: "failed" })
    }
  }

  const add = (files: FileList | null) => {
    if (!files) return
    const room = Math.max(0, max - items.length)
    for (const f of Array.from(files).slice(0, room)) void one(f)
  }
  const remove = (key: string) => setItems((xs) => xs.filter((x) => x.key !== key))
  const ready = items.filter((x) => x.state === "ready" && x.documentId).map((x) => x.documentId!)
  const pending = items.some((x) => x.state === "uploading" || x.state === "scanning")
  return { items, add, remove, clear: () => setItems([]), ready, pending, full: items.length >= max, max }
}
export type DocumentUploads = ReturnType<typeof useDocumentUploads>

const STATE_ICON: Record<UploadState, React.ReactNode> = {
  uploading: <Loader2 className="size-4 animate-spin text-steel" aria-hidden />,
  scanning: <Loader2 className="size-4 animate-spin text-royal" aria-hidden />,
  ready: <CircleCheck className="size-4 text-success" aria-hidden />,
  blocked: <ShieldX className="size-4 text-danger" aria-hidden />,
  failed: <CircleAlert className="size-4 text-danger" aria-hidden />,
}

/** File picker plus the list with each file's scan state; `compact` is the message box's inline version. */
export function UploadList({ uploads, id, compact, hint }: { uploads: DocumentUploads; id: string; compact?: boolean; hint?: string }) {
  const { t } = useI18n()
  const label: Record<UploadState, string> = {
    uploading: t("guide.visa.docs.uploading"), scanning: t("guide.visa.docs.scanning"), ready: t("guide.visa.docs.ready"),
    blocked: t("guide.visa.docs.blocked"), failed: t("guide.visa.docs.failed"),
  }
  return (
    <div className="min-w-0 space-y-2">
      {uploads.items.length > 0 && (
        <ul className="grid gap-2" aria-label={t("guide.visa.attachments.attached")}>
          {uploads.items.map((x) => (
            <li key={x.key} className={`flex min-w-0 items-center gap-3 rounded-xl border bg-white px-3 ${compact ? "py-1.5" : "py-2.5"} text-sm ${x.state === "blocked" || x.state === "failed" ? "border-danger/40" : "border-line"}`}>
              <FileText className="size-4 shrink-0 text-steel" aria-hidden />
              <span className="min-w-0 flex-1">
                <Auto className="block truncate font-medium text-navy-950">{x.filename}</Auto>
                <span role="status" className="flex items-center gap-1.5 text-xs text-steel">{STATE_ICON[x.state]}{label[x.state]}</span>
              </span>
              <button type="button" onClick={() => uploads.remove(x.key)} aria-label={t("guide.visa.docs.remove", { name: x.filename })}
                className="grid size-9 shrink-0 place-items-center rounded-full text-steel outline-none hover:bg-cloud hover:text-danger focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:size-11">
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploads.full ? (
        <p className="text-xs text-steel">{t("guide.visa.docs.limit", { max: uploads.max })}</p>
      ) : (
        <div className={compact ? "flex flex-wrap items-center gap-x-3 gap-y-1" : "space-y-1"}>
          {/* A real file input inside the label: keyboard and screen readers reach it, the label is the visible button. */}
          <label htmlFor={id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-navy-900 bg-white px-4 text-sm font-semibold text-navy-950 transition-colors focus-within:ring-[3px] focus-within:ring-royal/50 hover:bg-cloud">
            <Paperclip className="size-4" aria-hidden />{compact ? t("guide.visa.attachments.attach") : t("guide.visa.docs.add")}
            <input id={id} type="file" multiple accept={ACCEPT} className="sr-only" aria-describedby={`${id}-hint`}
              onChange={(e) => { uploads.add(e.target.files); e.target.value = "" }} />
          </label>
          <p id={`${id}-hint`} className="text-xs text-steel">{hint ?? t("guide.visa.docs.accepted", { max: uploads.max })}</p>
        </div>
      )}
    </div>
  )
}

/** A document on a request message. The customer's own uploads show their file name; staff files a numbered label. */
export function AttachmentLink({ id, n, own }: { id: string; n: number; own: boolean }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const meta = useQuery({ queryKey: ["upload", id], queryFn: () => api<{ filename: string }>(`/v1/uploads/${id}`), enabled: own, retry: false, staleTime: Infinity })
  const name = meta.data?.filename ?? t("guide.visa.attachments.document", { n })
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={() => { setFailed(false); download(id).catch(() => setFailed(true)) }}
        aria-label={t("guide.visa.attachments.open", { name })}
        className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full bg-white/90 px-3 text-xs font-semibold text-navy-950 underline-offset-2 outline-none ring-1 ring-line hover:underline focus-visible:ring-[3px] focus-visible:ring-royal/50 pointer-coarse:min-h-11">
        <Paperclip className="size-3.5 shrink-0" aria-hidden /><Auto className="truncate">{name}</Auto>
      </button>
      {failed && <span role="alert" className="mt-1 text-xs font-medium text-danger">{t("guide.visa.attachments.openFailed")}</span>}
    </span>
  )
}
