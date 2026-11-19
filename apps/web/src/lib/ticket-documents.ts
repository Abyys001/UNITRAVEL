"use client"

import type { CustomerTicketDocument, SignedFile, TicketFileWhich } from "@unitravel/contracts"

import { api } from "./api"

/** Files go through a 5-minute signed URL issued after an ownership and sha256 check (ADR-0038 D2, D8). */
export async function downloadTicketFile(id: string, which: TicketFileWhich) {
  const r = await api<SignedFile>(`/v1/ticket-documents/${id}/files/${which}`)
  window.location.assign(r.url)
}

/** The tab opens inside the click so popup blockers allow it; the signed URL is filled in once the API answers. */
export async function openTicketFile(id: string, which: TicketFileWhich) {
  const tab = window.open("", "_blank")
  if (tab) tab.opener = null
  try {
    const r = await api<SignedFile>(`/v1/ticket-documents/${id}/files/${which}?disposition=inline`)
    if (tab) tab.location.href = r.url
    else window.location.assign(r.url)
  } catch (e) {
    tab?.close()
    throw e
  }
}

/** PNG crop of the original page around a decoded code; served as is, never re-encoded (ADR-0038 D4). */
export const ticketCodeSrc = (id: string, index: number) => `/api/v1/ticket-documents/${id}/codes/${index}`

/** A ticket is upcoming until its last segment has landed (or departed, when no arrival is recorded). */
export function isUpcoming(d: CustomerTicketDocument, now = Date.now()) {
  const last = d.segments.at(-1)
  if (!last) return true
  return Date.parse(last.arrivalUtc ?? last.departureUtc) >= now
}

const firstDeparture = (d: CustomerTicketDocument) => (d.segments[0] ? Date.parse(d.segments[0].departureUtc) : Date.parse(d.issuedAt))

/** Upcoming soonest first, past most recent first. */
export function groupTickets(items: CustomerTicketDocument[], now = Date.now()) {
  const upcoming = items.filter((d) => isUpcoming(d, now)).sort((a, b) => firstDeparture(a) - firstDeparture(b))
  const past = items.filter((d) => !isUpcoming(d, now)).sort((a, b) => firstDeparture(b) - firstDeparture(a))
  return { upcoming, past }
}
