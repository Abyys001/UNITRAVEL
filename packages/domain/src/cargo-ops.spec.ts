import { describe, expect, it } from "vitest"
import fc from "fast-check"

import { CARGO_TRANSITIONS } from "./cargo-request"
import { agentActions, cargoMilestone, luhnDigit, makeTrackingNumber, parseTrackingNumber, progressStep } from "./cargo-ops"
import { trackingEventAllowed } from "./cargo-tracking"
import { evaluate, type MachineActor } from "./machine"

const ev = (eventCode: string, occurredAt: string) => ({ eventCode, occurredAt })

describe("tracking numbers (ADR-0042 D2)", () => {
  it("Luhn digit matches the textbook example", () => {
    expect(luhnDigit("7992739871")).toBe(3)
  })
  it("round-trips and tolerates spacing and case", () => {
    fc.assert(fc.property(fc.stringMatching(/^\d{10}$/), (d) => {
      const n = makeTrackingNumber(d)
      expect(n).toMatch(/^UT\d{11}$/)
      expect(parseTrackingNumber(n)).toBe(n)
      expect(parseTrackingNumber(` ${n.toLowerCase().slice(0, 6)} - ${n.slice(6)} `)).toBe(n)
    }))
  })
  it("rejects any single-digit typo", () => {
    fc.assert(fc.property(fc.stringMatching(/^\d{10}$/), fc.integer({ min: 2, max: 12 }), fc.integer({ min: 1, max: 9 }), (d, pos, delta) => {
      const n = makeTrackingNumber(d)
      const typo = n.slice(0, pos) + String((Number(n[pos]) + delta) % 10) + n.slice(pos + 1)
      expect(parseTrackingNumber(typo)).toBeNull()
    }))
  })
  it("rejects other shapes", () => {
    for (const s of ["", "UT123", "XX12345678901", "UT1234567890A", "UT-C-8K4Q7M"]) expect(parseTrackingNumber(s)).toBeNull()
  })
})

describe("customer milestone (ADR-0042 D3)", () => {
  it("follows the state machine phase", () => {
    expect(cargoMilestone("NEW", null, [])).toBe("REQUEST_RECEIVED")
    expect(cargoMilestone("QUOTED", null, [])).toBe("REQUEST_RECEIVED")
    expect(cargoMilestone("ACCEPTED", null, [])).toBe("REQUEST_CONFIRMED")
    expect(cargoMilestone("BOOKED", null, [])).toBe("AWAITING_COLLECTION")
    expect(cargoMilestone("AWAITING_HANDOVER", null, [])).toBe("COLLECTION_SCHEDULED")
    expect(cargoMilestone("RECEIVED", null, [])).toBe("CARGO_COLLECTED")
    expect(cargoMilestone("IN_TRANSIT", null, [])).toBe("IN_TRANSIT")
    expect(cargoMilestone("AT_CUSTOMS", null, [])).toBe("IN_TRANSIT")
    expect(cargoMilestone("OUT_FOR_DELIVERY", null, [])).toBe("OUT_FOR_DELIVERY")
    expect(cargoMilestone("DELIVERED", null, [])).toBe("DELIVERED")
    expect(cargoMilestone("COMPLETED", null, [])).toBe("DELIVERED")
    expect(cargoMilestone("CANCELLED", null, [])).toBe("CANCELLED")
    expect(cargoMilestone("DECLINED", null, [])).toBe("CANCELLED")
    expect(cargoMilestone("EXCEPTION", "RETURNED", [])).toBe("RETURNED_TO_SENDER")
    expect(cargoMilestone("EXCEPTION", "HELD", [])).toBe("ON_HOLD")
  })
  it("refines collection by the latest event and never reopens it after pickup", () => {
    expect(cargoMilestone("BOOKED", null, [ev("COLLECTION_AGENT_ASSIGNED", "2026-11-19T09:00:00Z")])).toBe("AGENT_ASSIGNED")
    expect(cargoMilestone("AWAITING_HANDOVER", null, [ev("COLLECTION_SCHEDULED", "2026-11-19T08:00:00Z"), ev("COLLECTION_AGENT_ASSIGNED", "2026-11-19T09:00:00Z")])).toBe("AGENT_ASSIGNED")
    expect(cargoMilestone("AWAITING_HANDOVER", null, [ev("COLLECTION_AGENT_ASSIGNED", "2026-11-19T09:00:00Z"), ev("COLLECTION_FAILED", "2026-11-19T10:00:00Z")])).toBe("COLLECTION_FAILED")
    expect(cargoMilestone("AWAITING_HANDOVER", null, [ev("PICKED_UP", "2026-11-19T10:00:00Z"), ev("COLLECTION_AGENT_ASSIGNED", "2026-11-19T11:00:00Z")])).toBe("CARGO_COLLECTED")
  })
  it("shows the sorting facility and failed delivery attempts", () => {
    expect(cargoMilestone("IN_TRANSIT", null, [ev("DEPARTED", "2026-11-19T08:00:00Z"), ev("SORTING_FACILITY", "2026-11-19T09:00:00Z")])).toBe("AT_SORTING_FACILITY")
    expect(cargoMilestone("IN_TRANSIT", null, [ev("SORTING_FACILITY", "2026-11-19T08:00:00Z"), ev("DEPARTED", "2026-11-19T09:00:00Z")])).toBe("IN_TRANSIT")
    expect(cargoMilestone("OUT_FOR_DELIVERY", null, [ev("OUT_FOR_DELIVERY", "2026-11-19T08:00:00Z"), ev("DELIVERY_FAILED", "2026-11-19T09:00:00Z")])).toBe("DELIVERY_FAILED")
    expect(cargoMilestone("OUT_FOR_DELIVERY", null, [ev("DELIVERY_FAILED", "2026-11-19T09:00:00Z"), ev("OUT_FOR_DELIVERY", "2026-11-20T08:00:00Z")])).toBe("OUT_FOR_DELIVERY")
  })
  it("maps every milestone onto the progress bar or off it", () => {
    expect(progressStep("DELIVERED")).toBe(5)
    expect(progressStep("CANCELLED")).toBe(-1)
  })
})

describe("agent authority (ADR-0042 D8, ADR-0043)", () => {
  const agent: MachineActor = { kind: "STAFF", userId: "d", permissions: new Set(["cargo_job.agent"]) }
  const now = new Date()
  it("an assigned delivery agent may deliver; an unassigned one may not", () => {
    expect(evaluate(CARGO_TRANSITIONS, "deliver", { status: "OUT_FOR_DELIVERY", now, podName: "J Smith", assignedAgent: true }, agent).ok).toBe(true)
    expect(evaluate(CARGO_TRANSITIONS, "deliver", { status: "OUT_FOR_DELIVERY", now, podName: "J Smith", assignedAgent: false }, agent).ok).toBe(false)
    expect(evaluate(CARGO_TRANSITIONS, "out_for_delivery", { status: "IN_TRANSIT", now, assignedAgent: true }, agent).ok).toBe(true)
  })
  it("an agent cannot run any other staff command", () => {
    for (const cmd of Object.keys(CARGO_TRANSITIONS) as (keyof typeof CARGO_TRANSITIONS)[]) {
      if (cmd === "deliver" || cmd === "out_for_delivery") continue
      for (const status of ["NEW", "IN_REVIEW", "QUOTED", "ACCEPTED", "BOOKED", "AWAITING_HANDOVER", "RECEIVED", "IN_TRANSIT", "AT_CUSTOMS", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION"] as const) {
        expect(evaluate(CARGO_TRANSITIONS, cmd, { status, now, assignedAgent: true }, agent).ok, `${cmd} from ${status}`).toBe(false)
      }
    }
  })
  it("offers collection, handling and delivery actions only in their phase; an offered job can only be accepted or declined", () => {
    expect(agentActions("COLLECTION", "OFFERED", "BOOKED", "AWAITING_COLLECTION")).toEqual(["accept", "decline"])
    expect(agentActions("COLLECTION", "ASSIGNED", "AWAITING_HANDOVER", "COLLECTION_SCHEDULED")).toContain("collected")
    expect(agentActions("COLLECTION", "ASSIGNED", "AWAITING_HANDOVER", "CARGO_COLLECTED")).toEqual(["report_problem", "note"])
    expect(agentActions("HANDLING", "ASSIGNED", "IN_TRANSIT", "IN_TRANSIT")).toEqual(["handled", "at_sorting_facility", "handling_done", "report_problem", "note"])
    expect(agentActions("DELIVERY", "ASSIGNED", "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY")).toEqual(["delivered", "delivery_failed", "report_problem", "note"])
    expect(agentActions("DELIVERY", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED")).toContain("out_for_delivery")
    expect(agentActions("DELIVERY", "COMPLETED", "DELIVERED", "DELIVERED")).toEqual(["note"])
    expect(agentActions("DELIVERY", "DECLINED", "IN_TRANSIT", "IN_TRANSIT")).toEqual(["note"])
  })
  it("gates the new tracking codes by stage", () => {
    expect(trackingEventAllowed("COLLECTION_AGENT_ASSIGNED", "ACCEPTED")).not.toBeNull()
    expect(trackingEventAllowed("COLLECTION_AGENT_ASSIGNED", "BOOKED")).toBeNull()
    expect(trackingEventAllowed("SORTING_FACILITY", "AWAITING_HANDOVER")).not.toBeNull()
    expect(trackingEventAllowed("DELIVERY_FAILED", "OUT_FOR_DELIVERY")).toBeNull()
  })
})
