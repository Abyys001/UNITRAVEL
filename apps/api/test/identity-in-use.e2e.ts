import { describe, expect, it } from "vitest"

import { dbQuery, latestCode, randomPhone, Session, signIn, solvePow } from "./client"

/** Adding a phone that is already verified on another account fails at verify with a specific field code, so the UI can explain it. */
describe("adding an identity that belongs to another account", () => {
  it("verify answers VALIDATION_FAILED with errors[].code IDENTITY_IN_USE", async () => {
    const owner = new Session("WEB")
    const phone = randomPhone("+4477009")
    await signIn(owner, phone, { givenNamesLatin: "Taken", surnameLatin: "Owner" })

    const other = new Session("WEB")
    await signIn(other, randomPhone("+4477009"), { givenNamesLatin: "Second", surnameLatin: "Account" })
    // The first sign-in started a resend cooldown on this number; it is unrelated to what is tested here.
    await dbQuery("delete from otp_challenges where identity_value = $1", [phone])
    // Not "now - 1s" like other tests: the owner's sign-in code to the same number can be less than a second old.
    const since = Date.now()
    let add = await other.post("/v1/me/identities", { type: "PHONE", value: phone, deviceId: other.deviceId })
    if (add.status === 428 && add.body.challenge) add = await other.post("/v1/me/identities", { type: "PHONE", value: phone, deviceId: other.deviceId, challenge: solvePow(add.body.challenge) })
    expect(add.status).toBe(202)

    const v = await other.post("/v1/auth/otp/verify", { challengeId: add.body.challengeId, code: await latestCode(add.body.normalised, since), deviceId: other.deviceId, client: "WEB" })
    expect(v.status).toBe(400)
    expect(v.body.code).toBe("VALIDATION_FAILED")
    expect(v.body.errors).toEqual([expect.objectContaining({ path: "value", code: "IDENTITY_IN_USE" })])
  })
})
