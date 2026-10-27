import { eq } from "drizzle-orm"

import { cargoRequests, type DbOrTx, flightRequests, serviceRequests, users } from "@unitravel/db"

/**
 * The neutral decline text a customer sees for compliance and policy declines (ch. 14.4, 27.5). It names no reason, and it does not
 * promise a reply: a declined request is closed and the customer cannot post to it, so it points to Uni Travel support instead.
 */
export const NEUTRAL_DECLINE = {
  en: "We are unable to arrange this request. If you have questions, please contact Uni Travel support and quote the reference.",
  fa: "امکان انجام این درخواست برای ما وجود ندارد. اگر پرسشی دارید، لطفاً با پشتیبانی یونی‌تراول تماس بگیرید و شماره پیگیری را اعلام کنید.",
} as const

export async function customerLocale(db: DbOrTx, userId: string): Promise<"en" | "fa"> {
  const [u] = await db.select({ locale: users.preferredLocale }).from(users).where(eq(users.id, userId))
  return u?.locale ?? "en"
}

/** The customer's language for a request: the language it was submitted in (flight) or the account language (cargo). */
export async function neutralDeclineFor(db: DbOrTx, requestType: string, requestId: string): Promise<string> {
  if (requestType === "FLIGHT") {
    const [r] = await db.select({ locale: flightRequests.submittedLocale }).from(flightRequests).where(eq(flightRequests.id, requestId))
    return NEUTRAL_DECLINE[r?.locale ?? "en"]
  }
  if (requestType === "SERVICE") {
    const [r] = await db.select({ locale: serviceRequests.submittedLocale }).from(serviceRequests).where(eq(serviceRequests.id, requestId))
    return NEUTRAL_DECLINE[r?.locale ?? "en"]
  }
  if (requestType !== "CARGO") return NEUTRAL_DECLINE.en
  const [r] = await db.select({ userId: cargoRequests.customerUserId }).from(cargoRequests).where(eq(cargoRequests.id, requestId))
  return NEUTRAL_DECLINE[r ? await customerLocale(db, r.userId) : "en"]
}

/** For automatic declines (prohibited goods, dangerous goods) that have no case. */
export async function neutralDeclineForUser(db: DbOrTx, userId: string): Promise<string> {
  return NEUTRAL_DECLINE[await customerLocale(db, userId)]
}
