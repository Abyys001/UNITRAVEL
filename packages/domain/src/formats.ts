// Chapter 13.4 — references: UT-{F|C|A}-{6 × Crockford Base32}. Random, not sequential; I, L, O, U never appear.
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export type RefType = "F" | "C" | "A"

export function generateReference(type: RefType, randomBytes: (n: number) => Uint8Array = defaultRandom): string {
  const bytes = randomBytes(6)
  let code = ""
  for (const b of bytes) code += CROCKFORD[b & 31]
  return `UT-${type}-${code}`
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

/** Console search is case-insensitive and tolerant of the characters people mishear on the phone. */
export function normaliseReference(input: string): string | null {
  const s = input.trim().toUpperCase().replace(/\s+/g, "").replace(/O/g, "0").replace(/[IL]/g, "1")
  const m = /^UT-?([FCA])-?([0-9A-HJKMNP-TV-Z]{6})$/.exec(s)
  return m ? `UT-${m[1]}-${m[2]}` : null
}

/** Record locator: 6 alphanumerics (ch. 13.7). */
export function isRecordLocator(v: string): boolean {
  return /^[A-Z0-9]{6}$/.test(v)
}

/** Ticket number: 13 digits whose 3-digit prefix is the validating carrier's accounting code (ch. 13.7). */
export function validateTicketNumber(ticket: string, accountingCode: string | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!/^\d{13}$/.test(ticket)) return { ok: false, reason: "Ticket number must be 13 digits" }
  if (!accountingCode) return { ok: false, reason: "The validating carrier has no accounting code in reference data" }
  if (ticket.slice(0, 3) !== accountingCode) return { ok: false, reason: `Prefix ${ticket.slice(0, 3)} does not match the carrier's accounting code ${accountingCode}` }
  return { ok: true }
}

/** AWB: 3-digit prefix + 8-digit serial; the serial's last digit = first seven digits mod 7 (ch. 14.8). */
export function validateAwb(input: string): { ok: true; normalised: string } | { ok: false; reason: string } {
  const digits = input.replace(/[\s-]/g, "")
  if (!/^\d{11}$/.test(digits)) return { ok: false, reason: "An AWB number has 11 digits" }
  const serial = digits.slice(3)
  const check = Number(serial.slice(0, 7)) % 7
  if (check !== Number(serial[7])) return { ok: false, reason: `Check digit should be ${check}` }
  return { ok: true, normalised: `${digits.slice(0, 3)}-${serial}` }
}

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits → Latin (ch. 29.4). */
export function normaliseDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
}

/** GSM-7 vs UCS-2 segment counting for the SMS template editor (ch. 17.4). */
const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM7_EXT = "^{}\\[~]|€"
export function smsSegments(text: string): { encoding: "GSM7" | "UCS2"; count: number; chars: number } {
  let gsm = true
  let septets = 0
  for (const ch of text) {
    if (GSM7.includes(ch)) septets += 1
    else if (GSM7_EXT.includes(ch)) septets += 2
    else { gsm = false; break }
  }
  if (gsm) return { encoding: "GSM7", chars: septets, count: septets <= 160 ? 1 : Math.ceil(septets / 153) }
  const units = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0)
  return { encoding: "UCS2", chars: units, count: units <= 70 ? 1 : Math.ceil(units / 67) }
}
