import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { decide, nameScore, scoreCandidate, tokens } from "./name-matcher"

const T = { match: 0.93, review: 0.85 }
const entry = (primary: string, extra: Partial<{ aliases: string[]; dob: string[]; nationalities: string[]; nonLatin: string[] }> = {}) => ({ primary, aliases: [], nonLatin: [], dob: [], nationalities: [], ...extra })

/**
 * Labelled evaluation set (ch. 32.5). True entries are fictional names in several transliterations; non-matches are
 * common Iranian names that share a token. Target: recall ≥ 0.98 at the review threshold.
 */
const TRUE_PAIRS: [string, string][] = [
  ["Mohammad Hosseini Testfar", "Muhammad Husseini Testfar"], ["Ali Reza Kamranpour", "Alireza Kamranpur"], ["Hosseini Alireza Kamranpour", "Alireza Kamranpour Hosseini"],
  ["Ghasem Rostami Testzadeh", "Qasem Rostami Testzade"], ["Seyed Mahmoud Fictional-Zadeh", "Mahmood Fictionalzadeh"], ["Javad Sarrafian", "Jawad Sarafian"],
  ["Ahmad Karimi Testnejad", "Ahmed Karimy Testnejad"], ["Mojtaba Farahani Sample", "Mujtaba Farahani Sample"], ["Yousef Zarei Testi", "Yusuf Zarei Testi"],
  ["Ebrahim Ghorbani Example", "Ibrahim Qorbani Example"], ["Mostafa Al-Testi", "Mustafa El Testi"], ["Morteza Shafiei Test", "Murtaza Shafiee Test"],
  ["Sadegh Bahrami Demo", "Sadeq Bahrami Demo"], ["Hassan Rahimi Exampleian", "Hasan Rahimy Exampleian"], ["Esmail Jafari Sampleour", "Ismail Jaafari Sampleour"],
]
const NON_MATCH: [string, string][] = [
  ["Mohammad Rezaei", "Mohammad Hosseini Testfar"], ["Ali Ahmadi", "Alireza Kamranpour"], ["Reza Karimi", "Ahmad Karimi Testnejad"],
  ["Maryam Hosseini", "Mohammad Hosseini Testfar"], ["Arash Foureyes", "Firas al-Akhras"], ["Neda Testtraveller", "Neda Mohammadi"], ["Hassan Mohammadi", "Hasan Rahimy Exampleian"], ["Sara Jafari", "Esmail Jafari Sampleour"],
]

describe("Persian name matcher", () => {
  it("normalises affixes, particles and variant spellings", () => {
    expect(tokens("Seyed Muhammad Al-Husseini")).toEqual(["mohammad", "al", "hosseini"].filter((t) => t !== "al"))
    expect(tokens("Ahmadi-Zadeh")).toEqual(["ahmadi", "zade"])
  })

  it(`recall ≥ 0.98 on true matches at the review threshold (${TRUE_PAIRS.length} pairs)`, () => {
    const hits = TRUE_PAIRS.filter(([a, b]) => decide(nameScore(a, b), T) !== "CLEAR").length
    expect(hits / TRUE_PAIRS.length).toBeGreaterThanOrEqual(0.98)
  })

  it("keeps common names that share one token below the review threshold", () => {
    const fp = NON_MATCH.filter(([a, b]) => decide(nameScore(a, b), T) !== "CLEAR")
    expect(fp).toEqual([])
  })

  it("a different full date of birth reduces a name-only match below the match threshold", () => {
    const e = entry("Muhammad Husseini Testfar", { dob: ["1961-04-02"], nationalities: ["IR"] })
    expect(decide(scoreCandidate({ name: "Mohammad Hosseini Testfar", dateOfBirth: "1961-04-02", nationality: "IR" }, e).score, T)).toBe("MATCH")
    expect(decide(scoreCandidate({ name: "Mohammad Hosseini Testfar", dateOfBirth: "1999-01-01", nationality: "IR" }, e).score, T)).not.toBe("MATCH")
  })

  it("compares in Persian script when both sides have it", () => {
    const e = entry("Kamranpour Alireza", { nonLatin: ["علیرضا کامرانپور"] })
    expect(scoreCandidate({ name: "Alireza Kamranpur", nameFa: "عليرضا كامرانپور" }, e).reasons.join()).toContain("native-script")
  })
})

// Ch. 27.3 / 32.5: tuning must never lose a true match, and a different surname behind a shared given name must not reach review.
const GIVEN = ["Reza", "Ali", "Mohammad", "Hassan", "Mehdi", "Javad", "Sara", "Maryam", "Ahmad", "Hossein"]
const SURNAMES = ["Ahmadi", "Mahdavi", "Rezaei", "Tehrani", "Shirazi", "Mousavi", "Bagheri", "Naderi", "Soltani", "Zandi", "Farahani", "Jalili", "Kazemi", "Sharifi", "Hashemi"]

describe("Matcher regression properties (ch. 27.3)", () => {
  it("every labelled true pair still hits review, in both directions and with the surname first", () => {
    for (const [a, b] of TRUE_PAIRS) {
      expect(decide(nameScore(a, b), T), `${a} / ${b}`).not.toBe("CLEAR")
      expect(decide(nameScore(b, a), T), `${b} / ${a}`).not.toBe("CLEAR")
      const w = a.split(" ")
      const swapped = [w[w.length - 1], ...w.slice(0, -1)].join(" ") // surname first
      expect(decide(nameScore(swapped, b), T), `${swapped} / ${b}`).not.toBe("CLEAR")
    }
  })

  it("an identical name always scores as a match", () => {
    fc.assert(fc.property(fc.constantFrom(...GIVEN), fc.constantFrom(...SURNAMES), (g, s) => decide(nameScore(`${g} ${s}`, `${g} ${s}`), T) === "MATCH"))
  })

  it("the same given name with a different surname stays below the review threshold (Reza Ahmadi vs Reza Mahdavi)", () => {
    expect(nameScore("Reza Ahmadi", "Reza MAHDAVI")).toBeLessThan(T.review)
    fc.assert(fc.property(fc.constantFrom(...GIVEN), fc.constantFrom(...SURNAMES), fc.constantFrom(...SURNAMES), (g, s1, s2) => {
      fc.pre(s1 !== s2)
      return nameScore(`${g} ${s1}`, `${g} ${s2}`) < T.review
    }))
  })

  it("splitting and joining a given name (Ali Reza / Alireza) is still a match", () => {
    expect(decide(nameScore("Ali Reza Kamranpour", "Alireza Kamranpour"), T)).not.toBe("CLEAR")
    expect(decide(nameScore("Alireza Kamranpour", "Ali Reza Kamranpour"), T)).not.toBe("CLEAR")
  })
})
