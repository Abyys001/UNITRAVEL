"use client"

import { useQueryClient } from "@tanstack/react-query"

import type { CmsKind, CmsStaffEntry, CmsStatus, GlossaryTermView } from "@unitravel/contracts"
import { StatusChip } from "@/components/bento"
import { statusTone } from "@/components/case"
import { ApiError, errText } from "@/lib/api"
import { type MsgKey, useT } from "@/lib/i18n"

/** Content system (ADR-0017) building blocks for the Admin Panel. The server decides every permission and rule. */

export const KINDS: readonly CmsKind[] = ["ARTICLE", "GUIDE", "LEGAL", "PAGE"]
export const STATUSES: readonly CmsStatus[] = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"]
export const SERVICES = ["flights", "hotels", "trains", "buses", "stays", "visa", "tours", "cip", "cargo", "insurance", "track", "support", "club"] as const
export const GLOSSARY_CATEGORIES = ["FLIGHT", "BAGGAGE", "CLASS", "HOTEL", "ROOM", "MEAL"] as const

/** List rows carry what the table needs; the full entry (body, claims) comes from the detail call. */
export type EntryRow = Pick<CmsStaffEntry, "id" | "kind" | "locale" | "slug" | "title" | "status" | "updatedAt" | "claimsToVerify" | "version">
export type GlossaryRow = GlossaryTermView & { id: string }
export interface Paged<R> { items: R[]; total: number; page: number; pageSize: number }

/** Accepts both `{ items }` and a bare array so the screen survives either list shape. */
export const asPaged = <R,>(r: Paged<R> | R[]): Paged<R> => (Array.isArray(r) ? { items: r, total: r.length, page: 1, pageSize: r.length || 1 } : r)

export function useContentLabels() {
  const t = useT()
  return {
    t,
    kind: (k: string) => t(`cms.kind.${k}` as MsgKey),
    status: (s: string) => t(`cms.st.${s}` as MsgKey),
    service: (s: string) => t(`cms.svc.${s}` as MsgKey),
    category: (c: string) => t(`cms.gl.cat.${c}` as MsgKey),
  }
}

export const StatusPill = ({ status, label }: { status: string; label: string }) => <StatusChip tone={statusTone(status)}><span data-status={status}>{label}</span></StatusChip>

/** Where an entry lives on the customer site; only published entries have a page. */
export function webUrl(e: Pick<CmsStaffEntry, "kind" | "locale" | "slug" | "status">): string | null {
  if (e.status !== "PUBLISHED") return null
  const base = process.env.NEXT_PUBLIC_WEB_URL ?? (typeof window === "undefined" ? "" : `${window.location.protocol}//${window.location.hostname.replace(/^admin\./, "")}${window.location.hostname.endsWith("localhost") ? ":4000" : ""}`)
  const path = e.kind === "ARTICLE" ? `blog/${e.slug}` : e.kind === "GUIDE" ? `guides/${e.slug}` : e.slug
  return `${base}/${e.locale}/${path}`
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.code === "VERSION_CONFLICT"

export function contentError(e: unknown, t: ReturnType<typeof useT>): Error {
  if (isConflict(e)) return new Error(t("cms.conflict"))
  if (e instanceof ApiError && (e.code === "SLUG_TAKEN" || e.code === "CONFLICT")) return new Error(t("cms.err.SLUG_TAKEN"))
  return new Error(errText(e))
}

export function useContentRefresh() {
  const qc = useQueryClient()
  return async () => { await qc.invalidateQueries({ queryKey: ["cms"] }) }
}

export const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)

/** Transitions offered from each state. Publishing, unpublishing and archiving need `cms.publish`. */
export const NEXT: Record<CmsStatus, CmsStatus[]> = { DRAFT: ["IN_REVIEW", "ARCHIVED"], IN_REVIEW: ["DRAFT", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["DRAFT", "ARCHIVED"], ARCHIVED: ["DRAFT"] }
export const NEEDS_PUBLISH = (from: CmsStatus, to: CmsStatus) => to === "PUBLISHED" || to === "ARCHIVED" || from === "PUBLISHED"

