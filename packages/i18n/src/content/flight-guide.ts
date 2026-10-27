import { faq } from "./faq"
import type { Content, Item } from "./types"

// Item 1 is the FAQ "how to buy" item itself (same blocks), so the steps are written once.
const howToBuy = (l: keyof Content, heading: string): Item => ({ id: "guide", heading, blocks: faq[l].find((i) => i.id === "how-to-buy")!.blocks })

const en: Item[] = [
  howToBuy("en", "Complete guide to buying a ticket with Uni Travel"),
  { id: "benefits", heading: "Why book with Uni Travel", blocks: [{ kind: "p", text: "Live results from airline systems, a person on every request, payment only at ticketing, support in Persian and English." }] },
  { id: "pay-at-ticketing", heading: "Pay only when your ticket is issued", blocks: [{ kind: "p", text: "No money is taken until your ticket is issued." }] },
  { id: "checked-fares", heading: "International flights at checked fares", blocks: [{ kind: "p", text: "We re-check every fare with the airline before quoting." }] },
  { id: "payment-options", heading: "Clear payment options", blocks: [
    { kind: "p", text: "Payment options are stated on your quote and invoice." },
    { kind: "p", text: "You can also pay by card online.", flag: "payments.online.enabled" },
  ] },
  { id: "refunds", heading: "Request refunds and changes online", blocks: [{ kind: "p", text: "Send a refund or change request from your request page; our team handles it under the fare rules." }] },
  { id: "visa", heading: "Visa services alongside your international ticket", flag: "services.visa.enabled", blocks: [{ kind: "link", href: "/visa", text: "Visa services" }] },
  { id: "fare-change", heading: "We tell you if a quoted fare changes", blocks: [{ kind: "p", text: "If a quoted fare changes before ticketing, we tell you before any payment." }] },
  { id: "insurance", heading: "Flight and travel insurance together", flag: "services.insurance.enabled", blocks: [] },
  // The 24-hour claim stays out until the client confirms support hours; hours will come from site settings.
  { id: "support", heading: "Support in Persian and English", blocks: [] },
  { id: "routes", heading: "Flights to destinations across the UK and Europe", blocks: [{ kind: "p", text: "Direct and connecting routes, including starts from Van, Erzurum and Yerevan." }] },
  { id: "when-to-buy", heading: "When to buy your ticket", blocks: [{ kind: "p", text: "Book early for holidays and peak season, compare nearby dates with the \"± 3 days\" option, and leave time for visas and documents." }] },
]

const fa: Item[] = [
  howToBuy("fa", "راهنمای کامل خرید بلیت هواپیما از یونی‌تراول"),
  { id: "benefits", heading: "مزایای خرید بلیت هواپیما از یونی‌تراول", blocks: [{ kind: "p", text: "نتایج زنده از سیستم ایرلاین‌ها، یک کارشناس برای هر درخواست، پرداخت فقط هنگام صدور بلیت، پشتیبانی به فارسی و انگلیسی." }] },
  { id: "pay-at-ticketing", heading: "پرداخت فقط هنگام صدور بلیت", blocks: [{ kind: "p", text: "تا زمانی که بلیت صادر نشده، پولی از شما گرفته نمی‌شود." }] },
  { id: "checked-fares", heading: "پروازهای خارجی با نرخ‌های بررسی‌شده", blocks: [{ kind: "p", text: "پیش از هر پیشنهاد، نرخ را دوباره با ایرلاین بررسی می‌کنیم." }] },
  { id: "payment-options", heading: "روش‌های پرداخت روشن", blocks: [
    { kind: "p", text: "روش‌های پرداخت در پیشنهاد قیمت و فاکتور شما اعلام می‌شود." },
    { kind: "p", text: "همچنین می‌توانید به‌صورت آنلاین با کارت پرداخت کنید.", flag: "payments.online.enabled" },
  ] },
  { id: "refunds", heading: "ثبت آنلاین درخواست استرداد و تغییر", blocks: [{ kind: "p", text: "درخواست استرداد یا تغییر را از صفحهٔ درخواست ثبت کنید؛ تیم ما طبق قوانین نرخ پیگیری می‌کند." }] },
  { id: "visa", heading: "دریافت خدمات ویزا همزمان با خرید بلیت پرواز خارجی", flag: "services.visa.enabled", blocks: [{ kind: "link", href: "/visa", text: "خدمات ویزا" }] },
  { id: "fare-change", heading: "اطلاع‌رسانی تغییر نرخ پیش از صدور", blocks: [{ kind: "p", text: "اگر نرخ پیشنهادشده پیش از صدور تغییر کند، پیش از هر پرداختی خبرتان می‌کنیم." }] },
  { id: "insurance", heading: "امکان رزرو همزمان پرواز و بیمهٔ مسافرتی", flag: "services.insurance.enabled", blocks: [] },
  { id: "support", heading: "پشتیبانی به فارسی و انگلیسی", blocks: [] },
  { id: "routes", heading: "رزرو انواع بلیت هواپیما برای مقاصد خارجی", blocks: [{ kind: "p", text: "مسیرهای مستقیم و چندمرحله‌ای، از جمله شروع سفر از وان، ارزروم و ایروان." }] },
  { id: "when-to-buy", heading: "راهنمای انتخاب بهترین زمان برای خرید بلیت", blocks: [{ kind: "p", text: "برای ایام تعطیلات و فصل شلوغ زودتر اقدام کنید، با گزینهٔ «± ۳ روز» تاریخ‌های نزدیک را مقایسه کنید و زمان کافی برای ویزا و مدارک در نظر بگیرید." }] },
]

export const flightGuide: Content = { en, fa }
