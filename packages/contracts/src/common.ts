import { z } from "zod"

/** Integer minor units + ISO-4217 (ch. 19.3). Floats are never used for money. */
export const Money = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
})
export type Money = z.infer<typeof Money>

/** Tri-state for supplier-sourced facts: unknown stays unknown (ch. 12.5). */
export const tri = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("status", [
    z.object({ status: z.literal("KNOWN"), value }),
    z.object({ status: z.literal("UNKNOWN") }),
  ])
export type Tri<T> = { status: "KNOWN"; value: T } | { status: "UNKNOWN" }

export const IsoDateTime = z.iso.datetime({ offset: true })
export const IsoDate = z.iso.date()
export const Iata = z.string().regex(/^[A-Z0-9]{3}$/)
export const CarrierCode = z.string().regex(/^[A-Z0-9]{2,3}$/)
export const CountryCode = z.string().regex(/^[A-Z]{2}$/)
export const Uuid = z.uuid()
export const Reference = z.string().regex(/^UT-[FCA]-[0-9A-HJKMNP-TV-Z]{6}$/i)

export const LocalisedText = z.object({ en: z.string(), fa: z.string() })
export type LocalisedText = z.infer<typeof LocalisedText>

export const CursorQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})

export const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })
