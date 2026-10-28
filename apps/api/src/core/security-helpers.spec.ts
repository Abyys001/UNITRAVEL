import { describe, expect, it } from "vitest"

import { passkeyRpId } from "../modules/identity/mfa.service"
import { ipKey } from "./http/rate-limit"
import { safeError, scrubMessage } from "./safe-error"

// ADR-0017 helpers.
describe("scrubMessage / safeError", () => {
  it("cuts a failed query's parameters and masks contact details", () => {
    const msg = "Failed query: insert into otp_challenges values ($1, $2)\nparams: +447700900123,neda@student.example,0b1f"
    expect(scrubMessage(msg)).toBe("Failed query: insert into otp_challenges values ($1, $2)")
    expect(scrubMessage("could not reach neda@student.example on +44 7700 900123")).toBe("could not reach [email] on [number]")
  })

  it("keeps the database code and constraint from the wrapped driver error", () => {
    const err = Object.assign(new Error("Failed query: x\nparams: secret"), { cause: { code: "23505", constraint: "users_pkey" } })
    expect(safeError(err)).toMatchObject({ name: "Error", message: "Failed query: x", code: "23505", constraint: "users_pkey" })
    expect(JSON.stringify(safeError(err))).not.toContain("secret")
  })
})

describe("ipKey", () => {
  it("keys IPv4 by address and IPv6 by /64", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9")
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9")
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64")
    expect(ipKey("2001:db8:1:2:bbbb:cccc:dddd:eeee")).toBe(ipKey("2001:0db8:0001:0002::9"))
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64")
  })
})

describe("passkeyRpId", () => {
  it("uses the domain both console hosts share, never a public suffix", () => {
    expect(passkeyRpId("https://admin.unitravels.co.uk", "https://dev.unitravels.co.uk")).toBe("unitravels.co.uk")
    expect(passkeyRpId("http://admin.localhost:4200", "http://dev.localhost:4200")).toBe("localhost")
    expect(passkeyRpId("https://admin.example.com", "https://dev.example.com")).toBe("example.com")
  })
})
