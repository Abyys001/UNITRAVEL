import { describe, expect, it } from "vitest"

import { readSeedContent } from "./content"

describe("seed content (UniTravel-Content.docx, ADR-0017)", () => {
  const { entries, glossary } = readSeedContent()

  it("parses against the contracts", () => {
    expect(entries.length).toBeGreaterThan(0)
    expect(glossary.length).toBeGreaterThan(0)
  })

  it("seeds nothing as published and keeps open claims in review", () => {
    for (const e of entries) {
      expect(["DRAFT", "IN_REVIEW"]).toContain(e.status)
      if (e.claimsToVerify.length > 0) expect(e.status).toBe("IN_REVIEW")
    }
  })

  it("has unique slugs and Persian bodies", () => {
    expect(new Set(entries.map((e) => `${e.kind}/${e.locale}/${e.slug}`)).size).toBe(entries.length)
    expect(new Set(glossary.map((g) => g.slug)).size).toBe(glossary.length)
    for (const e of entries) expect(e.locale).toBe("fa")
  })

  it("keeps every glossary related term pointing at a known English term or a term named in the source", () => {
    const en = new Set(glossary.map((g) => g.termEn))
    const stray = glossary.flatMap((g) => g.related).filter((r) => !en.has(r))
    expect(stray.sort()).toEqual(["Baggage Claim", "Conveyor Belt"])
  })
})
