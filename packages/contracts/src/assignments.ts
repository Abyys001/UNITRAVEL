import { z } from "zod"

import { IsoDateTime, Reference } from "./common"
import { SERVICE_DETAILS, SERVICE_REQUEST_TYPES, ServiceQuoteBody, ServiceRequestStatus, ServiceRequestType } from "./services"

// ADR-0020: staff put a service on a customer's account. It is a normal service request (submittedVia CONSOLE) that is
// screened, claimed and quoted in one call; the customer then accepts and staff issue the invoice as for any request.

/** A tour call-back is a call, never a sale (O10), so it cannot be assigned with a quote. Flights have their own request type and are not service requests. */
export const ASSIGNABLE_SERVICE_TYPES = SERVICE_REQUEST_TYPES.filter((t) => t !== "TOUR_CALLBACK") as readonly Exclude<ServiceRequestType, "TOUR_CALLBACK">[]

export const AssignServiceBody = z.strictObject({
  type: z.enum(ASSIGNABLE_SERVICE_TYPES as [string, ...string[]]) as unknown as z.ZodType<(typeof ASSIGNABLE_SERVICE_TYPES)[number]>,
  /** The same details the customer would submit for this type (travellers must be the customer's own). */
  details: z.record(z.string(), z.unknown()),
  quote: ServiceQuoteBody,
}).superRefine((b, ctx) => {
  const r = SERVICE_DETAILS[b.type].safeParse(b.details)
  if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: "custom", path: ["details", ...i.path], message: i.message })
})
export type AssignServiceBody = z.infer<typeof AssignServiceBody>

export const AssignmentResult = z.object({
  ref: Reference,
  type: ServiceRequestType,
  /** The real status: a compliance hold or block is visible to staff, never to the customer. */
  status: ServiceRequestStatus,
  quoteSent: z.boolean(),
  quotationNumber: z.string().nullable(),
  validUntil: IsoDateTime.nullable(),
})
export type AssignmentResult = z.infer<typeof AssignmentResult>
