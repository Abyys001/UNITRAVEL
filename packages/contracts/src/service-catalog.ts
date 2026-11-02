import { z } from "zod"

import { IsoDateTime, Uuid } from "./common"
import { InvoiceLineType } from "./invoices"

// Staff-managed catalogue of add-on services (baggage, seats, visa help...) that can sit on a request or invoice.
export const ServiceCatalogCode = z.string().regex(/^[A-Z0-9_]{2,32}$/)

const Currency = z.string().regex(/^[A-Z]{3}$/)

export const ServiceCatalogItem = z.object({
  id: Uuid,
  code: ServiceCatalogCode,
  nameEn: z.string().trim().min(1).max(120),
  nameFa: z.string().trim().min(1).max(120),
  descriptionEn: z.string().trim().max(1000).optional(),
  descriptionFa: z.string().trim().max(1000).optional(),
  lineType: InvoiceLineType,
  defaultPriceMinor: z.number().int().min(0),
  currency: Currency,
  perPassenger: z.boolean(),
  /** Off by default: the price is staff-only unless someone decides customers may see it. */
  showPriceToCustomer: z.boolean().default(false),
  active: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
})
export type ServiceCatalogItem = z.infer<typeof ServiceCatalogItem>

export const CreateServiceCatalogItemBody = ServiceCatalogItem.omit({ id: true, createdAt: true, updatedAt: true, active: true }).extend({
  active: z.boolean().default(true),
})
export type CreateServiceCatalogItemBody = z.infer<typeof CreateServiceCatalogItemBody>

/** The code is the stable key other records point at, so it cannot be edited. */
export const UpdateServiceCatalogItemBody = ServiceCatalogItem.omit({ id: true, code: true, createdAt: true, updatedAt: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" })
export type UpdateServiceCatalogItemBody = z.infer<typeof UpdateServiceCatalogItemBody>

/** What a customer sees. Price fields exist only when the item has showPriceToCustomer set. */
export const PublicServiceCatalogItem = z.object({
  code: ServiceCatalogCode,
  nameEn: z.string(),
  nameFa: z.string(),
  descriptionEn: z.string().optional(),
  descriptionFa: z.string().optional(),
  lineType: InvoiceLineType,
  perPassenger: z.boolean(),
  priceMinor: z.number().int().min(0).optional(),
  currency: Currency.optional(),
})
export type PublicServiceCatalogItem = z.infer<typeof PublicServiceCatalogItem>

/** A customer's interest in add-on services when submitting a request; deduped, not a purchase. */
export const RequestServiceInterest = z.array(ServiceCatalogCode).max(20).transform((codes) => [...new Set(codes)])
export type RequestServiceInterest = z.infer<typeof RequestServiceInterest>
