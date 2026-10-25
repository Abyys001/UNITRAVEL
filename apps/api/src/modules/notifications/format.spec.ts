import { describe, expect, it } from "vitest"

import { eventUuid, formatLocal, localDateVars, renderTemplate } from "./format"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe("eventUuid (notifications.event_id is a uuid column)", () => {
  it("passes real uuids through", () => {
    const id = "01a1651d-3741-7332-9f71-b39f578648fd"
    expect(eventUuid(id)).toBe(id)
  })
  it("maps composite timer keys to a stable, valid uuid", () => {
    const k = "fr.deadline_2:01a1651d-3741-7332-9f71-b39f578648fd:6"
    expect(eventUuid(k)).toMatch(UUID)
    expect(eventUuid(k)).toBe(eventUuid(k))
    expect(eventUuid(k)).not.toBe(eventUuid(`${k}7`))
  })
})


describe("localDateVars", () => {
  it("leaves no placeholders for {expires_at_local} or {deadline_local}", () => {
    const opts = { locale: "en" as const, tz: "UTC", calendar: "GREGORIAN" as const }
    const vars = { ...localDateVars("expires_at", "2026-10-24T19:36:00Z", opts), ...localDateVars("deadline_at", "2026-10-24T19:36:00Z", opts) }
    expect(renderTemplate("valid until {expires_at_local}; ticket by {deadline_local}", vars)).not.toMatch(/[{}]/)
  })
})

describe("formatLocal", () => {
  it("names the time zone so a time is never ambiguous", () => {
    const at = "2026-10-24T19:36:00Z"
    expect(formatLocal(at, { locale: "en", tz: "Europe/London", calendar: "GREGORIAN" })).toMatch(/20:36 BST|19:36 GMT|20:36/)
    expect(formatLocal(at, { locale: "en", tz: "Europe/London", calendar: "GREGORIAN" })).toMatch(/[A-Z]{3}|GMT/)
    expect(formatLocal(at, { locale: "en", tz: "Asia/Tehran", calendar: "GREGORIAN" })).toContain("GMT+3:30")
  })
})
