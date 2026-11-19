import { describe, expect, it } from "vitest"

import { brevoEvents } from "./notifications.controller"

describe("Brevo email events (ADR-0038 D6)", () => {
  it("maps delivered to DELIVERED and bounces or blocks to BOUNCED; other events and events without a message id are ignored", () => {
    expect(brevoEvents([
      { event: "delivered", "message-id": "<a@unitravel.example>" },
      { event: "hard_bounce", "message-id": "<b@unitravel.example>" },
      { event: "soft_bounce", "message-id": "<c@unitravel.example>" },
      { event: "blocked", "message-id": "<d@unitravel.example>" },
      { event: "opened", "message-id": "<e@unitravel.example>" },
      { event: "delivered" },
    ])).toEqual([
      { messageId: "<a@unitravel.example>", status: "DELIVERED" },
      { messageId: "<b@unitravel.example>", status: "BOUNCED" },
      { messageId: "<c@unitravel.example>", status: "BOUNCED" },
      { messageId: "<d@unitravel.example>", status: "BOUNCED" },
    ])
  })
  it("accepts a single event object", () => {
    expect(brevoEvents({ event: "delivered", "message-id": "<x@y>" })).toEqual([{ messageId: "<x@y>", status: "DELIVERED" }])
  })
})
