import type { Content, Item } from "./types"

const en: Item[] = [
  { id: "airport", heading: "1. Arriving at the airport and check-in", blocks: [{ kind: "ul", items: [
    "Arrive at the time your airline states; it is on your ticket or in the airline's message.",
    "Check your flight's check-in and gate-closing times in advance.",
    "At busy times and holidays, go to the airport earlier.",
  ] }] },
  { id: "documents", heading: "2. Identity documents and their validity", blocks: [{ kind: "ul", items: [
    "Every traveller must carry valid identity documents.",
    "Your passport must have enough remaining validity.",
    "Check visa and entry requirements for your destination and any transit country before you travel.",
  ] }] },
  { id: "baggage", heading: "3. Baggage rules", blocks: [{ kind: "ul", items: [
    "Allowances differ by flight; check yours before you travel.",
    "Some items are banned from checked or cabin baggage.",
    "Excess baggage is charged under the airline's rules.",
  ] }] },
  { id: "special-needs", heading: "4. Passengers with special needs", blocks: [
    { kind: "ul", items: [
      "Older travellers, unaccompanied children, people with medical conditions and anyone needing special assistance should tell us before the flight.",
      "It is best to ask for special services when you send your ticket request.",
    ] },
    { kind: "link", href: "/", text: "Search flights; wheelchair, meal and unaccompanied-minor options are on the request form" },
  ] },
  { id: "changes", heading: "5. Changes, delays and cancellations", blocks: [{ kind: "ul", items: [
    "Flight times can change for many reasons.",
    "If a flight is delayed or cancelled, the operating airline's rules apply.",
    "Check your flight status before leaving for the airport.",
  ] }] },
  { id: "safety", heading: "6. Safety and general tips on board", blocks: [{ kind: "ul", items: [
    "Follow the crew's instructions and keep your seat belt fastened while the sign is on.",
    "Carry power banks and spare lithium batteries in cabin baggage only, never in checked bags.",
    "Liquids in cabin baggage are limited; check the rules of your departure and transit airports.",
    "Keep essential medicines and travel documents in your cabin bag.",
    "Smoking and e-cigarettes are not allowed on board.",
    "Never carry bags or parcels for people you do not know.",
  ] }] },
]

const fa: Item[] = [
  { id: "airport", heading: "۱. حضور در فرودگاه و پذیرش مسافر", blocks: [{ kind: "ul", items: [
    "زمان حضور در فرودگاه را طبق اعلام ایرلاین رعایت کنید؛ این زمان روی بلیت یا در پیام ایرلاین آمده است.",
    "زمان پذیرش (Check-in) و بسته شدن گیت پرواز خود را از قبل بررسی کنید.",
    "در ایام شلوغ و تعطیلات زودتر به فرودگاه بروید.",
  ] }] },
  { id: "documents", heading: "۲. مدارک شناسایی و اعتبار آن‌ها", blocks: [{ kind: "ul", items: [
    "همراه داشتن مدارک شناسایی معتبر برای همهٔ مسافران الزامی است.",
    "گذرنامه باید اعتبار کافی داشته باشد.",
    "شرایط ویزا و مدارک ورود به کشور مقصد و کشورهای ترانزیت را پیش از سفر بررسی کنید.",
  ] }] },
  { id: "baggage", heading: "۳. قوانین بار و چمدان", blocks: [{ kind: "ul", items: [
    "بار مجاز هر پرواز متفاوت است و باید پیش از سفر بررسی شود.",
    "حمل برخی کالاها در بار تحویلی یا کیف دستی ممنوع است.",
    "هزینهٔ اضافه‌بار طبق قوانین ایرلاین دریافت می‌شود.",
  ] }] },
  { id: "special-needs", heading: "۴. مسافران با شرایط خاص", blocks: [
    { kind: "ul", items: [
      "مسافران سالمند، کودکان بدون همراه، افراد با شرایط پزشکی خاص و مسافرانی که به خدمات ویژه نیاز دارند باید پیش از پرواز اطلاع دهند.",
      "بهتر است درخواست خدمات ویژه هنگام ثبت درخواست بلیت ثبت شود.",
    ] },
    { kind: "link", href: "/", text: "جست‌وجوی پرواز؛ ویلچر، وعدهٔ غذایی و کودک بدون همراه در فرم درخواست قابل انتخاب است" },
  ] },
  { id: "changes", heading: "۵. تغییرات، تأخیر و لغو پرواز", blocks: [{ kind: "ul", items: [
    "زمان پرواز ممکن است به دلایل مختلف تغییر کند.",
    "در صورت تأخیر یا لغو پرواز، قوانین ایرلاین مربوطه اعمال می‌شود.",
    "پیش از حرکت به فرودگاه، وضعیت پرواز خود را بررسی کنید.",
  ] }] },
  { id: "safety", heading: "۶. نکات ایمنی و عمومی در هواپیما", blocks: [{ kind: "ul", items: [
    "از دستورهای خدمهٔ پرواز پیروی کنید و هنگام روشن بودن علامت، کمربند ایمنی را ببندید.",
    "پاوربانک و باتری لیتیومی یدکی را فقط در کیف دستی بگذارید، نه در بار تحویلی.",
    "حمل مایعات در کیف دستی محدودیت دارد؛ مقررات فرودگاه مبدأ و ترانزیت را بررسی کنید.",
    "داروهای ضروری و مدارک سفر را در کیف دستی نگه دارید.",
    "استعمال دخانیات و سیگار الکترونیکی در هواپیما ممنوع است.",
    "بار یا بستهٔ افراد ناشناس را هرگز حمل نکنید.",
  ] }] },
]

export const travelRules: Content = { en, fa }
