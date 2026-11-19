// Writes the ADR-0038 sample provider PDF (QR + PDF417 + Code 128) to a path, for manual and Playwright checks.
// Usage (from apps/api): node scripts/write-ticket-pdf.ts <out.pdf> [--signed] [--pnr=ABC123] [--ticket=2351234567890] [--name="REZAEI/NEDA MS"]
import { writeFileSync } from "node:fs"

import { makeTicketPdf } from "../test/fixtures/ticket-pdf.ts"

const args = process.argv.slice(2)
const out = args.find((a) => !a.startsWith("--"))
if (!out) {
  console.error("usage: node scripts/write-ticket-pdf.ts <out.pdf> [--signed] [--pnr=ABC123] [--ticket=2351234567890] [--name=\"SURNAME/GIVEN MS\"]")
  process.exit(2)
}
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const ticket = opt("ticket")
const name = opt("name")
const bytes = await makeTicketPdf({
  signed: args.includes("--signed"),
  pnr: opt("pnr"),
  passengers: ticket || name ? [{ name: name ?? "REZAEI/NEDA MS", ticketNumber: ticket ?? "2351234567890" }] : undefined,
})
writeFileSync(out, bytes)
console.log(`wrote ${bytes.length} bytes to ${out}`)
