import type { Content, Item } from "./types"

/**
 * Hotel page content (owner brief, 29 Oct 2026; ADR-0017). Source: the owner's Persian hotel copy, corrected for typos and
 * aligned with the recorded truth model:
 * - no live listings or prices exist (ADR-0015, ADR-0004), so "search, see prices, pay, voucher at once" becomes the request
 *   workflow: tell us what you need, we compare hotels, you choose from a quote, pay the invoice, then the voucher is issued;
 * - instalments through credit providers are not offered (FAQ "instalments"; a lender would need FCA authorisation);
 * - support hours are not stated until the client confirms them (the source says both 24/7 and "24 hours, 5 days a week");
 * - Iranian domestic hotels and villas are left out pending counsel (spec O8);
 * - the competitor name in the source heading ("Flytoday") is replaced by Uni Travel.
 * Items about the service itself carry the `hotels.enabled` flag; the guide items (prices, types, stars, rooms, meal plans,
 * check-in terms, tips) are general travel information and always show.
 * Sections the source names without body text (stars, rooms, meal plans, check-in terms, tips) use common industry
 * definitions written for this page; the owner should review them (STAGE-17).
 */
const F = "hotels.enabled" as const

const en: Item[] = [
  { id: "online", flag: F, heading: "Book your hotel online: quick, easy and reliable", blocks: [
    { kind: "p", text: "Tell us the city, your check-in and check-out dates and how many people are travelling. Our team checks hotels with rooms for your group and sends you the options in a quote. Choose one, pay the invoice and your hotel voucher is issued as soon as the hotel confirms the booking." },
  ] },
  { id: "why", flag: F, heading: "Why Uni Travel is a reliable choice for your hotel", blocks: [
    { kind: "p", text: "We arrange hotels in cities abroad, from Istanbul and Dubai to Paris, with a person handling every request from start to finish." },
  ] },
  { id: "variety", flag: F, heading: "A wide choice of hotels and apartment hotels", blocks: [
    { kind: "p", text: "From budget stays to luxury five-star hotels, there is a choice for every budget and taste. Each option we send comes with the hotel's description, facilities and location, so you can compare them and make an informed choice that fits your trip, whether you want an economical stay or a luxury one." },
  ] },
  { id: "pricing", flag: F, heading: "Clear, transparent prices", blocks: [
    { kind: "p", text: "Every option in your quote shows the full price and what it includes. We check it with the hotel or supplier before sending it, and the quote states how long the price is valid." },
  ] },
  { id: "support", flag: F, heading: "Support in Persian and English", blocks: [
    { kind: "p", text: "Our support team stays with you by phone and email at every stage of your hotel booking, for trips at home and abroad." },
  ] },
  { id: "instalments", flag: F, heading: "Paying for a hotel in instalments", blocks: [
    { kind: "p", text: "Paying in instalments through a credit provider is not available yet. The amount on your invoice is paid in full before the voucher is issued. If instalment payment becomes available, it will be announced on this page and shown on your quote." },
  ] },
  { id: "cheap", heading: "Booking a cheaper hotel", blocks: [
    { kind: "p", text: "If you are looking for a lower price, a few simple choices reduce the cost of your stay:" },
    { kind: "ul", items: [
      "Ask for the options in order from the lowest price to the highest.",
      "Choose a budget hotel or an apartment hotel a little further from the city centre.",
      "Travel in the low season, when hotel rates are usually lower.",
    ] },
  ] },
  { id: "steps", flag: F, heading: "Step-by-step guide to booking a hotel with Uni Travel", blocks: [
    { kind: "ol", items: [
      "Destination and dates: enter the city, your dates and the number of guests.",
      "Your preferences: tell us the star rating, accommodation type, room type and meal plan you want.",
      "We compare hotels: our team compares hotels on their rules and services and sends you the options in a quote.",
      "Choose your hotel: check the meal plan and cancellation rules of each option, then accept the one you want.",
      "Payment and voucher: pay the invoice; your voucher is issued once the hotel confirms the booking.",
    ] },
  ] },
  { id: "price-factors", heading: "Hotel prices: how to find the best rate", blocks: [
    { kind: "p", text: "A hotel's price depends on its location, star rating and level of service, your travel dates and how many rooms are left. To get the best rate, compare the options and read the rules of each room carefully." },
    { kind: "dl", items: [
      { term: "Location", text: "Hotels near tourist attractions or in the city centre usually cost more." },
      { term: "Level of service", text: "Hotels with more stars and more facilities charge higher prices." },
      { term: "Time of travel", text: "Stays cost more during holidays and at weekends and less outside peak times." },
    ] },
  ] },
  { id: "types", heading: "Types of hotels and accommodation", blocks: [
    { kind: "p", text: "The type of accommodation plays a large part in the quality of a trip. Knowing the main types helps you choose the best one for your needs." },
    { kind: "dl", items: [
      { term: "Motel", text: "Found on intercity roads, with simple one- or two-storey buildings. Motels usually have parking right in front of the rooms." },
      { term: "Apartment hotel", text: "Furnished units with full facilities; an ideal choice for family trips and longer stays." },
      { term: "Boutique hotel", text: "Known for distinctive design, unique architecture and special services, offering a different kind of stay." },
      { term: "Hostel", text: "A friendly place with shared rooms, suited to budget travel." },
      { term: "Airport hotel", text: "Close to the airport, with easy access and round-the-clock service; the best choice for short stopovers and connecting flights." },
    ] },
  ] },
  { id: "stars", heading: "Hotel star ratings and levels of service", blocks: [
    { kind: "p", text: "Star ratings give a general idea of facilities and service. Each country has its own rating system, so check the facilities listed for the hotel itself." },
    { kind: "dl", items: [
      { term: "One star", code: "1★", text: "Basic, budget rooms with the essentials." },
      { term: "Two stars", code: "2★", text: "Simple, comfortable rooms, usually with a private bathroom and limited services." },
      { term: "Three stars", code: "3★", text: "Mid-range hotels with a reception desk, more room comfort and often a restaurant." },
      { term: "Four stars", code: "4★", text: "Upscale hotels with spacious rooms, several services and higher standards." },
      { term: "Five stars", code: "5★", text: "Luxury hotels with the highest level of service and the widest range of facilities." },
    ] },
  ] },
  { id: "rooms", heading: "Types of hotel rooms", blocks: [
    { kind: "p", text: "Room names can differ between hotels; the quote shows the room each option includes." },
    { kind: "dl", items: [
      { term: "Single room", text: "A room for one person." },
      { term: "Double room", text: "A room for two people with one double bed." },
      { term: "Twin room", text: "A room for two people with two separate beds." },
      { term: "Triple room", text: "A room for three people." },
      { term: "Family room", text: "A larger room or connected rooms for a family." },
      { term: "Suite", text: "A larger unit, usually with a separate living area." },
    ] },
  ] },
  { id: "meals", heading: "Meal plans and levels of service", blocks: [
    { kind: "p", text: "The meal plan states which meals are included in the price. Check it on each option before you choose." },
    { kind: "dl", items: [
      { term: "Room only", code: "RO", text: "No meals are included." },
      { term: "Bed and breakfast", code: "BB", text: "Breakfast is included." },
      { term: "Half board", code: "HB", text: "Breakfast and one main meal, usually dinner, are included." },
      { term: "Full board", code: "FB", text: "Breakfast, lunch and dinner are included." },
      { term: "All inclusive", code: "AI", text: "All meals and, depending on the hotel, some drinks and snacks are included." },
    ] },
  ] },
  { id: "terms", heading: "Hotel check-in terms", blocks: [
    { kind: "dl", items: [
      { term: "Check-in", text: "The time from which you can collect your room key; each hotel sets its own time." },
      { term: "Check-out", text: "The time by which you must leave the room on your last day." },
      { term: "Early check-in", text: "Arriving in your room before the check-in time; it depends on availability and may cost extra." },
      { term: "Late check-out", text: "Keeping your room after the check-out time; it depends on availability and may cost extra." },
      { term: "Voucher", text: "The booking document you show at reception; it confirms your booking, room and meal plan." },
      { term: "No-show", text: "Not arriving at the hotel without cancelling; the hotel may charge for the booking." },
      { term: "Non-refundable", text: "A rate that cannot be cancelled for a refund." },
    ] },
  ] },
  { id: "tips", heading: "Important points before booking a hotel", blocks: [
    { kind: "ul", items: [
      "Read the cancellation and change rules of the room before you choose it.",
      "Check that the guests' names match their passports or identity documents.",
      "Check the hotel's check-in and check-out times against your flight times.",
      "Check what the price includes: the meal plan, and any local taxes or deposits paid at the hotel.",
      "Check the hotel's location against the places you plan to visit.",
      "Keep your voucher with you, printed or on your phone, when you arrive.",
    ] },
  ] },
]

const fa: Item[] = [
  { id: "online", flag: F, heading: "رزرو آنلاین هتل؛ سریع، آسان و مطمئن", blocks: [
    { kind: "p", text: "شهر، تاریخ ورود و خروج و تعداد همراهان را به ما بگویید. تیم ما هتل‌هایی را که برای گروه شما ظرفیت اتاق دارند بررسی می‌کند و گزینه‌ها را در قالب پیشنهاد قیمت برایتان می‌فرستد. یکی را انتخاب کنید، فاکتور را پرداخت کنید و به محض تأیید رزرو از سوی هتل، واچر هتل برای شما صادر می‌شود." },
  ] },
  { id: "why", flag: F, heading: "چرا یونی‌تراول انتخابی مطمئن برای رزرو هتل است؟", blocks: [
    { kind: "p", text: "یونی‌تراول رزرو هتل در شهرهای خارجی، از استانبول و دبی تا پاریس، را فراهم می‌کند و یک کارشناس هر درخواست را از ابتدا تا انتها پیگیری می‌کند." },
  ] },
  { id: "variety", flag: F, heading: "تنوع بالای انواع هتل و هتل آپارتمان", blocks: [
    { kind: "p", text: "از اقامتگاه‌های اقتصادی و مقرون‌به‌صرفه تا هتل‌های لوکس و پنج‌ستاره، برای هر بودجه و سلیقه‌ای گزینه‌های متنوعی وجود دارد. هر گزینه‌ای که برایتان می‌فرستیم همراه با توضیحات، امکانات و موقعیت هتل است تا بتوانید آن‌ها را به‌خوبی مقایسه کنید و انتخابی آگاهانه‌تر و مطابق با نیازهای سفر خود داشته باشید؛ چه دنبال سفری اقتصادی باشید و چه تجربه‌ای لوکس." },
  ] },
  { id: "pricing", flag: F, heading: "قیمت شفاف و روشن", blocks: [
    { kind: "p", text: "هر گزینه در پیشنهاد قیمت، مبلغ کامل و موارد شامل آن را نشان می‌دهد. پیش از ارسال، قیمت را با هتل یا تأمین‌کننده بررسی می‌کنیم و مدت اعتبار آن در پیشنهاد قیمت درج می‌شود." },
  ] },
  { id: "support", flag: F, heading: "پشتیبانی به فارسی و انگلیسی", blocks: [
    { kind: "p", text: "تیم پشتیبانی یونی‌تراول از طریق تماس تلفنی و ایمیل، در سفرهای داخلی و خارجی، در همهٔ مراحل رزرو هتل همراه شماست." },
  ] },
  { id: "instalments", flag: F, heading: "رزرو هتل قسطی", blocks: [
    { kind: "p", text: "پرداخت اقساطی از طریق تأمین‌کنندگان اعتبار در حال حاضر فعال نیست. مبلغ فاکتور پیش از صدور واچر به‌طور کامل پرداخت می‌شود. در صورت فعال شدن پرداخت اقساطی، در همین صفحه اعلام و در پیشنهاد قیمت شما نمایش داده می‌شود." },
  ] },
  { id: "cheap", heading: "رزرو هتل ارزان", blocks: [
    { kind: "p", text: "اگر به دنبال رزرو هتل ارزان هستید، چند راه‌حل ساده هزینهٔ اقامت شما را کاهش می‌دهد:" },
    { kind: "ul", items: [
      "بخواهید گزینه‌ها به ترتیب «ارزان‌ترین به گران‌ترین» برایتان فرستاده شود.",
      "هتل‌های اقتصادی یا هتل آپارتمان‌هایی در مناطق کمی دورتر از مرکز شهر را انتخاب کنید.",
      "در فصل کم‌سفر (Low Season) سفر کنید؛ در این زمان نرخ هتل‌ها معمولاً به‌صرفه‌تر است.",
    ] },
  ] },
  { id: "steps", flag: F, heading: "راهنمای گام‌به‌گام رزرو آنلاین هتل در یونی‌تراول", blocks: [
    { kind: "ol", items: [
      "انتخاب مقصد و تاریخ: نام شهر، تاریخ و تعداد نفرات را وارد کنید.",
      "ترجیحات شما: ستارهٔ هتل، نوع اقامتگاه، نوع اتاق و برنامهٔ غذایی دلخواه را مشخص کنید.",
      "مقایسهٔ هتل‌ها: تیم ما چند هتل را از نظر قوانین و خدمات مقایسه می‌کند و گزینه‌ها را در پیشنهاد قیمت برایتان می‌فرستد.",
      "انتخاب هتل: جزئیات وعده‌های غذایی و قوانین استرداد هر گزینه را بررسی کنید و گزینهٔ دلخواه را بپذیرید.",
      "پرداخت و دریافت واچر: فاکتور را پرداخت کنید؛ واچر پس از تأیید رزرو از سوی هتل صادر می‌شود.",
    ] },
  ] },
  { id: "price-factors", heading: "قیمت هتل؛ چطور بهترین نرخ را پیدا کنیم؟", blocks: [
    { kind: "p", text: "قیمت هتل به عوامل مختلفی مانند موقعیت مکانی، تعداد ستاره و سطح خدمات، تاریخ سفر و ظرفیت اتاق‌ها بستگی دارد. برای رزرو هتل با بهترین قیمت، گزینه‌ها را مقایسه کنید و قوانین هر اتاق را با دقت بخوانید." },
    { kind: "dl", items: [
      { term: "موقعیت مکانی", text: "هتل‌های نزدیک جاذبه‌های گردشگری یا مرکز شهر معمولاً گران‌تر هستند." },
      { term: "سطح خدمات", text: "هتل‌های چندستاره و دارای امکانات بیشتر قیمت بالاتری دارند." },
      { term: "زمان سفر", text: "در تعطیلات و آخر هفته‌ها هزینهٔ اقامت بیشتر است و در ایام غیرپیک کاهش می‌یابد." },
    ] },
  ] },
  { id: "types", heading: "انواع هتل و اقامتگاه", blocks: [
    { kind: "p", text: "انتخاب نوع اقامتگاه نقش مهمی در کیفیت سفر دارد. با شناخت انواع اقامتگاه‌ها می‌توانید متناسب با نیاز و شرایط سفر خود بهترین گزینه را انتخاب کنید." },
    { kind: "dl", items: [
      { term: "متل (Motel)", text: "در مسیرهای بین‌شهری قرار گرفته و معماری ساده‌ای با یک یا دو طبقه دارد. متل‌ها معمولاً فضای پارکینگ روبه‌روی اتاق دارند." },
      { term: "هتل آپارتمان (Apartment Hotel)", text: "با واحدهای مبله و امکانات کامل، انتخابی ایدئال برای سفرهای خانوادگی یا اقامت‌های طولانی‌مدت محسوب می‌شود." },
      { term: "بوتیک هتل (Boutique Hotel)", text: "با طراحی خاص، معماری منحصربه‌فرد و خدمات ویژه شناخته می‌شود و تجربه‌ای متفاوت از اقامت ارائه می‌دهد." },
      { term: "هاستل (Hostel)", text: "فضایی دوستانه با اتاق‌های مشترک دارد و برای سفرهای اقتصادی مناسب است." },
      { term: "هتل فرودگاهی (Airport Hotel)", text: "در نزدیکی فرودگاه قرار دارد و با دسترسی آسان و خدمات شبانه‌روزی، بهترین انتخاب برای توقف‌های کوتاه یا پروازهای کانکشن است." },
    ] },
  ] },
  { id: "stars", heading: "ستاره‌های هتل و سطح خدمات", blocks: [
    { kind: "p", text: "تعداد ستاره تصویری کلی از امکانات و خدمات هتل می‌دهد. هر کشور نظام درجه‌بندی خود را دارد؛ بنابراین امکانات اعلام‌شده برای خود هتل را بررسی کنید." },
    { kind: "dl", items: [
      { term: "یک ستاره", code: "1★", text: "اتاق‌های ساده و اقتصادی با امکانات اولیه." },
      { term: "دو ستاره", code: "2★", text: "اتاق‌های ساده و راحت، معمولاً با سرویس بهداشتی اختصاصی و خدمات محدود." },
      { term: "سه ستاره", code: "3★", text: "هتل‌های میان‌رده با پذیرش، آسایش بیشتر در اتاق و اغلب رستوران." },
      { term: "چهار ستاره", code: "4★", text: "هتل‌های سطح بالا با اتاق‌های جادار، خدمات متنوع و استانداردهای بالاتر." },
      { term: "پنج ستاره", code: "5★", text: "هتل‌های لوکس با بالاترین سطح خدمات و کامل‌ترین امکانات." },
    ] },
  ] },
  { id: "rooms", heading: "انواع اتاق‌های هتل", blocks: [
    { kind: "p", text: "نام اتاق‌ها در هتل‌های مختلف ممکن است متفاوت باشد؛ اتاق هر گزینه در پیشنهاد قیمت مشخص می‌شود." },
    { kind: "dl", items: [
      { term: "اتاق یک‌تخته (Single)", text: "اتاقی برای یک نفر." },
      { term: "اتاق دوتخته دبل (Double)", text: "اتاقی برای دو نفر با یک تخت دونفره." },
      { term: "اتاق دوتخته توئین (Twin)", text: "اتاقی برای دو نفر با دو تخت جداگانه." },
      { term: "اتاق سه‌تخته (Triple)", text: "اتاقی برای سه نفر." },
      { term: "اتاق خانوادگی (Family)", text: "اتاقی بزرگ‌تر یا اتاق‌های متصل به هم برای یک خانواده." },
      { term: "سوئیت (Suite)", text: "واحدی بزرگ‌تر، معمولاً با فضای نشیمن جداگانه." },
    ] },
  ] },
  { id: "meals", heading: "برنامه‌های غذایی و سطح خدمات (Meal Plans)", blocks: [
    { kind: "p", text: "برنامهٔ غذایی مشخص می‌کند کدام وعده‌ها در قیمت گنجانده شده است. پیش از انتخاب، آن را در هر گزینه بررسی کنید." },
    { kind: "dl", items: [
      { term: "فقط اتاق (Room Only)", code: "RO", text: "هیچ وعدهٔ غذایی شامل نمی‌شود." },
      { term: "اتاق و صبحانه (Bed & Breakfast)", code: "BB", text: "صبحانه شامل می‌شود." },
      { term: "نیم‌پانسیون (Half Board)", code: "HB", text: "صبحانه و یک وعدهٔ اصلی، معمولاً شام، شامل می‌شود." },
      { term: "فول‌پانسیون (Full Board)", code: "FB", text: "صبحانه، ناهار و شام شامل می‌شود." },
      { term: "همه‌چیز شامل (All Inclusive)", code: "AI", text: "همهٔ وعده‌ها و بسته به هتل، برخی نوشیدنی‌ها و میان‌وعده‌ها شامل می‌شود." },
    ] },
  ] },
  { id: "terms", heading: "اصطلاحات مرتبط با پذیرش هتل", blocks: [
    { kind: "dl", items: [
      { term: "چک‌این (Check-in)", text: "زمانی که از آن به بعد می‌توانید کلید اتاق را تحویل بگیرید؛ هر هتل ساعت خود را دارد." },
      { term: "چک‌اوت (Check-out)", text: "زمانی که باید در روز آخر اتاق را تحویل دهید." },
      { term: "ورود زودهنگام (Early Check-in)", text: "ورود به اتاق پیش از ساعت چک‌این؛ به ظرفیت هتل بستگی دارد و ممکن است هزینهٔ اضافه داشته باشد." },
      { term: "خروج دیرهنگام (Late Check-out)", text: "ماندن در اتاق پس از ساعت چک‌اوت؛ به ظرفیت هتل بستگی دارد و ممکن است هزینهٔ اضافه داشته باشد." },
      { term: "واچر (Voucher)", text: "سند رزرو که در پذیرش هتل ارائه می‌کنید و رزرو، اتاق و برنامهٔ غذایی شما را تأیید می‌کند." },
      { term: "عدم حضور (No-show)", text: "حاضر نشدن در هتل بدون لغو رزرو؛ ممکن است هتل هزینهٔ رزرو را دریافت کند." },
      { term: "غیرقابل استرداد (Non-refundable)", text: "نرخی که با لغو رزرو، مبلغ آن بازگردانده نمی‌شود." },
    ] },
  ] },
  { id: "tips", heading: "نکات مهم قبل از رزرو هتل", blocks: [
    { kind: "ul", items: [
      "پیش از انتخاب اتاق، قوانین لغو و تغییر آن را بخوانید.",
      "مطمئن شوید نام مهمانان با گذرنامه یا مدرک شناسایی آن‌ها یکسان است.",
      "ساعت چک‌این و چک‌اوت هتل را با ساعت پرواز خود تطبیق دهید.",
      "بررسی کنید قیمت شامل چه مواردی است: برنامهٔ غذایی و هر مالیات محلی یا ودیعه‌ای که در هتل پرداخت می‌شود.",
      "موقعیت هتل را نسبت به مکان‌هایی که قصد بازدید دارید بررسی کنید.",
      "هنگام ورود، واچر را به‌صورت چاپی یا روی تلفن همراه خود داشته باشید.",
    ] },
  ] },
]

export const hotelGuide: Content = { en, fa }
