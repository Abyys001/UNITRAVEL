// Chapter 27.3 — matching transliterated Persian names against sanctions-list entries, in layers:
// normalise → tokenise and reorder → score (Jaro–Winkler + phonetic key) → native script → discriminate → decide.

/** Frequent variant spellings mapped to one canonical form (a maintained equivalence table). */
const EQUIVALENTS: Record<string, string> = {
  mohammad: "mohammad", mohammed: "mohammad", muhammad: "mohammad", mohamad: "mohammad", mohamed: "mohammad", muhammed: "mohammad", mohammd: "mohammad", mhd: "mohammad", mohd: "mohammad",
  hosseini: "hosseini", husseini: "hosseini", hoseini: "hosseini", hosseyni: "hosseini", husaini: "hosseini", husayni: "hosseini", hosaini: "hosseini",
  hossein: "hossein", hussein: "hossein", husein: "hossein", hosein: "hossein", husain: "hossein", hossain: "hossein", hosain: "hossein",
  ahmad: "ahmad", ahmed: "ahmad", ahmet: "ahmad", hasan: "hassan", hassan: "hassan", hasen: "hassan",
  ghasem: "ghasem", qasem: "ghasem", qassem: "ghasem", kasem: "ghasem", ghassem: "ghasem", qasim: "ghasem", kassem: "ghasem",
  javad: "javad", jawad: "javad", mahmoud: "mahmoud", mahmood: "mahmoud", mahmud: "mahmoud", mehdi: "mehdi", mahdi: "mehdi",
  reza: "reza", riza: "reza", rida: "reza", alireza: "alireza", mohsen: "mohsen", muhsin: "mohsen", mohsin: "mohsen",
  abbas: "abbas", abas: "abbas", yousef: "yousef", yusuf: "yousef", youssef: "yousef", yosef: "yousef", jafar: "jafar", jaafar: "jafar", ja_far: "jafar",
  ebrahim: "ebrahim", ibrahim: "ebrahim", esmail: "esmail", ismail: "esmail", ismaeel: "esmail", hamid: "hamid", hameed: "hamid",
  ghorbani: "ghorbani", qorbani: "ghorbani", qurbani: "ghorbani", khamenei: "khamenei", khamenehi: "khamenei", khameneh_i: "khamenei",
  rahimi: "rahimi", rahimy: "rahimi", karimi: "karimi", karimy: "karimi", sadegh: "sadegh", sadeq: "sadegh", sadiq: "sadegh",
  mostafa: "mostafa", mustafa: "mostafa", mortaza: "morteza", morteza: "morteza", murtaza: "morteza", mojtaba: "mojtaba", mujtaba: "mojtaba",
}
const PARTICLES = new Set(["al", "el", "ul", "ol", "bin", "ibn", "binte", "bint", "abu", "seyed", "seyyed", "sayed", "sayyid", "said", "mir", "haj", "haji", "hajj"])

export function normaliseLatin(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/['’`ʿʾ]/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\b(al|el|ul)-/g, "al ")
    .replace(/-/g, " ")
    .replace(/(zadeh|zade|zada)\b/g, " zade")
    .replace(/\s+/g, " ")
    .trim()
}

function canonToken(t: string): string {
  let x = t.replace(/(ee|ey|iy)$/, "i").replace(/y$/, "i")
  x = x.replace(/aa/g, "a").replace(/oo/g, "u").replace(/ou/g, "u").replace(/ee/g, "i")
  return EQUIVALENTS[t] ?? EQUIVALENTS[x] ?? x
}

export function tokens(name: string): string[] {
  return normaliseLatin(name).split(" ").filter((t) => t && !PARTICLES.has(t)).map(canonToken)
}

/** Phonetic key for transliterated Persian: collapse letter groups that transliterate interchangeably. */
export function phoneticKey(token: string): string {
  const k = token
    .replace(/gh|q/g, "G").replace(/kh|x/g, "X").replace(/ph/g, "f").replace(/w/g, "v").replace(/zh/g, "j").replace(/sh/g, "S").replace(/ch/g, "C")
    .replace(/dh|zz/g, "z").replace(/ck|c(?=[^h])/g, "k").replace(/th/g, "t")
    .replace(/(.)\1+/g, "$1")
  return k[0] + k.slice(1).replace(/[aeiouy]/g, "")
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const am = new Array<boolean>(a.length).fill(false)
  const bm = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (bm[j] || a[i] !== b[j]) continue
      am[i] = true; bm[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue
    while (!bm[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

function tokenSimilarity(a: string, b: string): number {
  const jw = jaroWinkler(a, b)
  // The phonetic key drops vowels, so it only confirms tokens that are already close in spelling.
  const ph = jw >= 0.8 && phoneticKey(a) === phoneticKey(b) ? 0.95 : 0
  const sim = Math.max(jw, ph)
  // Weak token agreement counts quadratically, so two loosely similar tokens never add up to a review hit.
  return sim >= 0.9 ? sim : sim * sim
}

/** Token-set comparison with reordering and joined forms ("Ali Reza Hosseini" ≈ "Hosseini Alireza"). */
export function nameScore(query: string, candidate: string): number {
  const variants = (ts: string[]) => {
    const out = [ts]
    for (let i = 0; i < ts.length - 1; i++) out.push([...ts.slice(0, i), canonToken(ts[i]! + ts[i + 1]!), ...ts.slice(i + 2)])
    return out
  }
  const q = tokens(query)
  const c = tokens(candidate)
  if (!q.length || !c.length) return 0
  let best = 0
  for (const qv of variants(q)) for (const cv of variants(c)) {
    // A joined form is only compared with an unjoined one: joining both sides lets "Reza Ahmadi" ≈ "Reza Mahdavi" through the long shared prefix.
    if (qv.length < q.length && cv.length < c.length) continue
    const [short, long] = qv.length <= cv.length ? [qv, cv] : [cv, qv]
    const used = new Set<number>()
    let sum = 0
    for (const t of short) {
      let bi = -1, bs = 0
      long.forEach((u, i) => { if (!used.has(i)) { const s = tokenSimilarity(t, u); if (s > bs) { bs = s; bi = i } } })
      if (bi >= 0) used.add(bi)
      sum += bs
    }
    // Unmatched tokens in the longer name reduce the score, so a single shared first name is never a match.
    const coverage = short.length / long.length
    best = Math.max(best, (sum / short.length) * (0.75 + 0.25 * coverage) * (short.length === 1 && long.length > 1 ? 0.8 : 1))
  }
  return Math.min(1, best)
}

export function normalisePersianScript(s: string): string {
  return s.replace(/[ً-ٰٟـ]/g, "").replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/ة/g, "ه").replace(/[أإآ]/g, "ا").replace(/‌/g, " ").replace(/\s+/g, " ").trim()
}

export interface MatchSubject { name: string; nameFa?: string | null; dateOfBirth?: string | null; nationality?: string | null }
export interface MatchCandidate { primary: string; aliases: string[]; nonLatin: string[]; dob: string[]; nationalities: string[] }

/** Overall score in [0, 1] with the reasons that explain it, kept as evidence (ch. 27.3). */
export function scoreCandidate(s: MatchSubject, c: MatchCandidate): { score: number; matchedName: string; reasons: string[] } {
  let best = 0
  let matchedName = c.primary
  for (const n of [c.primary, ...c.aliases]) {
    const sc = nameScore(s.name, n)
    if (sc > best) { best = sc; matchedName = n }
  }
  const reasons = [`name similarity ${best.toFixed(3)} with "${matchedName}"`]
  if (s.nameFa && c.nonLatin.length) {
    const fa = normalisePersianScript(s.nameFa)
    const scriptBest = Math.max(...c.nonLatin.map((n) => jaroWinkler(fa, normalisePersianScript(n))))
    reasons.push(`native-script similarity ${scriptBest.toFixed(3)}`)
    // Script agreement can lift a weak transliteration match; it never lowers a strong Latin match on its own.
    if (scriptBest > best) best = (best + scriptBest) / 2 + 0.02
  }
  let score = best
  if (s.dateOfBirth && c.dob.length) {
    const full = c.dob.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    const years = c.dob.map((d) => Number(d.slice(0, 4)))
    if (full.includes(s.dateOfBirth)) { score += 0.05; reasons.push("date of birth matches") }
    else if (full.length && !full.includes(s.dateOfBirth)) { score *= 0.75; reasons.push("different full date of birth") }
    else if (years.length && !years.some((y) => Math.abs(y - Number(s.dateOfBirth!.slice(0, 4))) <= 1)) { score *= 0.85; reasons.push("birth year differs") }
  }
  if (s.nationality && c.nationalities.length) {
    if (c.nationalities.includes(s.nationality)) { score += 0.02; reasons.push("nationality matches") }
    else { score -= 0.05; reasons.push("nationality differs") }
  }
  return { score: Math.max(0, Math.min(1, score)), matchedName, reasons }
}

export function decide(score: number, t: { match: number; review: number }): "MATCH" | "POSSIBLE_MATCH" | "CLEAR" {
  return score >= t.match ? "MATCH" : score >= t.review ? "POSSIBLE_MATCH" : "CLEAR"
}

/** Tokens and phonetic keys stored on list entries for the candidate lookup (GIN index). */
export function searchTokens(names: string[]): string[] {
  const out = new Set<string>()
  for (const n of names) for (const t of tokens(n)) { if (t.length >= 2) { out.add(t); out.add(`ph:${phoneticKey(t)}`) } }
  return [...out]
}
