import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fa.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppL10n
/// returned by `AppL10n.of(context)`.
///
/// Applications need to include `AppL10n.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppL10n.localizationsDelegates,
///   supportedLocales: AppL10n.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppL10n.supportedLocales
/// property.
abstract class AppL10n {
  AppL10n(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppL10n of(BuildContext context) {
    return Localizations.of<AppL10n>(context, AppL10n)!;
  }

  static const LocalizationsDelegate<AppL10n> delegate = _AppL10nDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('fa'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'UniTravel'**
  String get appName;

  /// No description provided for @navSearch.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get navSearch;

  /// No description provided for @navRequests.
  ///
  /// In en, this message translates to:
  /// **'Requests'**
  String get navRequests;

  /// No description provided for @navCargo.
  ///
  /// In en, this message translates to:
  /// **'Cargo'**
  String get navCargo;

  /// No description provided for @navInbox.
  ///
  /// In en, this message translates to:
  /// **'Inbox'**
  String get navInbox;

  /// No description provided for @navAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get navAccount;

  /// No description provided for @navQueue.
  ///
  /// In en, this message translates to:
  /// **'Queue'**
  String get navQueue;

  /// No description provided for @navMine.
  ///
  /// In en, this message translates to:
  /// **'Mine'**
  String get navMine;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @continueLabel.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @send.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get send;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @loading.
  ///
  /// In en, this message translates to:
  /// **'Loading…'**
  String get loading;

  /// No description provided for @optional.
  ///
  /// In en, this message translates to:
  /// **'Optional'**
  String get optional;

  /// No description provided for @offlineBanner.
  ///
  /// In en, this message translates to:
  /// **'You are offline. Showing saved data.'**
  String get offlineBanner;

  /// No description provided for @lastUpdated.
  ///
  /// In en, this message translates to:
  /// **'Last updated {when}'**
  String lastUpdated(String when);

  /// No description provided for @maintenanceTitle.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong'**
  String get maintenanceTitle;

  /// No description provided for @errNetwork.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server. Check your connection and try again.'**
  String get errNetwork;

  /// No description provided for @errRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Please wait a moment.'**
  String get errRateLimited;

  /// No description provided for @errRateLimitedIn.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Try again in {seconds}s.'**
  String errRateLimitedIn(int seconds);

  /// No description provided for @errOtpInvalid.
  ///
  /// In en, this message translates to:
  /// **'That code is not right or has expired.'**
  String get errOtpInvalid;

  /// No description provided for @errOtpExpired.
  ///
  /// In en, this message translates to:
  /// **'That code has expired. Request a new one.'**
  String get errOtpExpired;

  /// No description provided for @errOtpLocked.
  ///
  /// In en, this message translates to:
  /// **'Too many wrong codes. Try again later.'**
  String get errOtpLocked;

  /// No description provided for @errValidation.
  ///
  /// In en, this message translates to:
  /// **'Please check the highlighted details.'**
  String get errValidation;

  /// No description provided for @errForbidden.
  ///
  /// In en, this message translates to:
  /// **'You do not have access to this.'**
  String get errForbidden;

  /// No description provided for @errNotFound.
  ///
  /// In en, this message translates to:
  /// **'We could not find that.'**
  String get errNotFound;

  /// No description provided for @errConflict.
  ///
  /// In en, this message translates to:
  /// **'This changed while you were looking. Refresh and try again.'**
  String get errConflict;

  /// No description provided for @errOfferExpired.
  ///
  /// In en, this message translates to:
  /// **'That offer has expired. Search again for fresh prices.'**
  String get errOfferExpired;

  /// No description provided for @errPriceChanged.
  ///
  /// In en, this message translates to:
  /// **'The price changed. Review it and try again.'**
  String get errPriceChanged;

  /// No description provided for @errSearchExpired.
  ///
  /// In en, this message translates to:
  /// **'This search has expired. Start a new one.'**
  String get errSearchExpired;

  /// No description provided for @errSupplier.
  ///
  /// In en, this message translates to:
  /// **'A supplier is unavailable right now. Try again shortly.'**
  String get errSupplier;

  /// No description provided for @errFeatureDisabled.
  ///
  /// In en, this message translates to:
  /// **'This feature is switched off right now.'**
  String get errFeatureDisabled;

  /// No description provided for @errMfa.
  ///
  /// In en, this message translates to:
  /// **'Second-factor verification is required.'**
  String get errMfa;

  /// No description provided for @errGeneric.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get errGeneric;

  /// No description provided for @sessionExpired.
  ///
  /// In en, this message translates to:
  /// **'Your session expired. Please sign in again.'**
  String get sessionExpired;

  /// No description provided for @signInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signInTitle;

  /// No description provided for @signInIntro.
  ///
  /// In en, this message translates to:
  /// **'Fly home, or anywhere. We keep every request in one place and a real person behind it.'**
  String get signInIntro;

  /// No description provided for @phoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Mobile number'**
  String get phoneLabel;

  /// No description provided for @phoneHint.
  ///
  /// In en, this message translates to:
  /// **'+98 912 000 0000'**
  String get phoneHint;

  /// No description provided for @phoneHelp.
  ///
  /// In en, this message translates to:
  /// **'Include the country code, or enter an Iranian number starting with 09.'**
  String get phoneHelp;

  /// No description provided for @sendCode.
  ///
  /// In en, this message translates to:
  /// **'Send code'**
  String get sendCode;

  /// No description provided for @codeLabel.
  ///
  /// In en, this message translates to:
  /// **'Verification code'**
  String get codeLabel;

  /// No description provided for @codeSentTo.
  ///
  /// In en, this message translates to:
  /// **'We sent a code to {phone}.'**
  String codeSentTo(String phone);

  /// No description provided for @verify.
  ///
  /// In en, this message translates to:
  /// **'Verify'**
  String get verify;

  /// No description provided for @resendCode.
  ///
  /// In en, this message translates to:
  /// **'Resend code'**
  String get resendCode;

  /// No description provided for @resendIn.
  ///
  /// In en, this message translates to:
  /// **'Resend in {seconds}s'**
  String resendIn(int seconds);

  /// No description provided for @changeNumber.
  ///
  /// In en, this message translates to:
  /// **'Use a different number'**
  String get changeNumber;

  /// No description provided for @languageLabel.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get languageLabel;

  /// No description provided for @langEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get langEnglish;

  /// No description provided for @langPersian.
  ///
  /// In en, this message translates to:
  /// **'فارسی'**
  String get langPersian;

  /// No description provided for @profileTitle.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get profileTitle;

  /// No description provided for @profileIntro.
  ///
  /// In en, this message translates to:
  /// **'Enter your name exactly as it appears in your passport.'**
  String get profileIntro;

  /// No description provided for @givenNames.
  ///
  /// In en, this message translates to:
  /// **'Given names'**
  String get givenNames;

  /// No description provided for @surname.
  ///
  /// In en, this message translates to:
  /// **'Surname'**
  String get surname;

  /// No description provided for @nameFa.
  ///
  /// In en, this message translates to:
  /// **'Name in Persian'**
  String get nameFa;

  /// No description provided for @fieldRequired.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get fieldRequired;

  /// No description provided for @fieldLatin.
  ///
  /// In en, this message translates to:
  /// **'Use Latin letters only'**
  String get fieldLatin;

  /// No description provided for @mfaTitle.
  ///
  /// In en, this message translates to:
  /// **'Second-factor check'**
  String get mfaTitle;

  /// No description provided for @mfaIntro.
  ///
  /// In en, this message translates to:
  /// **'Staff access needs a code from your authenticator app.'**
  String get mfaIntro;

  /// No description provided for @mfaEnrolIntro.
  ///
  /// In en, this message translates to:
  /// **'Set up your authenticator app with this key, then enter the 6-digit code.'**
  String get mfaEnrolIntro;

  /// No description provided for @mfaSecret.
  ///
  /// In en, this message translates to:
  /// **'Setup key'**
  String get mfaSecret;

  /// No description provided for @mfaCode.
  ///
  /// In en, this message translates to:
  /// **'6-digit code'**
  String get mfaCode;

  /// No description provided for @mfaStart.
  ///
  /// In en, this message translates to:
  /// **'Set up authenticator'**
  String get mfaStart;

  /// No description provided for @searchTitle.
  ///
  /// In en, this message translates to:
  /// **'Where to?'**
  String get searchTitle;

  /// No description provided for @searchSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Compare routes, then ask us to arrange the one you like.'**
  String get searchSubtitle;

  /// No description provided for @tripOneWay.
  ///
  /// In en, this message translates to:
  /// **'One way'**
  String get tripOneWay;

  /// No description provided for @tripReturn.
  ///
  /// In en, this message translates to:
  /// **'Return'**
  String get tripReturn;

  /// No description provided for @tripOpenJaw.
  ///
  /// In en, this message translates to:
  /// **'Open jaw'**
  String get tripOpenJaw;

  /// No description provided for @tripMultiCity.
  ///
  /// In en, this message translates to:
  /// **'Multi-city'**
  String get tripMultiCity;

  /// No description provided for @from.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get from;

  /// No description provided for @to.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get to;

  /// No description provided for @chooseCity.
  ///
  /// In en, this message translates to:
  /// **'Choose a city or airport'**
  String get chooseCity;

  /// No description provided for @searchPlaces.
  ///
  /// In en, this message translates to:
  /// **'Search city or airport'**
  String get searchPlaces;

  /// No description provided for @noPlaces.
  ///
  /// In en, this message translates to:
  /// **'No matching places'**
  String get noPlaces;

  /// No description provided for @date.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get date;

  /// No description provided for @returnDate.
  ///
  /// In en, this message translates to:
  /// **'Return date'**
  String get returnDate;

  /// No description provided for @chooseDate.
  ///
  /// In en, this message translates to:
  /// **'Choose a date'**
  String get chooseDate;

  /// No description provided for @leg.
  ///
  /// In en, this message translates to:
  /// **'Flight {n}'**
  String leg(int n);

  /// No description provided for @addFlight.
  ///
  /// In en, this message translates to:
  /// **'Add a flight'**
  String get addFlight;

  /// No description provided for @removeFlight.
  ///
  /// In en, this message translates to:
  /// **'Remove flight'**
  String get removeFlight;

  /// No description provided for @travellers.
  ///
  /// In en, this message translates to:
  /// **'Travellers'**
  String get travellers;

  /// No description provided for @adults.
  ///
  /// In en, this message translates to:
  /// **'Adults'**
  String get adults;

  /// No description provided for @children.
  ///
  /// In en, this message translates to:
  /// **'Children (2–11)'**
  String get children;

  /// No description provided for @infants.
  ///
  /// In en, this message translates to:
  /// **'Infants (under 2)'**
  String get infants;

  /// No description provided for @childAge.
  ///
  /// In en, this message translates to:
  /// **'Age of child {n}'**
  String childAge(int n);

  /// No description provided for @travellerCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 traveller} other{{count} travellers}}'**
  String travellerCount(int count);

  /// No description provided for @cabin.
  ///
  /// In en, this message translates to:
  /// **'Cabin'**
  String get cabin;

  /// No description provided for @cabinEconomy.
  ///
  /// In en, this message translates to:
  /// **'Economy'**
  String get cabinEconomy;

  /// No description provided for @cabinPremium.
  ///
  /// In en, this message translates to:
  /// **'Premium economy'**
  String get cabinPremium;

  /// No description provided for @cabinBusiness.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get cabinBusiness;

  /// No description provided for @cabinFirst.
  ///
  /// In en, this message translates to:
  /// **'First'**
  String get cabinFirst;

  /// No description provided for @connections.
  ///
  /// In en, this message translates to:
  /// **'Connections'**
  String get connections;

  /// No description provided for @maxStops.
  ///
  /// In en, this message translates to:
  /// **'Maximum stops'**
  String get maxStops;

  /// No description provided for @stopsAny.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Direct only} one{Up to 1 stop} other{Up to {count} stops}}'**
  String stopsAny(int count);

  /// No description provided for @allowSelfTransfer.
  ///
  /// In en, this message translates to:
  /// **'Allow self-transfer (separate tickets)'**
  String get allowSelfTransfer;

  /// No description provided for @allowOvernight.
  ///
  /// In en, this message translates to:
  /// **'Allow overnight layovers'**
  String get allowOvernight;

  /// No description provided for @allowAirportChange.
  ///
  /// In en, this message translates to:
  /// **'Allow airport changes'**
  String get allowAirportChange;

  /// No description provided for @includeGateways.
  ///
  /// In en, this message translates to:
  /// **'Include nearby gateway airports'**
  String get includeGateways;

  /// No description provided for @gatewayHint.
  ///
  /// In en, this message translates to:
  /// **'Gateways start your trip at a nearby border city, often cheaper, with an overland leg.'**
  String get gatewayHint;

  /// No description provided for @searchFlights.
  ///
  /// In en, this message translates to:
  /// **'Search flights'**
  String get searchFlights;

  /// No description provided for @problemMissingPlace.
  ///
  /// In en, this message translates to:
  /// **'Choose where you are flying from and to.'**
  String get problemMissingPlace;

  /// No description provided for @problemSamePlace.
  ///
  /// In en, this message translates to:
  /// **'Origin and destination must be different.'**
  String get problemSamePlace;

  /// No description provided for @problemMissingDate.
  ///
  /// In en, this message translates to:
  /// **'Choose a date for each flight.'**
  String get problemMissingDate;

  /// No description provided for @problemDateOrder.
  ///
  /// In en, this message translates to:
  /// **'Dates must be in order.'**
  String get problemDateOrder;

  /// No description provided for @problemInfants.
  ///
  /// In en, this message translates to:
  /// **'Each infant needs an adult on the same booking.'**
  String get problemInfants;

  /// No description provided for @calendarGregorian.
  ///
  /// In en, this message translates to:
  /// **'Gregorian'**
  String get calendarGregorian;

  /// No description provided for @calendarJalali.
  ///
  /// In en, this message translates to:
  /// **'Jalali'**
  String get calendarJalali;

  /// No description provided for @resultsTitle.
  ///
  /// In en, this message translates to:
  /// **'Results'**
  String get resultsTitle;

  /// No description provided for @searchingSources.
  ///
  /// In en, this message translates to:
  /// **'Searching {total} sources · {done} of {total}'**
  String searchingSources(int total, int done);

  /// No description provided for @searchComplete.
  ///
  /// In en, this message translates to:
  /// **'Searched {total} sources'**
  String searchComplete(int total);

  /// No description provided for @searchPartial.
  ///
  /// In en, this message translates to:
  /// **'Some sources were slow ({done} of {total} answered)'**
  String searchPartial(int total, int done);

  /// No description provided for @searchFailed.
  ///
  /// In en, this message translates to:
  /// **'The search could not finish.'**
  String get searchFailed;

  /// No description provided for @tabBest.
  ///
  /// In en, this message translates to:
  /// **'Best'**
  String get tabBest;

  /// No description provided for @tabCheapest.
  ///
  /// In en, this message translates to:
  /// **'Cheapest'**
  String get tabCheapest;

  /// No description provided for @tabFastest.
  ///
  /// In en, this message translates to:
  /// **'Fastest'**
  String get tabFastest;

  /// No description provided for @tabSingle.
  ///
  /// In en, this message translates to:
  /// **'Single ticket'**
  String get tabSingle;

  /// No description provided for @noResults.
  ///
  /// In en, this message translates to:
  /// **'No flights found for these details.'**
  String get noResults;

  /// No description provided for @noResultsHelp.
  ///
  /// In en, this message translates to:
  /// **'Try other dates, allow more stops, or send us a manual request.'**
  String get noResultsHelp;

  /// No description provided for @manualRequest.
  ///
  /// In en, this message translates to:
  /// **'Send a manual request'**
  String get manualRequest;

  /// No description provided for @manualRequestHelp.
  ///
  /// In en, this message translates to:
  /// **'Not finding what you need? Our team will search by hand and call you.'**
  String get manualRequestHelp;

  /// No description provided for @loadMore.
  ///
  /// In en, this message translates to:
  /// **'Show more'**
  String get loadMore;

  /// No description provided for @resultCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 result} other{{count} results}}'**
  String resultCount(int count);

  /// No description provided for @badgeLive.
  ///
  /// In en, this message translates to:
  /// **'LIVE'**
  String get badgeLive;

  /// No description provided for @badgeCached.
  ///
  /// In en, this message translates to:
  /// **'CACHED'**
  String get badgeCached;

  /// No description provided for @badgePriced.
  ///
  /// In en, this message translates to:
  /// **'PRICE CONFIRMED'**
  String get badgePriced;

  /// No description provided for @badgeFake.
  ///
  /// In en, this message translates to:
  /// **'TEST DATA'**
  String get badgeFake;

  /// No description provided for @badgeSeparate.
  ///
  /// In en, this message translates to:
  /// **'SEPARATE TICKETS'**
  String get badgeSeparate;

  /// No description provided for @badgeGateway.
  ///
  /// In en, this message translates to:
  /// **'STARTS AT GATEWAY'**
  String get badgeGateway;

  /// No description provided for @badgeOvernight.
  ///
  /// In en, this message translates to:
  /// **'OVERNIGHT'**
  String get badgeOvernight;

  /// No description provided for @badgeTight.
  ///
  /// In en, this message translates to:
  /// **'TIGHT CONNECTION'**
  String get badgeTight;

  /// No description provided for @badgeAirportChange.
  ///
  /// In en, this message translates to:
  /// **'AIRPORT CHANGE'**
  String get badgeAirportChange;

  /// No description provided for @stopsDirect.
  ///
  /// In en, this message translates to:
  /// **'Direct'**
  String get stopsDirect;

  /// No description provided for @stopsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 stop} other{{count} stops}}'**
  String stopsCount(int count);

  /// No description provided for @layoverAt.
  ///
  /// In en, this message translates to:
  /// **'{duration} in {airport}'**
  String layoverAt(String duration, String airport);

  /// No description provided for @durationHm.
  ///
  /// In en, this message translates to:
  /// **'{hours}h {minutes}m'**
  String durationHm(String hours, String minutes);

  /// No description provided for @durationH.
  ///
  /// In en, this message translates to:
  /// **'{hours}h'**
  String durationH(String hours);

  /// No description provided for @durationM.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m'**
  String durationM(String minutes);

  /// No description provided for @dayPlus.
  ///
  /// In en, this message translates to:
  /// **'+{n}d'**
  String dayPlus(String n);

  /// No description provided for @itineraryTitle.
  ///
  /// In en, this message translates to:
  /// **'Itinerary'**
  String get itineraryTitle;

  /// No description provided for @itineraryLoadError.
  ///
  /// In en, this message translates to:
  /// **'We could not load this itinerary.'**
  String get itineraryLoadError;

  /// No description provided for @priceTotal.
  ///
  /// In en, this message translates to:
  /// **'Total price'**
  String get priceTotal;

  /// No description provided for @priceFrom.
  ///
  /// In en, this message translates to:
  /// **'Fares in this itinerary: {count}'**
  String priceFrom(int count);

  /// No description provided for @ticketN.
  ///
  /// In en, this message translates to:
  /// **'Ticket {n}'**
  String ticketN(int n);

  /// No description provided for @sumOfTickets.
  ///
  /// In en, this message translates to:
  /// **'Sum of separate tickets'**
  String get sumOfTickets;

  /// No description provided for @segments.
  ///
  /// In en, this message translates to:
  /// **'Flights'**
  String get segments;

  /// No description provided for @terminal.
  ///
  /// In en, this message translates to:
  /// **'Terminal {t}'**
  String terminal(String t);

  /// No description provided for @selfTransferAdvice.
  ///
  /// In en, this message translates to:
  /// **'Self-transfer: you collect your bags, check in again and clear any border control yourself. A missed connection is not protected by the airline.'**
  String get selfTransferAdvice;

  /// No description provided for @overnightAdvice.
  ///
  /// In en, this message translates to:
  /// **'Overnight layover: plan where you will stay.'**
  String get overnightAdvice;

  /// No description provided for @tightAdvice.
  ///
  /// In en, this message translates to:
  /// **'Tight connection: allow for delays.'**
  String get tightAdvice;

  /// No description provided for @airportChangeAdvice.
  ///
  /// In en, this message translates to:
  /// **'This connection changes airport.'**
  String get airportChangeAdvice;

  /// No description provided for @gatewayAdvice.
  ///
  /// In en, this message translates to:
  /// **'Starts at gateway {iata}: {access}'**
  String gatewayAdvice(String iata, String access);

  /// No description provided for @baggage.
  ///
  /// In en, this message translates to:
  /// **'Baggage'**
  String get baggage;

  /// No description provided for @baggageUnknown.
  ///
  /// In en, this message translates to:
  /// **'Not provided — our team will confirm'**
  String get baggageUnknown;

  /// No description provided for @baggageNone.
  ///
  /// In en, this message translates to:
  /// **'No checked bag included'**
  String get baggageNone;

  /// No description provided for @baggagePieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 checked bag included} other{{count} checked bags included}}'**
  String baggagePieces(int count);

  /// No description provided for @baggageKg.
  ///
  /// In en, this message translates to:
  /// **'{kg} kg each'**
  String baggageKg(String kg);

  /// No description provided for @cabinBagYes.
  ///
  /// In en, this message translates to:
  /// **'Cabin bag included'**
  String get cabinBagYes;

  /// No description provided for @cabinBagNo.
  ///
  /// In en, this message translates to:
  /// **'No cabin bag'**
  String get cabinBagNo;

  /// No description provided for @priceFreshness.
  ///
  /// In en, this message translates to:
  /// **'Price checked {when}'**
  String priceFreshness(String when);

  /// No description provided for @priceFreshnessCached.
  ///
  /// In en, this message translates to:
  /// **'Cached price from {when}, not yet confirmed with the airline'**
  String priceFreshnessCached(String when);

  /// No description provided for @recheckPrice.
  ///
  /// In en, this message translates to:
  /// **'Recheck price'**
  String get recheckPrice;

  /// No description provided for @priceConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Price confirmed.'**
  String get priceConfirmed;

  /// No description provided for @priceChangedTo.
  ///
  /// In en, this message translates to:
  /// **'Price changed to {price}.'**
  String priceChangedTo(String price);

  /// No description provided for @offerExpired.
  ///
  /// In en, this message translates to:
  /// **'This offer has expired. Search again.'**
  String get offerExpired;

  /// No description provided for @offerUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This offer is no longer available.'**
  String get offerUnavailable;

  /// No description provided for @requestItinerary.
  ///
  /// In en, this message translates to:
  /// **'Request this itinerary'**
  String get requestItinerary;

  /// No description provided for @requestNotBooking.
  ///
  /// In en, this message translates to:
  /// **'Requesting does not book a seat. Our team checks availability and sends you a quote.'**
  String get requestNotBooking;

  /// No description provided for @fakeNotice.
  ///
  /// In en, this message translates to:
  /// **'Test data from a demo supplier. Not a real fare.'**
  String get fakeNotice;

  /// No description provided for @ruleSeparateWarn.
  ///
  /// In en, this message translates to:
  /// **'Separate tickets: if the first flight is late, the second is not protected.'**
  String get ruleSeparateWarn;

  /// No description provided for @requestFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Your request'**
  String get requestFormTitle;

  /// No description provided for @manualFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Manual request'**
  String get manualFormTitle;

  /// No description provided for @whoIsTravelling.
  ///
  /// In en, this message translates to:
  /// **'Who is travelling?'**
  String get whoIsTravelling;

  /// No description provided for @addTraveller.
  ///
  /// In en, this message translates to:
  /// **'Add a traveller'**
  String get addTraveller;

  /// No description provided for @noTravellers.
  ///
  /// In en, this message translates to:
  /// **'Add the people travelling, as named in their passports.'**
  String get noTravellers;

  /// No description provided for @travellerForType.
  ///
  /// In en, this message translates to:
  /// **'Traveller {n} ({type})'**
  String travellerForType(int n, String type);

  /// No description provided for @typeAdult.
  ///
  /// In en, this message translates to:
  /// **'adult'**
  String get typeAdult;

  /// No description provided for @typeChild.
  ///
  /// In en, this message translates to:
  /// **'child'**
  String get typeChild;

  /// No description provided for @typeInfant.
  ///
  /// In en, this message translates to:
  /// **'infant'**
  String get typeInfant;

  /// No description provided for @documentMissing.
  ///
  /// In en, this message translates to:
  /// **'Passport details still needed'**
  String get documentMissing;

  /// No description provided for @noteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note for our team'**
  String get noteLabel;

  /// No description provided for @flexibility.
  ///
  /// In en, this message translates to:
  /// **'Date flexibility'**
  String get flexibility;

  /// No description provided for @flexibilityHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. ±3 days, prefer weekdays'**
  String get flexibilityHint;

  /// No description provided for @budget.
  ///
  /// In en, this message translates to:
  /// **'Budget (GBP, optional)'**
  String get budget;

  /// No description provided for @ackNotBooking.
  ///
  /// In en, this message translates to:
  /// **'I understand this is a request, not a booking or a ticket.'**
  String get ackNotBooking;

  /// No description provided for @ackPrivacy.
  ///
  /// In en, this message translates to:
  /// **'I agree to the privacy notice and to being contacted about this request.'**
  String get ackPrivacy;

  /// No description provided for @ackSelfTransfer.
  ///
  /// In en, this message translates to:
  /// **'I understand the self-transfer risks of separate tickets.'**
  String get ackSelfTransfer;

  /// No description provided for @submitRequest.
  ///
  /// In en, this message translates to:
  /// **'Submit request'**
  String get submitRequest;

  /// No description provided for @acceptNewPrice.
  ///
  /// In en, this message translates to:
  /// **'Accept the new price and submit'**
  String get acceptNewPrice;

  /// No description provided for @copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copy;

  /// No description provided for @copied.
  ///
  /// In en, this message translates to:
  /// **'Copied'**
  String get copied;

  /// No description provided for @statusSubmitted.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get statusSubmitted;

  /// No description provided for @statusComplianceHold.
  ///
  /// In en, this message translates to:
  /// **'Compliance hold'**
  String get statusComplianceHold;

  /// No description provided for @statusNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get statusNew;

  /// No description provided for @statusInReview.
  ///
  /// In en, this message translates to:
  /// **'In review'**
  String get statusInReview;

  /// No description provided for @statusAwaitingCustomer.
  ///
  /// In en, this message translates to:
  /// **'Awaiting customer'**
  String get statusAwaitingCustomer;

  /// No description provided for @statusQuoted.
  ///
  /// In en, this message translates to:
  /// **'Quoted'**
  String get statusQuoted;

  /// No description provided for @statusAccepted.
  ///
  /// In en, this message translates to:
  /// **'Accepted'**
  String get statusAccepted;

  /// No description provided for @statusReserved.
  ///
  /// In en, this message translates to:
  /// **'Reserved'**
  String get statusReserved;

  /// No description provided for @statusTicketed.
  ///
  /// In en, this message translates to:
  /// **'Ticketed'**
  String get statusTicketed;

  /// No description provided for @statusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get statusCompleted;

  /// No description provided for @statusDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get statusDeclined;

  /// No description provided for @statusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get statusCancelled;

  /// No description provided for @statusExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get statusExpired;

  /// No description provided for @submitting.
  ///
  /// In en, this message translates to:
  /// **'Submitting…'**
  String get submitting;

  /// No description provided for @needAcks.
  ///
  /// In en, this message translates to:
  /// **'Please tick the acknowledgements to continue.'**
  String get needAcks;

  /// No description provided for @needTraveller.
  ///
  /// In en, this message translates to:
  /// **'Add at least one traveller.'**
  String get needTraveller;

  /// No description provided for @travellerFormTitle.
  ///
  /// In en, this message translates to:
  /// **'New traveller'**
  String get travellerFormTitle;

  /// No description provided for @title.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get title;

  /// No description provided for @dateOfBirth.
  ///
  /// In en, this message translates to:
  /// **'Date of birth'**
  String get dateOfBirth;

  /// No description provided for @gender.
  ///
  /// In en, this message translates to:
  /// **'Gender on passport'**
  String get gender;

  /// No description provided for @genderM.
  ///
  /// In en, this message translates to:
  /// **'Male'**
  String get genderM;

  /// No description provided for @genderF.
  ///
  /// In en, this message translates to:
  /// **'Female'**
  String get genderF;

  /// No description provided for @genderX.
  ///
  /// In en, this message translates to:
  /// **'Unspecified'**
  String get genderX;

  /// No description provided for @nationality.
  ///
  /// In en, this message translates to:
  /// **'Nationality'**
  String get nationality;

  /// No description provided for @nationalityHint.
  ///
  /// In en, this message translates to:
  /// **'Two-letter country code, e.g. IR'**
  String get nationalityHint;

  /// No description provided for @confirmationTitle.
  ///
  /// In en, this message translates to:
  /// **'Request received'**
  String get confirmationTitle;

  /// No description provided for @confirmationBody.
  ///
  /// In en, this message translates to:
  /// **'Your reference is below. We will call you to confirm details and send a quote. Nothing is booked yet.'**
  String get confirmationBody;

  /// No description provided for @referenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Reference'**
  String get referenceLabel;

  /// No description provided for @viewRequest.
  ///
  /// In en, this message translates to:
  /// **'View request'**
  String get viewRequest;

  /// No description provided for @newSearch.
  ///
  /// In en, this message translates to:
  /// **'New search'**
  String get newSearch;

  /// No description provided for @requestsTitle.
  ///
  /// In en, this message translates to:
  /// **'My requests'**
  String get requestsTitle;

  /// No description provided for @noRequests.
  ///
  /// In en, this message translates to:
  /// **'No requests yet'**
  String get noRequests;

  /// No description provided for @noRequestsHelp.
  ///
  /// In en, this message translates to:
  /// **'Search for a flight and request the one you like.'**
  String get noRequestsHelp;

  /// No description provided for @startSearch.
  ///
  /// In en, this message translates to:
  /// **'Start a search'**
  String get startSearch;

  /// No description provided for @requestDetail.
  ///
  /// In en, this message translates to:
  /// **'Request'**
  String get requestDetail;

  /// No description provided for @statusTimeline.
  ///
  /// In en, this message translates to:
  /// **'Progress'**
  String get statusTimeline;

  /// No description provided for @messages.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get messages;

  /// No description provided for @noMessages.
  ///
  /// In en, this message translates to:
  /// **'No messages yet.'**
  String get noMessages;

  /// No description provided for @messageHint.
  ///
  /// In en, this message translates to:
  /// **'Write a message to our team'**
  String get messageHint;

  /// No description provided for @youLabel.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get youLabel;

  /// No description provided for @quotes.
  ///
  /// In en, this message translates to:
  /// **'Quotes'**
  String get quotes;

  /// No description provided for @quoteValidUntil.
  ///
  /// In en, this message translates to:
  /// **'Valid until {when}'**
  String quoteValidUntil(String when);

  /// No description provided for @quoteAccepted.
  ///
  /// In en, this message translates to:
  /// **'Accepted'**
  String get quoteAccepted;

  /// No description provided for @quoteExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get quoteExpired;

  /// No description provided for @acceptOption.
  ///
  /// In en, this message translates to:
  /// **'Accept this option'**
  String get acceptOption;

  /// No description provided for @acceptConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Accept this quote?'**
  String get acceptConfirmTitle;

  /// No description provided for @acceptConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'{label} for {price}. Our team will then arrange the booking.'**
  String acceptConfirmBody(String label, String price);

  /// No description provided for @unknownFields.
  ///
  /// In en, this message translates to:
  /// **'To be confirmed by our team: {fields}'**
  String unknownFields(String fields);

  /// No description provided for @tickets.
  ///
  /// In en, this message translates to:
  /// **'Tickets'**
  String get tickets;

  /// No description provided for @cancelRequest.
  ///
  /// In en, this message translates to:
  /// **'Cancel request'**
  String get cancelRequest;

  /// No description provided for @cancelConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this request?'**
  String get cancelConfirmTitle;

  /// No description provided for @cancelConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This stops our work on it. You can send a new request any time.'**
  String get cancelConfirmBody;

  /// No description provided for @keepRequest.
  ///
  /// In en, this message translates to:
  /// **'Keep it'**
  String get keepRequest;

  /// No description provided for @submittedOn.
  ///
  /// In en, this message translates to:
  /// **'Submitted {when}'**
  String submittedOn(String when);

  /// No description provided for @travellersLabel.
  ///
  /// In en, this message translates to:
  /// **'Travellers'**
  String get travellersLabel;

  /// No description provided for @unreadMessages.
  ///
  /// In en, this message translates to:
  /// **'{count} unread'**
  String unreadMessages(int count);

  /// No description provided for @cargoTitle.
  ///
  /// In en, this message translates to:
  /// **'Cargo'**
  String get cargoTitle;

  /// No description provided for @cargoIntro.
  ///
  /// In en, this message translates to:
  /// **'Send documents or parcels along routes we serve. We quote after reviewing your goods.'**
  String get cargoIntro;

  /// No description provided for @laneDisabled.
  ///
  /// In en, this message translates to:
  /// **'Not available'**
  String get laneDisabled;

  /// No description provided for @laneServices.
  ///
  /// In en, this message translates to:
  /// **'Services: {list}'**
  String laneServices(String list);

  /// No description provided for @svcDocuments.
  ///
  /// In en, this message translates to:
  /// **'Documents'**
  String get svcDocuments;

  /// No description provided for @svcParcel.
  ///
  /// In en, this message translates to:
  /// **'Parcel'**
  String get svcParcel;

  /// No description provided for @svcExcess.
  ///
  /// In en, this message translates to:
  /// **'Excess baggage'**
  String get svcExcess;

  /// No description provided for @svcFreight.
  ///
  /// In en, this message translates to:
  /// **'Air freight'**
  String get svcFreight;

  /// No description provided for @cargoRequestTitle.
  ///
  /// In en, this message translates to:
  /// **'Cargo request'**
  String get cargoRequestTitle;

  /// No description provided for @service.
  ///
  /// In en, this message translates to:
  /// **'Service'**
  String get service;

  /// No description provided for @shipper.
  ///
  /// In en, this message translates to:
  /// **'Sender'**
  String get shipper;

  /// No description provided for @consignee.
  ///
  /// In en, this message translates to:
  /// **'Recipient'**
  String get consignee;

  /// No description provided for @fullNameLatin.
  ///
  /// In en, this message translates to:
  /// **'Full name (Latin letters)'**
  String get fullNameLatin;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// No description provided for @addressLine.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get addressLine;

  /// No description provided for @cityLabel.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get cityLabel;

  /// No description provided for @postcode.
  ///
  /// In en, this message translates to:
  /// **'Postcode'**
  String get postcode;

  /// No description provided for @readyDate.
  ///
  /// In en, this message translates to:
  /// **'Ready to ship on'**
  String get readyDate;

  /// No description provided for @handover.
  ///
  /// In en, this message translates to:
  /// **'Handover'**
  String get handover;

  /// No description provided for @handoverPickup.
  ///
  /// In en, this message translates to:
  /// **'Pick-up'**
  String get handoverPickup;

  /// No description provided for @handoverDropoff.
  ///
  /// In en, this message translates to:
  /// **'Drop-off'**
  String get handoverDropoff;

  /// No description provided for @weightKg.
  ///
  /// In en, this message translates to:
  /// **'Weight (kg)'**
  String get weightKg;

  /// No description provided for @lengthCm.
  ///
  /// In en, this message translates to:
  /// **'Length (cm)'**
  String get lengthCm;

  /// No description provided for @widthCm.
  ///
  /// In en, this message translates to:
  /// **'Width (cm)'**
  String get widthCm;

  /// No description provided for @heightCm.
  ///
  /// In en, this message translates to:
  /// **'Height (cm)'**
  String get heightCm;

  /// No description provided for @contents.
  ///
  /// In en, this message translates to:
  /// **'What is inside?'**
  String get contents;

  /// No description provided for @declaredValue.
  ///
  /// In en, this message translates to:
  /// **'Declared value (GBP)'**
  String get declaredValue;

  /// No description provided for @consentAccuracy.
  ///
  /// In en, this message translates to:
  /// **'The details I gave are accurate.'**
  String get consentAccuracy;

  /// No description provided for @consentProhibited.
  ///
  /// In en, this message translates to:
  /// **'I am not sending prohibited or dangerous items.'**
  String get consentProhibited;

  /// No description provided for @consentPrivacy.
  ///
  /// In en, this message translates to:
  /// **'I agree to the privacy notice.'**
  String get consentPrivacy;

  /// No description provided for @submitCargo.
  ///
  /// In en, this message translates to:
  /// **'Submit cargo request'**
  String get submitCargo;

  /// No description provided for @cargoDetail.
  ///
  /// In en, this message translates to:
  /// **'Cargo request'**
  String get cargoDetail;

  /// No description provided for @tracking.
  ///
  /// In en, this message translates to:
  /// **'Tracking'**
  String get tracking;

  /// No description provided for @noTracking.
  ///
  /// In en, this message translates to:
  /// **'No tracking events yet.'**
  String get noTracking;

  /// No description provided for @chargeableWeight.
  ///
  /// In en, this message translates to:
  /// **'Estimated chargeable weight: {kg} kg'**
  String chargeableWeight(String kg);

  /// No description provided for @inboxTitle.
  ///
  /// In en, this message translates to:
  /// **'Inbox'**
  String get inboxTitle;

  /// No description provided for @inboxEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet'**
  String get inboxEmpty;

  /// No description provided for @inboxEmptyHelp.
  ///
  /// In en, this message translates to:
  /// **'Updates about your requests will appear here.'**
  String get inboxEmptyHelp;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllRead;

  /// No description provided for @accountTitle.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get accountTitle;

  /// No description provided for @profileSection.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profileSection;

  /// No description provided for @preferences.
  ///
  /// In en, this message translates to:
  /// **'Preferences'**
  String get preferences;

  /// No description provided for @calendarLabel.
  ///
  /// In en, this message translates to:
  /// **'Calendar'**
  String get calendarLabel;

  /// No description provided for @myTravellers.
  ///
  /// In en, this message translates to:
  /// **'Saved travellers'**
  String get myTravellers;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @signOutConfirm.
  ///
  /// In en, this message translates to:
  /// **'Sign out of this device?'**
  String get signOutConfirm;

  /// No description provided for @roleStaff.
  ///
  /// In en, this message translates to:
  /// **'Staff'**
  String get roleStaff;

  /// No description provided for @adminMode.
  ///
  /// In en, this message translates to:
  /// **'Admin mode'**
  String get adminMode;

  /// No description provided for @onDuty.
  ///
  /// In en, this message translates to:
  /// **'On duty'**
  String get onDuty;

  /// No description provided for @onDutyHelp.
  ///
  /// In en, this message translates to:
  /// **'On-duty staff receive new-request alerts and can claim cases.'**
  String get onDutyHelp;

  /// No description provided for @version.
  ///
  /// In en, this message translates to:
  /// **'Version {v}'**
  String version(String v);

  /// No description provided for @queueTitle.
  ///
  /// In en, this message translates to:
  /// **'Queue'**
  String get queueTitle;

  /// No description provided for @mineTitle.
  ///
  /// In en, this message translates to:
  /// **'My cases'**
  String get mineTitle;

  /// No description provided for @tabNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get tabNew;

  /// No description provided for @tabAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Awaiting'**
  String get tabAwaiting;

  /// No description provided for @tabQuoted.
  ///
  /// In en, this message translates to:
  /// **'Quoted'**
  String get tabQuoted;

  /// No description provided for @tabReserved.
  ///
  /// In en, this message translates to:
  /// **'Reserved'**
  String get tabReserved;

  /// No description provided for @summaryNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get summaryNew;

  /// No description provided for @summaryMine.
  ///
  /// In en, this message translates to:
  /// **'Mine'**
  String get summaryMine;

  /// No description provided for @summaryAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Awaiting customer'**
  String get summaryAwaiting;

  /// No description provided for @summaryQuoted.
  ///
  /// In en, this message translates to:
  /// **'Quoted'**
  String get summaryQuoted;

  /// No description provided for @summaryReserved.
  ///
  /// In en, this message translates to:
  /// **'Reserved'**
  String get summaryReserved;

  /// No description provided for @summarySla.
  ///
  /// In en, this message translates to:
  /// **'SLA breaches'**
  String get summarySla;

  /// No description provided for @queueEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing in this queue'**
  String get queueEmpty;

  /// No description provided for @caseTitle.
  ///
  /// In en, this message translates to:
  /// **'Case'**
  String get caseTitle;

  /// No description provided for @claim.
  ///
  /// In en, this message translates to:
  /// **'Claim'**
  String get claim;

  /// No description provided for @claimed.
  ///
  /// In en, this message translates to:
  /// **'Claimed — it is yours now.'**
  String get claimed;

  /// No description provided for @requestInfo.
  ///
  /// In en, this message translates to:
  /// **'Request info'**
  String get requestInfo;

  /// No description provided for @requestInfoHint.
  ///
  /// In en, this message translates to:
  /// **'What do you need from the customer?'**
  String get requestInfoHint;

  /// No description provided for @addNote.
  ///
  /// In en, this message translates to:
  /// **'Internal note'**
  String get addNote;

  /// No description provided for @noteHint.
  ///
  /// In en, this message translates to:
  /// **'Visible to staff only'**
  String get noteHint;

  /// No description provided for @messageCustomer.
  ///
  /// In en, this message translates to:
  /// **'Message customer'**
  String get messageCustomer;

  /// No description provided for @logCall.
  ///
  /// In en, this message translates to:
  /// **'Log call'**
  String get logCall;

  /// No description provided for @callCustomer.
  ///
  /// In en, this message translates to:
  /// **'Call customer'**
  String get callCustomer;

  /// No description provided for @outcomeReached.
  ///
  /// In en, this message translates to:
  /// **'Reached'**
  String get outcomeReached;

  /// No description provided for @outcomeNoAnswer.
  ///
  /// In en, this message translates to:
  /// **'No answer'**
  String get outcomeNoAnswer;

  /// No description provided for @outcomeBusy.
  ///
  /// In en, this message translates to:
  /// **'Busy'**
  String get outcomeBusy;

  /// No description provided for @outcomeWrongNumber.
  ///
  /// In en, this message translates to:
  /// **'Wrong number'**
  String get outcomeWrongNumber;

  /// No description provided for @outcomeCallBack.
  ///
  /// In en, this message translates to:
  /// **'Call back requested'**
  String get outcomeCallBack;

  /// No description provided for @notes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get notes;

  /// No description provided for @assignee.
  ///
  /// In en, this message translates to:
  /// **'Assigned to'**
  String get assignee;

  /// No description provided for @unassigned.
  ///
  /// In en, this message translates to:
  /// **'Unassigned'**
  String get unassigned;

  /// No description provided for @slaDue.
  ///
  /// In en, this message translates to:
  /// **'SLA due {when}'**
  String slaDue(String when);

  /// No description provided for @slaBreached.
  ///
  /// In en, this message translates to:
  /// **'SLA breached'**
  String get slaBreached;

  /// No description provided for @customerLabel.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get customerLabel;

  /// No description provided for @mobileTriageOnly.
  ///
  /// In en, this message translates to:
  /// **'Quotes, records and compliance decisions are handled in the Admin Panel.'**
  String get mobileTriageOnly;

  /// No description provided for @actionDone.
  ///
  /// In en, this message translates to:
  /// **'Done.'**
  String get actionDone;

  /// No description provided for @allowedNone.
  ///
  /// In en, this message translates to:
  /// **'No actions available for you on this case.'**
  String get allowedNone;

  /// No description provided for @commandNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'Not available: {reason}'**
  String commandNotAllowed(String reason);
}

class _AppL10nDelegate extends LocalizationsDelegate<AppL10n> {
  const _AppL10nDelegate();

  @override
  Future<AppL10n> load(Locale locale) {
    return SynchronousFuture<AppL10n>(lookupAppL10n(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'fa'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppL10nDelegate old) => false;
}

AppL10n lookupAppL10n(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppL10nEn();
    case 'fa':
      return AppL10nFa();
  }

  throw FlutterError(
    'AppL10n.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
