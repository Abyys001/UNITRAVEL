"use client"

import { api } from "./api"

/** Pre-signed upload (ch. 14.9): create a session, PUT the file directly to storage, then mark it complete for scanning. */
export async function uploadFile(file: File, type: string): Promise<{ documentId: string; filename: string }> {
  const s = await api<{ documentId: string; uploadUrl: string; headers: Record<string, string> }>("/v1/uploads", { body: { filename: file.name, mime: file.type, size: file.size, type } })
  const put = await fetch(s.uploadUrl, { method: "PUT", headers: s.headers, body: file })
  if (!put.ok) throw new Error(`Upload failed (${put.status})`)
  await api(`/v1/uploads/${s.documentId}/complete`, { body: {} })
  return { documentId: s.documentId, filename: file.name }
}
