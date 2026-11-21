import type { PendingAction, PortalStep } from "@unitravel/contracts"
import { translate, type Locale } from "@unitravel/i18n"

// ADR-0040 D1/D4: customer-facing wording for the portal. Step names reuse existing labels (the request stepper keys, the workflow status labels);
// "next step" lines state what the workflow does next and promise no time or outcome.
type Pair = { en: string; fa: string }
const L = (en: string, fa: string): Pair => ({ en, fa })

/** The five steps of the flight stepper (web `requests.progress.*`) and the position each status holds on it. */
export const FLIGHT_STEP_KEYS = ["received", "review", "quote", "booked", "ticketed"] as const
export const FLIGHT_STEP_AT: Record<string, number> = { SUBMITTED: 0, COMPLIANCE_HOLD: 0, NEW: 0, IN_REVIEW: 1, AWAITING_CUSTOMER: 1, QUOTED: 2, ACCEPTED: 3, RESERVED: 3, TICKETED: 4 }
export const flightStepLabel = (key: (typeof FLIGHT_STEP_KEYS)[number], locale: Locale) => translate(locale, `requests.progress.${key}` as never)

/** Cargo path over existing cargo statuses; the labels come from the stored workflow wording. */
export const CARGO_STEP_STATUSES = ["SUBMITTED", "IN_REVIEW", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const
export const CARGO_STEP_AT: Record<string, number> = { SUBMITTED: 0, COMPLIANCE_HOLD: 0, NEW: 0, IN_REVIEW: 1, AWAITING_CUSTOMER: 1, QUOTED: 2, ACCEPTED: 3, BOOKED: 3, AWAITING_HANDOVER: 3, RECEIVED: 3, IN_TRANSIT: 4, AT_CUSTOMS: 4, OUT_FOR_DELIVERY: 4, DELIVERED: 5 }

export const SERVICE_STEP_STATUSES = ["SUBMITTED", "IN_PROGRESS", "QUOTED", "CONFIRMED"] as const
export const SERVICE_STEP_AT: Record<string, number> = { SUBMITTED: 0, COMPLIANCE_HOLD: 0, IN_PROGRESS: 1, QUOTED: 2, CONFIRMED: 3 }

export const INVOICE_LABELS: Record<string, Pair> = {
  ISSUED: L("Issued", "صادر شد"), PAID: L("Paid", "پرداخت شد"), CANCELLED: L("Cancelled", "لغو شد"), REFUNDED: L("Refunded", "بازپرداخت شد"),
}

export function buildSteps(labels: string[], at: number | undefined): PortalStep[] {
  if (at === undefined) return []
  return labels.map((label, i) => ({ code: String(i), label, state: i < at ? "DONE" : i === at ? "CURRENT" : "UPCOMING" }))
}

export const NEXT_STEP: Record<"FLIGHT" | "CARGO" | "SERVICE" | "INVOICE", Record<string, Pair>> = {
  FLIGHT: {
    SUBMITTED: L("Our team reviews your request and calls you.", "تیم ما درخواست شما را بررسی می‌کند و با شما تماس می‌گیرد."),
    COMPLIANCE_HOLD: L("Our team reviews your request and calls you.", "تیم ما درخواست شما را بررسی می‌کند و با شما تماس می‌گیرد."),
    NEW: L("Our team reviews your request and calls you.", "تیم ما درخواست شما را بررسی می‌کند و با شما تماس می‌گیرد."),
    IN_REVIEW: L("We prepare options and send you a quote.", "ما گزینه‌ها را آماده می‌کنیم و پیشنهاد قیمت برایتان می‌فرستیم."),
    AWAITING_CUSTOMER: L("We are waiting for your reply to our message.", "منتظر پاسخ شما به پیام ما هستیم."),
    QUOTED: L("Choose an option and accept the quote.", "یکی از گزینه‌ها را انتخاب کنید و پیشنهاد را بپذیرید."),
    ACCEPTED: L("We arrange the booking with you.", "رزرو را با هماهنگی شما انجام می‌دهیم."),
    RESERVED: L("We issue the ticket once the booking is settled.", "پس از تسویهٔ رزرو، بلیت را صادر می‌کنیم."),
    TICKETED: L("Your ticket documents are in your account.", "اسناد بلیت شما در حساب کاربری‌تان است."),
  },
  CARGO: {
    SUBMITTED: L("We screen your shipment details.", "مشخصات محموله را بررسی می‌کنیم."),
    COMPLIANCE_HOLD: L("We screen your shipment details.", "مشخصات محموله را بررسی می‌کنیم."),
    NEW: L("Our cargo team reviews your request.", "تیم بار ما درخواست شما را بررسی می‌کند."),
    IN_REVIEW: L("We prepare a quote for your shipment.", "برای محموله شما پیشنهاد قیمت آماده می‌کنیم."),
    AWAITING_CUSTOMER: L("We are waiting for your reply to our message.", "منتظر پاسخ شما به پیام ما هستیم."),
    QUOTED: L("Review the quote and accept it to go ahead.", "پیشنهاد را ببینید و برای ادامه بپذیرید."),
    ACCEPTED: L("We book the shipment with the carrier.", "محموله را نزد حمل‌کننده رزرو می‌کنیم."),
    BOOKED: L("Hand the shipment over as agreed.", "محموله را طبق هماهنگی تحویل دهید."),
    AWAITING_HANDOVER: L("Hand the shipment over as agreed.", "محموله را طبق هماهنگی تحویل دهید."),
    RECEIVED: L("The shipment leaves with the carrier.", "محموله با حمل‌کننده ارسال می‌شود."),
    IN_TRANSIT: L("The shipment continues to its destination.", "محموله به سمت مقصد ادامه می‌دهد."),
    AT_CUSTOMS: L("Customs clearance at the destination.", "ترخیص گمرکی در مقصد انجام می‌شود."),
    OUT_FOR_DELIVERY: L("Delivery to the consignee.", "محموله به گیرنده تحویل داده می‌شود."),
    DELIVERED: L("We close the request.", "درخواست را می‌بندیم."),
    EXCEPTION: L("Our cargo team is resolving the problem and will contact you.", "تیم بار ما در حال رفع مشکل است و با شما تماس می‌گیرد."),
  },
  SERVICE: {
    SUBMITTED: L("Our team reviews your request.", "تیم ما درخواست شما را بررسی می‌کند."),
    IN_PROGRESS: L("We work on your request and may contact you.", "روی درخواست شما کار می‌کنیم و ممکن است با شما تماس بگیریم."),
    QUOTED: L("Review the quote and accept it to go ahead.", "پیشنهاد را ببینید و برای ادامه بپذیرید."),
    CONFIRMED: L("Our team contacts you about the next steps.", "تیم ما دربارهٔ مراحل بعد با شما تماس می‌گیرد."),
  },
  INVOICE: {
    ISSUED: L("Pay the invoice before it expires.", "فاکتور را پیش از انقضا پرداخت کنید."),
  },
}

const ACTION: Record<PendingAction["kind"], Pair> = {
  ACCEPT_QUOTE: L("Review and accept your quote", "پیشنهاد قیمت را ببینید و بپذیرید"),
  PAY_INVOICE: L("Pay your invoice", "فاکتور خود را پرداخت کنید"),
  PROVIDE_PASSPORT: L("Add your travellers' passport details", "مشخصات گذرنامهٔ مسافران را وارد کنید"),
  RESPOND: L("Reply to our message", "به پیام ما پاسخ دهید"),
  SUPPORT_REPLY: L("Read the reply to your support message", "پاسخ پیام پشتیبانی خود را بخوانید"),
  COMPLETE_PROFILE: L("Complete your profile", "پروفایل خود را کامل کنید"),
}
export const actionLabel = (kind: PendingAction["kind"], locale: Locale) => ACTION[kind][locale]
