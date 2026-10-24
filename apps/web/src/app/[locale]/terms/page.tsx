"use client"

import { useI18n } from "@/lib/i18n"

const EN = {
  terms: ["Uni Travel Ltd arranges flights as an airline ticket agent and cargo shipments through vetted partners. Searching and requesting are free; a request is not a booking.", "Prices shown come from airline and agency systems at the time stated and change until a ticket is issued. Our team re-confirms fares, baggage and conditions before reserving.", "Payment is taken only when tickets are issued (PAY_ON_TICKETING). Flights sold this way are not ATOL protected. Final consumer wording, cancellation rights and complaint handling are subject to legal review before launch."],
  privacy: ["Uni Travel Ltd is the controller of your data under UK GDPR. We use your phone number to sign you in and contact you about your requests; passport details only when you accept a quote.", "Passport numbers are encrypted and only revealed to authorised staff, which is logged. We screen names against UK, US and EU sanctions lists as the law requires and keep that evidence for six years.", "Messages to Iranian numbers go through an Iranian SMS provider, which is a restricted transfer. You can download your data or delete your account from Account › Privacy at any time."],
}
const FA = {
  terms: ["یونی‌تراول پروازها را به‌عنوان نمایندهٔ فروش بلیت و ارسال بار را از طریق شرکای بررسی‌شده هماهنگ می‌کند. جست‌وجو و ثبت درخواست رایگان است؛ درخواست به معنای رزرو نیست.", "قیمت‌های نمایش‌داده‌شده از سیستم‌های ایرلاین‌ها و آژانس‌ها در زمان اعلام‌شده است و تا صدور بلیت تغییر می‌کند. تیم ما پیش از رزرو، نرخ، بار و شرایط را دوباره تأیید می‌کند.", "پرداخت فقط هنگام صدور بلیت انجام می‌شود. متن نهایی حقوق مصرف‌کننده پیش از راه‌اندازی بررسی حقوقی می‌شود."],
  privacy: ["یونی‌تراول طبق قانون حفاظت از داده‌های بریتانیا کنترل‌کنندهٔ اطلاعات شماست. از شمارهٔ تلفن برای ورود و تماس دربارهٔ درخواست‌ها استفاده می‌کنیم؛ مشخصات گذرنامه فقط هنگام تأیید پیشنهاد.", "شمارهٔ گذرنامه رمزگذاری می‌شود و فقط برای کارکنان مجاز با ثبت در گزارش نمایش داده می‌شود. نام‌ها طبق قانون با فهرست‌های تحریم بریتانیا، آمریکا و اتحادیهٔ اروپا مقایسه می‌شوند.", "پیامک به شماره‌های ایرانی از طریق ارائه‌دهندهٔ ایرانی ارسال می‌شود. می‌توانید هر زمان از بخش حساب › حریم خصوصی اطلاعات خود را دریافت یا حساب را حذف کنید."],
}

export default function Page() {
  const { t, locale } = useI18n()
  const paras = (locale === "fa" ? FA : EN)["terms"]
  return (
    <article className="mx-auto max-w-3xl px-4 py-8 md:py-10">
      <div className="card-brand p-6 md:p-10">
        <h1 className="font-display text-3xl md:text-4xl">{t("footer.terms")}</h1>
        <span aria-hidden className="mt-4 block h-1 w-16 rounded-full bg-orange" />
        {paras.map((p, i) => <p key={i} className="mt-5 leading-7 text-steel">{p}</p>)}
        <p className="mt-8 border-t border-line pt-4 text-xs text-steel">Draft wording — counsel review pending (booklet ch. 4.8 question 10).</p>
      </div>
    </article>
  )
}
