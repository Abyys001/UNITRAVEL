import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { PERMISSIONS, type Permission, VerificationStatus } from "@unitravel/contracts"

import { canonicalMaterial, MATERIAL_FIELDS, type MaterialField, materialChanges, statusAfterMaterialChange, unverifiedTravellers, VERIFICATION_TRANSITIONS, type VerificationCommand, type VerificationFacts } from "./identity-verification"
import { evaluate, type MachineActor } from "./machine"

const staff = (perms: Permission[] = [...PERMISSIONS]): MachineActor => ({ kind: "STAFF", userId: "s", permissions: new Set(perms) })
const customer: MachineActor = { kind: "CUSTOMER", userId: "c", permissions: new Set(), isOwner: true }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const actors = [staff(), staff([]), customer, system]
const commands = Object.keys(VERIFICATION_TRANSITIONS) as VerificationCommand[]

const arbFacts: fc.Arbitrary<VerificationFacts> = fc.record({
  status: fc.constantFrom(...VerificationStatus.options),
  hasCleanScan: fc.boolean(), confirmationCurrent: fc.boolean(), reviewerIsSubject: fc.boolean(),
})

describe("verification state machine (property)", () => {
  it("VERIFIED is only reachable from SUBMITTED by staff with identity.verify, with a clean scan and a current confirmation", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(VERIFICATION_TRANSITIONS, cmd, facts, actor)
      if (r.ok && r.to === "VERIFIED") {
        expect(r.from).toBe("SUBMITTED")
        expect(actor.kind).toBe("STAFF")
        expect(actor.permissions.has("identity.verify")).toBe(true)
        expect(facts.hasCleanScan && facts.confirmationCurrent && !facts.reviewerIsSubject).toBe(true)
      }
    }), { numRuns: 4000 })
  })
  it("SUBMITTED is only reached by the customer (confirm, with a scan) or by a material change from VERIFIED", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(VERIFICATION_TRANSITIONS, cmd, facts, actor)
      if (r.ok && r.to === "SUBMITTED") {
        expect(actor.kind).toBe("CUSTOMER")
        expect(cmd === "confirm" ? ["UNVERIFIED", "REJECTED", "CORRECTION_REQUIRED"].includes(facts.status) && facts.hasCleanScan : facts.status === "VERIFIED").toBe(true)
      }
    }), { numRuns: 4000 })
  })
  it("every staff decision starts at SUBMITTED, and rejection or correction never reaches VERIFIED", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom("verify", "reject", "require_correction" as const), (facts, cmd) => {
      const r = evaluate(VERIFICATION_TRANSITIONS, cmd, facts, staff())
      if (r.ok) expect(r.from).toBe("SUBMITTED")
      if (r.ok && cmd !== "verify") expect(r.to).not.toBe("VERIFIED")
    }), { numRuns: 2000 })
  })
  it("a customer cannot self-verify, whatever the facts", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), (facts, cmd) => {
      const r = evaluate(VERIFICATION_TRANSITIONS, cmd, facts, customer)
      if (r.ok) expect(r.to).toBe("SUBMITTED")
    }), { numRuns: 2000 })
  })
  it("CORRECTION_REQUIRED and REJECTED go back to SUBMITTED on resubmit", () => {
    for (const status of ["CORRECTION_REQUIRED", "REJECTED"] as const) {
      expect(evaluate(VERIFICATION_TRANSITIONS, "confirm", { status, hasCleanScan: true, confirmationCurrent: true }, customer)).toMatchObject({ ok: true, to: "SUBMITTED" })
    }
    expect(evaluate(VERIFICATION_TRANSITIONS, "confirm", { status: "VERIFIED", hasCleanScan: true, confirmationCurrent: true }, customer).ok).toBe(false)
  })
  it("a material change moves VERIFIED to SUBMITTED and leaves every other state alone", () => {
    for (const s of VerificationStatus.options) expect(statusAfterMaterialChange(s)).toBe(s === "VERIFIED" ? "SUBMITTED" : s)
    expect(evaluate(VERIFICATION_TRANSITIONS, "material_change", { status: "VERIFIED", hasCleanScan: true, confirmationCurrent: true }, customer)).toMatchObject({ ok: true, to: "SUBMITTED" })
  })
  it("nobody reviews their own details", () => {
    expect(evaluate(VERIFICATION_TRANSITIONS, "verify", { status: "SUBMITTED", hasCleanScan: true, confirmationCurrent: true, reviewerIsSubject: true }, staff()).ok).toBe(false)
    expect(evaluate(VERIFICATION_TRANSITIONS, "verify", { status: "SUBMITTED", hasCleanScan: true, confirmationCurrent: true }, staff([])).ok).toBe(false)
  })
})

const arbValues = fc.record({
  number: fc.stringMatching(/^[A-Z0-9]{6,9}$/), givenNames: fc.stringMatching(/^[A-Z]{2,10}$/), surname: fc.stringMatching(/^[A-Z]{2,10}$/),
  dateOfBirth: fc.constantFrom("1990-01-01", "1985-06-30"), nationality: fc.constantFrom("IR", "GB"), issuingCountry: fc.constantFrom("IR", "GB"),
  expiryDate: fc.constantFrom("2030-01-01", "2032-05-05"), scanDocumentId: fc.option(fc.uuid(), { nil: null }),
})

describe("material changes", () => {
  it("lists exactly the fields that differ, ignoring case and spacing", () => {
    fc.assert(fc.property(arbValues, arbValues, (a, b) => {
      const changed = materialChanges(a, b)
      for (const k of MATERIAL_FIELDS) expect(changed.includes(k)).toBe(String(a[k] ?? "").toUpperCase() !== String(b[k] ?? "").toUpperCase())
      expect(materialChanges(a, { ...a, givenNames: ` ${a.givenNames.toLowerCase()}  ` })).toEqual([])
    }))
  })
  it("a Persian-name edit is not material and does not change the confirmed hash", () => {
    fc.assert(fc.property(arbValues, fc.string(), fc.string(), (a, fa1, fa2) => {
      const x = { ...a, nameFa: fa1 } as Record<string, string | null>
      const y = { ...a, nameFa: fa2 } as Record<string, string | null>
      expect(materialChanges(x as Partial<Record<MaterialField, string>>, y as Partial<Record<MaterialField, string>>)).toEqual([])
      expect(canonicalMaterial(x as Partial<Record<MaterialField, string>>)).toBe(canonicalMaterial(y as Partial<Record<MaterialField, string>>))
    }))
  })
  it("each material field changes the canonical text", () => {
    fc.assert(fc.property(arbValues, fc.constantFrom(...MATERIAL_FIELDS), (a, field) => {
      const b = { ...a, [field]: field === "scanDocumentId" ? "00000000-0000-4000-8000-000000000001" : `${a[field] ?? ""}9` }
      expect(canonicalMaterial(b)).not.toBe(canonicalMaterial(a))
    }))
  })
})

describe("record_tickets guard helper", () => {
  it("lists every traveller whose status is not VERIFIED", () => {
    fc.assert(fc.property(fc.array(fc.option(fc.constantFrom(...VerificationStatus.options), { nil: null }), { maxLength: 6 }), (statuses) => {
      const out = unverifiedTravellers(statuses.map((status) => ({ status })))
      expect(out.length).toBe(statuses.filter((s) => s !== "VERIFIED").length)
    }))
  })
})
