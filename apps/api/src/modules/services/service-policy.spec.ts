import { describe, expect, it } from "vitest"

import { servicePolicyKeys } from "./service-policy"

const uk = { residenceCountry: "GB", contactPhone: "+447700900123" }

describe("servicePolicyKeys (ADR-0015)", () => {
  it("always includes the wildcard row", () => {
    expect(servicePolicyKeys("TOUR_CALLBACK", {}, uk)).toEqual(["TOUR_CALLBACK:*"])
  })
  it("CIP is keyed by airport and VISA by destination", () => {
    expect(servicePolicyKeys("CIP", { airport: "IKA" }, uk)).toEqual(["CIP:*", "CIP:IKA"])
    expect(servicePolicyKeys("VISA", { destinationCountry: "TR" }, uk)).toEqual(["VISA:*", "VISA:TR"])
  })
  it("insurance uses the residence address and a +98 phone, either one alone", () => {
    expect(servicePolicyKeys("INSURANCE", {}, uk)).toEqual(["INSURANCE:*", "INSURANCE:GB"])
    expect(servicePolicyKeys("INSURANCE", {}, { residenceCountry: null, contactPhone: "+989121234567" })).toEqual(["INSURANCE:*", "INSURANCE:IR"])
    expect(servicePolicyKeys("INSURANCE", {}, { residenceCountry: "ir", contactPhone: "+989121234567" })).toEqual(["INSURANCE:*", "INSURANCE:IR"])
  })
})
