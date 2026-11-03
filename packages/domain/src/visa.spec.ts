import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { type Evidence, type RuleKey, SOURCE_KINDS, VISA_STATUSES, type VisaStatus } from "@unitravel/contracts"

import {
  checkOverride, COLOUR, customerFacts, decideVisa, decidingEvidence, quoteFound, type RawEvidence, ruleKeyFor, transitRulePurpose, verifyEvidence, worstColour,
} from "./visa"

// ADR-0029: the brief's ten test scenarios against the gate. Page texts below are short paraphrases written for the tests,
// not copies of real pages; what is under test is the rule "official, quoted, about this document", not any country's law.

const at = "2026-11-02T09:00:00.000Z"
const key = (destination: string, documentType: string, issuingCountry = "GB", purpose: RuleKey["purpose"] = "VISIT"): RuleKey => ({ destination, documentType, issuingCountry, purpose })
const GOVUK_TR = "https://www.gov.uk/foreign-travel-advice/turkey"

function raw(over: Partial<RawEvidence> & Pick<RawEvidence, "url" | "kind" | "quotes">): RawEvidence {
  return {
    title: "Source", tier: 0, official: false, origin: "TRUSTED", fetchedAt: at, sourceUpdatedAt: null, claims: {}, coverageQuotes: [], coversThisDocument: false, ...over,
  }
}
function ev(over: Partial<Evidence> & Pick<Evidence, "url" | "kind">): Evidence {
  const tier = { GOVUK_FTA: 1, DESTINATION_IMMIGRATION: 2, OFFICIAL_VISA_PORTAL: 3, EMBASSY_CONSULATE: 4, OTHER_GOVERNMENT: 5, IATA: 6, THIRD_PARTY: 7 }[over.kind]
  return { title: "Source", tier, official: tier <= 5, origin: "TRUSTED", fetchedAt: at, sourceUpdatedAt: null, covers: [], claims: {}, quotes: ["quoted text here"], ...over }
}

const govukTurkey = `This information is for people travelling on a full 'British citizen' passport from the UK.
Visa requirements. You can visit Turkey without a visa for up to 90 days in any 180-day period, for business or tourism.
Passport validity requirements. Your passport must have an 'expiry date' at least 150 days after the date you arrive and at least 1 blank page.`

describe("quotes", () => {
  it("matches across curly quotes, case and whitespace", () => {
    expect(quoteFound("must have an ‘expiry   date’ at least 150 days", govukTurkey)).toBe(true)
  })
  it("rejects invented and too-short quotes", () => {
    expect(quoteFound("Refugee travel document holders may enter visa-free", govukTurkey)).toBe(false)
    expect(quoteFound("visa", govukTurkey)).toBe(false)
  })
  it("drops evidence with any quote missing from its own page", () => {
    const pages = new Map([[GOVUK_TR, govukTurkey]])
    const { kept, dropped } = verifyEvidence(key("TR", "GB_CITIZEN_PASSPORT"), [
      raw({ url: GOVUK_TR, kind: "GOVUK_FTA", quotes: ["You can visit Turkey without a visa for up to 90 days", "and you will get a free sandwich on arrival"], claims: { status: "VISA_FREE" } }),
    ], pages)
    expect(kept).toHaveLength(0)
    expect(dropped).toBe(1)
  })
})

describe("1. British citizen passport, visa-free destination", () => {
  it("GOV.UK alone confirms it, with the stay and passport validity", () => {
    const k = key("TR", "GB_CITIZEN_PASSPORT")
    const { kept } = verifyEvidence(k, [raw({
      url: GOVUK_TR, kind: "GOVUK_FTA", quotes: ["You can visit Turkey without a visa for up to 90 days in any 180-day period"],
      coversThisDocument: true, coverageQuotes: ["This information is for people travelling on a full 'British citizen' passport"],
      claims: { status: "VISA_FREE", maxStay: "90 days in any 180-day period", passportValidity: "150 days after arrival", blankPages: "1" },
    })], new Map([[GOVUK_TR, govukTurkey]]))
    const d = decideVisa(k, kept)
    expect(d.verification).toBe("VERIFIED")
    expect(d.facts.status).toBe("VISA_FREE")
    expect(d.facts.maxStay).toBe("90 days in any 180-day period")
    expect(COLOUR[d.facts.status]).toBe("GREEN")
  })
})

describe("2. British citizen passport, visa-required destination", () => {
  it("is orange with the official application link", () => {
    const k = key("XA", "GB_CITIZEN_PASSPORT")
    const d = decideVisa(k, [
      ev({ url: "https://www.gov.uk/foreign-travel-advice/xa", kind: "GOVUK_FTA", covers: ["GB_CITIZEN_PASSPORT"], claims: { status: "VISA_REQUIRED", embassyAppointment: true } }),
      ev({ url: "https://visa.gov.xa/apply", kind: "OFFICIAL_VISA_PORTAL", covers: ["GB_CITIZEN_PASSPORT"], claims: { status: "VISA_REQUIRED", applicationUrl: "https://visa.gov.xa/apply", fee: "GBP 80" } }),
    ])
    expect(d.facts.status).toBe("VISA_REQUIRED")
    expect(COLOUR[d.facts.status]).toBe("ORANGE")
    expect(d.facts.applicationUrl).toBe("https://visa.gov.xa/apply")
    expect(d.facts.fee).toBe("GBP 80")
  })
})

describe("3. UK Refugee Travel Document never inherits British-citizen rules", () => {
  const k = key("TR", "GB_REFUGEE_TRAVEL_DOC")
  it("GOV.UK's visa-free answer is ignored even if the model claims it covers the document", () => {
    const { kept } = verifyEvidence(k, [raw({
      url: GOVUK_TR, kind: "GOVUK_FTA", quotes: ["You can visit Turkey without a visa for up to 90 days"], claims: { status: "VISA_FREE" },
      coversThisDocument: true, coverageQuotes: ["This information is for people travelling on a full 'British citizen' passport"],
    })], new Map([[GOVUK_TR, govukTurkey]]))
    expect(kept[0]!.covers).toEqual([])
    const d = decideVisa(k, kept)
    expect(d.facts.status).toBe("UNCONFIRMED")
    expect(COLOUR[d.facts.status]).toBe("GREY")
  })
  it("a destination source that names the document decides it", () => {
    const d = decideVisa(k, [ev({ url: "https://www.evisa.gov.tr/en/info", kind: "OFFICIAL_VISA_PORTAL", covers: ["GB_REFUGEE_TRAVEL_DOC"], claims: { status: "EVISA", applyOnline: true } })])
    expect(d.facts.status).toBe("EVISA")
    expect(COLOUR.EVISA).toBe("BLUE")
  })
  it("a destination source about 'UK passports' that does not name the document decides nothing", () => {
    const d = decideVisa(k, [ev({ url: "https://www.evisa.gov.tr/en/info", kind: "OFFICIAL_VISA_PORTAL", covers: [], claims: { status: "VISA_FREE" } })])
    expect(d.facts.status).toBe("UNCONFIRMED")
  })
})

describe("4. UK Certificate of Travel", () => {
  it("is unconfirmed when only third-party sites speak for it", () => {
    const k = key("AE", "GB_CERTIFICATE_OF_TRAVEL")
    const d = decideVisa(k, [ev({ url: "https://visa-blog.example/uae", kind: "THIRD_PARTY", covers: ["GB_CERTIFICATE_OF_TRAVEL"], claims: { status: "VISA_ON_ARRIVAL" } })])
    expect(d.facts.status).toBe("UNCONFIRMED")
    expect(d.verification).toBe("UNVERIFIED")
  })
})

describe("5. BN(O) passport", () => {
  it("'British nationals' on GOV.UK do not cover a BN(O) passport", () => {
    const k = key("TR", "GB_BNO_PASSPORT")
    expect(decidingEvidence(k, [ev({ url: GOVUK_TR, kind: "GOVUK_FTA", covers: ["GB_BNO_PASSPORT"], claims: { status: "VISA_FREE" } })])).toEqual([])
  })
  it("an official source naming BN(O) holders decides it", () => {
    const k = key("XB", "GB_BNO_PASSPORT")
    expect(decideVisa(k, [ev({ url: "https://immigration.gov.xb/bno", kind: "DESTINATION_IMMIGRATION", covers: ["GB_BNO_PASSPORT"], claims: { status: "VISA_FREE", maxStay: "30 days" } })]).facts.status).toBe("VISA_FREE")
  })
})

describe("6. Non-British passport holder living in the UK", () => {
  it("residence never enters the rule key; the passport's issuer does", () => {
    const k = ruleKeyFor({ documentType: "NATIONAL_PASSPORT", issuingCountry: "IR", category: "NATIONAL_PASSPORT" }, "TR", "VISIT")
    expect(k).toEqual({ destination: "TR", documentType: "NATIONAL_PASSPORT", issuingCountry: "IR", purpose: "VISIT" })
  })
  it("a UK-residence condition stays a condition, not a status change", () => {
    const k = key("XC", "NATIONAL_PASSPORT", "IR")
    const d = decideVisa(k, [ev({ url: "https://mfa.gov.xc/visa", kind: "DESTINATION_IMMIGRATION", covers: ["NATIONAL_PASSPORT"], claims: { status: "VISA_REQUIRED", conditions: ["Holders of a valid UK residence permit may apply for an eVisa"] } })])
    expect(d.facts.status).toBe("VISA_REQUIRED")
    expect(d.facts.conditions).toHaveLength(1)
  })
})

describe("7. eVisa", () => {
  it("visa required and eVisa from two official sources agree: eVisa (blue), not a conflict", () => {
    const k = key("XD", "NATIONAL_PASSPORT", "IR")
    const d = decideVisa(k, [
      ev({ url: "https://mfa.gov.xd", kind: "DESTINATION_IMMIGRATION", covers: ["NATIONAL_PASSPORT"], claims: { status: "VISA_REQUIRED" } }),
      ev({ url: "https://evisa.gov.xd", kind: "OFFICIAL_VISA_PORTAL", covers: ["NATIONAL_PASSPORT"], claims: { status: "EVISA", applyOnline: true } }),
    ])
    expect(d.verification).toBe("VERIFIED")
    expect(d.facts.status).toBe("VISA_REQUIRED")
    expect(d.conflicts.map((c) => c.field)).toContain("status")
  })
})

describe("8. Several transit countries", () => {
  it("airside uses transit rules; leaving the zone or changing airports uses entry rules", () => {
    expect(transitRulePurpose("AIRSIDE")).toBe("TRANSIT")
    expect(transitRulePurpose("LEAVE_TRANSIT_ZONE")).toBe("VISIT")
    expect(transitRulePurpose("CHANGE_AIRPORT")).toBe("VISIT")
  })
  it("the trip banner shows the worst leg, and unknown outranks a known requirement", () => {
    expect(worstColour(["GREEN", "BLUE", "ORANGE"])).toBe("ORANGE")
    expect(worstColour(["GREEN", "GREY", "ORANGE"])).toBe("GREY")
    expect(worstColour(["GREEN", "RED", "GREY"])).toBe("RED")
  })
})

describe("9. Destination does not recognise the document", () => {
  it("documentAccepted=false from an official source is NOT_ACCEPTED (red), even beside a visa-free claim for others", () => {
    const k = key("XE", "GB_STATELESS_TRAVEL_DOC")
    const d = decideVisa(k, [ev({ url: "https://immigration.gov.xe/documents", kind: "DESTINATION_IMMIGRATION", covers: ["GB_STATELESS_TRAVEL_DOC"], claims: { status: "VISA_FREE", documentAccepted: false } })])
    expect(d.facts.status).toBe("NOT_ACCEPTED")
    expect(d.facts.documentAccepted).toBe(false)
    expect(COLOUR.NOT_ACCEPTED).toBe("RED")
  })
})

describe("10. Official sources that contradict each other", () => {
  const k = key("XF", "GB_CITIZEN_PASSPORT")
  const d = decideVisa(k, [
    ev({ url: "https://www.gov.uk/foreign-travel-advice/xf", kind: "GOVUK_FTA", covers: ["GB_CITIZEN_PASSPORT"], claims: { status: "VISA_FREE" } }),
    ev({ url: "https://embassy.gov.xf/visa", kind: "EMBASSY_CONSULATE", covers: ["GB_CITIZEN_PASSPORT"], claims: { status: "VISA_REQUIRED" } }),
  ])
  it("becomes CONFLICT with both sources listed", () => {
    expect(d.verification).toBe("CONFLICT")
    expect(d.conflicts[0]!.values).toHaveLength(2)
  })
  it("and the customer sees an unconfirmed (grey) answer", () => {
    const f = customerFacts({ facts: d.facts, verification: d.verification })
    expect(f.status).toBe("UNCONFIRMED")
  })
})

describe("overrides", () => {
  it("need a reason, an official URL and a status", () => {
    expect(checkOverride({ reason: "", officialUrls: ["https://x.gov"], status: "VISA_FREE" })).toEqual({ ok: false, reason: "REASON_REQUIRED" })
    expect(checkOverride({ reason: "Embassy confirmed by phone", officialUrls: [], status: "VISA_FREE" })).toEqual({ ok: false, reason: "OFFICIAL_URL_REQUIRED" })
    expect(checkOverride({ reason: "Embassy confirmed by phone", officialUrls: ["https://x.gov"], status: "VISA_FREE" })).toEqual({ ok: true })
  })
})

describe("properties", () => {
  const arbEvidence = fc.record({
    kind: fc.constantFrom(...SOURCE_KINDS),
    covers: fc.subarray(["GB_CITIZEN_PASSPORT", "GB_REFUGEE_TRAVEL_DOC", "NATIONAL_PASSPORT"]),
    status: fc.constantFrom(...VISA_STATUSES),
    documentAccepted: fc.constantFrom(true, false, null),
    n: fc.nat(1000),
  }).map((r) => ev({ url: `https://s${r.n}.example/${r.kind}`, kind: r.kind, covers: r.covers, claims: { status: r.status as VisaStatus, documentAccepted: r.documentAccepted } }))

  it("a confirmed answer always has an official source that covers the document (and GOV.UK only for British citizens)", () => {
    fc.assert(fc.property(fc.array(arbEvidence, { maxLength: 6 }), fc.constantFrom("GB_CITIZEN_PASSPORT", "GB_REFUGEE_TRAVEL_DOC", "NATIONAL_PASSPORT"), (evidence, doc) => {
      const k = key("XX", doc)
      const d = decideVisa(k, evidence)
      if (d.facts.status === "UNCONFIRMED") return
      expect(evidence.some((e) => e.official && e.covers.includes(doc) && (e.kind !== "GOVUK_FTA" || doc === "GB_CITIZEN_PASSPORT"))).toBe(true)
    }))
  })

  it("VISA_FREE never wins over a more restrictive official claim for the same document", () => {
    fc.assert(fc.property(fc.array(arbEvidence, { maxLength: 6 }), (evidence) => {
      const k = key("XX", "NATIONAL_PASSPORT")
      const d = decideVisa(k, evidence)
      if (d.facts.status !== "VISA_FREE") return
      const deciding = decidingEvidence(k, evidence)
      expect(deciding.every((e) => e.claims.documentAccepted !== false && e.claims.status === "VISA_FREE")).toBe(true)
    }))
  })

  it("third-party and IATA sources alone never confirm anything", () => {
    fc.assert(fc.property(fc.array(arbEvidence.filter((e) => !e.official), { maxLength: 6 }), (evidence) => {
      expect(decideVisa(key("XX", "GB_CITIZEN_PASSPORT"), evidence).facts.status).toBe("UNCONFIRMED")
    }))
  })
})
