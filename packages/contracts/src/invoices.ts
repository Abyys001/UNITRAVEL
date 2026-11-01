import { z } from "zod"

import { IsoDateTime, Money, Reference, Uuid } from "./common"

// ADR-0006: commercial documents. A quotation is the sent quote with a number and a PDF; an invoice is its own aggregate.
export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "CANCELLED", "REFUNDED"] as const
export const InvoiceStatus = z.enum(INVOICE_STATUSES)
export type InvoiceStatus = z.infer<typeof InvoiceStatus>
/** A draft is never shown to a customer (ADR-0006 C9), so the customer schema cannot represent one. */
export const CustomerInvoiceStatus = z.enum(["ISSUED", "PAID", "CANCELLED", "REFUNDED"])

/** Reasons staff choose when cancelling; `EXPIRED` is set only by the system when the expiry passes (ADR-0006 C3). */
export const INVOICE_CANCEL_REASONS = ["CORRECTION", "CUSTOMER_REQUEST", "DUPLICATE", "OTHER"] as const
export const InvoiceCancelReason = z.enum(INVOICE_CANCEL_REASONS)
export const InvoiceCancelCode = z.enum(["EXPIRED", ...INVOICE_CANCEL_REASONS])
export type InvoiceCancelCode = z.infer<typeof InvoiceCancelCode>

export const InvoiceCancelBody = z.object({ reasonCode: InvoiceCancelReason, note: z.string().trim().max(500).optional() })
  .refine((b) => b.reasonCode !== "OTHER" || !!b.note, { message: "Explain why", path: ["note"] })

export const INVOICE_LINE_TYPES = ["VISA", "BUS", "TRAIN", "HOTEL", "STAY", "CIP", "INSURANCE", "TOUR", "TRANSFER", "OTHER", "DISCOUNT"] as const
export const InvoiceLineType = z.enum(INVOICE_LINE_TYPES)
export type InvoiceLineType = z.infer<typeof InvoiceLineType>

export const InvoiceLine = z.object({
  /** Direct invoices only (ADR-0028). */
  serviceType: InvoiceLineType.nullable().default(null),
  description: z.string(),
  quantity: z.number().int().min(1),
  unitAmount: Money,
  amount: Money,
})
export type InvoiceLine = z.infer<typeof InvoiceLine>

export const CustomerInvoice = z.object({
  number: z.string(),
  status: CustomerInvoiceStatus,
  requestRef: Reference,
  productType: z.enum(["FLIGHT", "CARGO", "SERVICE"]),
  lines: z.array(InvoiceLine),
  total: Money,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelReason: InvoiceCancelCode.nullable(),
  documentId: Uuid.nullable(),
  /** Written by staff for the customer on a direct invoice. */
  notes: z.string().nullable().default(null),
})
export type CustomerInvoice = z.infer<typeof CustomerInvoice>

/** The quotation is the sent quote: no amounts here, the quote itself is on the request page. */
export const CustomerQuotation = z.object({
  number: z.string(),
  requestRef: Reference,
  productType: z.enum(["FLIGHT", "CARGO", "SERVICE"]),
  status: z.enum(["SENT", "ACCEPTED", "DECLINED", "EXPIRED", "SUPERSEDED"]),
  sentAt: IsoDateTime,
  validUntil: IsoDateTime.nullable(),
  documentId: Uuid.nullable(),
})
export type CustomerQuotation = z.infer<typeof CustomerQuotation>

export const BillingDocuments = z.object({ quotations: z.array(CustomerQuotation), invoices: z.array(CustomerInvoice) })
export type BillingDocuments = z.infer<typeof BillingDocuments>

export const InvoiceHistoryEntry = z.object({
  fromStatus: InvoiceStatus.nullable(),
  toStatus: InvoiceStatus,
  command: z.string(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  actorKind: z.enum(["STAFF", "SYSTEM"]),
  actorName: z.string().nullable(),
  createdAt: IsoDateTime,
})

/** Amounts are null for staff without `pricing.read.internal` (ADR-0004); the document itself stays visible. */
export const StaffInvoice = z.object({
  id: Uuid,
  number: z.string().nullable(),
  status: InvoiceStatus,
  origin: z.enum(["QUOTE", "DIRECT"]),
  /** `emailDeliverable` is false when the customer has no verified email, so the invoice goes by SMS and inbox only. */
  customer: z.object({ id: Uuid, name: z.string(), emailDeliverable: z.boolean() }),
  notes: z.string().nullable(),
  dueDays: z.number().int().nullable(),
  requestRef: Reference,
  productType: z.enum(["FLIGHT", "CARGO", "SERVICE"]),
  currency: z.string(),
  lines: z.array(InvoiceLine.extend({ unitAmount: Money.nullable(), amount: Money.nullable() })),
  total: Money.nullable(),
  issuedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
  paidAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelReason: InvoiceCancelCode.nullable(),
  documentId: Uuid.nullable(),
  createdAt: IsoDateTime,
  history: z.array(InvoiceHistoryEntry),
  /** Why the next command is not available (guards from the domain), keyed by command. */
  actions: z.array(z.object({ command: z.enum(["issue", "cancel"]), allowed: z.boolean(), reason: z.string().optional() })),
})
export type StaffInvoice = z.infer<typeof StaffInvoice>

export const StaffInvoiceListItem = StaffInvoice.omit({ lines: true, history: true, actions: true })
export type StaffInvoiceListItem = z.infer<typeof StaffInvoiceListItem>

const DirectInvoiceLine = z.object({
  serviceType: InvoiceLineType,
  description: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(999),
  /** Negative only on a DISCOUNT line. */
  unitAmountMinor: z.number().int().min(-100_000_000).max(100_000_000),
})
export type DirectInvoiceLine = z.infer<typeof DirectInvoiceLine>

/** The server recomputes every amount and the total from these (ADR-0028). */
export const directInvoiceTotal = (lines: readonly Pick<DirectInvoiceLine, "quantity" | "unitAmountMinor">[]): number => lines.reduce((s, l) => s + l.quantity * l.unitAmountMinor, 0)

const directInvoiceFields = {
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(DirectInvoiceLine).min(1).max(50),
  dueDays: z.number().int().min(1).max(365).nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
}
const checkDirectLines = (b: { lines: z.infer<typeof DirectInvoiceLine>[] }, ctx: z.RefinementCtx) => {
  b.lines.forEach((l, i) => {
    const discount = l.serviceType === "DISCOUNT"
    if (discount ? l.unitAmountMinor >= 0 : l.unitAmountMinor <= 0) ctx.addIssue({ code: "custom", path: ["lines", i, "unitAmountMinor"], message: discount ? "A discount must be negative" : "The price must be above zero" })
  })
  if (directInvoiceTotal(b.lines) <= 0) ctx.addIssue({ code: "custom", path: ["lines"], message: "The total must be above zero" })
}
export const DirectInvoiceUpdateBody = z.strictObject(directInvoiceFields).superRefine(checkDirectLines)
export type DirectInvoiceUpdateBody = z.infer<typeof DirectInvoiceUpdateBody>
export const DirectInvoiceCreateBody = z.strictObject({ customerUserId: Uuid, ...directInvoiceFields }).superRefine(checkDirectLines)
export type DirectInvoiceCreateBody = z.infer<typeof DirectInvoiceCreateBody>

/** Company particulars and numbering for documents; every particular is UNKNOWN (null) until the accountant answers (decision 5). */
export const CommercialDocumentSettings = z.object({
  quotePrefix: z.string().regex(/^[A-Z]{1,6}$/).default("QT"),
  invoicePrefix: z.string().regex(/^[A-Z]{1,6}$/).default("INV"),
  invoiceValidityDays: z.number().int().min(1).max(365).default(14),
  registrationNumber: z.string().max(60).nullable().default(null),
  vatNumber: z.string().max(40).nullable().default(null),
  vatTreatment: z.string().max(200).nullable().default(null),
  registeredAddress: z.string().max(300).nullable().default(null),
})
export type CommercialDocumentSettings = z.infer<typeof CommercialDocumentSettings>
export const DEFAULT_COMMERCIAL_DOCUMENTS: CommercialDocumentSettings = CommercialDocumentSettings.parse({})
