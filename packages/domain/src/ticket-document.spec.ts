import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { TICKET_DOCUMENT_STATUSES } from "@unitravel/contracts"

import { allowedCommands, evaluate, type MachineActor } from "./machine"
import {
  isCustomerVisibleTicketDocument, missingCodes, originalIntact, textContains, TICKET_DOCUMENT_FINAL, TICKET_DOCUMENT_TRANSITIONS, type TicketDocumentCommandName, type TicketDocumentFacts,
} from "./ticket-document"

const issuer: MachineActor = { kind: "STAFF", userId: "s1", permissions: new Set(["ticket.document.issue", "ticket.document.resend", "ticket.record"]) }
const reader: MachineActor = { kind: "STAFF", userId: "s2", permissions: new Set(["ticket.record"]) }
const resender: MachineActor = { kind: "STAFF", userId: "s3", permissions: new Set(["ticket.document.resend"]) }
const customer: MachineActor = { kind: "CUSTOMER", userId: "c1", permissions: new Set(), isOwner: true }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const ok: Partial<TicketDocumentFacts> = { codesMatch: true, recordsComplete: true, textWarnings: false, reason: "Airline changed the flight" }
const run = (c: TicketDocumentCommandName, status: TicketDocumentFacts["status"], actor: MachineActor, extra: Partial<TicketDocumentFacts> = ok) =>
  evaluate(TICKET_DOCUMENT_TRANSITIONS, c, { status, ...extra }, actor)
const COMMANDS = Object.keys(TICKET_DOCUMENT_TRANSITIONS) as TicketDocumentCommandName[]
const actorFor = (c: TicketDocumentCommandName) => (TICKET_DOCUMENT_TRANSITIONS[c].actor === "SYSTEM" ? system : issuer)

describe("ticket document machine (ADR-0038 D1)", () => {
  it("DRAFT → ISSUED → SUPERSEDED; DRAFT and ISSUED can be revoked", () => {
    expect(run("issue", "DRAFT", issuer)).toMatchObject({ ok: true, to: "ISSUED" })
    expect(run("supersede", "ISSUED", system)).toMatchObject({ ok: true, to: "SUPERSEDED" })
    expect(run("revoke", "DRAFT", issuer)).toMatchObject({ ok: true, to: "REVOKED" })
    expect(run("revoke", "ISSUED", issuer)).toMatchObject({ ok: true, to: "REVOKED" })
  })
  it("nothing leaves SUPERSEDED or REVOKED", () => {
    for (const s of TICKET_DOCUMENT_FINAL) for (const c of COMMANDS) expect(run(c, s, actorFor(c)).ok, `${c} from ${s}`).toBe(false)
  })
  it("issue is blocked while a code does not match, records are missing or text warnings are unacknowledged", () => {
    expect(run("issue", "DRAFT", issuer, { ...ok, codesMatch: false })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" })
    expect(run("issue", "DRAFT", issuer, { ...ok, recordsComplete: false })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" })
    expect(run("issue", "DRAFT", issuer, { ...ok, textWarnings: true })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" })
    expect(run("issue", "DRAFT", issuer, { ...ok, textWarnings: true, textWarningsAcknowledged: true })).toMatchObject({ ok: true, to: "ISSUED" })
  })
  it("issue happens once: an ISSUED version cannot be issued again", () => {
    expect(run("issue", "ISSUED", issuer).ok).toBe(false)
  })
  it("replace, reissue and revoke need a reason; resend, replace and reissue keep the status and need ISSUED", () => {
    for (const c of ["replace", "reissue", "revoke"] as const) expect(run(c, "ISSUED", issuer, { ...ok, reason: " " }).ok, c).toBe(false)
    for (const c of ["resend", "replace", "reissue"] as const) {
      expect(run(c, "ISSUED", issuer)).toMatchObject({ ok: true, to: "ISSUED" })
      expect(run(c, "DRAFT", issuer).ok, c).toBe(false)
    }
  })
  it("permissions: ticket.record only reads; resend has its own permission; customers and staff cannot supersede", () => {
    for (const c of ["issue", "revoke", "replace", "reissue", "resend"] as const) expect(run(c, c === "issue" ? "DRAFT" : "ISSUED", reader)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("resend", "ISSUED", resender)).toMatchObject({ ok: true })
    expect(run("issue", "DRAFT", resender)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("supersede", "ISSUED", issuer)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("issue", "DRAFT", customer)).toMatchObject({ ok: false, code: "FORBIDDEN" })
  })
  it("the staff action list is derived from the table", () => {
    expect(allowedCommands(TICKET_DOCUMENT_TRANSITIONS, { status: "ISSUED", ...ok }, issuer).map((c) => c.command)).toEqual(["revoke", "resend", "replace", "reissue"])
    expect(allowedCommands(TICKET_DOCUMENT_TRANSITIONS, { status: "DRAFT", ...ok }, issuer).map((c) => c.command)).toEqual(["issue", "revoke"])
    expect(allowedCommands(TICKET_DOCUMENT_TRANSITIONS, { status: "SUPERSEDED" }, issuer)).toEqual([])
  })
  it("property: every transition lands in a declared status, never leaves a final one, and only DRAFT reaches ISSUED", () => {
    fc.assert(fc.property(fc.constantFrom(...TICKET_DOCUMENT_STATUSES), fc.constantFrom(...COMMANDS), fc.boolean(), fc.boolean(), fc.boolean(), (status, cmd, codesMatch, recordsComplete, ack) => {
      const r = run(cmd, status, actorFor(cmd), { ...ok, codesMatch, recordsComplete, textWarnings: true, textWarningsAcknowledged: ack })
      if (!r.ok) return true
      const statusChange = r.to !== status
      return (TICKET_DOCUMENT_STATUSES as readonly string[]).includes(r.to) && !TICKET_DOCUMENT_FINAL.includes(status)
        && (r.to !== "ISSUED" || status === "ISSUED" || (status === "DRAFT" && codesMatch && recordsComplete && ack))
        && (!statusChange || ["issue", "supersede", "revoke"].includes(cmd))
    }))
  })
  it("customers see ISSUED only", () => {
    expect(TICKET_DOCUMENT_STATUSES.filter(isCustomerVisibleTicketDocument)).toEqual(["ISSUED"])
  })
})

describe("integrity helpers (D2, D4)", () => {
  const a = "a".repeat(64)
  it("the original is intact only when the recorded sha256 equals the actual one; a missing record fails closed", () => {
    expect(originalIntact(a, a)).toBe(true)
    expect(originalIntact(a, "b".repeat(64))).toBe(false)
    expect(originalIntact(null, a)).toBe(false)
    expect(originalIntact("not-a-hash", "not-a-hash")).toBe(false)
  })
  it("codes match by format and exact bytes, counting duplicates", () => {
    const qr = { format: "QRCode", bytesBase64: "TTFET0U=" }
    const pdf417 = { format: "PDF417", bytesBase64: "TTFET0U=" }
    expect(missingCodes([qr, pdf417], [pdf417, qr])).toEqual([])
    expect(missingCodes([qr, pdf417], [qr])).toEqual([1])
    expect(missingCodes([qr, qr], [qr])).toEqual([1])
    expect(missingCodes([{ ...qr, bytesBase64: "TTFET0V=" }], [qr])).toEqual([0])
    expect(missingCodes([], [qr])).toEqual([])
  })
  it("property: a code list always matches itself in any order", () => {
    fc.assert(fc.property(fc.array(fc.record({ format: fc.constantFrom("QRCode", "PDF417", "Aztec", "Code128"), bytesBase64: fc.base64String({ maxLength: 12 }) }), { maxLength: 8 }), (codes) => {
      return missingCodes(codes, [...codes].reverse()).length === 0
    }))
  })
  it("text match ignores case, spaces and hyphens, and an empty value never matches", () => {
    expect(textContains("Booking ref: abc 123  Ticket 176-2345678901", "ABC123")).toBe(true)
    expect(textContains("Ticket 176-2345678901", "1762345678901")).toBe(true)
    expect(textContains("Ticket 1762345678902", "1762345678901")).toBe(false)
    expect(textContains("anything", " ")).toBe(false)
  })
})
