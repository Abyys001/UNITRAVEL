import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { AtolMode, INVOICE_STATUSES, PERMISSIONS, type Permission } from "@unitravel/contracts"

import { endOfLondonDay, formatDocumentNumber, INVOICE_TRANSITIONS, type InvoiceCommand, type InvoiceFacts, invoiceAmountsEditable, invoiceExpiry, londonDay, londonYear } from "./invoice"
import { evaluate, type MachineActor } from "./machine"

const staff = (perms: Permission[] = [...PERMISSIONS]): MachineActor => ({ kind: "STAFF", userId: "s", permissions: new Set(perms) })
const customer: MachineActor = { kind: "CUSTOMER", userId: "c", permissions: new Set(), isOwner: true }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const actors = [staff(), staff([]), staff(["pricing.read.internal"]), customer, system]
const commands = Object.keys(INVOICE_TRANSITIONS) as InvoiceCommand[]

const instant = fc.date({ min: new Date("2025-01-01T00:00:00Z"), max: new Date("2029-12-31T23:59:59Z"), noInvalidDate: true })
const arbFacts: fc.Arbitrary<InvoiceFacts> = fc.record({
  status: fc.constantFrom(...INVOICE_STATUSES),
  productType: fc.constantFrom("FLIGHT", "CARGO"),
  atolMode: fc.constantFrom(...AtolMode.options),
  now: instant,
  ticketedAt: fc.option(instant, { nil: null }),
  expiresAt: fc.option(instant, { nil: null }),
})

describe("invoice state machine (property)", () => {
  it("only DRAFT can be issued, and only by staff with commercial_document.issue", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(INVOICE_TRANSITIONS, cmd, facts, actor)
      if (r.ok && r.to === "ISSUED") {
        expect(cmd).toBe("issue")
        expect(r.from).toBe("DRAFT")
        expect(actor.kind).toBe("STAFF")
        expect(actor.permissions.has("commercial_document.issue")).toBe(true)
      }
    }), { numRuns: 4000 })
  })

  it("DRAFT is never a target, CANCELLED and REFUNDED are terminal, PAID only goes to REFUNDED", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(INVOICE_TRANSITIONS, cmd, facts, actor)
      if (!r.ok) return
      expect(r.to).not.toBe("DRAFT")
      expect(["CANCELLED", "REFUNDED"]).not.toContain(r.from)
      if (r.from === "PAID") expect(r.to).toBe("REFUNDED")
      if (r.to === "PAID") expect(r.from).toBe("ISSUED")
      if (r.to === "REFUNDED") expect(r.from).toBe("PAID")
    }), { numRuns: 4000 })
  })

  it("payment and expiry are system commands; no customer can move an invoice", () => {
    fc.assert(fc.property(arbFacts, fc.constantFrom(...commands), fc.constantFrom(...actors), (facts, cmd, actor) => {
      const r = evaluate(INVOICE_TRANSITIONS, cmd, facts, actor)
      if (["expire", "mark_paid", "mark_refunded"].includes(cmd) && r.ok) expect(actor.kind).toBe("SYSTEM")
      if (actor.kind === "CUSTOMER") expect(r.ok).toBe(false)
    }), { numRuns: 3000 })
  })

  it("expiry needs an ISSUED invoice that has actually passed its expiry, and ends CANCELLED", () => {
    fc.assert(fc.property(arbFacts, (facts) => {
      const r = evaluate(INVOICE_TRANSITIONS, "expire", facts, system)
      expect(r.ok).toBe(facts.status === "ISSUED" && !!facts.expiresAt && facts.now.getTime() >= facts.expiresAt.getTime())
      if (r.ok) expect(r.to).toBe("CANCELLED")
    }), { numRuns: 3000 })
  })

  it("under PAY_ON_TICKETING a flight invoice is issued only with tickets recorded the same Europe/London day", () => {
    fc.assert(fc.property(arbFacts, (facts) => {
      const r = evaluate(INVOICE_TRANSITIONS, "issue", { ...facts, status: "DRAFT" }, staff())
      const guarded = facts.productType === "FLIGHT" && facts.atolMode === "PAY_ON_TICKETING"
      const sameDay = !!facts.ticketedAt && londonDay(facts.ticketedAt) === londonDay(facts.now)
      expect(r.ok).toBe(guarded ? sameDay : true)
    }), { numRuns: 4000 })
  })

  it("issue-time: ticketed 23:59 London and issued 00:01 the next day is refused; other modes and cargo are not guarded", () => {
    const base: InvoiceFacts = { status: "DRAFT", productType: "FLIGHT", atolMode: "PAY_ON_TICKETING", now: new Date("2026-11-11T00:01:00Z"), ticketedAt: new Date("2026-11-10T23:59:00Z"), expiresAt: null }
    expect(evaluate(INVOICE_TRANSITIONS, "issue", base, staff())).toMatchObject({ ok: false })
    expect(evaluate(INVOICE_TRANSITIONS, "issue", { ...base, ticketedAt: null }, staff())).toMatchObject({ ok: false })
    expect(evaluate(INVOICE_TRANSITIONS, "issue", { ...base, ticketedAt: new Date("2026-11-11T00:00:30Z") }, staff())).toMatchObject({ ok: true })
    expect(evaluate(INVOICE_TRANSITIONS, "issue", { ...base, atolMode: "OWN_ATOL", ticketedAt: null }, staff())).toMatchObject({ ok: true })
    expect(evaluate(INVOICE_TRANSITIONS, "issue", { ...base, productType: "CARGO", ticketedAt: null }, staff())).toMatchObject({ ok: true })
  })

  it("amounts are editable only on a draft", () => {
    for (const s of INVOICE_STATUSES) expect(invoiceAmountsEditable(s)).toBe(s === "DRAFT")
  })
})

describe("Europe/London day arithmetic (property)", () => {
  it("the end of the day is the next local midnight: after the instant, within 25 h, and the day changes exactly there", () => {
    fc.assert(fc.property(instant, (t) => {
      const e = endOfLondonDay(t)
      expect(e.getTime()).toBeGreaterThan(t.getTime())
      expect(e.getTime() - t.getTime()).toBeLessThanOrEqual(25 * 3600_000)
      expect(londonDay(new Date(e.getTime() - 1))).toBe(londonDay(t))
      expect(londonDay(e)).not.toBe(londonDay(t))
      expect(e.getTime() % 1000).toBe(0)
    }), { numRuns: 3000 })
  })

  it("handles the clock changes: 23 h and 25 h days", () => {
    expect(endOfLondonDay(new Date("2026-03-29T12:00:00Z")).toISOString()).toBe("2026-03-29T23:00:00.000Z") // BST starts, local midnight is 23:00Z
    expect(endOfLondonDay(new Date("2026-03-28T12:00:00Z")).toISOString()).toBe("2026-03-29T00:00:00.000Z")
    expect(endOfLondonDay(new Date("2026-10-25T12:00:00Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z") // BST ends
    expect(endOfLondonDay(new Date("2026-10-24T12:00:00Z")).toISOString()).toBe("2026-10-24T23:00:00.000Z")
    expect(londonYear(new Date("2026-12-31T23:30:00Z"))).toBe(2026)
    expect(londonYear(new Date("2027-01-01T00:30:00Z"))).toBe(2027)
  })

  it("expiry is the end of the day for PAY_ON_TICKETING flights, issue + validity otherwise", () => {
    const now = new Date("2026-11-11T15:00:00Z")
    expect(invoiceExpiry({ productType: "FLIGHT", atolMode: "PAY_ON_TICKETING", now, validityDays: 14 }).toISOString()).toBe("2026-11-12T00:00:00.000Z")
    expect(invoiceExpiry({ productType: "FLIGHT", atolMode: "OWN_ATOL", now, validityDays: 14 }).toISOString()).toBe("2026-11-25T15:00:00.000Z")
    expect(invoiceExpiry({ productType: "CARGO", atolMode: "PAY_ON_TICKETING", now, validityDays: 3 }).toISOString()).toBe("2026-11-14T15:00:00.000Z")
  })
})

describe("document numbers", () => {
  it("are PREFIX-YEAR-NNNNNN and sort by sequence within a year", () => {
    expect(formatDocumentNumber("INV", 2026, 7)).toBe("INV-2026-000007")
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_998 }), (n) => {
      expect(formatDocumentNumber("QT", 2026, n) < formatDocumentNumber("QT", 2026, n + 1)).toBe(true)
      expect(formatDocumentNumber("QT", 2026, n)).toMatch(/^QT-2026-\d{6}$/)
    }))
  })
})
