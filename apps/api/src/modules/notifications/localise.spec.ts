import { describe, expect, it } from "vitest"

import { localisedVars, localiseRoute } from "./localise"

const names = new Map([["tehran", { en: "Tehran", fa: "تهران" }], ["london", { en: "London", fa: "لندن" }], ["تهران", { en: "Tehran", fa: "تهران" }], ["لندن", { en: "London", fa: "لندن" }]])

describe("notification variable localisation", () => {
  it("renders routes in both languages whichever language the label was written in", () => {
    expect(localiseRoute("Tehran → London", names)).toEqual({ en: "Tehran → London", fa: "تهران → لندن" })
    expect(localiseRoute("تهران ⇄ لندن", names)).toEqual({ en: "Tehran ⇄ London", fa: "تهران ⇄ لندن" })
    expect(localiseRoute("Tehran → Nowhere", names).fa).toBe("تهران → Nowhere")
  })

  it("labels client, decision and trigger codes", () => {
    const v = localisedVars({ client: "web", decision: "DECLINE", trigger: "SCREENING" }, names)
    expect(v.client_fa).toBe("وب")
    expect(v.decision_en).toBe("declined")
    expect(v.trigger_fa).toBe("غربالگری")
  })
})
