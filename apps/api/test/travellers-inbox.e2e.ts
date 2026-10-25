import { describe, expect, it } from "vitest"

import { randomPhone, Session, signIn } from "./client"

const base = { title: "MS", givenNames: "Solo", surname: "Self", dateOfBirth: "1997-03-04", genderOnDocument: "F", nationality: "IR" }

describe("One SELF traveller per customer (booklet ch. 23 travellers.relationship)", () => {
  it("rejects a second SELF on create and on update, allows FAMILY", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Solo", surnameLatin: "Self" })
    expect((await c.post("/v1/me/travellers", { ...base, relationship: "SELF" })).status).toBe(201)
    const dup = await c.post("/v1/me/travellers", { ...base, relationship: "SELF" })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe("SELF_TRAVELLER_EXISTS")
    const fam = await c.post("/v1/me/travellers", { ...base, relationship: "FAMILY" })
    expect(fam.status).toBe(201)
    const promote = await c.patch(`/v1/me/travellers/${fam.body.id}`, { relationship: "SELF" })
    expect(promote.body.code).toBe("SELF_TRAVELLER_EXISTS")
  })
})

describe("Inbox locale (ch. 17.4)", () => {
  it("accepts ?locale and returns items", async () => {
    const c = new Session("MOBILE")
    await signIn(c, randomPhone("+98912"), { givenNamesLatin: "Solo", surnameLatin: "Inbox" })
    for (const locale of ["en", "fa"]) {
      const r = await c.get(`/v1/notifications?locale=${locale}`)
      expect(r.status).toBe(200)
      expect(Array.isArray(r.body.items)).toBe(true)
    }
    expect((await c.get("/v1/notifications?locale=xx")).status).toBe(400)
  })
})
