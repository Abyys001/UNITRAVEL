import 'package:intl/intl.dart';
import 'package:shamsi_date/shamsi_date.dart';

import '../l10n/app_localizations.dart';
import '../models/json.dart';

const _faDigits = '۰۱۲۳۴۵۶۷۸۹';

/// Latin digits -> Persian digits (display only).
String toPersianDigits(String s) =>
    s.replaceAllMapped(RegExp(r'[0-9]'), (m) => _faDigits[int.parse(m[0]!)]);

/// Persian / Arabic-Indic digits -> Latin digits (input normalisation).
String toLatinDigits(String s) {
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  final b = StringBuffer();
  for (final r in s.runes) {
    final c = String.fromCharCode(r);
    final fa = _faDigits.indexOf(c);
    final ar = arabic.indexOf(c);
    b.write(fa >= 0 ? fa : (ar >= 0 ? ar : c));
  }
  return b.toString();
}

String digits(String s, String lang) => lang == 'fa' ? toPersianDigits(s) : s;

/// List separator. A middle dot beside a Persian digit reads as Persian zero ("· ۱" looks like "۱۰"), so
/// Persian uses the Persian comma.
String sep(String lang) => lang == 'fa' ? '، ' : ' · ';

/// Wraps text in a left-to-right isolate (LRI ... PDI) so refs, flight numbers and phone numbers
/// keep their order inside RTL paragraphs (ch. 29.4).
String ltr(String s) => '\u2066$s\u2069';

const _jalaliMonthsEn = [
  'Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
  'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand',
];
const _jalaliMonthsFa = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/// "19 Azar 1405" / "۱۹ آذر ۱۴۰۵" for a Gregorian [date].
String formatJalaliDate(DateTime date, String lang) {
  final j = Jalali.fromDateTime(DateTime(date.year, date.month, date.day));
  final month = (lang == 'fa' ? _jalaliMonthsFa : _jalaliMonthsEn)[j.month - 1];
  return digits('${j.day} $month ${j.year}', lang);
}

/// "10 Dec 2026" / "۱۰ دسامبر ۲۰۲۶".
String formatGregorianDate(DateTime date, String lang) =>
    digits(DateFormat.yMMMd(lang).format(date), lang);

/// Date in the user's calendar preference.
String formatDate(DateTime date, {required String lang, required bool jalali}) =>
    jalali ? formatJalaliDate(date, lang) : formatGregorianDate(date, lang);

/// ISO `yyyy-MM-dd` (as the API sends dates) in the user's calendar.
String formatIsoDate(String? iso, {required String lang, required bool jalali}) {
  final d = iso == null ? null : DateTime.tryParse(iso);
  return d == null ? '' : formatDate(d, lang: lang, jalali: jalali);
}

String formatDateTime(DateTime? dt, {required String lang, required bool jalali}) {
  if (dt == null) return '';
  final local = dt.toLocal();
  final time = digits(DateFormat.Hm().format(local), lang);
  return '${formatDate(local, lang: lang, jalali: jalali)} $time';
}

/// "05:20" from a segment's `local` ("2026-12-11T05:20").
String localTime(String local, String lang) =>
    local.length >= 16 ? digits(local.substring(11, 16), lang) : local;

/// Whole-day difference between two local timestamps (for "+1d" arrival badges).
int dayOffset(String departLocal, String arriveLocal) {
  final a = DateTime.tryParse(departLocal.substring(0, 10));
  final b = DateTime.tryParse(arriveLocal.substring(0, 10));
  if (a == null || b == null) return 0;
  return b.difference(a).inDays;
}

String formatDuration(AppL10n l, int minutes, String lang) {
  final h = minutes ~/ 60;
  final m = minutes % 60;
  String n(int v) => digits('$v', lang);
  if (h > 0 && m > 0) return l.durationHm(n(h), n(m));
  if (h > 0) return l.durationH(n(h));
  return l.durationM(n(m));
}

const _zeroDecimal = {'JPY', 'KRW', 'IRR', 'VND'};

String formatMoney(Money? m, String lang) {
  if (m == null) return '';
  final zero = _zeroDecimal.contains(m.currency);
  final value = zero ? m.amountMinor : m.amountMinor / 100;
  const symbols = {'GBP': '£', 'USD': r'$', 'EUR': '€'};
  final f = NumberFormat.currency(
    locale: lang,
    symbol: symbols[m.currency] ?? '${m.currency} ',
    decimalDigits: zero || m.amountMinor % 100 == 0 ? 0 : 2,
  );
  return f.format(value);
}

/// Lowercase text with digits unified, for tolerant matching.
String normalise(String s) => toLatinDigits(s).trim().toLowerCase();
