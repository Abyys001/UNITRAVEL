// Chapter 27.2 — sanctions list ingestion. Parsers for the official formats observed on 22 Oct 2026:
// UK Sanctions List CSV (FCDO), OFAC SDN.CSV + ALT.CSV, EU Financial Sanctions File (semicolon CSV).

export interface ParsedEntry {
  externalId: string
  type: "PERSON" | "ENTITY" | "VESSEL" | "AIRCRAFT"
  primary: string
  aliases: string[]
  nonLatin: string[]
  dob: string[]
  nationalities: string[]
  identifiers: { type: string; value: string }[]
  programmes: string[]
}

/** RFC 4180 CSV with a configurable delimiter; handles quoted fields with embedded delimiters and newlines. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"') q = true
    else if (c === delimiter) { row.push(field); field = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field); rows.push(row); row = []; field = ""
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const COUNTRY_CODES: Record<string, string> = {
  iran: "IR", "iran (islamic republic of)": "IR", iraq: "IQ", turkey: "TR", "türkiye": "TR", "turkiye": "TR", "united arab emirates": "AE", uae: "AE", syria: "SY",
  "syrian arab republic": "SY", russia: "RU", "russian federation": "RU", lebanon: "LB", afghanistan: "AF", armenia: "AM", oman: "OM", china: "CN", "north korea": "KP",
  "democratic people's republic of korea": "KP", belarus: "BY", yemen: "YE", pakistan: "PK", "united kingdom": "GB", germany: "DE", france: "FR",
}
export const toIso2 = (s: string) => COUNTRY_CODES[s.trim().toLowerCase()] ?? (/^[A-Z]{2}$/.test(s.trim()) ? s.trim() : "")

/** dd/mm/yyyy (00 for unknown parts) → yyyy-mm-dd or yyyy. */
function ukDob(s: string): string[] {
  return s.split(/[|;]/).map((d) => d.trim()).filter(Boolean).map((d) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d)
    if (!m) return /^\d{4}$/.test(d) ? d : ""
    return m[1] === "00" || m[2] === "00" ? m[3]! : `${m[3]}-${m[2]}-${m[1]}`
  }).filter(Boolean)
}

export function parseUkList(text: string): ParsedEntry[] {
  const lines = text.replace(/^﻿/, "")
  const start = lines.indexOf("\n") >= 0 && lines.startsWith("Report Date") ? lines.indexOf("\n") + 1 : 0
  const rows = parseCsv(lines.slice(start))
  const header = rows[0] ?? []
  const col = (name: string) => header.indexOf(name)
  const idx = { id: col("Unique ID"), n: [col("Name 1"), col("Name 2"), col("Name 3"), col("Name 4"), col("Name 5"), col("Name 6")], nt: col("Name type"), nl: col("Name non-latin script"), regime: col("Regime Name"), type: col("Designation Type"), dob: col("D.O.B"), nat: col("Nationality(/ies)"), passport: col("Passport number"), nid: col("National Identifier number") }
  const byId = new Map<string, ParsedEntry>()
  for (const r of rows.slice(1)) {
    const id = r[idx.id]
    if (!id) continue
    const name = idx.n.map((i) => r[i] ?? "").filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
    const t = (r[idx.type] ?? "").toLowerCase()
    let e = byId.get(id)
    if (!e) {
      e = { externalId: id, type: t.startsWith("individual") ? "PERSON" : t.startsWith("ship") ? "VESSEL" : "ENTITY", primary: "", aliases: [], nonLatin: [], dob: [], nationalities: [], identifiers: [], programmes: [] }
      byId.set(id, e)
    }
    if (name) {
      if (/primary name$/i.test(r[idx.nt] ?? "") && !e.primary) e.primary = name
      else if (!e.aliases.includes(name)) e.aliases.push(name)
    }
    const nl = r[idx.nl]
    if (nl && !e.nonLatin.includes(nl)) e.nonLatin.push(nl)
    for (const d of ukDob(r[idx.dob] ?? "")) if (!e.dob.includes(d)) e.dob.push(d)
    for (const n of (r[idx.nat] ?? "").split(/[,;|]/)) { const c = toIso2(n.replace(/^\(\d+\)\s*/, "")); if (c && !e.nationalities.includes(c)) e.nationalities.push(c) }
    if (r[idx.passport]) e.identifiers.push({ type: "PASSPORT", value: r[idx.passport]! })
    if (r[idx.nid]) e.identifiers.push({ type: "NATIONAL_ID", value: r[idx.nid]! })
    const regime = r[idx.regime]
    if (regime && !e.programmes.includes(regime)) e.programmes.push(regime)
  }
  for (const e of byId.values()) if (!e.primary) e.primary = e.aliases.shift() ?? ""
  return [...byId.values()].filter((e) => e.primary)
}

const OFAC_NULL = (s: string | undefined) => (!s || s.trim() === "-0-" ? "" : s.trim())
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" }

/** OFAC: "LASTNAME, First" names; DOB and nationality are inside Remarks ("DOB 01 Jan 1960; nationality Iran;"). */
export function parseOfac(sdnText: string, altText: string): ParsedEntry[] {
  const entries = new Map<string, ParsedEntry>()
  const flip = (n: string) => { const [last, first] = n.split(/,\s*/); return first ? `${first} ${last}` : n }
  for (const r of parseCsv(sdnText)) {
    const id = OFAC_NULL(r[0])
    if (!id || !/^\d+$/.test(id)) continue
    const type = OFAC_NULL(r[2]).toLowerCase()
    const remarks = OFAC_NULL(r[11])
    const dob = [...remarks.matchAll(/DOB (?:circa )?(\d{1,2} [A-Za-z]{3} \d{4}|\d{4})/g)].map((m) => {
      const p = m[1]!.split(" ")
      return p.length === 3 ? `${p[2]}-${MONTHS[p[1]!.toLowerCase()] ?? "01"}-${p[0]!.padStart(2, "0")}` : p[0]!
    })
    const nationalities = [...remarks.matchAll(/(?:nationality|citizen) ([A-Za-z ()']+?)[;.]/g)].map((m) => toIso2(m[1]!)).filter(Boolean)
    const passports = [...remarks.matchAll(/Passport ([A-Z0-9]+)/g)].map((m) => ({ type: "PASSPORT", value: m[1]! }))
    entries.set(id, {
      externalId: id, type: type === "individual" ? "PERSON" : type === "vessel" ? "VESSEL" : type === "aircraft" ? "AIRCRAFT" : "ENTITY",
      primary: type === "individual" ? flip(OFAC_NULL(r[1])) : OFAC_NULL(r[1]), aliases: [], nonLatin: [], dob, nationalities: [...new Set(nationalities)], identifiers: passports,
      programmes: OFAC_NULL(r[3]).split(/\]\s*\[|;/).map((p) => p.replace(/[[\]]/g, "").trim()).filter(Boolean),
    })
  }
  for (const r of parseCsv(altText)) {
    const e = entries.get(OFAC_NULL(r[0]))
    const name = OFAC_NULL(r[3])
    if (e && name) e.aliases.push(e.type === "PERSON" ? flip(name) : name)
  }
  return [...entries.values()]
}

export function parseEu(text: string): ParsedEntry[] {
  const rows = parseCsv(text.replace(/^﻿/, ""), ";")
  const h = rows[0] ?? []
  const c = (n: string) => h.indexOf(n)
  const i = { id: c("Entity_LogicalId"), type: c("Entity_SubjectType_ClassificationCode"), prog: c("Entity_Regulation_Programme"), whole: c("NameAlias_WholeName"), lang: c("NameAlias_NameLanguage"), dob: c("BirthDate_BirthDate"), year: c("BirthDate_Year"), cit: c("Citizenship_CountryIso2Code"), idn: c("Identification_Number") }
  const byId = new Map<string, ParsedEntry>()
  for (const r of rows.slice(1)) {
    const id = r[i.id]
    if (!id) continue
    let e = byId.get(id)
    if (!e) {
      const t = (r[i.type] ?? "").toLowerCase()
      e = { externalId: id, type: t === "person" ? "PERSON" : "ENTITY", primary: "", aliases: [], nonLatin: [], dob: [], nationalities: [], identifiers: [], programmes: [] }
      byId.set(id, e)
    }
    const name = r[i.whole]?.trim()
    if (name) {
      const nonLatin = /[^\u0000-ɏ\s.'-]/.test(name)
      if (nonLatin) { if (!e.nonLatin.includes(name)) e.nonLatin.push(name) }
      else if (!e.primary) e.primary = name
      else if (name !== e.primary && !e.aliases.includes(name)) e.aliases.push(name)
    }
    const dob = r[i.dob]?.trim() || r[i.year]?.trim()
    if (dob && !e.dob.includes(dob)) e.dob.push(dob)
    const cit = r[i.cit]?.trim()
    if (cit && cit !== "00" && !e.nationalities.includes(cit)) e.nationalities.push(cit)
    const prog = r[i.prog]?.trim()
    if (prog && !e.programmes.includes(prog)) e.programmes.push(prog)
    if (i.idn >= 0 && r[i.idn]) e.identifiers.push({ type: "ID", value: r[i.idn]! })
  }
  return [...byId.values()].filter((e) => e.primary || e.nonLatin.length)
}

/** Local-only fixture of FICTIONAL entries so the hold-and-release workflow can be demonstrated without real names. */
export const TEST_LIST: ParsedEntry[] = [
  { externalId: "TEST-0001", type: "PERSON", primary: "Kourosh Testfarzaneh", aliases: ["Kurosh Testfarzane", "Kourosh Test-Farzaneh"], nonLatin: ["کوروش تست‌فرزانه"], dob: ["1970-03-21"], nationalities: ["IR"], identifiers: [], programmes: ["FICTIONAL TEST PROGRAMME"] },
  { externalId: "TEST-0002", type: "ENTITY", primary: "Example Sanctioned Logistics Ltd", aliases: ["Example Sanctioned Logistic"], nonLatin: [], dob: [], nationalities: ["TR"], identifiers: [], programmes: ["FICTIONAL TEST PROGRAMME"] },
  { externalId: "TEST-0003", type: "PERSON", primary: "Farhad Samplenezhad", aliases: ["Farhad Samplenejad"], nonLatin: [], dob: ["1982"], nationalities: ["IR"], identifiers: [], programmes: ["FICTIONAL TEST PROGRAMME"] },
]
