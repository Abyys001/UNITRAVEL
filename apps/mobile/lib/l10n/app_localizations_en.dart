// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppL10nEn extends AppL10n {
  AppL10nEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'UniTravel';

  @override
  String get navSearch => 'Search';

  @override
  String get navRequests => 'Requests';

  @override
  String get navCargo => 'Cargo';

  @override
  String get navInbox => 'Inbox';

  @override
  String get navAccount => 'Account';

  @override
  String get navQueue => 'Queue';

  @override
  String get navMine => 'Mine';

  @override
  String get retry => 'Retry';

  @override
  String get cancel => 'Cancel';

  @override
  String get close => 'Close';

  @override
  String get continueLabel => 'Continue';

  @override
  String get back => 'Back';

  @override
  String get save => 'Save';

  @override
  String get send => 'Send';

  @override
  String get done => 'Done';

  @override
  String get loading => 'Loading…';

  @override
  String get optional => 'Optional';

  @override
  String get offlineBanner => 'You are offline. Showing saved data.';

  @override
  String lastUpdated(String when) {
    return 'Last updated $when';
  }

  @override
  String get maintenanceTitle => 'Something went wrong';

  @override
  String get errNetwork =>
      'Cannot reach the server. Check your connection and try again.';

  @override
  String get errRateLimited => 'Too many attempts. Please wait a moment.';

  @override
  String errRateLimitedIn(int seconds) {
    final intl.NumberFormat secondsNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String secondsString = secondsNumberFormat.format(seconds);

    return 'Too many attempts. Try again in ${secondsString}s.';
  }

  @override
  String get errOtpInvalid => 'That code is not right or has expired.';

  @override
  String get errOtpExpired => 'That code has expired. Request a new one.';

  @override
  String get errOtpLocked => 'Too many wrong codes. Try again later.';

  @override
  String get errValidation => 'Please check the highlighted details.';

  @override
  String get errForbidden => 'You do not have access to this.';

  @override
  String get errNotFound => 'We could not find that.';

  @override
  String get errConflict =>
      'This changed while you were looking. Refresh and try again.';

  @override
  String get errOfferExpired =>
      'That offer has expired. Search again for fresh prices.';

  @override
  String get errPriceChanged => 'The price changed. Review it and try again.';

  @override
  String get errSearchExpired => 'This search has expired. Start a new one.';

  @override
  String get errSupplier =>
      'A supplier is unavailable right now. Try again shortly.';

  @override
  String get errFeatureDisabled => 'This feature is switched off right now.';

  @override
  String get errMfa => 'Second-factor verification is required.';

  @override
  String get errGeneric => 'Something went wrong. Please try again.';

  @override
  String get sessionExpired => 'Your session expired. Please sign in again.';

  @override
  String get signInTitle => 'Sign in';

  @override
  String get signInIntro =>
      'Fly home, or anywhere. We keep every request in one place and a real person behind it.';

  @override
  String get sendCode => 'Send code';

  @override
  String get codeLabel => 'Verification code';

  @override
  String codeSentTo(String phone) {
    return 'We sent a code to $phone.';
  }

  @override
  String get verify => 'Verify';

  @override
  String get devCodeTitle =>
      'Test sign-in (local only): code from the email sink';

  @override
  String get devCodeWaiting => 'Waiting for the code…';

  @override
  String get devCodeRefill => 'Fill again';

  @override
  String get emailLabel => 'Email';

  @override
  String get emailHint => 'you@example.com';

  @override
  String get changeEmail => 'Use a different email';

  @override
  String get resendCode => 'Resend code';

  @override
  String resendIn(int seconds) {
    final intl.NumberFormat secondsNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String secondsString = secondsNumberFormat.format(seconds);

    return 'Resend in ${secondsString}s';
  }

  @override
  String get languageLabel => 'Language';

  @override
  String get langEnglish => 'English';

  @override
  String get langPersian => 'فارسی';

  @override
  String get profileTitle => 'Your name';

  @override
  String get profileIntro =>
      'Enter your name exactly as it appears in your passport.';

  @override
  String get givenNames => 'Given names';

  @override
  String get surname => 'Surname';

  @override
  String get nameFa => 'Name in Persian';

  @override
  String get fieldRequired => 'Required';

  @override
  String get fieldLatin => 'Use Latin letters only';

  @override
  String get mfaTitle => 'Second-factor check';

  @override
  String get mfaIntro =>
      'Staff access needs a code from your authenticator app.';

  @override
  String get mfaEnrolIntro =>
      'Set up your authenticator app with this key, then enter the 6-digit code.';

  @override
  String get mfaSecret => 'Setup key';

  @override
  String get mfaCode => '6-digit code';

  @override
  String get mfaStart => 'Set up authenticator';

  @override
  String get searchTitle => 'Where to?';

  @override
  String get searchSubtitle =>
      'Compare routes, then ask us to arrange the one you like.';

  @override
  String get tripOneWay => 'One way';

  @override
  String get tripReturn => 'Return';

  @override
  String get tripOpenJaw => 'Open jaw';

  @override
  String get tripMultiCity => 'Multi-city';

  @override
  String get from => 'From';

  @override
  String get to => 'To';

  @override
  String get chooseCity => 'Choose a city or airport';

  @override
  String get searchPlaces => 'Search city or airport';

  @override
  String get noPlaces => 'No matching places';

  @override
  String get date => 'Date';

  @override
  String get returnDate => 'Return date';

  @override
  String get chooseDate => 'Choose a date';

  @override
  String leg(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'Flight $nString';
  }

  @override
  String get addFlight => 'Add a flight';

  @override
  String get removeFlight => 'Remove flight';

  @override
  String get travellers => 'Travellers';

  @override
  String get adults => 'Adults';

  @override
  String get children => 'Children (2–11)';

  @override
  String get infants => 'Infants (under 2)';

  @override
  String childAge(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'Age of child $nString';
  }

  @override
  String travellerCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString travellers',
      one: '1 traveller',
    );
    return '$_temp0';
  }

  @override
  String get cabin => 'Cabin';

  @override
  String get cabinEconomy => 'Economy';

  @override
  String get cabinPremium => 'Premium economy';

  @override
  String get cabinBusiness => 'Business';

  @override
  String get cabinFirst => 'First';

  @override
  String get connections => 'Connections';

  @override
  String get maxStops => 'Maximum stops';

  @override
  String stopsAny(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Up to $countString stops',
      one: 'Up to 1 stop',
      zero: 'Direct only',
    );
    return '$_temp0';
  }

  @override
  String get allowSelfTransfer => 'Allow self-transfer (separate tickets)';

  @override
  String get allowOvernight => 'Allow overnight layovers';

  @override
  String get allowAirportChange => 'Allow airport changes';

  @override
  String get includeGateways => 'Include nearby gateway airports';

  @override
  String get gatewayHint =>
      'Gateways start your trip at a nearby border city, often cheaper, with an overland leg.';

  @override
  String get searchFlights => 'Search flights';

  @override
  String get problemMissingPlace => 'Choose where you are flying from and to.';

  @override
  String get problemSamePlace => 'Origin and destination must be different.';

  @override
  String get problemMissingDate => 'Choose a date for each flight.';

  @override
  String get problemDateOrder => 'Dates must be in order.';

  @override
  String get problemInfants =>
      'Each infant needs an adult on the same booking.';

  @override
  String get calendarGregorian => 'Gregorian';

  @override
  String get calendarJalali => 'Jalali';

  @override
  String get resultsTitle => 'Results';

  @override
  String searchingSources(int total, int done) {
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);
    final intl.NumberFormat doneNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String doneString = doneNumberFormat.format(done);

    return 'Searching $totalString sources · $doneString of $totalString';
  }

  @override
  String searchComplete(int total) {
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);

    return 'Searched $totalString sources';
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

    return 'Some sources were slow ($doneString of $totalString answered)';
  }

  @override
  String get searchFailed => 'The search could not finish.';

  @override
  String get tabBest => 'Best';

  @override
  String get tabCheapest => 'Cheapest';

  @override
  String get tabFastest => 'Fastest';

  @override
  String get tabSingle => 'Single ticket';

  @override
  String get noResults => 'No flights found for these details.';

  @override
  String get noResultsHelp =>
      'Try other dates, allow more stops, or send us a manual request.';

  @override
  String get manualRequest => 'Send a manual request';

  @override
  String get manualRequestHelp =>
      'Not finding what you need? Our team will search by hand and call you.';

  @override
  String get loadMore => 'Show more';

  @override
  String resultCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString results',
      one: '1 result',
    );
    return '$_temp0';
  }

  @override
  String get badgeLive => 'LIVE';

  @override
  String get badgeCached => 'CACHED';

  @override
  String get badgePriced => 'PRICE CONFIRMED';

  @override
  String get badgeFake => 'TEST DATA';

  @override
  String get badgeSeparate => 'SEPARATE TICKETS';

  @override
  String get badgeGateway => 'STARTS AT GATEWAY';

  @override
  String get badgeOvernight => 'OVERNIGHT';

  @override
  String get badgeTight => 'TIGHT CONNECTION';

  @override
  String get badgeAirportChange => 'AIRPORT CHANGE';

  @override
  String get stopsDirect => 'Direct';

  @override
  String stopsCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString stops',
      one: '1 stop',
    );
    return '$_temp0';
  }

  @override
  String layoverAt(String duration, String airport) {
    return '$duration in $airport';
  }

  @override
  String durationHm(String hours, String minutes) {
    return '${hours}h ${minutes}m';
  }

  @override
  String durationH(String hours) {
    return '${hours}h';
  }

  @override
  String durationM(String minutes) {
    return '${minutes}m';
  }

  @override
  String dayPlus(String n) {
    return '+${n}d';
  }

  @override
  String get itineraryTitle => 'Itinerary';

  @override
  String get itineraryLoadError => 'We could not load this itinerary.';

  @override
  String get priceTotal => 'Total price';

  @override
  String priceFrom(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'Fares in this itinerary: $countString';
  }

  @override
  String ticketN(int n) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'Ticket $nString';
  }

  @override
  String get sumOfTickets => 'Sum of separate tickets';

  @override
  String get segments => 'Flights';

  @override
  String terminal(String t) {
    return 'Terminal $t';
  }

  @override
  String get selfTransferAdvice =>
      'Self-transfer: you collect your bags, check in again and clear any border control yourself. A missed connection is not protected by the airline.';

  @override
  String get overnightAdvice => 'Overnight layover: plan where you will stay.';

  @override
  String get tightAdvice => 'Tight connection: allow for delays.';

  @override
  String get airportChangeAdvice => 'This connection changes airport.';

  @override
  String gatewayAdvice(String iata, String access) {
    return 'Starts at gateway $iata: $access';
  }

  @override
  String get baggage => 'Baggage';

  @override
  String get baggageUnknown => 'Not provided — our team will confirm';

  @override
  String get baggageNone => 'No checked bag included';

  @override
  String baggagePieces(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString checked bags included',
      one: '1 checked bag included',
    );
    return '$_temp0';
  }

  @override
  String baggageKg(String kg) {
    return '$kg kg each';
  }

  @override
  String get cabinBagYes => 'Cabin bag included';

  @override
  String get cabinBagNo => 'No cabin bag';

  @override
  String priceFreshness(String when) {
    return 'Price checked $when';
  }

  @override
  String priceFreshnessCached(String when) {
    return 'Cached price from $when, not yet confirmed with the airline';
  }

  @override
  String get recheckPrice => 'Recheck price';

  @override
  String get priceConfirmed => 'Price confirmed.';

  @override
  String priceChangedTo(String price) {
    return 'Price changed to $price.';
  }

  @override
  String get offerExpired => 'This offer has expired. Search again.';

  @override
  String get offerUnavailable => 'This offer is no longer available.';

  @override
  String get requestItinerary => 'Request this itinerary';

  @override
  String get requestNotBooking =>
      'Requesting does not book a seat. Our team checks availability and sends you a quote.';

  @override
  String get fakeNotice => 'Test data from a demo supplier. Not a real fare.';

  @override
  String get ruleSeparateWarn =>
      'Separate tickets: if the first flight is late, the second is not protected.';

  @override
  String get requestFormTitle => 'Your request';

  @override
  String get manualFormTitle => 'Manual request';

  @override
  String get whoIsTravelling => 'Who is travelling?';

  @override
  String get addTraveller => 'Add a traveller';

  @override
  String get noTravellers =>
      'Add the people travelling, as named in their passports.';

  @override
  String travellerForType(int n, String type) {
    final intl.NumberFormat nNumberFormat = intl.NumberFormat.decimalPattern(
      localeName,
    );
    final String nString = nNumberFormat.format(n);

    return 'Traveller $nString ($type)';
  }

  @override
  String get typeAdult => 'adult';

  @override
  String get typeChild => 'child';

  @override
  String get typeInfant => 'infant';

  @override
  String get detailsTitle => 'My details';

  @override
  String get detailsLink => 'My details and passport';

  @override
  String get detailsIntro =>
      'Names and passport details must match your passport exactly.';

  @override
  String get contactTitle => 'Phone and email';

  @override
  String get contactHelp =>
      'A verified phone lets you send requests; a verified email lets us send documents.';

  @override
  String get addContact => 'Add a phone or email';

  @override
  String get detPhone => 'Phone';

  @override
  String detCodeSent(String value) {
    return 'We sent a code to $value.';
  }

  @override
  String get verifyCode => 'Verify';

  @override
  String get verifiedLabel => 'Verified';

  @override
  String get notVerifiedLabel => 'Not verified';

  @override
  String get verifyPhoneInline =>
      'Add and verify a phone number to send your request.';

  @override
  String get detProfile => 'Profile';

  @override
  String get nameFaLabel => 'Name in Persian (optional)';

  @override
  String get contactTimeLabel => 'Best time to call';

  @override
  String get addressTitle => 'Address';

  @override
  String get addressHelp =>
      'Optional. We ask for it only when an invoice or a cargo shipment needs it.';

  @override
  String get addressLine1 => 'Address line 1';

  @override
  String get addressLine2 => 'Address line 2';

  @override
  String get addressCity => 'City';

  @override
  String get addressPostcode => 'Postcode';

  @override
  String get addressCountry => 'Country (2 letters, e.g. GB)';

  @override
  String get removeAddress => 'Remove address';

  @override
  String get savedLabel => 'Saved';

  @override
  String get passportTitle => 'Passport and verification';

  @override
  String get passportHelp =>
      'Our team checks your passport details against a scan before tickets are issued.';

  @override
  String get passportAddDetails =>
      'Add your passport details to start verification.';

  @override
  String get passportEdit => 'Edit passport details';

  @override
  String get verifUnverified => 'Not verified';

  @override
  String get verifSubmitted => 'Waiting for review';

  @override
  String get verifVerified => 'Verified';

  @override
  String get verifRejected => 'Not accepted';

  @override
  String get verifCorrection => 'Correction needed';

  @override
  String get verifHelpUnverified =>
      'Upload a scan, check your details and send them for review.';

  @override
  String get verifHelpSubmitted =>
      'Our team is reviewing your passport. You do not need to do anything.';

  @override
  String get verifHelpVerified =>
      'Your passport is verified. Changing the passport number, names, date of birth, nationality, issuing country or expiry date, or replacing the scan, sends it back for review.';

  @override
  String get verifHelpRejected =>
      'We could not accept this passport as submitted. Upload a better scan or correct the details and send it again.';

  @override
  String get verifHelpCorrection =>
      'Please correct the details and send them again.';

  @override
  String get reasonTitle => 'Message from our team';

  @override
  String get reasonUnreadableScan => 'The scan is not readable';

  @override
  String get reasonNameMismatch => 'The name does not match';

  @override
  String get reasonNumberMismatch => 'The passport number does not match';

  @override
  String get reasonDobMismatch => 'The date of birth does not match';

  @override
  String get reasonNationalityMismatch => 'The nationality does not match';

  @override
  String get reasonExpiryMismatch => 'The expiry date does not match';

  @override
  String get reasonExpiredDocument => 'The passport has expired';

  @override
  String get reasonNotAPassport => 'This is not a passport photo page';

  @override
  String get reasonScanIncomplete => 'The scan is cut off or incomplete';

  @override
  String get reasonOther => 'Other';

  @override
  String get scanTitle => 'Passport scan';

  @override
  String get scanHelp =>
      'Upload a clear JPG or PNG of the photo page, held upright. PDF files are not accepted. We remove location and camera data from the file.';

  @override
  String get scanNone => 'No scan yet';

  @override
  String scanReceived(String name) {
    return 'Scan received: $name';
  }

  @override
  String get scanReady => 'Scan received';

  @override
  String get scanUpload => 'Upload scan';

  @override
  String get scanReplace => 'Replace scan';

  @override
  String get scanChecking => 'Checking the file…';

  @override
  String get scanFailed =>
      'The file did not pass our checks. Please upload another.';

  @override
  String get scanReplaceWarn =>
      'Replacing the scan sends a verified passport back for review.';

  @override
  String get reviewTitle => 'Check before you send';

  @override
  String get reviewHelp =>
      'Compare each detail with your passport. When it all matches, confirm and send it for review.';

  @override
  String get confirmSend => 'Confirm and send for review';

  @override
  String get confirmSent => 'Sent for review';

  @override
  String get confirmNeedScan => 'Upload a scan first.';

  @override
  String get confirmChanged => 'Your details changed. Check them again.';

  @override
  String get fieldName => 'Name';

  @override
  String get fieldDob => 'Date of birth';

  @override
  String get fieldNationality => 'Nationality';

  @override
  String get fieldNumber => 'Passport number';

  @override
  String get fieldIssuing => 'Issuing country';

  @override
  String get fieldExpiry => 'Expiry date';

  @override
  String get passportNumberLabel => 'Passport number';

  @override
  String get issuingCountryLabel => 'Issuing country (2 letters)';

  @override
  String get expiryLabel => 'Expiry date (YYYY-MM-DD)';

  @override
  String get priceInQuote => 'Price confirmed in your quote';

  @override
  String get documentMissing => 'Passport details still needed';

  @override
  String get noteLabel => 'Note for our team';

  @override
  String get flexibility => 'Date flexibility';

  @override
  String get flexibilityHint => 'e.g. ±3 days, prefer weekdays';

  @override
  String get budget => 'Budget (GBP, optional)';

  @override
  String get ackNotBooking =>
      'I understand this is a request, not a booking or a ticket.';

  @override
  String get ackPrivacy =>
      'I agree to the privacy notice and to being contacted about this request.';

  @override
  String get ackSelfTransfer =>
      'I understand the self-transfer risks of separate tickets.';

  @override
  String get submitRequest => 'Submit request';

  @override
  String get acceptNewPrice => 'Accept the new price and submit';

  @override
  String get copy => 'Copy';

  @override
  String get copied => 'Copied';

  @override
  String get statusSubmitted => 'Received';

  @override
  String get statusComplianceHold => 'Compliance hold';

  @override
  String get statusNew => 'New';

  @override
  String get statusInReview => 'In review';

  @override
  String get statusAwaitingCustomer => 'Awaiting customer';

  @override
  String get statusQuoted => 'Quoted';

  @override
  String get statusAccepted => 'Accepted';

  @override
  String get statusReserved => 'Reserved';

  @override
  String get statusTicketed => 'Ticketed';

  @override
  String get statusCompleted => 'Completed';

  @override
  String get statusDeclined => 'Declined';

  @override
  String get statusCancelled => 'Cancelled';

  @override
  String get statusExpired => 'Expired';

  @override
  String get submitting => 'Submitting…';

  @override
  String get needAcks => 'Please tick the acknowledgements to continue.';

  @override
  String get needTraveller => 'Add at least one traveller.';

  @override
  String get travellerFormTitle => 'New traveller';

  @override
  String get title => 'Title';

  @override
  String get dateOfBirth => 'Date of birth';

  @override
  String get gender => 'Gender on passport';

  @override
  String get genderM => 'Male';

  @override
  String get genderF => 'Female';

  @override
  String get genderX => 'Unspecified';

  @override
  String get nationality => 'Nationality';

  @override
  String get nationalityHint => 'Two-letter country code, e.g. IR';

  @override
  String get confirmationTitle => 'Request received';

  @override
  String get confirmationBody =>
      'Your reference is below. We will call you to confirm details and send a quote. Nothing is booked yet.';

  @override
  String get referenceLabel => 'Reference';

  @override
  String get viewRequest => 'View request';

  @override
  String get newSearch => 'New search';

  @override
  String get requestsTitle => 'My requests';

  @override
  String get noRequests => 'No requests yet';

  @override
  String get noRequestsHelp =>
      'Search for a flight and request the one you like.';

  @override
  String get startSearch => 'Start a search';

  @override
  String get requestDetail => 'Request';

  @override
  String get statusTimeline => 'Progress';

  @override
  String get messages => 'Messages';

  @override
  String get noMessages => 'No messages yet.';

  @override
  String get messageHint => 'Write a message to our team';

  @override
  String get youLabel => 'You';

  @override
  String get quotes => 'Quotes';

  @override
  String quoteValidUntil(String when) {
    return 'Valid until $when';
  }

  @override
  String get quoteAccepted => 'Accepted';

  @override
  String get quoteExpired => 'Expired';

  @override
  String get acceptOption => 'Accept this option';

  @override
  String get acceptConfirmTitle => 'Accept this quote?';

  @override
  String acceptConfirmBody(String label, String price) {
    return '$label for $price. Our team will then arrange the booking.';
  }

  @override
  String unknownFields(String fields) {
    return 'To be confirmed by our team: $fields';
  }

  @override
  String get tickets => 'Tickets';

  @override
  String get cancelRequest => 'Cancel request';

  @override
  String get cancelConfirmTitle => 'Cancel this request?';

  @override
  String get cancelConfirmBody =>
      'This stops our work on it. You can send a new request any time.';

  @override
  String get keepRequest => 'Keep it';

  @override
  String submittedOn(String when) {
    return 'Submitted $when';
  }

  @override
  String get travellersLabel => 'Travellers';

  @override
  String unreadMessages(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString unread';
  }

  @override
  String get cargoTitle => 'Cargo';

  @override
  String get cargoIntro =>
      'Send documents or parcels along routes we serve. We quote after reviewing your goods.';

  @override
  String get laneDisabled => 'Not available';

  @override
  String laneServices(String list) {
    return 'Services: $list';
  }

  @override
  String get svcDocuments => 'Documents';

  @override
  String get svcParcel => 'Parcel';

  @override
  String get svcExcess => 'Excess baggage';

  @override
  String get svcFreight => 'Air freight';

  @override
  String get cargoRequestTitle => 'Cargo request';

  @override
  String get service => 'Service';

  @override
  String get shipper => 'Sender';

  @override
  String get consignee => 'Recipient';

  @override
  String get fullNameLatin => 'Full name (Latin letters)';

  @override
  String get phone => 'Phone';

  @override
  String get addressLine => 'Address';

  @override
  String get cityLabel => 'City';

  @override
  String get postcode => 'Postcode';

  @override
  String get readyDate => 'Ready to ship on';

  @override
  String get handover => 'Handover';

  @override
  String get handoverPickup => 'Pick-up';

  @override
  String get handoverDropoff => 'Drop-off';

  @override
  String get weightKg => 'Weight (kg)';

  @override
  String get lengthCm => 'Length (cm)';

  @override
  String get widthCm => 'Width (cm)';

  @override
  String get heightCm => 'Height (cm)';

  @override
  String get contents => 'What is inside?';

  @override
  String get declaredValue => 'Declared value (GBP)';

  @override
  String get consentAccuracy => 'The details I gave are accurate.';

  @override
  String get consentProhibited =>
      'I am not sending prohibited or dangerous items.';

  @override
  String get consentPrivacy => 'I agree to the privacy notice.';

  @override
  String get submitCargo => 'Submit cargo request';

  @override
  String get cargoDetail => 'Cargo request';

  @override
  String get tracking => 'Tracking';

  @override
  String get noTracking => 'No tracking events yet.';

  @override
  String chargeableWeight(String kg) {
    return 'Estimated chargeable weight: $kg kg';
  }

  @override
  String get inboxTitle => 'Inbox';

  @override
  String get inboxEmpty => 'Nothing here yet';

  @override
  String get inboxEmptyHelp => 'Updates about your requests will appear here.';

  @override
  String get markAllRead => 'Mark all read';

  @override
  String get accountTitle => 'Account';

  @override
  String get profileSection => 'Profile';

  @override
  String get preferences => 'Preferences';

  @override
  String get calendarLabel => 'Calendar';

  @override
  String get myTravellers => 'Saved travellers';

  @override
  String get signOut => 'Sign out';

  @override
  String get signOutConfirm => 'Sign out of this device?';

  @override
  String get roleStaff => 'Staff';

  @override
  String get adminMode => 'Admin mode';

  @override
  String get onDuty => 'On duty';

  @override
  String get onDutyHelp =>
      'On-duty staff receive new-request alerts and can claim cases.';

  @override
  String version(String v) {
    return 'Version $v';
  }

  @override
  String get queueTitle => 'Queue';

  @override
  String get mineTitle => 'My cases';

  @override
  String get tabNew => 'New';

  @override
  String get tabAwaiting => 'Awaiting';

  @override
  String get tabQuoted => 'Quoted';

  @override
  String get tabReserved => 'Reserved';

  @override
  String get summaryNew => 'New';

  @override
  String get summaryMine => 'Mine';

  @override
  String get summaryAwaiting => 'Awaiting customer';

  @override
  String get summaryQuoted => 'Quoted';

  @override
  String get summaryReserved => 'Reserved';

  @override
  String get summarySla => 'SLA breaches';

  @override
  String get queueEmpty => 'Nothing in this queue';

  @override
  String get caseTitle => 'Case';

  @override
  String get claim => 'Claim';

  @override
  String get claimed => 'Claimed — it is yours now.';

  @override
  String get requestInfo => 'Request info';

  @override
  String get requestInfoHint => 'What do you need from the customer?';

  @override
  String get addNote => 'Internal note';

  @override
  String get noteHint => 'Visible to staff only';

  @override
  String get messageCustomer => 'Message customer';

  @override
  String get logCall => 'Log call';

  @override
  String get callCustomer => 'Call customer';

  @override
  String get outcomeReached => 'Reached';

  @override
  String get outcomeNoAnswer => 'No answer';

  @override
  String get outcomeBusy => 'Busy';

  @override
  String get outcomeWrongNumber => 'Wrong number';

  @override
  String get outcomeCallBack => 'Call back requested';

  @override
  String get notes => 'Notes';

  @override
  String get assignee => 'Assigned to';

  @override
  String get unassigned => 'Unassigned';

  @override
  String slaDue(String when) {
    return 'SLA due $when';
  }

  @override
  String get slaBreached => 'SLA breached';

  @override
  String get customerLabel => 'Customer';

  @override
  String get mobileTriageOnly =>
      'Quotes, records and compliance decisions are handled in the Admin Panel.';

  @override
  String get actionDone => 'Done.';

  @override
  String get allowedNone => 'No actions available for you on this case.';

  @override
  String commandNotAllowed(String reason) {
    return 'Not available: $reason';
  }

  @override
  String get navHome => 'Home';

  @override
  String get navAlerts => 'Alerts';

  @override
  String get navMe => 'Me';

  @override
  String get homeTitle => 'Control deck';

  @override
  String homeGreeting(String name) {
    return 'Signed in as $name';
  }

  @override
  String get heroNeedsYou => 'Needs you now';

  @override
  String get heroAllClear => 'All clear';

  @override
  String get heroAllClearHelp =>
      'Nothing is past SLA, waiting to be claimed, or close to a ticketing deadline.';

  @override
  String heroSlaBreached(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString cases are past their SLA',
      one: '1 case is past its SLA',
    );
    return '$_temp0';
  }

  @override
  String heroNewUnclaimed(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString new cases are unclaimed',
      one: '1 new case is unclaimed',
    );
    return '$_temp0';
  }

  @override
  String heroDeadlines(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString ticketing deadlines within 24 h',
      one: '1 ticketing deadline within 24 h',
    );
    return '$_temp0';
  }

  @override
  String get heroNextUp => 'Most urgent unclaimed';

  @override
  String get trendUp => 'Rising';

  @override
  String get trendDown => 'Falling';

  @override
  String get trendFlat => 'Unchanged';

  @override
  String trendSince(String word, String when) {
    return '$word since $when';
  }

  @override
  String get trendNone => 'Trend builds up as this device refreshes';

  @override
  String get queueMix => 'Queue mix';

  @override
  String get queueMixEmpty => 'No open cases right now.';

  @override
  String openCases(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString open',
      one: '1 open',
    );
    return '$_temp0';
  }

  @override
  String get complianceHolds => 'Compliance holds';

  @override
  String get complianceOpen => 'Open compliance cases';

  @override
  String get verificationsWaiting => 'ID checks waiting';

  @override
  String get ticketingSoon => 'Ticketing within 24 h';

  @override
  String get decideInPanel => 'Decided in the Admin Panel';

  @override
  String deadlineIn(String ref, String time) {
    return 'Next $ref in $time';
  }

  @override
  String deadlinePast(String ref, String time) {
    return '$ref is $time late';
  }

  @override
  String get tileFailed => 'Could not load. Tap to retry.';

  @override
  String get quickActions => 'Quick actions';

  @override
  String get qaUnclaimed => 'Unclaimed cases';

  @override
  String get qaFind => 'Find a case';

  @override
  String get dataNote =>
      'Counts come from the live queue. Trends are what this device has seen, not a server history.';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsHelp => 'Appearance and language';

  @override
  String get appearance => 'Appearance';

  @override
  String get themeSystem => 'System';

  @override
  String get themeLight => 'Light';

  @override
  String get themeDark => 'Dark';

  @override
  String get tabMine => 'Mine';

  @override
  String get urgent => 'Urgent';

  @override
  String get filterAtRisk => 'SLA at risk';

  @override
  String get filterAll => 'All';

  @override
  String get clear => 'Clear';

  @override
  String get queueFilterHint => 'Filter by reference, route or customer';

  @override
  String get queueNoMatch => 'No case matches these filters';

  @override
  String get clearFilters => 'Clear filters';

  @override
  String casesCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString cases',
      one: '1 case',
    );
    return '$_temp0';
  }

  @override
  String casesShownOf(int shown, int total) {
    final intl.NumberFormat shownNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String shownString = shownNumberFormat.format(shown);
    final intl.NumberFormat totalNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String totalString = totalNumberFormat.format(total);

    return 'Showing $shownString of $totalString';
  }

  @override
  String slaLeft(Object time) {
    return '$time left';
  }

  @override
  String slaOverdue(Object time) {
    return 'Overdue by $time';
  }

  @override
  String durDays(String n) {
    return '${n}d';
  }

  @override
  String durHours(String n) {
    return '${n}h';
  }

  @override
  String durMinutes(String n) {
    return '${n}m';
  }

  @override
  String get adminSearchTitle => 'Find a case';

  @override
  String get adminSearchHint => 'Reference or phone number';

  @override
  String get adminSearchIntro =>
      'Type at least 3 characters of a reference or phone number.';

  @override
  String get adminSearchNone => 'No case found';

  @override
  String get caseActions => 'Case actions';

  @override
  String get moreActions => 'More actions';

  @override
  String get customerNote => 'Customer note';

  @override
  String get caseTruthTitle => 'What we know';

  @override
  String get activityTitle => 'Activity';

  @override
  String get activityEmpty => 'No activity of this kind yet.';

  @override
  String get msgFromCustomer => 'Message from customer';

  @override
  String get msgToCustomer => 'Sent to customer';

  @override
  String get noteKind => 'Internal note';

  @override
  String get truthRequest => 'Request';

  @override
  String get truthSnapshot => 'Offer snapshot';

  @override
  String get truthNoSnapshot => 'Manual request, no offer was frozen';

  @override
  String get truthChange => 'Changes';

  @override
  String get truthRefund => 'Refund';

  @override
  String get truthQuote => 'Quote';

  @override
  String get truthReservation => 'Reservation';

  @override
  String get truthTicket => 'Ticket';

  @override
  String get truthPayment => 'Payment';

  @override
  String get truthOnFile => 'On file';

  @override
  String get truthNone => 'None yet';

  @override
  String get truthDraftOnly => 'Draft only';

  @override
  String get truthVaries => 'varies by ticket or segment';

  @override
  String get truthUnknownValue => 'Not supplied, confirm before quoting';

  @override
  String get truthUnknownBlocks =>
      'UNKNOWN items must be confirmed before a quote can be sent.';

  @override
  String get truthPaymentNote =>
      'Payment, reservation and ticket are separate facts. A payment never means a booking.';

  @override
  String get triKnown => 'Known';

  @override
  String get triNotIncluded => 'Not included';

  @override
  String get triUnknown => 'UNKNOWN';

  @override
  String get condAllowed => 'Allowed';

  @override
  String get condNotAllowed => 'Not allowed';

  @override
  String get resHeld => 'Held';

  @override
  String get resConfirmed => 'Confirmed';

  @override
  String deadlineAt(String when) {
    return 'ticket by $when';
  }

  @override
  String ticketCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString tickets issued',
      one: '1 ticket issued',
    );
    return '$_temp0';
  }

  @override
  String get payNone => 'No payment';

  @override
  String get payPartial => 'Partly paid';

  @override
  String get payPaid => 'Paid';

  @override
  String get payRefundPending => 'Refund pending';

  @override
  String get payRefunded => 'Refunded';

  @override
  String get shipmentsTitle => 'Shipments';

  @override
  String get shipmentsIntro => 'Follow your cargo from collection to delivery.';

  @override
  String get shipmentsEmpty =>
      'No shipments yet. Once a quote is accepted, your shipment appears here.';

  @override
  String get shipmentsTotal => 'Shipments';

  @override
  String get shipmentsInTransit => 'On the way';

  @override
  String get shipmentsDelivered => 'Delivered';

  @override
  String get shipmentsNext => 'Next to arrive';

  @override
  String get etaLabel => 'Estimated delivery';

  @override
  String get etaNote => 'An estimate, not a promise. It can change.';

  @override
  String get etaNone => 'No estimate yet';

  @override
  String get trackingNoEvents =>
      'Nothing scanned yet. Updates appear here as our partner reports them.';

  @override
  String get trackingUpdated => 'Updated';

  @override
  String awbLabel(String awb) {
    return 'AWB $awb';
  }

  @override
  String get trackEventPickedUp => 'Picked up';

  @override
  String get trackEventReceived => 'Received at our partner';

  @override
  String get trackEventDeparted => 'Departed';

  @override
  String get trackEventArrived => 'Arrived';

  @override
  String get trackEventAtCustoms => 'At customs';

  @override
  String get trackEventCleared => 'Cleared customs';

  @override
  String get trackEventOutForDelivery => 'Out for delivery';

  @override
  String get trackEventDelivered => 'Delivered';

  @override
  String get trackEventHeld => 'On hold';

  @override
  String get trackEventDamaged => 'Damage reported';

  @override
  String get trackEventReturned => 'Returned';

  @override
  String get trackEventNote => 'Update';

  @override
  String get billingTitle => 'Documents & billing';

  @override
  String get billingIntro =>
      'Your quotations and invoices in one place. Documents are issued in English.';

  @override
  String get billingInvoices => 'Invoices';

  @override
  String get billingQuotations => 'Quotations';

  @override
  String get billingEmptyInvoices =>
      'No invoices yet. When we issue one it appears here.';

  @override
  String get billingEmptyQuotations =>
      'No quotations yet. When we send you a quote it appears here.';

  @override
  String billingIssuedOn(String date) {
    return 'Issued $date';
  }

  @override
  String billingSentOn(String date) {
    return 'Sent $date';
  }

  @override
  String get billingTotal => 'Total';

  @override
  String get billingCharges => 'Charges';

  @override
  String get billingDownload => 'Download PDF';

  @override
  String get billingViewQuote => 'View the quote';

  @override
  String billingUnpaidExpires(String date) {
    return 'If it is still unpaid, this invoice expires on $date.';
  }

  @override
  String get billingPayNote => 'Your Uni Travel contact tells you how to pay.';

  @override
  String get billingPayOnline => 'Pay by card on our website';

  @override
  String get billingPayOnlineNote =>
      'The payment page opens in your browser. Card details are entered there and never pass through this app.';

  @override
  String get billingPayProcessing =>
      'Your payment is being processed. You do not need to pay again.';

  @override
  String get progressLabel => 'Request progress';

  @override
  String get progressReceived => 'Received';

  @override
  String get progressReview => 'In review';

  @override
  String get progressQuote => 'Options sent';

  @override
  String get progressBooked => 'Accepted';

  @override
  String get progressTicketed => 'Ticketed';

  @override
  String get progressDone => 'done';

  @override
  String get progressCurrent => 'current';

  @override
  String get progressTodo => 'to do';

  @override
  String get billingPaidBanner => 'This invoice is paid. Thank you.';

  @override
  String get billingNotFound =>
      'We could not find this document in your account.';

  @override
  String get billingOpenFailed =>
      'The document could not be opened. Try again.';

  @override
  String get invoiceIssued => 'Awaiting payment';

  @override
  String get invoicePaid => 'Paid';

  @override
  String get invoiceCancelled => 'Cancelled';

  @override
  String get invoiceRefunded => 'Refunded';

  @override
  String get quoteSent => 'Open';

  @override
  String get quoteDeclined => 'Declined';

  @override
  String get quoteSuperseded => 'Replaced';

  @override
  String get cancelReasonExpired =>
      'This invoice expired and can no longer be paid.';

  @override
  String get cancelReasonCorrection =>
      'This invoice was withdrawn, usually because a corrected one replaces it. Do not pay it.';

  @override
  String get cancelReasonCustomerRequest =>
      'Cancelled at your request. Do not pay it.';

  @override
  String get cancelReasonDuplicate =>
      'Cancelled because it was a duplicate. Do not pay it.';

  @override
  String get cancelReasonOther => 'This invoice was cancelled. Do not pay it.';

  @override
  String get testSignInTitle => 'Test sign-in (testing phase)';

  @override
  String get testSignInHint =>
      'Signs in with the email only — no code. Disabled in production.';

  @override
  String get testSignInEmail => 'Email to sign in as';

  @override
  String get testSignInSubmit => 'Sign in without a code';

  @override
  String get testSignInError =>
      'Test sign-in failed. Check the email and try again.';
}
