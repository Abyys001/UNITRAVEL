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
