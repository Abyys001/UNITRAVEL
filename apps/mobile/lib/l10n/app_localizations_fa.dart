// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Persian (`fa`).
class AppL10nFa extends AppL10n {
  AppL10nFa([String locale = 'fa']) : super(locale);

  @override
  String get appName => 'یونی‌تراول';

  @override
  String get navSearch => 'جستجو';

  @override
  String get navRequests => 'درخواست‌ها';

  @override
  String get navCargo => 'بار';

  @override
  String get navInbox => 'صندوق پیام';

  @override
  String get navAccount => 'حساب';

  @override
  String get navQueue => 'صف';

  @override
  String get navMine => 'من';

  @override
  String get retry => 'تلاش دوباره';

  @override
  String get cancel => 'انصراف';

  @override
  String get close => 'بستن';

  @override
  String get continueLabel => 'ادامه';

  @override
  String get back => 'بازگشت';

  @override
  String get save => 'ذخیره';

  @override
  String get send => 'ارسال';

  @override
  String get done => 'انجام شد';

  @override
  String get loading => 'در حال بارگذاری…';

  @override
  String get optional => 'اختیاری';

  @override
  String get offlineBanner =>
      'اتصال برقرار نیست. داده‌های ذخیره‌شده نمایش داده می‌شود.';

  @override
  String lastUpdated(String when) {
    return 'آخرین به‌روزرسانی: $when';
  }

  @override
  String get maintenanceTitle => 'مشکلی پیش آمد';

  @override
  String get errNetwork =>
      'اتصال به سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.';

  @override
  String get errRateLimited => 'تعداد تلاش‌ها زیاد است. کمی صبر کنید.';

  @override
  String errRateLimitedIn(int seconds) {
    final intl.NumberFormat secondsNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String secondsString = secondsNumberFormat.format(seconds);

    return 'تعداد تلاش‌ها زیاد است. $secondsString ثانیه دیگر دوباره تلاش کنید.';
  }

  @override
  String get errOtpInvalid => 'کد نادرست است یا منقضی شده.';

  @override
  String get errOtpExpired => 'کد منقضی شده است. کد جدید بگیرید.';

  @override
  String get errOtpLocked => 'کد اشتباه زیاد وارد شده. بعداً تلاش کنید.';

  @override
  String get errValidation => 'لطفاً اطلاعات واردشده را بررسی کنید.';

  @override
  String get errForbidden => 'به این بخش دسترسی ندارید.';

  @override
  String get errNotFound => 'موردی پیدا نشد.';

  @override
  String get errConflict =>
      'هم‌زمان تغییر کرده است. صفحه را تازه کنید و دوباره تلاش کنید.';

  @override
  String get errOfferExpired => 'این پیشنهاد منقضی شده است. دوباره جستجو کنید.';

  @override
  String get errPriceChanged => 'قیمت تغییر کرده است. آن را بررسی کنید.';

  @override
  String get errSearchExpired =>
      'این جستجو منقضی شده است. جستجوی تازه‌ای بزنید.';

  @override
  String get errSupplier =>
      'یکی از تأمین‌کنندگان در دسترس نیست. کمی بعد تلاش کنید.';

  @override
  String get errFeatureDisabled => 'این قابلیت در حال حاضر غیرفعال است.';

  @override
  String get errMfa => 'تأیید دومرحله‌ای لازم است.';

  @override
  String get errGeneric => 'مشکلی پیش آمد. دوباره تلاش کنید.';

  @override
  String get sessionExpired => 'نشست شما منقضی شد. دوباره وارد شوید.';

  @override
  String get signInTitle => 'ورود';

  @override
  String get signInIntro =>
      'به هر جا که می‌خواهید پرواز کنید. همه درخواست‌ها یک‌جا و با پشتیبانی یک انسان واقعی.';

  @override
  String get phoneLabel => 'شماره موبایل';

  @override
  String get phoneHint => '۰۹۱۲ ۰۰۰ ۰۰۰۰';

  @override
  String get phoneHelp =>
      'کد کشور را وارد کنید یا شماره ایرانی را با ۰۹ شروع کنید.';

  @override
  String get sendCode => 'ارسال کد';

  @override
  String get codeLabel => 'کد تأیید';

  @override
  String codeSentTo(String phone) {
    return 'کد به $phone ارسال شد.';
  }

  @override
  String get verify => 'تأیید';

  @override
  String get resendCode => 'ارسال دوباره کد';

  @override
  String resendIn(int seconds) {
    final intl.NumberFormat secondsNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String secondsString = secondsNumberFormat.format(seconds);

    return 'ارسال دوباره تا $secondsString ثانیه دیگر';
  }

  @override
  String get changeNumber => 'شماره دیگر';

  @override
  String get languageLabel => 'زبان';

  @override
  String get langEnglish => 'English';

  @override
  String get langPersian => 'فارسی';

  @override
  String get profileTitle => 'نام شما';

  @override
  String get profileIntro =>
      'نام خود را دقیقاً مطابق گذرنامه به لاتین وارد کنید.';

  @override
  String get givenNames => 'نام (لاتین)';

  @override
  String get surname => 'نام خانوادگی (لاتین)';

  @override
  String get nameFa => 'نام به فارسی';

  @override
  String get fieldRequired => 'الزامی است';

  @override
  String get fieldLatin => 'فقط حروف لاتین';

  @override
  String get mfaTitle => 'تأیید دومرحله‌ای';

  @override
  String get mfaIntro => 'دسترسی کارکنان به کد برنامه احراز هویت نیاز دارد.';

  @override
  String get mfaEnrolIntro =>
      'برنامه احراز هویت را با این کلید تنظیم کنید و کد ۶ رقمی را وارد کنید.';

  @override
  String get mfaSecret => 'کلید راه‌اندازی';

  @override
  String get mfaCode => 'کد ۶ رقمی';

  @override
  String get mfaStart => 'راه‌اندازی برنامه احراز هویت';

  @override
  String get searchTitle => 'به کجا؟';

  @override
  String get searchSubtitle =>
      'مسیرها را مقایسه کنید، سپس از ما بخواهید مورد دلخواه را هماهنگ کنیم.';

  @override
  String get tripOneWay => 'یک‌طرفه';

  @override
  String get tripReturn => 'رفت و برگشت';

  @override
  String get tripOpenJaw => 'چندمقصدی ساده';

  @override
  String get tripMultiCity => 'چندشهری';

  @override
  String get from => 'مبدأ';

  @override
  String get to => 'مقصد';

  @override
  String get chooseCity => 'شهر یا فرودگاه را انتخاب کنید';

  @override
  String get searchPlaces => 'جستجوی شهر یا فرودگاه';

  @override
  String get noPlaces => 'مکانی پیدا نشد';

  @override
  String get date => 'تاریخ';

  @override
  String get returnDate => 'تاریخ برگشت';

  @override
  String get chooseDate => 'تاریخ را انتخاب کنید';

  @override
  String leg(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'پرواز $nString';
  }

  @override
  String get addFlight => 'افزودن پرواز';

  @override
  String get removeFlight => 'حذف پرواز';

  @override
  String get travellers => 'مسافران';

  @override
  String get adults => 'بزرگسال';

  @override
  String get children => 'کودک (۲ تا ۱۱ سال)';

  @override
  String get infants => 'نوزاد (زیر ۲ سال)';

  @override
  String childAge(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'سن کودک $nString';
  }

  @override
  String travellerCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString مسافر';
  }

  @override
  String get cabin => 'کلاس پرواز';

  @override
  String get cabinEconomy => 'اکونومی';

  @override
  String get cabinPremium => 'پریمیوم اکونومی';

  @override
  String get cabinBusiness => 'بیزینس';

  @override
  String get cabinFirst => 'فرست';

  @override
  String get connections => 'پروازهای ترانزیتی';

  @override
  String get maxStops => 'حداکثر توقف';

  @override
  String stopsAny(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'حداکثر $countString توقف',
      zero: 'فقط مستقیم',
    );
    return '$_temp0';
  }

  @override
  String get allowSelfTransfer => 'اجازه انتقال شخصی (بلیت‌های جدا)';

  @override
  String get allowOvernight => 'اجازه توقف شبانه';

  @override
  String get allowAirportChange => 'اجازه تغییر فرودگاه';

  @override
  String get includeGateways => 'شامل فرودگاه‌های دروازه‌ای اطراف';

  @override
  String get gatewayHint =>
      'مسیرهای دروازه‌ای سفر را از یک شهر مرزی نزدیک شروع می‌کنند؛ اغلب ارزان‌تر و با بخش زمینی.';

  @override
  String get searchFlights => 'جستجوی پرواز';

  @override
  String get problemMissingPlace => 'مبدأ و مقصد را انتخاب کنید.';

  @override
  String get problemSamePlace => 'مبدأ و مقصد باید متفاوت باشند.';

  @override
  String get problemMissingDate => 'برای هر پرواز تاریخ انتخاب کنید.';

  @override
  String get problemDateOrder => 'تاریخ‌ها باید به ترتیب باشند.';

  @override
  String get problemInfants => 'برای هر نوزاد یک بزرگسال لازم است.';

  @override
  String get calendarGregorian => 'میلادی';

  @override
  String get calendarJalali => 'شمسی';

  @override
  String get resultsTitle => 'نتایج';

  @override
  String searchingSources(int total, int done) {
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);
    final intl.NumberFormat doneNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String doneString = doneNumberFormat.format(done);

    return 'در حال جستجوی $totalString منبع، $doneString از $totalString';
  }

  @override
  String searchComplete(int total) {
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);

    return 'جستجوی $totalString منبع انجام شد';
  }

  @override
  String searchPartial(int total, int done) {
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);
    final intl.NumberFormat doneNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String doneString = doneNumberFormat.format(done);

    return 'برخی منابع کند بودند ($doneString از $totalString پاسخ دادند)';
  }

  @override
  String get searchFailed => 'جستجو کامل نشد.';

  @override
  String get tabBest => 'بهترین';

  @override
  String get tabCheapest => 'ارزان‌ترین';

  @override
  String get tabFastest => 'سریع‌ترین';

  @override
  String get tabSingle => 'بلیت واحد';

  @override
  String get noResults => 'برای این مشخصات پروازی پیدا نشد.';

  @override
  String get noResultsHelp =>
      'تاریخ دیگری امتحان کنید، توقف بیشتری مجاز کنید یا درخواست دستی بفرستید.';

  @override
  String get manualRequest => 'ارسال درخواست دستی';

  @override
  String get manualRequestHelp =>
      'چیزی که می‌خواهید را پیدا نکردید؟ تیم ما دستی جستجو می‌کند و با شما تماس می‌گیرد.';

  @override
  String get loadMore => 'نمایش بیشتر';

  @override
  String resultCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString نتیجه';
  }

  @override
  String get badgeLive => 'زنده';

  @override
  String get badgeCached => 'ذخیره‌شده';

  @override
  String get badgePriced => 'قیمت تأییدشده';

  @override
  String get badgeFake => 'داده آزمایشی';

  @override
  String get badgeSeparate => 'بلیت‌های جدا';

  @override
  String get badgeGateway => 'شروع از دروازه';

  @override
  String get badgeOvernight => 'توقف شبانه';

  @override
  String get badgeTight => 'اتصال فشرده';

  @override
  String get badgeAirportChange => 'تغییر فرودگاه';

  @override
  String get stopsDirect => 'مستقیم';

  @override
  String stopsCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString توقف';
  }

  @override
  String layoverAt(String duration, String airport) {
    return '$duration در $airport';
  }

  @override
  String durationHm(String hours, String minutes) {
    return '$hours ساعت و $minutes دقیقه';
  }

  @override
  String durationH(String hours) {
    return '$hours ساعت';
  }

  @override
  String durationM(String minutes) {
    return '$minutes دقیقه';
  }

  @override
  String dayPlus(String n) {
    return '+$n روز';
  }

  @override
  String get itineraryTitle => 'برنامه سفر';

  @override
  String get itineraryLoadError => 'بارگذاری این برنامه سفر ممکن نشد.';

  @override
  String get priceTotal => 'قیمت کل';

  @override
  String priceFrom(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'تعداد بلیت‌ها در این برنامه: $countString';
  }

  @override
  String ticketN(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'بلیت $nString';
  }

  @override
  String get sumOfTickets => 'مجموع بلیت‌های جدا';

  @override
  String get segments => 'پروازها';

  @override
  String terminal(String t) {
    return 'ترمینال $t';
  }

  @override
  String get selfTransferAdvice =>
      'انتقال شخصی: چمدان را خودتان تحویل می‌گیرید، دوباره تحویل بار می‌دهید و ضمانتی برای از دست رفتن پرواز بعدی وجود ندارد.';

  @override
  String get overnightAdvice => 'توقف شبانه: محل اقامت را برنامه‌ریزی کنید.';

  @override
  String get tightAdvice => 'اتصال فشرده: احتمال تأخیر را در نظر بگیرید.';

  @override
  String get airportChangeAdvice => 'این اتصال با تغییر فرودگاه همراه است.';

  @override
  String gatewayAdvice(String iata, String access) {
    return 'شروع از دروازه $iata: $access';
  }

  @override
  String get baggage => 'بار';

  @override
  String get baggageUnknown => 'ارائه نشده است — تیم ما تأیید می‌کند';

  @override
  String get baggageNone => 'بار چکی شامل نمی‌شود';

  @override
  String baggagePieces(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString بار چکی شامل می‌شود';
  }

  @override
  String baggageKg(String kg) {
    return 'هر کدام $kg کیلوگرم';
  }

  @override
  String get cabinBagYes => 'بار دستی شامل می‌شود';

  @override
  String get cabinBagNo => 'بار دستی ندارد';

  @override
  String priceFreshness(String when) {
    return 'قیمت در $when بررسی شد';
  }

  @override
  String priceFreshnessCached(String when) {
    return 'قیمت ذخیره‌شده از $when، هنوز با ایرلاین تأیید نشده';
  }

  @override
  String get recheckPrice => 'بررسی دوباره قیمت';

  @override
  String get priceConfirmed => 'قیمت تأیید شد.';

  @override
  String priceChangedTo(String price) {
    return 'قیمت به $price تغییر کرد.';
  }

  @override
  String get offerExpired => 'این پیشنهاد منقضی شده است. دوباره جستجو کنید.';

  @override
  String get offerUnavailable => 'این پیشنهاد دیگر در دسترس نیست.';

  @override
  String get requestItinerary => 'درخواست این برنامه سفر';

  @override
  String get requestNotBooking =>
      'درخواست به معنای رزرو صندلی نیست. تیم ما موجودی را بررسی می‌کند و قیمت نهایی را برایتان می‌فرستد.';

  @override
  String get fakeNotice =>
      'داده آزمایشی از یک تأمین‌کننده دمو. قیمت واقعی نیست.';

  @override
  String get ruleSeparateWarn =>
      'بلیت‌های جدا: اگر پرواز اول تأخیر کند، پرواز دوم پوشش داده نمی‌شود.';

  @override
  String get requestFormTitle => 'درخواست شما';

  @override
  String get manualFormTitle => 'درخواست دستی';

  @override
  String get whoIsTravelling => 'چه کسانی سفر می‌کنند؟';

  @override
  String get addTraveller => 'افزودن مسافر';

  @override
  String get noTravellers => 'مسافران را مطابق گذرنامه اضافه کنید.';

  @override
  String travellerForType(int n, String type) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'مسافر $nString ($type)';
  }

  @override
  String get typeAdult => 'بزرگسال';

  @override
  String get typeChild => 'کودک';

  @override
  String get typeInfant => 'نوزاد';

  @override
  String get documentMissing => 'مشخصات گذرنامه هنوز لازم است';

  @override
  String get noteLabel => 'یادداشت برای تیم ما';

  @override
  String get flexibility => 'انعطاف تاریخ';

  @override
  String get flexibilityHint => 'مثلاً ±۳ روز، ترجیحاً روزهای هفته';

  @override
  String get budget => 'بودجه (پوند، اختیاری)';

  @override
  String get ackNotBooking => 'می‌دانم این یک درخواست است، نه رزرو یا بلیت.';

  @override
  String get ackPrivacy =>
      'با اطلاعیه حریم خصوصی و تماس درباره این درخواست موافقم.';

  @override
  String get ackSelfTransfer =>
      'خطرهای انتقال شخصی در بلیت‌های جدا را می‌دانم.';

  @override
  String get submitRequest => 'ثبت درخواست';

  @override
  String get acceptNewPrice => 'قیمت جدید را می‌پذیرم و ثبت می‌کنم';

  @override
  String get copy => 'کپی';

  @override
  String get copied => 'کپی شد';

  @override
  String get statusSubmitted => 'دریافت شد';

  @override
  String get statusComplianceHold => 'در انتظار بررسی انطباق';

  @override
  String get statusNew => 'جدید';

  @override
  String get statusInReview => 'در حال بررسی';

  @override
  String get statusAwaitingCustomer => 'در انتظار مشتری';

  @override
  String get statusQuoted => 'قیمت‌گذاری شده';

  @override
  String get statusAccepted => 'پذیرفته شد';

  @override
  String get statusReserved => 'رزرو شد';

  @override
  String get statusTicketed => 'بلیت صادر شد';

  @override
  String get statusCompleted => 'تکمیل شد';

  @override
  String get statusDeclined => 'رد شد';

  @override
  String get statusCancelled => 'لغو شد';

  @override
  String get statusExpired => 'منقضی شد';

  @override
  String get submitting => 'در حال ثبت…';

  @override
  String get needAcks => 'برای ادامه تأییدیه‌ها را علامت بزنید.';

  @override
  String get needTraveller => 'حداقل یک مسافر اضافه کنید.';

  @override
  String get travellerFormTitle => 'مسافر جدید';

  @override
  String get title => 'عنوان';

  @override
  String get dateOfBirth => 'تاریخ تولد';

  @override
  String get gender => 'جنسیت در گذرنامه';

  @override
  String get genderM => 'مرد';

  @override
  String get genderF => 'زن';

  @override
  String get genderX => 'نامشخص';

  @override
  String get nationality => 'تابعیت';

  @override
  String get nationalityHint => 'کد دو حرفی کشور، مثلاً IR';

  @override
  String get confirmationTitle => 'درخواست ثبت شد';

  @override
  String get confirmationBody =>
      'شماره پیگیری شما در زیر است. برای تأیید جزئیات تماس می‌گیریم و قیمت می‌فرستیم. هنوز چیزی رزرو نشده است.';

  @override
  String get referenceLabel => 'شماره پیگیری';

  @override
  String get viewRequest => 'مشاهده درخواست';

  @override
  String get newSearch => 'جستجوی تازه';

  @override
  String get requestsTitle => 'درخواست‌های من';

  @override
  String get noRequests => 'هنوز درخواستی ندارید';

  @override
  String get noRequestsHelp =>
      'پرواز را جستجو کنید و مورد دلخواه را درخواست دهید.';

  @override
  String get startSearch => 'شروع جستجو';

  @override
  String get requestDetail => 'درخواست';

  @override
  String get statusTimeline => 'روند کار';

  @override
  String get messages => 'پیام‌ها';

  @override
  String get noMessages => 'هنوز پیامی نیست.';

  @override
  String get messageHint => 'پیام خود را برای تیم ما بنویسید';

  @override
  String get youLabel => 'شما';

  @override
  String get quotes => 'قیمت‌ها';

  @override
  String quoteValidUntil(String when) {
    return 'اعتبار تا $when';
  }

  @override
  String get quoteAccepted => 'پذیرفته شد';

  @override
  String get quoteExpired => 'منقضی شد';

  @override
  String get acceptOption => 'پذیرش این گزینه';

  @override
  String get acceptConfirmTitle => 'این قیمت را می‌پذیرید؟';

  @override
  String acceptConfirmBody(String label, String price) {
    return '$label به قیمت $price. سپس تیم ما رزرو را هماهنگ می‌کند.';
  }

  @override
  String unknownFields(String fields) {
    return 'موارد در انتظار تأیید تیم ما: $fields';
  }

  @override
  String get tickets => 'بلیت‌ها';

  @override
  String get cancelRequest => 'لغو درخواست';

  @override
  String get cancelConfirmTitle => 'این درخواست لغو شود؟';

  @override
  String get cancelConfirmBody =>
      'کار ما روی آن متوقف می‌شود. هر زمان می‌توانید درخواست تازه بدهید.';

  @override
  String get keepRequest => 'نگه دار';

  @override
  String submittedOn(String when) {
    return 'ثبت در $when';
  }

  @override
  String get travellersLabel => 'مسافران';

  @override
  String unreadMessages(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString خوانده‌نشده';
  }

  @override
  String get cargoTitle => 'بار';

  @override
  String get cargoIntro =>
      'اسناد یا بسته را در مسیرهای تحت پوشش ما بفرستید. پس از بررسی کالا قیمت اعلام می‌کنیم.';

  @override
  String get laneDisabled => 'در دسترس نیست';

  @override
  String laneServices(String list) {
    return 'خدمات: $list';
  }

  @override
  String get svcDocuments => 'اسناد';

  @override
  String get svcParcel => 'بسته';

  @override
  String get svcExcess => 'بار اضافه';

  @override
  String get svcFreight => 'بار هوایی';

  @override
  String get cargoRequestTitle => 'درخواست بار';

  @override
  String get service => 'خدمت';

  @override
  String get shipper => 'فرستنده';

  @override
  String get consignee => 'گیرنده';

  @override
  String get fullNameLatin => 'نام کامل (لاتین)';

  @override
  String get phone => 'تلفن';

  @override
  String get addressLine => 'نشانی';

  @override
  String get cityLabel => 'شهر';

  @override
  String get postcode => 'کد پستی';

  @override
  String get readyDate => 'آماده ارسال در';

  @override
  String get handover => 'تحویل';

  @override
  String get handoverPickup => 'جمع‌آوری از محل';

  @override
  String get handoverDropoff => 'تحویل به دفتر';

  @override
  String get weightKg => 'وزن (کیلوگرم)';

  @override
  String get lengthCm => 'طول (سانتی‌متر)';

  @override
  String get widthCm => 'عرض (سانتی‌متر)';

  @override
  String get heightCm => 'ارتفاع (سانتی‌متر)';

  @override
  String get contents => 'محتویات چیست؟';

  @override
  String get declaredValue => 'ارزش اعلامی (پوند)';

  @override
  String get consentAccuracy => 'اطلاعات واردشده درست است.';

  @override
  String get consentProhibited => 'کالای ممنوع یا خطرناک ارسال نمی‌کنم.';

  @override
  String get consentPrivacy => 'با اطلاعیه حریم خصوصی موافقم.';

  @override
  String get submitCargo => 'ثبت درخواست بار';

  @override
  String get cargoDetail => 'درخواست بار';

  @override
  String get tracking => 'پیگیری مرسوله';

  @override
  String get noTracking => 'هنوز رویدادی ثبت نشده است.';

  @override
  String chargeableWeight(String kg) {
    return 'وزن قابل محاسبه (تخمینی): $kg کیلوگرم';
  }

  @override
  String get inboxTitle => 'صندوق پیام';

  @override
  String get inboxEmpty => 'هنوز چیزی نیست';

  @override
  String get inboxEmptyHelp =>
      'اطلاعیه‌های مربوط به درخواست‌هایتان اینجا نمایش داده می‌شود.';

  @override
  String get markAllRead => 'همه را خوانده کن';

  @override
  String get accountTitle => 'حساب';

  @override
  String get profileSection => 'مشخصات';

  @override
  String get preferences => 'تنظیمات';

  @override
  String get calendarLabel => 'تقویم';

  @override
  String get myTravellers => 'مسافران ذخیره‌شده';

  @override
  String get signOut => 'خروج';

  @override
  String get signOutConfirm => 'از این دستگاه خارج می‌شوید؟';

  @override
  String get roleStaff => 'کارکنان';

  @override
  String get adminMode => 'حالت مدیر';

  @override
  String get onDuty => 'در حال خدمت';

  @override
  String get onDutyHelp =>
      'کارکنان در حال خدمت هشدار درخواست تازه می‌گیرند و می‌توانند پرونده را بردارند.';

  @override
  String version(String v) {
    return 'نسخه $v';
  }

  @override
  String get queueTitle => 'صف درخواست‌ها';

  @override
  String get mineTitle => 'پرونده‌های من';

  @override
  String get tabNew => 'جدید';

  @override
  String get tabAwaiting => 'در انتظار مشتری';

  @override
  String get tabQuoted => 'قیمت‌گذاری شده';

  @override
  String get tabReserved => 'رزروشده';

  @override
  String get summaryNew => 'جدید';

  @override
  String get summaryMine => 'من';

  @override
  String get summaryAwaiting => 'در انتظار مشتری';

  @override
  String get summaryQuoted => 'قیمت‌گذاری شده';

  @override
  String get summaryReserved => 'رزروشده';

  @override
  String get summarySla => 'نقض SLA';

  @override
  String get queueEmpty => 'این صف خالی است';

  @override
  String get caseTitle => 'پرونده';

  @override
  String get claim => 'برداشتن پرونده';

  @override
  String get claimed => 'پرونده به شما اختصاص یافت.';

  @override
  String get requestInfo => 'درخواست اطلاعات';

  @override
  String get requestInfoHint => 'چه چیزی از مشتری لازم دارید؟';

  @override
  String get addNote => 'یادداشت داخلی';

  @override
  String get noteHint => 'فقط برای کارکنان قابل مشاهده است';

  @override
  String get messageCustomer => 'پیام به مشتری';

  @override
  String get logCall => 'ثبت تماس';

  @override
  String get callCustomer => 'تماس با مشتری';

  @override
  String get outcomeReached => 'پاسخ داد';

  @override
  String get outcomeNoAnswer => 'پاسخ نداد';

  @override
  String get outcomeBusy => 'مشغول';

  @override
  String get outcomeWrongNumber => 'شماره اشتباه';

  @override
  String get outcomeCallBack => 'درخواست تماس مجدد';

  @override
  String get notes => 'یادداشت‌ها';

  @override
  String get assignee => 'مسئول';

  @override
  String get unassigned => 'بدون مسئول';

  @override
  String slaDue(String when) {
    return 'مهلت SLA: $when';
  }

  @override
  String get slaBreached => 'مهلت SLA گذشته';

  @override
  String get customerLabel => 'مشتری';

  @override
  String get mobileTriageOnly =>
      'ارسال قیمت، ثبت رکورد و تصمیم‌های انطباق در پنل مدیریت انجام می‌شود.';

  @override
  String get actionDone => 'انجام شد.';

  @override
  String get allowedNone => 'اقدامی برای شما در این پرونده مجاز نیست.';

  @override
  String commandNotAllowed(String reason) {
    return 'در دسترس نیست: $reason';
  }
}
