import type { Content, Item } from "./types"

const en: Item[] = [
  {
    id: "how-to-buy",
    heading: "How do I buy a flight ticket with Uni Travel?",
    blocks: [
      { kind: "p", text: "Uni Travel arranges international flights, especially from Iran and nearby border airports such as Van, Erzurum and Yerevan to the UK and Europe:" },
      { kind: "ol", items: [
        "Search by origin, destination, date and travellers. Results come live from airline and agency systems.",
        "Choose an itinerary and send a request, or ask our team to find options. Requesting is free and is not a booking.",
        "Our team calls your verified number, checks the fare, baggage and entry rules, and sends you a formal quote.",
        "Once you accept the quote and your travellers' documents are verified, you pay on the day the ticket is issued, and the ticket appears under \"My requests\".",
      ] },
      { kind: "p", text: "Domestic flights within Iran are not offered at present." },
    ],
  },
  {
    id: "instalments",
    heading: "Can I pay for a flight in instalments?",
    blocks: [{ kind: "p", text: "Not at present. The full fare is paid when the ticket is issued; we do not take deposits or staged payments, so no money is taken from you until your ticket exists. Any change to payment options will be announced on this page." }],
  },
  {
    id: "documents",
    heading: "What documents do I need to buy a ticket?",
    blocks: [{ kind: "ul", items: [
      "A valid passport for every traveller, including children and infants. Many countries require the passport to stay valid for some time after your trip; check the rules of your destination and any transit country.",
      "A visa or entry permission for the destination, and entry documents for a transit country where needed, for example when starting from Van, Erzurum or Yerevan.",
      "Passport details and a photo of the passport's data page, added in your account; our team verifies them before the ticket is issued.",
      "A verified phone number so we can contact you about the request.",
      "For children travelling without one or both parents, or unaccompanied, the documents the airline or destination asks for.",
    ] }],
  },
  {
    id: "price-changes",
    heading: "Why does the price change during booking, or why do two different options cost about the same?",
    blocks: [
      { kind: "p", text: "Airlines set fares, and a fare can change until the ticket is issued: as seats sell, a cheaper fare class runs out and the next one replaces it. That is why:" },
      { kind: "ul", items: [
        "We re-check the fare with the airline's system before sending you a quote.",
        "Every quote has an expiry. If the fare changes before ticketing, we tell you before taking any money and send a new quote.",
        "Two options at a similar price can differ in baggage, refund and change rules, layover length, single or separate tickets, and airline. Your quote lists these details; compare them before accepting.",
      ] },
    ],
  },
  {
    id: "baggage",
    heading: "How much baggage can I take?",
    blocks: [{ kind: "p", text: "There is no single allowance: it depends on the airline, route, cabin and fare. Each flight's allowance is shown in your quote and on your ticket. If the airline has not stated it, we show it as \"unknown\" and do not send a quote until it is confirmed. On separate tickets, each ticket has its own allowance, and you may need to collect and re-check your bags at the connecting airport." }],
  },
]

const fa: Item[] = [
  {
    id: "how-to-buy",
    heading: "چگونه در یونی‌تراول بلیت هواپیما بخریم؟",
    blocks: [
      { kind: "p", text: "یونی‌تراول بلیت پروازهای خارجی را، به‌ویژه از ایران و فرودگاه‌های نزدیک مرز مانند وان، ارزروم و ایروان به بریتانیا و اروپا، هماهنگ می‌کند:" },
      { kind: "ol", items: [
        "مبدأ، مقصد، تاریخ و تعداد مسافران را جست‌وجو کنید. نتایج به‌صورت زنده از سیستم‌های ایرلاین‌ها و آژانس‌ها دریافت می‌شود.",
        "مسیر دلخواه را انتخاب کنید و درخواست بدهید؛ اگر مسیر مناسبی ندیدید، از تیم ما بخواهید برایتان پیدا کند. ثبت درخواست رایگان است و به معنای رزرو نیست.",
        "کارشناس ما با شمارهٔ تأییدشدهٔ شما تماس می‌گیرد، نرخ، بار مجاز و شرایط ورود را بررسی می‌کند و پیشنهاد قیمت رسمی برایتان می‌فرستد.",
        "پس از پذیرش پیشنهاد و تأیید مدارک مسافران، پرداخت در روز صدور بلیت انجام می‌شود و بلیت در بخش «درخواست‌های من» قرار می‌گیرد.",
      ] },
      { kind: "p", text: "پروازهای داخلی ایران در حال حاضر ارائه نمی‌شوند." },
    ],
  },
  {
    id: "instalments",
    heading: "آیا امکان خرید اقساطی بلیت هواپیما وجود دارد؟",
    blocks: [{ kind: "p", text: "در حال حاضر خیر. هزینهٔ بلیت به‌طور کامل و در زمان صدور بلیت پرداخت می‌شود و پیش‌پرداخت یا پرداخت مرحله‌ای دریافت نمی‌کنیم؛ به همین دلیل تا زمانی که بلیت شما صادر نشده، پولی از شما گرفته نمی‌شود. هر تغییری در روش‌های پرداخت در همین صفحه اعلام خواهد شد." }],
  },
  {
    id: "documents",
    heading: "برای خرید بلیت هواپیما چه مدارکی لازم است؟",
    blocks: [{ kind: "ul", items: [
      "گذرنامهٔ معتبر برای هر مسافر، از جمله کودکان و نوزادان. بسیاری از کشورها اعتبار گذرنامه را برای مدتی پس از پایان سفر لازم می‌دانند؛ قوانین کشور مقصد و کشورهای ترانزیت را بررسی کنید.",
      "ویزا یا مجوز ورود کشور مقصد و در صورت نیاز مدارک ورود به کشور ترانزیت، مثلاً هنگام شروع سفر از وان، ارزروم یا ایروان.",
      "مشخصات گذرنامه و تصویر صفحهٔ مشخصات آن، که در حساب کاربری خود ثبت می‌کنید؛ تیم ما پیش از صدور بلیت آن را تأیید می‌کند.",
      "شمارهٔ تلفن تأییدشده برای تماس دربارهٔ درخواست.",
      "برای کودکانی که بدون یکی از والدین یا بدون همراه سفر می‌کنند، مدارکی که ایرلاین یا کشور مقصد درخواست می‌کند.",
    ] }],
  },
  {
    id: "price-changes",
    heading: "چرا هنگام خرید، قیمت بلیت ناگهان تغییر می‌کند یا دو گزینهٔ متفاوت قیمت مشابهی دارند؟",
    blocks: [
      { kind: "p", text: "نرخ بلیت را ایرلاین تعیین می‌کند و تا لحظهٔ صدور بلیت ممکن است تغییر کند: با فروش هر صندلی، کلاس نرخی ارزان‌تر تمام می‌شود و نرخ بعدی جای آن را می‌گیرد. به همین دلیل:" },
      { kind: "ul", items: [
        "پیش از فرستادن پیشنهاد قیمت، نرخ را دوباره با سیستم ایرلاین بررسی می‌کنیم.",
        "هر پیشنهاد قیمت مهلت اعتبار دارد. اگر پیش از صدور بلیت نرخ تغییر کند، پیش از دریافت هر پولی به شما خبر می‌دهیم و پیشنهاد تازه می‌فرستیم.",
        "دو گزینه با قیمت نزدیک ممکن است در بار مجاز، امکان استرداد و تغییر، مدت توقف، یکپارچه یا جداگانه بودن بلیت و ایرلاین با هم فرق داشته باشند. این جزئیات در پیشنهاد قیمت آمده است؛ پیش از پذیرش آن‌ها را مقایسه کنید.",
      ] },
    ],
  },
  {
    id: "baggage",
    heading: "میزان بار مجاز پرواز چقدر است؟",
    blocks: [{ kind: "p", text: "بار مجاز ثابت نیست و به ایرلاین، مسیر، کلاس پرواز و نوع نرخ بستگی دارد. بار مجاز هر پرواز در جزئیات پیشنهاد قیمت و روی بلیت شما نوشته می‌شود. اگر ایرلاین اطلاعات بار را اعلام نکرده باشد، آن را «نامشخص» نشان می‌دهیم و تا روشن شدن آن پیشنهاد قیمت نمی‌فرستیم. در سفر با بلیت‌های جداگانه، بار مجاز هر بلیت جداست و ممکن است لازم باشد بار را در فرودگاه میانی تحویل بگیرید و دوباره تحویل دهید." }],
  },
]

export const faq: Content = { en, fa }
