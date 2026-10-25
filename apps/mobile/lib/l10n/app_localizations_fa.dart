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
  String get devCodeTitle => 'ورود آزمایشی (فقط محلی): کد از صندوق ایمیل';

  @override
  String get devCodeWaiting => 'در انتظار کد…';

  @override
  String get devCodeRefill => 'پر کردن دوباره';

  @override
  String get emailLabel => 'ایمیل';

  @override
  String get emailHint => 'you@example.com';

  @override
  String get changeEmail => 'ایمیل دیگر';

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
  String get detailsTitle => 'مشخصات من';

  @override
  String get detailsLink => 'مشخصات و گذرنامهٔ من';

  @override
  String get detailsIntro =>
      'نام و مشخصات گذرنامه باید دقیقاً مطابق گذرنامه باشد.';

  @override
  String get contactTitle => 'تلفن و ایمیل';

  @override
  String get contactHelp =>
      'با تلفن تأییدشده می‌توانید درخواست ثبت کنید و با ایمیل تأییدشده مدارک را برایتان می‌فرستیم.';

  @override
  String get addContact => 'افزودن تلفن یا ایمیل';

  @override
  String get detPhone => 'تلفن';

  @override
  String detCodeSent(String value) {
    return 'کدی به $value فرستادیم.';
  }

  @override
  String get verifyCode => 'تأیید';

  @override
  String get verifiedLabel => 'تأیید شد';

  @override
  String get notVerifiedLabel => 'تأیید نشده';

  @override
  String get verifyPhoneInline =>
      'برای ارسال درخواست، یک شمارهٔ تلفن اضافه و تأیید کنید.';

  @override
  String get detProfile => 'پروفایل';

  @override
  String get nameFaLabel => 'نام به فارسی (اختیاری)';

  @override
  String get contactTimeLabel => 'بهترین زمان تماس';

  @override
  String get addressTitle => 'نشانی';

  @override
  String get addressHelp =>
      'اختیاری. فقط وقتی برای فاکتور یا مرسولهٔ باری لازم باشد آن را می‌پرسیم.';

  @override
  String get addressLine1 => 'نشانی، خط اول';

  @override
  String get addressLine2 => 'نشانی، خط دوم';

  @override
  String get addressCity => 'شهر';

  @override
  String get addressPostcode => 'کد پستی';

  @override
  String get addressCountry => 'کشور (دو حرف، مثل GB)';

  @override
  String get removeAddress => 'حذف نشانی';

  @override
  String get savedLabel => 'ذخیره شد';

  @override
  String get passportTitle => 'گذرنامه و تأیید هویت';

  @override
  String get passportHelp =>
      'پیش از صدور بلیت، تیم ما مشخصات گذرنامهٔ شما را با تصویر آن مطابقت می‌دهد.';

  @override
  String get passportAddDetails =>
      'برای شروع تأیید، مشخصات گذرنامه را اضافه کنید.';

  @override
  String get passportEdit => 'ویرایش مشخصات گذرنامه';

  @override
  String get verifUnverified => 'تأیید نشده';

  @override
  String get verifSubmitted => 'در انتظار بررسی';

  @override
  String get verifVerified => 'تأیید شده';

  @override
  String get verifRejected => 'پذیرفته نشد';

  @override
  String get verifCorrection => 'نیاز به اصلاح';

  @override
  String get verifHelpUnverified =>
      'تصویر گذرنامه را بارگذاری کنید، مشخصات را بررسی کنید و برای بررسی بفرستید.';

  @override
  String get verifHelpSubmitted =>
      'تیم ما در حال بررسی گذرنامهٔ شماست. نیازی به اقدام شما نیست.';

  @override
  String get verifHelpVerified =>
      'گذرنامهٔ شما تأیید شده است. تغییر شمارهٔ گذرنامه، نام‌ها، تاریخ تولد، تابعیت، کشور صادرکننده یا تاریخ انقضا و همچنین تعویض تصویر، آن را دوباره به بررسی می‌فرستد.';

  @override
  String get verifHelpRejected =>
      'نتوانستیم این گذرنامه را به همین صورت بپذیریم. تصویر بهتری بارگذاری کنید یا مشخصات را اصلاح و دوباره ارسال کنید.';

  @override
  String get verifHelpCorrection =>
      'لطفاً مشخصات را اصلاح و دوباره ارسال کنید.';

  @override
  String get reasonTitle => 'پیام تیم ما';

  @override
  String get reasonUnreadableScan => 'تصویر خوانا نیست';

  @override
  String get reasonNameMismatch => 'نام مطابقت ندارد';

  @override
  String get reasonNumberMismatch => 'شمارهٔ گذرنامه مطابقت ندارد';

  @override
  String get reasonDobMismatch => 'تاریخ تولد مطابقت ندارد';

  @override
  String get reasonNationalityMismatch => 'تابعیت مطابقت ندارد';

  @override
  String get reasonExpiryMismatch => 'تاریخ انقضا مطابقت ندارد';

  @override
  String get reasonExpiredDocument => 'گذرنامه منقضی شده است';

  @override
  String get reasonNotAPassport => 'این تصویر صفحهٔ عکس‌دار گذرنامه نیست';

  @override
  String get reasonScanIncomplete => 'تصویر ناقص یا بریده است';

  @override
  String get reasonOther => 'سایر';

  @override
  String get scanTitle => 'تصویر گذرنامه';

  @override
  String get scanHelp =>
      'تصویر واضح صفحهٔ عکس‌دار گذرنامه را به‌صورت JPG یا PNG و صاف بارگذاری کنید. فایل PDF پذیرفته نمی‌شود. اطلاعات مکان و دوربین را از فایل حذف می‌کنیم.';

  @override
  String get scanNone => 'هنوز تصویری بارگذاری نشده';

  @override
  String scanReceived(String name) {
    return 'تصویر دریافت شد: $name';
  }

  @override
  String get scanReady => 'تصویر دریافت شد';

  @override
  String get scanUpload => 'بارگذاری تصویر';

  @override
  String get scanReplace => 'تعویض تصویر';

  @override
  String get scanChecking => 'در حال بررسی فایل…';

  @override
  String get scanFailed =>
      'فایل از بررسی‌های ما نگذشت. لطفاً فایل دیگری بارگذاری کنید.';

  @override
  String get scanReplaceWarn =>
      'تعویض تصویر، گذرنامهٔ تأییدشده را دوباره به بررسی می‌فرستد.';

  @override
  String get reviewTitle => 'پیش از ارسال بررسی کنید';

  @override
  String get reviewHelp =>
      'هر مورد را با گذرنامه مقایسه کنید. اگر همه یکی بود، تأیید کنید و برای بررسی بفرستید.';

  @override
  String get confirmSend => 'تأیید و ارسال برای بررسی';

  @override
  String get confirmSent => 'برای بررسی ارسال شد';

  @override
  String get confirmNeedScan => 'ابتدا تصویر را بارگذاری کنید.';

  @override
  String get confirmChanged => 'مشخصات تغییر کرد. دوباره بررسی کنید.';

  @override
  String get fieldName => 'نام';

  @override
  String get fieldDob => 'تاریخ تولد';

  @override
  String get fieldNationality => 'تابعیت';

  @override
  String get fieldNumber => 'شمارهٔ گذرنامه';

  @override
  String get fieldIssuing => 'کشور صادرکننده';

  @override
  String get fieldExpiry => 'تاریخ انقضا';

  @override
  String get passportNumberLabel => 'شمارهٔ گذرنامه';

  @override
  String get issuingCountryLabel => 'کشور صادرکننده (دو حرف)';

  @override
  String get expiryLabel => 'تاریخ انقضا (YYYY-MM-DD)';

  @override
  String get priceInQuote => 'قیمت در پیشنهاد شما تأیید می‌شود';

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
  String get quoteAccepted => 'پذیرفته‌شده';

  @override
  String get quoteExpired => 'منقضی';

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

  @override
  String get navHome => 'خانه';

  @override
  String get navAlerts => 'هشدارها';

  @override
  String get navMe => 'حساب من';

  @override
  String get homeTitle => 'پیشخوان';

  @override
  String homeGreeting(String name) {
    return 'واردشده با نام $name';
  }

  @override
  String get heroNeedsYou => 'نیاز به اقدام شما';

  @override
  String get heroAllClear => 'همه‌چیز مرتب است';

  @override
  String get heroAllClearHelp =>
      'موردی با مهلت گذشته، بدون مسئول یا نزدیک به مهلت صدور بلیت نیست.';

  @override
  String heroSlaBreached(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString پرونده مهلت SLA را گذرانده است';
  }

  @override
  String heroNewUnclaimed(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString پروندهٔ جدید مسئول ندارد';
  }

  @override
  String heroDeadlines(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString مهلت صدور بلیت تا ۲۴ ساعت آینده';
  }

  @override
  String get heroNextUp => 'فوری‌ترین پرونده‌های بدون مسئول';

  @override
  String get trendUp => 'افزایش';

  @override
  String get trendDown => 'کاهش';

  @override
  String get trendFlat => 'بدون تغییر';

  @override
  String trendSince(String word, String when) {
    return '$word از $when';
  }

  @override
  String get trendNone => 'روند با تازه‌سازی‌های این دستگاه ساخته می‌شود';

  @override
  String get queueMix => 'ترکیب صف';

  @override
  String get queueMixEmpty => 'اکنون پروندهٔ بازی نیست.';

  @override
  String openCases(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString پروندهٔ باز';
  }

  @override
  String get complianceHolds => 'توقف‌های انطباق';

  @override
  String get complianceOpen => 'پرونده‌های انطباق باز';

  @override
  String get verificationsWaiting => 'بررسی هویت در انتظار';

  @override
  String get ticketingSoon => 'صدور بلیت تا ۲۴ ساعت';

  @override
  String get decideInPanel => 'تصمیم در پنل مدیریت';

  @override
  String deadlineIn(String ref, String time) {
    return 'بعدی: $ref تا $time دیگر';
  }

  @override
  String deadlinePast(String ref, String time) {
    return '$ref به اندازهٔ $time دیر شده است';
  }

  @override
  String get tileFailed => 'بارگذاری نشد. برای تلاش دوباره بزنید.';

  @override
  String get quickActions => 'دسترسی سریع';

  @override
  String get qaUnclaimed => 'پرونده‌های بدون مسئول';

  @override
  String get qaFind => 'یافتن پرونده';

  @override
  String get dataNote =>
      'شمارش‌ها از صف زنده است. روندها فقط مشاهدات همین دستگاه است، نه سابقهٔ سرور.';

  @override
  String get settingsTitle => 'تنظیمات';

  @override
  String get settingsHelp => 'نمای برنامه و زبان';

  @override
  String get appearance => 'نمای برنامه';

  @override
  String get themeSystem => 'سیستم';

  @override
  String get themeLight => 'روشن';

  @override
  String get themeDark => 'تیره';

  @override
  String get tabMine => 'من';

  @override
  String get urgent => 'فوری';

  @override
  String get filterAtRisk => 'SLA در خطر';

  @override
  String get filterAll => 'همه';

  @override
  String get clear => 'پاک کردن';

  @override
  String get queueFilterHint => 'فیلتر بر اساس شناسه، مسیر یا مشتری';

  @override
  String get queueNoMatch => 'پرونده‌ای با این فیلترها نیست';

  @override
  String get clearFilters => 'پاک کردن فیلترها';

  @override
  String casesCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString پرونده';
  }

  @override
  String casesShownOf(int shown, int total) {
    final intl.NumberFormat shownNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String shownString = shownNumberFormat.format(shown);
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);

    return 'نمایش $shownString از $totalString';
  }

  @override
  String slaLeft(Object time) {
    return '$time مانده';
  }

  @override
  String slaOverdue(Object time) {
    return '$time تأخیر';
  }

  @override
  String durDays(String n) {
    return '$n روز';
  }

  @override
  String durHours(String n) {
    return '$n ساعت';
  }

  @override
  String durMinutes(String n) {
    return '$n دقیقه';
  }

  @override
  String get adminSearchTitle => 'یافتن پرونده';

  @override
  String get adminSearchHint => 'شناسه یا شمارهٔ تلفن';

  @override
  String get adminSearchIntro =>
      'دست‌کم ۳ نویسه از شناسه یا شمارهٔ تلفن را بنویسید.';

  @override
  String get adminSearchNone => 'پرونده‌ای پیدا نشد';

  @override
  String get caseActions => 'اقدام‌های پرونده';

  @override
  String get moreActions => 'اقدام‌های بیشتر';

  @override
  String get customerNote => 'یادداشت مشتری';

  @override
  String get caseTruthTitle => 'آنچه می‌دانیم';

  @override
  String get activityTitle => 'فعالیت‌ها';

  @override
  String get activityEmpty => 'هنوز فعالیتی از این نوع نیست.';

  @override
  String get msgFromCustomer => 'پیام مشتری';

  @override
  String get msgToCustomer => 'ارسال‌شده به مشتری';

  @override
  String get noteKind => 'یادداشت داخلی';

  @override
  String get truthRequest => 'درخواست';

  @override
  String get truthSnapshot => 'نسخهٔ ثبت‌شدهٔ پیشنهاد';

  @override
  String get truthNoSnapshot => 'درخواست دستی، پیشنهادی ثبت نشده';

  @override
  String get truthChange => 'تغییر';

  @override
  String get truthRefund => 'استرداد';

  @override
  String get truthQuote => 'قیمت‌گذاری';

  @override
  String get truthReservation => 'رزرو';

  @override
  String get truthTicket => 'بلیت';

  @override
  String get truthPayment => 'پرداخت';

  @override
  String get truthOnFile => 'ثبت شده';

  @override
  String get truthNone => 'هنوز ندارد';

  @override
  String get truthDraftOnly => 'فقط پیش‌نویس';

  @override
  String get truthVaries => 'بسته به بلیت یا قطعه متفاوت است';

  @override
  String get truthUnknownValue =>
      'ارائه نشده است، پیش از قیمت‌گذاری تأیید کنید';

  @override
  String get truthUnknownBlocks =>
      'موارد نامشخص باید پیش از ارسال قیمت تأیید شوند.';

  @override
  String get truthPaymentNote =>
      'پرداخت، رزرو و بلیت واقعیت‌های جدا هستند. پرداخت هرگز به معنای رزرو نیست.';

  @override
  String get triKnown => 'مشخص';

  @override
  String get triNotIncluded => 'شامل نمی‌شود';

  @override
  String get triUnknown => 'نامشخص';

  @override
  String get condAllowed => 'مجاز';

  @override
  String get condNotAllowed => 'مجاز نیست';

  @override
  String get resHeld => 'در انتظار صدور';

  @override
  String get resConfirmed => 'تأییدشده';

  @override
  String deadlineAt(String when) {
    return 'صدور تا $when';
  }

  @override
  String ticketCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString بلیت صادر شده';
  }

  @override
  String get payNone => 'بدون پرداخت';

  @override
  String get payPartial => 'پرداخت جزئی';

  @override
  String get payPaid => 'پرداخت‌شده';

  @override
  String get payRefundPending => 'بازپرداخت در انتظار';

  @override
  String get payRefunded => 'بازپرداخت‌شده';

  @override
  String get shipmentsTitle => 'مرسوله‌ها';

  @override
  String get shipmentsIntro => 'بار خود را از دریافت تا تحویل دنبال کنید.';

  @override
  String get shipmentsEmpty =>
      'هنوز مرسوله‌ای ندارید. پس از پذیرش قیمت، مرسولهٔ شما اینجا نمایش داده می‌شود.';

  @override
  String get shipmentsTotal => 'مرسوله‌ها';

  @override
  String get shipmentsInTransit => 'در مسیر';

  @override
  String get shipmentsDelivered => 'تحویل‌شده';

  @override
  String get shipmentsNext => 'نزدیک‌ترین تحویل';

  @override
  String get etaLabel => 'زمان تخمینی تحویل';

  @override
  String get etaNote => 'این فقط یک تخمین است، نه تعهد، و ممکن است تغییر کند.';

  @override
  String get etaNone => 'هنوز تخمینی ثبت نشده';

  @override
  String get trackingNoEvents =>
      'هنوز اسکنی ثبت نشده است. به‌روزرسانی‌ها با گزارش شریک ما اینجا می‌آیند.';

  @override
  String get trackingUpdated => 'اصلاح‌شده';

  @override
  String awbLabel(String awb) {
    return 'بارنامه $awb';
  }

  @override
  String get trackEventPickedUp => 'از فرستنده تحویل گرفته شد';

  @override
  String get trackEventReceived => 'نزد شریک ما دریافت شد';

  @override
  String get trackEventDeparted => 'حرکت کرد';

  @override
  String get trackEventArrived => 'رسید';

  @override
  String get trackEventAtCustoms => 'در گمرک';

  @override
  String get trackEventCleared => 'ترخیص گمرکی انجام شد';

  @override
  String get trackEventOutForDelivery => 'برای تحویل در راه است';

  @override
  String get trackEventDelivered => 'تحویل داده شد';

  @override
  String get trackEventHeld => 'متوقف شده است';

  @override
  String get trackEventDamaged => 'آسیب‌دیدگی گزارش شد';

  @override
  String get trackEventReturned => 'بازگردانده شد';

  @override
  String get trackEventNote => 'به‌روزرسانی';

  @override
  String get billingTitle => 'اسناد و صورتحساب';

  @override
  String get billingIntro =>
      'پیش‌فاکتورها و فاکتورهای شما در یک جا. اسناد به زبان انگلیسی صادر می‌شوند.';

  @override
  String get billingInvoices => 'فاکتورها';

  @override
  String get billingQuotations => 'پیش‌فاکتورها';

  @override
  String get billingEmptyInvoices =>
      'هنوز فاکتوری ندارید. وقتی فاکتور صادر کنیم اینجا نمایش داده می‌شود.';

  @override
  String get billingEmptyQuotations =>
      'هنوز پیش‌فاکتوری ندارید. وقتی قیمت را برایتان بفرستیم اینجا نمایش داده می‌شود.';

  @override
  String billingIssuedOn(String date) {
    return 'صدور $date';
  }

  @override
  String billingSentOn(String date) {
    return 'ارسال $date';
  }

  @override
  String get billingTotal => 'جمع کل';

  @override
  String get billingCharges => 'اقلام';

  @override
  String get billingDownload => 'دریافت PDF';

  @override
  String get billingViewQuote => 'مشاهدهٔ قیمت';

  @override
  String billingUnpaidExpires(String date) {
    return 'اگر پرداخت نشود، این فاکتور در $date منقضی می‌شود.';
  }

  @override
  String get billingPayNote =>
      'روش پرداخت را همکار یونی‌تراول شما اعلام می‌کند.';

  @override
  String get billingPayOnline => 'پرداخت با کارت در وب‌سایت ما';

  @override
  String get billingPayOnlineNote =>
      'صفحهٔ پرداخت در مرورگر شما باز می‌شود. اطلاعات کارت همان‌جا وارد می‌شود و هرگز از این برنامه عبور نمی‌کند.';

  @override
  String get billingPayProcessing =>
      'پرداخت شما در حال پردازش است. نیازی به پرداخت دوباره نیست.';

  @override
  String get progressLabel => 'پیشرفت درخواست';

  @override
  String get progressReceived => 'دریافت شد';

  @override
  String get progressReview => 'در حال بررسی';

  @override
  String get progressQuote => 'گزینه‌ها ارسال شد';

  @override
  String get progressBooked => 'تأیید شد';

  @override
  String get progressTicketed => 'بلیت صادر شد';

  @override
  String get progressDone => 'انجام شد';

  @override
  String get progressCurrent => 'مرحلهٔ فعلی';

  @override
  String get progressTodo => 'در انتظار';

  @override
  String get billingPaidBanner => 'این فاکتور پرداخت شده است. سپاسگزاریم.';

  @override
  String get billingNotFound => 'این سند در حساب شما پیدا نشد.';

  @override
  String get billingOpenFailed => 'باز کردن سند ممکن نشد. دوباره تلاش کنید.';

  @override
  String get invoiceIssued => 'در انتظار پرداخت';

  @override
  String get invoicePaid => 'پرداخت‌شده';

  @override
  String get invoiceCancelled => 'لغو شده';

  @override
  String get invoiceRefunded => 'بازپرداخت‌شده';

  @override
  String get quoteSent => 'باز';

  @override
  String get quoteDeclined => 'ردشده';

  @override
  String get quoteSuperseded => 'جایگزین‌شده';

  @override
  String get cancelReasonExpired =>
      'این فاکتور منقضی شده و دیگر قابل پرداخت نیست.';

  @override
  String get cancelReasonCorrection =>
      'این فاکتور پس گرفته شد، معمولاً چون فاکتور اصلاح‌شده جای آن را می‌گیرد. آن را پرداخت نکنید.';

  @override
  String get cancelReasonCustomerRequest =>
      'به درخواست شما لغو شد. آن را پرداخت نکنید.';

  @override
  String get cancelReasonDuplicate =>
      'چون تکراری بود لغو شد. آن را پرداخت نکنید.';

  @override
  String get cancelReasonOther => 'این فاکتور لغو شد. آن را پرداخت نکنید.';

  @override
  String get testSignInTitle => 'ورود آزمایشی (مرحله آزمون)';

  @override
  String get testSignInHint =>
      'فقط با ایمیل وارد می‌شود، بدون کد. در محیط عملیاتی غیرفعال است.';

  @override
  String get testSignInEmail => 'ایمیلی که با آن وارد می‌شوید';

  @override
  String get testSignInSubmit => 'ورود بدون کد';

  @override
  String get testSignInError =>
      'ورود آزمایشی انجام نشد. ایمیل را بررسی کنید و دوباره تلاش کنید.';
}
