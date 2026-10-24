import type { CommercialDocumentSettings } from "@unitravel/contracts"

import { type PdfSection, renderPdf } from "../documents/pdf"

/** Printed in place of every company particular the accountant has not supplied yet (owner decision 5). Never invented. */
export const UNKNOWN_PARTICULAR = "UNKNOWN - to be confirmed by the accountant"

export interface CompanyInfo { name: string; email: string; phone: string }
export interface DocMoney { amountMinor: number; currency: string }

export const pdfMoney = (m: DocMoney) => `${m.currency} ${(m.amountMinor / 100).toFixed(2)}`

/** Company block shared by quotations and invoices. */
export function particularsSection(company: CompanyInfo, cfg: CommercialDocumentSettings): PdfSection {
  return {
    heading: "Issued by",
    rows: [
      ["Company", company.name],
      ["Registered address", cfg.registeredAddress ?? UNKNOWN_PARTICULAR],
      ["Company registration no.", cfg.registrationNumber ?? UNKNOWN_PARTICULAR],
      ["VAT number", cfg.vatNumber ?? UNKNOWN_PARTICULAR],
      ["VAT treatment", cfg.vatTreatment ?? UNKNOWN_PARTICULAR],
      ["Contact", `${company.email} · ${company.phone}`],
    ],
  }
}

export interface InvoicePdfInput {
  number: string
  requestRef: string
  issuedAt: Date
  expiresAt: Date | null
  paid: boolean
  billTo: string[]
  currency: string
  lines: { description: string; quantity: number; unitAmountMinor: number; amountMinor: number }[]
  totalMinor: number
  company: CompanyInfo
  cfg: CommercialDocumentSettings
  notes: string[]
}

export function renderInvoicePdf(i: InvoicePdfInput): Promise<Buffer> {
  const money = (minor: number) => pdfMoney({ amountMinor: minor, currency: i.currency })
  return renderPdf(`Invoice ${i.number}`, `Request ${i.requestRef} · issued ${i.issuedAt.toISOString().slice(0, 10)}`, [
    particularsSection(i.company, i.cfg),
    { heading: "Billed to", paragraphs: i.billTo },
    {
      heading: "Charges",
      table: {
        columns: [{ label: "Description", x: 50 }, { label: "Qty", x: 380, right: true }, { label: "Unit", x: 460, right: true }, { label: "Amount", x: 545, right: true }],
        rows: [...i.lines.map((l) => [l.description, String(l.quantity), money(l.unitAmountMinor), money(l.amountMinor)]), ["Total due", "", "", money(i.totalMinor)]],
        emphasis: true,
      },
    },
    { heading: "Payment", paragraphs: [i.paid ? "Payment for this invoice has already been received and verified." : `This invoice is payable until ${i.expiresAt?.toISOString().slice(0, 16).replace("T", " ")} UTC. After that it expires and a new invoice is needed.`] },
  ], [...i.notes, "Amounts on an issued invoice never change: a correction is a cancelled invoice and a new one with a new number."], { kind: "Invoice" })
}

export interface QuotationPdfInput {
  number: string
  title: string
  subtitle: string
  sections: PdfSection[]
  company: CompanyInfo
  cfg: CommercialDocumentSettings
  footer: string[]
}

export function renderQuotationPdf(q: QuotationPdfInput): Promise<Buffer> {
  return renderPdf(q.title, `${q.subtitle} · quotation ${q.number}`, [...q.sections, particularsSection(q.company, q.cfg)], q.footer, { kind: "Quotation" })
}
