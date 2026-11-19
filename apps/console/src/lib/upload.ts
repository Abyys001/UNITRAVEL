"use client"

import type { UploadSession, UploadStatus } from "@unitravel/contracts"

import { api } from "./api"

/** Headers the browser sets itself and refuses from scripts; the signature still covers them. */
const FORBIDDEN = new Set(["content-length", "host"])

/** PUT the file to the pre-signed URL with exactly the headers the API returned (write-once keys need If-None-Match: *). */
function put(session: UploadSession, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", session.uploadUrl)
    for (const [k, v] of Object.entries(session.headers)) if (!FORBIDDEN.has(k.toLowerCase())) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload refused by storage (${xhr.status})`)))
    xhr.onerror = () => reject(new Error("Upload failed: storage could not be reached"))
    xhr.send(file)
  })
}

export type ScanStatus = UploadStatus["scanStatus"]

/**
 * Pre-signed staff upload (ADR-0038 D2, ch. 14.9): create the session, PUT the bytes straight to storage, complete it, then
 * poll the virus scan until it is CLEAN or INFECTED. `base` is the session endpoint, e.g. /v1/admin/ticket-documents/uploads.
 */
export async function uploadAndScan(base: string, body: Record<string, unknown>, file: File, cb: { progress: (pct: number) => void; scanning: () => void }, signal?: AbortSignal): Promise<UploadStatus> {
  const session = await api<UploadSession>(base, { body })
  await put(session, file, cb.progress)
  await api(`${base}/${session.documentId}/complete`, { body: {} })
  cb.scanning()
  for (let i = 0; i < 90; i++) {
    if (signal?.aborted) throw new Error("Cancelled")
    const s = await api<UploadStatus>(`${base}/${session.documentId}`)
    if (s.scanStatus !== "PENDING") return s
    await new Promise((r) => setTimeout(r, Math.min(1000 + i * 250, 4000)))
  }
  throw new Error("The virus check is taking too long. Try again in a minute.")
}
