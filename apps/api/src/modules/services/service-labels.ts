import type { ServiceRequestStatus, ServiceRequestType } from "@unitravel/contracts"

type Pair = { en: string; fa: string }

/** Customer-facing names of the service types (spec docs/CONTENT-MENU-LIVE-DATA.md section 4.1; fa as the owner wrote them). */
export const SERVICE_TYPE_LABELS: Record<ServiceRequestType, Pair> = {
  VISA: { en: "visa", fa: "ویزا" },
  TOUR_CALLBACK: { en: "tour call-back", fa: "تماس برای تورهای مسافرتی" },
  CIP: { en: "airport CIP", fa: "خدمات CIP فرودگاهی" },
  INSURANCE: { en: "travel insurance", fa: "بیمهٔ مسافرتی" },
  HOTEL: { en: "hotel", fa: "هتل" },
  STAY: { en: "villa and stay", fa: "ویلا و اقامتگاه" },
  TRAIN: { en: "train", fa: "قطار" },
  BUS: { en: "bus", fa: "اتوبوس" },
}

/** Workflow status wording; kept here, not in the stored WORKFLOW config, so older stored configs stay valid. */
export const SERVICE_STATUS_LABELS: Record<ServiceRequestStatus, Pair> = {
  SUBMITTED: { en: "Received", fa: "دریافت شد" },
  COMPLIANCE_HOLD: { en: "Received", fa: "دریافت شد" },
  IN_PROGRESS: { en: "In progress", fa: "در حال بررسی" },
  QUOTED: { en: "Quote ready", fa: "پیشنهاد قیمت آماده است" },
  CONFIRMED: { en: "Confirmed", fa: "تأیید شد" },
  COMPLETED: { en: "Completed", fa: "انجام شد" },
  CANCELLED: { en: "Cancelled", fa: "لغو شد" },
  CLOSED_NO_RESPONSE: { en: "Closed (no response)", fa: "بسته شد (بدون پاسخ)" },
  DECLINED: { en: "Unable to arrange", fa: "امکان انجام نیست" },
}

export const serviceTitle = (type: ServiceRequestType, locale: "en" | "fa") => SERVICE_TYPE_LABELS[type][locale]
