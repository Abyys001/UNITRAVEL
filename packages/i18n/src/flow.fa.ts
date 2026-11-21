import type { flowEn } from "./flow.en"
import { servicesFa } from "./guide/services.fa"
import { flightsFa } from "./guide/flights.fa"
import { cargoFa } from "./guide/cargo.fa"
import { visaFa } from "./guide/visa.fa"
import { cipFa } from "./guide/cip.fa"

type DeepString<T> = { [K in keyof T]: T[K] extends string ? string : DeepString<T[K]> }

export const flowFa: DeepString<typeof flowEn> = {
  services: servicesFa,
  flights: flightsFa,
  cargo: cargoFa,
  visa: visaFa,
  cip: cipFa,
  common: {
    back: "بازگشت",
    next: "ادامه",
    edit: "ویرایش",
    review: "بازبینی",
    submit: "ارسال درخواست",
    submitting: "در حال ارسال…",
    stepOf: "مرحلهٔ {n} از {total}",
    required: "الزامی",
    optional: "اختیاری",
    fixErrors: "لطفاً فیلدهای مشخص‌شده را بررسی کنید.",
    draftRestored: "اطلاعاتی را که قبلاً وارد کرده بودید بازگرداندیم.",
    selectPlaceholder: "انتخاب کنید…",
    searchPlaceholder: "برای جست‌وجو بنویسید",
    noMatch: "موردی با جست‌وجوی شما پیدا نشد.",
    pickDate: "انتخاب تاریخ",
    clear: "پاک کردن",
    invalid: "لطفاً این فیلد را بررسی کنید.",
    progress: "پیشرفت",
    steps: "مراحل",
    stepDone: "{title} (انجام شد)",
    editSection: "ویرایش {section}",
    whatNext: "مراحل بعدی",
    reference: "شمارهٔ پیگیری",
    year: "سال",
    month: "ماه",
  },
}
