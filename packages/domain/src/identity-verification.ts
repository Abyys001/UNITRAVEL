import type { VerificationStatus } from "@unitravel/contracts"

import type { TransitionTable } from "./machine"

// ADR-0005: verification of a traveller document. All state decisions live here; the API only supplies the facts.

export interface VerificationFacts {
  status: VerificationStatus
  /** A scan that passed the virus check and metadata strip is attached to the document. */
  hasCleanScan: boolean
  /** The values the customer confirmed are still the values on file (hash equal). */
  confirmationCurrent: boolean
  /** The staff member is the owner of the traveller being reviewed. */
  reviewerIsSubject?: boolean
}

export type VerificationCommand = "confirm" | "material_change" | "verify" | "reject" | "require_correction"

/** What the customer may resubmit from. */
export const RESUBMITTABLE: readonly VerificationStatus[] = ["UNVERIFIED", "REJECTED", "CORRECTION_REQUIRED"]

const decidable = (f: VerificationFacts): string | null => {
  if (f.reviewerIsSubject) return "Nobody can review their own details"
  if (!f.confirmationCurrent) return "The customer changed their details after confirming; reload"
  return null
}
const verifiable = (f: VerificationFacts): string | null => decidable(f) ?? (f.hasCleanScan ? null : "The passport scan is missing or has not passed the checks")

export const VERIFICATION_TRANSITIONS: TransitionTable<VerificationStatus, VerificationFacts, VerificationCommand> = {
  confirm: {
    from: RESUBMITTABLE, to: "SUBMITTED", actor: "CUSTOMER",
    guard: (f) => (f.hasCleanScan ? null : "Upload a passport scan before confirming"),
  },
  material_change: { from: ["VERIFIED"], to: "SUBMITTED", actor: "CUSTOMER" },
  verify: { from: ["SUBMITTED"], to: "VERIFIED", actor: "STAFF", permissions: ["identity.verify"], guard: verifiable },
  reject: { from: ["SUBMITTED"], to: "REJECTED", actor: "STAFF", permissions: ["identity.verify"], guard: decidable },
  require_correction: { from: ["SUBMITTED"], to: "CORRECTION_REQUIRED", actor: "STAFF", permissions: ["identity.verify"], guard: decidable },
}

/** Fields whose change makes a verification stale. The Persian name, title, gender and relationship are not material. */
export const MATERIAL_FIELDS = ["number", "givenNames", "surname", "dateOfBirth", "nationality", "issuingCountry", "expiryDate", "scanDocumentId"] as const
export type MaterialField = (typeof MATERIAL_FIELDS)[number]
export type MaterialValues = Record<MaterialField, string | null>

const norm = (v: string | null | undefined): string | null => (v == null ? null : v.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase())

export function normaliseMaterial(v: Partial<Record<MaterialField, string | null | undefined>>): MaterialValues {
  return Object.fromEntries(MATERIAL_FIELDS.map((k) => [k, k === "scanDocumentId" ? (v[k] ?? null) : norm(v[k])])) as MaterialValues
}

/** The material fields that differ; empty means the edit leaves a verification intact. */
export function materialChanges(before: Partial<Record<MaterialField, string | null | undefined>>, after: Partial<Record<MaterialField, string | null | undefined>>): MaterialField[] {
  const a = normaliseMaterial(before)
  const b = normaliseMaterial(after)
  return MATERIAL_FIELDS.filter((k) => a[k] !== b[k])
}

/** Stable text that is hashed (keyed) to bind a confirmation and a decision to exactly these values. */
export function canonicalMaterial(v: Partial<Record<MaterialField, string | null | undefined>>): string {
  const n = normaliseMaterial(v)
  return JSON.stringify(MATERIAL_FIELDS.map((k) => [k, n[k]]))
}

/** Status after a material edit: only a VERIFIED record falls back; other states wait for the customer to confirm. */
export function statusAfterMaterialChange(status: VerificationStatus): VerificationStatus {
  return status === "VERIFIED" ? "SUBMITTED" : status
}

/** record_tickets guard (owner decision 4): travellers on the request that are not VERIFIED. */
export function unverifiedTravellers<T extends { status: VerificationStatus | null }>(travellers: readonly T[]): T[] {
  return travellers.filter((t) => t.status !== "VERIFIED")
}

export const TRAVELLERS_NOT_VERIFIED = "Every traveller needs a VERIFIED passport or ID"
