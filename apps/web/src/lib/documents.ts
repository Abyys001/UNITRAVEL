"use client"

import { api } from "./api"

/** Downloads go through a 5-minute signed URL issued after an ownership check (ch. 24.3). */
export async function download(id: string) {
  const r = await api<{ url: string }>(`/v1/documents/${id}/download`)
  window.location.assign(r.url)
}
