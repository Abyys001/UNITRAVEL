import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { SUPPORT_TICKET_STATUSES } from "@unitravel/contracts"

import { allowedCommands, evaluate, type MachineActor } from "./machine"
import { generateTicketRef, normaliseTicketRef, TICKET_TRANSITIONS, type TicketCommandName, type TicketFacts } from "./support-ticket"

const now = new Date("2026-11-01T10:00:00Z")
const staff: MachineActor = { kind: "STAFF", userId: "s1", permissions: new Set(["support.reply"]) }
const readOnlyStaff: MachineActor = { kind: "STAFF", userId: "s2", permissions: new Set(["support.read"]) }
const owner: MachineActor = { kind: "CUSTOMER", userId: "c1", permissions: new Set(), isOwner: true }
const stranger: MachineActor = { kind: "CUSTOMER", userId: "c2", permissions: new Set() }
const system: MachineActor = { kind: "SYSTEM", permissions: new Set() }
const facts = (status: TicketFacts["status"], extra: Partial<TicketFacts> = {}): TicketFacts => ({ status, now, ...extra })
const run = (c: TicketCommandName, status: TicketFacts["status"], actor: MachineActor, extra: Partial<TicketFacts> = {}) => evaluate(TICKET_TRANSITIONS, c, facts(status, extra), actor)

describe("support ticket machine", () => {
  it("a staff reply moves an open ticket to PENDING_CUSTOMER; a customer reply reopens a pending or resolved one", () => {
    expect(run("staff_reply", "OPEN", staff)).toMatchObject({ ok: true, to: "PENDING_CUSTOMER" })
    expect(run("customer_reply", "PENDING_CUSTOMER", owner)).toMatchObject({ ok: true, to: "OPEN" })
    expect(run("customer_reply", "RESOLVED", owner)).toMatchObject({ ok: true, to: "OPEN" })
  })
  it("CLOSED is final: nobody replies, reopens or resolves", () => {
    for (const c of ["customer_reply", "staff_reply", "assign", "resolve", "reopen", "close", "auto_close"] as const) {
      expect(run(c, "CLOSED", c === "customer_reply" ? owner : c === "auto_close" ? system : staff, { assigneeCanReply: true }).ok, c).toBe(false)
    }
  })
  it("staff commands need support.reply; reading is not enough", () => {
    expect(run("resolve", "OPEN", readOnlyStaff)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("staff_reply", "OPEN", readOnlyStaff)).toMatchObject({ ok: false, code: "FORBIDDEN" })
  })
  it("only the owning customer replies as a customer; only the system auto-closes", () => {
    expect(run("customer_reply", "OPEN", stranger)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("auto_close", "RESOLVED", staff)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(run("auto_close", "RESOLVED", system)).toMatchObject({ ok: true, to: "CLOSED" })
  })
  it("assigning keeps the status and needs an assignee who can reply", () => {
    expect(run("assign", "PENDING_CUSTOMER", staff, { assigneeCanReply: true })).toMatchObject({ ok: true, to: "PENDING_CUSTOMER" })
    expect(run("assign", "OPEN", staff, { assigneeCanReply: false })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" })
  })
  it("close only from RESOLVED; reopen only from RESOLVED", () => {
    expect(run("close", "OPEN", staff).ok).toBe(false)
    expect(run("close", "RESOLVED", staff)).toMatchObject({ ok: true, to: "CLOSED" })
    expect(run("reopen", "RESOLVED", staff)).toMatchObject({ ok: true, to: "OPEN" })
    expect(run("reopen", "CLOSED", staff).ok).toBe(false)
  })
  it("the staff action list is derived from the table", () => {
    expect(allowedCommands(TICKET_TRANSITIONS, facts("RESOLVED"), staff, ["assign", "resolve", "reopen", "close"]).map((c) => c.command)).toEqual(["reopen", "close"])
  })
  it("property: every transition lands in a declared status and CLOSED is never left", () => {
    fc.assert(fc.property(fc.constantFrom(...SUPPORT_TICKET_STATUSES), fc.constantFrom(...(Object.keys(TICKET_TRANSITIONS) as TicketCommandName[])), (status, cmd) => {
      const actor = TICKET_TRANSITIONS[cmd].actor === "CUSTOMER" ? owner : TICKET_TRANSITIONS[cmd].actor === "SYSTEM" ? system : staff
      const r = run(cmd, status, actor, { assigneeCanReply: true })
      if (!r.ok) return true
      return (SUPPORT_TICKET_STATUSES as readonly string[]).includes(r.to) && !(status === "CLOSED")
    }))
  })
})

describe("ticket references", () => {
  it("generates TK- references that normalise to themselves", () => {
    for (let i = 0; i < 50; i++) { const r = generateTicketRef(); expect(r).toMatch(/^TK-[0-9A-HJKMNP-TV-Z]{6}$/); expect(normaliseTicketRef(r)).toBe(r) }
  })
  it("tolerates lower case, spaces and look-alike characters; refuses request references", () => {
    expect(normaliseTicketRef(" tk-0o1i2a ")).toBe("TK-00112A")
    expect(normaliseTicketRef("UT-F-ABC234")).toBeNull()
  })
})
